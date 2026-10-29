/**
 * The workflow scheduler: the part of the workflow manager that is our
 * code, not the model (doc 10). It checks the plan, asks the user, runs the
 * tasks in dependency order with a parallel limit, runs the checkpoints,
 * retries and escalates, applies config patches one at a time, and reports
 * everything as events.
 */

import fs from 'fs/promises';
import path from 'path';
import type { ApprovalDecision, EventBus } from '../core/events';
import type { PermissionGate } from '../tools/types';
import { applyConfigPatch } from './config-patch';
import {
  addRecipeDependencies,
  buildProblemSkeleton,
  checkPlan,
  dependentsOf,
  fixVerifyPlan,
  isNoModelKind,
  isProveCheck,
  normalizePath,
  proveIdeaPlan,
  strengthenTestsSkeleton,
} from './recipes';
import {
  WORKFLOW_LIMITS,
  type Checkpoint,
  type Checkpoints,
  type ConfigPatch,
  type Manager,
  type ManagerDecision,
  type Plan,
  type PlanTask,
  type Spec,
  type TaskKind,
  type TaskResult,
  type Worker,
  type WorkerOutcome,
} from './types';

/** The limits of one run, as plain numbers. */
export type WorkflowLimits = {
  -readonly [K in keyof typeof WORKFLOW_LIMITS]: number;
};

/** What {@link WorkflowScheduler} needs. */
export interface WorkflowSchedulerOptions {
  manager: Manager;
  worker: Worker;
  checkpoints: Checkpoints;
  permissions: PermissionGate;
  bus: EventBus;
  problemDir: string;
  /** Overrides some of {@link WORKFLOW_LIMITS}. */
  limits?: Partial<WorkflowLimits>;
}

/** The outcome of {@link WorkflowScheduler.run}. */
export interface WorkflowRunResult {
  ok: boolean;
  results: TaskResult[];
  /** 3 to 6 lines for the user. */
  summary: string;
}

type Status = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

interface TaskState {
  task: PlanTask;
  status: Status;
  result?: TaskResult;
  /** The note for the next first attempt, like a manager hint. */
  note?: string;
  /** Changes when the task is reset, so an old run's result is dropped. */
  gen: number;
}

interface Attempt {
  checkpoint: Checkpoint;
  summary: string;
  configPatch?: ConfigPatch;
}

type TaskOutcome =
  | { kind: 'done'; result: TaskResult }
  | { kind: 'redo'; redoTaskId: string; hint: string };

