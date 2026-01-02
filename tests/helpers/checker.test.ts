import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as checker from '../../src/helpers/checker';
import { executor } from '../../src/executor';
import * as utils from '../../src/helpers/utils';

// Mock dependencies
vi.mock('../../src/executor', () => ({
  executor: {
    execute: vi.fn(),
    cleanup: vi.fn(),
  },
}));
vi.mock('../../src/helpers/utils');
vi.mock('../../src/formatter');

describe('checker.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ensureCheckerExists', () => {
    it('should not throw if checker is defined', () => {
      expect(() =>
        checker.ensureCheckerExists({ name: 'test', source: 'test.cpp' })
      ).not.toThrow();
    });

    it('should throw if checker is undefined', () => {
      vi.mocked(utils.throwError).mockImplementation(() => {
        throw new Error('Checker not defined');
      }); // manual mock implementation needed since auto-mock does nothing
      // Actually ensureCheckerExists throws directly "throw new Error(...)".
      // utils.throwError is likely used elsewhere.
      // StartLine: 112: throw new Error('No checker defined...');
      expect(() => checker.ensureCheckerExists(undefined)).toThrow(
        'No checker defined'
      );
    });
  });

  describe('runChecker', () => {
    const mockExecCommand = './checker';
    const mockInput = 'input.txt';
    const mockOutput = 'output.txt';
    const mockAnswer = 'answer.txt';

    it('should pass if executor succeeds and expected verdict is OK', async () => {
      vi.mocked(executor.execute).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        success: true,
      });

      await expect(
        checker.runChecker(
          mockExecCommand,
          mockInput,
          mockOutput,
          mockAnswer,
          'OK'
        )
      ).resolves.not.toThrow();
      expect(executor.execute).toHaveBeenCalled();
    });

    it('should throw if expected OK but executor reports error (WA)', async () => {
      // runChecker logic: ... onError: result => { if (expectedVerdict === 'OK') throw ... }
      // mock executor.execute to call onError
      vi.mocked(executor.execute).mockImplementation(async (cmd, options) => {
        if (options?.onError) {
          await options.onError({
            stdout: '',
            stderr: 'Wrong Answer',
            exitCode: 1,
            success: false,
          });
        }
        return {
          stdout: '',
          stderr: 'Wrong Answer',
          exitCode: 1,
          success: false,
        };
      });

      await expect(
        checker.runChecker(
          mockExecCommand,
          mockInput,
          mockOutput,
          mockAnswer,
          'OK'
        )
      ).rejects.toThrow('Wrong Answer');
    });
  });
});
