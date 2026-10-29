/**
 * The model worker: runs one task as a small agent session with its own
 * prompt, tools, sandbox and budget, then stops.
 *
 * The session, registry, sandbox and gate come from factories, so this file
 * only depends on their contracts. The wiring (W0b) passes the real classes:
 * `AgentSession`, `DefaultToolRegistry`, `FolderSandbox` and
 * `DefaultPermissionGate`.
 */

import { isAbsolute, relative } from 'path';
import type { AgentEvent, EventBus, SeqEvent } from '../core/events';
import type { AgentSessionApi, AgentSessionDeps } from '../core/session-types';
import type { Provider } from '../providers/types';
import type { CliRunner } from '../runner/types';
import { skillTools } from '../skills';
import type {
  PermissionGate,
  PermissionMode,
  Sandbox,
  Tool,
  ToolOutput,
  ToolRegistry,
} from '../tools/types';
import { applyConfigPatch } from './config-patch';
import { workerPrompt } from './prompts';
import {
  WORKFLOW_LIMITS,
  type Checkpoint,
  type Checkpoints,
  type ConfigPatch,
  type PlanTask,
  type Spec,
  type TaskKind,
  type Worker,
  type WorkerOutcome,
} from './types';

/** Context budget of a worker, in tokens (doc 10, Budgets). */
export const WORKER_CONTEXT_TOKENS = 16000;

/** The summary when a worker used all its steps. */
export const STEP_LIMIT_SUMMARY =
  'stopped at the step limit without finish_task';

/**
 * Failed checks a worker may get from `finish_task` in one run. After that
 * `finish_task` ends the task anyway and the scheduler's retry ladder takes
 * over, so a confused worker does not use all its steps on one error.
 */
export const MAX_PRECHECKS = 3;

/** Time limit of `finish_task`, which may run the check. */
export const FINISH_TIMEOUT_MS = 6 * 60 * 1000;

/**
 * Runs the task's real check when the worker calls `finish_task`, before the
 * task ends. It gets the worker's patch, so the check sees the files the
 * worker wrote and the Config.json entries it asked for.
 */
export type WorkerPrecheck = (
  input: { task: PlanTask; spec: Spec; configPatch?: ConfigPatch },
  signal: AbortSignal
) => Promise<Checkpoint>;

/**
 * The usual {@link WorkerPrecheck}: applies the patch (the same queue the
 * scheduler uses, so it never races another writer), then runs the
 * checkpoint of the task. The scheduler applies the same patch again at the
 * end of the task; applying a patch twice gives the same Config.json.
 */
export function checkpointPrecheck(
  checkpoints: Checkpoints,
  problemDir: string
): WorkerPrecheck {
  return async ({ task, spec, configPatch }, signal) => {
    if (configPatch) {
      const applied = await applyConfigPatch(problemDir, configPatch);
      if (!applied.ok) {
        return {
          name: 'config patch',
          ok: false,
          digest: `Config.json patch refused: ${applied.error}`,
        };
      }
    }
    return checkpoints.check(task, spec, problemDir, signal);
  };
}

/** What the worker needs. The factories let W0b pass the real classes. */
export interface ModelWorkerOptions {
  provider: Provider;
  model: string;
  /** The problem folder. Every worker works inside it. */
  problemDir: string;
  runner: CliRunner;
  /**
   * The workflow bus. Gets the workers' `usage` events, and their tool events
   * (`tool_call`, `tool_progress`, `tool_result`) tagged with the task id.
   */
  bus: EventBus;
  /**
   * The tools a worker may get, usually `[...fsTools(), ...cliTools()]`.
   * Each task gets only the ones its kind needs. `load_skill` is added from
   * `skillTools()` when it is not in the list.
   */
  tools: Tool[];
  /** Makes a session, `new AgentSession(deps)`. */
  createSession(deps: AgentSessionDeps): AgentSessionApi;
  /** Makes a registry, `new DefaultToolRegistry({ permissions })`. */
  createRegistry(permissions: PermissionGate): ToolRegistry;
  /** Makes a sandbox, `new FolderSandbox(root, { allowWrite })`. */
  createSandbox(root: string, allowWrite: string[]): Sandbox;
  /** Makes a gate, `new DefaultPermissionGate(bus, mode)`. */
  createGate(bus: EventBus, mode: PermissionMode): PermissionGate;
  /** Keys to redact from errors. */
  secrets?(): string[];
  /** Upper bound on generated tokens per call, 8000 by default. */
  maxOutputTokens?: number;
  /**
   * Context budget of a worker, {@link WORKER_CONTEXT_TOKENS} by default.
   * The chat gives a smaller one for a model with a small window.
   */
  contextBudgetTokens?: number;
  /** Sampling temperature, 0.3 by default. */
  temperature?: number;
  /**
   * Checks the task when the worker calls `finish_task`. A failed check is
   * sent back to the worker as the tool result and the task goes on. Without
   * it, `finish_task` always ends the task.
   */
  precheck?: WorkerPrecheck;
}

