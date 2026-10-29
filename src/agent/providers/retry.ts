/**
 * Retries for any {@link Provider}. The adapters map HTTP errors to
 * {@link ProviderError} kinds; this wrapper decides what to do with them:
 *
 * - `rate_limit`, `server` and `network`: wait `retry-after`, or back off
 *   1s, 2s, 4s (with a bit of jitter), at most 3 retries.
 * - `context_too_long`: call `onContextTooLong` once, try once more.
 * - `auth`, `bad_request` and `tools_not_supported`: throw, no retry.
 *
 * A turn is retried only before its first streamed event. When a stream
 * breaks in the middle we cannot know what the model already did, so the
 * error is thrown and not retried.
 */

import {
  ProviderError,
  type ChatRequest,
  type ModelInfo,
  type Provider,
  type StreamEvent,
} from './types';

/** What {@link RetryOptions.onRetry} gets before each wait. */
export interface RetryInfo {
  /** The error that made us retry. */
  error: ProviderError;
  /** Which retry this is, starting at 1. */
  retry: number;
  /** How long we wait before the retry. */
  delayMs: number;
}

/** How {@link withRetries} retries. */
export interface RetryOptions {
  /** Retries after the first try. Defaults to 3. */
  maxRetries?: number;
  /** First backoff delay, doubled on each retry. Defaults to 1000 ms. */
  baseDelayMs?: number;
  /**
   * The longest we wait before one retry. Backoff is cut to it, and a
   * `retry-after` longer than it is not waited: the error is thrown.
   * Defaults to 60000 ms.
   */
  maxDelayMs?: number;
  /** Adds up to this part of the backoff delay at random. Defaults to 0.2. */
  jitter?: number;
  /** Random numbers in [0, 1) for the jitter. Defaults to `Math.random`. */
  random?: () => number;
  /**
   * Called once per turn on `context_too_long`. It returns a smaller
   * request to try once more, or `undefined` to give up.
   */
  onContextTooLong?: (
    req: ChatRequest,
    error: ProviderError,
    signal: AbortSignal
  ) => ChatRequest | undefined | Promise<ChatRequest | undefined>;
  /** Called before each wait, so the user can see why nothing happens. */
  onRetry?: (info: RetryInfo) => void;
  /** Strings that must never show in an error message, like the API key. */
  secrets?: readonly string[];
}

const DEFAULTS = {
  maxRetries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 60_000,
  jitter: 0.2,
};

/**
 * Wraps a provider so its turns are retried as the module comment says.
 * Errors that are not a {@link ProviderError}, and aborts, pass through.
 */
export function withRetries(
  provider: Provider,
  opts: RetryOptions = {}
): Provider {
  const wrapped: Provider = {
    id: provider.id,
    stream: (req, signal) => streamWithRetries(provider, req, signal, opts),
  };
  const listModels = provider.listModels?.bind(provider);
  if (listModels) {
    wrapped.listModels = signal =>
      listWithRetries(listModels, signal, opts, provider.id);
  }
  return wrapped;
}

async function* streamWithRetries(
  provider: Provider,
  req: ChatRequest,
  signal: AbortSignal,
  opts: RetryOptions
): AsyncIterable<StreamEvent> {
  let request = req;
  let askedHook = false;
  let compacted = false;
  for (let retry = 0; ;) {
    let started = false;
    try {
      for await (const event of provider.stream(request, signal)) {
        started = true;
        yield event;
      }
      return;
    } catch (err) {
      if (!(err instanceof ProviderError) || signal.aborted) throw err;
      if (started) throw brokenStream(err, provider.id, opts);

      if (
        err.kind === 'context_too_long' &&
        !askedHook &&
        opts.onContextTooLong
      ) {
        askedHook = true;
        const smaller = await opts.onContextTooLong(request, err, signal);
        signal.throwIfAborted();
        if (smaller !== undefined) {
          request = smaller;
          compacted = true;
          continue;
        }
      }

      const delay = retryDelay(err, retry, opts);
      if (typeof delay !== 'number') {
        const note =
          err.kind === 'context_too_long' && compacted
            ? 'still too long after compacting'
            : delay.giveUp;
        throw finalError(err, provider.id, note, opts);
      }
      retry += 1;
      opts.onRetry?.({ error: err, retry, delayMs: delay });
      await sleep(delay, signal);
    }
  }
}

async function listWithRetries(
  listModels: (signal: AbortSignal) => Promise<ModelInfo[]>,
  signal: AbortSignal,
  opts: RetryOptions,
  providerId: string
): Promise<ModelInfo[]> {
  for (let retry = 0; ;) {
    try {
      return await listModels(signal);
    } catch (err) {
      if (!(err instanceof ProviderError) || signal.aborted) throw err;
      const delay = retryDelay(err, retry, opts);
      if (typeof delay !== 'number') {
        throw finalError(err, providerId, delay.giveUp, opts);
      }
      retry += 1;
      opts.onRetry?.({ error: err, retry, delayMs: delay });
      await sleep(delay, signal);
    }
  }
}

