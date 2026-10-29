/**
 * The agent loop. One turn: ask the model, run the tools it asks for, ask
 * again, until the model stops, the step limit, a cancel or an error. Every
 * output goes to the event bus. The chat and every workflow worker use this
 * class, with different deps.
 */

import { randomUUID } from 'node:crypto';
import type { ApprovalDecision } from './events';
import type { ContentPart, Message } from './messages';
import type { AgentSessionApi, AgentSessionDeps } from './session-types';
import { trimContext } from './context';
import { findTextToolCall } from './text-tool-call';
import { redact, redactKnown } from '../providers/retry';
import type { ChatRequest, StreamEvent } from '../providers/types';
import type { Risk, ToolCall, ToolOutput } from '../tools/types';

/** How a turn ended. */
export type TurnEndReason = 'done' | 'cancelled' | 'max_steps' | 'error';

/** Identical calls allowed in one turn before the repeat guard stops them. */
const MAX_IDENTICAL_CALLS = 2;

/** Longest `summary` of a `tool_result` event. */
const SUMMARY_MAX = 120;

/** What one model call gave back. */
interface StepReply {
  parts: ContentPart[];
  text: string;
  calls: ToolCall[];
}

/** Calls seen in this turn, for the repeat guard. */
type RepeatMap = Map<
  string,
  { count: number; lastContent: string; risk: Risk }
>;

/** Runs the agent loop over one conversation. */
export class AgentSession implements AgentSessionApi {
  private readonly deps: AgentSessionDeps;
  private readonly history: Message[] = [];
  private controller: AbortController | null = null;

  constructor(deps: AgentSessionDeps) {
    this.deps = deps;
  }

  /** The conversation so far. */
  get messages(): readonly Message[] {
    return this.history;
  }

  /**
   * Runs one turn for a user message. Throws when a turn is already
   * running. Every other failure ends the turn with `error`, and the session
   * stays usable.
   */
  async send(text: string): Promise<TurnEndReason> {
    if (this.controller) throw new Error('a turn is already running');
    const controller = new AbortController();
    this.controller = controller;
    const turnId = randomUUID();
    this.deps.bus.emit({ type: 'turn_start', turnId });

    let reason: TurnEndReason;
    let error: string | undefined;
    try {
      reason = await this.runTurn(text, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) {
        reason = 'cancelled';
      } else {
        reason = 'error';
        const message = err instanceof Error ? err.message : String(err);
        error = redact(message, this.deps.secrets());
      }
    }
    this.controller = null;
    this.deps.bus.emit({
      type: 'turn_end',
      turnId,
      reason,
      ...(error !== undefined ? { error } : {}),
    });
    return reason;
  }

  /** Stops the running turn. Its provider stream and tool get the signal. */
  cancel(): void {
    this.controller?.abort();
  }

  /** Answers a waiting tool approval. */
  resolveApproval(approvalId: string, decision: ApprovalDecision): void {
    this.deps.permissions.resolve(approvalId, decision);
  }

  private async runTurn(
    text: string,
    signal: AbortSignal
  ): Promise<TurnEndReason> {
    const { deps } = this;
    this.append('user', [{ type: 'text', text }]);
    const seen: RepeatMap = new Map();

    for (let step = 0; step < deps.maxSteps; step++) {
      const system = await deps.buildSystemPrompt();
      signal.throwIfAborted();
      const tools = deps.tools.specs();
      const req: ChatRequest = {
        model: deps.model,
        system,
        messages: trimContext(
          [...this.history],
          deps.contextBudgetTokens,
          system
        ),
        tools,
        maxOutputTokens: deps.maxOutputTokens,
        temperature: deps.temperature,
      };
      const reply = await this.streamStep(req, signal);
      signal.throwIfAborted();

      if (reply.calls.length === 0) {
        if (reply.parts.length > 0) this.append('assistant', reply.parts);
        const name = findTextToolCall(
          reply.text,
          tools.map(t => t.name)
        );
        if (name === null) return 'done';
        this.append('user', [
          {
            type: 'text',
            text: `Use the tool call format to call ${name}, do not write it as text.`,
          },
        ]);
        continue;
      }

      // The step's messages are appended only when all its tools are done,
      // so a cancel never leaves a tool call without its result.
      const results: ContentPart[][] = [];
      for (const call of reply.calls) {
        const output = await this.runTool(call, seen, signal);
        signal.throwIfAborted();
        results.push([
          {
            type: 'tool_result',
            callId: call.id,
            content: output.content,
            isError: output.isError ?? false,
          },
        ]);
      }
      this.append('assistant', reply.parts);
      for (const parts of results) this.append('tool', parts);
    }

    this.append('assistant', [
      {
        type: 'text',
        text: `Stopped after ${deps.maxSteps} steps. Say "continue" to go on.`,
      },
    ]);
    return 'max_steps';
  }

