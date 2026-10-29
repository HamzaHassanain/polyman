/**
 * The screen state of the chat, and the reducer that turns agent events into
 * it. No Ink here: this file is pure and tested alone.
 */

import type { ApprovalDecision, SeqEvent } from '../core/events.js';
import type { PermissionMode } from '../tools/types.js';
import type { Checkpoint, Plan, TaskResult } from '../workflow/types.js';

/** A finished line of the transcript. Printed once, never changed. */
export type Item =
  | { kind: 'user'; id: number; text: string }
  | { kind: 'assistant'; id: number; text: string }
  | {
      kind: 'tool';
      id: number;
      callId: string;
      name: string;
      args: string;
      ok: boolean;
      summary: string;
    }
  | {
      kind: 'notice';
      id: number;
      text: string;
      level: 'info' | 'warn' | 'error';
    }
  | {
      /** A finished workflow: the final task tree and the summary. */
      kind: 'workflow';
      id: number;
      plan: Plan;
      tasks: Record<string, TaskView>;
      problem: string | null;
      ok: boolean;
      summary: string;
      costUsd: number;
      elapsedMs: number;
    };

/** A tool that runs now. */
export interface ToolView {
  callId: string;
  name: string;
  /** Short form of the arguments, like `validator/val.cpp`. */
  args: string;
  /** The last progress line, or null before the first one. */
  lastLine: string | null;
  /** What a file write would change, for the approval box. */
  preview?: string;
}

/** A tool approval the user must answer. */
export interface ApprovalView {
  approvalId: string;
  callId: string;
  /** The tool name, for "do not ask again for <tool>". */
  toolName: string;
  title: string;
  command?: string;
  preview?: string;
}

/** One attempt of a task and the checkpoints it ran. */
export interface AttemptView {
  attempt: number;
  checkpoints: Checkpoint[];
}

/** One tool call of a workflow worker. */
export interface TaskToolView {
  callId: string;
  name: string;
  /** Short form of the arguments, like `main`. */
  args: string;
  /** The attempt of the task that made the call. */
  attempt: number;
  /** null while the tool runs. */
  ok: boolean | null;
  /** The first line of the result, or null while the tool runs. */
  summary: string | null;
}

/** Most tool calls kept per task. */
export const MAX_TASK_TOOLS = 20;

/** The state of one workflow task. */
export interface TaskView {
  taskId: string;
  title: string;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  attempt: number;
  /** The last checkpoint of any attempt. */
  checkpoint: Checkpoint | null;
  result: TaskResult | null;
  /** Every attempt so far, oldest first, for the task details (ctrl+o). */
  attempts: AttemptView[];
  /** The last tool calls of the worker, oldest first, at most 20. */
  tools: TaskToolView[];
}

/** The workflow that runs now. */
export interface WorkflowView {
  plan: Plan;
  tasks: Record<string, TaskView>;
  /** `Date.now()` at `plan_created`, for the timer. */
  startedAt: number;
  /** The session cost when the plan was made, to show the workflow cost. */
  costAtStart: number;
  /** The plan approval that is not answered yet, or null. */
  approvalId: string | null;
}

/** Everything the screen shows. */
export interface UiState {
  /** Printed once into the scrollback. */
  finished: Item[];
  /** Redrawn on every change. */
  live: { streamingText: string; reasoning: string; runningTools: ToolView[] };
  approval: ApprovalView | null;
  planApproval: { approvalId: string; plan: Plan } | null;
  workflow: WorkflowView | null;
  status: {
    problem: string | null;
    model: string;
    mode: PermissionMode;
    tokens: number;
    costUsd: number;
    busy: boolean;
  };
  /** The id of the next finished item. */
  nextId: number;
}