/** Kinds whose files the fixer may get when the verify digest names none. */
const FIXABLE_KINDS: readonly TaskKind[] = [
  'main_solution',
  'brute_force',
  'wrong_solution',
  'generators',
  'validator',
];

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function firstLine(text: string, max = 100): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max)}...` : line;
}

function firstLines(text: string, count: number): string {
  return text.trim().split('\n').slice(0, count).join('\n');
}

function failed(name: string, digest: string): Checkpoint {
  return { name, ok: false, digest };
}

/** Checks the parts of a plan that {@link checkPlan} trusts. */
function planShapeErrors(plan: unknown): string[] {
  if (typeof plan !== 'object' || plan === null)
    return ['the plan is not an object'];
  const tasks = (plan as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return ['the plan has no task list'];
  const errors: string[] = [];
  tasks.forEach((t: unknown, i) => {
    const task = t as Partial<PlanTask> | null;
    if (
      typeof task !== 'object' ||
      task === null ||
      typeof task.id !== 'string' ||
      typeof task.kind !== 'string' ||
      !Array.isArray(task.dependsOn) ||
      !Array.isArray(task.ownsFiles)
    ) {
      errors.push(`task ${i + 1} needs an id, a kind, dependsOn and ownsFiles`);
    }
  });
  return errors;
}

/** Runs workflows. One instance can run many workflows, one at a time. */
export class WorkflowScheduler {
  private readonly limits: WorkflowLimits;

  constructor(private readonly opts: WorkflowSchedulerOptions) {
    this.limits = { ...WORKFLOW_LIMITS, ...opts.limits };
  }

  /** Plans, asks the user, runs the plan, and emits `workflow_done`. */
  async run(
    spec: Spec,
    recipe: Plan['recipe'],
    signal: AbortSignal
  ): Promise<WorkflowRunResult> {
    let cost = 0;
    const off = this.opts.bus.on(e => {
      if (e.type === 'usage' && typeof e.costUsd === 'number')
        cost += e.costUsd;
    });
    try {
      let out: WorkflowRunResult;
      try {
        out = await this.plannedRun(spec, recipe, signal);
      } catch (error) {
        out = {
          ok: false,
          results: [],
          summary: `workflow error: ${message(error)}`,
        };
      }
      this.opts.bus.emit({
        type: 'workflow_done',
        ok: out.ok,
        summary: out.summary,
        costUsd: cost,
      });
      return out;
    } finally {
      off();
    }
  }

  private async plannedRun(
    spec: Spec,
    recipe: Plan['recipe'],
    signal: AbortSignal
  ): Promise<WorkflowRunResult> {
    const planned = await this.makePlan(spec, recipe, signal);
    if ('error' in planned)
      return { ok: false, results: [], summary: planned.error };
    if (signal.aborted)
      return { ok: false, results: [], summary: 'workflow cancelled' };

    const { plan, notice } = planned;
    this.opts.bus.emit({ type: 'plan_created', plan });

    let decision: ApprovalDecision;
    try {
      decision = await this.opts.permissions.askPlan(plan, signal);
    } catch (error) {
      decision = { kind: 'deny', reason: message(error) };
    }
    if (decision.kind === 'deny') {
      return { ok: false, results: [], summary: 'plan not approved' };
    }

    const run = new PlanRun(this.opts, this.limits, plan, spec, signal);
    if (notice) run.notices.push(notice);
    await run.execute();
    return run.outcome();
  }

  private scriptFile(): Promise<string> {
    return readScriptFile(this.opts.problemDir);
  }

  /**
   * Gets a plan from the manager and checks it. One more try with the
   * errors, then the default skeleton (only for `build_problem`).
   */
  private async makePlan(
    spec: Spec,
    recipe: Plan['recipe'],
    signal: AbortSignal
  ): Promise<{ plan: Plan; notice?: string } | { error: string }> {
    // A fixed shape with nothing to fill in: no model call.
    if (recipe === 'fix_verify') return { plan: fixVerifyPlan() };
    if (recipe === 'prove_idea') return { plan: proveIdeaPlan(spec) };

    const attempt = async (
      text: Spec
    ): Promise<{ plan?: Plan; errors: string[] }> => {
      let plan: Plan;
      try {
        plan = await this.opts.manager.makePlan(text, recipe, signal);
      } catch (error) {
        return { errors: [`the manager failed: ${message(error)}`] };
      }
      const shape = planShapeErrors(plan);
      if (shape.length > 0) return { errors: shape };
      plan = addRecipeDependencies(plan);
      const errors = checkPlan(plan, spec);
      if (plan.recipe !== recipe) {
        errors.unshift(`the plan is for ${plan.recipe}, expected ${recipe}`);
      }
      return { plan, errors };
    };

    const first = await attempt(spec);
    if (first.plan && first.errors.length === 0) return { plan: first.plan };
    if (signal.aborted) return { error: 'workflow cancelled' };

    const retrySpec = `${spec.trimEnd()}\n\n# Plan errors to fix\n${first.errors
      .map(e => `- ${e}`)
      .join('\n')}\n`;
    const second = await attempt(retrySpec);
    if (second.plan && second.errors.length === 0) return { plan: second.plan };
    if (signal.aborted) return { error: 'workflow cancelled' };

    const fallback =
      recipe === 'build_problem'
        ? buildProblemSkeleton(spec)
        : recipe === 'strengthen_tests'
          ? strengthenTestsSkeleton(await this.scriptFile())
          : null;
    if (fallback) {
      return {
        plan: fallback,
        notice: `notice: the manager plan was invalid twice (${firstLine(second.errors[0] ?? '', 80)}), used the default plan`,
      };
    }
    return {
      error: `no valid plan for ${recipe}: ${second.errors.join('; ')}`,
    };
  }
}

/** The generator script file of the first testset, from Config.json. */
async function readScriptFile(problemDir: string): Promise<string> {
  try {
    const config = JSON.parse(
      await fs.readFile(path.join(problemDir, 'Config.json'), 'utf-8')
    ) as { testsets?: { generatorScript?: { scriptFile?: unknown } }[] };
    const file = config.testsets?.[0]?.generatorScript?.scriptFile;
    if (typeof file === 'string' && file !== '') return file;
  } catch {
    // Use the template name.
  }
  return 'generators/gen-script.txt';
}

/** The Config.json files the fix loop needs, best effort. */
export interface ConfigFiles {
  solutions: { name: string; source: string; tag: string }[];
  generators: string[];
  scriptFiles: string[];
}

async function readConfigFiles(problemDir: string): Promise<ConfigFiles> {
  const out: ConfigFiles = { solutions: [], generators: [], scriptFiles: [] };
  try {
    const config = JSON.parse(
      await fs.readFile(path.join(problemDir, 'Config.json'), 'utf-8')
    ) as {
      solutions?: { name?: unknown; source?: unknown; tag?: unknown }[];
      generators?: { source?: unknown }[];
      testsets?: { generatorScript?: { scriptFile?: unknown } }[];
    };
    for (const s of Array.isArray(config.solutions) ? config.solutions : []) {
      if (
        typeof s?.name === 'string' &&
        typeof s.source === 'string' &&
        typeof s.tag === 'string'
      ) {
        out.solutions.push({
          name: s.name,
          source: normalizePath(s.source),
          tag: s.tag,
        });
      }
    }
    for (const g of Array.isArray(config.generators) ? config.generators : []) {
      if (typeof g?.source === 'string') {
        out.generators.push(normalizePath(g.source));
      }
    }
    for (const t of Array.isArray(config.testsets) ? config.testsets : []) {
      const file = t?.generatorScript?.scriptFile;
      if (typeof file === 'string') out.scriptFiles.push(normalizePath(file));
    }
  } catch {
    // No extra files.
  }
  return out;
}

/** Tags of solutions that must pass every test. */
const CORRECT_TAGS = ['MA', 'OK', 'TO'];

/**
 * The files of a fix round. The files the digest names, plus what the
 * verdicts point to:
 * - a correct solution (OK, TO) with a wrong answer: the main solution may
 *   be the wrong one (main-overflow), so the MA source too;
 * - a wrong solution that got no failing verdict: the tests are weak
 *   (weak-tests), so the generators and the generator script too.
 * When the digest names no file, every candidate.
 */
export function fixFilesFor(
  digest: string,
  candidates: string[],
  config: ConfigFiles
): string[] {
  const named = candidates.filter(file => digest.includes(file));
  if (named.length === 0) return candidates;
  const out = new Set(named);
  const line = /^solution (\S+)(?: \(([^)]+)\))? tag ([A-Z]+): (.*)$/;
  for (const text of digest.split('\n')) {
    const m = line.exec(text.trim());
    if (!m) continue;
    const [, , , tag, rest] = m;
    if (CORRECT_TAGS.includes(tag ?? '')) {
      if (/wrong answer|; test \d+: (WA|PE)\b/i.test(rest ?? '')) {
        for (const s of config.solutions) {
          if (s.tag === 'MA') out.add(s.source);
        }
      }
    } else if (/did not get/i.test(rest ?? '')) {
      for (const g of config.generators) out.add(g);
      for (const f of config.scriptFiles) out.add(f);
    }
  }
  return [...out];
}

/**
 * Short hints from the verify digest: which file is the likely cause. The
 * fixer changed a correct brute force with main when it only read "brute
 * got WA", so the hint names main first and says what not to touch.
 */
export function fixHints(digest: string, config: ConfigFiles): string[] {
  const mainHints: string[] = [];
  const weakHints: string[] = [];
  const main = config.solutions.find(s => s.tag === 'MA');
  const line = /^solution (\S+)(?: \(([^)]+)\))? tag ([A-Z]+): (.*)$/;
  for (const text of digest.split('\n')) {
    const m = line.exec(text.trim());
    if (!m) continue;
    const [, name, source, tag, rest] = m;
    const file = source ?? name ?? '';
    if (CORRECT_TAGS.includes(tag ?? '') && tag !== 'MA') {
      if (/wrong answer|; test \d+: (WA|PE)\b/i.test(rest ?? '') && main) {
        mainHints.push(
          `${name} (${tag}) gets a wrong answer against main: first check ${main.source} (overflow, a missed case). Change ${file} only if main is right.`
        );
      }
    } else if (
      !CORRECT_TAGS.includes(tag ?? '') &&
      /did not get/i.test(rest ?? '')
    ) {
      const where = config.scriptFiles[0] ?? 'the generator script';
      weakHints.push(
        `${name} (${tag}) passes every test: the tests are weak. Add a test that breaks it in ${where}. Do not change ${file}${main?.source === file ? '' : ' unless it is the main solution'}.`
      );
    }
  }
  // A wrong solution with the same bug as a wrong main passes too: fixing
  // main may be enough (main-overflow).
  const tail =
    mainHints.length > 0 && weakHints.length > 0
      ? [
          'If main was wrong, the passing wrong solution may have the same bug: fix main first, then see.',
        ]
      : [];
  return [...mainHints, ...weakHints, ...tail];
}

/** The state of one approved plan while it runs. */
class PlanRun {
  readonly notices: string[] = [];
  private readonly states = new Map<string, TaskState>();
  private readonly extraResults: TaskResult[] = [];
  private readonly questions: string[] = [];
  private readonly inFlight = new Map<string, Promise<void>>();
  private workersRunning = 0;
  private redoUsed = false;

  constructor(
    private readonly opts: WorkflowSchedulerOptions,
    private readonly limits: WorkflowLimits,
    private readonly plan: Plan,
    private readonly spec: Spec,
    private readonly signal: AbortSignal
  ) {
    for (const task of plan.tasks) {
      this.states.set(task.id, { task, status: 'pending', gen: 0 });
    }
  }

  /** Runs the DAG until nothing can start and nothing runs. */
  async execute(): Promise<void> {
    for (;;) {
      if (!this.signal.aborted) this.startReady();
      if (this.inFlight.size === 0) break;
      await Promise.race(this.inFlight.values());
    }
    for (const state of this.states.values()) {
      if (state.status === 'pending' || state.status === 'running') {
        this.skip(state, this.signal.aborted ? 'cancelled' : 'never started');
      }
    }
  }

  /** The final results and the summary. */
  outcome(): WorkflowRunResult {
    const results = this.results();
    const planResults = this.plan.tasks.map(t => this.states.get(t.id)?.result);
    const passed = planResults.filter(r => r?.status === 'passed').length;
    const failedIds = planResults
      .filter(r => r?.status === 'failed')
      .map(r => r!.taskId);
    const skippedIds = planResults
      .filter(r => r?.status === 'skipped')
      .map(r => r!.taskId);
    const ok = !this.signal.aborted && passed === this.plan.tasks.length;

    const lines = [
      `${this.plan.recipe}: ${this.signal.aborted ? 'cancelled, ' : ''}${passed} of ${this.plan.tasks.length} tasks passed`,
      failedIds.length > 0
        ? `failed: ${failedIds.join(', ')}`
        : 'no task failed',
      skippedIds.length > 0
        ? `skipped: ${skippedIds.join(', ')}`
        : 'no task skipped',
      ...this.notices,
      ...this.questions,
    ];
    return { ok, results, summary: lines.slice(0, 6).join('\n') };
  }

  private results(): TaskResult[] {
    const list: TaskResult[] = [];
    for (const task of this.plan.tasks) {
      const result = this.states.get(task.id)?.result;
      if (result) list.push(result);
    }
    return [...list, ...this.extraResults];
  }

  private startReady(): void {
    for (const task of this.plan.tasks) {
      const state = this.states.get(task.id)!;
      if (state.status !== 'pending' || this.inFlight.has(task.id)) continue;
      const ready = task.dependsOn.every(
        d => this.states.get(d)?.status === 'passed'
      );
      if (!ready) continue;
      const usesWorker = !isNoModelKind(task.kind);
      if (usesWorker && this.workersRunning >= this.limits.parallel) continue;

      state.status = 'running';
      if (usesWorker) this.workersRunning++;
      const gen = state.gen;
      const note = state.note;
      delete state.note;
      const job = this.runTask(task, note)
        .catch((error: unknown): TaskOutcome => ({
          kind: 'done',
          result: this.result(task, 'failed', 1, {
            checkpoint: failed('task', `task error: ${message(error)}`),
            summary: '',
          }),
        }))
        .then(outcome => this.finish(task.id, gen, outcome))
        .finally(() => {
          if (usesWorker) this.workersRunning--;
          this.inFlight.delete(task.id);
        });
      this.inFlight.set(task.id, job);
    }
  }

  private finish(id: string, gen: number, outcome: TaskOutcome): void {
    const state = this.states.get(id)!;
    // The task was reset by a redo while it ran: drop this result.
    if (state.gen !== gen) return;

    if (outcome.kind === 'redo') {
      const reset = new Set([
        outcome.redoTaskId,
        ...dependentsOf(this.plan.tasks, outcome.redoTaskId),
        id,
      ]);
      for (const resetId of reset) {
        const s = this.states.get(resetId)!;
        s.gen++;
        s.status = 'pending';
        delete s.result;
        delete s.note;
      }
      const hint = `redo asked by the manager: ${outcome.hint}`;
      this.states.get(outcome.redoTaskId)!.note = hint;
      state.note = hint;
      return;
    }

    state.status = outcome.result.status;
    state.result = outcome.result;
    this.opts.bus.emit({
      type: 'task_done',
      taskId: id,
      result: outcome.result,
    });
    if (outcome.result.status !== 'passed') {
      for (const depId of dependentsOf(this.plan.tasks, id)) {
        const dep = this.states.get(depId)!;
        if (dep.status === 'pending') this.skip(dep, `blocked by ${id}`);
      }
    }
  }

  private skip(state: TaskState, why: string): void {
    state.status = 'skipped';
    state.result = {
      taskId: state.task.id,
      status: 'skipped',
      attempts: 0,
      summary: why,
      checkpoint: { name: 'skipped', ok: false, digest: why },
    };
    this.opts.bus.emit({
      type: 'task_done',
      taskId: state.task.id,
      result: state.result,
    });
  }

  private result(
    task: PlanTask,
    status: TaskResult['status'],
    attempts: number,
    attempt: Attempt
  ): TaskResult {
    const summary =
      status === 'passed'
        ? firstLines(
            attempt.summary ||
              attempt.checkpoint.digest ||
              `${task.kind} passed`,
            3
          )
        : `failed after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${firstLine(attempt.checkpoint.digest)}`;
    const result: TaskResult = {
      taskId: task.id,
      status,
      attempts,
      summary,
      checkpoint: attempt.checkpoint,
    };
    if (attempt.configPatch) result.configPatch = attempt.configPatch;
    return result;
  }

  private done(
    task: PlanTask,
    attempts: number,
    attempt: Attempt
  ): TaskOutcome {
    return {
      kind: 'done',
      result: this.result(
        task,
        attempt.checkpoint.ok ? 'passed' : 'failed',
        attempts,
        attempt
      ),
    };
  }

  private runTask(
    task: PlanTask,
    note: string | undefined
  ): Promise<TaskOutcome> {
    if (task.kind === 'verify') return this.runVerify(task);
    if (isNoModelKind(task.kind)) return this.runNoModel(task);
    return this.runWorkerTask(task, note);
  }

  private emitCheckpoint(taskId: string, checkpoint: Checkpoint): void {
    this.opts.bus.emit({
      type: 'task_checkpoint',
      taskId,
      name: checkpoint.name,
      ok: checkpoint.ok,
      digest: checkpoint.digest,
    });
  }

  /** Applies a patch; returns a failed checkpoint when it is refused. */
  private async applyPatch(
    patch: ConfigPatch | undefined
  ): Promise<Checkpoint | null> {
    if (!patch) return null;
    const applied = await applyConfigPatch(this.opts.problemDir, patch);
    return applied.ok
      ? null
      : failed('config patch', `Config.json patch refused: ${applied.error}`);
  }

  /** One worker attempt: the worker, its config patch, the checkpoint. */
  private async workerAttempt(
    task: PlanTask,
    attempt: number,
    fresh: boolean,
    note: string | undefined
  ): Promise<Attempt> {
    this.opts.bus.emit({ type: 'task_started', taskId: task.id, attempt });
    const out = await this.workerAttemptInner(task, attempt, fresh, note);
    this.emitCheckpoint(task.id, out.checkpoint);
    return out;
  }

  private async workerAttemptInner(
    task: PlanTask,
    attempt: number,
    fresh: boolean,
    note: string | undefined
  ): Promise<Attempt> {
    let outcome: WorkerOutcome;
    try {
      outcome = await this.opts.worker.run(
        {
          task,
          spec: this.spec,
          attempt,
          fresh,
          ...(note !== undefined ? { note } : {}),
        },
        this.signal
      );
    } catch (error) {
      const digest = this.signal.aborted
        ? 'cancelled'
        : `worker error: ${message(error)}`;
      return { checkpoint: failed('worker', digest), summary: '' };
    }
    const refused = await this.applyPatch(outcome.configPatch);
    if (refused) return { checkpoint: refused, summary: outcome.summary };

    let checkpoint: Checkpoint;
    try {
      checkpoint = await this.opts.checkpoints.check(
        task,
        this.spec,
        this.opts.problemDir,
        this.signal
      );
    } catch (error) {
      checkpoint = failed('checkpoint', `checkpoint error: ${message(error)}`);
    }
    const out: Attempt = { checkpoint, summary: outcome.summary };
    if (outcome.configPatch) out.configPatch = outcome.configPatch;
    return out;
  }

  /** One run of a task that needs no model. */
  private async noModelAttempt(
    task: PlanTask,
    attempt: number
  ): Promise<Attempt> {
    this.opts.bus.emit({ type: 'task_started', taskId: task.id, attempt });
    let out: Attempt;
    try {
      const res = await this.opts.checkpoints.runNoModelTask(
        task,
        this.spec,
        this.opts.problemDir,
        this.signal
      );
      const refused = res.checkpoint.ok
        ? await this.applyPatch(res.configPatch)
        : null;
      out = { checkpoint: refused ?? res.checkpoint, summary: '' };
      if (res.configPatch && !refused) out.configPatch = res.configPatch;
    } catch (error) {
      out = {
        checkpoint: failed(task.kind, `${task.kind} error: ${message(error)}`),
        summary: '',
      };
    }
    this.emitCheckpoint(task.id, out.checkpoint);
    return out;
  }

  /**
   * The retry ladder: attempt 2 continues with the digest, attempt 3 is a
   * fresh worker with a short note of both failures, then the manager.
   */
  private async runWorkerTask(
    task: PlanTask,
    firstNote: string | undefined
  ): Promise<TaskOutcome> {
    const a1 = await this.workerAttempt(task, 1, true, firstNote);
    if (a1.checkpoint.ok || this.signal.aborted) return this.done(task, 1, a1);

    const a2 = await this.workerAttempt(task, 2, false, a1.checkpoint.digest);
    if (a2.checkpoint.ok || this.signal.aborted) return this.done(task, 2, a2);

    const note = [
      'Two tries failed before. Start again from the spec.',
      `try 1: ${firstLine(a1.checkpoint.digest, 200)}`,
      `try 2: ${firstLine(a2.checkpoint.digest, 200)}`,
    ].join('\n');
    const a3 = await this.workerAttempt(task, 3, true, note);
    if (a3.checkpoint.ok || this.signal.aborted) return this.done(task, 3, a3);

    return this.escalate(task, 3, a3, (n, hint) =>
      this.workerAttempt(task, n, true, hint)
    );
  }

  /**
   * A deterministic task: no retry ladder, the manager decides at once. A
   * failed prove check is the answer of the proof, so it just ends.
   */
  private async runNoModel(task: PlanTask): Promise<TaskOutcome> {
    const a1 = await this.noModelAttempt(task, 1);
    if (a1.checkpoint.ok || this.signal.aborted || isProveCheck(task.kind))
      return this.done(task, 1, a1);
    return this.escalate(task, 1, a1, n => this.noModelAttempt(task, n));
  }

  /** Asks the manager what to do with a task that keeps failing. */
  private async escalate(
    task: PlanTask,
    attempts: number,
    last: Attempt,
    retry: (attempt: number, hint: string) => Promise<Attempt>
  ): Promise<TaskOutcome> {
    const failedResult = this.result(task, 'failed', attempts, last);
    let decision: ManagerDecision;
    try {
      decision = await this.opts.manager.decide(
        {
          spec: this.spec,
          plan: this.plan,
          failed: failedResult,
          results: this.results(),
        },
        this.signal
      );
    } catch (error) {
      if (this.signal.aborted) return { kind: 'done', result: failedResult };
      decision = {
        action: 'ask_user',
        taskId: task.id,
        question: `${task.title} failed ${attempts} times and the manager could not decide (${message(error)}). What should I change?`,
      };
    }

    if (decision.action === 'redo_task') {
      const valid =
        !this.redoUsed &&
        decision.redoTaskId !== task.id &&
        this.states.has(decision.redoTaskId);
      if (valid) {
        this.redoUsed = true;
        this.notices.push(
          `redo: ${decision.redoTaskId} again because ${task.id} failed`
        );
        return {
          kind: 'redo',
          redoTaskId: decision.redoTaskId,
          hint: decision.hint,
        };
      }
      decision = {
        action: 'retry_with_hint',
        taskId: task.id,
        hint: decision.hint,
      };
    }

    if (decision.action === 'retry_with_hint') {
      if (this.signal.aborted) return { kind: 'done', result: failedResult };
      const next = await retry(attempts + 1, decision.hint);
      return this.done(task, attempts + 1, next);
    }

    this.questions.push(
      `question (${task.id}): ${firstLine(decision.question, 200)}`
    );
    return { kind: 'done', result: failedResult };
  }

  /** Verify, and when it fails, up to `fixRounds` rounds of fix + verify. */
  private async runVerify(task: PlanTask): Promise<TaskOutcome> {
    let attempt = 1;
    let last = await this.noModelAttempt(task, attempt);
    if (last.checkpoint.ok || this.signal.aborted)
      return this.done(task, attempt, last);

    const fixTask: PlanTask = {
      id: `${task.id}-fix`,
      kind: 'fix',
      title: 'Fix verify',
      dependsOn: [task.id],
      brief: 'verify failed. Fix the files named in the note, only those.',
      ownsFiles: [],
    };
    let fix: Attempt | null = null;
    for (let round = 1; round <= this.limits.fixRounds; round++) {
      if (this.signal.aborted) break;
      fixTask.ownsFiles = await this.fixFiles(last.checkpoint.digest);
      const hints = fixHints(
        last.checkpoint.digest,
        await readConfigFiles(this.opts.problemDir)
      );
      fixTask.brief = [
        `verify failed (round ${round} of ${this.limits.fixRounds}). Fix it by changing only your files.`,
        last.checkpoint.digest,
        ...(hints.length > 0 ? ['Hints:', ...hints.map(h => `- ${h}`)] : []),
      ].join('\n');
      fix = await this.workerAttempt(
        { ...fixTask },
        round,
        round === 1,
        last.checkpoint.digest
      );
      if (this.signal.aborted) break;
      attempt++;
      last = await this.noModelAttempt(task, attempt);
      if (last.checkpoint.ok) break;
    }

    if (fix) {
      const rounds = attempt - 1;
      const fixResult = this.result(
        fixTask,
        last.checkpoint.ok ? 'passed' : 'failed',
        rounds,
        {
          ...fix,
          checkpoint: last.checkpoint.ok
            ? fix.checkpoint
            : { ...fix.checkpoint, ok: false },
        }
      );
      this.extraResults.push(fixResult);
      this.opts.bus.emit({
        type: 'task_done',
        taskId: fixTask.id,
        result: fixResult,
      });
    }
    if (!last.checkpoint.ok && !this.signal.aborted) {
      this.notices.push(`verify still fails after ${attempt - 1} fix rounds`);
    }
    return this.done(task, attempt, last);
  }

  /**
   * The files the fixer may change: the ones the verify digest names, or
   * every solution, generator and validator file when it names none.
   * See {@link fixFilesFor} for the extra files a verdict points to.
   */
  private async fixFiles(digest: string): Promise<string[]> {
    const candidates = new Set<string>();
    for (const task of this.plan.tasks) {
      if (FIXABLE_KINDS.includes(task.kind)) {
        for (const file of task.ownsFiles) candidates.add(normalizePath(file));
      }
    }
    const config = await readConfigFiles(this.opts.problemDir);
    for (const file of await this.configSources()) candidates.add(file);
    return fixFilesFor(digest, [...candidates], config);
  }

  /** Solution, generator and validator sources from Config.json. */
  private async configSources(): Promise<string[]> {
    try {
      const config = JSON.parse(
        await fs.readFile(
          path.join(this.opts.problemDir, 'Config.json'),
          'utf-8'
        )
      ) as {
        solutions?: { source?: unknown }[];
        generators?: { source?: unknown }[];
        validator?: { source?: unknown };
      };
      const items = [
        ...(Array.isArray(config.solutions) ? config.solutions : []),
        ...(Array.isArray(config.generators) ? config.generators : []),
        ...(config.validator ? [config.validator] : []),
      ];
      return items
        .map(item => item?.source)
        .filter((s): s is string => typeof s === 'string' && s.length > 0)
        .map(normalizePath);
    } catch {
      return [];
    }
  }
}
