import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CheckerVerdict } from '../../src/types';
import * as checker from '../../src/helpers/checker';
import { executor } from '../../src/executor';
import * as utils from '../../src/helpers/utils';
import { fmt } from '../../src/formatter';
import fs from 'fs';
import path from 'path';

// Mock dependencies
vi.mock('../../src/executor', () => ({
  executor: {
    execute: vi.fn(),
    cleanup: vi.fn(),
  },
}));

vi.mock('../../src/helpers/utils', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../src/helpers/utils')>();
  return {
    ...actual,
    compileCPP: vi.fn(),
    readConfigFile: vi.fn(),
    throwError: vi.fn((err, msg) => {
      throw new Error(`${msg}: ${(err as Error).message}`);
    }),
    ensureDirectoryExists: vi.fn(),
    removeDirectoryRecursively: vi.fn(),
    getCompiledCommandToRun: vi.fn(),
  };
});

vi.mock('../../src/formatter', () => ({
  fmt: {
    warning: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    cross: vi.fn().mockReturnValue('❌'),
    bold: vi.fn().mockImplementation(s => `BOLD(${s})`),
    highlight: vi.fn().mockImplementation(s => `HIGHLIGHT(${s})`),
  },
}));

vi.mock('fs');
vi.mock('path', async importOriginal => {
  const actual = await importOriginal<typeof import('path')>();
  const mockResolve = vi.fn((...args: string[]) => args.join('/'));
  const mockJoin = vi.fn((...args: string[]) => args.join('/'));

  return {
    ...actual,
    resolve: mockResolve,
    join: mockJoin,
    default: {
      ...actual,
      resolve: mockResolve,
      join: mockJoin,
    },
  };
});