/** Kinds that write files. */
const WRITING_KINDS: ReadonlySet<TaskKind> = new Set<TaskKind>([
  'statement',
  'main_solution',
  'brute_force',
  'wrong_solution',
  'validator',
  'generators',
  'fix',
  'proto_brute',
  'proto_main',
  'proto_gen',
  'proto_wrong',
]);

/** Kinds that get the bigger step budget. */
const HARD_KINDS: ReadonlySet<TaskKind> = new Set<TaskKind>([
  'main_solution',
  'validator',
  'fix',
  'proto_main',
]);

/** The tool names a worker of this kind gets, in order. */
export function workerToolNames(kind: TaskKind): string[] {
  const names = ['read_file', 'list_files', 'load_skill'];
  if (WRITING_KINDS.has(kind)) names.push('write_file', 'edit_file');
  // No run_solution, test_target or generate: they read Config.json, which
  // gets the worker's entries only after finish_task, so before that they
  // run the wrong files or fail. finish_task runs the real check instead.
  if (kind === 'fix') names.push('verify');
  if (kind === 'statement_critic') names.push('review');
  names.push('finish_task');
  return names;
}

/** Model calls a worker of this kind may make. */
export function workerMaxSteps(kind: TaskKind): number {
  return HARD_KINDS.has(kind)
    ? WORKFLOW_LIMITS.workerStepsHard
    : WORKFLOW_LIMITS.workerStepsSimple;
}

/** The first user message of a fresh worker session. */
export function workerFirstMessage(
  task: PlanTask,
  spec: Spec,
  note?: string
): string {
  const lines = [
    'The spec:',
    spec.trim(),
    '',
    `Your task: ${task.id}, ${task.kind}: ${task.title}`,
    task.brief.trim(),
    `Files you own: ${task.ownsFiles.length > 0 ? task.ownsFiles.join(', ') : 'none'}`,
  ];
  const params = Object.entries(task.params ?? {});
  if (params.length > 0) {
    lines.push('Params:', ...params.map(([k, v]) => `- ${k}: ${v}`));
  }
  if (note) lines.push('', `Last attempt failed: ${note}`);
  lines.push('', 'Start now. Call finish_task when done.');
  return lines.join('\n');
}

const SOLUTION_TAGS = ['MA', 'OK', 'TO', 'WA', 'TL', 'ML', 'RE', 'PE', 'RJ'];

const fileEntry = (what: string): Record<string, unknown> => ({
  type: 'object',
  properties: {
    name: { type: 'string', description: `The ${what} name.` },
    source: {
      type: 'string',
      description: 'The file, like "./generators/gen-random.cpp".',
    },
  },
  required: ['name', 'source'],
});

/**
 * The JSON schema of `finish_task`'s `configPatch` for a task kind, so the
 * model sees the exact shape (a plain `object` made it guess). Only the
 * fields of that kind. Fields polyman can fill itself (the testset) are
 * optional.
 */
export function configPatchSchema(kind: TaskKind): Record<string, unknown> {
  const base = (
    properties: Record<string, unknown>,
    required: string[]
  ): Record<string, unknown> => ({
    type: 'object',
    description: 'The Config.json change of your task.',
    properties,
    required,
  });
  switch (kind) {
    case 'main_solution':
    case 'brute_force':
    case 'wrong_solution':
      return base(
        {
          addSolutions: {
            type: 'array',
            description: 'Your solution, one entry.',
            items: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'The file name without .cpp, like "wa-1".',
                },
                source: {
                  type: 'string',
                  description: 'Like "./solutions/wa-1.cpp".',
                },
                tag: { type: 'string', enum: SOLUTION_TAGS },
              },
              required: ['name', 'source', 'tag'],
            },
          },
        },
        ['addSolutions']
      );
    case 'validator':
      return base(
        {
          validator: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Use "validator".' },
              source: { type: 'string', description: '"./validator/val.cpp".' },
              testsFilePath: {
                type: 'string',
                description: '"./validator/validator_tests.json".',
              },
            },
            required: ['name', 'source', 'testsFilePath'],
          },
        },
        ['validator']
      );
    case 'generators':
      return base(
        {
          generators: {
            type: 'array',
            description:
              'Every generator the script uses, same names as in the script.',
            items: fileEntry('generator'),
          },
          generatorScript: {
            type: 'object',
            properties: {
              testset: {
                type: 'string',
                description: 'The testset, "tests".',
              },
              scriptFile: {
                type: 'string',
                description: '"./generators/gen-script.txt".',
              },
            },
            required: ['scriptFile'],
          },
        },
        ['generators', 'generatorScript']
      );
    case 'statement':
      return base(
        {
          statements: {
            type: 'object',
            description:
              'By language, like { "english": { "encoding": "UTF-8", "name": "<title>", "legend": "./statements/english/legend.tex", "input": "...", "output": "...", "notes": "..." } }.',
          },
        },
        ['statements']
      );
    default:
      return {
        type: 'object',
        description: 'The Config.json change, if your task has one.',
      };
  }
}

