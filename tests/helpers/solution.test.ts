import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as solution from '../../src/helpers/solution';
import * as executorModule from '../../src/executor';
import type { ExecutionOptions, ExecutionResult } from '../../src/executor';

// Re-export `executor` through a typed indirection so that calls go through a
// plain function reference (avoids @typescript-eslint/unbound-method false
// positives when handing methods to `vi.mocked`).
type ExecuteWithRedirect = (
  command: string,
  options: ExecutionOptions,
  inputFile?: string,
  outputFile?: string
) => Promise<ExecutionResult>;
type CleanupFn = () => Promise<void>;
type ExecuteFn = (
  command: string,
  options: ExecutionOptions
) => Promise<ExecutionResult>;
const executor: {
  execute: ExecuteFn;
  executeWithRedirect: ExecuteWithRedirect;
  cleanup: CleanupFn;
} = executorModule.executor;
import * as utils from '../../src/helpers/utils';
import * as checker from '../../src/helpers/checker';
import * as testsetHelper from '../../src/helpers/testset';
import fs from 'fs';
import path from 'path';
import type ConfigFile from '../../src/types';
import type {
  LocalSolution,
  LocalTestset,
  LocalChecker,
  CheckerVerdict,
} from '../../src/types';

vi.mock('../../src/executor', () => ({
  executor: {
    execute: vi.fn(),
    executeWithRedirect: vi.fn(),
    cleanup: vi.fn(),
  },
}));

vi.mock('../../src/helpers/utils', async () => {
  const actual = await vi.importActual<
    typeof import('../../src/helpers/utils')
  >('../../src/helpers/utils');
  return {
    ...actual,

    throwError: vi.fn((err: unknown, msg?: string) => {
      if (err instanceof Error && msg) {
        err.message = `${msg}: ${err.message}`;
      }
      throw err;
    }),
    logError: vi.fn(),
    readConfigFile: vi.fn(),
    getCompiledCommandToRun: vi.fn(),
    getTestFiles: vi.fn(),
    compileCPP: vi.fn(),
    compileJava: vi.fn(),
    readFirstLine: vi.fn().mockResolvedValue(''),
  };
});
vi.mock('../../src/helpers/checker');
vi.mock('../../src/helpers/testset');
vi.mock('fs');
vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return {
    ...actual,
    resolve: vi.fn((...args: string[]) => args.join('/')),
  };
});
vi.mock('../../src/formatter', () => ({
  fmt: {
    info: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    newLine: vi.fn(),
    infoIcon: () => 'i',
    highlight: (s: string) => s,
    dim: (s: string) => s,
    primary: (s: string) => s,
    bold: (s: string) => s,
    cross: () => 'x',
  },
}));

// Typed handles for mocked functions used throughout the suite.
// The executor proxy types its members as plain function-typed properties (not
// class methods), so `vi.mocked` returns a real Vitest mock with the full mock
// API while staying lint-clean for `unbound-method`.
const mockedExecuteWithRedirect = vi.mocked(executor.executeWithRedirect);
const mockedReadConfigFile = vi.mocked(utils.readConfigFile);
const mockedGetCompiledCommandToRun = vi.mocked(utils.getCompiledCommandToRun);
const mockedReadFirstLine = vi.mocked(utils.readFirstLine);
const mockedGetTestFiles = vi.mocked(utils.getTestFiles);
const mockedCompileCPP = vi.mocked(utils.compileCPP);
const mockedCompileJava = vi.mocked(utils.compileJava);
const mockedRunChecker = vi.mocked(checker.runChecker);
const mockedGetTestIndicesForGroup = vi.mocked(
  testsetHelper.getTestIndicesForGroup
);
const mockedFsExistsSync = vi.mocked(fs.existsSync);
const mockedFsMkdirSync = vi.mocked(fs.mkdirSync);
const mockedFsUnlinkSync = vi.mocked(fs.unlinkSync);
const mockedFsWriteFileSync = vi.mocked(fs.writeFileSync);