/** Things the UI itself adds, next to the agent events. */
export type LocalAction =
  /** The user sent a message. */
  | { type: 'user_message'; text: string }
  /** A line from the UI, like the help text. */
  | { type: 'notice'; text: string; level?: 'info' | 'warn' | 'error' }
  /** The permission mode changed (shift+tab). */
  | { type: 'set_mode'; mode: PermissionMode }
  /** The user answered an approval, hide it before the session confirms. */
  | {
      type: 'approval_answered';
      approvalId: string;
      decision?: ApprovalDecision;
    }
  /** `session.send()` returned, the turn is surely over. */
  | { type: 'turn_settled' };

/** What the reducer accepts. */
export type UiAction = SeqEvent | LocalAction;

/** The state before anything happened. */
export function initialState(info: {
  problem: string | null;
  model: string;
  mode?: PermissionMode;
}): UiState {
  return {
    finished: [],
    live: { streamingText: '', reasoning: '', runningTools: [] },
    approval: null,
    planApproval: null,
    workflow: null,
    status: {
      problem: problemName(info.problem),
      model: info.model,
      mode: info.mode ?? 'ask',
      tokens: 0,
      costUsd: 0,
      busy: false,
    },
    nextId: 1,
  };
}

/** Keys we show first when we make the short form of tool arguments. */
const ARG_KEYS = [
  'path',
  'file',
  'command',
  'name',
  'solution',
  'target',
  'section',
  'title',
  'recipe',
  'query',
];

/** The short form of tool arguments, for `name(short args)`. */
export function shortArgs(args: unknown, max = 50): string {
  let text = '';
  if (typeof args === 'string') {
    text = args;
  } else if (args && typeof args === 'object' && !Array.isArray(args)) {
    const obj = args as Record<string, unknown>;
    const key =
      ARG_KEYS.find(k => typeof obj[k] === 'string') ??
      Object.keys(obj).find(k => typeof obj[k] === 'string');
    if (key !== undefined) {
      text = obj[key] as string;
    } else {
      const first = Object.values(obj)[0];
      if (typeof first === 'number' || typeof first === 'boolean') {
        text = String(first);
      }
    }
  }
  text = text.split('\n')[0] ?? '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Most lines of a file write we keep for the approval preview. */
const PREVIEW_MAX_LINES = 200;

/** `text` as diff lines, each starting with `sign` and a space. */
function diffLines(text: string, sign: '+' | '-'): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\n$/, '')
    .split('\n')
    .slice(0, PREVIEW_MAX_LINES)
    .map(line => `${sign} ${line}`);
}

/**
 * A short diff of a file write, from the tool arguments: the new content of
 * `write_file` as `+` lines, the old and new text of `edit_file` as `-` and
 * `+` lines. The permission gate sends only a title for these tools, so
 * without this the user would approve a write without seeing it.
 */
export function previewOf(args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return undefined;
  }
  const obj = args as Record<string, unknown>;
  if (typeof obj['content'] === 'string') {
    return diffLines(obj['content'], '+').join('\n');
  }
  if (
    typeof obj['old_text'] === 'string' &&
    typeof obj['new_text'] === 'string'
  ) {
    return [
      ...diffLines(obj['old_text'], '-'),
      ...diffLines(obj['new_text'], '+'),
    ].join('\n');
  }
  return undefined;
}

/** The last name of a folder path. */
function baseName(dir: string): string {
  const parts = dir.split(/[\\/]+/).filter(p => p.length > 0);
  return parts[parts.length - 1] ?? dir;
}

/**
 * The problem name we show: the last folder name of `dir`, so a full path
 * like `/home/me/pairs-sum` does not fill the header and the status line.
 */
export function problemName(dir: string | null): string | null {
  return dir === null ? null : baseName(dir);
}

