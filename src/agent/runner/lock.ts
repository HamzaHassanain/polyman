/**
 * A small FIFO lock. All CLI runs of the process go through {@link cliLock},
 * so parallel workflow workers never compile or measure time at once: two
 * runs on one problem folder both write `testsets/` and both time solutions.
 */

/** Returns the abort reason as an Error, for a rejected waiter. */
function abortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) return reason;
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

interface Waiter {
  start(): void;
}

/** Runs one function at a time, in the order they asked. */
export class Mutex {
  private locked = false;
  private readonly queue: Waiter[] = [];

  /**
   * Runs `fn` when the lock is free. A waiter whose `signal` aborts leaves
   * the queue and rejects; a running `fn` is not stopped by the lock, it has
   * to watch the signal itself.
   */
  run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortError(signal));
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        const at = this.queue.indexOf(waiter);
        if (at === -1) return;
        this.queue.splice(at, 1);
        reject(abortError(signal!));
      };
      const waiter: Waiter = {
        start: () => {
          signal?.removeEventListener('abort', onAbort);
          this.locked = true;
          void Promise.resolve()
            .then(fn)
            .then(resolve, reject)
            .finally(() => this.release());
        },
      };
      if (!this.locked) {
        waiter.start();
        return;
      }
      this.queue.push(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** Whether a function runs now. */
  isLocked(): boolean {
    return this.locked;
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      next.start();
    } else {
      this.locked = false;
    }
  }
}

/** The one lock every CLI run in this process goes through. */
export const cliLock = new Mutex();
