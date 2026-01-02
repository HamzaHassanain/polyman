import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommandExecutor } from '../src/executor';
import EventEmitter from 'events';

import { spawn, ChildProcess } from 'child_process';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

describe('executor.ts', () => {
  let executor: CommandExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new CommandExecutor();
    vi.spyOn(process, 'kill').mockImplementation(() => true);
  });

  describe('execute', () => {
    it('should execute command successfully', async () => {
      const mockChild = new EventEmitter() as any;
      mockChild.pid = 12345;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.on = vi.fn((event, cb) => {
        if (event === 'close') {
          // Wait just a bit before emitting to simulate process
          setTimeout(() => {
            cb(0);
          }, 10);
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return mockChild;
      });
      mockChild.kill = vi.fn();

      vi.mocked(spawn).mockReturnValue(mockChild as unknown as ChildProcess);

      const result = await executor.execute('echo hello', { timeout: 100 });

      expect(result.exitCode).toBe(0);
      expect(result.success).toBe(true);
    });

    it('should handle timeout', async () => {
      const mockChild = new EventEmitter() as any;
      mockChild.pid = 67890;
      mockChild.stdout = new EventEmitter();
      mockChild.stderr = new EventEmitter();
      mockChild.on = vi.fn(); // Never emits close
      mockChild.kill = vi.fn();

      vi.mocked(spawn).mockReturnValue(mockChild);

      const promise = executor.execute('sleep 10', {
        timeout: 50,
        onTimeout: () => {},
      });

      await expect(promise).resolves.toMatchObject({
        timedOut: true,
        success: false,
      });
      expect(mockChild.kill).toHaveBeenCalled();
    });
  });
});
