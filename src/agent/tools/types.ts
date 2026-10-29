/**
 * The contract between the agent loop and the tools. Every tool call goes
 * through the registry, the permission gate and the sandbox.
 */

import type { ApprovalDecision } from '../core/events';
import type { ToolSpec } from '../providers/types';
import type { CliRunner } from '../runner/types';
import type { Plan } from '../workflow/types';

/** What a tool may do. Decides when the user is asked. */
export type Risk = 'read' | 'write' | 'run' | 'remote';

/** A tool the model can call. */
export interface Tool<A = unknown> {
  /** Name shown to the model, in snake_case. */
  name: string;
  /** When to use it, in plain words. */
  description: string;
  /** JSON Schema of the arguments, an object schema. */
  parameters: Record<string, unknown>;
  /** What the tool may do. */
  risk: Risk;
  /** False only for tools that work before the problem folder exists. */
  needsProblem: boolean;
  /** Time limit of one call. */
  timeoutMs?: number;
  /** Short title and command, for approvals and the UI. */
  describe?(args: A): { title: string; command?: string };
  /** Runs the tool. `args` already match `parameters`. */
  run(args: A, ctx: ToolContext): Promise<ToolOutput>;
}

/** What a tool gets when it runs. */
export interface ToolContext {
  /** The problem folder, or null before one is created. */
  problemDir: string | null;
  /** Aborted when the user cancels or the tool times out. */
  signal: AbortSignal;
  /** Runs polyman commands. */
  runner: CliRunner;
  /** Checks every path the tool reads or writes. */
  sandbox: Sandbox;
  /** Reports a line of progress, becomes a `tool_progress` event. */
  progress(line: string): void;
  /** Changes the problem folder. Only `create_problem` uses it. */
  setProblemDir(dir: string): void;
}

/** The result of a tool call. */
export interface ToolOutput {
  /** What the model reads: short and exact. */
  content: string;
  /** True when the call failed. */
  isError?: boolean;
  /** Full data for the UI, like the verify report. */
  data?: unknown;
}

/** A tool call from the model, as the provider gave it. */
export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
  /** Set when the arguments were not valid JSON. */
  argsError?: string;
}

/** Knows every tool and runs a call through all the checks. */
export interface ToolRegistry {
  /** Adds a tool. */
  register(tool: Tool): void;
  /** The tools as the model sees them. */
  specs(): ToolSpec[];
  /** The risk of a tool, or undefined when there is no such tool. */
  riskOf(name: string): Risk | undefined;
  /** Runs one call. Never throws: a failure is an error output. */
  run(call: ToolCall, ctx: ToolContext): Promise<ToolOutput>;
}

/** When the user is asked before a tool runs. */
export type PermissionMode = 'ask' | 'auto-edit' | 'plan-approved';

/** Decides if a tool call may run, and asks the user when it must. */
export interface PermissionGate {
  mode: PermissionMode;
  setMode(m: PermissionMode): void;
  /** Emits `approval_needed` on the bus when it must ask, then waits. */
  check(
    tool: Tool,
    args: unknown,
    signal: AbortSignal
  ): Promise<{ allowed: true } | { allowed: false; reason: string }>;
  /** Emits `plan_approval_needed` and waits. Used by the scheduler. */
  askPlan(plan: Plan, signal: AbortSignal): Promise<ApprovalDecision>;
  /** Answers a waiting approval. Called by the session and the TUI. */
  resolve(approvalId: string, decision: ApprovalDecision): void;
}

/** Keeps every file access inside the problem folder. */
export interface Sandbox {
  /** The real path of the problem folder. */
  root: string;
  /** Returns the real path, or throws a {@link SandboxError}. */
  resolve(userPath: string, mode: 'read' | 'write'): Promise<string>;
}

/** A path is outside the problem folder or is protected. */
export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxError';
  }
}
