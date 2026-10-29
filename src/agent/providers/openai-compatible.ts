/**
 * One adapter for every server that speaks the OpenAI Chat Completions format
 * (OpenAI, DeepSeek, Qwen, Gemini, Groq, Mistral, OpenRouter, Ollama, ...).
 * Each server is set up by a base URL, a key and a {@link Quirks} object.
 */

import type { ContentPart, Message } from '../core/messages';
import { parseSse, type SseEvent } from './sse-parser';
import {
  ProviderError,
  type ChatRequest,
  type Provider,
  type StreamEvent,
  type ToolSpec,
} from './types';

/** The small ways servers differ from OpenAI. Presets set these per server. */
export interface Quirks {
  /**
   * Send `stream_options.include_usage`. When a server rejects it, the
   * request is sent once more without it, and it stays off for this provider.
   */
  streamOptions: boolean;
  /** Name of the max output tokens field in the request body. */
  maxTokensField: 'max_tokens' | 'max_completion_tokens';
  /**
   * Delta fields that hold reasoning text, checked in order. DeepSeek uses
   * `reasoning_content`, OpenRouter uses `reasoning`. Never sent back.
   */
  reasoningFields: readonly string[];
  /**
   * Try to fix tool arguments that are not valid JSON (text after the
   * object, code fences). Small local models need it.
   */
  repairToolArgs: boolean;
  /**
   * Whether the server supports tools. When false, a request with tools
   * fails with `tools_not_supported` before it is sent.
   */
  tools: boolean;
  /**
   * More fields for the request body, merged after the standard ones.
   * OpenRouter uses it for `usage.include` and `provider` routing.
   */
  extraBody?: (req: ChatRequest) => Record<string, unknown>;
}

/** Quirks that fit OpenAI and most servers that copy it. */
export const DEFAULT_QUIRKS: Readonly<Quirks> = Object.freeze({
  streamOptions: true,
  maxTokensField: 'max_tokens',
  reasoningFields: Object.freeze(['reasoning_content', 'reasoning']),
  repairToolArgs: true,
  tools: true,
});

/** How to reach one OpenAI-compatible server. */
export interface OpenAICompatibleOptions {
  /** Provider id. Defaults to `openai-compatible`. */
  id?: string;
  /** Base URL, like `https://api.openai.com/v1`. */
  baseUrl: string;
  /** Sent as `Authorization: Bearer <apiKey>`. Local servers need none. */
  apiKey?: string;
  /** More headers for every request. */
  headers?: Record<string, string>;
  /** Changes from {@link DEFAULT_QUIRKS}. */
  quirks?: Partial<Quirks>;
  /** The `fetch` to use. Defaults to the global one. Tests pass a fake. */
  fetch?: typeof fetch;
}

/** A provider for any server that speaks the OpenAI Chat Completions format. */
export class OpenAICompatibleProvider implements Provider {
  /** Provider id. */
  readonly id: string;
  /** The quirks in use. `streamOptions` may turn off after a rejection. */
  readonly quirks: Quirks;

  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly fetchFn: typeof fetch;
  private generatedIds = 0;

  constructor(opts: OpenAICompatibleOptions) {
    this.id = opts.id ?? 'openai-compatible';
    this.quirks = { ...DEFAULT_QUIRKS, ...opts.quirks };
    this.url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    this.headers = {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...(opts.apiKey ? { authorization: `Bearer ${opts.apiKey}` } : {}),
      ...opts.headers,
    };
    this.fetchFn = opts.fetch ?? fetch;
  }

