/**
 * The contract between the providers and the agent loop. A provider knows
 * nothing about running tools, and tools know nothing about providers.
 */

import type { Message } from '../core/messages';

/** A tool the model may call. `parameters` is a JSON Schema object. */
export interface ToolSpec {
  /** Tool name the model uses in a tool call. */
  name: string;
  /** What the tool does, shown to the model. */
  description: string;
  /** JSON Schema describing the tool's arguments. */
  parameters: Record<string, unknown>;
}

/** A request for one model turn. */
export interface ChatRequest {
  /** Model id, as the provider names it. */
  model: string;
  /** System prompt. */
  system: string;
  /** The conversation so far. */
  messages: Message[];
  /** Tools the model may call. Empty when none are offered. */
  tools: ToolSpec[];
  /** Upper bound on generated tokens. */
  maxOutputTokens?: number;
  /** Sampling temperature. */
  temperature?: number;
  /** How much the model should think, for models that support it. */
  reasoningEffort?: 'low' | 'medium' | 'high';
}

/**
 * One event of a streamed model turn.
 *
 * A `tool_call` is emitted only when its arguments are complete. Providers
 * stream arguments in pieces, each in its own way; the adapter collects the
 * pieces and parses the JSON once, so the core never sees partial arguments.
 */
export type StreamEvent =
  /** A chunk of the answer text. */
  | { type: 'text_delta'; text: string }
  /**
   * A chunk of the model's reasoning. Anthropic ends each thinking block
   * with a `reasoning_delta` that has its `signature` (the text may be
   * empty), and gives a redacted thinking block as one `reasoning_delta`
   * with empty text and `redacted` data. The loop keeps these on the
   * reasoning part, and starts a new part for the reasoning after them,
   * so each block can be sent back unchanged.
   */
  | {
      type: 'reasoning_delta';
      text: string;
      signature?: string;
      redacted?: string;
    }
  /**
   * A finished tool call, emitted only when its arguments are complete.
   * When the arguments are not valid JSON and could not be fixed, `args` is
   * the raw string and `argsError` says why. The loop then sends an error
   * tool result, so the model can try again.
   */
  | {
      type: 'tool_call';
      id: string;
      name: string;
      args: unknown;
      argsError?: string;
    }
  /** Token counts for the turn. */
  | {
      type: 'usage';
      inputTokens: number;
      outputTokens: number;
      cachedTokens?: number;
      costUsd?: number;
    }
  /** The turn is over, and why. */
  | {
      type: 'done';
      stopReason: 'end' | 'tool_calls' | 'max_tokens' | 'content_filter';
    };

/** A model a provider offers. */
export interface ModelInfo {
  /** Model id, as the provider names it. */
  id: string;
  /** Context window in tokens, when the provider reports it. */
  contextWindow?: number;
  /** Whether the model supports tool calls, when the provider reports it. */
  supportsTools?: boolean;
}

/** A model provider, such as an OpenAI-compatible or Anthropic endpoint. */
export interface Provider {
  /** Stable provider id. */
  id: string;
  /** Streams one model turn. Aborting `signal` stops the stream. */
  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent>;
  /** Lists the models the provider offers, when it can. */
  listModels?(signal: AbortSignal): Promise<ModelInfo[]>;
}

/** What went wrong in a provider call. */
export type ProviderErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'context_too_long'
  | 'bad_request'
  | 'server'
  | 'network'
  | 'tools_not_supported';

/** Optional details for a {@link ProviderError}. */
export interface ProviderErrorOptions {
  /** HTTP status, when the error came from a response. */
  status?: number;
  /** How long the provider asked us to wait before retrying. */
  retryAfterMs?: number;
  /** Overrides the default for the kind. */
  retryable?: boolean;
}

const RETRYABLE_KINDS: ReadonlySet<ProviderErrorKind> = new Set([
  'rate_limit',
  'server',
  'network',
]);

/**
 * The one error type providers throw. `retryable` defaults from the kind:
 * true for `rate_limit`, `server` and `network`, false otherwise.
 */
export class ProviderError extends Error {
  /** What went wrong. */
  readonly kind: ProviderErrorKind;
  /** HTTP status, when the error came from a response. */
  readonly status?: number;
  /** How long the provider asked us to wait before retrying. */
  readonly retryAfterMs?: number;
  /** Whether trying the same request again may succeed. */
  readonly retryable: boolean;

  constructor(
    kind: ProviderErrorKind,
    message: string,
    opts: ProviderErrorOptions = {}
  ) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    if (opts.status !== undefined) this.status = opts.status;
    if (opts.retryAfterMs !== undefined) this.retryAfterMs = opts.retryAfterMs;
    this.retryable = opts.retryable ?? RETRYABLE_KINDS.has(kind);
  }
}
