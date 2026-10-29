import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type {
  AgentEvent,
  ApprovalDecision,
  EventBus,
  SeqEvent,
} from '../../../src/agent/core/events';
import type { PermissionGate } from '../../../src/agent/tools/types';
import { buildProblemSkeleton } from '../../../src/agent/workflow/recipes';
import {
  WorkflowScheduler,
  fixFilesFor,
  fixHints,
} from '../../../src/agent/workflow/scheduler';
import type {
  Checkpoint,
  Checkpoints,
  ConfigPatch,
  Manager,
  ManagerDecision,
  Plan,
  PlanTask,
  Spec,
  TaskResult,
  Worker,
  WorkerOutcome,
} from '../../../src/agent/workflow/types';

const TEMPLATE = path.resolve(__dirname, '../../../template/Config.json');

/** A spec with 3 wrong solutions (the brute force TL line does not count). */
const SPEC = `# Idea
Count pairs.

# Output
One integer.

# Wrong approaches
- int overflow -> WA
- same index counted -> WA
- sorts with a bad comparator -> RE
- O(n^2) brute force -> TL
`;

// ---------------------------------------------------------------- fakes

class FakeBus implements EventBus {
  events: SeqEvent[] = [];
  private listeners = new Set<(e: SeqEvent) => void>();
  private seq = 0;
  emit(e: AgentEvent): void {
    const se = { ...e, seq: this.seq++ };
    this.events.push(se);
    for (const fn of this.listeners) fn(se);
  }
  on(fn: (e: SeqEvent) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  get listenerCount(): number {
    return this.listeners.size;
  }
  /** Workflow events as short strings, like `started t1 1`. */
  trace(): string[] {
    return this.events.flatMap(e => {
      switch (e.type) {
        case 'plan_created':
          return ['plan'];
        case 'task_started':
          return [`started ${e.taskId} ${e.attempt}`];
        case 'task_checkpoint':
          return [`checkpoint ${e.taskId} ${e.ok ? 'ok' : 'failed'}`];
        case 'task_done':
          return [`done ${e.taskId} ${e.result.status}`];
        case 'workflow_done':
          return [`workflow ${e.ok ? 'ok' : 'failed'}`];
        default:
          return [];
      }
    });
  }
}

class FakeGate implements PermissionGate {
  mode: PermissionGate['mode'] = 'ask';
  plans: Plan[] = [];
  constructor(
    private readonly answer: ApprovalDecision = { kind: 'allow_once' }
  ) {}
  setMode(m: PermissionGate['mode']): void {
    this.mode = m;
  }
  check(): Promise<{ allowed: true }> {
    return Promise.resolve({ allowed: true });
  }
  askPlan(plan: Plan): Promise<ApprovalDecision> {
    this.plans.push(plan);
    return Promise.resolve(this.answer);
  }
  resolve(): void {}
}

class FakeManager implements Manager {
  planCalls: Spec[] = [];
  decideCalls: { failed: TaskResult }[] = [];
  constructor(
    private readonly plans: (Plan | Error)[],
    private readonly decisions: ManagerDecision[] = []
  ) {}
  makePlan(spec: Spec): Promise<Plan> {
    this.planCalls.push(spec);
    const next = this.plans.length > 1 ? this.plans.shift()! : this.plans[0];
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  }
  decide(input: { failed: TaskResult }): Promise<ManagerDecision> {
    this.decideCalls.push({ failed: input.failed });
    const next = this.decisions.shift();
    if (!next) return Promise.reject(new Error('no decision left'));
    return Promise.resolve(next);
  }
}

interface WorkerCall {
  taskId: string;
  kind: PlanTask['kind'];
  attempt: number;
  fresh: boolean;
  note?: string;
  ownsFiles: string[];
}

class FakeWorker implements Worker {
  calls: WorkerCall[] = [];
  running = 0;
  maxRunning = 0;
  constructor(
    private readonly opts: {
      delayMs?: number;
      bus?: FakeBus;
      patch?: (task: PlanTask) => ConfigPatch | undefined;
      waitForAbort?: boolean;
    } = {}
  ) {}
  async run(
    input: { task: PlanTask; attempt: number; fresh: boolean; note?: string },
    signal: AbortSignal
  ): Promise<WorkerOutcome> {
    const call: WorkerCall = {
      taskId: input.task.id,
      kind: input.task.kind,
      attempt: input.attempt,
      fresh: input.fresh,
      ownsFiles: [...input.task.ownsFiles],
    };
    if (input.note !== undefined) call.note = input.note;
    this.calls.push(call);
    this.running++;
    this.maxRunning = Math.max(this.maxRunning, this.running);
    try {
      if (this.opts.waitForAbort) {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        });
      }
      await new Promise(r => setTimeout(r, this.opts.delayMs ?? 1));
      this.opts.bus?.emit({
        type: 'usage',
        inputTokens: 10,
        outputTokens: 5,
        costUsd: 0.01,
      });
      const out: WorkerOutcome = {
        summary: `${input.task.id} done`,
        filesWritten: [],
      };
      const patch = this.opts.patch?.(input.task);
      if (patch) out.configPatch = patch;
      return out;
    } finally {
      this.running--;
    }
  }
}

