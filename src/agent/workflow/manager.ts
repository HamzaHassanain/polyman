/**
 * The model manager: fills a recipe into a plan (`submit_plan`) and decides
 * what to do when a task failed 3 times (`decide`). It does not use a
 * session: each call is a few plain model calls with one tool.
 *
 * The manager never checks the plan. The scheduler does (W6).
 */

import { randomUUID } from 'crypto';
import type { EventBus } from '../core/events';
import type { ContentPart, Message } from '../core/messages';
import type { ChatRequest, Provider, ToolSpec } from '../providers/types';
import {
  managerDecidePrompt,
  managerPlanPrompt,
  recipeDescription,
  TASK_KINDS,
  wrongSolutionList,
} from './prompts';
import type {
  Manager,
  ManagerDecision,
  Plan,
  PlanTask,
  Spec,
  TaskKind,
  TaskResult,
} from './types';

/** Model calls per manager call (doc 10, Budgets). */
export const MANAGER_STEPS = 3;

/** What the manager needs. */
export interface ModelManagerOptions {
  provider: Provider;
  model: string;
  /** Gets the `usage` of every manager call, so the workflow cost is right. */
  bus?: EventBus;
  /** Upper bound on generated tokens per call. */
  maxOutputTokens?: number;
  /** Sampling temperature. */
  temperature?: number;
  /** Reasoning for models that support it (doc 10, rule 10). */
  reasoningEffort?: 'low' | 'medium' | 'high';
}

const RECIPES: Plan['recipe'][] = [
  'build_problem',
  'fix_verify',
  'strengthen_tests',
];

/** The JSON schema of `Plan`, for the `submit_plan` tool. */
export const PLAN_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    recipe: { type: 'string', enum: RECIPES },
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Like t1, t2, t3.' },
          kind: { type: 'string', enum: [...TASK_KINDS] },
          title: { type: 'string', description: 'Short, shown to the user.' },
          dependsOn: {
            type: 'array',
            items: { type: 'string' },
            description: 'Ids of the tasks that must pass first.',
          },
          brief: {
            type: 'string',
            description: '1 to 5 lines for the worker.',
          },
          ownsFiles: {
            type: 'array',
            items: { type: 'string' },
            description: 'The only files this task may write.',
          },
          params: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Like { "approach": "int overflow", "tag": "WA" }.',
          },
        },
        required: ['id', 'kind', 'title', 'dependsOn', 'brief', 'ownsFiles'],
        additionalProperties: false,
      },
    },
  },
  required: ['recipe', 'tasks'],
  additionalProperties: false,
};

/** The JSON schema of `ManagerDecision`, for the `decide` tool. */
export const DECISION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['retry_with_hint', 'redo_task', 'ask_user'],
    },
    taskId: { type: 'string', description: 'The failed task.' },
    hint: {
      type: 'string',
      description:
        'For retry_with_hint and redo_task: the cause and what to change.',
    },
    redoTaskId: {
      type: 'string',
      description: 'For redo_task: the earlier task to run again.',
    },
    question: {
      type: 'string',
      description: 'For ask_user: one short question.',
    },
  },
  required: ['action', 'taskId'],
  additionalProperties: false,
};

const SUBMIT_PLAN: ToolSpec = {
  name: 'submit_plan',
  description: 'Submit the whole plan. Call it exactly once.',
  parameters: PLAN_SCHEMA,
};

const DECIDE: ToolSpec = {
  name: 'decide',
  description: 'Pick what to do with the failed task. Call it exactly once.',
  parameters: DECISION_SCHEMA,
};

/** A manager backed by one model, the chat model by default. */
export class ModelManager implements Manager {
  private readonly opts: ModelManagerOptions;

  constructor(opts: ModelManagerOptions) {
    this.opts = opts;
  }

  async makePlan(
    spec: Spec,
    recipe: Plan['recipe'],
    signal: AbortSignal
  ): Promise<Plan> {
    const description = recipeDescription(recipe);
    const user = [
      'The spec:',
      spec.trim(),
      '',
      description,
      ...(recipe === 'build_problem' ? ['', wrongSolutionList(spec)] : []),
      '',
      'Call submit_plan now with the whole plan.',
    ].join('\n');
    const plan = await this.callForTool(
      managerPlanPrompt(recipe, description),
      user,
      SUBMIT_PLAN,
      args => parsePlan(args, recipe),
      signal
    );
    if (plan === null) {
      throw new Error(
        `The manager did not call submit_plan with a valid plan after ${MANAGER_STEPS} tries`
      );
    }
    return plan;
  }

