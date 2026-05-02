import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock, MockedFunction, MockInstance } from 'vitest';
import { spawn } from 'child_process';
import execa from 'execa';
import { CommandExecutor } from '../src/executor';
import type { ExecutionOptions } from '../src/executor';
import { fmt } from '../src/formatter';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('execa', () => ({
  __esModule: true,
  default: vi.fn(),
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../src/formatter', () => ({
  fmt: {
    dim: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    newLine: vi.fn(),
    warningIcon: vi.fn().mockReturnValue('⚠️'),
    cross: vi.fn().mockReturnValue('❌'),
  },
}));

// ---------------------------------------------------------------------------
// Mock subprocess: a then-able with `.pid` / `.kill()` matching the surface of
// an `execa.ExecaChildProcess` that the executor actually touches.
// ---------------------------------------------------------------------------

interface MockExecaResult {
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
  signal: string | undefined;
  failed: boolean;
  shortMessage?: string;
  message?: string;
  command: string;
  escapedCommand: string;
  killed: boolean;
  isCanceled: boolean;
  timedOut: boolean;
}

interface MockSubprocess extends Promise<MockExecaResult> {
  pid: number | undefined;
  kill: Mock;
  killed: boolean;
  /** Resolve the underlying execa promise with the given (partial) result. */
  __resolveWith: (overrides?: Partial<MockExecaResult>) => void;
  __rejectWith: (err: unknown) => void;
}

const baseResult = (over: Partial<MockExecaResult> = {}): MockExecaResult => ({
  stdout: '',
  stderr: '',
  exitCode: 0,
  signal: undefined,
  failed: false,
  command: '',
  escapedCommand: '',
  killed: false,
  isCanceled: false,
  timedOut: false,
  ...over,
});

/**
 * Default `kill` behavior auto-resolves the promise with a killed-by-signal
 * result, mimicking what real execa does after the child is killed. Tests that
 * want to inspect kill without auto-resolving can overwrite `sub.kill`.
 */
const createMockSubprocess = (
  pid: number | undefined = 12345
): MockSubprocess => {
  let resolveFn!: (r: MockExecaResult) => void;
  let rejectFn!: (e: unknown) => void;
  const promise = new Promise<MockExecaResult>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  }) as MockSubprocess;

  promise.pid = pid;
  promise.killed = false;
  promise.kill = vi.fn((signal?: string) => {
    promise.killed = true;
    resolveFn(
      baseResult({
        killed: true,
        exitCode: undefined,
        signal: signal ?? 'SIGTERM',
        failed: true,
        shortMessage: `Command was killed with ${signal ?? 'SIGTERM'}`,
      })
    );
  });
  promise.__resolveWith = over => resolveFn(baseResult(over));
  promise.__rejectWith = rejectFn;
  return promise;
};

// ---------------------------------------------------------------------------

