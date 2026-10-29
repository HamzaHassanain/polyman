import { describe, it, expect } from 'vitest';
import type {
  AgentEvent,
  EventBus,
  SeqEvent,
} from '../../../src/agent/core/events';
import { DefaultPermissionGate } from '../../../src/agent/tools/permissions';
import type {
  PermissionMode,
  Risk,
  Tool,
} from '../../../src/agent/tools/types';
import type { Plan } from '../../../src/agent/workflow/types';

/** A small in-memory bus, like the W2 one. */
class FakeBus implements EventBus {
  readonly events: SeqEvent[] = [];
  private listeners: ((e: SeqEvent) => void)[] = [];
  private seq = 0;
  emit(e: AgentEvent): void {
    const se = { ...e, seq: this.seq++ };
    this.events.push(se);
    for (const fn of [...this.listeners]) fn(se);
  }
  on(fn: (e: SeqEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter(l => l !== fn);
    };
  }
  ofType<T extends AgentEvent['type']>(
    type: T
  ): Extract<SeqEvent, { type: T }>[] {
    return this.events.filter(e => e.type === type) as Extract<
      SeqEvent,
      { type: T }
    >[];
  }
}

function tool(name: string, risk: Risk, extra: Partial<Tool> = {}): Tool {
  return {
    name,
    description: name,
    parameters: { type: 'object' },
    risk,
    needsProblem: false,
    run: () => Promise.resolve({ content: 'ok' }),
    ...extra,
  };
}

const signal = (): AbortSignal => new AbortController().signal;

/** Answers the next approval with `decision`. */
function answerNext(
  bus: FakeBus,
  gate: DefaultPermissionGate,
  decision: Parameters<DefaultPermissionGate['resolve']>[1]
): void {
  const off = bus.on(e => {
    if (e.type === 'approval_needed' || e.type === 'plan_approval_needed') {
      off();
      gate.resolve(e.approvalId, decision);
    }
  });
}

const plan: Plan = {
  recipe: 'build_problem',
  tasks: [
    {
      id: 't1',
      kind: 'main_solution',
      title: 'Main solution',
      dependsOn: [],
      brief: 'write it',
      ownsFiles: ['solutions/main.cpp'],
    },
  ],
};