/** Kinds whose `finish_task` must carry a configPatch. */
const PATCH_KINDS: ReadonlySet<TaskKind> = new Set<TaskKind>([
  'main_solution',
  'brute_force',
  'wrong_solution',
  'validator',
  'generators',
  'statement',
]);

/** What one `run` collects from the session. */
interface RunState {
  finish?: { summary: string; configPatch?: ConfigPatch };
  /** The patch of the last `finish_task` whose check failed. */
  lastPatch?: ConfigPatch;
  /** Failed checks from `finish_task` in this run. */
  prechecksFailed: number;
  cancelRequested: boolean;
  calls: Map<string, { name: string; args: unknown }>;
  filesWritten: string[];
  error?: string;
}

/** One session of one task, kept across attempts. */
interface TaskSession {
  session: AgentSessionApi;
  state: RunState;
  task: PlanTask;
  spec: Spec;
}

function newState(): RunState {
  return {
    cancelRequested: false,
    calls: new Map(),
    filesWritten: [],
    prechecksFailed: 0,
  };
}

/** A worker backed by one model, the chat model by default. */
export class ModelWorker implements Worker {
  private readonly opts: ModelWorkerOptions;
  private readonly sessions = new Map<string, TaskSession>();

  constructor(opts: ModelWorkerOptions) {
    this.opts = opts;
  }

  async run(
    input: {
      task: PlanTask;
      spec: Spec;
      attempt: number;
      note?: string;
      fresh: boolean;
    },
    signal: AbortSignal
  ): Promise<WorkerOutcome> {
    signal.throwIfAborted();
    const { task, spec, note, fresh } = input;
    let entry = this.sessions.get(task.id);
    const isNew = fresh || entry === undefined;
    if (isNew || entry === undefined) {
      entry = this.makeTaskSession(task, spec);
      this.sessions.set(task.id, entry);
    }
    const current = entry;
    current.state = newState();
    current.task = task;
    current.spec = spec;

    const text = isNew
      ? workerFirstMessage(task, spec, note)
      : `${note ? `Last attempt failed: ${note}` : 'The last attempt failed.'}\nFix it, then call finish_task.`;

    const onAbort = (): void => current.session.cancel();
    signal.addEventListener('abort', onAbort, { once: true });
    let reason: Awaited<ReturnType<AgentSessionApi['send']>>;
    try {
      reason = await current.session.send(text);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }

    const st = current.state;
    const filesWritten = [...st.filesWritten];
    if (st.finish) {
      const out: WorkerOutcome = { summary: st.finish.summary, filesWritten };
      if (st.finish.configPatch) out.configPatch = st.finish.configPatch;
      return out;
    }
    signal.throwIfAborted();
    // The worker asked for these Config.json entries but its check failed:
    // keep them, so the scheduler's check sees the same state.
    const kept: Pick<WorkerOutcome, 'configPatch'> = st.lastPatch
      ? { configPatch: st.lastPatch }
      : {};
    switch (reason) {
      case 'max_steps':
        return { summary: STEP_LIMIT_SUMMARY, filesWritten, ...kept };
      case 'error':
        return {
          summary: `the worker stopped on an error: ${st.error ?? 'unknown error'}`,
          filesWritten,
          ...kept,
        };
      case 'cancelled':
        return { summary: 'the worker was cancelled', filesWritten, ...kept };
      case 'done':
        return {
          summary: `ended without finish_task: ${lastText(current.session) || 'no answer'}`,
          filesWritten,
          ...kept,
        };
    }
  }

