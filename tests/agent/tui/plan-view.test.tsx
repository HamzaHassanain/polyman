import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import type { AgentEvent, SeqEvent } from '../../../src/agent/core/events.js';
import type { Plan, TaskResult } from '../../../src/agent/workflow/types.js';
import {
  initialState,
  pickTask,
  reduce,
  shownStatus,
  type UiAction,
  type UiState,
  type WorkflowView,
} from '../../../src/agent/tui/store.js';
import {
  EDIT_PLAN_REASON,
  PLAN_WARNING,
  PlanApproval,
  filesOf,
} from '../../../src/agent/tui/components/PlanApproval.js';
import {
  PlanView,
  TaskDetails,
  formatElapsed,
  splitTag,
  taskDetail,
} from '../../../src/agent/tui/components/PlanView.js';
import { MessageView } from '../../../src/agent/tui/components/MessageView.js';
import { App } from '../../../src/agent/tui/App.js';
import {
  DEMO_PLAN,
  FakeBus,
  FakeSession,
} from '../../../src/agent/tui/dev/fake-session.js';

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

let seq = 0;
const ev = (e: AgentEvent): SeqEvent => ({ ...e, seq: ++seq });

const start = () => initialState({ problem: 'pairs-sum', model: 'm' });

const run = (state: UiState, actions: UiAction[]) =>
  actions.reduce(reduce, state);

/** Waits until the frame passes `check`, or fails after `ms`. */
async function waitFor(
  frame: () => string | undefined,
  check: (f: string) => boolean,
  ms = 3000
): Promise<string> {
  const end = Date.now() + ms;
  for (;;) {
    const f = frame() ?? '';
    if (check(f)) return f;
    if (Date.now() > end) {
      throw new Error(`timed out, last frame:\n${f}`);
    }
    await tick(10);
  }
}

const PLAN: Plan = {
  recipe: 'build_problem',
  tasks: [
    {
      id: 't1',
      kind: 'scaffold',
      title: 'scaffold',
      dependsOn: [],
      brief: 'make the folder',
      ownsFiles: ['Config.json', 'testlib.h'],
    },
    {
      id: 't2',
      kind: 'validator',
      title: 'validator',
      dependsOn: ['t1'],
      brief: 'write the validator',
      ownsFiles: ['validator/val.cpp'],
    },
    {
      id: 't3',
      kind: 'main_solution',
      title: 'main solution',
      dependsOn: ['t1'],
      brief: 'sort + two pointers',
      ownsFiles: ['solutions/main.cpp'],
      params: { tag: 'MA' },
    },
    {
      id: 't4',
      kind: 'generate_validate',
      title: 'generate + validate',
      dependsOn: ['t2', 't3'],
      brief: 'run the generators',
      ownsFiles: [],
    },
  ],
};

const result = (
  taskId: string,
  status: TaskResult['status'],
  attempts: number,
  digest: string,
  name = 'check'
): TaskResult => ({
  taskId,
  status,
  attempts,
  summary: `${taskId} ${status}`,
  checkpoint: { name, ok: status === 'passed', digest },
});

/** A workflow view straight from events, for the components. */
function workflowFrom(actions: UiAction[]): WorkflowView {
  const s = run(start(), [
    ev({ type: 'plan_created', plan: PLAN }),
    ...actions,
  ]);
  if (!s.workflow) throw new Error('no workflow');
  return s.workflow;
}

afterEach(() => {
  cleanup();
});