  /** Streams one model call, forwards its deltas and collects the reply. */
  private async streamStep(
    req: ChatRequest,
    signal: AbortSignal
  ): Promise<StepReply> {
    const { bus } = this.deps;
    const reply: StepReply = { parts: [], text: '', calls: [] };
    for await (const ev of this.deps.provider.stream(req, signal)) {
      switch (ev.type) {
        case 'text_delta':
          if (ev.text === '') break;
          bus.emit({ type: 'text_delta', text: ev.text });
          reply.text += ev.text;
          addText(reply.parts, ev.text);
          break;
        case 'reasoning_delta':
          if (ev.text !== '') {
            bus.emit({ type: 'reasoning_delta', text: ev.text });
          }
          addReasoning(reply.parts, ev);
          break;
        case 'tool_call':
          reply.parts.push({
            type: 'tool_call',
            id: ev.id,
            name: ev.name,
            args: ev.args,
          });
          reply.calls.push({
            id: ev.id,
            name: ev.name,
            args: ev.args,
            ...(ev.argsError !== undefined ? { argsError: ev.argsError } : {}),
          });
          break;
        case 'usage':
          bus.emit({
            type: 'usage',
            inputTokens: ev.inputTokens,
            outputTokens: ev.outputTokens,
            ...(ev.costUsd !== undefined ? { costUsd: ev.costUsd } : {}),
          });
          break;
        case 'done':
          break;
      }
    }
    return reply;
  }

  /** Runs one tool call, unless the repeat guard stops it. */
  private async runTool(
    call: ToolCall,
    seen: RepeatMap,
    signal: AbortSignal
  ): Promise<ToolOutput> {
    const { deps } = this;
    const key = `${call.name}\u0000${JSON.stringify(call.args) ?? ''}`;
    const before = seen.get(key);
    if (before && before.count >= MAX_IDENTICAL_CALLS) {
      before.count += 1;
      return {
        content: `You already called ${call.name} with these arguments ${MAX_IDENTICAL_CALLS} times. The result was: ${before.lastContent}. Try something else or ask the user.`,
        isError: true,
      };
    }

    const risk = deps.tools.riskOf(call.name) ?? 'read';
    deps.bus.emit({
      type: 'tool_call',
      callId: call.id,
      name: call.name,
      args: call.args,
      risk,
    });
    const raw = await deps.tools.run(call, deps.makeToolContext(signal));
    // Tool output goes to the model, the history and the UI: no keys in it.
    const output: ToolOutput = {
      ...raw,
      content: redactKnown(raw.content, deps.secrets()),
    };
    if (risk === 'write' && !output.isError) {
      // Files changed, so the same read or run can now give a new result
      // (verify after a fix). Repeated writes stay counted.
      for (const [k, v] of seen) if (v.risk !== 'write') seen.delete(k);
    }
    seen.set(key, {
      count: (seen.get(key)?.count ?? 0) + 1,
      lastContent: output.content,
      risk,
    });
    deps.bus.emit({
      type: 'tool_result',
      callId: call.id,
      ok: !output.isError,
      summary: summaryOf(output.content),
      ...(output.data !== undefined ? { data: output.data } : {}),
    });
    return output;
  }

  private append(role: Message['role'], parts: ContentPart[]): void {
    this.history.push({
      id: randomUUID(),
      role,
      parts,
      createdAt: new Date().toISOString(),
    });
  }
}

/** Adds answer text, joined to the text part before it. */
function addText(parts: ContentPart[], text: string): void {
  const last = parts[parts.length - 1];
  if (last?.type === 'text') last.text += text;
  else parts.push({ type: 'text', text });
}

/**
 * Adds reasoning. A part with a `signature` or `redacted` data is closed, so
 * each Anthropic thinking block stays its own part and can be sent back.
 */
function addReasoning(
  parts: ContentPart[],
  ev: Extract<StreamEvent, { type: 'reasoning_delta' }>
): void {
  if (ev.redacted !== undefined) {
    parts.push({ type: 'reasoning', text: ev.text, redacted: ev.redacted });
    return;
  }
  const last = parts[parts.length - 1];
  let part: Extract<ContentPart, { type: 'reasoning' }>;
  if (
    last?.type === 'reasoning' &&
    last.signature === undefined &&
    last.redacted === undefined
  ) {
    last.text += ev.text;
    part = last;
  } else {
    part = { type: 'reasoning', text: ev.text };
    parts.push(part);
  }
  if (ev.signature !== undefined) part.signature = ev.signature;
}

/**
 * First line of a tool result, at most {@link SUMMARY_MAX} chars, then
 * `(+N lines)` when there are more lines, so a list of files does not look
 * like one file.
 */
export function summaryOf(content: string): string {
  const lines = content.trimEnd().split('\n');
  const first = (lines[0] ?? '').trimEnd().slice(0, SUMMARY_MAX);
  const more = lines.length - 1;
  if (more <= 0) return first;
  return `${first} (+${more} line${more === 1 ? '' : 's'})`;
}
