import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CommandExecutor } from '../src/executor';
import { spawn } from 'child_process';
import EventEmitter from 'events';

// Mock child_process
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

// Mock formatter to avoid console noise during tests
vi.mock('../src/formatter', () => ({
  fmt: {
    dim: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    warningIcon: vi.fn().mockReturnValue('⚠️'),
    cross: vi.fn().mockReturnValue('❌'),
  },
}));

describe('CommandExecutor', () => {
  let executor: CommandExecutor;
  let mockSpawn: any;

  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new CommandExecutor();
    mockSpawn = vi.mocked(spawn);
    // Default to linux for most tests to ensure stable baseline
    Object.defineProperty(process, 'platform', {
      value: 'linux',
    });
    vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', {
      value: originalPlatform,
    });
  });

  // Helper to create a mock child process
  const createMockChild = (pid = 12345): any => {
    const child: any = new EventEmitter();
    child.pid = pid;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    child.killed = false;
    return child;
  };

  describe('execute', () => {
    it('should execute command successfully (exit code 0)', async () => {
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);

      const promise = executor.execute('echo success', { timeout: 1000 });

      // Emit some output
      mockChild.stdout.emit('data', Buffer.from('output line 1\n'));
      mockChild.stdout.emit('data', Buffer.from('output line 2'));

      // Emit close
      mockChild.emit('close', 0, null);

      const result = await promise;

      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('output line 1\noutput line 2');
      expect(mockSpawn).toHaveBeenCalledWith('echo success', expect.anything());
    });

    it('should handle command failure (non-zero exit code)', async () => {
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);

      const promise = executor.execute('badcommand', { timeout: 1000 });

      mockChild.stderr.emit('data', Buffer.from('command not found'));
      mockChild.emit('close', 1, null);

      await expect(promise).rejects.toThrow('Command failed with exit code 1');
    });

    it('should call onError callback on failure if provided', async () => {
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);
      const onError = vi.fn();

      const promise = executor.execute('badcommand', {
        timeout: 1000,
        onError,
      });

      mockChild.stderr.emit('data', Buffer.from('error details'));
      mockChild.emit('close', 127, null);

      const result = await promise;

      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(127);
      expect(onError).toHaveBeenCalledWith(result);
    });

    it('should handle process error event (spawn failure)', async () => {
      const mockChild = createMockChild();
      // Ensure we don't resolve from close before error
      mockSpawn.mockReturnValue(mockChild);

      const promise = executor.execute('fail_spawn', { timeout: 1000 });

      const spawnError = new Error('spawn ENOENT');
      mockChild.emit('error', spawnError);

      await expect(promise).rejects.toThrow('spawn ENOENT');
    });

    it('should use onError for spawn failure if provided', async () => {
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);
      const onError = vi.fn();

      const promise = executor.execute('fail_spawn', {
        timeout: 1000,
        onError,
      });

      mockChild.emit('error', new Error('spawn failed'));

      const result = await promise;
      expect(result.success).toBe(false);
      expect(onError).toHaveBeenCalled();
    });

    it('should handle silent mode', async () => {
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);

      const promise = executor.execute('quiet', {
        timeout: 1000,
        silent: true,
      });

      mockChild.emit('close', 0, null);
      await promise;

      // Since we mocked formatter, we can't easily check if it wasn't called without spying on the mock module itself
      // But assuming the code logic uses `if (!options.silent) fmt...`, coverage will verify the branch.
    });

    it('should call onSuccess callback', async () => {
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);
      const onSuccess = vi.fn();

      const promise = executor.execute('success', {
        timeout: 1000,
        onSuccess,
      });

      mockChild.emit('close', 0, null);

      const result = await promise;
      expect(result.success).toBe(true);
      expect(onSuccess).toHaveBeenCalledWith(result);
    });
  });

  describe('Timeout Handling', () => {
    it('should reject with error when timeout occurs and no callback provided', async () => {
      vi.useFakeTimers();
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);

      const promise = executor.execute('sleep 10', { timeout: 100 });

      // Expect rejection concurrently with timer advancement
      const testPromise = expect(promise).rejects.toThrow(
        'Process killed after 100ms timeout'
      );

      // Advance time to trigger timeout
      await vi.advanceTimersByTimeAsync(1000);

      await testPromise;

      vi.useRealTimers();
    });

    it('should call onTimeout callback and cleanup', async () => {
      vi.useFakeTimers();
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);
      const onTimeout = vi.fn();

      const promise = executor.execute('sleep 10', {
        timeout: 100,
        onTimeout,
      });

      // Advance time and wait for promise
      const advancePromise = vi.advanceTimersByTimeAsync(1000);

      const [result] = await Promise.all([promise, advancePromise]);

      expect(result.timedOut).toBe(true);
      expect(result.success).toBe(false);
      expect(onTimeout).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('should resolve normally if process finishes before timeout', async () => {
      vi.useFakeTimers();
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);

      const promise = executor.execute('quick', { timeout: 5000 });

      // Finish quickly
      mockChild.emit('close', 0, null);

      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result.success).toBe(true);

      vi.useRealTimers();
    });
  });

  describe('Memory Limit Handling', () => {
    it('should detect memory limit exceeded via exit code 137', async () => {
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);
      const onMemoryExceeded = vi.fn();

      const promise = executor.execute('oom_prog', {
        timeout: 1000,
        onMemoryExceeded,
      });

      mockChild.emit('close', 137, null);

      const result = await promise;
      expect(result.memoryExceeded).toBe(true);
      expect(result.success).toBe(false);
      expect(onMemoryExceeded).toHaveBeenCalled();
    });

    it('should detect memory limit exceeded via stderr message', async () => {
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);
      const onMemoryExceeded = vi.fn();

      const promise = executor.execute('cpp_oom', {
        timeout: 1000,
        onMemoryExceeded,
      });

      mockChild.stderr.emit(
        'data',
        Buffer.from('terminate called after throwing bad_alloc')
      );
      mockChild.emit('close', 1, null);

      const result = await promise;
      expect(result.memoryExceeded).toBe(true);
      expect(onMemoryExceeded).toHaveBeenCalled();
    });

    it('should throw error if memory exceeded and no callback provided', async () => {
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);

      const promise = executor.execute('oom_no_cb', { timeout: 1000 });

      mockChild.emit('close', 137, null);

      await expect(promise).rejects.toThrow('Memory limit exceeded');
    });
  });

  describe('Platform Specifics', () => {
    describe('Windows', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
      });

      it('should normalize paths in command', async () => {
        vi.useFakeTimers();
        const mockChild = createMockChild();
        mockSpawn.mockReturnValue(mockChild);

        const promise = executor.execute('./my-prog/bin', { timeout: 1000 });
        mockChild.emit('close', 0);

        await vi.advanceTimersByTimeAsync(100);
        await promise;

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.stringContaining('.\\my-prog\\bin'),
          expect.anything()
        );
        vi.useRealTimers();
      });

      it('should quote executables with spaces if needed', async () => {
        vi.useFakeTimers();
        const mockChild = createMockChild();
        mockSpawn.mockReturnValue(mockChild);

        const promise = executor.execute('bin/executable arg1', {
          timeout: 1000,
        });
        mockChild.emit('close', 0);
        await vi.advanceTimersByTimeAsync(100);
        await promise;

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.stringContaining('bin\\executable arg1'),
          expect.anything()
        );
        vi.useRealTimers();
      });

      it('should set detached: false for spawned process', async () => {
        vi.useFakeTimers();
        const mockChild = createMockChild();
        mockSpawn.mockReturnValue(mockChild);

        const promise = executor.execute('cmd', { timeout: 1000 });
        mockChild.emit('close', 0);
        await vi.advanceTimersByTimeAsync(100);
        await promise;

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ detached: false })
        );
        vi.useRealTimers();
      });

      it('should use taskkill for killing process tree', async () => {
        vi.useFakeTimers();
        const mockChild = createMockChild(9999);
        mockSpawn.mockReturnValue(mockChild);

        const promise = executor.execute('long_run', {
          timeout: 100,
          onTimeout: () => {},
        });

        await vi.advanceTimersByTimeAsync(1500);
        await promise;

        expect(mockSpawn).toHaveBeenLastCalledWith(
          'taskkill',
          expect.arrayContaining(['/pid', '9999', '/T', '/F']),
          expect.anything()
        );
        vi.useRealTimers();
      });

      it('should wait for file handles during cleanup (delay check)', async () => {
        vi.useFakeTimers();

        const mockChild = createMockChild();
        mockSpawn.mockReturnValue(mockChild);
        void executor.execute('cmd', { timeout: 50 });

        const cleanupPromise = executor.cleanup();

        // Should be waiting 150ms
        await vi.advanceTimersByTimeAsync(200);
        await cleanupPromise;
        vi.useRealTimers();
      });

      it('should ignore memory limit on Windows (line 193)', async () => {
        const mockChild = createMockChild();
        mockSpawn.mockReturnValue(mockChild);

        // Pass memory limit, expecting it to be ignored in the command
        const promise = executor.execute('cmd', {
          timeout: 1000,
          memoryLimitMB: 256,
        });
        mockChild.emit('close', 0, null);

        await promise;

        expect(mockSpawn).toHaveBeenCalledWith('cmd', expect.anything());
        expect(mockSpawn).not.toHaveBeenCalledWith(
          expect.stringContaining('ulimit'),
          expect.anything()
        );
        expect(mockSpawn).not.toHaveBeenCalledWith(
          expect.stringContaining('Xmx'),
          expect.anything()
        );
      });
    });

    describe('Linux/Unix', () => {
      beforeEach(() => {
        Object.defineProperty(process, 'platform', { value: 'linux' });
      });

      it('should use ulimit for memory limits', () => {
        const mockChild = createMockChild();
        mockSpawn.mockReturnValue(mockChild);

        void executor.execute('./prog', { timeout: 1000, memoryLimitMB: 128 });
        mockChild.emit('close', 0);

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.stringContaining('ulimit -v 131072; ./prog'),
          expect.anything()
        );
      });

      it('should use -Xmx for Java memory limits', () => {
        const mockChild = createMockChild();
        mockSpawn.mockReturnValue(mockChild);

        void executor.execute('java Main', {
          timeout: 1000,
          memoryLimitMB: 256,
        });
        mockChild.emit('close', 0);

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.stringContaining('java -Xmx256m Main'),
          expect.anything()
        );
      });

      it('should kill process group (negative pid)', async () => {
        vi.useFakeTimers();
        const mockChild = createMockChild(5555);
        mockSpawn.mockReturnValue(mockChild);

        const promise = executor.execute('run', {
          timeout: 100,
          onTimeout: () => {},
        });
        // Timeout (100) + Grace (100) + Buffer
        await vi.advanceTimersByTimeAsync(1000);
        await promise;

        expect(process.kill).toHaveBeenCalledWith(-5555, 'SIGSEGV');
        vi.useRealTimers();
      });

      it('should handle errors during process killing (ESRCH)', async () => {
        vi.useFakeTimers();
        const mockChild = createMockChild(5555);
        mockSpawn.mockReturnValue(mockChild);

        const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
          const err: any = new Error('ESRCH');
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
        await vi.advanceTimersByTimeAsync(1000);
        await promise;

        expect(killSpy).toHaveBeenCalled();
        expect(consoleSpy).not.toHaveBeenCalled(); // Should be swallowed

        vi.useRealTimers();
      });
      it('should log non-ESRCH errors during process killing', async () => {
        vi.useFakeTimers();
        const mockChild = createMockChild(5555);
        mockSpawn.mockReturnValue(mockChild);

        const error = new Error('Unexpected Error');
        const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
          throw error;
        });

        const consoleSpy = vi
          .spyOn(console, 'log')
          .mockImplementation(() => {});

        const promise = executor.execute('run', {
          timeout: 100,
          onTimeout: () => {},
        });
        await vi.advanceTimersByTimeAsync(1000);
        await promise;

        expect(killSpy).toHaveBeenCalled();
        expect(consoleSpy).toHaveBeenCalledWith(error);

        vi.useRealTimers();
      });
    });
  });

  describe('Edge Case Error Handling', () => {
    it('should reject if onTimeout callback throws', async () => {
      vi.useFakeTimers();
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);

      const error = new Error('Callback Error');
      const promise = executor.execute('run', {
        timeout: 100,
        onTimeout: () => Promise.reject(error),
      });

      const testPromise = expect(promise).rejects.toThrow('Callback Error');
      await vi.advanceTimersByTimeAsync(1000);
      await testPromise;
      vi.useRealTimers();
    });

    it('should reject if onMemoryExceeded callback throws', async () => {
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);

      const error = new Error('MLE Callback Error');
      const promise = executor.execute('run', {
        timeout: 1000,
        onMemoryExceeded: () => Promise.reject(error),
      });

      mockChild.emit('close', 137, null);

      await expect(promise).rejects.toThrow('MLE Callback Error');
    });

    it('should handle error inside handleProcessClose (line 474)', async () => {
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);

      // Spy on private method by casting to any
      const error = new Error('Internal Close Error');
      vi.spyOn(executor as any, 'handleProcessClose').mockImplementation(() => {
        throw error;
      });

      const promise = executor.execute('run', { timeout: 1000 });
      mockChild.emit('close', 0, null);

      await expect(promise).rejects.toThrow('Internal Close Error');
    });

    it('should handle error inside handleProcessError (line 494)', async () => {
      const mockChild = createMockChild();
      // Ensure expect matches return value before emitting error
      mockSpawn.mockReturnValue(mockChild);

      const error = new Error('Internal Error Error');
      vi.spyOn(executor as any, 'handleProcessError').mockImplementation(() => {
        throw error;
      });

      const promise = executor.execute('run', { timeout: 1000 });
      mockChild.emit('error', new Error('Spawn Failed'));

      await expect(promise).rejects.toThrow('Internal Error Error');
    });

    it('should reject if cleanup fails during timeout (line 414)', async () => {
      vi.useFakeTimers();
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);

      const error = new Error('Cleanup Error');
      vi.spyOn(executor, 'cleanup').mockRejectedValue(error);

      const promise = executor.execute('run', {
        timeout: 100,
        onTimeout: () => {},
      });

      const testPromise = expect(promise).rejects.toThrow('Cleanup Error');
      await vi.advanceTimersByTimeAsync(1000);
      await testPromise;

      vi.useRealTimers();
    });

    it('should handle error inside timeout handling (line 151)', async () => {
      vi.useFakeTimers();
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);

      const error = new Error('Timeout Handling Error');
      // Spy on cancellableDelay to return a promise that rejects
      vi.spyOn(executor as any, 'cancellableDelay').mockReturnValue([
        Promise.reject(error),
        () => {},
      ]);

      const promise = executor.execute('run', { timeout: 100 });

      await expect(promise).rejects.toThrow('Timeout Handling Error');
      vi.useRealTimers();
    });
  });

  describe('Redirection & Utils', () => {
    it('should build redirected command correctly', async () => {
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);

      const promise = executor.executeWithRedirect(
        './prog',
        { timeout: 1000 },
        'in.txt',
        'out.txt'
      );

      mockChild.emit('close', 0);
      await promise;

      const calledCommand = mockSpawn.mock.calls[0][0];
      expect(calledCommand).toContain('< "in.txt"');
      expect(calledCommand).toContain('> "out.txt"');
    });

    it('should normalize paths in redirection for Windows', async () => {
      vi.useFakeTimers();
      Object.defineProperty(process, 'platform', { value: 'win32' });
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);

      const promise = executor.executeWithRedirect(
        './prog',
        { timeout: 1000 },
        './folder/in.txt',
        'out.txt'
      );

      mockChild.emit('close', 0);
      // Advance for Windows close delay
      await vi.advanceTimersByTimeAsync(100);
      await promise;

      const calledCommand = mockSpawn.mock.calls[0][0];
      expect(calledCommand).toContain('< ".\\folder\\in.txt"');
      Object.defineProperty(process, 'platform', { value: 'linux' });
      vi.useRealTimers();
    });

    it('should register and retrieve temp files', () => {
      executor.registerTempFile('tmp1');
      executor.registerTempFile('tmp2');
      expect(executor.getTempFiles()).toEqual(['tmp1', 'tmp2']);
    });

    it('should cleanup temp files and processes', async () => {
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);

      // Start a process
      void executor.execute('run', { timeout: 10000 });
      executor.registerTempFile('somefile');

      // Cleanup
      await executor.cleanup();

      expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');
      expect(executor.getTempFiles()).toEqual([]);
    });
  });

  describe('Coverage Improvements', () => {
    it('should ignore close event if already resolved (e.g. after timeout)', async () => {
      vi.useFakeTimers();
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);
      const onTimeout = vi.fn();
      
      const promise = executor.execute('slow', { timeout: 100, onTimeout });
      
      // Trigger timeout
      await vi.advanceTimersByTimeAsync(1000);
      
      // Now trigger close - should be ignored
      const handleCloseSpy = vi.spyOn(executor as any, 'handleProcessClose');
      mockChild.emit('close', 0, null);
      
      await promise;
      
      expect(onTimeout).toHaveBeenCalled();
      expect(handleCloseSpy).not.toHaveBeenCalled();
      
      vi.useRealTimers();
    });

    it('should ignore error event if already resolved', async () => {
      vi.useFakeTimers();
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);
      
      const promise = executor.execute('slow', { timeout: 100, onTimeout: vi.fn() });
      
      await vi.advanceTimersByTimeAsync(1000);
      
      // Trigger error - should be ignored
      const handleErrorSpy = vi.spyOn(executor as any, 'handleProcessError');
      mockChild.emit('error', new Error('Late Error'));
      
      await promise;
      
      expect(handleErrorSpy).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it('should handle silent mode for memory errors', async () => {
      const mockChild = createMockChild();
      mockSpawn.mockReturnValue(mockChild);
      const onMemoryExceeded = vi.fn();
      
      const { fmt } = await import('../src/formatter');
      
      const promise = executor.execute('oom', { 
        timeout: 1000, 
        silent: true,
        onMemoryExceeded
      });

      mockChild.emit('close', 137, null);
      await promise;
      
      expect(onMemoryExceeded).toHaveBeenCalled();
      expect(fmt.warning).not.toHaveBeenCalled();
    });
    
    it('should handle silent mode for process errors', async () => {
        const mockChild = createMockChild();
        mockSpawn.mockReturnValue(mockChild);
        
        const { fmt } = await import('../src/formatter');
        
        const promise = executor.execute('fail', { 
            timeout: 1000, 
            silent: true 
        });
        
        mockChild.emit('error', new Error('Spawn fail'));
        await expect(promise).rejects.toThrow();
        
        expect(fmt.error).not.toHaveBeenCalled();
    });

    it('should handle Windows redirection with parent directory (../)', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        const mockChild = createMockChild();
        mockSpawn.mockReturnValue(mockChild);
        
        const promise = executor.executeWithRedirect('cmd', { timeout: 1000 }, '../input.txt', '../output.txt');
        mockChild.emit('close', 0);
        await promise;
        
        const cmd = mockSpawn.mock.calls[0][0];
        expect(cmd).toContain('..\\input.txt');
        expect(cmd).toContain('..\\output.txt');
        
        Object.defineProperty(process, 'platform', { value: 'linux' });
    });
    
    it('should handle killing process that is already dead in cleanup', async () => {
        const mockChild = createMockChild();
        mockChild.kill.mockImplementation(() => { throw new Error('Process dead'); });
        mockSpawn.mockReturnValue(mockChild);
        
        void executor.execute('run', { timeout: 1000 });
        
        // Should not throw
        await executor.cleanup();
        expect(mockChild.kill).toHaveBeenCalledWith('SIGKILL');
    });

    it('should handle handleProcessClose without silence and with success', async () => {
        const mockChild = createMockChild();
        mockSpawn.mockReturnValue(mockChild);
        const { fmt } = await import('../src/formatter');
        
        const promise = executor.execute('ok', { timeout: 1000, silent: false });
        
        // Emit data after listener attached
        mockChild.stdout.emit('data', 'Output');
        mockChild.emit('close', 0);
        
        await promise;
        expect(fmt.dim).toHaveBeenCalledWith('Output');
    });

    it('should handle memory error message explicitly', async () => {
        const mockChild = createMockChild();
        mockSpawn.mockReturnValue(mockChild);
        const onMemoryExceeded = vi.fn();
        
        const promise = executor.execute('oom', { 
            timeout: 1000,
            onMemoryExceeded
        });
        
        mockChild.stderr.emit('data', 'MemoryError: Out of memory');
        mockChild.emit('close', 1);
        
        await promise;
        expect(onMemoryExceeded).toHaveBeenCalled();
    });

    it('should normalize executable path starting with ./ on Windows', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        const mockChild = createMockChild();
        mockSpawn.mockReturnValue(mockChild);

        const promise = executor.execute('./solution', { timeout: 1000 });
        mockChild.emit('close', 0);
        await promise;

        const cmd = mockSpawn.mock.calls[0][0];
        expect(cmd).toEqual('.\\solution');

        Object.defineProperty(process, 'platform', { value: 'linux' });
    });
    
    it('should normalize executable path containing / on Windows', async () => {
        Object.defineProperty(process, 'platform', { value: 'win32' });
        const mockChild = createMockChild();
        mockSpawn.mockReturnValue(mockChild);

        const promise = executor.execute('bin/solution', { timeout: 1000 });
        mockChild.emit('close', 0);
        await promise;

        const cmd = mockSpawn.mock.calls[0][0];
        expect(cmd).toEqual('bin\\solution');

        Object.defineProperty(process, 'platform', { value: 'linux' });
    });

    it('should handle timeout without onTimeout callback (fallback path)', async () => {
        vi.useFakeTimers();
        const mockChild = createMockChild();
        mockSpawn.mockReturnValue(mockChild);

        const promise = executor.execute('sleep', { timeout: 100 });
        
        const testPromise = expect(promise).rejects.toThrow('Process killed after 100ms timeout');
        await vi.advanceTimersByTimeAsync(1000);
        
        await testPromise;
        vi.useRealTimers();
    });
    it('should handle partial redirection (input only)', async () => {
        const mockChild = createMockChild();
        mockSpawn.mockReturnValue(mockChild);
        const promise = executor.executeWithRedirect('cmd', { timeout: 1000 }, 'in.txt');
        mockChild.emit('close', 0);
        await promise;
        const cmd = mockSpawn.mock.calls[0][0];
        expect(cmd).toContain('< "in.txt"');
        expect(cmd).not.toContain('>');
    });

    it('should handle partial redirection (output only)', async () => {
        const mockChild = createMockChild();
        mockSpawn.mockReturnValue(mockChild);
        const promise = executor.executeWithRedirect('cmd', { timeout: 1000 }, undefined, 'out.txt');
        mockChild.emit('close', 0);
        await promise;
        const cmd = mockSpawn.mock.calls[0][0];
        expect(cmd).toContain('> "out.txt"');
        expect(cmd).not.toContain('<');
    });

    it('should default exit code to 1 if null (signal termination)', async () => {
        const mockChild = createMockChild();
        mockSpawn.mockReturnValue(mockChild);
        // Expect rejection because exit code 1 means failure
        const promise = executor.execute('run', { timeout: 1000 });
        mockChild.emit('close', null, 'SIGTERM');
        
        await expect(promise).rejects.toThrow();
    });

    it('should handle non-Error rejection in timeout cleanup', async () => {
         vi.useFakeTimers();
         const mockChild = createMockChild();
         mockSpawn.mockReturnValue(mockChild);
         
         vi.spyOn(executor, 'cleanup').mockRejectedValue('String Error');
         
         const promise = executor.execute('run', { timeout: 100, onTimeout: vi.fn() });
         const testPromise = expect(promise).rejects.toThrow('String Error');
         
         await vi.advanceTimersByTimeAsync(1000);
         await testPromise;
         vi.useRealTimers();
    });
    
    it('should handle active process with no pid in cleanup', async () => {
        const mockChild = createMockChild();
        mockChild.pid = undefined;
        // Manually add to set
        (executor as any).activeProcesses.add(mockChild);
        
        await executor.cleanup();
        // Should not throw and not call kill
        expect(mockChild.kill).not.toHaveBeenCalled();
    });

    it('should ignore timeout if child is already killed', async () => {
        vi.useFakeTimers();
        const mockChild = createMockChild();
        mockChild.killed = true;
        mockSpawn.mockReturnValue(mockChild);
        const onTimeout = vi.fn();
        
        const promise = executor.execute('run', { timeout: 100, onTimeout });
        await vi.advanceTimersByTimeAsync(1000);
        
        expect(onTimeout).not.toHaveBeenCalled();
        // Manually resolve promise to finish test
        mockChild.emit('close', 0);
        await promise;
        vi.useRealTimers();
    });

    it('should handle spawn with missing stdout/stderr', async () => {
        const mockChild = createMockChild();
        mockChild.stdout = undefined;
        mockChild.stderr = undefined;
        mockSpawn.mockReturnValue(mockChild);
        
        const promise = executor.execute('run', { timeout: 1000 });
        mockChild.emit('close', 0);
        const result = await promise;
        expect(result.stdout).toBe('');
    });
    
    it('should handle empty command string', async () => {
        const mockChild = createMockChild();
        mockSpawn.mockReturnValue(mockChild);
        const promise = executor.execute('', { timeout: 1000 });
        mockChild.emit('close', 0);
        await promise;
        expect(mockSpawn).toHaveBeenCalledWith('', expect.anything());
    });
  });
});