describe('CommandExecutor', () => {
  let executor: CommandExecutor;
  let mockExeca: MockedFunction<typeof execa>;
  let mockSpawn: MockedFunction<typeof spawn>;

  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new CommandExecutor();
    mockExeca = vi.mocked(execa);
    mockSpawn = vi.mocked(spawn);
    Object.defineProperty(process, 'platform', { value: 'linux' });
    vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  /** Prime the next execa() call to return the given mock subprocess. */
  const primeExeca = (sub: MockSubprocess) => {
    (mockExeca as unknown as Mock).mockReturnValueOnce(sub);
  };

  // -------------------------------------------------------------------------
  // execute() — happy path & basic error routing
  // -------------------------------------------------------------------------

  describe('execute', () => {
    it('returns a successful result on exit code 0', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);

      const promise = executor.execute('echo success', { timeout: 1000 });
      sub.__resolveWith({ stdout: 'output line 1\noutput line 2' });

      const result = await promise;
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('output line 1\noutput line 2');
      expect(mockExeca).toHaveBeenCalledWith(
        'echo success',
        expect.objectContaining({ shell: true })
      );
    });

    it('throws on non-zero exit when no onError callback is given', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);

      const promise = executor.execute('badcommand', { timeout: 1000 });
      sub.__resolveWith({
        exitCode: 1,
        failed: true,
        stderr: 'command not found',
      });

      await expect(promise).rejects.toThrow('Command failed with exit code 1');
    });

    it('routes failure through onError when provided', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);
      const onError: MockedFunction<NonNullable<ExecutionOptions['onError']>> =
        vi.fn();

      const promise = executor.execute('badcommand', {
        timeout: 1000,
        onError,
      });
      sub.__resolveWith({
        exitCode: 127,
        failed: true,
        stderr: 'error details',
      });

      const result = await promise;
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(127);
      expect(onError).toHaveBeenCalledWith(result);
    });

    it('throws on spawn failure (failed + undefined exit) when no onError', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);

      const promise = executor.execute('fail_spawn', { timeout: 1000 });
      sub.__resolveWith({
        failed: true,
        exitCode: undefined,
        shortMessage: 'spawn ENOENT',
        stderr: 'spawn ENOENT',
      });

      await expect(promise).rejects.toThrow('spawn ENOENT');
    });

    it('routes spawn failure through onError when provided', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);
      const onError: MockedFunction<NonNullable<ExecutionOptions['onError']>> =
        vi.fn();

      const promise = executor.execute('fail_spawn', {
        timeout: 1000,
        onError,
      });
      sub.__resolveWith({
        failed: true,
        exitCode: undefined,
        shortMessage: 'spawn ENOENT',
        stderr: '',
      });

      const result = await promise;
      expect(result.success).toBe(false);
      expect(onError).toHaveBeenCalled();
    });

    it('runs in silent mode without throwing on success', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);
      const dimMock = vi.spyOn(fmt, 'dim');

      const promise = executor.execute('quiet', {
        timeout: 1000,
        silent: true,
      });
      sub.__resolveWith({ stdout: 'should not be printed' });
      await promise;

      expect(dimMock).not.toHaveBeenCalled();
    });

    it('invokes onSuccess on exit 0', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);
      const onSuccess: MockedFunction<
        NonNullable<ExecutionOptions['onSuccess']>
      > = vi.fn();

      const promise = executor.execute('success', {
        timeout: 1000,
        onSuccess,
      });
      sub.__resolveWith({ exitCode: 0 });

      const result = await promise;
      expect(result.success).toBe(true);
      expect(onSuccess).toHaveBeenCalledWith(result);
    });
  });

  // -------------------------------------------------------------------------
  // Timeout handling
  // -------------------------------------------------------------------------

  describe('Timeout handling', () => {
    it('throws when the timeout fires and no onTimeout is provided', async () => {
      vi.useFakeTimers();
      const sub = createMockSubprocess();
      primeExeca(sub);

      const promise = executor.execute('sleep 10', { timeout: 100 });
      const assertion = expect(promise).rejects.toThrow(
        'Process killed after 100ms timeout'
      );

      // Advance past the timeout. Default `kill` auto-resolves the subprocess
      // so the awaited execa promise unblocks.
      await vi.advanceTimersByTimeAsync(200);
      await assertion;

      vi.useRealTimers();
    });

    it('invokes onTimeout and returns a timed-out result', async () => {
      vi.useFakeTimers();
      const sub = createMockSubprocess();
      primeExeca(sub);
      const onTimeout: MockedFunction<
        NonNullable<ExecutionOptions['onTimeout']>
      > = vi.fn();

      const promise = executor.execute('sleep 10', {
        timeout: 100,
        onTimeout,
      });
      const advance = vi.advanceTimersByTimeAsync(500);

      const [result] = await Promise.all([promise, advance]);

      expect(result.timedOut).toBe(true);
      expect(result.success).toBe(false);
      expect(onTimeout).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('resolves normally if the process finishes before the timeout', async () => {
      vi.useFakeTimers();
      const sub = createMockSubprocess();
      primeExeca(sub);

      const promise = executor.execute('quick', { timeout: 5000 });
      sub.__resolveWith({ exitCode: 0 });
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result.success).toBe(true);

      vi.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // Memory limit / MLE detection
  // -------------------------------------------------------------------------

  describe('Memory limit handling', () => {
    it('detects MLE via exit code 137', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);
      const onMemoryExceeded: MockedFunction<
        NonNullable<ExecutionOptions['onMemoryExceeded']>
      > = vi.fn();

      const promise = executor.execute('oom_prog', {
        timeout: 1000,
        onMemoryExceeded,
      });
      sub.__resolveWith({ exitCode: 137, failed: true });

      const result = await promise;
      expect(result.memoryExceeded).toBe(true);
      expect(result.success).toBe(false);
      expect(onMemoryExceeded).toHaveBeenCalled();
    });

    it('detects MLE via bad_alloc in stderr', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);
      const onMemoryExceeded: MockedFunction<
        NonNullable<ExecutionOptions['onMemoryExceeded']>
      > = vi.fn();

      const promise = executor.execute('cpp_oom', {
        timeout: 1000,
        onMemoryExceeded,
      });
      sub.__resolveWith({
        exitCode: 1,
        failed: true,
        stderr: 'terminate called after throwing bad_alloc',
      });

      const result = await promise;
      expect(result.memoryExceeded).toBe(true);
      expect(onMemoryExceeded).toHaveBeenCalled();
    });

    it('detects MLE via Python MemoryError', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);
      const onMemoryExceeded: MockedFunction<
        NonNullable<ExecutionOptions['onMemoryExceeded']>
      > = vi.fn();

      const promise = executor.execute('py_oom', {
        timeout: 1000,
        onMemoryExceeded,
      });
      sub.__resolveWith({
        exitCode: 1,
        failed: true,
        stderr: 'MemoryError: Out of memory',
      });

      await promise;
      expect(onMemoryExceeded).toHaveBeenCalled();
    });

    it('throws when MLE detected and no callback provided', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);

      const promise = executor.execute('oom_no_cb', { timeout: 1000 });
      sub.__resolveWith({ exitCode: 137, failed: true });

      await expect(promise).rejects.toThrow('Memory limit exceeded');
    });
  });

  // -------------------------------------------------------------------------
  // Platform specifics
  // -------------------------------------------------------------------------

  describe('Platform specifics', () => {
    describe('Windows', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
      });

      it('normalizes ./ paths to .\\', async () => {
        vi.useFakeTimers();
        const sub = createMockSubprocess();
        primeExeca(sub);

        const promise = executor.execute('./my-prog/bin', { timeout: 1000 });
        sub.__resolveWith({ exitCode: 0 });
        // file-handle release delay
        await vi.advanceTimersByTimeAsync(200);
        await promise;

        expect(mockExeca).toHaveBeenCalledWith(
          expect.stringContaining('.\\my-prog\\bin'),
          expect.anything()
        );
        vi.useRealTimers();
      });

      it('normalizes inner forward slashes in the executable', async () => {
        vi.useFakeTimers();
        const sub = createMockSubprocess();
        primeExeca(sub);

        const promise = executor.execute('bin/executable arg1', {
          timeout: 1000,
        });
        sub.__resolveWith({ exitCode: 0 });
        await vi.advanceTimersByTimeAsync(200);
        await promise;

        expect(mockExeca).toHaveBeenCalledWith(
          expect.stringContaining('bin\\executable arg1'),
          expect.anything()
        );
        vi.useRealTimers();
      });

      it('passes detached: false to execa', async () => {
        vi.useFakeTimers();
        const sub = createMockSubprocess();
        primeExeca(sub);

        const promise = executor.execute('cmd', { timeout: 1000 });
        sub.__resolveWith({ exitCode: 0 });
        await vi.advanceTimersByTimeAsync(200);
        await promise;

        expect(mockExeca).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ detached: false })
        );
        vi.useRealTimers();
      });

      it('uses taskkill /T /F to kill the tree on timeout', async () => {
        vi.useFakeTimers();
        const sub = createMockSubprocess(9999);
        primeExeca(sub);

        const promise = executor.execute('long_run', {
          timeout: 100,
          onTimeout: () => {},
        });
        await vi.advanceTimersByTimeAsync(500);
        await promise;

        expect(mockSpawn).toHaveBeenCalledWith(
          'taskkill',
          expect.arrayContaining(['/pid', '9999', '/T', '/F']),
          expect.anything()
        );
        vi.useRealTimers();
      });

      it('waits for the file-handle release delay during cleanup', async () => {
        vi.useFakeTimers();
        const sub = createMockSubprocess();
        primeExeca(sub);

        // Start a long-running process; it stays in activeProcesses.
        void executor.execute('cmd', { timeout: 5000 }).catch(() => {});

        const cleanupPromise = executor.cleanup();
        await vi.advanceTimersByTimeAsync(200);
        await cleanupPromise;
        vi.useRealTimers();
      });

      it('does not wrap the command with ulimit / -Xmx on Windows', async () => {
        const sub = createMockSubprocess();
        primeExeca(sub);

        const promise = executor.execute('cmd', {
          timeout: 1000,
          memoryLimitMB: 256,
        });
        sub.__resolveWith({ exitCode: 0 });
        // Need to flush the post-resolve windows file-handle delay.
        vi.useFakeTimers();
        await vi.advanceTimersByTimeAsync(200);
        await promise;
        vi.useRealTimers();

        const cmd = mockExeca.mock.calls[0]?.[0];
        expect(cmd).toBe('cmd');
        expect(cmd).not.toContain('ulimit');
        expect(cmd).not.toContain('Xmx');
      });
    });

    describe('Linux/Unix', () => {
      it('wraps the command in `ulimit -v` for memory limits', async () => {
        const sub = createMockSubprocess();
        primeExeca(sub);

        const promise = executor.execute('./prog', {
          timeout: 1000,
          memoryLimitMB: 128,
        });
        sub.__resolveWith({ exitCode: 0 });
        await promise;

        expect(mockExeca).toHaveBeenCalledWith(
          expect.stringContaining('ulimit -v 131072; ./prog'),
          expect.anything()
        );
      });

      it('rewrites Java commands with -Xmx', async () => {
        const sub = createMockSubprocess();
        primeExeca(sub);

        const promise = executor.execute('java Main', {
          timeout: 1000,
          memoryLimitMB: 256,
        });
        sub.__resolveWith({ exitCode: 0 });
        await promise;

        expect(mockExeca).toHaveBeenCalledWith(
          expect.stringContaining('java -Xmx256m Main'),
          expect.anything()
        );
      });

      it('kills the process group with negative PID + SIGKILL on timeout', async () => {
        vi.useFakeTimers();
        const sub = createMockSubprocess(5555);
        primeExeca(sub);

        const killSpy: MockInstance<typeof process.kill> = vi
          .spyOn(process, 'kill')
          .mockImplementation(() => true);

        const promise = executor.execute('run', {
          timeout: 100,
          onTimeout: () => {},
        });
        await vi.advanceTimersByTimeAsync(500);
        await promise;

        expect(killSpy).toHaveBeenCalledWith(-5555, 'SIGKILL');
        vi.useRealTimers();
      });

      it('swallows ESRCH errors from process.kill', async () => {
        vi.useFakeTimers();
        const sub = createMockSubprocess(5555);
        primeExeca(sub);

        vi.spyOn(process, 'kill').mockImplementation(() => {
          const err = new Error('ESRCH') as Error & { code?: string };
          err.code = 'ESRCH';
          throw err;
        });
        const consoleSpy = vi
          .spyOn(console, 'log')
          .mockImplementation(() => {});

        const promise = executor.execute('run', {
          timeout: 100,
          onTimeout: () => {},
        });
        await vi.advanceTimersByTimeAsync(500);
        await promise;

        expect(consoleSpy).not.toHaveBeenCalled();
        vi.useRealTimers();
      });

      it('logs non-ESRCH kill errors', async () => {
        vi.useFakeTimers();
        const sub = createMockSubprocess(5555);
        primeExeca(sub);

        const killErr = new Error('Unexpected Error');
        vi.spyOn(process, 'kill').mockImplementation(() => {
          throw killErr;
        });
        const consoleSpy = vi
          .spyOn(console, 'log')
          .mockImplementation(() => {});

        const promise = executor.execute('run', {
          timeout: 100,
          onTimeout: () => {},
        });
        await vi.advanceTimersByTimeAsync(500);
        await promise;

        expect(consoleSpy).toHaveBeenCalledWith(killErr);
        vi.useRealTimers();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Callback edge cases
  // -------------------------------------------------------------------------

  describe('Callback edge cases', () => {
    it('propagates onTimeout callback errors', async () => {
      vi.useFakeTimers();
      const sub = createMockSubprocess();
      primeExeca(sub);

      const cbErr = new Error('Callback Error');
      const promise = executor.execute('run', {
        timeout: 100,
        onTimeout: () => {
          throw cbErr;
        },
      });
      const assertion = expect(promise).rejects.toThrow('Callback Error');
      await vi.advanceTimersByTimeAsync(500);
      await assertion;

      vi.useRealTimers();
    });

    it('propagates onMemoryExceeded callback errors', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);

      const cbErr = new Error('MLE Callback Error');
      const promise = executor.execute('run', {
        timeout: 1000,
        onMemoryExceeded: () => {
          throw cbErr;
        },
      });
      sub.__resolveWith({ exitCode: 137, failed: true });

      await expect(promise).rejects.toThrow('MLE Callback Error');
    });

    it('propagates onError callback errors', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);

      const cbErr = new Error('onError Boom');
      const promise = executor.execute('fail', {
        timeout: 1000,
        onError: () => {
          throw cbErr;
        },
      });
      sub.__resolveWith({ exitCode: 1, failed: true, stderr: 'oops' });

      await expect(promise).rejects.toThrow('onError Boom');
    });
  });

  // -------------------------------------------------------------------------
  // Redirection & utilities
  // -------------------------------------------------------------------------

  describe('Redirection & utilities', () => {
    it('builds a redirected command with input and output files', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);

      const promise = executor.executeWithRedirect(
        './prog',
        { timeout: 1000 },
        'in.txt',
        'out.txt'
      );
      sub.__resolveWith({ exitCode: 0 });
      await promise;

      const cmd = mockExeca.mock.calls[0]?.[0];
      expect(cmd).toContain('< "in.txt"');
      expect(cmd).toContain('> "out.txt"');
    });

    it('normalizes redirected paths for Windows', async () => {
      vi.useFakeTimers();
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const sub = createMockSubprocess();
      primeExeca(sub);

      const promise = executor.executeWithRedirect(
        './prog',
        { timeout: 1000 },
        './folder/in.txt',
        'out.txt'
      );
      sub.__resolveWith({ exitCode: 0 });
      await vi.advanceTimersByTimeAsync(200);
      await promise;

      const cmd = mockExeca.mock.calls[0]?.[0];
      expect(cmd).toContain('< ".\\folder\\in.txt"');
      vi.useRealTimers();
    });

    it('handles Windows redirection with parent-dir paths', async () => {
      vi.useFakeTimers();
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const sub = createMockSubprocess();
      primeExeca(sub);

      const promise = executor.executeWithRedirect(
        'cmd',
        { timeout: 1000 },
        '../input.txt',
        '../output.txt'
      );
      sub.__resolveWith({ exitCode: 0 });
      await vi.advanceTimersByTimeAsync(200);
      await promise;

      const cmd = mockExeca.mock.calls[0]?.[0];
      expect(cmd).toContain('..\\input.txt');
      expect(cmd).toContain('..\\output.txt');
      vi.useRealTimers();
    });

    it('builds a partial redirection (input only)', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);

      const promise = executor.executeWithRedirect(
        'cmd',
        { timeout: 1000 },
        'in.txt'
      );
      sub.__resolveWith({ exitCode: 0 });
      await promise;

      const cmd = mockExeca.mock.calls[0]?.[0];
      expect(cmd).toContain('< "in.txt"');
      expect(cmd).not.toContain('>');
    });

    it('builds a partial redirection (output only)', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);

      const promise = executor.executeWithRedirect(
        'cmd',
        { timeout: 1000 },
        undefined,
        'out.txt'
      );
      sub.__resolveWith({ exitCode: 0 });
      await promise;

      const cmd = mockExeca.mock.calls[0]?.[0];
      expect(cmd).toContain('> "out.txt"');
      expect(cmd).not.toContain('<');
    });

    it('registers and retrieves temp files', () => {
      executor.registerTempFile('tmp1');
      executor.registerTempFile('tmp2');
      expect(executor.getTempFiles()).toEqual(['tmp1', 'tmp2']);
    });

    it('cleans up temp files and kills active processes', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);

      void executor.execute('run', { timeout: 10000 }).catch(() => {});
      executor.registerTempFile('somefile');
      await executor.cleanup();

      expect(sub.kill).toHaveBeenCalledWith('SIGKILL');
      expect(executor.getTempFiles()).toEqual([]);
    });

    it('tolerates kill() throwing during cleanup', async () => {
      const sub = createMockSubprocess();
      sub.kill = vi.fn(() => {
        throw new Error('Process dead');
      });
      primeExeca(sub);

      void executor.execute('run', { timeout: 10000 }).catch(() => {});
      await expect(executor.cleanup()).resolves.toBeUndefined();
      expect(sub.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('skips kill() during cleanup when pid is undefined', async () => {
      const sub = createMockSubprocess();
      sub.pid = undefined;
      primeExeca(sub);

      void executor.execute('run', { timeout: 10000 }).catch(() => {});
      await executor.cleanup();
      expect(sub.kill).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Output / silent / misc
  // -------------------------------------------------------------------------

  describe('Output & misc', () => {
    it('prints stdout via fmt.dim on success when not silent', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);
      const dimMock = vi.spyOn(fmt, 'dim');

      const promise = executor.execute('ok', { timeout: 1000 });
      sub.__resolveWith({ stdout: 'Output' });
      await promise;

      expect(dimMock).toHaveBeenCalledWith('Output');
    });

    it('does not print warnings on MLE in silent mode', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);
      const warningMock = vi.spyOn(fmt, 'warning');
      const onMemoryExceeded: MockedFunction<
        NonNullable<ExecutionOptions['onMemoryExceeded']>
      > = vi.fn();

      const promise = executor.execute('oom', {
        timeout: 1000,
        silent: true,
        onMemoryExceeded,
      });
      sub.__resolveWith({ exitCode: 137, failed: true });
      await promise;

      expect(onMemoryExceeded).toHaveBeenCalled();
      expect(warningMock).not.toHaveBeenCalled();
    });

    it('does not print errors on spawn failure in silent mode', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);
      const errorMock = vi.spyOn(fmt, 'error');

      const promise = executor.execute('fail', {
        timeout: 1000,
        silent: true,
      });
      sub.__resolveWith({
        failed: true,
        exitCode: undefined,
        shortMessage: 'spawn failed',
      });
      await expect(promise).rejects.toThrow();

      expect(errorMock).not.toHaveBeenCalled();
    });

    it('normalizes ./solution to .\\solution on Windows (single token)', async () => {
      vi.useFakeTimers();
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const sub = createMockSubprocess();
      primeExeca(sub);

      const promise = executor.execute('./solution', { timeout: 1000 });
      sub.__resolveWith({ exitCode: 0 });
      await vi.advanceTimersByTimeAsync(200);
      await promise;

      expect(mockExeca.mock.calls[0]?.[0]).toBe('.\\solution');
      vi.useRealTimers();
    });

    it('normalizes bin/solution to bin\\solution on Windows', async () => {
      vi.useFakeTimers();
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const sub = createMockSubprocess();
      primeExeca(sub);

      const promise = executor.execute('bin/solution', { timeout: 1000 });
      sub.__resolveWith({ exitCode: 0 });
      await vi.advanceTimersByTimeAsync(200);
      await promise;

      expect(mockExeca.mock.calls[0]?.[0]).toBe('bin\\solution');
      vi.useRealTimers();
    });

    it('treats undefined exitCode without failed-flag as a generic error', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);

      const promise = executor.execute('run', { timeout: 1000 });
      // failed: false + exitCode: undefined → defaults to exitCode 1, error path.
      sub.__resolveWith({ exitCode: undefined, failed: false });

      await expect(promise).rejects.toThrow('Command failed with exit code 1');
    });

    it('handles execa rejecting (defensive spawn-error path)', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);

      const promise = executor.execute('run', { timeout: 1000 });
      sub.__rejectWith(new Error('Unexpected execa rejection'));

      await expect(promise).rejects.toThrow('Unexpected execa rejection');
    });

    it('runs an empty command string', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);

      const promise = executor.execute('', { timeout: 1000 });
      sub.__resolveWith({ exitCode: 0 });
      await promise;

      expect(mockExeca).toHaveBeenCalledWith('', expect.anything());
    });

    it('passes cwd through to execa when provided', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);

      const promise = executor.execute('run', {
        timeout: 1000,
        cwd: '/tmp/run',
      });
      sub.__resolveWith({ exitCode: 0 });
      await promise;

      expect(mockExeca).toHaveBeenCalledWith(
        'run',
        expect.objectContaining({ cwd: '/tmp/run' })
      );
    });

    it('omits cwd from execa options when not provided', async () => {
      const sub = createMockSubprocess();
      primeExeca(sub);

      const promise = executor.execute('run', { timeout: 1000 });
      sub.__resolveWith({ exitCode: 0 });
      await promise;

      const opts = mockExeca.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(opts.cwd).toBeUndefined();
    });
  });
});
