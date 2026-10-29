import { describe, it, expect } from 'vitest';
import type { AgentEvent, SeqEvent } from '../../../src/agent/core/events';
import type { Plan } from '../../../src/agent/workflow/types';
import {
  initialState,
  MAX_TASK_TOOLS,
  previewOf,
  reduce,
  shortArgs,
  type UiAction,
  type UiState,
} from '../../../src/agent/tui/store.js';

let seq = 0;
const ev = (e: AgentEvent): SeqEvent => ({ ...e, seq: ++seq });

const start = () => initialState({ problem: 'pairs-sum', model: 'm' });

const run = (state: UiState, actions: UiAction[]) =>
  actions.reduce(reduce, state);

/** The finished items without their ids. */
const items = (s: UiState) => s.finished.map(({ id: _id, ...rest }) => rest);

const toolCall = (callId: string, name: string, args: unknown = {}) =>
  ev({ type: 'tool_call', callId, name, args, risk: 'run' });

describe('tui store', () => {
  it('starts empty and idle', () => {
    const s = start();
    expect(s.finished).toEqual([]);
    expect(s.status).toEqual({
      problem: 'pairs-sum',
      model: 'm',
      mode: 'ask',
      tokens: 0,
      costUsd: 0,
      busy: false,
    });
  });

  it('shows only the folder name when the problem is a full path', () => {
    const s = initialState({ problem: '/home/me/work/pairs-sum', model: 'm' });
    expect(s.status.problem).toBe('pairs-sum');
    expect(initialState({ problem: null, model: 'm' }).status.problem).toBe(
      null
    );
  });

  it('adds the user message and marks busy', () => {
    const s = reduce(start(), { type: 'user_message', text: 'hello' });
    expect(items(s)).toEqual([{ kind: 'user', text: 'hello' }]);
    expect(s.status.busy).toBe(true);
  });

  it('text_delta adds to the streaming text', () => {
    let s = reduce(start(), ev({ type: 'text_delta', text: 'Hel' }));
    s = reduce(s, ev({ type: 'text_delta', text: 'lo' }));
    expect(s.live.streamingText).toBe('Hello');
    expect(s.finished).toEqual([]);
  });

  it('tool_call moves the streamed text into finished and adds a running tool', () => {
    let s = reduce(
      start(),
      ev({ type: 'text_delta', text: 'Let me write it.' })
    );
    s = reduce(
      s,
      toolCall('c1', 'write_file', { path: 'val.cpp', content: 'x' })
    );
    expect(items(s)).toEqual([{ kind: 'assistant', text: 'Let me write it.' }]);
    expect(s.live.streamingText).toBe('');
    expect(s.live.runningTools).toEqual([
      { callId: 'c1', name: 'write_file', args: 'val.cpp', lastLine: null },
    ]);
  });

  it('tool_progress sets the last line of the tool', () => {
    let s = reduce(start(), toolCall('c1', 'verify'));
    s = reduce(s, ev({ type: 'tool_progress', callId: 'c1', line: 'a (1/2)' }));
    s = reduce(s, ev({ type: 'tool_progress', callId: 'c1', line: 'a (2/2)' }));
    expect(s.live.runningTools[0]?.lastLine).toBe('a (2/2)');
  });

  it('tool_result moves the tool into finished with ok or error', () => {
    let s = run(start(), [
      toolCall('c1', 'verify'),
      toolCall('c2', 'generate', { testset: 'tests' }),
      ev({ type: 'tool_result', callId: 'c1', ok: false, summary: 'WA' }),
      ev({ type: 'tool_result', callId: 'c2', ok: true, summary: '25 tests' }),
    ]);
    expect(items(s)).toEqual([
      {
        kind: 'tool',
        callId: 'c1',
        name: 'verify',
        args: '',
        ok: false,
        summary: 'WA',
      },
      {
        kind: 'tool',
        callId: 'c2',
        name: 'generate',
        args: 'tests',
        ok: true,
        summary: '25 tests',
      },
    ]);
    expect(s.live.runningTools).toEqual([]);
    s = reduce(
      s,
      ev({ type: 'tool_result', callId: 'zz', ok: true, summary: 'x' })
    );
    expect(s.finished[2]).toMatchObject({ name: 'tool', summary: 'x' });
  });

  it('turn_end flushes the text and sets busy to false', () => {
    const s = run(start(), [
      { type: 'user_message', text: 'hi' },
      ev({ type: 'turn_start', turnId: 't1' }),
      ev({ type: 'text_delta', text: 'Hello!' }),
      ev({ type: 'turn_end', turnId: 't1', reason: 'done' }),
    ]);
    expect(items(s)).toEqual([
      { kind: 'user', text: 'hi' },
      { kind: 'assistant', text: 'Hello!' },
    ]);
    expect(s.status.busy).toBe(false);
    expect(s.live).toEqual({
      streamingText: '',
      reasoning: '',
      runningTools: [],
    });
  });

  it.each([
    ['cancelled', undefined, 'warn', 'Interrupted by the user.'],
    ['max_steps', undefined, 'warn', 'step limit'],
    ['error', 'HTTP 402: no credits', 'error', 'Error: HTTP 402: no credits'],
  ] as const)(
    'turn_end with %s adds a notice',
    (reason, error, level, text) => {
      const end: AgentEvent =
        error === undefined
          ? { type: 'turn_end', turnId: 't', reason }
          : { type: 'turn_end', turnId: 't', reason, error };
      const s = reduce(start(), ev(end));
      expect(s.finished).toHaveLength(1);
      expect(s.finished[0]).toMatchObject({ kind: 'notice', level });
      expect(s.finished[0]).toHaveProperty(
        'text',
        expect.stringContaining(text)
      );
    }
  );

  it('usage adds tokens and cost', () => {
    const s = run(start(), [
      ev({
        type: 'usage',
        inputTokens: 1000,
        outputTokens: 200,
        costUsd: 0.01,
      }),
      ev({ type: 'usage', inputTokens: 500, outputTokens: 50 }),
    ]);
    expect(s.status.tokens).toBe(1750);
    expect(s.status.costUsd).toBeCloseTo(0.01);
  });

  it('approval_needed sets the approval, approval_resolved clears it', () => {
    let s = reduce(start(), toolCall('c1', 'write_file', { path: 'a.cpp' }));
    s = reduce(
      s,
      ev({
        type: 'approval_needed',
        approvalId: 'a1',
        callId: 'c1',
        title: 'Write a.cpp?',
        preview: '+ x',
      })
    );
    expect(s.approval).toEqual({
      approvalId: 'a1',
      callId: 'c1',
      toolName: 'write_file',
      title: 'Write a.cpp?',
      preview: '+ x',
    });
    const other = reduce(
      s,
      ev({
        type: 'approval_resolved',
        approvalId: 'other',
        decision: { kind: 'deny' },
      })
    );
    expect(other.approval).not.toBeNull();
    s = reduce(
      s,
      ev({
        type: 'approval_resolved',
        approvalId: 'a1',
        decision: { kind: 'allow_once' },
      })
    );
    expect(s.approval).toBeNull();
  });

  it('a write approval without a preview shows the written content', () => {
    const write = (args: unknown) =>
      ev({
        type: 'tool_call',
        callId: 'c1',
        name: 'write_file',
        args,
        risk: 'write',
      });
    const ask = ev({
      type: 'approval_needed',
      approvalId: 'a1',
      callId: 'c1',
      title: 'Write hello.txt',
    });
    let s = run(start(), [
      write({ path: 'hello.txt', content: 'hi\nthere\n' }),
      ask,
    ]);
    expect(s.approval?.preview).toBe('+ hi\n+ there');
    s = run(start(), [
      ev({
        type: 'tool_call',
        callId: 'c1',
        name: 'edit_file',
        args: { path: 'a.cpp', old_text: 'int x;', new_text: 'long long x;' },
        risk: 'write',
      }),
      ask,
    ]);
    expect(s.approval?.preview).toBe('- int x;\n+ long long x;');
    // A preview from the gate wins, and read tools keep none.
    s = run(start(), [
      write({ path: 'a', content: 'x' }),
      { ...ask, preview: '+ gate' },
    ]);
    expect(s.approval?.preview).toBe('+ gate');
    expect(previewOf({ path: 'a' })).toBeUndefined();
  });

  it('local actions: notice, set_mode, approval_answered, turn_settled', () => {
    let s = run(start(), [
      { type: 'notice', text: 'help text' },
      { type: 'set_mode', mode: 'auto-edit' },
      { type: 'user_message', text: 'x' },
      { type: 'turn_settled' },
    ]);
    expect(s.finished[0]).toMatchObject({
      kind: 'notice',
      level: 'info',
      text: 'help text',
    });
    expect(s.status.mode).toBe('auto-edit');
    expect(s.status.busy).toBe(false);
    s = reduce(
      s,
      ev({ type: 'approval_needed', approvalId: 'a1', callId: 'c', title: 't' })
    );
    s = reduce(s, { type: 'approval_answered', approvalId: 'a1' });
    expect(s.approval).toBeNull();
  });

  it('problem_dir_changed sets the problem name, compacted adds a notice', () => {
    const s = run(initialState({ problem: null, model: 'm' }), [
      ev({ type: 'problem_dir_changed', problemDir: '/tmp/work/pairs-sum/' }),
      ev({ type: 'compacted', removedMessages: 6 }),
    ]);
    expect(s.status.problem).toBe('pairs-sum');
    expect(s.finished[0]).toMatchObject({ kind: 'notice' });
  });

  it('workflow events update the workflow', () => {
    const plan: Plan = {
      recipe: 'build_problem',
      tasks: [
        {
          id: 't1',
          kind: 'validator',
          title: 'Validator',
          dependsOn: [],
          brief: 'b',
          ownsFiles: ['validator/val.cpp'],
        },
        {
          id: 't2',
          kind: 'main_solution',
          title: 'Main solution',
          dependsOn: ['t1'],
          brief: 'b',
          ownsFiles: ['solutions/main.cpp'],
        },
      ],
    };
    let s = run(start(), [
      ev({ type: 'plan_created', plan }),
      ev({ type: 'plan_approval_needed', approvalId: 'p1', plan }),
    ]);
    expect(s.planApproval).toEqual({ approvalId: 'p1', plan });
    expect(s.workflow?.tasks['t1']?.status).toBe('pending');
    s = run(s, [
      ev({
        type: 'approval_resolved',
        approvalId: 'p1',
        decision: { kind: 'allow_once' },
      }),
      ev({ type: 'task_started', taskId: 't1', attempt: 1 }),
      ev({
        type: 'task_checkpoint',
        taskId: 't1',
        name: 'validator tests',
        ok: false,
        digest: 'accepts n = 0',
      }),
      ev({ type: 'task_started', taskId: 't1', attempt: 2 }),
    ]);
    expect(s.planApproval).toBeNull();
    expect(s.workflow?.tasks['t1']).toMatchObject({
      status: 'running',
      attempt: 2,
      checkpoint: { ok: false, digest: 'accepts n = 0' },
    });
    s = reduce(
      s,
      ev({
        type: 'task_done',
        taskId: 't1',
        result: {
          taskId: 't1',
          status: 'passed',
          attempts: 2,
          summary: 'ok',
          checkpoint: { name: 'validator tests', ok: true, digest: '' },
        },
      })
    );
    expect(s.workflow?.tasks['t1']).toMatchObject({
      status: 'passed',
      attempt: 2,
    });
    s = reduce(
      s,
      ev({ type: 'workflow_done', ok: true, summary: '2 tasks', costUsd: 0.1 })
    );
    expect(s.workflow).toBeNull();
    expect(s.finished.at(-1)).toMatchObject({
      kind: 'workflow',
      ok: true,
      summary: '2 tasks',
      costUsd: 0.1,
    });
  });

  it('worker tool events go to their task, not to the transcript', () => {
    const plan: Plan = {
      recipe: 'build_problem',
      tasks: [
        {
          id: 't4',
          kind: 'main_solution',
          title: 'Main solution',
          dependsOn: [],
          brief: 'b',
          ownsFiles: ['solutions/main.cpp'],
        },
      ],
    };
    let s = run(start(), [
      ev({ type: 'plan_created', plan }),
      ev({ type: 'task_started', taskId: 't4', attempt: 1 }),
      toolCall('c0', 'start_workflow', { recipe: 'build_problem' }),
      ev({
        type: 'tool_call',
        callId: 'w1',
        name: 'run_solution',
        args: { name: 'main' },
        risk: 'run',
        taskId: 't4',
      }),
      ev({
        type: 'tool_progress',
        callId: 'w1',
        line: 'compiling',
        taskId: 't4',
      }),
    ]);
    expect(s.finished).toEqual([]);
    expect(s.live.runningTools.map(t => t.callId)).toEqual(['c0']);
    expect(s.workflow?.tasks['t4']?.tools).toEqual([
      {
        callId: 'w1',
        name: 'run_solution',
        args: 'main',
        attempt: 1,
        ok: null,
        summary: null,
      },
    ]);

    s = reduce(
      s,
      ev({
        type: 'tool_result',
        callId: 'w1',
        ok: false,
        summary: 'WA on sample 1\nexpected 2, got 1',
        taskId: 't4',
      })
    );
    expect(s.finished).toEqual([]);
    expect(s.workflow?.tasks['t4']?.tools[0]).toMatchObject({
      ok: false,
      summary: 'WA on sample 1',
    });

    // A new attempt tags its calls with the new attempt number.
    s = run(s, [
      ev({ type: 'task_started', taskId: 't4', attempt: 2 }),
      ev({
        type: 'tool_call',
        callId: 'w2',
        name: 'read_file',
        args: { path: 'solutions/main.cpp' },
        risk: 'read',
        taskId: 't4',
      }),
    ]);
    expect(s.workflow?.tasks['t4']?.tools.map(t => t.attempt)).toEqual([1, 2]);

    // The chat's own tool result still goes to the transcript.
    s = reduce(
      s,
      ev({ type: 'tool_result', callId: 'c0', ok: true, summary: 'done' })
    );
    expect(items(s)).toEqual([
      {
        kind: 'tool',
        callId: 'c0',
        name: 'start_workflow',
        args: 'build_problem',
        ok: true,
        summary: 'done',
      },
    ]);
  });

  it('keeps the last 20 tool calls of a task', () => {
    const plan: Plan = {
      recipe: 'build_problem',
      tasks: [
        {
          id: 't1',
          kind: 'scaffold',
          title: 'Scaffold',
          dependsOn: [],
          brief: 'b',
          ownsFiles: [],
        },
      ],
    };
    const calls = Array.from({ length: 25 }, (_, i) =>
      ev({
        type: 'tool_call',
        callId: `w${i}`,
        name: 'read_file',
        args: { path: `f${i}` },
        risk: 'read',
        taskId: 't1',
      })
    );
    const s = run(start(), [ev({ type: 'plan_created', plan }), ...calls]);
    const tools = s.workflow?.tasks['t1']?.tools ?? [];
    expect(tools).toHaveLength(MAX_TASK_TOOLS);
    expect(MAX_TASK_TOOLS).toBe(20);
    expect(tools[0]?.callId).toBe('w5');
    expect(tools.at(-1)?.callId).toBe('w24');
  });

  it('drops worker tool events when no workflow runs', () => {
    const s = run(start(), [
      ev({
        type: 'tool_call',
        callId: 'w1',
        name: 'read_file',
        args: {},
        risk: 'read',
        taskId: 't1',
      }),
      ev({
        type: 'tool_result',
        callId: 'w1',
        ok: true,
        summary: 'x',
        taskId: 't1',
      }),
    ]);
    expect(s.finished).toEqual([]);
    expect(s.live.runningTools).toEqual([]);
    expect(s.workflow).toBeNull();
  });

  it('a full scripted turn ends in the right finished list', () => {
    const s = run(start(), [
      { type: 'user_message', text: 'build it' },
      ev({ type: 'turn_start', turnId: 't1' }),
      ev({ type: 'reasoning_delta', text: 'thinking' }),
      ev({ type: 'text_delta', text: 'I will write ' }),
      ev({ type: 'text_delta', text: 'the validator.' }),
      ev({ type: 'usage', inputTokens: 100, outputTokens: 10, costUsd: 0.001 }),
      toolCall('c1', 'write_file', { path: 'validator/val.cpp' }),
      ev({
        type: 'approval_needed',
        approvalId: 'a1',
        callId: 'c1',
        title: 'Write validator/val.cpp?',
      }),
      ev({
        type: 'approval_resolved',
        approvalId: 'a1',
        decision: { kind: 'allow_once' },
      }),
      ev({ type: 'tool_result', callId: 'c1', ok: true, summary: 'wrote it' }),
      toolCall('c2', 'verify'),
      ev({ type: 'tool_progress', callId: 'c2', line: 'Running (1/2)' }),
      ev({
        type: 'tool_result',
        callId: 'c2',
        ok: false,
        summary: 'verify failed',
      }),
      ev({ type: 'text_delta', text: 'Verify failed, see above.' }),
      ev({ type: 'usage', inputTokens: 200, outputTokens: 20, costUsd: 0.002 }),
      ev({ type: 'turn_end', turnId: 't1', reason: 'done' }),
    ]);
    expect(items(s)).toEqual([
      { kind: 'user', text: 'build it' },
      { kind: 'assistant', text: 'I will write the validator.' },
      {
        kind: 'tool',
        callId: 'c1',
        name: 'write_file',
        args: 'validator/val.cpp',
        ok: true,
        summary: 'wrote it',
      },
      {
        kind: 'tool',
        callId: 'c2',
        name: 'verify',
        args: '',
        ok: false,
        summary: 'verify failed',
      },
      { kind: 'assistant', text: 'Verify failed, see above.' },
    ]);
    expect(s.finished.map(i => i.id)).toEqual([1, 2, 3, 4, 5]);
    expect(s.status).toMatchObject({ busy: false, tokens: 330 });
    expect(s.status.costUsd).toBeCloseTo(0.003);
    expect(s.approval).toBeNull();
  });

  it('shortArgs picks the main argument and cuts it', () => {
    expect(shortArgs({})).toBe('');
    expect(shortArgs({ content: 'abc', path: 'a/b.cpp' })).toBe('a/b.cpp');
    expect(shortArgs({ foo: 'bar' })).toBe('bar');
    expect(shortArgs({ n: 3 })).toBe('3');
    expect(shortArgs('x'.repeat(80), 10)).toBe('xxxxxxxxx…');
    expect(shortArgs({ command: 'line1\nline2' })).toBe('line1');
    expect(shortArgs(null)).toBe('');
  });
});