/** Adds items to `finished`, with ids. */
function push(state: UiState, ...items: DistributiveOmit<Item, 'id'>[]) {
  let id = state.nextId;
  const added = items.map(item => ({ ...item, id: id++ }));
  return { finished: [...state.finished, ...added], nextId: id };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** Moves the streamed text into `finished` as an assistant item. */
function flushText(state: UiState): UiState {
  const text = state.live.streamingText.trim();
  const live = { ...state.live, streamingText: '' };
  if (text.length === 0) {
    return { ...state, live };
  }
  return { ...state, live, ...push(state, { kind: 'assistant', text }) };
}

/** The notice for a turn that did not end well. */
function turnEndNotice(
  reason: 'done' | 'cancelled' | 'max_steps' | 'error',
  error?: string
): DistributiveOmit<Item, 'id'> | null {
  switch (reason) {
    case 'cancelled':
      return {
        kind: 'notice',
        level: 'warn',
        text: 'Interrupted by the user.',
      };
    case 'max_steps':
      return {
        kind: 'notice',
        level: 'warn',
        text: 'Stopped at the step limit of this turn. Say "continue" to go on.',
      };
    case 'error':
      return {
        kind: 'notice',
        level: 'error',
        text: `Error: ${error ?? 'the turn failed'}`,
      };
    default:
      return null;
  }
}

/** Updates one task of the workflow, if there is a workflow. */
function updateTask(
  state: UiState,
  taskId: string,
  change: (t: TaskView) => TaskView
): UiState {
  if (!state.workflow) {
    return state;
  }
  const old = state.workflow.tasks[taskId] ?? pendingTask(taskId, taskId);
  return {
    ...state,
    workflow: {
      ...state.workflow,
      tasks: { ...state.workflow.tasks, [taskId]: change(old) },
    },
  };
}

/** A task that did not start yet. */
function pendingTask(taskId: string, title: string): TaskView {
  return {
    taskId,
    title,
    status: 'pending',
    attempt: 0,
    checkpoint: null,
    result: null,
    attempts: [],
    tools: [],
  };
}

/** The task views of a new plan, all pending. */
function tasksOf(plan: Plan): Record<string, TaskView> {
  const tasks: Record<string, TaskView> = {};
  for (const t of plan.tasks) {
    tasks[t.id] = pendingTask(t.id, t.title);
  }
  return tasks;
}

/** A new workflow view for a plan. */
function newWorkflow(
  state: UiState,
  plan: Plan,
  approvalId: string | null
): WorkflowView {
  return {
    plan,
    tasks: tasksOf(plan),
    startedAt: Date.now(),
    costAtStart: state.status.costUsd,
    approvalId,
  };
}

/** Adds a checkpoint to the last attempt (or a first one). */
function addCheckpoint(t: TaskView, cp: Checkpoint): AttemptView[] {
  const last = t.attempts[t.attempts.length - 1];
  if (!last) {
    return [{ attempt: Math.max(t.attempt, 1), checkpoints: [cp] }];
  }
  return [
    ...t.attempts.slice(0, -1),
    { ...last, checkpoints: [...last.checkpoints, cp] },
  ];
}

/** The workflow after the user answered an approval. */
function afterApproval(
  state: UiState,
  approvalId: string,
  decision: ApprovalDecision | undefined
): WorkflowView | null {
  const wf = state.workflow;
  if (!wf || wf.approvalId !== approvalId) return wf;
  // A denied plan never runs: drop it.
  if (decision?.kind === 'deny') return null;
  return { ...wf, approvalId: null };
}

/**
 * The task the details (ctrl+o) open on: the first running task, else the
 * first failed one, else the first task. An index into `plan.tasks`.
 */
export function pickTask(wf: WorkflowView): number {
  const tasks = wf.plan.tasks;
  const running = tasks.findIndex(t => wf.tasks[t.id]?.status === 'running');
  if (running >= 0) return running;
  const failed = tasks.findIndex(t => wf.tasks[t.id]?.status === 'failed');
  return failed >= 0 ? failed : 0;
}

/**
 * What the task tree shows for a task. `retrying` is a running task whose
 * last checkpoint in this attempt failed: it waits for the next attempt.
 */
export function shownStatus(t: TaskView): TaskView['status'] | 'retrying' {
  if (t.status !== 'running') return t.status;
  const last = t.attempts[t.attempts.length - 1];
  const cp = last?.checkpoints[last.checkpoints.length - 1];
  return cp && !cp.ok ? 'retrying' : 'running';
}

/** The first line of a text, cut to `max` columns. */
function oneLine(text: string, max = 200): string {
  const line = text.trim().split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Changes one tool call of a task. */
function updateTaskTool(
  state: UiState,
  taskId: string,
  callId: string,
  change: (c: TaskToolView) => TaskToolView
): UiState {
  return updateTask(state, taskId, t => ({
    ...t,
    tools: t.tools.map(c => (c.callId === callId ? change(c) : c)),
  }));
}

/**
 * A tool event of a workflow worker: it goes to its task, never to the
 * transcript or the running tools of the chat.
 */
function reduceTaskTool(
  state: UiState,
  e: Extract<UiAction, { type: 'tool_call' | 'tool_progress' | 'tool_result' }>,
  taskId: string
): UiState {
  switch (e.type) {
    case 'tool_call':
      return updateTask(state, taskId, t => ({
        ...t,
        tools: [
          ...t.tools,
          {
            callId: e.callId,
            name: e.name,
            args: shortArgs(e.args, 40),
            attempt: Math.max(t.attempt, 1),
            ok: null,
            summary: null,
          },
        ].slice(-MAX_TASK_TOOLS),
      }));
    case 'tool_result':
      return updateTaskTool(state, taskId, e.callId, c => ({
        ...c,
        ok: e.ok,
        summary: oneLine(e.summary),
      }));
    default:
      return state;
  }
}

/** Turns one event (or local action) into the next state. */
export function reduce(state: UiState, e: UiAction): UiState {
  if (
    (e.type === 'tool_call' ||
      e.type === 'tool_progress' ||
      e.type === 'tool_result') &&
    e.taskId !== undefined
  ) {
    return reduceTaskTool(state, e, e.taskId);
  }
  switch (e.type) {
    case 'user_message':
      return {
        ...state,
        ...push(state, { kind: 'user', text: e.text }),
        status: { ...state.status, busy: true },
      };

    case 'notice':
      return {
        ...state,
        ...push(state, {
          kind: 'notice',
          text: e.text,
          level: e.level ?? 'info',
        }),
      };

    case 'set_mode':
      return { ...state, status: { ...state.status, mode: e.mode } };

    case 'approval_answered':
    case 'approval_resolved':
      return {
        ...state,
        workflow: afterApproval(state, e.approvalId, e.decision),
        approval:
          state.approval?.approvalId === e.approvalId ? null : state.approval,
        planApproval:
          state.planApproval?.approvalId === e.approvalId
            ? null
            : state.planApproval,
      };

    case 'turn_settled':
      return { ...state, status: { ...state.status, busy: false } };

    case 'turn_start':
      return { ...state, status: { ...state.status, busy: true } };

    case 'text_delta':
      return {
        ...state,
        live: {
          ...state.live,
          streamingText: state.live.streamingText + e.text,
        },
      };

    case 'reasoning_delta':
      return {
        ...state,
        live: { ...state.live, reasoning: state.live.reasoning + e.text },
      };

    case 'tool_call': {
      const flushed = flushText(state);
      const tool: ToolView = {
        callId: e.callId,
        name: e.name,
        args: shortArgs(e.args),
        lastLine: null,
      };
      const preview = e.risk === 'write' ? previewOf(e.args) : undefined;
      if (preview !== undefined) tool.preview = preview;
      return {
        ...flushed,
        live: {
          ...flushed.live,
          reasoning: '',
          runningTools: [...flushed.live.runningTools, tool],
        },
      };
    }

    case 'tool_progress':
      return {
        ...state,
        live: {
          ...state.live,
          runningTools: state.live.runningTools.map(t =>
            t.callId === e.callId ? { ...t, lastLine: e.line } : t
          ),
        },
      };

    case 'tool_result': {
      const tool = state.live.runningTools.find(t => t.callId === e.callId);
      return {
        ...state,
        ...push(state, {
          kind: 'tool',
          callId: e.callId,
          name: tool?.name ?? 'tool',
          args: tool?.args ?? '',
          ok: e.ok,
          summary: e.summary,
        }),
        live: {
          ...state.live,
          runningTools: state.live.runningTools.filter(
            t => t.callId !== e.callId
          ),
        },
      };
    }

    case 'approval_needed': {
      const tool = state.live.runningTools.find(t => t.callId === e.callId);
      const approval: ApprovalView = {
        approvalId: e.approvalId,
        callId: e.callId,
        toolName: tool?.name ?? 'this tool',
        title: e.title,
      };
      const preview = e.preview ?? tool?.preview;
      if (e.command !== undefined) approval.command = e.command;
      if (preview !== undefined) approval.preview = preview;
      return { ...state, approval };
    }

    case 'usage':
      return {
        ...state,
        status: {
          ...state.status,
          tokens: state.status.tokens + e.inputTokens + e.outputTokens,
          costUsd: state.status.costUsd + (e.costUsd ?? 0),
        },
      };

    case 'turn_end': {
      const flushed = flushText(state);
      const notice = turnEndNotice(e.reason, e.error);
      return {
        ...flushed,
        ...(notice ? push(flushed, notice) : {}),
        live: { streamingText: '', reasoning: '', runningTools: [] },
        approval: null,
        planApproval: null,
        // A plan nobody approved will not run after its turn.
        workflow: flushed.workflow?.approvalId ? null : flushed.workflow,
        status: { ...flushed.status, busy: false },
      };
    }

    case 'problem_dir_changed':
      return {
        ...state,
        status: { ...state.status, problem: baseName(e.problemDir) },
      };

    case 'compacted':
      return {
        ...state,
        ...push(state, {
          kind: 'notice',
          level: 'info',
          text: `Context compacted: ${e.removedMessages} old messages removed.`,
        }),
      };

    case 'notes_updated':
      return state;

    case 'plan_created':
      return { ...state, workflow: newWorkflow(state, e.plan, null) };

    case 'plan_approval_needed':
      return {
        ...state,
        planApproval: { approvalId: e.approvalId, plan: e.plan },
        workflow: state.workflow
          ? { ...state.workflow, approvalId: e.approvalId }
          : newWorkflow(state, e.plan, e.approvalId),
      };

    case 'task_started':
      return updateTask(state, e.taskId, t => ({
        ...t,
        status: 'running',
        attempt: e.attempt,
        attempts:
          t.attempts[t.attempts.length - 1]?.attempt === e.attempt
            ? t.attempts
            : [...t.attempts, { attempt: e.attempt, checkpoints: [] }],
      }));

    case 'task_checkpoint': {
      const cp: Checkpoint = { name: e.name, ok: e.ok, digest: e.digest };
      return updateTask(state, e.taskId, t => ({
        ...t,
        checkpoint: cp,
        attempts: addCheckpoint(t, cp),
      }));
    }

    case 'task_done':
      return updateTask(state, e.taskId, t => {
        const cp = e.result.checkpoint;
        const last = t.attempts[t.attempts.length - 1];
        // Some tasks report their checkpoint only in the result.
        const seen = last?.checkpoints.some(
          c => c.name === cp.name && c.ok === cp.ok && c.digest === cp.digest
        );
        return {
          ...t,
          status: e.result.status,
          attempt: e.result.attempts,
          result: e.result,
          checkpoint: cp,
          attempts: seen ? t.attempts : addCheckpoint(t, cp),
        };
      });

    case 'workflow_done': {
      const wf = state.workflow;
      const added = wf
        ? push(state, {
            kind: 'workflow',
            plan: wf.plan,
            tasks: wf.tasks,
            problem: state.status.problem,
            ok: e.ok,
            summary: e.summary,
            costUsd: e.costUsd,
            elapsedMs: Math.max(0, Date.now() - wf.startedAt),
          })
        : push(state, {
            kind: 'notice',
            level: e.ok ? 'info' : 'error',
            text: `Workflow ${e.ok ? 'done' : 'failed'}: ${e.summary}`,
          });
      return { ...state, ...added, workflow: null, planApproval: null };
    }

    default:
      return state;
  }
}