  /** Builds a new session with the tools, sandbox and gate of this task. */
  private makeTaskSession(task: PlanTask, spec: Spec): TaskSession {
    const o = this.opts;
    const localBus = new LocalBus();
    const gate = o.createGate(localBus, 'plan-approved');
    const registry = o.createRegistry(gate);
    const sandbox = o.createSandbox(o.problemDir, [...task.ownsFiles]);

    const entry: TaskSession = {
      session: undefined as unknown as AgentSessionApi,
      state: newState(),
      task,
      spec,
    };
    for (const tool of this.toolsFor(task.kind, entry)) registry.register(tool);

    localBus.on(e => this.onSessionEvent(e, entry, task.id));

    const deps: AgentSessionDeps = {
      provider: o.provider,
      model: o.model,
      tools: registry,
      permissions: gate,
      bus: localBus,
      buildSystemPrompt: () => Promise.resolve(workerPrompt(task.kind)),
      makeToolContext: signal => ({
        problemDir: o.problemDir,
        signal,
        runner: o.runner,
        sandbox,
        progress: () => {},
        setProblemDir: () => {},
      }),
      secrets: () => o.secrets?.() ?? [],
      maxSteps: workerMaxSteps(task.kind),
      contextBudgetTokens: o.contextBudgetTokens ?? WORKER_CONTEXT_TOKENS,
      maxOutputTokens: o.maxOutputTokens ?? 8000,
      temperature: o.temperature ?? 0.3,
    };
    entry.session = o.createSession(deps);
    return entry;
  }

  /** The tools of a kind: from the pool, plus `finish_task` and `review`. */
  private toolsFor(kind: TaskKind, entry: TaskSession): Tool[] {
    const pool = new Map<string, Tool>();
    for (const t of skillTools()) pool.set(t.name, t);
    for (const t of this.opts.tools) pool.set(t.name, t);
    pool.set('finish_task', finishTaskTool(entry, this.opts.precheck));
    pool.set('review', reviewTool(entry));
    const out: Tool[] = [];
    for (const name of workerToolNames(kind)) {
      const t = pool.get(name);
      if (t) out.push(t);
    }
    return out;
  }

  /**
   * Reads the session's events: usage, tool events (sent on with the task
   * id), written files, the end of a task.
   */
  private onSessionEvent(
    e: SeqEvent,
    entry: TaskSession,
    taskId: string
  ): void {
    const st = entry.state;
    if (
      e.type === 'tool_call' ||
      e.type === 'tool_progress' ||
      e.type === 'tool_result'
    ) {
      const event: AgentEvent & { seq?: number } = { ...e, taskId };
      delete event.seq;
      this.opts.bus.emit(event);
    }
    switch (e.type) {
      case 'usage': {
        const usage: Extract<AgentEvent, { type: 'usage' }> = {
          type: 'usage',
          inputTokens: e.inputTokens,
          outputTokens: e.outputTokens,
        };
        if (e.costUsd !== undefined) usage.costUsd = e.costUsd;
        this.opts.bus.emit(usage);
        return;
      }
      case 'tool_call':
        st.calls.set(e.callId, { name: e.name, args: e.args });
        return;
      case 'tool_result': {
        const call = st.calls.get(e.callId);
        if (
          call &&
          e.ok &&
          (call.name === 'write_file' || call.name === 'edit_file')
        ) {
          const p = this.cleanPath(call.args);
          if (p && !st.filesWritten.includes(p)) st.filesWritten.push(p);
        }
        // The task is over: stop the session after this tool result.
        if (st.finish && !st.cancelRequested) {
          st.cancelRequested = true;
          entry.session.cancel();
        }
        return;
      }
      case 'turn_end':
        if (e.error !== undefined) st.error = e.error;
        return;
      default:
        // Text, reasoning and the other events stay inside the worker: the
        // UI shows tasks and their tool calls, not worker text.
        return;
    }
  }

  private cleanPath(args: unknown): string | null {
    if (typeof args !== 'object' || args === null) return null;
    const p = (args as Record<string, unknown>)['path'];
    if (typeof p !== 'string' || p === '') return null;
    const rel = isAbsolute(p) ? relative(this.opts.problemDir, p) : p;
    return rel.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  }
}

/**
 * `finish_task`: runs the precheck (when there is one), then stores the
 * summary and the patch and the task stops. A failed precheck goes back to
 * the worker as an error, up to {@link MAX_PRECHECKS} times per run.
 */