const okResult: ExecutionResult = {
  stdout: '',
  stderr: '',
  exitCode: 0,
  success: true,
};

function makeConfig(overrides: Partial<ConfigFile> = {}): ConfigFile {
  const base: ConfigFile = {
    name: 'problem',
    timeLimit: 1000,
    memoryLimit: 256,
    inputFile: 'stdin',
    outputFile: 'stdout',
    interactive: false,
    statements: {},
    solutions: [],
    checker: { name: 'chk', source: 'checker.cpp' },
    validator: { name: 'val', source: 'validator.cpp' },
    testsets: [],
  };
  return { ...base, ...overrides };
}

describe('solution.ts', () => {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit called');
  }) as (code?: number | string | null) => never);
  void exitSpy;

  beforeEach(() => {
    vi.clearAllMocks();

    mockedFsExistsSync.mockReturnValue(true);
    mockedFsMkdirSync.mockReturnValue(undefined);
    mockedFsUnlinkSync.mockReturnValue(undefined);
    mockedReadConfigFile.mockReturnValue(makeConfig());
    mockedGetCompiledCommandToRun.mockReturnValue('./solution');
    mockedReadFirstLine.mockResolvedValue('');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('validateSolutionsExist', () => {
    it('should not throw if solutions exist', () => {
      const solutions: LocalSolution[] = [
        { name: 'sol1', source: 'sol1.cpp', tag: 'MA' },
      ];
      expect(() => solution.validateSolutionsExist(solutions)).not.toThrow();
    });

    it('should throw if solutions is undefined', () => {
      expect(() => solution.validateSolutionsExist(undefined)).toThrow(
        'No solutions defined'
      );
    });

    it('should throw if solutions is empty', () => {
      expect(() => solution.validateSolutionsExist([])).toThrow(
        'No solutions defined'
      );
    });
  });

  describe('findMatchingSolutions', () => {
    const solutions: LocalSolution[] = [
      { name: 'main', source: 'main.cpp', tag: 'MA' },
      { name: 'wa', source: 'wa.cpp', tag: 'WA' },
    ];

    it('should return all solutions if name is all', () => {
      expect(solution.findMatchingSolutions(solutions, 'all')).toEqual(
        solutions
      );
    });

    it('should return matching solution', () => {
      expect(solution.findMatchingSolutions(solutions, 'main')).toEqual([
        solutions[0],
      ]);
    });

    it('should throw if solution not found', () => {
      expect(() =>
        solution.findMatchingSolutions(solutions, 'missing')
      ).toThrow(/Solution named "missing" not found/);
    });
  });

  describe('compileSolution', () => {
    it('should compile cpp solution', async () => {
      vi.spyOn(path, 'extname').mockReturnValue('.cpp');
      await solution.compileSolution('sol.cpp');
      expect(mockedCompileCPP).toHaveBeenCalledWith('sol.cpp');
    });

    it('should compile java solution', async () => {
      vi.spyOn(path, 'extname').mockReturnValue('.java');
      await solution.compileSolution('sol.java');
      expect(mockedCompileJava).toHaveBeenCalledWith('sol.java');
    });

    it('should not compile python solution', async () => {
      vi.spyOn(path, 'extname').mockReturnValue('.py');
      await solution.compileSolution('sol.py');
      expect(mockedCompileCPP).not.toHaveBeenCalled();
      expect(mockedCompileJava).not.toHaveBeenCalled();
    });

    it('should throw on unsupported extension', async () => {
      vi.spyOn(path, 'extname').mockReturnValue('.txt');
      await expect(solution.compileSolution('sol.txt')).rejects.toThrow(
        'Unsupported solution file extension: .txt'
      );
    });
  });

  describe('compileAllSolutions', () => {
    it('should compile all solutions', async () => {
      const solutions: LocalSolution[] = [
        { name: 's1', source: 's1.cpp', tag: 'MA' },
        { name: 's2', source: 's2.java', tag: 'WA' },
      ];
      vi.spyOn(path, 'extname').mockImplementation(p =>
        p.endsWith('.cpp') ? '.cpp' : '.java'
      );

      await solution.compileAllSolutions(solutions);
      expect(mockedCompileCPP).toHaveBeenCalledWith('s1.cpp');
      expect(mockedCompileJava).toHaveBeenCalledWith('s2.java');
    });
  });

  describe('runSolutionOnSingleTest', () => {
    const mockSolution: LocalSolution = {
      name: 'main',
      source: 'main.cpp',
      tag: 'MA',
    };
    const mockConfig: ConfigFile = makeConfig();

    it('should execute solution successfully', async () => {
      mockedExecuteWithRedirect.mockResolvedValue(okResult);

      await solution.runSolutionOnSingleTest(
        mockSolution,
        mockConfig,
        'testsets',
        1
      );

      expect(mockedExecuteWithRedirect).toHaveBeenCalled();
      const call = mockedExecuteWithRedirect.mock.calls[0];
      expect(call).toBeDefined();
      const options = call[1];
      expect(options).toMatchObject({ timeout: 1000, memoryLimitMB: 256 });
    });

    it('should throw if execution fails', async () => {
      mockedExecuteWithRedirect.mockRejectedValue(
        new Error('Execution failed')
      );
      await expect(
        solution.runSolutionOnSingleTest(
          mockSolution,
          mockConfig,
          'testsets',
          1
        )
      ).rejects.toThrow('Execution failed');
    });

    it('should handle runtime error (onError callback)', async () => {
      mockedExecuteWithRedirect.mockImplementation(
        (_cmd: string, options: ExecutionOptions) => {
          options.onError?.({
            stdout: '',
            stderr: 'Segfault',
            exitCode: 1,
            success: false,
          });
          return Promise.resolve(okResult);
        }
      );
      mockedFsWriteFileSync.mockImplementation(() => {});

      await expect(
        solution.runSolutionOnSingleTest(
          mockSolution,
          mockConfig,
          'testset1',
          1
        )
      ).rejects.toThrow('Runtime Error: Segfault');

      expect(mockedFsWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('output_test1.txt'),
        'Runtime Error: Segfault'
      );
    });

    it('should handle timeout (onTimeout callback)', async () => {
      mockedExecuteWithRedirect.mockImplementation(
        (_cmd: string, options: ExecutionOptions) => {
          options.onTimeout?.({
            stdout: '',
            stderr: '',
            exitCode: 124,
            success: false,
            timedOut: true,
          });
          return Promise.resolve(okResult);
        }
      );

      await expect(
        solution.runSolutionOnSingleTest(
          mockSolution,
          mockConfig,
          'testset1',
          1
        )
      ).rejects.toThrow('Time Limit Exceeded');

      expect(mockedFsWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('output_test1.txt'),
        expect.stringContaining('Time Limit Exceeded')
      );
    });

    it('should handle memory exceeded (onMemoryExceeded callback)', async () => {
      mockedExecuteWithRedirect.mockImplementation(
        (_cmd: string, options: ExecutionOptions) => {
          options.onMemoryExceeded?.({
            stdout: '',
            stderr: '',
            exitCode: 137,
            success: false,
            memoryExceeded: true,
          });
          return Promise.resolve(okResult);
        }
      );

      await expect(
        solution.runSolutionOnSingleTest(
          mockSolution,
          mockConfig,
          'testset1',
          1
        )
      ).rejects.toThrow('Memory Limit Exceeded');

      expect(mockedFsWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('output_test1.txt'),
        expect.stringContaining('Memory Limit Exceeded')
      );
    });
  });

  describe('runSolutionOnTestset', () => {
    const mockSolution: LocalSolution = {
      name: 'main',
      source: 'main.cpp',
      tag: 'MA',
    };
    const mockConfig: ConfigFile = makeConfig();

    it('should run on all test files', async () => {
      mockedGetTestFiles.mockReturnValue(['test1.txt', 'test2.txt']);
      mockedExecuteWithRedirect.mockResolvedValue(okResult);

      await solution.runSolutionOnTestset(mockSolution, mockConfig, 'testset1');

      expect(mockedExecuteWithRedirect).toHaveBeenCalledTimes(2);
    });

    it('should throw aggregate error if tests fail', async () => {
      mockedGetTestFiles.mockReturnValue(['test1.txt']);
      mockedExecuteWithRedirect.mockRejectedValue(new Error('Fail'));

      await expect(
        solution.runSolutionOnTestset(mockSolution, mockConfig, 'testset1')
      ).rejects.toThrow(/Solution .* failed on testset/);
    });
  });

  describe('runSolutionOnGroup', () => {
    const mockSolution: LocalSolution = {
      name: 'main',
      source: 'main.cpp',
      tag: 'MA',
      sourceType: 'cpp.g++17',
    };
    const mockConfig: ConfigFile = makeConfig();
    const mockTestset: LocalTestset = { name: 'ts1' };

    it('should run tests belonging to group', async () => {
      mockedGetTestIndicesForGroup.mockReturnValue([1, 3]);
      mockedExecuteWithRedirect.mockResolvedValue(okResult);

      await solution.runSolutionOnGroup(
        mockSolution,
        mockConfig,
        mockTestset,
        'g1'
      );

      expect(mockedExecuteWithRedirect).toHaveBeenCalledTimes(2);

      expect(mockedExecuteWithRedirect).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.stringContaining('test1.txt'),
        expect.anything()
      );
      expect(mockedExecuteWithRedirect).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.stringContaining('test3.txt'),
        expect.anything()
      );
    });

    it('should throw if no tests found for group', async () => {
      mockedGetTestIndicesForGroup.mockReturnValue([]);
      await expect(
        solution.runSolutionOnGroup(mockSolution, mockConfig, mockTestset, 'g1')
      ).rejects.toThrow('No tests found for group "g1"');
    });

    it('should throw if tests fail', async () => {
      mockedGetTestIndicesForGroup.mockReturnValue([1]);
      mockedExecuteWithRedirect.mockRejectedValue(new Error('Fail'));

      await expect(
        solution.runSolutionOnGroup(mockSolution, mockConfig, mockTestset, 'g1')
      ).rejects.toThrow(/Solution .* failed on group/);
    });
  });

  describe('runSolutionOnAllTestsets', () => {
    const mockSolution: LocalSolution = {
      name: 'main',
      source: 'main.cpp',
      tag: 'MA',
      sourceType: 'cpp.g++17',
    };
    const mockConfig: ConfigFile = makeConfig();

    it('should run on all testsets', async () => {
      const testsets: LocalTestset[] = [{ name: 'ts1' }, { name: 'ts2' }];
      mockedGetTestFiles.mockReturnValue(['t1.txt']);
      mockedExecuteWithRedirect.mockResolvedValue(okResult);

      await solution.runSolutionOnAllTestsets(
        mockSolution,
        mockConfig,
        testsets
      );
      expect(mockedExecuteWithRedirect).toHaveBeenCalledTimes(2);
    });

    it('should aggregate errors from multiple testsets', async () => {
      const testsets: LocalTestset[] = [{ name: 'ts1' }];
      mockedGetTestFiles.mockReturnValue(['t1.txt']);
      mockedExecuteWithRedirect.mockRejectedValue(new Error('Fail'));

      await expect(
        solution.runSolutionOnAllTestsets(mockSolution, mockConfig, testsets)
      ).rejects.toThrow(/Solution .* failed on some testsets/);
    });
  });

  describe('ensureMainSolutionExists', () => {
    it('should pass if MA solution exists', () => {
      expect(() =>
        solution.ensureMainSolutionExists([
          { name: 'm', source: '', tag: 'MA', sourceType: 'cpp.g++17' },
        ])
      ).not.toThrow();
    });

    it('should throw if no solutions', () => {
      expect(() => solution.ensureMainSolutionExists([])).toThrow();
      expect(() => solution.ensureMainSolutionExists(undefined)).toThrow();
    });

    it('should throw if no MA solution', () => {
      expect(() =>
        solution.ensureMainSolutionExists([
          { name: 'w', source: '', tag: 'WA', sourceType: 'cpp.g++17' },
        ])
      ).toThrow(/No solution with tag "MA"/);
    });
  });

  describe('ensureSolutionExists', () => {
    it('should pass if solution exists', () => {
      expect(() =>
        solution.ensureSolutionExists(
          [{ name: 'm', source: '', tag: 'MA', sourceType: 'cpp.g++17' }],
          'm'
        )
      ).not.toThrow();
    });
    it('should throw if solution missing', () => {
      expect(() =>
        solution.ensureSolutionExists(
          [{ name: 'm', source: '', tag: 'MA', sourceType: 'cpp.g++17' }],
          'z'
        )
      ).toThrow(/No solution named "z"/);
    });
  });

  describe('getMainSolution', () => {
    it('should return MA solution', () => {
      const sol: LocalSolution = {
        name: 'm',
        source: '',
        tag: 'MA',
        sourceType: 'cpp.g++17',
      };
      expect(solution.getMainSolution([sol])).toEqual(sol);
    });
    it('should throw if not found', () => {
      expect(() => solution.getMainSolution([])).toThrow();
    });
  });

  describe('testSolutionAgainstMainCorrect', () => {
    beforeEach(() => {
      mockedReadConfigFile.mockReturnValue(
        makeConfig({
          solutions: [
            {
              name: 'main',
              source: 'main.cpp',
              tag: 'MA',
              sourceType: 'cpp.g++17',
            },
            {
              name: 'wa',
              source: 'wa.cpp',
              tag: 'WA',
              sourceType: 'cpp.g++17',
            },
          ],
          checker: { name: 'chk', source: 'chk.cpp' },
          testsets: [{ name: 'ts1' }],
        })
      );
      mockedGetTestFiles.mockReturnValue(['test1.txt']);
    });

    it('should run main then target then compare', async () => {
      mockedExecuteWithRedirect.mockResolvedValue(okResult);

      mockedRunChecker.mockRejectedValue(new Error('Wrong Answer'));

      await solution.testSolutionAgainstMainCorrect('wa');

      expect(mockedExecuteWithRedirect).toHaveBeenCalledTimes(2);
      expect(mockedRunChecker).toHaveBeenCalledTimes(1);
    });

    it('should fail if main solution fails', async () => {
      mockedExecuteWithRedirect.mockRejectedValueOnce(new Error('Main fail'));
      await expect(
        solution.testSolutionAgainstMainCorrect('wa')
      ).rejects.toThrow(/Failed to test solution "wa"/);
    });

    it('should fail if comparison process fails', async () => {
      mockedGetCompiledCommandToRun.mockImplementation(() => {
        throw new Error('Compilation missing');
      });

      await expect(
        solution.testSolutionAgainstMainCorrect('wa')
      ).rejects.toThrow(/Compilation missing/);
    });
  });

  describe('startTheComparisonProcess', () => {
    const checkerOk: Awaited<ReturnType<typeof checker.runChecker>> =
      undefined as unknown as Awaited<ReturnType<typeof checker.runChecker>>;

    it('should validate expected verdicts', async () => {
      const mainSol: LocalSolution = {
        name: 'm',
        source: '',
        tag: 'MA',
        sourceType: 'cpp.g++17',
      };
      const targetSol: LocalSolution = {
        name: 'w',
        source: '',
        tag: 'WA',
        sourceType: 'cpp.g++17',
      };
      const testsets: LocalTestset[] = [{ name: 'ts1' }];
      const checkerConfig: LocalChecker = { name: 'chk', source: 'chk.cpp' };

      mockedGetTestFiles.mockReturnValue(['t1.txt']);
      mockedRunChecker.mockRejectedValue(new Error('Wrong Answer'));

      await expect(
        solution.startTheComparisonProcess(
          checkerConfig,
          mainSol,
          targetSol,
          testsets
        )
      ).resolves.not.toThrow();
    });

    it('should throw if verdict does not match expected', async () => {
      const mainSol: LocalSolution = {
        name: 'm',
        source: '',
        tag: 'MA',
        sourceType: 'cpp.g++17',
      };
      const targetSol: LocalSolution = {
        name: 'w',
        source: '',
        tag: 'WA',
        sourceType: 'cpp.g++17',
      };
      const testsets: LocalTestset[] = [{ name: 'ts1' }];

      mockedGetTestFiles.mockReturnValue(['t1.txt']);
      mockedRunChecker.mockResolvedValue(checkerOk);

      await expect(
        solution.startTheComparisonProcess(
          { name: 'chk', source: '' },
          mainSol,
          targetSol,
          testsets
        )
      ).rejects.toThrow('Error during solution comparison process');
    });

    it('should handle skip logic via checkIfShouldSkipRest interception', () => {
      // Placeholder
    });

    describe('Extended Branch Coverage', () => {
      describe('Verdict Validation via startTheComparisonProcess', () => {
        const testsets: LocalTestset[] = [{ name: 'ts1' }];
        const checkerConfig: LocalChecker = {
          name: 'chk',
          source: 'chk.cpp',
        };

        beforeEach(() => {
          mockedGetTestFiles.mockReturnValue(['t1.txt']);
          // Default: main solution OK
          mockedReadFirstLine.mockImplementation((p: string) => {
            if (p.includes('sol_main')) return Promise.resolve('42'); // Main OK
            return Promise.resolve(''); // Target default
          });
        });

        it('should pass if solution tag is TL and it gets TLE', async () => {
          const mainSol: LocalSolution = {
            name: 'sol_main',
            source: '',
            tag: 'MA',
            sourceType: 'cpp.g++17',
          };
          const targetSol: LocalSolution = {
            name: 'sol_target',
            source: '',
            tag: 'TL',
            sourceType: 'cpp.g++17',
          };

          mockedReadFirstLine.mockImplementation((p: string) => {
            if (p.includes('sol_main')) return Promise.resolve('42');
            if (p.includes('sol_target'))
              return Promise.resolve('Time Limit Exceeded');
            return Promise.resolve('');
          });

          await expect(
            solution.startTheComparisonProcess(
              checkerConfig,
              mainSol,
              targetSol,
              testsets
            )
          ).resolves.not.toThrow();
        });

        it('should fail if solution tag is MA but gets TLE', async () => {
          const mainSol: LocalSolution = {
            name: 'sol_main',
            source: '',
            tag: 'MA',
            sourceType: 'cpp.g++17',
          };
          const targetSol: LocalSolution = {
            name: 'sol_target',
            source: '',
            tag: 'MA',
            sourceType: 'cpp.g++17',
          };

          mockedReadFirstLine.mockImplementation((p: string) => {
            if (p.includes('sol_main')) return Promise.resolve('42');
            if (p.includes('sol_target'))
              return Promise.resolve('Time Limit Exceeded');
            return Promise.resolve('');
          });

          await expect(
            solution.startTheComparisonProcess(
              checkerConfig,
              mainSol,
              targetSol,
              testsets
            )
          ).rejects.toThrow(/marked as.*MA.*but got.*Time Limit Exceeded/);
        });

        it('should pass if solution tag is ML and it gets MLE', async () => {
          const mainSol: LocalSolution = {
            name: 'sol_main',
            source: '',
            tag: 'MA',
            sourceType: 'cpp.g++17',
          };
          const targetSol: LocalSolution = {
            name: 'sol_target',
            source: '',
            tag: 'ML',
            sourceType: 'cpp.g++17',
          };

          mockedReadFirstLine.mockImplementation((p: string) => {
            if (p.includes('sol_main')) return Promise.resolve('42');
            if (p.includes('sol_target'))
              return Promise.resolve('Memory Limit Exceeded');
            return Promise.resolve('');
          });

          await expect(
            solution.startTheComparisonProcess(
              checkerConfig,
              mainSol,
              targetSol,
              testsets
            )
          ).resolves.not.toThrow();
        });

        it('should fail if solution tag is MA but gets MLE', async () => {
          const mainSol: LocalSolution = {
            name: 'sol_main',
            source: '',
            tag: 'MA',
            sourceType: 'cpp.g++17',
          };
          const targetSol: LocalSolution = {
            name: 'sol_target',
            source: '',
            tag: 'MA',
            sourceType: 'cpp.g++17',
          };

          mockedReadFirstLine.mockImplementation((p: string) => {
            if (p.includes('sol_main')) return Promise.resolve('42');
            if (p.includes('sol_target'))
              return Promise.resolve('Memory Limit Exceeded');
            return Promise.resolve('');
          });

          await expect(
            solution.startTheComparisonProcess(
              checkerConfig,
              mainSol,
              targetSol,
              testsets
            )
          ).rejects.toThrow(/marked as.*MA.*but got.*Memory Limit Exceeded/);
        });

        it('should pass if solution tag is RE and it gets RTE', async () => {
          const mainSol: LocalSolution = {
            name: 'sol_main',
            source: '',
            tag: 'MA',
            sourceType: 'cpp.g++17',
          };
          const targetSol: LocalSolution = {
            name: 'sol_target',
            source: '',
            tag: 'RE',
            sourceType: 'cpp.g++17',
          };

          mockedReadFirstLine.mockImplementation((p: string) => {
            if (p.includes('sol_main')) return Promise.resolve('42');
            if (p.includes('sol_target'))
              return Promise.resolve('Runtime Error');
            return Promise.resolve('');
          });

          await expect(
            solution.startTheComparisonProcess(
              checkerConfig,
              mainSol,
              targetSol,
              testsets
            )
          ).resolves.not.toThrow();
        });

        it('should fail if solution tag is MA but gets RTE', async () => {
          const mainSol: LocalSolution = {
            name: 'sol_main',
            source: '',
            tag: 'MA',
            sourceType: 'cpp.g++17',
          };
          const targetSol: LocalSolution = {
            name: 'sol_target',
            source: '',
            tag: 'MA',
            sourceType: 'cpp.g++17',
          };

          mockedReadFirstLine.mockImplementation((p: string) => {
            if (p.includes('sol_main')) return Promise.resolve('42');
            if (p.includes('sol_target'))
              return Promise.resolve('Runtime Error');
            return Promise.resolve('');
          });

          await expect(
            solution.startTheComparisonProcess(
              checkerConfig,
              mainSol,
              targetSol,
              testsets
            )
          ).rejects.toThrow(/marked as.*MA.*but got.*Runtime Error/);
        });

        it('should fail if tag is TL but did not get TLE', async () => {
          const mainSol: LocalSolution = {
            name: 'sol_main',
            source: '',
            tag: 'MA',
            sourceType: 'cpp.g++17',
          };
          const targetSol: LocalSolution = {
            name: 'sol_target',
            source: '',
            tag: 'TL',
            sourceType: 'cpp.g++17',
          };

          // Normal output -> No TLE
          mockedReadFirstLine.mockResolvedValue('42');
          mockedRunChecker.mockResolvedValue(checkerOk);

          await expect(
            solution.startTheComparisonProcess(
              checkerConfig,
              mainSol,
              targetSol,
              testsets
            )
          ).rejects.toThrow(
            /marked as.*TL.*but did not get.*Time Limit Exceeded/
          );
        });

        it('should fail if tag is WA but did not get WA', async () => {
          const mainSol: LocalSolution = {
            name: 'sol_main',
            source: '',
            tag: 'MA',
            sourceType: 'cpp.g++17',
          };
          const targetSol: LocalSolution = {
            name: 'sol_target',
            source: '',
            tag: 'WA',
            sourceType: 'cpp.g++17',
          };

          // Checker passes -> No WA
          mockedReadFirstLine.mockResolvedValue('42');
          mockedRunChecker.mockResolvedValue(checkerOk);

          await expect(
            solution.startTheComparisonProcess(
              checkerConfig,
              mainSol,
              targetSol,
              testsets
            )
          ).rejects.toThrow(/marked as.*WA.*but did not get.*Wrong Answer/);
        });
      });

      describe('Control Flow', () => {
        it('should stop running testset after first failure', async () => {
          const mockSolution: LocalSolution = {
            name: 'main',
            source: 'main.cpp',
            tag: 'MA',
          };
          const mockConfig: ConfigFile = makeConfig();

          mockedGetTestFiles.mockReturnValue(['t1.txt', 't2.txt', 't3.txt']);
          // Fail on first
          mockedExecuteWithRedirect.mockRejectedValueOnce(new Error('Fail'));

          await expect(
            solution.runSolutionOnTestset(mockSolution, mockConfig, 'ts1')
          ).rejects.toThrow();

          // Should only be called once due to break
          expect(mockedExecuteWithRedirect).toHaveBeenCalledTimes(1);
        });

        it('should stop running group after first failure', async () => {
          const mockSolution: LocalSolution = {
            name: 'main',
            source: 'main.cpp',
            tag: 'MA',
          };
          const mockConfig: ConfigFile = makeConfig();
          const mockTestset: LocalTestset = { name: 'ts1' };

          mockedGetTestIndicesForGroup.mockReturnValue([1, 2]);

          mockedExecuteWithRedirect.mockRejectedValueOnce(new Error('Fail'));

          await expect(
            solution.runSolutionOnGroup(
              mockSolution,
              mockConfig,
              mockTestset,
              'g1'
            )
          ).rejects.toThrow();
          expect(mockedExecuteWithRedirect).toHaveBeenCalledTimes(1);
        });
      });

      describe('Filesystem', () => {
        it('should ensure output directory is created', async () => {
          const mockSolution: LocalSolution = {
            name: 'main',
            source: 'main.cpp',
            tag: 'MA',
          };
          const mockConfig: ConfigFile = makeConfig();

          // Mock fs.existsSync to return false, forcing mkdirSync
          mockedFsExistsSync.mockReturnValue(false);
          mockedExecuteWithRedirect.mockResolvedValue(okResult);

          await solution.runSolutionOnSingleTest(
            mockSolution,
            mockConfig,
            'ts1',
            1
          );

          expect(mockedFsMkdirSync).toHaveBeenCalledWith(
            expect.stringContaining('main/ts1'),
            expect.anything()
          );
        });

        it('should delete existing output file', async () => {
          const mockSolution: LocalSolution = {
            name: 'main',
            source: 'main.cpp',
            tag: 'MA',
          };
          const mockConfig: ConfigFile = makeConfig();

          mockedFsExistsSync.mockReturnValue(true);
          mockedExecuteWithRedirect.mockResolvedValue(okResult);

          await solution.runSolutionOnSingleTest(
            mockSolution,
            mockConfig,
            'ts1',
            1
          );

          expect(mockedFsUnlinkSync).toHaveBeenCalled();
        });
      });
    });
  });
});

// Reference type-only imports to avoid unused-import errors with verbatim modes.
export type { CheckerVerdict };