describe('task detail', () => {
  it('shows only the digest for a task that failed on its only try', () => {
    const wf = workflowFrom([
      ev({ type: 'task_started', taskId: 't4', attempt: 1 }),
      ev({
        type: 'task_done',
        taskId: 't4',
        result: result('t4', 'failed', 1, 'small test 4: brute says 2'),
      }),
      ev({ type: 'task_started', taskId: 't3', attempt: 1 }),
      ev({ type: 'task_started', taskId: 't3', attempt: 2 }),
      ev({
        type: 'task_done',
        taskId: 't3',
        result: result('t3', 'failed', 2, 'WA on sample 1'),
      }),
    ]);
    const detail = (id: string) =>
      taskDetail(
        PLAN.tasks.find(t => t.id === id)!,
        wf.tasks[id],
        PLAN,
        wf.tasks
      );
    expect(detail('t4')).toBe('small test 4: brute says 2');
    expect(detail('t3')).toBe('attempt 2 · WA on sample 1');
  });
});

describe('plan store rules', () => {
  it('a scripted workflow gives the right task states', () => {
    let s = run(start(), [
      ev({ type: 'usage', inputTokens: 1, outputTokens: 1, costUsd: 0.5 }),
      ev({ type: 'plan_created', plan: PLAN }),
      ev({ type: 'plan_approval_needed', approvalId: 'p1', plan: PLAN }),
    ]);
    expect(s.planApproval?.approvalId).toBe('p1');
    expect(s.workflow?.approvalId).toBe('p1');
    expect(s.workflow?.costAtStart).toBe(0.5);
    expect(Object.values(s.workflow?.tasks ?? {}).map(t => t.status)).toEqual([
      'pending',
      'pending',
      'pending',
      'pending',
    ]);

    s = run(s, [
      {
        type: 'approval_answered',
        approvalId: 'p1',
        decision: { kind: 'allow_once' },
      },
      ev({ type: 'task_started', taskId: 't1', attempt: 1 }),
      ev({
        type: 'task_done',
        taskId: 't1',
        result: result('t1', 'passed', 1, 'ready'),
      }),
      ev({ type: 'task_started', taskId: 't2', attempt: 1 }),
      ev({ type: 'task_started', taskId: 't3', attempt: 1 }),
      ev({
        type: 'task_checkpoint',
        taskId: 't2',
        name: 'test validator',
        ok: false,
        digest: '5 of 6 ok\ntest 4: accepts n = 0',
      }),
    ]);
    expect(s.planApproval).toBeNull();
    expect(s.workflow?.approvalId).toBeNull();
    const wf = s.workflow!;
    expect(wf.tasks['t1']?.status).toBe('passed');
    // The result checkpoint is kept, once.
    expect(wf.tasks['t1']?.attempts).toEqual([
      {
        attempt: 1,
        checkpoints: [{ name: 'check', ok: true, digest: 'ready' }],
      },
    ]);
    expect(shownStatus(wf.tasks['t2'])).toBe('retrying');
    expect(shownStatus(wf.tasks['t3'])).toBe('running');
    expect(shownStatus(wf.tasks['t4'])).toBe('pending');

    s = run(s, [
      ev({ type: 'task_started', taskId: 't2', attempt: 2 }),
      ev({
        type: 'task_checkpoint',
        taskId: 't2',
        name: 'test validator',
        ok: true,
        digest: '6 of 6 ok',
      }),
      ev({
        type: 'task_done',
        taskId: 't2',
        result: result('t2', 'passed', 2, '6 of 6 ok', 'test validator'),
      }),
      ev({
        type: 'task_done',
        taskId: 't3',
        result: result('t3', 'failed', 2, 'WA on sample 1'),
      }),
    ]);
    const t2 = s.workflow!.tasks['t2'];
    expect(t2).toMatchObject({ status: 'passed', attempt: 2 });
    expect(t2.attempts.map(a => a.attempt)).toEqual([1, 2]);
    expect(t2.attempts[0]?.checkpoints[0]?.ok).toBe(false);
    // The checkpoint event and the result are the same: not added twice.
    expect(t2.attempts[1]?.checkpoints).toHaveLength(1);
    expect(s.workflow!.tasks['t3']).toMatchObject({
      status: 'failed',
      checkpoint: { digest: 'WA on sample 1' },
    });

    s = reduce(
      s,
      ev({
        type: 'workflow_done',
        ok: false,
        summary: 'main failed',
        costUsd: 0.2,
      })
    );
    expect(s.workflow).toBeNull();
    const item = s.finished.at(-1);
    expect(item).toMatchObject({
      kind: 'workflow',
      ok: false,
      summary: 'main failed',
      costUsd: 0.2,
      problem: 'pairs-sum',
    });
    if (item?.kind === 'workflow') {
      expect(item.tasks['t3']?.status).toBe('failed');
    }
  });

  it('a denied plan drops the workflow', () => {
    const asked = run(start(), [
      ev({ type: 'plan_approval_needed', approvalId: 'p1', plan: PLAN }),
    ]);
    expect(asked.workflow).not.toBeNull();
    const local = reduce(asked, {
      type: 'approval_answered',
      approvalId: 'p1',
      decision: { kind: 'deny', reason: EDIT_PLAN_REASON },
    });
    expect(local.planApproval).toBeNull();
    expect(local.workflow).toBeNull();
    const fromSession = reduce(
      asked,
      ev({
        type: 'approval_resolved',
        approvalId: 'p1',
        decision: { kind: 'deny' },
      })
    );
    expect(fromSession.workflow).toBeNull();
  });

  it('a turn that ends before the answer drops the plan', () => {
    const s = run(start(), [
      ev({ type: 'turn_start', turnId: 'x' }),
      ev({ type: 'plan_created', plan: PLAN }),
      ev({ type: 'plan_approval_needed', approvalId: 'p1', plan: PLAN }),
      ev({ type: 'turn_end', turnId: 'x', reason: 'cancelled' }),
    ]);
    expect(s.planApproval).toBeNull();
    expect(s.workflow).toBeNull();
  });

  it('an approved workflow stays after its turn ends', () => {
    const s = run(start(), [
      ev({ type: 'plan_created', plan: PLAN }),
      ev({ type: 'task_started', taskId: 't1', attempt: 1 }),
      ev({ type: 'turn_end', turnId: 'x', reason: 'done' }),
    ]);
    expect(s.workflow?.tasks['t1']?.status).toBe('running');
  });

  it('workflow_done without a workflow adds a notice', () => {
    const s = reduce(
      start(),
      ev({ type: 'workflow_done', ok: true, summary: 'done', costUsd: 0 })
    );
    expect(s.finished.at(-1)).toMatchObject({
      kind: 'notice',
      text: 'Workflow done: done',
    });
  });

  it('pickTask opens the details on the running task, then the failed one', () => {
    expect(pickTask(workflowFrom([]))).toBe(0);
    expect(
      pickTask(
        workflowFrom([
          ev({
            type: 'task_done',
            taskId: 't2',
            result: result('t2', 'failed', 2, 'x'),
          }),
        ])
      )
    ).toBe(1);
    expect(
      pickTask(
        workflowFrom([
          ev({
            type: 'task_done',
            taskId: 't2',
            result: result('t2', 'failed', 2, 'x'),
          }),
          ev({ type: 'task_started', taskId: 't3', attempt: 1 }),
        ])
      )
    ).toBe(2);
  });
});