  async decide(
    input: {
      spec: Spec;
      plan: Plan;
      failed: TaskResult;
      results: TaskResult[];
    },
    signal: AbortSignal
  ): Promise<ManagerDecision> {
    const { spec, plan, failed, results } = input;
    const kindOf = new Map(plan.tasks.map(t => [t.id, t.kind]));
    const table = results.map(
      r =>
        `| ${r.taskId} | ${kindOf.get(r.taskId) ?? '?'} | ${r.status} | ${firstLine(r.summary)} |`
    );
    const failedTask = plan.tasks.find(t => t.id === failed.taskId);
    const user = [
      'The spec:',
      spec.trim(),
      '',
      'Task results:',
      '| id | kind | status | summary |',
      '| --- | --- | --- | --- |',
      ...table,
      '',
      `Failed task: ${failed.taskId}${failedTask ? ` (${failedTask.kind}: ${failedTask.title})` : ''}, ${failed.attempts} attempts.`,
      `Its last summary: ${firstLine(failed.summary)}`,
      `Checkpoint "${failed.checkpoint.name}" digest:`,
      failed.checkpoint.digest.trim() || '(empty)',
      '',
      'Call decide now.',
    ].join('\n');
    const decision = await this.callForTool(
      managerDecidePrompt(),
      user,
      DECIDE,
      args => parseDecision(args, failed.taskId),
      signal
    );
    if (decision !== null) return decision;
    return {
      action: 'ask_user',
      taskId: failed.taskId,
      question: `The task ${failed.taskId} failed 3 times: ${firstLine(failed.checkpoint.digest) || firstLine(failed.summary)}`,
    };
  }

  /**
   * Asks the model up to {@link MANAGER_STEPS} times until it calls `tool`
   * with arguments that `parse` accepts. `parse` returns the value or an
   * error text for the model. Returns null when every try failed. The idea
   * workflow uses it too, for its one-tool calls.
   */
  async callForTool<T>(
    system: string,
    userText: string,
    tool: ToolSpec,
    parse: (args: unknown) => T | string,
    signal: AbortSignal
  ): Promise<T | null> {
    const messages: Message[] = [
      message('user', [{ type: 'text', text: userText }]),
    ];
    for (let step = 0; step < MANAGER_STEPS; step++) {
      const req: ChatRequest = {
        model: this.opts.model,
        system,
        messages: [...messages],
        tools: [tool],
        maxOutputTokens: this.opts.maxOutputTokens ?? 8000,
        temperature: this.opts.temperature ?? 0.3,
      };
      if (this.opts.reasoningEffort) {
        req.reasoningEffort = this.opts.reasoningEffort;
      }
      const turn = await this.stream(req, signal);
      const parts: ContentPart[] = [];
      if (turn.text) parts.push({ type: 'text', text: turn.text });
      for (const c of turn.calls) {
        parts.push({ type: 'tool_call', id: c.id, name: c.name, args: c.args });
      }
      if (parts.length > 0) messages.push(message('assistant', parts));

      const call = turn.calls.find(c => c.name === tool.name);
      if (!call) {
        // Answer every other call so the conversation stays valid.
        const results: ContentPart[] = turn.calls.map(c => ({
          type: 'tool_result',
          callId: c.id,
          content: `Unknown tool "${c.name}". The only tool is ${tool.name}.`,
          isError: true,
        }));
        if (results.length > 0) messages.push(message('tool', results));
        messages.push(
          message('user', [{ type: 'text', text: `Call ${tool.name} now.` }])
        );
        continue;
      }
      const parsed = call.argsError
        ? `Your arguments were not valid JSON: ${call.argsError}. Call ${tool.name} again with a JSON object.`
        : parse(call.args);
      if (typeof parsed !== 'string') return parsed;
      messages.push(
        message(
          'tool',
          turn.calls.map(c => ({
            type: 'tool_result',
            callId: c.id,
            content: c === call ? parsed : `Only ${tool.name} is allowed.`,
            isError: true,
          }))
        )
      );
    }
    return null;
  }

