/**
 * Everything the agent core reports is an event. The terminal UI, the
 * headless mode and the evals all read the same events from the bus.
 */

import type { Risk } from '../tools/types';
import type { Plan, TaskResult } from '../workflow/types';

/** What the user answered to an approval prompt. */
export interface ApprovalDecision {
  /** Allow this call, allow this tool until the session ends, or deny. */
  kind: 'allow_once' | 'allow_session' | 'deny';
  /** Why the user denied, sent back to the model. */
  reason?: string;
}

/** One event of the agent core. */
export type AgentEvent =
  /** A user message started a new turn. */
  | { type: 'turn_start'; turnId: string }
  /** A chunk of the answer text. */
  | { type: 'text_delta'; text: string }
  /** A chunk of the model's reasoning. */
  | { type: 'reasoning_delta'; text: string }
  /** The model asked to run a tool. */
  | {
      type: 'tool_call';
      callId: string;
      name: string;
      args: unknown;
      risk: Risk;
      /** The workflow task. Set only for events from a workflow worker. */
      taskId?: string;
    }
  /** A tool call waits for the user. Answer with `resolveApproval()`. */
  | {
      type: 'approval_needed';
      approvalId: string;
      callId: string;
      title: string;
      command?: string;
      preview?: string;
    }
  /** The user answered an approval prompt. */
  | {
      type: 'approval_resolved';
      approvalId: string;
      decision: ApprovalDecision;
    }
  /** A line of progress from a running tool (stderr of the CLI). */
  | {
      type: 'tool_progress';
      callId: string;
      line: string;
      /** The workflow task. Set only for events from a workflow worker. */
      taskId?: string;
    }
  /** A tool finished. `data` is the full data for the UI. */
  | {
      type: 'tool_result';
      callId: string;
      ok: boolean;
      summary: string;
      data?: unknown;
      /** The workflow task. Set only for events from a workflow worker. */
      taskId?: string;
    }
  /** Token counts of one model call, and its cost when known. */
  | {
      type: 'usage';
      inputTokens: number;
      outputTokens: number;
      costUsd?: number;
    }
  /** The problem spec (`.polyman/agent/notes.md`) changed. */
  | { type: 'notes_updated'; notes: string }
  /** The session now works on another problem folder. */
  | { type: 'problem_dir_changed'; problemDir: string }
  /** Old messages were cut to stay under the context budget. */
  | { type: 'compacted'; removedMessages: number }
  /**
   * A line for the user from the session, not from the model, like "this
   * model can only chat". It is never sent to the model.
   */
  | { type: 'notice'; text: string; level?: 'info' | 'warn' | 'error' }
  /** The turn is over, and why. */
  | {
      type: 'turn_end';
      turnId: string;
      reason: 'done' | 'cancelled' | 'max_steps' | 'error';
      error?: string;
    }
  /** The manager made a plan. */
  | { type: 'plan_created'; plan: Plan }
  /** The plan waits for the user. Answer with `PermissionGate.resolve()`. */
  | { type: 'plan_approval_needed'; approvalId: string; plan: Plan }
  /** A workflow task started (or started again). */
  | { type: 'task_started'; taskId: string; attempt: number }
  /** The checkpoint of a task ran. */
  | {
      type: 'task_checkpoint';
      taskId: string;
      name: string;
      ok: boolean;
      digest: string;
    }
  /** A workflow task is over. */
  | { type: 'task_done'; taskId: string; result: TaskResult }
  /** The whole workflow is over. */
  | { type: 'workflow_done'; ok: boolean; summary: string; costUsd: number };

/** An event with its place in the stream, counted from the bus start. */
export type SeqEvent = AgentEvent & { seq: number };

/** A typed emitter. Every emitted event gets the next `seq`. */
export interface EventBus {
  /** Sends an event to every listener. */
  emit(e: AgentEvent): void;
  /** Adds a listener. Returns a function that removes it. */
  on(fn: (e: SeqEvent) => void): () => void;
}