describe('plan helpers', () => {
  it('splits and colors the solution tag', () => {
    expect(splitTag({ title: 'main solution', params: { tag: 'MA' } })).toEqual(
      { title: 'main solution', tag: 'MA' }
    );
    expect(splitTag({ title: 'brute force (TO)' })).toEqual({
      title: 'brute force',
      tag: 'TO',
    });
    expect(splitTag({ title: 'validator' })).toEqual({
      title: 'validator',
      tag: null,
    });
  });

  it('formats the timer and the files column', () => {
    expect(formatElapsed(108_000)).toBe('1:48');
    expect(formatElapsed(5_400)).toBe('0:05');
    expect(filesOf(PLAN.tasks[0])).toBe('Config.json, testlib.h');
    expect(filesOf(PLAN.tasks[3])).toBe('no model, CLI only');
  });
});

describe('PlanApproval', () => {
  it('renders the header, every task row, the warning and the options', () => {
    const { lastFrame } = render(
      <PlanApproval
        approvalId="p1"
        plan={PLAN}
        problem="pairs-sum"
        resolveApproval={vi.fn()}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Run this plan?');
    expect(frame).toContain(
      'build_problem · pairs-sum · 4 tasks · up to 4 in parallel'
    );
    expect(frame).toMatch(/t1\s+scaffold\s+Config\.json, testlib\.h/);
    expect(frame).toMatch(/t2\s+validator\s+validator\/val\.cpp/);
    expect(frame).toMatch(/t3\s+main solution MA\s+solutions\/main\.cpp/);
    expect(frame).toMatch(/t4\s+generate \+ validate\s+no model, CLI only/);
    expect(frame.replace(/[│\s]+/g, ' ')).toContain(PLAN_WARNING);
    expect(frame).toContain('❯ 1. Run it');
    expect(frame).toContain('2. Edit the plan');
    expect(frame).toContain('3. Cancel');
  });

  it('key 1 resolves allow_once', async () => {
    const resolve = vi.fn();
    const { stdin } = render(
      <PlanApproval
        approvalId="p1"
        plan={PLAN}
        problem={null}
        resolveApproval={resolve}
      />
    );
    await tick();
    // The second key comes before React draws again (like on a slow CI
    // machine): it must do nothing, the plan is answered once.
    stdin.write('1');
    stdin.write('3');
    await tick();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledWith('p1', { kind: 'allow_once' });
    stdin.write('2');
    await tick();
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('key 2 asks to edit, key 3 and esc cancel', async () => {
    for (const [key, decision] of [
      ['2', { kind: 'deny', reason: EDIT_PLAN_REASON }],
      ['3', { kind: 'deny' }],
      ['\u001B', { kind: 'deny' }],
    ] as const) {
      const resolve = vi.fn();
      const { stdin, unmount } = render(
        <PlanApproval
          approvalId="p1"
          plan={PLAN}
          problem={null}
          resolveApproval={resolve}
        />
      );
      await tick();
      stdin.write(key);
      await tick(key === '\u001B' ? 80 : 20);
      expect(resolve).toHaveBeenCalledWith('p1', decision);
      unmount();
    }
  });

  it('arrows move the choice and enter picks it', async () => {
    const resolve = vi.fn();
    const { stdin, lastFrame } = render(
      <PlanApproval
        approvalId="p1"
        plan={PLAN}
        problem={null}
        resolveApproval={resolve}
      />
    );
    await tick();
    // Wait for each redraw before the next key: on a busy machine a fixed
    // tick is not enough, and the second arrow would land on the old state.
    stdin.write('\u001B[C');
    await vi.waitFor(() => expect(lastFrame()).toContain('❯ 2.'));
    stdin.write('\u001B[C');
    await vi.waitFor(() => expect(lastFrame()).toContain('❯ 3. Cancel'));
    stdin.write('\r');
    await vi.waitFor(() =>
      expect(resolve).toHaveBeenCalledWith('p1', { kind: 'deny' })
    );
  });
});

describe('PlanView', () => {
  const live = () =>
    workflowFrom([
      ev({ type: 'task_started', taskId: 't1', attempt: 1 }),
      ev({
        type: 'task_done',
        taskId: 't1',
        result: result('t1', 'passed', 1, ''),
      }),
      ev({ type: 'task_started', taskId: 't2', attempt: 2 }),
      ev({
        type: 'task_checkpoint',
        taskId: 't2',
        name: 'test validator',
        ok: false,
        digest: 'test validator: 5 of 6 ok\nmore',
      }),
      ev({ type: 'task_started', taskId: 't3', attempt: 1 }),
    ]);

  it('shows the header, the icons and the waits for text', () => {
    const wf = { ...live(), costAtStart: 0.01 };
    const { lastFrame } = render(
      <PlanView workflow={wf} problem="pairs-sum" costUsd={0.07} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(
      /✦ Workflow: build_problem \(pairs-sum\)\s+▰{3}▱{7} 1\/4 · \$0\.06 · 0:0\d/
    );
    expect(frame).toMatch(/✔ scaffold\n/);
    expect(frame).toMatch(
      /↻ validator\s+attempt 2 · test validator: 5 of 6 ok/
    );
    expect(frame).not.toContain('more');
    expect(frame).toMatch(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] main solution MA\s+attempt 1/);
    expect(frame).toMatch(
      /◻ generate \+ validate\s+waits for validator, main solution/
    );
    expect(frame).toContain('ctrl+o shows the details of a task');
  });

  it('shows ✗ for a failed task and drops passed deps from waits for', () => {
    const wf = workflowFrom([
      ev({
        type: 'task_done',
        taskId: 't2',
        result: result('t2', 'passed', 1, 'ok'),
      }),
      ev({
        type: 'task_done',
        taskId: 't3',
        result: result('t3', 'failed', 2, 'WA on sample 1'),
      }),
    ]);
    const { lastFrame } = render(
      <PlanView workflow={wf} problem={null} costUsd={0} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('(new problem)');
    expect(frame).toMatch(/✗ main solution MA\s+attempt 2 · WA on sample 1/);
    expect(frame).toMatch(/waits for main solution\n/);
  });

  it('shows the last tool call of a running task', () => {
    const wf = workflowFrom([
      ev({ type: 'task_started', taskId: 't3', attempt: 1 }),
      ev({
        type: 'tool_call',
        callId: 'w1',
        name: 'write_file',
        args: { path: 'solutions/main.cpp', content: 'x' },
        risk: 'write',
        taskId: 't3',
      }),
      ev({
        type: 'tool_result',
        callId: 'w1',
        ok: true,
        summary: 'wrote it',
        taskId: 't3',
      }),
      ev({
        type: 'tool_call',
        callId: 'w2',
        name: 'run_solution',
        args: { name: 'main' },
        risk: 'run',
        taskId: 't3',
      }),
      ev({ type: 'task_started', taskId: 't2', attempt: 2 }),
    ]);
    const { lastFrame } = render(
      <PlanView workflow={wf} problem="p" costUsd={0} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(
      /main solution MA\s+attempt 1 · run_solution\(main\)/
    );
    // The old attempt has no call in attempt 2 yet: no tool shown.
    expect(frame).toMatch(/validator\s+attempt 2\n/);
  });

  it('marks the selected task when the details are open', () => {
    const { lastFrame } = render(
      <PlanView workflow={live()} problem="p" costUsd={0} selected={1} />
    );
    expect(lastFrame()).toMatch(/❯ ↻ validator/);
    expect(lastFrame()).not.toContain('ctrl+o shows');
  });
});

describe('TaskDetails', () => {
  it('shows the attempts, the digests and no tool calls yet', () => {
    const wf = workflowFrom([
      ev({ type: 'task_started', taskId: 't2', attempt: 1 }),
      ev({
        type: 'task_checkpoint',
        taskId: 't2',
        name: 'test validator',
        ok: false,
        digest: '5 of 6 ok\ntest 4: accepts n = 0',
      }),
      ev({ type: 'task_started', taskId: 't2', attempt: 2 }),
    ]);
    const { lastFrame } = render(<TaskDetails workflow={wf} index={1} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('t2 validator · running, attempt 2');
    expect(frame).toContain('files: validator/val.cpp');
    expect(frame).toContain('brief: write the validator');
    expect(frame).toMatch(/attempt 1\s*│\s*\n.*✗ test validator/);
    expect(frame).toContain('5 of 6 ok');
    expect(frame).toContain('test 4: accepts n = 0');
    expect(frame).toContain('working, no checkpoint yet');
    expect(frame).toContain('tool calls: none yet');
    expect(frame).not.toContain('not available');
    expect(frame).toContain('esc or ctrl+o to close');
  });

  it('lists the tool calls of the task with their results', () => {
    const wf = workflowFrom([
      ev({ type: 'task_started', taskId: 't3', attempt: 1 }),
      ev({
        type: 'tool_call',
        callId: 'w1',
        name: 'run_solution',
        args: { name: 'main' },
        risk: 'run',
        taskId: 't3',
      }),
      ev({
        type: 'tool_result',
        callId: 'w1',
        ok: false,
        summary: 'WA on sample 1',
        taskId: 't3',
      }),
      ev({ type: 'task_started', taskId: 't3', attempt: 2 }),
      ev({
        type: 'tool_call',
        callId: 'w2',
        name: 'edit_file',
        args: { path: 'solutions/main.cpp' },
        risk: 'write',
        taskId: 't3',
      }),
      ev({
        type: 'tool_result',
        callId: 'w2',
        ok: true,
        summary: 'edited 2 lines',
        taskId: 't3',
      }),
      ev({
        type: 'tool_call',
        callId: 'w3',
        name: 'list_files',
        args: {},
        risk: 'read',
        taskId: 't3',
      }),
    ]);
    const { lastFrame } = render(<TaskDetails workflow={wf} index={2} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('tool calls');
    expect(frame).toMatch(
      /attempt 1\s*│\s*\n.*✗ run_solution\(main\) · WA on sample 1/
    );
    expect(frame).toMatch(
      /attempt 2\s*│\s*\n.*✔ edit_file\(solutions\/main\.cpp\) · edited 2 lines/
    );
    expect(frame).toContain('… list_files · running');
    expect(frame).not.toContain('not available');
  });

  it('shows the result of a finished task', () => {
    const wf = workflowFrom([
      ev({
        type: 'task_done',
        taskId: 't1',
        result: result('t1', 'passed', 1, 'ready'),
      }),
    ]);
    const { lastFrame } = render(<TaskDetails workflow={wf} index={0} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('passed after 1 attempt');
    expect(frame).toContain('✔ check');
    expect(frame).toContain('result: t1 passed');
  });
});

describe('finished workflow in the transcript', () => {
  it('shows the still tree and the summary lines', () => {
    const wf = workflowFrom([
      ev({
        type: 'task_done',
        taskId: 't1',
        result: result('t1', 'passed', 1, ''),
      }),
      ev({ type: 'task_started', taskId: 't2', attempt: 1 }),
    ]);
    const { lastFrame } = render(
      <MessageView
        item={{
          kind: 'workflow',
          id: 1,
          plan: wf.plan,
          tasks: wf.tasks,
          problem: 'pairs-sum',
          ok: false,
          summary: 'validator failed\nstopped after 3 fix rounds',
          costUsd: 0.08,
          elapsedMs: 192_000,
        }}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toMatch(
      /● Workflow: build_problem \(pairs-sum\) failed\s+▰{3}▱{7} 1\/4 · \$0\.08 · 3:12/
    );
    expect(frame).toMatch(/✔ scaffold/);
    expect(frame).toMatch(/◻ validator\s+stopped/);
    expect(frame).toContain(
      '⎿ validator failed\n    stopped after 3 fix rounds'
    );
  });
});

describe('App with a workflow', () => {
  function setup() {
    const bus = new FakeBus();
    const session = new FakeSession(bus, { delayScale: 0 });
    const ui = render(
      <App
        session={session}
        bus={bus}
        info={{ problem: 'pairs-sum', model: 'google/gemma-4-31b-it' }}
      />
    );
    return { bus, session, ...ui };
  }

  it('the plan box, the live tree and the details (ctrl+o)', async () => {
    const { bus, session, stdin, lastFrame } = setup();
    const resolve = vi.spyOn(session, 'resolveApproval');
    await tick();
    bus.emit({ type: 'plan_created', plan: PLAN });
    bus.emit({ type: 'plan_approval_needed', approvalId: 'p1', plan: PLAN });
    let frame = await waitFor(lastFrame, f => f.includes('Run this plan?'));
    expect(frame).not.toContain('Workflow: build_problem');
    expect(frame).not.toContain('Type a message');
    await tick();
    stdin.write('1');
    await waitFor(lastFrame, f => !f.includes('Run this plan?'));
    expect(resolve).toHaveBeenCalledWith('p1', { kind: 'allow_once' });

    bus.emit({ type: 'task_started', taskId: 't1', attempt: 1 });
    bus.emit({
      type: 'task_checkpoint',
      taskId: 't1',
      name: 'scaffold',
      ok: false,
      digest: 'testlib.h is missing',
    });
    frame = await waitFor(lastFrame, f => f.includes('↻ scaffold'));
    expect(frame).toContain('✦ Workflow: build_problem (pairs-sum)');
    expect(frame).toContain('Type a message');

    await tick();
    stdin.write('\u000F');
    frame = await waitFor(lastFrame, f => f.includes('esc or ctrl+o to close'));
    expect(frame).toContain('t1 scaffold');
    expect(frame).toContain('testlib.h is missing');
    expect(frame).toMatch(/❯ ↻ scaffold/);
    expect(frame).not.toContain('Type a message');

    await tick();
    stdin.write('\u001B[B');
    frame = await waitFor(lastFrame, f => f.includes('t2 validator'));
    expect(frame).toMatch(/❯ ◻ validator/);
    expect(frame).toContain('No attempts yet.');

    await tick();
    stdin.write('\u001B');
    frame = await waitFor(
      lastFrame,
      f => !f.includes('esc or ctrl+o to close')
    );
    expect(frame).toContain('Type a message');

    bus.emit({
      type: 'workflow_done',
      ok: true,
      summary: 'all good',
      costUsd: 0.01,
    });
    frame = await waitFor(lastFrame, f => f.includes('⎿ all good'));
    expect(frame).toContain('Workflow: build_problem (pairs-sum) done');
    expect(frame).not.toContain('ctrl+o shows');
  });

  it('runs the scripted workflow of the fake session to the end', async () => {
    const { stdin, lastFrame } = setup();
    await tick();
    stdin.write('run the workflow');
    await tick();
    stdin.write('\r');
    let frame = await waitFor(lastFrame, f => f.includes('Run this plan?'));
    expect(frame).toContain('12 tasks · up to 4 in parallel');
    for (const t of DEMO_PLAN.tasks) {
      expect(frame).toContain(t.id);
    }
    await tick();
    stdin.write('1');
    frame = await waitFor(lastFrame, f => f.includes('Say push to send it'));
    expect(frame).toContain('Workflow: build_problem (pairs-sum) done');
    expect(frame).toMatch(/✔ validator\s+attempt 3 · 6 of 6 ok/);
    expect(frame).toContain('⎿ 12 of 12 tasks passed');
    expect(frame).toContain('workflow done: 12 of 12 tasks passed');
  });

  it('Edit the plan sends the user back to the input with a note', async () => {
    const { stdin, lastFrame } = setup();
    await tick();
    stdin.write('run the workflow');
    await tick();
    stdin.write('\r');
    await waitFor(lastFrame, f => f.includes('Run this plan?'));
    await tick();
    stdin.write('2');
    const frame = await waitFor(lastFrame, f =>
      f.includes('what should I change in the plan?')
    );
    expect(frame).toContain('The plan did not run. Type what to change');
    expect(frame).toContain('the user did not run the plan');
    expect(frame).not.toContain('Workflow: build_problem');
    expect(frame).toContain('Type a message');
  });
});