  /** Runs one model call and collects its text and tool calls. */
  private async stream(
    req: ChatRequest,
    signal: AbortSignal
  ): Promise<{
    text: string;
    calls: { id: string; name: string; args: unknown; argsError?: string }[];
  }> {
    let text = '';
    const calls: {
      id: string;
      name: string;
      args: unknown;
      argsError?: string;
    }[] = [];
    for await (const ev of this.opts.provider.stream(req, signal)) {
      if (ev.type === 'text_delta') text += ev.text;
      else if (ev.type === 'tool_call') {
        const c: (typeof calls)[number] = {
          id: ev.id,
          name: ev.name,
          args: ev.args,
        };
        if (ev.argsError !== undefined) c.argsError = ev.argsError;
        calls.push(c);
      } else if (ev.type === 'usage' && this.opts.bus) {
        const usage: {
          type: 'usage';
          inputTokens: number;
          outputTokens: number;
          costUsd?: number;
        } = {
          type: 'usage',
          inputTokens: ev.inputTokens,
          outputTokens: ev.outputTokens,
        };
        if (ev.costUsd !== undefined) usage.costUsd = ev.costUsd;
        this.opts.bus.emit(usage);
      }
    }
    return { text, calls };
  }
}

/**
 * Turns `submit_plan` arguments into a `Plan`. Only the shape is checked
 * here (so the code after it does not crash); the plan rules are W6's job.
 * Returns an error text for the model when the shape is wrong.
 */
export function parsePlan(
  args: unknown,
  recipe: Plan['recipe']
): Plan | string {
  if (!isObject(args) || !Array.isArray(args['tasks'])) {
    return 'submit_plan needs an object with a "tasks" array.';
  }
  const tasks: PlanTask[] = [];
  const errors: string[] = [];
  args['tasks'].forEach((raw: unknown, i: number) => {
    if (!isObject(raw)) {
      errors.push(`tasks[${i}]: expected an object`);
      return;
    }
    const kind = raw['kind'];
    if (typeof kind !== 'string' || !TASK_KINDS.includes(kind as TaskKind)) {
      errors.push(`tasks[${i}].kind: must be one of ${TASK_KINDS.join(', ')}`);
      return;
    }
    const id =
      typeof raw['id'] === 'string' && raw['id'] ? raw['id'] : `t${i + 1}`;
    const task: PlanTask = {
      id,
      kind: kind as TaskKind,
      title: typeof raw['title'] === 'string' ? raw['title'] : kind,
      dependsOn: stringList(raw['dependsOn']),
      brief: typeof raw['brief'] === 'string' ? raw['brief'] : '',
      ownsFiles: stringList(raw['ownsFiles']),
    };
    const params = raw['params'];
    if (isObject(params)) {
      const clean: Record<string, string> = {};
      for (const [k, v] of Object.entries(params)) {
        if (typeof v === 'string') clean[k] = v;
        else if (typeof v === 'number' || typeof v === 'boolean') {
          clean[k] = String(v);
        }
      }
      task.params = clean;
    }
    tasks.push(task);
  });
  if (errors.length > 0) return errors.join('\n');
  if (tasks.length === 0) return 'submit_plan needs at least one task.';
  const r = args['recipe'];
  return {
    recipe:
      typeof r === 'string' && RECIPES.includes(r as Plan['recipe'])
        ? (r as Plan['recipe'])
        : recipe,
    tasks,
  };
}

/** Turns `decide` arguments into a `ManagerDecision`, or an error text. */
export function parseDecision(
  args: unknown,
  failedTaskId: string
): ManagerDecision | string {
  if (!isObject(args)) return 'decide needs a JSON object.';
  const taskId =
    typeof args['taskId'] === 'string' && args['taskId']
      ? args['taskId']
      : failedTaskId;
  const str = (k: string): string =>
    typeof args[k] === 'string' ? args[k].trim() : '';
  switch (args['action']) {
    case 'retry_with_hint':
      if (!str('hint')) return 'retry_with_hint needs a "hint".';
      return { action: 'retry_with_hint', taskId, hint: str('hint') };
    case 'redo_task':
      if (!str('redoTaskId')) return 'redo_task needs a "redoTaskId".';
      return {
        action: 'redo_task',
        taskId,
        redoTaskId: str('redoTaskId'),
        hint: str('hint'),
      };
    case 'ask_user':
      if (!str('question')) return 'ask_user needs a "question".';
      return { action: 'ask_user', taskId, question: str('question') };
    default:
      return 'action must be one of retry_with_hint, redo_task, ask_user.';
  }
}

function message(role: Message['role'], parts: ContentPart[]): Message {
  return { id: randomUUID(), role, parts, createdAt: new Date().toISOString() };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringList(v: unknown): string[] {
  return Array.isArray(v)
    ? v.filter((x): x is string => typeof x === 'string')
    : [];
}

function firstLine(text: string): string {
  return (text.split(/\r?\n/).find(l => l.trim() !== '') ?? '').trim();
}