  async *stream(
    req: ChatRequest,
    signal: AbortSignal
  ): AsyncIterable<StreamEvent> {
    signal.throwIfAborted();
    if (req.tools.length > 0 && !this.quirks.tools) {
      throw new ProviderError(
        'tools_not_supported',
        `${this.id} does not support tools`
      );
    }

    let response = await this.post(req, signal);
    if (!response.ok) {
      const error = await errorFromResponse(response);
      if (this.quirks.streamOptions && isStreamOptionsError(error)) {
        this.quirks.streamOptions = false;
        response = await this.post(req, signal);
        if (!response.ok) throw await errorFromResponse(response);
      } else {
        throw error;
      }
    }
    if (!response.body) {
      throw new ProviderError('server', 'the response has no body', {
        status: response.status,
      });
    }

    const turn = new TurnState(this.quirks, () => {
      this.generatedIds += 1;
      return `call_${this.generatedIds}`;
    });
    let sawDone = false;
    for await (const sse of readStream(response.body, signal)) {
      if (sse.data === '[DONE]') {
        sawDone = true;
        break;
      }
      for (const event of turn.chunk(parseChunk(sse.data))) {
        signal.throwIfAborted();
        yield event;
      }
    }
    signal.throwIfAborted();
    if (!sawDone && turn.stopReason === undefined) {
      throw new ProviderError('network', 'the stream ended before the turn');
    }
    for (const event of turn.end()) yield event;
  }

