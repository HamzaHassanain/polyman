/**
 * Decides if a tool call may run, and asks the user when it must.
 *
 * | Risk          | `ask`                      | `auto-edit` | `plan-approved` |
 * | ------------- | -------------------------- | ----------- | --------------- |
 * | `read`, `run` | allow                      | allow       | allow           |
 * | `write`       | session rule? allow : ask  | allow       | allow           |
 * | `remote`      | ask                        | ask         | ask             |
 *
 * In `plan-approved` the sandbox limits writes to the files of the task.
 * Asking emits `approval_needed` on the bus and waits until `resolve()` is
 * called with the same approval id. An abort while waiting rejects.
 */

import type { ApprovalDecision, EventBus } from '../core/events';
import type { Plan } from '../workflow/types';
import type { PermissionGate, PermissionMode, Tool } from './types';

/** How long the fallback command of an approval may be. */
const MAX_COMMAND_CHARS = 200;

type CheckResult = { allowed: true } | { allowed: false; reason: string };

/** The {@link PermissionGate} of a session. */
export class DefaultPermissionGate implements PermissionGate {
  mode: PermissionMode;
  /** Tool names the user allowed for the whole session. */
  private readonly sessionRules = new Set<string>();
  /** Approvals that wait for an answer, by approval id. */
  private readonly waiting = new Map<
    string,
    (decision: ApprovalDecision) => void
  >();
  private nextId = 1;
  /**
   * The id of the last `tool_call` event on the bus. `check()` gets no call
   * id, but the session emits `tool_call` right before it runs the call, and
   * calls run one at a time, so this is the call that waits.
   */
  private lastCallId = '';

  constructor(
    private readonly bus: EventBus,
    mode: PermissionMode = 'ask'
  ) {
    this.mode = mode;
    bus.on(e => {
      if (e.type === 'tool_call') this.lastCallId = e.callId;
    });
  }

  setMode(m: PermissionMode): void {
    this.mode = m;
  }

  async check(
    tool: Tool,
    args: unknown,
    signal: AbortSignal
  ): Promise<CheckResult> {
    if (!this.mustAsk(tool)) return { allowed: true };

    const callId = this.lastCallId;
    const shown = describeCall(tool, args);
    const decision = await this.wait(signal, approvalId => {
      const event: {
        type: 'approval_needed';
        approvalId: string;
        callId: string;
        title: string;
        command?: string;
      } = { type: 'approval_needed', approvalId, callId, title: shown.title };
      if (shown.command !== undefined) event.command = shown.command;
      this.bus.emit(event);
    });

    if (decision.kind === 'deny') {
      return { allowed: false, reason: decision.reason ?? 'no reason given' };
    }
    if (decision.kind === 'allow_session' && tool.risk === 'write') {
      this.sessionRules.add(tool.name);
    }
    return { allowed: true };
  }

  async askPlan(plan: Plan, signal: AbortSignal): Promise<ApprovalDecision> {
    const decision = await this.wait(signal, approvalId => {
      this.bus.emit({ type: 'plan_approval_needed', approvalId, plan });
    });
    if (decision.kind !== 'deny') this.mode = 'plan-approved';
    return decision;
  }

  resolve(approvalId: string, decision: ApprovalDecision): void {
    const settle = this.waiting.get(approvalId);
    if (settle === undefined) return;
    settle(decision);
  }

  private mustAsk(tool: Tool): boolean {
    switch (tool.risk) {
      case 'read':
      case 'run':
        return false;
      case 'remote':
        return true;
      case 'write':
        if (this.mode !== 'ask') return false;
        return !this.sessionRules.has(tool.name);
    }
  }

  /**
   * Registers a waiting approval, calls `announce` to emit its event, and
   * waits for `resolve()` or an abort. Emits `approval_resolved` either way.
   */
  private wait(
    signal: AbortSignal,
    announce: (approvalId: string) => void
  ): Promise<ApprovalDecision> {
    signal.throwIfAborted();
    const approvalId = `approval_${this.nextId++}`;

    return new Promise<ApprovalDecision>((resolve, reject) => {
      const finish = (decision: ApprovalDecision): void => {
        this.waiting.delete(approvalId);
        signal.removeEventListener('abort', onAbort);
        this.bus.emit({ type: 'approval_resolved', approvalId, decision });
      };
      const onAbort = (): void => {
        finish({ kind: 'deny', reason: 'cancelled' });
        reject(abortReason(signal));
      };
      this.waiting.set(approvalId, decision => {
        finish(decision);
        resolve(decision);
      });
      signal.addEventListener('abort', onAbort, { once: true });
      announce(approvalId);
    });
  }
}

/**
 * Characters that can change what a terminal shows: C0 and C1 controls
 * (ESC starts colour and cursor sequences), DEL, and the bidi marks and
 * overrides that reorder text.
 */
const HIDING_CHARS =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * Writes every hiding character as a visible `\uXXXX`, so the user sees the
 * literal text the model sent, like the real path of a write.
 */
export function escapeForTerminal(text: string): string {
  return text.replace(
    HIDING_CHARS,
    c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
  );
}

/** The title and command of an approval prompt, safe to print. */
function describeCall(
  tool: Tool,
  args: unknown
): { title: string; command?: string } {
  const shown = rawDescription(tool, args);
  const out: { title: string; command?: string } = {
    title: escapeForTerminal(shown.title),
  };
  if (shown.command !== undefined) {
    out.command = escapeForTerminal(shown.command);
  }
  return out;
}

/** The title and command of an approval prompt, as the tool gives them. */
function rawDescription(
  tool: Tool,
  args: unknown
): { title: string; command?: string } {
  const described = tool.describe?.(args);
  if (described !== undefined) return described;
  let json: string;
  try {
    json = JSON.stringify(args) ?? '';
  } catch {
    json = String(args);
  }
  if (json.length > MAX_COMMAND_CHARS) {
    json = json.slice(0, MAX_COMMAND_CHARS - 3) + '...';
  }
  return { title: tool.name, command: `${tool.name} ${json}`.trim() };
}

/** The error an aborted signal throws, always an `Error`. */
export function abortReason(signal: AbortSignal): Error {
  try {
    signal.throwIfAborted();
  } catch (err) {
    if (err instanceof Error) return err;
  }
  return new DOMException('This operation was aborted', 'AbortError');
}