/**
 * How long to wait before retry number `retry + 1` (`retry` starts at 0),
 * or why we give up. `giveUp` is empty when the error is not retryable.
 */
export function retryDelay(
  error: ProviderError,
  retry: number,
  opts: RetryOptions = {}
): number | { giveUp: string } {
  const maxRetries = opts.maxRetries ?? DEFAULTS.maxRetries;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULTS.baseDelayMs;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULTS.maxDelayMs;
  const jitter = opts.jitter ?? DEFAULTS.jitter;
  const random = opts.random ?? Math.random;

  if (!error.retryable) return { giveUp: '' };
  if (retry >= maxRetries) {
    return {
      giveUp: `gave up after ${retry} ${retry === 1 ? 'retry' : 'retries'}`,
    };
  }
  if (error.retryAfterMs !== undefined) {
    if (error.retryAfterMs > maxDelayMs) {
      return {
        giveUp: `the server asked to wait ${seconds(error.retryAfterMs)}, more than the ${seconds(maxDelayMs)} limit`,
      };
    }
    return error.retryAfterMs;
  }
  const backoff = baseDelayMs * 2 ** retry;
  return Math.round(Math.min(maxDelayMs, backoff * (1 + jitter * random())));
}

/** Waits `ms`, or rejects with the abort reason when `signal` aborts. */
export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortReason(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  });
}

function abortReason(signal: AbortSignal): Error {
  try {
    signal.throwIfAborted();
  } catch (err) {
    if (err instanceof Error) return err;
  }
  return new DOMException('This operation was aborted', 'AbortError');
}

/** The error we throw when we stop trying. It is never retryable. */
function finalError(
  error: ProviderError,
  providerId: string,
  note: string,
  opts: RetryOptions
): ProviderError {
  if (error.kind === 'auth') {
    const status = error.status !== undefined ? ` (HTTP ${error.status})` : '';
    const said = stripStatus(error.message, error.status);
    return copy(
      error,
      `${providerId} rejected the API key${status}. Check that the key is right and can use this model.` +
        (said !== '' ? ` The server said: ${said}` : ''),
      opts
    );
  }
  return copy(
    error,
    note === '' ? error.message : `${error.message} (${note})`,
    opts,
    false
  );
}

/** A stream that broke after its first event: thrown, never retried. */
function brokenStream(
  error: ProviderError,
  providerId: string,
  opts: RetryOptions
): ProviderError {
  return copy(
    error,
    `the ${providerId} stream broke in the middle of the turn, so it was not retried: ${error.message}`,
    opts,
    false
  );
}

/** A new error like `error` with a safe message. */
function copy(
  error: ProviderError,
  message: string,
  opts: RetryOptions,
  retryable = error.retryable
): ProviderError {
  const safe = redact(message, opts.secrets ?? []);
  if (safe === error.message && retryable === error.retryable) return error;
  return new ProviderError(error.kind, safe, {
    ...(error.status !== undefined ? { status: error.status } : {}),
    ...(error.retryAfterMs !== undefined
      ? { retryAfterMs: error.retryAfterMs }
      : {}),
    retryable,
  });
}

/** Drops a leading `HTTP <status>: ` that the adapters add. */
function stripStatus(message: string, status: number | undefined): string {
  if (status === undefined) return message;
  const prefix = `HTTP ${status}`;
  if (message === prefix) return '';
  return message.startsWith(`${prefix}: `)
    ? message.slice(prefix.length + 2)
    : message;
}

/**
 * Hides API keys in a message: the given secrets, and strings that look
 * like keys (`sk-...`, `gsk_...`, `AIza...`, long tokens). Servers echo part
 * of a wrong key in 401 messages.
 */
export function redact(message: string, secrets: readonly string[]): string {
  return redactKnown(message, secrets)
    .replace(/\b(?:sk|pk|rk|gsk|xai|key)[-_][\w*-]{4,}/gi, '***')
    .replace(/\bAIza[\w-]{10,}/g, '***')
    .replace(/[\w-]{0,64}\*{3,}[\w*-]*/g, '***')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '***');
}

/**
 * Hides only the given secrets. For tool output, where the key-like patterns
 * of {@link redact} would also hide code (`key_count`) and long test tokens.
 */
export function redactKnown(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length >= 4) out = out.split(secret).join('***');
  }
  return out;
}

function seconds(ms: number): string {
  return `${Math.round(ms / 100) / 10}s`;
}