  /** Sends one request. Network failures become `network` errors. */
  private async post(req: ChatRequest, signal: AbortSignal): Promise<Response> {
    try {
      return await this.fetchFn(this.url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(requestBody(req, this.quirks)),
        signal,
      });
    } catch (err) {
      signal.throwIfAborted();
      throw new ProviderError(
        'network',
        `cannot reach ${this.url}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Request

/** A message in the Chat Completions format. */
type WireMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: WireToolCall[];
    }
  | { role: 'tool'; tool_call_id: string; content: string };

interface WireToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** The JSON body of a Chat Completions request. */
export function requestBody(
  req: ChatRequest,
  quirks: Quirks
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: req.model,
    messages: toWireMessages(req.system, req.messages),
  };
  if (req.tools.length > 0) body['tools'] = req.tools.map(toWireTool);
  body['stream'] = true;
  if (quirks.streamOptions) body['stream_options'] = { include_usage: true };
  if (req.maxOutputTokens !== undefined) {
    body[quirks.maxTokensField] = req.maxOutputTokens;
  }
  if (req.temperature !== undefined) body['temperature'] = req.temperature;
  if (req.reasoningEffort !== undefined) {
    body['reasoning_effort'] = req.reasoningEffort;
  }
  if (quirks.extraBody) Object.assign(body, quirks.extraBody(req));
  return body;
}

/**
 * Maps our messages to the Chat Completions format. `tool_call` parts become
 * `assistant.tool_calls`, `tool_result` parts become `tool` messages, and
 * reasoning is dropped: it is never sent back.
 */
export function toWireMessages(
  system: string,
  messages: readonly Message[]
): WireMessage[] {
  const out: WireMessage[] = [];
  if (system !== '') out.push({ role: 'system', content: system });

  for (const message of messages) {
    const text = textOf(message.parts);
    if (message.role === 'assistant') {
      const calls = message.parts.flatMap(p =>
        p.type === 'tool_call'
          ? [
              {
                id: p.id,
                type: 'function' as const,
                function: { name: p.name, arguments: argsString(p.args) },
              },
            ]
          : []
      );
      if (text === '' && calls.length === 0) continue;
      out.push({
        role: 'assistant',
        content: text === '' ? null : text,
        ...(calls.length > 0 ? { tool_calls: calls } : {}),
      });
      continue;
    }

    // Tool results must come right after the assistant's tool calls, so
    // they go before any text of the same message.
    for (const part of message.parts) {
      if (part.type === 'tool_result') {
        out.push({
          role: 'tool',
          tool_call_id: part.callId,
          content: part.content,
        });
      }
    }
    if (text !== '') out.push({ role: 'user', content: text });
  }
  return out;
}

function textOf(parts: readonly ContentPart[]): string {
  return parts.flatMap(p => (p.type === 'text' ? [p.text] : [])).join('');
}

/** Tool arguments as the JSON string the wire format wants. */
function argsString(args: unknown): string {
  // Arguments that could not be parsed are kept as the raw string.
  if (typeof args === 'string') return args;
  return JSON.stringify(args ?? {});
}

function toWireTool(tool: ToolSpec): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

// ---------------------------------------------------------------------------
// Errors

/** The message of an HTTP 402 (no credits). */
export const NO_CREDITS =
  'OpenRouter says there are no credits left. Add credits at https://openrouter.ai/settings/credits';

/** Turns a failed HTTP response into a {@link ProviderError}. */
export async function errorFromResponse(
  response: Response
): Promise<ProviderError> {
  const status = response.status;
  const message = errorMessage(await response.text().catch(() => ''));
  const text = message === '' ? `HTTP ${status}` : `HTTP ${status}: ${message}`;

  if (status === 402) {
    // OpenRouter answers 402 when the account has no credits left.
    return new ProviderError('bad_request', `${NO_CREDITS} (${text})`, {
      status,
      retryable: false,
    });
  }
  if (status === 401 || status === 403) {
    return new ProviderError('auth', text, { status });
  }
  if (status === 429) {
    const retryAfterMs = retryAfter(response.headers);
    return new ProviderError('rate_limit', text, {
      status,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
  }
  if (status === 413 || (status === 400 && isContextError(message))) {
    return new ProviderError('context_too_long', text, { status });
  }
  if (status === 400 && isToolsError(message)) {
    return new ProviderError('tools_not_supported', text, { status });
  }
  if (status >= 500) return new ProviderError('server', text, { status });
  return new ProviderError('bad_request', text, { status });
}

/** The `error.message` of a JSON error body, or the body itself. */
function errorMessage(body: string): string {
  try {
    const json = JSON.parse(body) as unknown;
    if (isRecord(json)) {
      const error = json['error'];
      if (isRecord(error) && typeof error['message'] === 'string') {
        return error['message'];
      }
      if (typeof error === 'string') return error;
      if (typeof json['message'] === 'string') return json['message'];
    }
  } catch {
    // Not JSON: use the text as it is.
  }
  return body.trim().slice(0, 500);
}

/** Whether an error message says the prompt is too long. */
export function isContextError(message: string): boolean {
  return /context[_ ]length|context window|maximum context|too many tokens|prompt is too long/i.test(
    message
  );
}

/**
 * Messages of servers or models with no tool support, like Ollama's "does
 * not support tools" or vLLM's "--enable-auto-tool-choice". A bad tool
 * definition is a normal `bad_request`.
 */
function isToolsError(message: string): boolean {
  return /not support\w*\s+(tools?|function[ _]?calling|tool[ _]?calling)|(tools?|function[ _]?calling|tool[ _]?calling|tool[ _]?use)\s+(is|are)\s+not\s+(supported|enabled)|enable-auto-tool-choice/i.test(
    message
  );
}

function isStreamOptionsError(error: ProviderError): boolean {
  return (
    error.status === 400 && /stream_options|include_usage/i.test(error.message)
  );
}

/** Reads `retry-after-ms` or `retry-after` (seconds or a date) in ms. */
export function retryAfter(
  headers: Headers,
  now = Date.now()
): number | undefined {
  // A blank header is missing: `Number('')` would be 0.
  const msText = headers.get('retry-after-ms')?.trim() ?? '';
  const ms = msText === '' ? NaN : Number(msText);
  if (Number.isFinite(ms) && ms >= 0) return ms;

  const value = headers.get('retry-after');
  if (value === null || value.trim() === '') return undefined;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) {
    // A bare number is seconds, never a date: `-5` and `Infinity` are bad.
    return Number.isFinite(seconds) && seconds >= 0
      ? seconds * 1000
      : undefined;
  }
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

// ---------------------------------------------------------------------------
// Stream

/** The parts of a streamed chunk the adapter reads. */
interface Chunk {
  choices?: {
    index?: number;
    delta?: Record<string, unknown> & {
      content?: string | null;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    /** USD, sent by OpenRouter. */
    cost?: number;
    prompt_tokens_details?: { cached_tokens?: number } | null;
  } | null;
  error?: unknown;
}

function parseChunk(data: string): Chunk {
  let json: unknown;
  try {
    json = JSON.parse(data);
  } catch {
    throw new ProviderError(
      'server',
      `bad JSON in the stream: ${data.slice(0, 200)}`
    );
  }
  if (!isRecord(json)) {
    throw new ProviderError('server', 'a stream chunk is not an object');
  }
  if (json['error'] !== undefined && json['error'] !== null) {
    // Some servers (OpenRouter) send errors inside the stream.
    throw new ProviderError(
      'server',
      `error in the stream: ${errorMessage(JSON.stringify(json))}`
    );
  }
  checkChunkShape(json);
  return json;
}

/**
 * Checks the parts of a chunk that the adapter walks, so a well-formed JSON
 * chunk with the wrong shape is a `server` error and not a crash. It is not
 * retryable: the same server will likely send the same shape again.
 */
function checkChunkShape(json: Record<string, unknown>): void {
  const bad = (what: string): ProviderError =>
    new ProviderError('server', `a stream chunk has a bad shape: ${what}`, {
      retryable: false,
    });
  const choices = json['choices'];
  if (choices === undefined || choices === null) return;
  if (!Array.isArray(choices)) throw bad('choices is not an array');
  for (const choice of choices as unknown[]) {
    if (!isRecord(choice)) throw bad('a choice is not an object');
    const delta = choice['delta'];
    if (delta === undefined || delta === null) continue;
    if (!isRecord(delta)) throw bad('delta is not an object');
    const calls = delta['tool_calls'];
    if (calls === undefined || calls === null) continue;
    if (!Array.isArray(calls)) throw bad('tool_calls is not an array');
    if (!(calls as unknown[]).every(isRecord)) {
      throw bad('a tool call is not an object');
    }
  }
}

/**
 * The SSE events of a body. Only a failed read becomes a `network` error:
 * errors of the caller's loop body never pass through here.
 */
async function* readStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal
): AsyncGenerator<SseEvent> {
  try {
    for await (const sse of parseSse(body, signal)) yield sse;
  } catch (err) {
    signal.throwIfAborted();
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(
      'network',
      `the stream broke: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** The highest tool call `index` accepted from a server. */
const MAX_TOOL_INDEX = 128;

type StopReason = Extract<StreamEvent, { type: 'done' }>['stopReason'];
type Usage = Extract<StreamEvent, { type: 'usage' }>;

interface PendingCall {
  /** The `index` the server gave the piece that started this call. */
  index: number;
  id: string;
  name: string;
  args: string;
}

/** The state of one streamed turn: tool call pieces, usage, stop reason. */
class TurnState {
  stopReason: StopReason | undefined;
  private usage: Usage | undefined;
  /** Pending calls by internal sequence number, in the order they started. */
  private calls = new Map<number, PendingCall>();
  /** The sequence number of the current call for each server index. */
  private current = new Map<number, number>();
  private nextSeq = 0;
  private emittedCalls = 0;

  constructor(
    private readonly quirks: Quirks,
    private readonly newId: () => string
  ) {}

  /** The events of one chunk. Tool calls wait for `finish_reason`. */
  *chunk(chunk: Chunk): Generator<StreamEvent> {
    if (chunk.usage) this.usage = toUsage(chunk.usage);

    const choice = chunk.choices?.find(c => (c.index ?? 0) === 0);
    if (!choice) return;
    const delta = choice.delta ?? {};

    const reasoning = this.reasoningOf(delta);
    if (reasoning !== '') yield { type: 'reasoning_delta', text: reasoning };
    if (typeof delta.content === 'string' && delta.content !== '') {
      yield { type: 'text_delta', text: delta.content };
    }

    (delta.tool_calls ?? []).forEach((piece, i) => {
      const index = piece.index ?? i;
      if (!Number.isInteger(index) || index < 0 || index > MAX_TOOL_INDEX) {
        throw new ProviderError(
          'server',
          `a tool call has a bad index: ${String(index).slice(0, 40)}`
        );
      }
      let call = this.calls.get(this.current.get(index) ?? -1);
      // Some servers number every call 0. A new id starts a new call.
      if (call === undefined || (piece.id && call.id && piece.id !== call.id)) {
        call = { index, id: '', name: '', args: '' };
        this.current.set(index, this.nextSeq);
        this.calls.set(this.nextSeq, call);
        this.nextSeq += 1;
      }
      if (piece.id && call.id === '') call.id = piece.id;
      call.name += piece.function?.name ?? '';
      call.args += piece.function?.arguments ?? '';
    });

    if (choice.finish_reason) {
      this.stopReason = toStopReason(choice.finish_reason);
      yield* this.flushCalls();
    }
  }

  /** The events after the last chunk: late tool calls, usage, done. */
  *end(): Generator<StreamEvent> {
    yield* this.flushCalls();
    if (this.usage) yield this.usage;
    let stopReason = this.stopReason ?? 'end';
    // Some servers say `stop` even when the model called tools.
    if (stopReason === 'end' && this.emittedCalls > 0)
      stopReason = 'tool_calls';
    yield { type: 'done', stopReason };
  }

  private reasoningOf(delta: Record<string, unknown>): string {
    for (const field of this.quirks.reasoningFields) {
      const value = delta[field];
      if (typeof value === 'string' && value !== '') return value;
    }
    return '';
  }

  /** Parses the collected tool calls once, in index order. */
  private *flushCalls(): Generator<StreamEvent> {
    // Sorted by server index; calls with the same index keep their order.
    const calls = [...this.calls.values()].sort((a, b) => a.index - b.index);
    this.calls = new Map();
    this.current = new Map();
    for (const call of calls) {
      this.emittedCalls += 1;
      const id = call.id === '' ? this.newId() : call.id;
      const parsed = parseToolArgs(call.args, this.quirks.repairToolArgs);
      if (parsed.ok) {
        yield { type: 'tool_call', id, name: call.name, args: parsed.value };
      } else {
        yield {
          type: 'tool_call',
          id,
          name: call.name,
          args: call.args,
          argsError: parsed.error,
        };
      }
    }
  }
}

function toUsage(usage: NonNullable<Chunk['usage']>): Usage {
  const cached = usage.prompt_tokens_details?.cached_tokens;
  return {
    type: 'usage',
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    ...(typeof cached === 'number' ? { cachedTokens: cached } : {}),
    ...(typeof usage.cost === 'number' && Number.isFinite(usage.cost)
      ? { costUsd: usage.cost }
      : {}),
  };
}

function toStopReason(reason: string): StopReason {
  switch (reason) {
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'end';
  }
}

/** The result of {@link parseToolArgs}. */
export type ParsedArgs =
  { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Parses tool arguments once. Empty arguments are `{}`. With `repair`, it
 * also accepts a JSON value in code fences or followed by other text.
 */
export function parseToolArgs(raw: string, repair: boolean): ParsedArgs {
  const text = raw.trim();
  if (text === '') return { ok: true, value: {} };
  const first = tryParse(text);
  if (first.ok || !repair) return first;

  const unfenced = text
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/\s*```$/, '')
    .trim();
  const second = tryParse(unfenced);
  if (second.ok) return second;

  const end = jsonEnd(unfenced);
  if (end !== undefined) {
    const third = tryParse(unfenced.slice(0, end));
    if (third.ok) return third;
  }
  return first;
}

function tryParse(text: string): ParsedArgs {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (err) {
    return {
      ok: false,
      error: `tool arguments are not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** The end of the object or array that starts `text`, skipping strings. */
function jsonEnd(text: string): number | undefined {
  if (text[0] !== '{' && text[0] !== '[') return undefined;
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i += 1;
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
    } else if (c === '{' || c === '[') {
      depth += 1;
    } else if (c === '}' || c === ']') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