describe('checker.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementation for path.resolve to behave somewhat sanely
    (path.resolve as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (...args: string[]) => args.join('/').replace(/\/+/g, '/')
    );
    (path.join as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (...args: string[]) => args.join('/').replace(/\/+/g, '/')
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getExpectedCheckerVerdict', () => {
    it('should return OK for correct tags', () => {
      expect(checker.getExpectedCheckerVerdict('MA')).toBe('OK');
      expect(checker.getExpectedCheckerVerdict('OK')).toBe('OK');
    });

    it('should return OK for ignored tags (TL, ML, RE)', () => {
      // Checker doesn't check these, so it assumes OK logic-wise for the checker step itself
      // (Usually these would fail before reaching checker, but function logic says OK)
      expect(checker.getExpectedCheckerVerdict('TL')).toBe('OK');
      expect(checker.getExpectedCheckerVerdict('TO')).toBe('OK');
      expect(checker.getExpectedCheckerVerdict('ML')).toBe('OK');
      expect(checker.getExpectedCheckerVerdict('RE')).toBe('OK');
    });

    it('should return WRONG_ANSWER for error tags', () => {
      expect(checker.getExpectedCheckerVerdict('WA')).toBe('WRONG_ANSWER');
      expect(checker.getExpectedCheckerVerdict('RJ')).toBe('WRONG_ANSWER');
    });

    it('should return PRESENTATION_ERROR for PE tag', () => {
      expect(checker.getExpectedCheckerVerdict('PE')).toBe(
        'PRESENTATION_ERROR'
      );
    });

    it('should return OK for unknown tags (default)', () => {
      // @ts-expect-error Testing unknown tag
      expect(checker.getExpectedCheckerVerdict('UNKNOWN')).toBe('OK');
    });
  });

  describe('ensureCheckerExists', () => {
    it('should not throw if checker is defined', () => {
      expect(() =>
        checker.ensureCheckerExists({ name: 'test', source: 'test.cpp' })
      ).not.toThrow();
    });

    it('should throw if checker is undefined', () => {
      expect(() => checker.ensureCheckerExists(undefined)).toThrow(
        'No checker defined in the configuration file.'
      );
    });
  });

  describe('runChecker', () => {
    const mockExecCommand = './checker';
    const mockInput = 'input.txt';
    const mockOutput = 'output.txt';
    const mockAnswer = 'answer.txt';

    it('should pass if executor succeeds and expected verdict is OK', async () => {
      // Setup executor to succeed
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

      expect(executor.execute).toHaveBeenCalledWith(
        expect.stringContaining(
          `${mockExecCommand} ${mockInput} ${mockOutput} ${mockAnswer}`
        ),
        expect.anything()
      );
    });

    it('should throw error if expected OK but executor returns fail (stderr)', async () => {
      // Mock onError behavior inside execute
      vi.mocked(executor.execute).mockImplementation(async (cmd, options) => {
        if (options?.onError) {
          await options.onError({
            stdout: '',
            stderr: 'Wrong answer expected...',
            exitCode: 1,
            success: false,
          });
        }
        return {
          stdout: '',
          stderr: 'Wrong answer expected...',
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
      ).rejects.toThrow('Wrong answer expected...');
    });

    it('should throw "Expected OK but got WA" if stderr is empty on failure', async () => {
      vi.mocked(executor.execute).mockImplementation(async (cmd, options) => {
        if (options?.onError) {
          await options.onError({
            stdout: '',
            stderr: '',
            exitCode: 1,
            success: false,
          });
        }
        return { stdout: '', stderr: '', exitCode: 1, success: false };
      });

      await expect(
        checker.runChecker(
          mockExecCommand,
          mockInput,
          mockOutput,
          mockAnswer,
          'OK'
        )
      ).rejects.toThrow('Expected OK but got WA');
    });

    it('should pass if expected verdict is WA and executor fails (catches invalid)', async () => {
      // If we expect WA, the checker MUST fail.
      vi.mocked(executor.execute).mockImplementation(async (cmd, options) => {
        // Simulate checker finding WA
        if (options?.onError) {
          await options.onError({
            stdout: '',
            stderr: 'wrong answer 1st tokens differ',
            exitCode: 1,
            success: false,
          });
        }
        return { stdout: '', stderr: '', exitCode: 1, success: false };
      });

      await expect(
        checker.runChecker(
          mockExecCommand,
          mockInput,
          mockOutput,
          mockAnswer,
          'WA' as CheckerVerdict
        )
      ).resolves.not.toThrow();
    });

    it('should throw if expected WA but executor succeeds (OK)', async () => {
      // If we expect WA but checker says OK (exit code 0), we should throw
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
          'WA' as CheckerVerdict
        )
      ).rejects.toThrow('Expected WA but got OK');
    });

    it('should handle timeout callback correctly', async () => {
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as any);

      vi.mocked(executor.execute).mockImplementation(async (cmd, options) => {
        if (options?.onTimeout) {
          await options.onTimeout({
            stdout: '',
            stderr: '',
            exitCode: 124,
            success: false,
          });
        }
        return { stdout: '', stderr: '', exitCode: 124, success: false };
      });

      await checker.runChecker(
        mockExecCommand,
        mockInput,
        mockOutput,
        mockAnswer,
        'OK'
      ); // This shouldn't throw in itself because onTimeout calls process.exit, but we mocked process.exit.
      // Wait, executor.execute itself finishes. runChecker returns void.
      // If onTimeout is called, 'didCatchInvalid' is NOT set to true.
      // If expectedVerdict is OK, runChecker might not throw, but in reality process.exit kills it.
      // We just verify callbacks here.

      expect(fmt.error).toHaveBeenCalledWith(
        expect.stringContaining('Checker Unexpectedly Exceeded Time Limit')
      );
      expect(executor.cleanup).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle memory limit callback correctly', async () => {
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as any);

      vi.mocked(executor.execute).mockImplementation(async (cmd, options) => {
        if (options?.onMemoryExceeded) {
          await options.onMemoryExceeded({
            stdout: '',
            stderr: '',
            exitCode: 137,
            success: false,
          });
        }
        return { stdout: '', stderr: '', exitCode: 137, success: false };
      });

      await checker.runChecker(
        mockExecCommand,
        mockInput,
        mockOutput,
        mockAnswer,
        'OK'
      );

      expect(fmt.error).toHaveBeenCalledWith(
        expect.stringContaining('Checker Unexpectedly Exceeded Memory Limit')
      );
      expect(executor.cleanup).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('compileChecker', () => {
    it('should compile standard checker using assets path', async () => {
      const checkerConfig = {
        name: 'wcmp',
        source: 'wcmp.cpp',
        isStandard: true,
      };
      await checker.compileChecker(checkerConfig);

      expect(vi.mocked(utils.compileCPP)).toHaveBeenCalledWith(
        expect.stringContaining('assets/checkers/wcmp.cpp')
      );
    });

    it('should compile custom checker using provided source', async () => {
      const checkerConfig = {
        name: 'my_checker',
        source: '/path/to/my_checker.cpp',
        isStandard: false,
      };
      await checker.compileChecker(checkerConfig);

      expect(vi.mocked(utils.compileCPP)).toHaveBeenCalledWith(
        '/path/to/my_checker.cpp'
      );
    });

    it('should throw wrapped error on compilation failure', async () => {
      vi.mocked(utils.compileCPP).mockRejectedValue(
        new Error('Compilation failed')
      );
      await expect(
        checker.compileChecker({ name: 'fail', source: 'fail.cpp' })
      ).rejects.toThrow('Compilation failed');
    });

    it('should wrap non-Error objects', async () => {
      vi.mocked(utils.compileCPP).mockRejectedValue('String error');
      await expect(
        checker.compileChecker({ name: 'fail', source: 'fail.cpp' })
      ).rejects.toThrow('Failed to compile checker');
    });
  });

  describe('testCheckerItself', () => {
    it('should return early for standard checkers', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        checker: { isStandard: true, source: 'wcmp.cpp', name: 'wcmp' },
        solutions: [],
      } as unknown as any);

      await checker.testCheckerItself();

      expect(fmt.warning).toHaveBeenCalledWith(
        expect.stringContaining('Using standard checker')
      );
      expect(utils.compileCPP).not.toHaveBeenCalled();
    });

    it('should return early if no testsFilePath provided', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        checker: { isStandard: false, source: 'check.cpp', name: 'check' },
        solutions: [],
      } as unknown as any);

      await checker.testCheckerItself();

      expect(fmt.warning).toHaveBeenCalledWith(
        expect.stringContaining('No checker tests file path')
      );
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should run tests for valid custom checker', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        checker: {
          isStandard: false,
          source: 'check.cpp',
          name: 'check',
          testsFilePath: 'tests.json',
        },
        solutions: [],
      } as unknown as any);

      // Mock reading tests file
      vi.mocked(fs.readFile).mockImplementation(((
        path: any,
        enc: any,
        cb: any
      ) => {
        // Handle overload where enc is callback or enc is string
        const callback = typeof enc === 'function' ? enc : cb;
        callback(
          null,
          JSON.stringify({
            tests: [
              { input: '1', output: '1', answer: '1', expectedVerdict: 'OK' },
            ],
          })
        );
      }) as any);

      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./check.exe');

      // Ensure runChecker succeeds
      vi.mocked(executor.execute).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        success: true,
      });

      await checker.testCheckerItself();

      // Verify makeCheckerTests logic (files written)
      expect(utils.ensureDirectoryExists).toHaveBeenCalledWith('checker_tests');
      // StartLine should be adjusted or logic checked
      expect(fs.writeFileSync).toHaveBeenCalledTimes(3); // Input, output, answer

      // Verify runCheckerTests logic
      expect(utils.getCompiledCommandToRun).toHaveBeenCalled();

      // Verify cleanup
      expect(executor.cleanup).toHaveBeenCalled();
      expect(utils.removeDirectoryRecursively).toHaveBeenCalledWith(
        'checker_tests'
      );
    });

    it('should catch and rethrow errors from test process', async () => {
      vi.mocked(utils.readConfigFile).mockImplementation(() => {
        throw new Error('Config Error');
      });

      await expect(checker.testCheckerItself()).rejects.toThrow(
        'Failed to test checker: Config Error'
      );

      // Ensure cleanup still happens
      expect(executor.cleanup).toHaveBeenCalled();
      expect(utils.removeDirectoryRecursively).toHaveBeenCalledWith(
        'checker_tests'
      );
    });
  });

  describe('makeCheckerTests (private, tested via testCheckerItself logic)', () => {
    // We covered logic in previous block basically, but let's test specifically the failing json parse
    it('should fail if tests json is invalid', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        checker: {
          isStandard: false,
          source: 'c.cpp',
          name: 'c',
          testsFilePath: 'bad.json',
        },
        solutions: [],
      } as unknown as any);

      vi.mocked(fs.readFile).mockImplementation(((p: any, e: any, cb: any) => {
        const callback = typeof e === 'function' ? e : cb;
        callback(null, 'INVALID JSON');
      }) as any);

      await expect(checker.testCheckerItself()).rejects.toThrow(
        'Failed to parse checker tests JSON'
      );
    });

    it('should fail if file read error', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        checker: {
          isStandard: false,
          source: 'c.cpp',
          name: 'c',
          testsFilePath: 'missing.json',
        },
        solutions: [],
      } as unknown as any);

      vi.mocked(fs.readFile).mockImplementation(((p: any, e: any, cb: any) => {
        const callback = typeof e === 'function' ? e : cb;
        callback(new Error('ENOENT'), null);
      }) as any);

      await expect(checker.testCheckerItself()).rejects.toThrow(
        'Failed to read checker tests file'
      );
    });

    it('should fail if json structure is invalid (no "tests" array)', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        checker: {
          isStandard: false,
          source: 'c.cpp',
          name: 'c',
          testsFilePath: 'bad_struct.json',
        },
        solutions: [],
      } as unknown as any);

      vi.mocked(fs.readFile).mockImplementation(((p: any, e: any, cb: any) => {
        const callback = typeof e === 'function' ? e : cb;
        callback(null, JSON.stringify({ notTests: [] }));
      }) as any);

      await expect(checker.testCheckerItself()).rejects.toThrow(
        'Invalid checker tests JSON structure'
      );
    });
  });

  describe('runCheckerTests', () => {
    it('should throw if individual checker test fails', async () => {
      const mockChecker = {
        name: 'c',
        source: 'c.cpp',
        testsFilePath: 't.json',
      };

      vi.mocked(fs.readFile).mockImplementation(((p: any, e: any, cb: any) => {
        const callback = typeof e === 'function' ? e : cb;
        callback(
          null,
          JSON.stringify({
            tests: [
              {
                index: 1,
                input: '',
                output: '',
                answer: '',
                expectedVerdict: 'OK',
              },
            ],
          })
        );
      }) as any);
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./c.exe');

      // Check fails
      vi.mocked(executor.execute).mockImplementation(async (cmd, opts) => {
        if (opts?.onError)
          await opts.onError({
            stdout: '',
            stderr: 'WA',
            exitCode: 1,
            success: false,
          });
        return { stdout: '', stderr: 'WA', exitCode: 1, success: false };
      });

      await expect(checker.runCheckerTests(mockChecker as any)).rejects.toThrow(
        'Some checker tests failed'
      );

      expect(fmt.error).toHaveBeenCalledWith(
        expect.stringContaining('Checker Test 1 failed')
      );
    });

    it('should rethrow if generic error occurs (e.g. fs error)', async () => {
      const mockChecker = {
        name: 'c',
        source: 'c.cpp',
        testsFilePath: 't.json',
      };
      // Parsing succeeds
      vi.mocked(fs.readFile).mockImplementation(((p: any, e: any, cb: any) => {
        const callback = typeof e === 'function' ? e : cb;
        callback(null, JSON.stringify({ tests: [] }));
      }) as any);

      vi.mocked(utils.getCompiledCommandToRun).mockImplementation(() => {
        throw new Error('Get command failed');
      });

      await expect(checker.runCheckerTests(mockChecker as any)).rejects.toThrow(
        'Failed to run checker tests'
      );
    });
  });
});
