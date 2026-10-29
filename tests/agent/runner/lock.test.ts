import { describe, expect, it } from 'vitest';
import { Mutex, cliLock } from '../../../src/agent/runner/lock';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('Mutex', () => {
  it('runs functions one at a time, in FIFO order', async () => {
    const mutex = new Mutex();
    const order: string[] = [];
    let running = 0;
    const task = (name: string, ms: number) => async () => {
      running += 1;
      expect(running).toBe(1);
      order.push(`start ${name}`);
      await new Promise(resolve => setTimeout(resolve, ms));
      order.push(`end ${name}`);
      running -= 1;
      return name;
    };
    const results = await Promise.all([
      mutex.run(task('a', 30)),
      mutex.run(task('b', 5)),
      mutex.run(task('c', 1)),
    ]);
    expect(results).toEqual(['a', 'b', 'c']);
    expect(order).toEqual([
      'start a',
      'end a',
      'start b',
      'end b',
      'start c',
      'end c',
    ]);
    expect(mutex.isLocked()).toBe(false);
  });

  it('releases the lock when a function fails', async () => {
    const mutex = new Mutex();
    await expect(
      mutex.run(() => Promise.reject(new Error('boom')))
    ).rejects.toThrow('boom');
    await expect(
      mutex.run(() => {
        throw new Error('sync boom');
      })
    ).rejects.toThrow('sync boom');
    expect(await mutex.run(() => Promise.resolve(7))).toBe(7);
  });

  it('removes an aborted waiter from the queue', async () => {
    const mutex = new Mutex();
    const gate = deferred();
    const ran: string[] = [];
    const first = mutex.run(async () => {
      await gate.promise;
      ran.push('first');
    });
    const controller = new AbortController();
    const second = mutex.run(() => {
      ran.push('second');
      return Promise.resolve();
    }, controller.signal);
    const third = mutex.run(() => {
      ran.push('third');
      return Promise.resolve();
    });

    controller.abort();
    await expect(second).rejects.toThrow();
    gate.resolve();
    await first;
    await third;
    expect(ran).toEqual(['first', 'third']);
  });

  it('rejects at once when the signal is already aborted', async () => {
    const mutex = new Mutex();
    const controller = new AbortController();
    controller.abort();
    let ran = false;
    await expect(
      mutex.run(() => {
        ran = true;
        return Promise.resolve();
      }, controller.signal)
    ).rejects.toThrow();
    expect(ran).toBe(false);
    expect(mutex.isLocked()).toBe(false);
  });

  it('does not stop a running function when its signal aborts', async () => {
    const mutex = new Mutex();
    const controller = new AbortController();
    const result = mutex.run(async () => {
      controller.abort();
      await new Promise(resolve => setTimeout(resolve, 5));
      return 'done';
    }, controller.signal);
    expect(await result).toBe('done');
  });

  it('exports one shared lock', () => {
    expect(cliLock).toBeInstanceOf(Mutex);
  });
});
