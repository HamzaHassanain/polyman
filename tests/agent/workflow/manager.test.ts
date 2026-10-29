import { describe, it, expect } from 'vitest';
import { MockProvider } from '../../../src/agent/providers/mock';
import {
  ModelManager,
  parseDecision,
  parsePlan,
} from '../../../src/agent/workflow/manager';
import type { AgentEvent, EventBus } from '../../../src/agent/core/events';
import type { Plan, TaskResult } from '../../../src/agent/workflow/types';

const SPEC = `# Idea
Count pairs i < j with a_i + a_j = k.

# Wrong approaches
- answer kept in int (overflow) -> WA
`;

const PLAN: Plan = {
  recipe: 'build_problem',
  tasks: [
    {
      id: 't1',
      kind: 'scaffold',
      title: 'Scaffold',
      dependsOn: [],
      brief: 'Create the folder.',
      ownsFiles: [],
    },
    {
      id: 't2',
      kind: 'main_solution',
      title: 'Main solution: hash map',
      dependsOn: ['t1'],
      brief: 'Hash map, 64-bit answer.',
      ownsFiles: ['solutions/main.cpp'],
      params: { tag: 'MA' },
    },
    {
      id: 't3',
      kind: 'wrong_solution',
      title: 'Wrong: int overflow',
      dependsOn: ['t1'],
      brief: 'Keep the answer in int.',
      ownsFiles: ['solutions/wa-1.cpp'],
      params: { approach: 'answer kept in int (overflow)', tag: 'WA' },
    },
  ],
};

const signal = () => new AbortController().signal;

function failed(): TaskResult {
  return {
    taskId: 't2',
    status: 'failed',
    attempts: 3,
    summary: 'wrote solutions/main.cpp',
    checkpoint: {
      name: 'samples',
      ok: false,
      digest: 'sample 1: expected 2 got 1\nmore lines',
    },
  };
}

function bus(): EventBus & { events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  return {
    events,
    emit: e => {
      events.push(e);
    },
    on: () => () => {},
  };
}

describe('ModelManager.makePlan', () => {
  it('returns the plan from submit_plan', async () => {
    const provider = new MockProvider([
      {
        toolCall: { name: 'submit_plan', args: PLAN },
        usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.001 },
      },
    ]);
    const b = bus();
    const manager = new ModelManager({ provider, model: 'gemma', bus: b });
    const plan = await manager.makePlan(SPEC, 'build_problem', signal());
    expect(plan).toEqual(PLAN);

    expect(provider.requests).toHaveLength(1);
    const req = provider.requests[0];
    expect(req.model).toBe('gemma');
    expect(req.system).toContain('submit_plan');
    expect(req.tools.map(t => t.name)).toEqual(['submit_plan']);
    const firstPart = req.messages[0].parts[0];
    expect(firstPart?.type === 'text' && firstPart.text).toContain(
      'Count pairs'
    );
    // The exact wrong_solution list, so the manager does not count.
    expect(firstPart?.type === 'text' && firstPart.text).toContain(
      '1- params { approach: "answer kept in int (overflow)", tag: "WA" }'
    );
    expect(b.events).toEqual([
      { type: 'usage', inputTokens: 100, outputTokens: 50, costUsd: 0.001 },
    ]);
  });

  it('asks again when the model answers with text first', async () => {
    const provider = new MockProvider([
      { text: 'Here is my plan: ...' },
      { toolCall: { name: 'submit_plan', args: PLAN } },
    ]);
    const manager = new ModelManager({ provider, model: 'gemma' });
    const plan = await manager.makePlan(SPEC, 'build_problem', signal());
    expect(plan.tasks).toHaveLength(3);
    expect(provider.requests).toHaveLength(2);
    const second = provider.requests[1].messages;
    const last = second[second.length - 1];
    expect(last.role).toBe('user');
    expect(last.parts).toEqual([
      { type: 'text', text: 'Call submit_plan now.' },
    ]);
    expect(second.some(m => m.role === 'assistant')).toBe(true);
  });

  it('sends a bad shape back to the model and takes the next try', async () => {
    const provider = new MockProvider([
      { toolCall: { id: 'c1', name: 'submit_plan', args: { plan: [] } } },
      { toolCall: { name: 'submit_plan', args: PLAN } },
    ]);
    const manager = new ModelManager({ provider, model: 'gemma' });
    await expect(
      manager.makePlan(SPEC, 'build_problem', signal())
    ).resolves.toEqual(PLAN);
    const msgs = provider.requests[1].messages;
    const tool = msgs.find(m => m.role === 'tool');
    expect(tool?.parts[0]).toMatchObject({
      type: 'tool_result',
      callId: 'c1',
      isError: true,
    });
  });

  it('throws a clear error after 3 text answers', async () => {
    const provider = new MockProvider([
      { text: 'one' },
      { text: 'two' },
      { text: 'three' },
    ]);
    const manager = new ModelManager({ provider, model: 'gemma' });
    await expect(
      manager.makePlan(SPEC, 'build_problem', signal())
    ).rejects.toThrow(/did not call submit_plan .* after 3 tries/);
    expect(provider.remaining).toBe(0);
  });
});

