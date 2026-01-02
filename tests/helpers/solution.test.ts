import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as solution from '../../src/helpers/solution';
import { executor } from '../../src/executor';
import * as utils from '../../src/helpers/utils';
import * as checker from '../../src/helpers/checker';
import * as testsetHelper from '../../src/helpers/testset';
import fs from 'fs';
import path from 'path';
import ConfigFile, { LocalSolution, LocalTestset } from '../../src/types';

vi.mock('../../src/executor', () => ({
  executor: {
    execute: vi.fn(),
    executeWithRedirect: vi.fn(),
    cleanup: vi.fn(),
  },
}));

vi.mock('../../src/helpers/utils', async () => {
  const actual = await vi.importActual('../../src/helpers/utils');
  return {
    ...actual,

    throwError: vi.fn((err, msg) => {
      if (msg) {
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
  const actual = await vi.importActual('path');
  return {
    ...actual,
    resolve: vi.fn((...args) => args.join('/')),
  };
});
vi.mock('../../src/formatter', () => ({
  fmt: {
    info: vi.fn(),
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    infoIcon: () => 'ℹ',
    highlight: (s: string) => s,
    dim: (s: string) => s,
    primary: (s: string) => s,
    bold: (s: string) => s,
    cross: () => '✗',
  },
}));

describe('solution.ts', () => {
  const mockExit = vi.spyOn(process, 'exit').mockImplementation(() => {
    throw new Error('process.exit called');
  });

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined as any);
    vi.mocked(fs.unlinkSync).mockReturnValue(undefined as any);
    vi.mocked(utils.readConfigFile).mockReturnValue({
      solutions: [],
      checker: { source: 'checker.cpp' },
      testsets: [],
      timeLimit: 1000,
      memoryLimit: 256,
    } as any);
    vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./solution');
    vi.mocked(utils.readFirstLine).mockResolvedValue('');
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
      { name: 'wa', source: 'wa.cpp', tag: 'WA', type: 'wrong-answer' } as any,
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
      expect(utils.compileCPP).toHaveBeenCalledWith('sol.cpp');
    });

    it('should compile java solution', async () => {
      vi.spyOn(path, 'extname').mockReturnValue('.java');
      await solution.compileSolution('sol.java');
      expect(utils.compileJava).toHaveBeenCalledWith('sol.java');
    });

    it('should not compile python solution', async () => {
      vi.spyOn(path, 'extname').mockReturnValue('.py');
      await solution.compileSolution('sol.py');
      expect(utils.compileCPP).not.toHaveBeenCalled();
      expect(utils.compileJava).not.toHaveBeenCalled();
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
      expect(utils.compileCPP).toHaveBeenCalledWith('s1.cpp');
      expect(utils.compileJava).toHaveBeenCalledWith('s2.java');
    });
  });

  describe('runSolutionOnSingleTest', () => {
    const mockSolution: LocalSolution = {
      name: 'main',
      source: 'main.cpp',
      tag: 'MA',
    };
    const mockConfig: ConfigFile = {
      timeLimit: 1000,
      memoryLimit: 256,
    } as any;

    it('should execute solution successfully', async () => {
      vi.mocked(executor.executeWithRedirect).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        success: true,
      });

      await solution.runSolutionOnSingleTest(
        mockSolution,
        mockConfig,
        'testsets',
        1
      );

      expect(executor.executeWithRedirect).toHaveBeenCalled();
      const calls = vi.mocked(executor.executeWithRedirect).mock.calls[0];

      expect(calls[1]).toMatchObject({ timeout: 1000, memoryLimitMB: 256 });
    });

    it('should throw if execution fails', async () => {
      vi.mocked(executor.executeWithRedirect).mockRejectedValue(
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
      vi.mocked(executor.executeWithRedirect).mockImplementation(
        async (_cmd, options: any) => {
          options.onError({ stderr: 'Segfault' });
          return {} as any;
        }
      );
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});

      await expect(
        solution.runSolutionOnSingleTest(
          mockSolution,
          mockConfig,
          'testset1',
          1
        )
      ).rejects.toThrow('Runtime Error: Segfault');

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('output_test1.txt'),
        'Runtime Error: Segfault'
      );
    });

    it('should handle timeout (onTimeout callback)', async () => {
      vi.mocked(executor.executeWithRedirect).mockImplementation(
        async (_cmd, options: any) => {
          options.onTimeout();
          return {} as any;
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

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('output_test1.txt'),
        expect.stringContaining('Time Limit Exceeded')
      );
    });

    it('should handle memory exceeded (onMemoryExceeded callback)', async () => {
      vi.mocked(executor.executeWithRedirect).mockImplementation(
        async (_cmd, options: any) => {
          options.onMemoryExceeded();
          return {} as any;
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

      expect(fs.writeFileSync).toHaveBeenCalledWith(
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
    const mockConfig: ConfigFile = { timeLimit: 1000, memoryLimit: 256 } as any;

    it('should run on all test files', async () => {
      vi.mocked(utils.getTestFiles).mockReturnValue(['test1.txt', 'test2.txt']);
      vi.mocked(executor.executeWithRedirect).mockResolvedValue({} as any);

      await solution.runSolutionOnTestset(mockSolution, mockConfig, 'testset1');

      expect(executor.executeWithRedirect).toHaveBeenCalledTimes(2);
    });

    it('should throw aggregate error if tests fail', async () => {
      vi.mocked(utils.getTestFiles).mockReturnValue(['test1.txt']);
      vi.mocked(executor.executeWithRedirect).mockRejectedValue(
        new Error('Fail')
      );

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
    const mockConfig: ConfigFile = { timeLimit: 1000, memoryLimit: 256 } as any;
    const mockTestset: LocalTestset = { name: 'ts1' };

    it('should run tests belonging to group', async () => {
      vi.mocked(testsetHelper.getGeneratorCommands).mockReturnValue([
        { type: 'manual', group: 'g1' },
        { type: 'manual', group: 'g2' },
        { type: 'manual', group: 'g1' },
      ] as any);
      vi.mocked(executor.executeWithRedirect).mockResolvedValue({} as any);

      await solution.runSolutionOnGroup(
        mockSolution,
        mockConfig,
        mockTestset,
        'g1'
      );

      expect(executor.executeWithRedirect).toHaveBeenCalledTimes(2);

      expect(executor.executeWithRedirect).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.stringContaining('test1.txt'),
        expect.anything()
      );
      expect(executor.executeWithRedirect).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.stringContaining('test3.txt'),
        expect.anything()
      );
    });

    it('should throw if no tests found for group', async () => {
      vi.mocked(testsetHelper.getGeneratorCommands).mockReturnValue([
        { type: 'manual', group: 'g2' },
      ] as any);
      await expect(
        solution.runSolutionOnGroup(mockSolution, mockConfig, mockTestset, 'g1')
      ).rejects.toThrow('No tests found for group "g1"');
    });

    it('should throw if tests fail', async () => {
      vi.mocked(testsetHelper.getGeneratorCommands).mockReturnValue([
        { type: 'manual', group: 'g1' },
      ] as any);
      vi.mocked(executor.executeWithRedirect).mockRejectedValue(
        new Error('Fail')
      );

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
    const mockConfig: ConfigFile = { timeLimit: 1000, memoryLimit: 256 } as any;

    it('should run on all testsets', async () => {
      const testsets: LocalTestset[] = [{ name: 'ts1' }, { name: 'ts2' }];
      vi.mocked(utils.getTestFiles).mockReturnValue(['t1.txt']);
      vi.mocked(executor.executeWithRedirect).mockResolvedValue({} as any);

      await solution.runSolutionOnAllTestsets(
        mockSolution,
        mockConfig,
        testsets
      );
      expect(executor.executeWithRedirect).toHaveBeenCalledTimes(2);
    });

    it('should aggregate errors from multiple testsets', async () => {
      const testsets: LocalTestset[] = [{ name: 'ts1' }];
      vi.mocked(utils.getTestFiles).mockReturnValue(['t1.txt']);
      vi.mocked(executor.executeWithRedirect).mockRejectedValue(
        new Error('Fail')
      );

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
          { name: 'w', source: '', tag: 'WA', sourceType: 'cpp.g++17' } as any,
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
      const sol = {
        name: 'm',
        source: '',
        tag: 'MA',
        sourceType: 'cpp.g++17',
      } as LocalSolution;
      expect(solution.getMainSolution([sol])).toEqual(sol);
    });
    it('should throw if not found', () => {
      expect(() => solution.getMainSolution([])).toThrow();
    });
  });

  describe('testSolutionAgainstMainCorrect', () => {
    beforeEach(() => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        solutions: [
          {
            name: 'main',
            source: 'main.cpp',
            tag: 'MA',
            sourceType: 'cpp.g++17',
          },
          { name: 'wa', source: 'wa.cpp', tag: 'WA', sourceType: 'cpp.g++17' },
        ],
        checker: { name: 'chk', source: 'chk.cpp' },
        testsets: [{ name: 'ts1' }],
        timeLimit: 1000,
        memoryLimit: 256,
      } as any);
      vi.mocked(utils.getTestFiles).mockReturnValue(['test1.txt']);
    });

    it('should run main then target then compare', async () => {
      vi.mocked(executor.executeWithRedirect).mockResolvedValue({} as any);

      vi.mocked(checker.runChecker).mockRejectedValue(
        new Error('Wrong Answer')
      );

      await solution.testSolutionAgainstMainCorrect('wa');

      expect(executor.executeWithRedirect).toHaveBeenCalledTimes(2);
      expect(checker.runChecker).toHaveBeenCalledTimes(1);
    });

    it('should fail if main solution fails', async () => {
      vi.mocked(executor.executeWithRedirect).mockRejectedValueOnce(
        new Error('Main fail')
      );
      await expect(
        solution.testSolutionAgainstMainCorrect('wa')
      ).rejects.toThrow(/Failed to test solution "wa"/);
    });

    it('should fail if comparison process fails', async () => {
      vi.mocked(utils.getCompiledCommandToRun).mockImplementation(() => {
        throw new Error('Compilation missing');
      });

      await expect(
        solution.testSolutionAgainstMainCorrect('wa')
      ).rejects.toThrow(/Compilation missing/);
    });
  });

  describe('startTheComparisonProcess', () => {
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
      } as any;
      const testsets: LocalTestset[] = [{ name: 'ts1' }];
      const checkerConfig = { name: 'chk', source: 'chk.cpp' };

      vi.mocked(utils.getTestFiles).mockReturnValue(['t1.txt']);
      vi.mocked(checker.runChecker).mockRejectedValue(
        new Error('Wrong Answer')
      );

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
      } as any;
      const testsets: LocalTestset[] = [{ name: 'ts1' }];

      vi.mocked(utils.getTestFiles).mockReturnValue(['t1.txt']);
      vi.mocked(checker.runChecker).mockResolvedValue({} as any);

      await expect(
        solution.startTheComparisonProcess(
          { name: 'chk', source: '' },
          mainSol,
          targetSol,
          testsets
        )
      ).rejects.toThrow('Error during solution comparison process');
    });

    it('should handle skip logic via checkIfShouldSkipRest interception', async () => {
      // Placeholder
    });

    describe('Extended Branch Coverage', () => {
      describe('Verdict Validation via startTheComparisonProcess', () => {
        const testsets: LocalTestset[] = [{ name: 'ts1' }];
        const checkerConfig = { name: 'chk', source: 'chk.cpp' };

        beforeEach(() => {
          vi.mocked(utils.getTestFiles).mockReturnValue(['t1.txt']);
          // Default: main solution OK
          vi.mocked(utils.readFirstLine).mockImplementation(
            async (p: string) => {
              if (p.includes('sol_main')) return '42'; // Main OK
              return ''; // Target default
            }
          );
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
          } as any;

          vi.mocked(utils.readFirstLine).mockImplementation(
            async (p: string) => {
              if (p.includes('sol_main')) return '42';
              if (p.includes('sol_target')) return 'Time Limit Exceeded';
              return '';
            }
          );

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
          } as any;

          vi.mocked(utils.readFirstLine).mockImplementation(
            async (p: string) => {
              if (p.includes('sol_main')) return '42';
              if (p.includes('sol_target')) return 'Time Limit Exceeded';
              return '';
            }
          );

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
          } as any;

          vi.mocked(utils.readFirstLine).mockImplementation(
            async (p: string) => {
              if (p.includes('sol_main')) return '42';
              if (p.includes('sol_target')) return 'Memory Limit Exceeded';
              return '';
            }
          );

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
          } as any;

          vi.mocked(utils.readFirstLine).mockImplementation(
            async (p: string) => {
              if (p.includes('sol_main')) return '42';
              if (p.includes('sol_target')) return 'Memory Limit Exceeded';
              return '';
            }
          );

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
          } as any;

          vi.mocked(utils.readFirstLine).mockImplementation(
            async (p: string) => {
              if (p.includes('sol_main')) return '42';
              if (p.includes('sol_target')) return 'Runtime Error';
              return '';
            }
          );

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
          } as any;

          vi.mocked(utils.readFirstLine).mockImplementation(
            async (p: string) => {
              if (p.includes('sol_main')) return '42';
              if (p.includes('sol_target')) return 'Runtime Error';
              return '';
            }
          );

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
          } as any;

          // Normal output -> No TLE
          vi.mocked(utils.readFirstLine).mockResolvedValue('42');
          vi.mocked(checker.runChecker).mockResolvedValue({} as any);

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
          } as any;

          // Checker passes -> No WA
          vi.mocked(utils.readFirstLine).mockResolvedValue('42');
          vi.mocked(checker.runChecker).mockResolvedValue({} as any);

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
          const mockConfig: ConfigFile = {
            timeLimit: 1000,
            memoryLimit: 256,
          } as any;

          vi.mocked(utils.getTestFiles).mockReturnValue([
            't1.txt',
            't2.txt',
            't3.txt',
          ]);
          // Fail on first
          vi.mocked(executor.executeWithRedirect).mockRejectedValueOnce(
            new Error('Fail')
          );

          await expect(
            solution.runSolutionOnTestset(mockSolution, mockConfig, 'ts1')
          ).rejects.toThrow();

          // Should only be called once due to break
          expect(executor.executeWithRedirect).toHaveBeenCalledTimes(1);
        });

        it('should stop running group after first failure', async () => {
          const mockSolution: LocalSolution = {
            name: 'main',
            source: 'main.cpp',
            tag: 'MA',
          };
          const mockConfig: ConfigFile = {
            timeLimit: 1000,
            memoryLimit: 256,
          } as any;
          const mockTestset: LocalTestset = { name: 'ts1' };

          vi.mocked(testsetHelper.getGeneratorCommands).mockReturnValue([
            { type: 'manual', group: 'g1' },
            { type: 'manual', group: 'g1' },
          ] as any);

          vi.mocked(executor.executeWithRedirect).mockRejectedValueOnce(
            new Error('Fail')
          );

          await expect(
            solution.runSolutionOnGroup(
              mockSolution,
              mockConfig,
              mockTestset,
              'g1'
            )
          ).rejects.toThrow();
          expect(executor.executeWithRedirect).toHaveBeenCalledTimes(1);
        });
      });

      describe('Filesystem', () => {
        it('should ensure output directory is created', async () => {
          const mockSolution: LocalSolution = {
            name: 'main',
            source: 'main.cpp',
            tag: 'MA',
          };
          const mockConfig: ConfigFile = {
            timeLimit: 1000,
            memoryLimit: 256,
          } as any;

          // Mock fs.existsSync to return false, forcing mkdirSync
          vi.mocked(fs.existsSync).mockReturnValue(false);
          vi.mocked(executor.executeWithRedirect).mockResolvedValue({} as any);

          await solution.runSolutionOnSingleTest(
            mockSolution,
            mockConfig,
            'ts1',
            1
          );

          expect(fs.mkdirSync).toHaveBeenCalledWith(
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
          const mockConfig: ConfigFile = {
            timeLimit: 1000,
            memoryLimit: 256,
          } as any;

          vi.mocked(fs.existsSync).mockReturnValue(true);
          vi.mocked(executor.executeWithRedirect).mockResolvedValue({} as any);

          await solution.runSolutionOnSingleTest(
            mockSolution,
            mockConfig,
            'ts1',
            1
          );

          expect(fs.unlinkSync).toHaveBeenCalled();
        });
      });
    });
  });
});