function finishTaskTool(
  entry: TaskSession,
  precheck: WorkerPrecheck | undefined
): Tool {
  const tool: Tool<{ summary: string; configPatch?: ConfigPatch }> = {
    name: 'finish_task',
    description:
      'Call this when your files are written. polyman applies your configPatch and runs the real check of your task. If the check passes, the task ends. If it fails, you get the error: fix your files and call finish_task again. summary: 1 to 3 lines of what you did. configPatch: the Config.json change, if your task has one.',
    parameters: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: '1 to 3 lines.' },
        configPatch: configPatchSchema(entry.task.kind),
      },
      required: PATCH_KINDS.has(entry.task.kind)
        ? ['summary', 'configPatch']
        : ['summary'],
      additionalProperties: false,
    },
    risk: 'read',
    needsProblem: false,
    // The check may run `polyman generate --all` (5 minutes at most).
    timeoutMs: FINISH_TIMEOUT_MS,
    describe: () => ({ title: 'Finish the task' }),
    async run(args, ctx): Promise<ToolOutput> {
      const finish: RunState['finish'] = {
        summary: String(args.summary ?? '').trim() || 'done',
      };
      const patch: unknown = args.configPatch;
      if (
        typeof patch === 'object' &&
        patch !== null &&
        !Array.isArray(patch)
      ) {
        finish.configPatch = patch;
      }
      const st = entry.state;
      if (precheck && st.prechecksFailed < MAX_PRECHECKS) {
        const input: Parameters<WorkerPrecheck>[0] = {
          task: entry.task,
          spec: entry.spec,
        };
        if (finish.configPatch) input.configPatch = finish.configPatch;
        let check: Checkpoint;
        try {
          check = await precheck(input, ctx.signal);
        } catch (error) {
          check = {
            name: 'check',
            ok: false,
            digest: `the check could not run: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
        if (!check.ok) {
          st.prechecksFailed++;
          if (finish.configPatch) st.lastPatch = finish.configPatch;
          const left = MAX_PRECHECKS - st.prechecksFailed;
          return {
            content: [
              `The check "${check.name}" failed, the task is not done:`,
              check.digest.trim() || '(no details)',
              left > 0
                ? 'Read the error, fix your files, then call finish_task again.'
                : 'This was the last check in this try: call finish_task once more to end it.',
            ].join('\n'),
            isError: true,
          };
        }
      }
      st.finish = finish;
      return { content: 'Task finished. Stop now.' };
    },
  };
  return tool;
}

/** `review` (critic only): the review is the outcome of the task. */
function reviewTool(entry: TaskSession): Tool {
  const tool: Tool<{ ok: boolean; issues: string[] }> = {
    name: 'review',
    description:
      'Give your review of the statement. ok: true only when there is no issue. issues: short lines. It ends the task.',
    parameters: {
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        issues: { type: 'array', items: { type: 'string' } },
      },
      required: ['ok', 'issues'],
      additionalProperties: false,
    },
    risk: 'read',
    needsProblem: true,
    describe: () => ({ title: 'Review the statement' }),
    run(args): Promise<ToolOutput> {
      const issues = Array.isArray(args.issues)
        ? args.issues.filter(i => typeof i === 'string' && i.trim() !== '')
        : [];
      const ok = args.ok === true && issues.length === 0;
      entry.state.finish = {
        summary: ok
          ? 'review ok: the statement matches the spec'
          : `review found ${issues.length} issue(s): ${issues.join('; ') || 'not ok'}`,
      };
      return Promise.resolve({ content: 'Review saved. Stop now.' });
    },
  };
  return tool;
}

/** The first line of the last assistant text in the session. */
function lastText(session: AgentSessionApi): string {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const m = session.messages[i];
    if (!m || m.role !== 'assistant') continue;
    for (const p of m.parts) {
      if (p.type === 'text' && p.text.trim() !== '') {
        return (p.text.trim().split(/\r?\n/)[0] ?? '').slice(0, 200);
      }
    }
  }
  return '';
}

/** A small bus for one worker session. Its events stay in the worker. */
class LocalBus implements EventBus {
  private seq = 0;
  private readonly listeners = new Set<(e: SeqEvent) => void>();

  emit(e: AgentEvent): void {
    this.seq += 1;
    const ev = { ...e, seq: this.seq };
    for (const fn of [...this.listeners]) {
      try {
        fn(ev);
      } catch {
        // One listener must not stop the others.
      }
    }
  }

  on(fn: (e: SeqEvent) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}
