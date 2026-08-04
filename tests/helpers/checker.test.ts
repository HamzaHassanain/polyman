import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type ConfigFile from '../../src/types';
import type { CheckerVerdict, LocalChecker } from '../../src/types';
import type { ExecutionOptions, ExecutionResult } from '../../src/executor';
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
    throwError: vi.fn((err: unknown, msg: string) => {
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
    newLine: vi.fn(),
    cross: vi.fn().mockReturnValue('CROSS'),
    bold: vi.fn().mockImplementation((s: string) => `BOLD(${s})`),
    highlight: vi.fn().mockImplementation((s: string) => `HIGHLIGHT(${s})`),
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

// Typed handles for mocked modules / functions. `vi.mocked()` returns the
// same value with mock-typing layered on top, so calls like
// `mockedExecute.mockResolvedValue(...)` are typed and bound. We pull out
// individual methods via bracket notation to avoid `unbound-method` warnings
// from typescript-eslint while preserving the original signatures.
const mockedExecutor = vi.mocked(executor, { partial: true });
const mockedExecute = mockedExecutor['execute'];
const mockedCleanup = mockedExecutor['cleanup'];

const mockedUtils = vi.mocked(utils, { partial: true });
const mockedCompileCPP = mockedUtils['compileCPP'];
const mockedReadConfigFile = mockedUtils['readConfigFile'];
const mockedEnsureDirectoryExists = mockedUtils['ensureDirectoryExists'];
const mockedRemoveDirectoryRecursively =
  mockedUtils['removeDirectoryRecursively'];
const mockedGetCompiledCommandToRun = mockedUtils['getCompiledCommandToRun'];

const mockedFmt = vi.mocked(fmt, { partial: true });
const mockedFmtWarning = mockedFmt['warning'];
const mockedFmtError = mockedFmt['error'];

const mockedFs = vi.mocked(fs, { partial: true });
const mockedFsReadFile = mockedFs['readFile'];
const mockedFsWriteFileSync = mockedFs['writeFileSync'];

const mockedPath = vi.mocked(path, { partial: true });
const mockedPathResolve = mockedPath['resolve'];
const mockedPathJoin = mockedPath['join'];

// Helper: build a ConfigFile with sensible defaults so tests can supply only
// the bits they care about (typically `checker`).
function makeConfig(overrides: Partial<ConfigFile> = {}): ConfigFile {
  return {
    name: 'test-problem',
    timeLimit: 1000,
    memoryLimit: 256,
    inputFile: 'stdin',
    outputFile: 'stdout',
    interactive: false,
    statements: {},
    solutions: [],
    checker: { name: 'check', source: 'check.cpp' },
    validator: { name: 'val', source: 'val.cpp' },
    ...overrides,
  };
}

// Helper: build an ExecutionResult with optional overrides.
function makeExecResult(
  overrides: Partial<ExecutionResult> = {}
): ExecutionResult {
  return {
    stdout: '',
    stderr: '',
    exitCode: 0,
    success: true,
    ...overrides,
  };
}

// Type-safe simulator for fs.readFile mocks. fs.readFile has multiple
// overloads; we hand-roll a callback-style implementation.
type ReadFileSimulator = (filePath: string) => {
  err: NodeJS.ErrnoException | null;
  data: string;
};

function installReadFileMock(simulator: ReadFileSimulator): void {
  mockedFsReadFile.mockImplementation(((
    filePath: fs.PathOrFileDescriptor,
    optionsOrCb: unknown,
    maybeCb?: unknown
  ) => {
    const callback = (
      typeof optionsOrCb === 'function' ? optionsOrCb : maybeCb
    ) as (err: NodeJS.ErrnoException | null, data: string) => void;
    const result = simulator(String(filePath));
    callback(result.err, result.data);
  }) as unknown as typeof fs.readFile);
}

describe('checker.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock implementation for path.resolve / path.join to behave
    // somewhat sanely.
    mockedPathResolve.mockImplementation((...args: string[]) =>
      args.join('/').replace(/\/+/g, '/')
    );
    mockedPathJoin.mockImplementation((...args: string[]) =>
      args.join('/').replace(/\/+/g, '/')
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
      mockedExecute.mockResolvedValue(makeExecResult());

      await expect(
        checker.runChecker(
          mockExecCommand,
          mockInput,
          mockOutput,
          mockAnswer,
          'OK'
        )
      ).resolves.not.toThrow();

      const expectedCommand =
        process.platform === 'win32'
          ? `${mockExecCommand} "${mockInput}" "${mockOutput}" "${mockAnswer}"`
          : `${mockExecCommand} '${mockInput}' '${mockOutput}' '${mockAnswer}'`;

      expect(mockedExecute).toHaveBeenCalledWith(
        expect.stringContaining(expectedCommand),
        expect.anything()
      );
    });

    it.skipIf(process.platform === 'win32')(
      'should protect checker file arguments containing shell metacharacters',
      async () => {
        mockedExecute.mockResolvedValue(makeExecResult());

        await checker.runChecker(
          mockExecCommand,
          "/tmp/polyman path 3)'test/input.txt",
          "/tmp/polyman path 3)'test/output.txt",
          "/tmp/polyman path 3)'test/answer.txt",
          'OK'
        );

        expect(mockedExecute).toHaveBeenCalledWith(
          expect.stringContaining("'/tmp/polyman path 3)'\\''test/input.txt'"),
          expect.anything()
        );
      }
    );

    it('should throw error if expected OK but executor returns fail (stderr)', async () => {
      // Mock onError behavior inside execute
      mockedExecute.mockImplementation(
        (_cmd: string, options: ExecutionOptions) => {
          const failResult = makeExecResult({
            stderr: 'Wrong answer expected...',
            exitCode: 1,
            success: false,
          });
          if (options.onError) {
            options.onError(failResult);
          }
          return Promise.resolve(failResult);
        }
      );

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
      mockedExecute.mockImplementation(
        (_cmd: string, options: ExecutionOptions) => {
          const failResult = makeExecResult({
            exitCode: 1,
            success: false,
          });
          if (options.onError) {
            options.onError(failResult);
          }
          return Promise.resolve(failResult);
        }
      );

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
      mockedExecute.mockImplementation(
        (_cmd: string, options: ExecutionOptions) => {
          // Simulate checker finding WA
          if (options.onError) {
            options.onError(
              makeExecResult({
                stderr: 'wrong answer 1st tokens differ',
                exitCode: 1,
                success: false,
              })
            );
          }
          return Promise.resolve(
            makeExecResult({ exitCode: 1, success: false })
          );
        }
      );

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
      mockedExecute.mockResolvedValue(makeExecResult());

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
        .mockImplementation((() => undefined) as (code?: number) => never);

      mockedExecute.mockImplementation(
        (_cmd: string, options: ExecutionOptions) => {
          if (options.onTimeout) {
            options.onTimeout(
              makeExecResult({ exitCode: 124, success: false })
            );
          }
          return Promise.resolve(
            makeExecResult({ exitCode: 124, success: false })
          );
        }
      );

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

      expect(mockedFmtError).toHaveBeenCalledWith(
        expect.stringContaining('Checker Unexpectedly Exceeded Time Limit')
      );
      expect(mockedCleanup).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle memory limit callback correctly', async () => {
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => undefined) as (code?: number) => never);

      mockedExecute.mockImplementation(
        (_cmd: string, options: ExecutionOptions) => {
          if (options.onMemoryExceeded) {
            options.onMemoryExceeded(
              makeExecResult({ exitCode: 137, success: false })
            );
          }
          return Promise.resolve(
            makeExecResult({ exitCode: 137, success: false })
          );
        }
      );

      await checker.runChecker(
        mockExecCommand,
        mockInput,
        mockOutput,
        mockAnswer,
        'OK'
      );

      expect(mockedFmtError).toHaveBeenCalledWith(
        expect.stringContaining('Checker Unexpectedly Exceeded Memory Limit')
      );
      expect(mockedCleanup).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('compileChecker', () => {
    it('should compile standard checker using assets path', async () => {
      const checkerConfig: LocalChecker = {
        name: 'wcmp',
        source: 'wcmp.cpp',
        isStandard: true,
      };
      await checker.compileChecker(checkerConfig);

      expect(mockedCompileCPP).toHaveBeenCalledWith(
        expect.stringContaining('assets/checkers/wcmp.cpp')
      );
    });

    it('should compile custom checker using provided source', async () => {
      const checkerConfig: LocalChecker = {
        name: 'my_checker',
        source: '/path/to/my_checker.cpp',
        isStandard: false,
      };
      await checker.compileChecker(checkerConfig);

      expect(mockedCompileCPP).toHaveBeenCalledWith('/path/to/my_checker.cpp');
    });

    it('should throw wrapped error on compilation failure', async () => {
      mockedCompileCPP.mockRejectedValue(new Error('Compilation failed'));
      await expect(
        checker.compileChecker({ name: 'fail', source: 'fail.cpp' })
      ).rejects.toThrow('Compilation failed');
    });

    it('should wrap non-Error objects', async () => {
      mockedCompileCPP.mockRejectedValue('String error');
      await expect(
        checker.compileChecker({ name: 'fail', source: 'fail.cpp' })
      ).rejects.toThrow('Failed to compile checker');
    });
  });

  describe('testCheckerItself', () => {
    it('should return early for standard checkers', async () => {
      mockedReadConfigFile.mockReturnValue(
        makeConfig({
          checker: { isStandard: true, source: 'wcmp.cpp', name: 'wcmp' },
        })
      );

      await checker.testCheckerItself();

      expect(mockedFmtWarning).toHaveBeenCalledWith(
        expect.stringContaining('Using standard checker')
      );
      expect(mockedCompileCPP).not.toHaveBeenCalled();
    });

    it('should return early if no testsFilePath provided', async () => {
      mockedReadConfigFile.mockReturnValue(
        makeConfig({
          checker: { isStandard: false, source: 'check.cpp', name: 'check' },
        })
      );

      await checker.testCheckerItself();

      expect(mockedFmtWarning).toHaveBeenCalledWith(
        expect.stringContaining('No checker tests file path')
      );
      expect(mockedFsWriteFileSync).not.toHaveBeenCalled();
    });

    it('should run tests for valid custom checker', async () => {
      mockedReadConfigFile.mockReturnValue(
        makeConfig({
          checker: {
            isStandard: false,
            source: 'check.cpp',
            name: 'check',
            testsFilePath: 'tests.json',
          },
        })
      );

      // Mock reading tests file
      installReadFileMock(() => ({
        err: null,
        data: JSON.stringify({
          tests: [
            { input: '1', output: '1', answer: '1', expectedVerdict: 'OK' },
          ],
        }),
      }));

      mockedGetCompiledCommandToRun.mockReturnValue('./check.exe');

      // Ensure runChecker succeeds
      mockedExecute.mockResolvedValue(makeExecResult());

      await checker.testCheckerItself();

      // Verify makeCheckerTests logic (files written)
      expect(mockedEnsureDirectoryExists).toHaveBeenCalledWith('checker_tests');
      // StartLine should be adjusted or logic checked
      expect(mockedFsWriteFileSync).toHaveBeenCalledTimes(3); // Input, output, answer

      // Verify runCheckerTests logic
      expect(mockedGetCompiledCommandToRun).toHaveBeenCalled();

      // Verify cleanup
      expect(mockedCleanup).toHaveBeenCalled();
      expect(mockedRemoveDirectoryRecursively).toHaveBeenCalledWith(
        'checker_tests'
      );
    });

    it('should catch and rethrow errors from test process', async () => {
      mockedReadConfigFile.mockImplementation(() => {
        throw new Error('Config Error');
      });

      await expect(checker.testCheckerItself()).rejects.toThrow(
        'Failed to test checker: Config Error'
      );

      // Ensure cleanup still happens
      expect(mockedCleanup).toHaveBeenCalled();
      expect(mockedRemoveDirectoryRecursively).toHaveBeenCalledWith(
        'checker_tests'
      );
    });
  });

  describe('makeCheckerTests (private, tested via testCheckerItself logic)', () => {
    // We covered logic in previous block basically, but let's test specifically the failing json parse
    it('should fail if tests json is invalid', async () => {
      mockedReadConfigFile.mockReturnValue(
        makeConfig({
          checker: {
            isStandard: false,
            source: 'c.cpp',
            name: 'c',
            testsFilePath: 'bad.json',
          },
        })
      );

      installReadFileMock(() => ({ err: null, data: 'INVALID JSON' }));

      await expect(checker.testCheckerItself()).rejects.toThrow(
        'Failed to parse checker tests JSON'
      );
    });

    it('should fail if file read error', async () => {
      mockedReadConfigFile.mockReturnValue(
        makeConfig({
          checker: {
            isStandard: false,
            source: 'c.cpp',
            name: 'c',
            testsFilePath: 'missing.json',
          },
        })
      );

      installReadFileMock(() => ({
        err: new Error('ENOENT') as NodeJS.ErrnoException,
        data: '',
      }));

      await expect(checker.testCheckerItself()).rejects.toThrow(
        'Failed to read checker tests file'
      );
    });

    it('should fail if json structure is invalid (no "tests" array)', async () => {
      mockedReadConfigFile.mockReturnValue(
        makeConfig({
          checker: {
            isStandard: false,
            source: 'c.cpp',
            name: 'c',
            testsFilePath: 'bad_struct.json',
          },
        })
      );

      installReadFileMock(() => ({
        err: null,
        data: JSON.stringify({ notTests: [] }),
      }));

      await expect(checker.testCheckerItself()).rejects.toThrow(
        'Invalid checker tests JSON structure'
      );
    });
  });

  describe('runCheckerTests', () => {
    it('should throw if individual checker test fails', async () => {
      const mockChecker: LocalChecker = {
        name: 'c',
        source: 'c.cpp',
        testsFilePath: 't.json',
      };

      installReadFileMock(() => ({
        err: null,
        data: JSON.stringify({
          tests: [
            {
              index: 1,
              input: '',
              output: '',
              answer: '',
              expectedVerdict: 'OK',
            },
          ],
        }),
      }));
      mockedGetCompiledCommandToRun.mockReturnValue('./c.exe');

      // Check fails
      mockedExecute.mockImplementation(
        (_cmd: string, options: ExecutionOptions) => {
          if (options.onError) {
            options.onError(
              makeExecResult({
                stderr: 'WA',
                exitCode: 1,
                success: false,
              })
            );
          }
          return Promise.resolve(
            makeExecResult({
              stderr: 'WA',
              exitCode: 1,
              success: false,
            })
          );
        }
      );

      await expect(checker.runCheckerTests(mockChecker)).rejects.toThrow(
        'Some checker tests failed'
      );

      expect(mockedFmtError).toHaveBeenCalledWith(
        expect.stringContaining('Checker Test 1 failed')
      );
    });

    it('should rethrow if generic error occurs (e.g. fs error)', async () => {
      const mockChecker: LocalChecker = {
        name: 'c',
        source: 'c.cpp',
        testsFilePath: 't.json',
      };
      // Parsing succeeds
      installReadFileMock(() => ({
        err: null,
        data: JSON.stringify({ tests: [] }),
      }));

      mockedGetCompiledCommandToRun.mockImplementation(() => {
        throw new Error('Get command failed');
      });

      await expect(checker.runCheckerTests(mockChecker)).rejects.toThrow(
        'Failed to run checker tests'
      );
    });
  });
});