describe('DefaultPermissionGate', () => {
  it('starts in ask mode and setMode only sets the mode', () => {
    const bus = new FakeBus();
    const gate = new DefaultPermissionGate(bus);
    expect(gate.mode).toBe('ask');
    gate.setMode('auto-edit');
    expect(gate.mode).toBe('auto-edit');
    expect(bus.events).toEqual([]);
    expect(new DefaultPermissionGate(bus, 'plan-approved').mode).toBe(
      'plan-approved'
    );
  });

  const modes: PermissionMode[] = ['ask', 'auto-edit', 'plan-approved'];

  for (const mode of modes) {
    it(`${mode}: allows read and run without asking`, async () => {
      const bus = new FakeBus();
      const gate = new DefaultPermissionGate(bus, mode);
      await expect(
        gate.check(tool('read_file', 'read'), {}, signal())
      ).resolves.toEqual({ allowed: true });
      await expect(
        gate.check(tool('verify', 'run'), {}, signal())
      ).resolves.toEqual({ allowed: true });
      expect(bus.events).toEqual([]);
    });

    it(`${mode}: always asks for remote`, async () => {
      const bus = new FakeBus();
      const gate = new DefaultPermissionGate(bus, mode);
      const remote = tool('remote_push', 'remote');
      answerNext(bus, gate, { kind: 'allow_session' });
      await expect(gate.check(remote, {}, signal())).resolves.toEqual({
        allowed: true,
      });
      // allow_session does not stop the next ask for a remote tool.
      answerNext(bus, gate, { kind: 'deny', reason: 'not now' });
      await expect(gate.check(remote, {}, signal())).resolves.toEqual({
        allowed: false,
        reason: 'not now',
      });
      expect(bus.ofType('approval_needed')).toHaveLength(2);
    });
  }

  it('ask: asks for write', async () => {
    const bus = new FakeBus();
    const gate = new DefaultPermissionGate(bus, 'ask');
    answerNext(bus, gate, { kind: 'allow_once' });
    await expect(
      gate.check(tool('write_file', 'write'), {}, signal())
    ).resolves.toEqual({ allowed: true });
    expect(bus.ofType('approval_needed')).toHaveLength(1);
  });

  it('auto-edit and plan-approved: allow write without asking', async () => {
    for (const mode of ['auto-edit', 'plan-approved'] as const) {
      const bus = new FakeBus();
      const gate = new DefaultPermissionGate(bus, mode);
      await expect(
        gate.check(tool('write_file', 'write'), {}, signal())
      ).resolves.toEqual({ allowed: true });
      expect(bus.events).toEqual([]);
    }
  });

  it('allow_once asks again next time', async () => {
    const bus = new FakeBus();
    const gate = new DefaultPermissionGate(bus);
    const write = tool('write_file', 'write');
    answerNext(bus, gate, { kind: 'allow_once' });
    await gate.check(write, {}, signal());
    answerNext(bus, gate, { kind: 'allow_once' });
    await gate.check(write, {}, signal());
    expect(bus.ofType('approval_needed')).toHaveLength(2);
  });

  it('allow_session adds a rule for that tool name only', async () => {
    const bus = new FakeBus();
    const gate = new DefaultPermissionGate(bus);
    const write = tool('write_file', 'write');
    answerNext(bus, gate, { kind: 'allow_session' });
    await gate.check(write, {}, signal());
    await expect(gate.check(write, {}, signal())).resolves.toEqual({
      allowed: true,
    });
    expect(bus.ofType('approval_needed')).toHaveLength(1);

    answerNext(bus, gate, { kind: 'allow_once' });
    await gate.check(tool('edit_file', 'write'), {}, signal());
    expect(bus.ofType('approval_needed')).toHaveLength(2);
  });

  it('deny returns the reason, or a default one', async () => {
    const bus = new FakeBus();
    const gate = new DefaultPermissionGate(bus);
    const write = tool('write_file', 'write');
    answerNext(bus, gate, { kind: 'deny', reason: 'use edit_file' });
    await expect(gate.check(write, {}, signal())).resolves.toEqual({
      allowed: false,
      reason: 'use edit_file',
    });
    answerNext(bus, gate, { kind: 'deny' });
    await expect(gate.check(write, {}, signal())).resolves.toEqual({
      allowed: false,
      reason: 'no reason given',
    });
  });

  it('emits approval_needed with describe() and the last call id', async () => {
    const bus = new FakeBus();
    const gate = new DefaultPermissionGate(bus);
    const write = tool('write_file', 'write', {
      describe: (args: unknown) => ({
        title: 'Write solutions/main.cpp',
        command: `write ${(args as { path: string }).path}`,
      }),
    });
    bus.emit({
      type: 'tool_call',
      callId: 'call_7',
      name: 'write_file',
      args: { path: 'solutions/main.cpp' },
      risk: 'write',
    });
    answerNext(bus, gate, { kind: 'allow_once' });
    await gate.check(write, { path: 'solutions/main.cpp' }, signal());

    const [needed] = bus.ofType('approval_needed');
    expect(needed).toMatchObject({
      callId: 'call_7',
      title: 'Write solutions/main.cpp',
      command: 'write solutions/main.cpp',
    });
    expect(bus.ofType('approval_resolved')).toEqual([
      expect.objectContaining({
        approvalId: needed.approvalId,
        decision: { kind: 'allow_once' },
      }),
    ]);
  });

  it('falls back to the tool name and short args', async () => {
    const bus = new FakeBus();
    const gate = new DefaultPermissionGate(bus);
    answerNext(bus, gate, { kind: 'allow_once' });
    await gate.check(
      tool('write_file', 'write'),
      { path: 'a.cpp', content: 'x'.repeat(1000) },
      signal()
    );
    const [needed] = bus.ofType('approval_needed');
    expect(needed.title).toBe('write_file');
    expect(needed.command).toMatch(/^write_file \{"path":"a\.cpp"/);
    expect(needed.command!.length).toBeLessThanOrEqual(212);
    expect(needed.command!.endsWith('...')).toBe(true);
  });

  it('gives each approval its own id and ignores unknown ids', async () => {
    const bus = new FakeBus();
    const gate = new DefaultPermissionGate(bus);
    const write = tool('write_file', 'write');
    const first = gate.check(write, {}, signal());
    const second = gate.check(tool('edit_file', 'write'), {}, signal());
    const [a, b] = bus.ofType('approval_needed');
    expect(a.approvalId).not.toBe(b.approvalId);

    gate.resolve('nope', { kind: 'allow_once' });
    gate.resolve(b.approvalId, { kind: 'deny', reason: 'no' });
    gate.resolve(a.approvalId, { kind: 'allow_once' });
    await expect(first).resolves.toEqual({ allowed: true });
    await expect(second).resolves.toEqual({ allowed: false, reason: 'no' });
    // A second answer to the same id does nothing.
    gate.resolve(a.approvalId, { kind: 'deny' });
    expect(bus.ofType('approval_resolved')).toHaveLength(2);
  });

  it('rejects with the abort error when aborted while waiting', async () => {
    const bus = new FakeBus();
    const gate = new DefaultPermissionGate(bus);
    const controller = new AbortController();
    const waiting = gate.check(
      tool('write_file', 'write'),
      {},
      controller.signal
    );
    const reason = new Error('user cancelled');
    controller.abort(reason);
    await expect(waiting).rejects.toBe(reason);

    const [needed] = bus.ofType('approval_needed');
    expect(bus.ofType('approval_resolved')).toEqual([
      expect.objectContaining({
        approvalId: needed.approvalId,
        decision: { kind: 'deny', reason: 'cancelled' },
      }),
    ]);
    // A late answer does nothing.
    gate.resolve(needed.approvalId, { kind: 'allow_once' });
    expect(bus.ofType('approval_resolved')).toHaveLength(1);
  });

  it('rejects at once when the signal is already aborted', async () => {
    const bus = new FakeBus();
    const gate = new DefaultPermissionGate(bus);
    const controller = new AbortController();
    controller.abort();
    await expect(
      gate.check(tool('write_file', 'write'), {}, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(bus.events).toEqual([]);
  });

  describe('askPlan', () => {
    it('emits plan_approval_needed and switches to plan-approved', async () => {
      for (const kind of ['allow_once', 'allow_session'] as const) {
        const bus = new FakeBus();
        const gate = new DefaultPermissionGate(bus);
        answerNext(bus, gate, { kind });
        await expect(gate.askPlan(plan, signal())).resolves.toEqual({ kind });
        expect(gate.mode).toBe('plan-approved');
        const [needed] = bus.ofType('plan_approval_needed');
        expect(needed.plan).toBe(plan);
        expect(bus.ofType('approval_resolved')).toHaveLength(1);
        // Writes no longer ask.
        await gate.check(tool('write_file', 'write'), {}, signal());
        expect(bus.ofType('approval_needed')).toHaveLength(0);
        // Until setMode is called again.
        gate.setMode('ask');
        expect(gate.mode).toBe('ask');
      }
    });

    it('keeps the mode on deny', async () => {
      const bus = new FakeBus();
      const gate = new DefaultPermissionGate(bus);
      answerNext(bus, gate, { kind: 'deny', reason: 'too many tasks' });
      await expect(gate.askPlan(plan, signal())).resolves.toEqual({
        kind: 'deny',
        reason: 'too many tasks',
      });
      expect(gate.mode).toBe('ask');
    });

    it('rejects when aborted while waiting', async () => {
      const bus = new FakeBus();
      const gate = new DefaultPermissionGate(bus);
      const controller = new AbortController();
      const waiting = gate.askPlan(plan, controller.signal);
      controller.abort();
      await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
      expect(gate.mode).toBe('ask');
    });
  });
});