describe('ModelManager.decide', () => {
  it('returns the decision from the decide tool', async () => {
    const provider = new MockProvider([
      {
        toolCall: {
          name: 'decide',
          args: {
            action: 'retry_with_hint',
            taskId: 't2',
            hint: 'use long long',
          },
        },
      },
    ]);
    const manager = new ModelManager({ provider, model: 'gemma' });
    const d = await manager.decide(
      { spec: SPEC, plan: PLAN, failed: failed(), results: [failed()] },
      signal()
    );
    expect(d).toEqual({
      action: 'retry_with_hint',
      taskId: 't2',
      hint: 'use long long',
    });
    const req = provider.requests[0];
    expect(req.tools.map(t => t.name)).toEqual(['decide']);
    const part = req.messages[0].parts[0];
    const text = part?.type === 'text' ? part.text : '';
    expect(text).toContain(
      '| t2 | main_solution | failed | wrote solutions/main.cpp |'
    );
    expect(text).toContain('sample 1: expected 2 got 1');
  });

  it('falls back to ask_user after 3 steps without a decision', async () => {
    const provider = new MockProvider([
      { text: 'hmm' },
      { toolCall: { name: 'decide', args: { action: 'retry_with_hint' } } },
      { text: 'still thinking' },
    ]);
    const manager = new ModelManager({ provider, model: 'gemma' });
    const d = await manager.decide(
      { spec: SPEC, plan: PLAN, failed: failed(), results: [] },
      signal()
    );
    expect(d).toEqual({
      action: 'ask_user',
      taskId: 't2',
      question: 'The task t2 failed 3 times: sample 1: expected 2 got 1',
    });
  });

  it('stops on abort', async () => {
    const provider = new MockProvider([{ text: 'x' }]);
    const manager = new ModelManager({ provider, model: 'gemma' });
    const ac = new AbortController();
    ac.abort();
    await expect(
      manager.decide(
        { spec: SPEC, plan: PLAN, failed: failed(), results: [] },
        ac.signal
      )
    ).rejects.toThrow();
  });
});

describe('parsePlan and parseDecision', () => {
  it('fills defaults and keeps only string params', () => {
    const plan = parsePlan(
      {
        tasks: [{ kind: 'verify', title: 'Verify', params: { n: 2, ok: 'x' } }],
      },
      'fix_verify'
    );
    expect(plan).toEqual({
      recipe: 'fix_verify',
      tasks: [
        {
          id: 't1',
          kind: 'verify',
          title: 'Verify',
          dependsOn: [],
          brief: '',
          ownsFiles: [],
          params: { n: '2', ok: 'x' },
        },
      ],
    });
  });

  it('rejects unknown kinds with the list of kinds', () => {
    expect(parsePlan({ tasks: [{ kind: 'magic' }] }, 'build_problem')).toMatch(
      /tasks\[0\]\.kind: must be one of scaffold/
    );
  });

  it('checks the fields each action needs', () => {
    expect(parseDecision({ action: 'redo_task' }, 't2')).toMatch(/redoTaskId/);
    expect(parseDecision({ action: 'ask_user' }, 't2')).toMatch(/question/);
    expect(parseDecision({ action: 'nope' }, 't2')).toMatch(/must be one of/);
    expect(
      parseDecision({ action: 'redo_task', redoTaskId: 't5', hint: 'h' }, 't2')
    ).toEqual({
      action: 'redo_task',
      taskId: 't2',
      redoTaskId: 't5',
      hint: 'h',
    });
  });
});