type CheckFn = (
  task: PlanTask,
  count: number
) => Checkpoint | Promise<Checkpoint>;

class FakeCheckpoints implements Checkpoints {
  checkCount = new Map<string, number>();
  noModelCount = new Map<string, number>();
  constructor(
    private readonly onCheck: CheckFn = () => ({
      name: 'check',
      ok: true,
      digest: '',
    }),
    private readonly onNoModel: CheckFn = () => ({
      name: 'nomodel',
      ok: true,
      digest: '',
    })
  ) {}
  async check(task: PlanTask): Promise<Checkpoint> {
    const n = (this.checkCount.get(task.id) ?? 0) + 1;
    this.checkCount.set(task.id, n);
    return this.onCheck(task, n);
  }
  async runNoModelTask(task: PlanTask): Promise<{ checkpoint: Checkpoint }> {
    const n = (this.noModelCount.get(task.id) ?? 0) + 1;
    this.noModelCount.set(task.id, n);
    return { checkpoint: await this.onNoModel(task, n) };
  }
}

const OK: Checkpoint = { name: 'c', ok: true, digest: '' };
const fail = (digest: string): Checkpoint => ({ name: 'c', ok: false, digest });

// ---------------------------------------------------------------- setup

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'polyman-sched-'));
  await fs.copyFile(TEMPLATE, path.join(dir, 'Config.json'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function setup(opts: {
  manager?: FakeManager;
  worker?: FakeWorker;
  checkpoints?: FakeCheckpoints;
  gate?: FakeGate;
  bus?: FakeBus;
  parallel?: number;
}) {
  const bus = opts.bus ?? new FakeBus();
  const manager = opts.manager ?? new FakeManager([buildProblemSkeleton(SPEC)]);
  const worker = opts.worker ?? new FakeWorker({ bus });
  const checkpoints = opts.checkpoints ?? new FakeCheckpoints();
  const gate = opts.gate ?? new FakeGate();
  const scheduler = new WorkflowScheduler({
    manager,
    worker,
    checkpoints,
    permissions: gate,
    bus,
    problemDir: dir,
    ...(opts.parallel !== undefined
      ? { limits: { parallel: opts.parallel } }
      : {}),
  });
  return { bus, manager, worker, checkpoints, gate, scheduler };
}

const skeleton = buildProblemSkeleton(SPEC);
const idOf = (kind: PlanTask['kind'], n = 0): string =>
  skeleton.tasks.filter(t => t.kind === kind)[n].id;

function run(
  scheduler: WorkflowScheduler,
  recipe: Plan['recipe'] = 'build_problem'
) {
  return scheduler.run(SPEC, recipe, new AbortController().signal);
}

// ---------------------------------------------------------------- tests

describe('WorkflowScheduler', () => {
  it('runs every task after its dependencies', async () => {
    const { bus, scheduler } = setup({});
    const out = await run(scheduler);
    expect(out.ok).toBe(true);
    expect(out.results).toHaveLength(skeleton.tasks.length);
    expect(out.results.every(r => r.status === 'passed')).toBe(true);

    const trace = bus.trace();
    for (const task of skeleton.tasks) {
      const started = trace.indexOf(`started ${task.id} 1`);
      expect(started).toBeGreaterThan(0);
      for (const dep of task.dependsOn) {
        expect(trace.indexOf(`done ${dep} passed`)).toBeLessThan(started);
      }
    }
  });

  it('never runs more than 4 workers at once', async () => {
    const bus = new FakeBus();
    const worker = new FakeWorker({ delayMs: 20, bus });
    const { scheduler } = setup({ worker, bus });
    await run(scheduler);
    // statement, main, brute, validator, generators and 3 wrong solutions
    // are ready at the same time after the scaffold.
    expect(worker.maxRunning).toBe(4);
  });

  it('follows a smaller parallel limit', async () => {
    const bus = new FakeBus();
    const worker = new FakeWorker({ delayMs: 5, bus });
    const { scheduler } = setup({ worker, bus, parallel: 1 });
    const out = await run(scheduler);
    expect(out.ok).toBe(true);
    expect(worker.maxRunning).toBe(1);
  });

  it('applies the worker config patch', async () => {
    const bus = new FakeBus();
    const worker = new FakeWorker({
      bus,
      patch: t =>
        t.kind === 'brute_force'
          ? {
              addSolutions: [
                { name: 'brute', source: 'solutions/brute.cpp', tag: 'TO' },
              ],
            }
          : undefined,
    });
    const { scheduler } = setup({ worker, bus });
    const out = await run(scheduler);
    expect(out.ok).toBe(true);
    const config = JSON.parse(
      await fs.readFile(path.join(dir, 'Config.json'), 'utf-8')
    ) as {
      solutions: { name: string }[];
    };
    expect(config.solutions.map(s => s.name)).toContain('brute');
    expect(
      out.results.find(r => r.taskId === idOf('brute_force'))?.configPatch
    ).toBeDefined();
  });

  it('fails a task whose config patch is refused', async () => {
    const bus = new FakeBus();
    const worker = new FakeWorker({
      bus,
      patch: t =>
        t.kind === 'brute_force'
          ? {
              addSolutions: [
                {
                  name: 'brute',
                  source: 'solutions/brute.cpp',
                  tag: 'XX' as 'TO',
                },
              ],
            }
          : undefined,
    });
    const manager = new FakeManager(
      [skeleton],
      [
        {
          action: 'ask_user',
          taskId: idOf('brute_force'),
          question: 'which tag?',
        },
      ]
    );
    const { scheduler } = setup({ worker, bus, manager });
    const out = await run(scheduler);
    const brute = out.results.find(r => r.taskId === idOf('brute_force'))!;
    expect(brute.status).toBe('failed');
    expect(brute.checkpoint.digest).toContain('Config.json patch refused');
  });

  it('climbs the retry ladder, then asks the manager', async () => {
    const main = idOf('main_solution');
    const checkpoints = new FakeCheckpoints((task, n) =>
      task.id === main ? fail(`wrong on sample (${n})`) : OK
    );
    const manager = new FakeManager(
      [skeleton],
      [{ action: 'retry_with_hint', taskId: main, hint: 'use 64-bit' }]
    );
    const { worker, scheduler } = setup({ checkpoints, manager });
    const out = await run(scheduler);

    const calls = worker.calls.filter(c => c.taskId === main);
    expect(calls.map(c => [c.attempt, c.fresh])).toEqual([
      [1, true],
      [2, false],
      [3, true],
      [4, true],
    ]);
    expect(calls[0]?.note).toBeUndefined();
    expect(calls[1]?.note).toBe('wrong on sample (1)');
    expect(calls[2]?.note).toContain('wrong on sample (1)');
    expect(calls[2]?.note).toContain('wrong on sample (2)');
    expect(calls[3]?.note).toBe('use 64-bit');
    expect(manager.decideCalls).toHaveLength(1);
    expect(manager.decideCalls[0]?.failed).toMatchObject({
      taskId: main,
      status: 'failed',
      attempts: 3,
    });
    const result = out.results.find(r => r.taskId === main)!;
    expect(result).toMatchObject({ status: 'failed', attempts: 4 });
    expect(out.ok).toBe(false);
  });

  it('passes a task when the hint attempt works', async () => {
    const main = idOf('main_solution');
    const checkpoints = new FakeCheckpoints((task, n) =>
      task.id === main && n <= 3 ? fail('bad') : OK
    );
    const manager = new FakeManager(
      [skeleton],
      [{ action: 'retry_with_hint', taskId: main, hint: 'h' }]
    );
    const { scheduler } = setup({ checkpoints, manager });
    const out = await run(scheduler);
    expect(out.results.find(r => r.taskId === main)).toMatchObject({
      status: 'passed',
      attempts: 4,
    });
    expect(out.ok).toBe(true);
  });

  it('redo_task reruns the earlier task and its dependents', async () => {
    const validator = idOf('validator');
    const gv = idOf('generate_validate');
    const verify = idOf('verify');
    const checkpoints = new FakeCheckpoints(
      () => OK,
      (task, n) => (task.id === gv && n === 1 ? fail('test 3 invalid') : OK)
    );
    const manager = new FakeManager(
      [skeleton],
      [
        {
          action: 'redo_task',
          taskId: gv,
          redoTaskId: validator,
          hint: 'n can be 1',
        },
      ]
    );
    const { bus, worker, scheduler } = setup({ checkpoints, manager });
    const out = await run(scheduler);

    expect(out.ok).toBe(true);
    const validatorCalls = worker.calls.filter(c => c.taskId === validator);
    expect(validatorCalls).toHaveLength(2);
    expect(validatorCalls[1]?.note).toContain('n can be 1');
    expect(checkpoints.noModelCount.get(gv)).toBe(2);
    expect(checkpoints.noModelCount.get(verify)).toBe(1);
    const trace = bus.trace();
    expect(trace.indexOf(`done ${gv} passed`)).toBeGreaterThan(
      trace.lastIndexOf(`done ${validator} passed`)
    );
    expect(out.summary).toContain(`redo: ${validator}`);
  });

  it('ask_user stops only the dependent branch', async () => {
    const statement = idOf('statement');
    const critic = idOf('statement_critic');
    const verify = idOf('verify');
    const checkpoints = new FakeCheckpoints(task =>
      task.id === statement ? fail('legend is empty') : OK
    );
    const manager = new FakeManager(
      [skeleton],
      [
        {
          action: 'ask_user',
          taskId: statement,
          question: 'What is the story?',
        },
      ]
    );
    const { worker, scheduler } = setup({ checkpoints, manager });
    const out = await run(scheduler);

    expect(out.ok).toBe(false);
    const status = (id: string) =>
      out.results.find(r => r.taskId === id)?.status;
    expect(status(statement)).toBe('failed');
    expect(status(critic)).toBe('skipped');
    expect(status(verify)).toBe('skipped');
    for (const kind of [
      'main_solution',
      'brute_force',
      'validator',
      'generators',
    ] as const) {
      expect(status(idOf(kind))).toBe('passed');
    }
    expect(status(idOf('generate_validate'))).toBe('passed');
    expect(worker.calls.some(c => c.taskId === critic)).toBe(false);
    expect(out.summary).toContain('question (');
    expect(out.summary).toContain('What is the story?');
    const lines = out.summary.split('\n').length;
    expect(lines).toBeGreaterThanOrEqual(3);
    expect(lines).toBeLessThanOrEqual(6);
  });

  it('re-plans once with the errors, then uses the skeleton', async () => {
    const bad: Plan = { recipe: 'build_problem', tasks: [] };
    const manager = new FakeManager([bad, bad]);
    const { gate, scheduler } = setup({ manager });
    const out = await run(scheduler);

    expect(manager.planCalls).toHaveLength(2);
    expect(manager.planCalls[0]).toBe(SPEC);
    expect(manager.planCalls[1]).toContain('# Plan errors to fix');
    expect(manager.planCalls[1]).toContain('- missing a scaffold task');
    expect(gate.plans[0]).toEqual(skeleton);
    expect(out.summary).toContain('used the default plan');
    expect(out.ok).toBe(true);
  });

  it('uses the second plan when it is valid', async () => {
    const manager = new FakeManager([new Error('bad JSON'), skeleton]);
    const { scheduler } = setup({ manager });
    const out = await run(scheduler);
    expect(manager.planCalls).toHaveLength(2);
    expect(manager.planCalls[1]).toContain('the manager failed: bad JSON');
    expect(out.summary).not.toContain('default plan');
    expect(out.ok).toBe(true);
  });

  it('fix_verify uses its fixed plan, with no manager call', async () => {
    const manager = new FakeManager([{ recipe: 'fix_verify', tasks: [] }]);
    const { worker, scheduler } = setup({ manager });
    const out = await run(scheduler, 'fix_verify');
    expect(manager.planCalls).toHaveLength(0);
    expect(out.ok).toBe(true);
    expect(out.summary).toContain('fix_verify: 1 of 1 tasks passed');
    expect(worker.calls).toHaveLength(0);
  });

  it('prove_idea uses its plan from the spec, with no manager call', async () => {
    const manager = new FakeManager([{ recipe: 'prove_idea', tasks: [] }]);
    const { worker, gate, scheduler } = setup({ manager });
    const out = await run(scheduler, 'prove_idea');
    expect(manager.planCalls).toHaveLength(0);
    expect(gate.plans[0]?.recipe).toBe('prove_idea');
    expect(worker.calls.map(c => c.kind).sort()).toEqual([
      'proto_brute',
      'proto_gen',
      'proto_main',
      'proto_wrong',
      'proto_wrong',
      'proto_wrong',
    ]);
    expect(out.ok).toBe(true);
    expect(out.summary).toContain('prove_idea: 13 of 13 tasks passed');
  });

  it('a failed prove check ends at once and blocks the kills', async () => {
    const manager = new FakeManager([]);
    const checkpoints = new FakeCheckpoints(undefined, task =>
      task.kind === 'stress'
        ? fail('small test 4: brute says 2, main says 1')
        : OK
    );
    const { scheduler } = setup({ manager, checkpoints });
    const out = await run(scheduler, 'prove_idea');
    expect(out.ok).toBe(false);
    expect(manager.decideCalls).toHaveLength(0);
    expect(checkpoints.noModelCount.get('stress')).toBe(1);
    const status = new Map(out.results.map(r => [r.taskId, r.status]));
    expect(status.get('stress')).toBe('failed');
    expect(status.get('samples')).toBe('passed');
    expect(status.get('kill-1')).toBe('skipped');
    expect(status.get('kill-brute')).toBe('skipped');
  });

  it('strengthen_tests falls back to its skeleton after two bad plans', async () => {
    const manager = new FakeManager([
      { recipe: 'strengthen_tests', tasks: [] },
    ]);
    const { worker, scheduler } = setup({ manager });
    const out = await run(scheduler, 'strengthen_tests');
    expect(manager.planCalls).toHaveLength(2);
    expect(out.summary).toContain('used the default plan');
    expect(worker.calls.map(c => [c.kind, c.ownsFiles])).toEqual([
      [
        'generators',
        ['generators/gen-strong.cpp', 'generators/gen-script.txt'],
      ],
    ]);
    expect(out.ok).toBe(true);
  });

  it('stops when the plan is not approved', async () => {
    const gate = new FakeGate({ kind: 'deny', reason: 'no' });
    const { bus, worker, scheduler } = setup({ gate });
    const out = await run(scheduler);
    expect(out).toEqual({
      ok: false,
      results: [],
      summary: 'plan not approved',
    });
    expect(worker.calls).toHaveLength(0);
    expect(bus.trace()).toEqual(['plan', 'workflow failed']);
  });

  it('stops the fix loop after 3 rounds', async () => {
    const verify = idOf('verify');
    const checkpoints = new FakeCheckpoints(
      () => OK,
      task =>
        task.id === verify
          ? fail('solution main (solutions/main.cpp) tag MA: WA on test 4')
          : OK
    );
    const { worker, scheduler } = setup({ checkpoints });
    const out = await run(scheduler);

    const fixes = worker.calls.filter(c => c.kind === 'fix');
    expect(fixes.map(c => [c.attempt, c.fresh])).toEqual([
      [1, true],
      [2, false],
      [3, false],
    ]);
    expect(fixes[0]?.ownsFiles).toEqual(['solutions/main.cpp']);
    expect(fixes[0]?.note).toContain('WA on test 4');
    expect(checkpoints.noModelCount.get(verify)).toBe(4);
    expect(out.results.find(r => r.taskId === verify)).toMatchObject({
      status: 'failed',
      attempts: 4,
    });
    expect(out.results.find(r => r.taskId === `${verify}-fix`)?.status).toBe(
      'failed'
    );
    expect(out.summary).toContain('verify still fails after 3 fix rounds');
    expect(out.ok).toBe(false);
  });

  it('ends the fix loop when verify passes, and gives all files when none is named', async () => {
    const verify = idOf('verify');
    const checkpoints = new FakeCheckpoints(
      () => OK,
      (task, n) => (task.id === verify && n < 3 ? fail('something failed') : OK)
    );
    const { worker, scheduler } = setup({ checkpoints });
    const out = await run(scheduler);

    const fixes = worker.calls.filter(c => c.kind === 'fix');
    expect(fixes).toHaveLength(2);
    expect(fixes[0]?.ownsFiles).toContain('solutions/main.cpp');
    expect(fixes[0]?.ownsFiles).toContain('validator/val.cpp');
    expect(fixes[0]?.ownsFiles).toContain('generators/gen-random.cpp');
    expect(fixes[0]?.ownsFiles).not.toContain('statements/english/legend.tex');
    expect(out.results.find(r => r.taskId === verify)).toMatchObject({
      status: 'passed',
      attempts: 3,
    });
    expect(out.ok).toBe(true);
  });

  it('stops starting tasks on abort and waits for the running ones', async () => {
    const bus = new FakeBus();
    const worker = new FakeWorker({ bus, waitForAbort: true });
    const { scheduler } = setup({ worker, bus });
    const controller = new AbortController();
    const done = scheduler.run(SPEC, 'build_problem', controller.signal);
    // Wait until the first workers are running, then abort.
    for (let i = 0; i < 50 && worker.running < 4; i++) {
      await new Promise(r => setTimeout(r, 5));
    }
    const startedBefore = worker.calls.length;
    controller.abort();
    const out = await done;

    expect(out.ok).toBe(false);
    expect(worker.calls.length).toBe(startedBefore);
    expect(worker.running).toBe(0);
    expect(out.summary).toContain('cancelled');
    expect(
      out.results.some(r => r.status === 'skipped' && r.summary === 'cancelled')
    ).toBe(true);
    const last = bus.events.at(-1)!;
    expect(last.type).toBe('workflow_done');
    if (last.type === 'workflow_done') expect(last.ok).toBe(false);
  });

  it('emits the right events for a 3-task plan and sums the cost', async () => {
    const plan: Plan = {
      recipe: 'strengthen_tests',
      tasks: [
        {
          id: 'g',
          kind: 'generators',
          title: 'gen',
          dependsOn: [],
          brief: '',
          ownsFiles: ['generators/g.cpp'],
        },
        {
          id: 'gv',
          kind: 'generate_validate',
          title: 'gv',
          dependsOn: ['g'],
          brief: '',
          ownsFiles: [],
        },
        {
          id: 'v',
          kind: 'verify',
          title: 'verify',
          dependsOn: ['g', 'gv'],
          brief: '',
          ownsFiles: [],
        },
      ],
    };
    const manager = new FakeManager([plan]);
    const { bus, scheduler } = setup({ manager });
    const out = await run(scheduler, 'strengthen_tests');

    expect(out.ok).toBe(true);
    expect(bus.trace()).toEqual([
      'plan',
      'started g 1',
      'checkpoint g ok',
      'done g passed',
      'started gv 1',
      'checkpoint gv ok',
      'done gv passed',
      'started v 1',
      'checkpoint v ok',
      'done v passed',
      'workflow ok',
    ]);
    const last = bus.events.at(-1)!;
    expect(last).toMatchObject({
      type: 'workflow_done',
      ok: true,
      costUsd: 0.01,
    });
    if (last.type === 'workflow_done') {
      expect(last.summary).toBe(
        'strengthen_tests: 3 of 3 tasks passed\nno task failed\nno task skipped'
      );
    }
    expect(bus.listenerCount).toBe(0);
  });
});

describe('fixFilesFor', () => {
  const config = {
    solutions: [
      { name: 'main', source: 'solutions/main.cpp', tag: 'MA' },
      { name: 'brute', source: 'solutions/brute.cpp', tag: 'TO' },
      { name: 'wa-half', source: 'solutions/wa-half.cpp', tag: 'WA' },
    ],
    generators: ['generators/gen.cpp'],
    scriptFiles: ['generators/gen-script.txt'],
  };
  const all = [
    'solutions/main.cpp',
    'solutions/brute.cpp',
    'solutions/wa-half.cpp',
    'generators/gen.cpp',
    'validator/val.cpp',
  ];

  it('adds the main solution when a correct one gets a wrong answer', () => {
    const digest = [
      'failed step: verify-solutions',
      "solution brute (solutions/brute.cpp) tag TO: Solution brute marked as TO but got Wrong Answer on some tests; test 8: WA expected: '-1845002296', found: '2449965000'",
    ].join('\n');
    expect(fixFilesFor(digest, all, config)).toEqual([
      'solutions/brute.cpp',
      'solutions/main.cpp',
    ]);
  });

  it('adds the generators and the script when a wrong solution passes', () => {
    const digest =
      'solution wa-half (solutions/wa-half.cpp) tag WA: Solution wa-half marked as WA but did not get Wrong Answer or Presentation Error on any test';
    expect(fixFilesFor(digest, all, config)).toEqual([
      'solutions/wa-half.cpp',
      'generators/gen.cpp',
      'generators/gen-script.txt',
    ]);
  });

  it('gives every candidate when the digest names no file', () => {
    expect(
      fixFilesFor('test-validator: Validator Test 4 failed', all, config)
    ).toEqual(all);
  });
});

describe('fixHints', () => {
  const config = {
    solutions: [
      { name: 'main', source: 'solutions/main.cpp', tag: 'MA' },
      { name: 'brute', source: 'solutions/brute.cpp', tag: 'TO' },
      { name: 'wa-int', source: 'solutions/wa-int.cpp', tag: 'WA' },
    ],
    generators: ['generators/gen.cpp'],
    scriptFiles: ['generators/gen-script.txt'],
  };

  it('names main first when a correct solution gets a wrong answer', () => {
    const digest = [
      'failed step: verify-solutions',
      'solution brute (solutions/brute.cpp) tag TO: Solution brute marked as TO but got Wrong Answer on some tests; test 8: WA x',
      'solution wa-int (solutions/wa-int.cpp) tag WA: Solution wa-int marked as WA but did not get Wrong Answer or Presentation Error on any test',
    ].join('\n');
    const hints = fixHints(digest, config);
    expect(hints[0]).toBe(
      'brute (TO) gets a wrong answer against main: first check solutions/main.cpp (overflow, a missed case). Change solutions/brute.cpp only if main is right.'
    );
    expect(hints[1]).toContain(
      'wa-int (WA) passes every test: the tests are weak. Add a test that breaks it in generators/gen-script.txt. Do not change solutions/wa-int.cpp'
    );
    expect(hints[2]).toContain('fix main first');
  });

  it('gives no hint for a validator failure', () => {
    expect(fixHints('test-validator: Validator Test 4 failed', config)).toEqual(
      []
    );
  });
});
