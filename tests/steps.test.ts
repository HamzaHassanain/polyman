/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

/* eslint-disable @typescript-eslint/unbound-method */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as steps from '../src/steps';
import * as createTemplate from '../src/helpers/create-template';
import * as testlibDownload from '../src/helpers/testlib-download';
import * as validator from '../src/helpers/validator';
import * as generator from '../src/helpers/generator';
import * as formatter from '../src/formatter';
import * as checker from '../src/helpers/checker';
import * as solution from '../src/helpers/solution';
import * as testset from '../src/helpers/testset';
import * as utils from '../src/helpers/utils';
import { NonInteractiveError } from '../src/helpers/errors';
import { LimitExceededError, PolymanError } from '../src/errors';
import * as remoteUtils from '../src/helpers/remote/utils';
import * as pulling from '../src/helpers/remote/pulling';
import * as pushing from '../src/helpers/remote/pushing';
import * as viewer from '../src/helpers/remote/viewer';
import * as polygonModule from '../src/polygon';
import { report } from '../src/report';
import fs from 'fs';

vi.mock('../src/helpers/create-template');
vi.mock('../src/helpers/testlib-download');
vi.mock('../src/helpers/utils');
vi.mock('../src/helpers/validator');
vi.mock('../src/helpers/checker');
vi.mock('../src/helpers/generator');
vi.mock('../src/helpers/solution');
vi.mock('../src/helpers/testset');
vi.mock('../src/helpers/remote/utils');
vi.mock('../src/helpers/remote/pulling');
vi.mock('../src/helpers/remote/pushing');
vi.mock('../src/helpers/remote/viewer');
vi.mock('../src/polygon', () => {
  const PolygonSDK = vi.fn(function (
    this: Record<string, unknown>,
    _config: unknown
  ) {
    this.listProblems = vi.fn();
    this.getProblemInfo = vi.fn();
    this.commitChanges = vi.fn();
    this.listPackages = vi.fn();
    this.buildPackage = vi.fn();
    this.createProblem = vi.fn();
  });
  return { PolygonSDK };
});
vi.mock('../src/formatter', () => ({
  fmt: {
    step: vi.fn(),
    stepComplete: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    log: vi.fn(),
    newLine: vi.fn(),
    infoIcon: vi.fn().mockReturnValue('i'),
    highlight: vi.fn().mockImplementation((s: string) => s),
    dim: vi.fn().mockImplementation((s: string) => s),
    primary: vi.fn().mockImplementation((s: string) => s),
    checkmark: vi.fn().mockReturnValue('OK'),
    cross: vi.fn().mockReturnValue('X'),
  },
}));
vi.mock('fs');

const baseConfig = (overrides: Partial<any> = {}): any => ({
  name: 'p',
  problemId: 7,
  timeLimit: 1000,
  memoryLimit: 256,
  inputFile: 'stdin',
  outputFile: 'stdout',
  interactive: false,
  statements: {},
  solutions: [],
  checker: { name: 'wcmp', source: 'wcmp.cpp', isStandard: true },
  validator: { name: 'val', source: 'val.cpp' },
  generators: [],
  testsets: [],
  ...overrides,
});

describe('steps.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('stepCreateDirectoryStructure', () => {
    it('should create directories', () => {
      vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
      steps.stepCreateDirectoryStructure(1, 'prob');
      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(formatter.fmt.step).toHaveBeenCalledWith(1, expect.any(String));
    });
  });

  describe('stepCopyTemplateFiles', () => {
    it('should copy templates', () => {
      steps.stepCopyTemplateFiles(2, 'prob');
      expect(createTemplate.copyTemplate).toHaveBeenCalled();
      expect(formatter.fmt.stepComplete).toHaveBeenCalled();
    });
  });

  describe('stepDownloadTestlib', () => {
    it('should download and return testlib', async () => {
      vi.mocked(testlibDownload.downloadFile).mockResolvedValue('testlib code');
      const result = await steps.stepDownloadTestlib(3);
      expect(result).toBe('testlib code');
      expect(testlibDownload.downloadFile).toHaveBeenCalled();
    });

    it('should fail if download fails', async () => {
      vi.mocked(testlibDownload.downloadFile).mockRejectedValue(
        new Error('fail')
      );
      await expect(steps.stepDownloadTestlib(3)).rejects.toThrow('fail');
    });
  });

  describe('stepCompileValidator', () => {
    it('should compile validator', async () => {
      const config: any = { validator: 'val' };
      await steps.stepCompileValidator(4, config);
      expect(validator.compileValidator).toHaveBeenCalled();
    });
  });

  describe('stepCompileGeneratorsForTestsets', () => {
    it('should compile generators', async () => {
      await steps.stepCompileGeneratorsForTestsets(5, {} as any);
      expect(generator.compileGeneratorsForTestsets).toHaveBeenCalled();
    });
  });

  describe('stepSaveTestlibToDirectory', () => {
    it('does not replace a testlib.h with other contents, such as a pulled one', () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(true);
      vi.mocked(fs.readFileSync).mockReturnValueOnce('// Polygon testlib.h\n');
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

      let thrown: unknown;
      try {
        steps.stepSaveTestlibToDirectory(1, '// upstream testlib.h\n');
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(PolymanError);
      expect((thrown as PolymanError).exitCode).toBe(2);
      expect((thrown as PolymanError).message).toContain('was not replaced');
      expect((thrown as PolymanError).hint).toContain('Delete it first');
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('writes over a testlib.h that only differs in line endings', () => {
      vi.mocked(fs.existsSync).mockReturnValueOnce(true);
      vi.mocked(fs.readFileSync).mockReturnValueOnce('a\r\nb\r\n');
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

      steps.stepSaveTestlibToDirectory(1, 'a\nb\n');

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('testlib.h'),
        'a\nb\n',
        'utf-8'
      );
    });

    it('should write testlib content to current dir', () => {
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
      steps.stepSaveTestlibToDirectory(1, 'content');
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('testlib.h'),
        'content',
        'utf-8'
      );
      expect(formatter.fmt.stepComplete).toHaveBeenCalled();
    });
  });

  describe('stepValidateConfigForValidator', () => {
    it('should ensure validator and testsets exist', () => {
      const config = baseConfig({ testsets: [{ name: 't' }] });
      steps.stepValidateConfigForValidator(1, config);
      expect(validator.ensureValidatorExists).toHaveBeenCalledWith(
        config.validator
      );
      expect(testset.ensureTestsetsExist).toHaveBeenCalledWith(config.testsets);
      expect(formatter.fmt.stepComplete).toHaveBeenCalled();
    });
  });

  describe('stepValidateAllTestsets', () => {
    it('should call validateAllTestsets', async () => {
      const config = baseConfig();
      await steps.stepValidateAllTestsets(1, config);
      expect(validator.validateAllTestsets).toHaveBeenCalledWith(
        config.validator,
        config.testsets
      );
    });
  });

  describe('stepValidateSingleTest', () => {
    it('should call validateSingleTest', async () => {
      const config = baseConfig();
      await steps.stepValidateSingleTest(1, config, 'tests', 3);
      expect(validator.validateSingleTest).toHaveBeenCalledWith(
        config.validator,
        'tests',
        3
      );
    });
  });

  describe('stepValidateGroup', () => {
    it('should call validateGroup', async () => {
      const config = baseConfig();
      const ts = { name: 'tests' } as any;
      await steps.stepValidateGroup(1, config, ts, 'g1');
      expect(validator.validateGroup).toHaveBeenCalledWith(
        config.validator,
        ts,
        'g1'
      );
    });
  });

  describe('stepValidateTestset', () => {
    it('should call validateTestset', async () => {
      const config = baseConfig();
      await steps.stepValidateTestset(1, config, 'tests');
      expect(validator.validateTestset).toHaveBeenCalledWith(
        config.validator,
        'tests'
      );
    });
  });

  describe('stepValidateConfigForGeneration', () => {
    it('should warn if no generators defined', () => {
      const config = baseConfig({ generators: [] });
      steps.stepValidateConfigForGeneration(1, config);
      expect(formatter.fmt.warning).toHaveBeenCalledWith(
        expect.stringContaining('No generators')
      );
    });

    it('should report generators count when present', () => {
      const config = baseConfig({
        generators: [{ name: 'g', source: 'g.cpp' }],
      });
      steps.stepValidateConfigForGeneration(1, config);
      expect(testset.ensureTestsetsExist).toHaveBeenCalled();
      expect(formatter.fmt.warning).not.toHaveBeenCalled();
    });
  });

  describe('stepGenerateAllTestsets', () => {
    it('should call generateAllTestsets', async () => {
      const config = baseConfig();
      await steps.stepGenerateAllTestsets(1, config);
      expect(testset.generateAllTestsets).toHaveBeenCalledWith(
        config.testsets,
        config.generators
      );
    });
  });

  describe('stepCompileGeneratorsForSingleTest', () => {
    it('should compile only the resolved test at the given index', async () => {
      const tests = [
        {
          index: 1,
          source: {
            kind: 'generator',
            generator: 'g',
            args: [],
            multiOutputs: null,
          },
        },
        { index: 2, source: { kind: 'manual', inputFile: './m.in' } },
      ];
      vi.mocked(testset.getResolvedTests).mockReturnValue(tests as any);
      const config = baseConfig({
        generators: [{ name: 'g', source: 'g.cpp' }],
      });
      await steps.stepCompileGeneratorsForSingleTest(
        1,
        config,
        { name: 'tests' },
        2
      );
      expect(generator.compileGeneratorsForTests).toHaveBeenCalledWith(
        [tests[1]],
        config.generators
      );
    });
  });

  describe('stepGenerateSingleTest', () => {
    it('should call generateSingleTest', async () => {
      const config = baseConfig();
      await steps.stepGenerateSingleTest(1, config, { name: 'tests' }, 2);
      expect(testset.generateSingleTest).toHaveBeenCalledWith(
        { name: 'tests' },
        2,
        config.generators
      );
    });
  });

  describe('stepCompileGeneratorsForGroup', () => {
    it('should filter resolved tests by group name', async () => {
      const tests = [
        {
          index: 1,
          source: {
            kind: 'generator',
            generator: 'g',
            args: [],
            multiOutputs: null,
          },
          group: 'a',
        },
        {
          index: 2,
          source: {
            kind: 'generator',
            generator: 'g',
            args: [],
            multiOutputs: null,
          },
          group: 'b',
        },
      ];
      vi.mocked(testset.getResolvedTests).mockReturnValue(tests as any);
      const config = baseConfig();
      await steps.stepCompileGeneratorsForGroup(
        1,
        config,
        { name: 'tests' },
        'a'
      );
      expect(generator.compileGeneratorsForTests).toHaveBeenCalledWith(
        [tests[0]],
        config.generators
      );
    });

    it('should pass every resolved test when group is "all"', async () => {
      const tests = [
        {
          index: 1,
          source: {
            kind: 'generator',
            generator: 'g',
            args: [],
            multiOutputs: null,
          },
          group: 'a',
        },
        {
          index: 2,
          source: {
            kind: 'generator',
            generator: 'g',
            args: [],
            multiOutputs: null,
          },
          group: 'b',
        },
      ];
      vi.mocked(testset.getResolvedTests).mockReturnValue(tests as any);
      const config = baseConfig();
      await steps.stepCompileGeneratorsForGroup(
        1,
        config,
        { name: 'tests' },
        'all'
      );
      expect(generator.compileGeneratorsForTests).toHaveBeenCalledWith(
        tests,
        config.generators
      );
    });
  });

  describe('stepGenerateTestsForGroup', () => {
    it('should call generateTestsForGroup', async () => {
      const config = baseConfig();
      await steps.stepGenerateTestsForGroup(1, config, { name: 'tests' }, 'g');
      expect(testset.generateTestsForGroup).toHaveBeenCalledWith(
        { name: 'tests' },
        'g',
        config.generators
      );
    });
  });

  describe('stepCompileGeneratorsForTestset', () => {
    it('should compile every resolved test in the testset', async () => {
      const tests = [
        {
          index: 1,
          source: {
            kind: 'generator',
            generator: 'g',
            args: [],
            multiOutputs: null,
          },
        },
      ];
      vi.mocked(testset.getResolvedTests).mockReturnValue(tests as any);
      const config = baseConfig();
      await steps.stepCompileGeneratorsForTestset(1, config, {
        name: 'tests',
      });
      expect(generator.compileGeneratorsForTests).toHaveBeenCalledWith(
        tests,
        config.generators
      );
    });
  });

  describe('stepGenerateTestsForTestset', () => {
    it('should call generateTestsForTestset', async () => {
      const config = baseConfig();
      await steps.stepGenerateTestsForTestset(1, config, {
        name: 'tests',
      });
      expect(testset.generateTestsForTestset).toHaveBeenCalledWith(
        { name: 'tests' },
        config.generators
      );
    });
  });

  describe('stepValidateConfigForSolutions', () => {
    it('should validate solutions and testsets', () => {
      const config = baseConfig({
        solutions: [{ name: 'a', source: 'a.cpp', tag: 'MA' }],
        testsets: [{ name: 'tests' }],
      });
      steps.stepValidateConfigForSolutions(1, config, [
        { name: 'a', source: 'a.cpp', tag: 'MA' },
      ] as any);
      expect(solution.validateSolutionsExist).toHaveBeenCalledWith(
        config.solutions
      );
      expect(testset.ensureTestsetsExist).toHaveBeenCalledWith(config.testsets);
      expect(solution.validateTimeLimitMultipliers).toHaveBeenCalledWith(
        config
      );
    });

    it('should fail when timeLimitMultipliers is invalid', () => {
      const config = baseConfig({ timeLimitMultipliers: { java: 0 } });
      vi.mocked(solution.validateTimeLimitMultipliers).mockImplementationOnce(
        () => {
          throw new Error('Invalid timeLimitMultipliers.java');
        }
      );
      expect(() => steps.stepValidateConfigForSolutions(1, config, [])).toThrow(
        'Invalid timeLimitMultipliers.java'
      );
      expect(formatter.fmt.stepComplete).not.toHaveBeenCalled();
    });
  });

  describe('stepCompileSolutions', () => {
    it('should call compileAllSolutions', async () => {
      const sols = [{ name: 'a', source: 'a.cpp', tag: 'MA' }] as any;
      await steps.stepCompileSolutions(1, sols);
      expect(solution.compileAllSolutions).toHaveBeenCalledWith(sols);
    });
  });

  describe('stepRunSolutionsOnAllTestsets', () => {
    it('should iterate solutions and swallow errors', async () => {
      const config = baseConfig();
      const sols = [
        { name: 'a', source: 'a.cpp', tag: 'MA' },
        { name: 'b', source: 'b.cpp', tag: 'OK' },
      ] as any;
      vi.mocked(solution.runSolutionOnAllTestsets)
        .mockRejectedValueOnce(new Error('first failed'))
        .mockResolvedValueOnce(undefined);
      await expect(
        steps.stepRunSolutionsOnAllTestsets(1, config, sols)
      ).resolves.toBeUndefined();
      expect(solution.runSolutionOnAllTestsets).toHaveBeenCalledTimes(2);
    });
  });

  describe('stepRunSolutionsOnTestset', () => {
    it('should iterate solutions and swallow errors', async () => {
      const config = baseConfig();
      const sols = [{ name: 'a', source: 'a.cpp', tag: 'MA' }] as any;
      vi.mocked(solution.runSolutionOnTestset).mockRejectedValueOnce(
        new Error('boom')
      );
      await expect(
        steps.stepRunSolutionsOnTestset(1, config, sols, 'tests')
      ).resolves.toBeUndefined();
      expect(solution.runSolutionOnTestset).toHaveBeenCalledWith(
        sols[0],
        config,
        'tests'
      );
    });
  });

  describe('stepRunSolutionsOnTest', () => {
    it('should call runSolutionOnSingleTest for each', async () => {
      const config = baseConfig();
      const sols = [
        { name: 'a', source: 'a.cpp', tag: 'MA' },
        { name: 'b', source: 'b.cpp', tag: 'OK' },
      ] as any;
      await steps.stepRunSolutionsOnTest(1, config, sols, 'tests', 3);
      expect(solution.runSolutionOnSingleTest).toHaveBeenCalledTimes(2);
      expect(solution.runSolutionOnSingleTest).toHaveBeenCalledWith(
        sols[0],
        config,
        'tests',
        3
      );
    });

    it('should propagate errors (no swallow)', async () => {
      const config = baseConfig();
      const sols = [{ name: 'a', source: 'a.cpp', tag: 'MA' }] as any;
      vi.mocked(solution.runSolutionOnSingleTest).mockRejectedValueOnce(
        new Error('boom')
      );
      await expect(
        steps.stepRunSolutionsOnTest(1, config, sols, 'tests', 1)
      ).rejects.toThrow('boom');
    });
  });

  describe('stepRunSolutionsOnGroup', () => {
    it('should call runSolutionOnGroup for each solution', async () => {
      const config = baseConfig();
      const sols = [{ name: 'a', source: 'a.cpp', tag: 'MA' }] as any;
      const ts = { name: 'tests' } as any;
      await steps.stepRunSolutionsOnGroup(1, config, sols, ts, 'g1');
      expect(solution.runSolutionOnGroup).toHaveBeenCalledWith(
        sols[0],
        config,
        ts,
        'g1'
      );
    });
  });

  describe('stepCompileChecker', () => {
    it('should ensure and compile', async () => {
      const config = baseConfig();
      await steps.stepCompileChecker(1, config);
      expect(checker.ensureCheckerExists).toHaveBeenCalledWith(config.checker);
      expect(checker.compileChecker).toHaveBeenCalledWith(config.checker);
    });
  });

  describe('stepValidateConfigForChecker', () => {
    it('should ensure checker exists', () => {
      const config = baseConfig();
      steps.stepValidateConfigForChecker(1, config);
      expect(checker.ensureCheckerExists).toHaveBeenCalledWith(config.checker);
    });
  });

  describe('stepTestChecker', () => {
    it('should call testCheckerItself', async () => {
      await steps.stepTestChecker(1);
      expect(checker.testCheckerItself).toHaveBeenCalled();
    });
  });

  describe('stepValidateConfigForSolutionTest', () => {
    it('should return main and target solutions', () => {
      const main = { name: 'main', source: 'm.cpp', tag: 'MA' };
      const target = { name: 'target', source: 't.cpp', tag: 'WA' };
      vi.mocked(utils.readConfigFile).mockReturnValue(
        baseConfig({ solutions: [main, target] })
      );
      vi.mocked(solution.getMainSolution).mockReturnValue(main as any);
      const result = steps.stepValidateConfigForSolutionTest(1, 'target');
      expect(result.mainSolution).toBe(main);
      expect(result.targetSolution).toBe(target);
    });

    it('should throw if target solution not found', () => {
      const main = { name: 'main', source: 'm.cpp', tag: 'MA' };
      vi.mocked(utils.readConfigFile).mockReturnValue(
        baseConfig({ solutions: [main] })
      );
      vi.mocked(solution.getMainSolution).mockReturnValue(main as any);
      expect(() =>
        steps.stepValidateConfigForSolutionTest(1, 'missing')
      ).toThrow('No solution named "missing" found.');
      expect(() =>
        steps.stepValidateConfigForSolutionTest(1, 'missing')
      ).toThrow(expect.objectContaining({ exitCode: 2 }));
    });

    it('should fail when timeLimitMultipliers is invalid', () => {
      const main = { name: 'main', source: 'm.cpp', tag: 'MA' };
      const config = baseConfig({
        solutions: [main],
        timeLimitMultipliers: { java: 0 },
      });
      vi.mocked(utils.readConfigFile).mockReturnValue(config);
      vi.mocked(solution.validateTimeLimitMultipliers).mockImplementationOnce(
        () => {
          throw new Error('Invalid timeLimitMultipliers.java');
        }
      );
      expect(() => steps.stepValidateConfigForSolutionTest(1, 'main')).toThrow(
        'Invalid timeLimitMultipliers.java'
      );
      expect(solution.validateTimeLimitMultipliers).toHaveBeenCalledWith(
        config
      );
    });
  });

  describe('stepTestSolutionBehavior', () => {
    it('should call testSolutionAgainstMainCorrect', async () => {
      await steps.stepTestSolutionBehavior(1, 'sol');
      expect(solution.testSolutionAgainstMainCorrect).toHaveBeenCalledWith(
        'sol'
      );
    });
  });

  describe('stepGenerateTestsForVerification', () => {
    it('should call generateAllTestsets', async () => {
      const config = baseConfig({
        generators: [{ name: 'g', source: 'g.cpp' }],
        testsets: [{ name: 'tests' }],
      });
      await steps.stepGenerateTestsForVerification(1, config);
      expect(testset.generateAllTestsets).toHaveBeenCalledWith(
        config.testsets,
        config.generators
      );
    });
  });

  describe('stepTestValidator', () => {
    it('should call testValidatorItself', async () => {
      await steps.stepTestValidator(1);
      expect(validator.testValidatorItself).toHaveBeenCalled();
    });
  });

  describe('stepValidateGeneratedTests', () => {
    it('should call validateAllTestsets', async () => {
      const config = baseConfig();
      await steps.stepValidateGeneratedTests(1, config);
      expect(validator.validateAllTestsets).toHaveBeenCalledWith(
        config.validator,
        config.testsets
      );
    });
  });

  describe('stepCompileSolutionsForVerification', () => {
    it('should validate and compile solutions', async () => {
      const config = baseConfig({
        solutions: [{ name: 'a', source: 'a.cpp', tag: 'MA' }],
      });
      await steps.stepCompileSolutionsForVerification(1, config);
      expect(solution.validateSolutionsExist).toHaveBeenCalled();
      expect(solution.ensureMainSolutionExists).toHaveBeenCalled();
      expect(solution.compileAllSolutions).toHaveBeenCalledWith(
        config.solutions
      );
    });
  });

  describe('stepRunSolutionsForVerification', () => {
    it('should run main first then others swallowing failures', async () => {
      const main = { name: 'main', source: 'm.cpp', tag: 'MA' };
      const other = { name: 'b', source: 'b.cpp', tag: 'OK' };
      const config = baseConfig({ solutions: [main, other] });
      vi.mocked(solution.getMainSolution).mockReturnValue(main as any);
      vi.mocked(solution.runSolutionOnAllTestsets)
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('fail'));
      await steps.stepRunSolutionsForVerification(1, config);
      expect(formatter.fmt.warning).toHaveBeenCalledWith(
        expect.stringContaining('Some Solutions Failed')
      );
    });

    it('should not warn if no other solution fails', async () => {
      const main = { name: 'main', source: 'm.cpp', tag: 'MA' };
      const other = { name: 'b', source: 'b.cpp', tag: 'OK' };
      const config = baseConfig({ solutions: [main, other] });
      vi.mocked(solution.getMainSolution).mockReturnValue(main as any);
      vi.mocked(solution.runSolutionOnAllTestsets).mockResolvedValue(undefined);
      await steps.stepRunSolutionsForVerification(1, config);
      expect(formatter.fmt.warning).not.toHaveBeenCalled();
    });
  });

  describe('stepVerifySolutionsAgainstMainCorrect', () => {
    it('should pass when all comparisons succeed', async () => {
      const main = { name: 'main', source: 'm.cpp', tag: 'MA' };
      const other = { name: 'b', source: 'b.cpp', tag: 'OK' };
      const config = baseConfig({ solutions: [main, other] });
      vi.mocked(solution.getMainSolution).mockReturnValue(main as any);
      vi.mocked(solution.startTheComparisonProcess).mockResolvedValue(
        undefined
      );
      await steps.stepVerifySolutionsAgainstMainCorrect(1, config);
      expect(solution.startTheComparisonProcess).toHaveBeenCalledTimes(1);
    });

    it('does not compare anything when the main is the only solution', async () => {
      const main = { name: 'main', source: 'm.cpp', tag: 'MA' };
      const config = baseConfig({ solutions: [main] });
      vi.mocked(solution.getMainSolution).mockReturnValue(main as any);
      await steps.stepVerifySolutionsAgainstMainCorrect(1, config);
      expect(solution.startTheComparisonProcess).not.toHaveBeenCalled();
    });

    it('should throw when at least one comparison fails', async () => {
      const main = { name: 'main', source: 'm.cpp', tag: 'MA' };
      const other = { name: 'b', source: 'b.cpp', tag: 'OK' };
      const config = baseConfig({ solutions: [main, other] });
      vi.mocked(solution.getMainSolution).mockReturnValue(main as any);
      vi.mocked(solution.startTheComparisonProcess).mockRejectedValue(
        new Error('mismatch')
      );
      await expect(
        steps.stepVerifySolutionsAgainstMainCorrect(1, config)
      ).rejects.toThrow('Some solutions did not behave as expected');
      expect(utils.logError).toHaveBeenCalled();
    });

    it('should rethrow LimitExceededError immediately (fail-fast)', async () => {
      const main = { name: 'main', source: 'm.cpp', tag: 'MA' };
      const s1 = { name: 'b', source: 'b.cpp', tag: 'OK' };
      const s2 = { name: 'c', source: 'c.cpp', tag: 'OK' };
      const config = baseConfig({ solutions: [main, s1, s2] });
      vi.mocked(solution.getMainSolution).mockReturnValue(main as any);
      vi.mocked(solution.startTheComparisonProcess).mockRejectedValueOnce(
        new LimitExceededError('checker exceeded time limit')
      );
      await expect(
        steps.stepVerifySolutionsAgainstMainCorrect(1, config)
      ).rejects.toBeInstanceOf(LimitExceededError);
      expect(solution.startTheComparisonProcess).toHaveBeenCalledTimes(1);
    });
  });

  describe('stepReadCredentials', () => {
    it('should return credentials', () => {
      vi.mocked(remoteUtils.readCredentials).mockReturnValue({
        apiKey: 'k',
        secret: 's',
      });
      const result = steps.stepReadCredentials(1);
      expect(result).toEqual({ apiKey: 'k', secret: 's' });
    });
  });

  describe('stepInitializeSDK', () => {
    it('should construct SDK with credentials', () => {
      const sdk = steps.stepInitializeSDK(1, { apiKey: 'k', secret: 's' });
      expect(polygonModule.PolygonSDK).toHaveBeenCalledWith({
        apiKey: 'k',
        apiSecret: 's',
      });
      expect(sdk).toBeDefined();
    });
  });

  describe('stepListProblems', () => {
    it('should fetch and return problems', async () => {
      const problems = [{ id: 1, name: 'p' }] as any;
      const sdk = { listProblems: vi.fn().mockResolvedValue(problems) } as any;
      const result = await steps.stepListProblems(1, sdk);
      expect(result).toBe(problems);
    });
  });

  describe('stepDisplayProblems', () => {
    it('should iterate and log each problem', () => {
      const problems = [
        { id: 1, name: 'a' },
        { id: 2, name: 'b' },
      ] as any;
      vi.mocked(remoteUtils.formatProblemInfo).mockReturnValue('info');
      steps.stepDisplayProblems(1, problems);
      expect(remoteUtils.formatProblemInfo).toHaveBeenCalledTimes(2);
      expect(formatter.fmt.log).toHaveBeenCalledTimes(2);
    });
  });

  describe('stepGetProblemId', () => {
    it('should return resolved problem id', () => {
      vi.mocked(remoteUtils.getProblemId).mockReturnValue(42);
      const result = steps.stepGetProblemId(1, 'somepath');
      expect(result).toBe(42);
    });
  });

  describe('stepFetchProblemInfo', () => {
    it('should fetch info via sdk', async () => {
      const info = { timeLimit: 1000, memoryLimit: 256 } as any;
      const sdk = { getProblemInfo: vi.fn().mockResolvedValue(info) } as any;
      const result = await steps.stepFetchProblemInfo(1, sdk, 5);
      expect(result).toBe(info);
      expect(sdk.getProblemInfo).toHaveBeenCalledWith(5);
    });
  });

  describe('stepFetchStatements', () => {
    it('should fetch statements', async () => {
      vi.mocked(viewer.fetchStatements).mockResolvedValue([]);
      const result = await steps.stepFetchStatements(1, {} as any, 5);
      expect(result).toEqual([]);
      expect(viewer.logStatementsFetch).toHaveBeenCalled();
    });

    it('should pass message variant when statements found', async () => {
      vi.mocked(viewer.fetchStatements).mockResolvedValue([
        { language: 'en' },
      ] as any);
      await steps.stepFetchStatements(1, {} as any, 5);
      expect(formatter.fmt.stepComplete).toHaveBeenCalledWith(
        'Statements retrieved'
      );
    });
  });

  describe('stepFetchSolutions', () => {
    it('should fetch solutions', async () => {
      vi.mocked(viewer.fetchSolutions).mockResolvedValue([{}] as any);
      const result = await steps.stepFetchSolutions(1, {} as any, 5);
      expect(result).toHaveLength(1);
      expect(viewer.logSolutionsFetch).toHaveBeenCalled();
    });
  });

  describe('stepFetchFiles', () => {
    it('should sum file counts', async () => {
      vi.mocked(viewer.fetchFiles).mockResolvedValue({
        resourceFiles: [{}],
        sourceFiles: [],
        auxFiles: [],
      } as any);
      const result = await steps.stepFetchFiles(1, {} as any, 5);
      expect(result.resourceFiles).toHaveLength(1);
    });

    it('should report empty when no files', async () => {
      vi.mocked(viewer.fetchFiles).mockResolvedValue({
        resourceFiles: [],
        sourceFiles: [],
        auxFiles: [],
      });
      await steps.stepFetchFiles(1, {} as any, 5);
      expect(formatter.fmt.stepComplete).toHaveBeenCalledWith(
        'Files check complete'
      );
    });
  });

  describe('stepFetchPackages', () => {
    it('should fetch and log', async () => {
      vi.mocked(viewer.fetchPackages).mockResolvedValue([{}] as any);
      await steps.stepFetchPackages(1, {} as any, 5);
      expect(viewer.logPackagesFetch).toHaveBeenCalled();
    });
  });

  describe('stepFetchChecker', () => {
    it('should return string', async () => {
      vi.mocked(viewer.fetchChecker).mockResolvedValue('wcmp');
      const result = await steps.stepFetchChecker(1, {} as any, 5);
      expect(result).toBe('wcmp');
    });

    it('should handle empty string', async () => {
      vi.mocked(viewer.fetchChecker).mockResolvedValue('');
      await steps.stepFetchChecker(1, {} as any, 5);
      expect(formatter.fmt.stepComplete).toHaveBeenCalledWith(
        'Checker check complete'
      );
    });
  });

  describe('stepFetchValidator', () => {
    it('should return string', async () => {
      vi.mocked(viewer.fetchValidator).mockResolvedValue('val.cpp');
      const result = await steps.stepFetchValidator(1, {} as any, 5);
      expect(result).toBe('val.cpp');
    });
  });

  describe('stepFetchChecker and stepFetchValidator with no file', () => {
    it('records no fetch action for an empty checker name', async () => {
      const addAction = vi.spyOn(report, 'addAction');
      vi.mocked(viewer.fetchChecker).mockResolvedValue('');
      await steps.stepFetchChecker(1, {} as any, 5);
      expect(addAction).not.toHaveBeenCalled();
      addAction.mockRestore();
    });

    it('records no fetch action for an empty validator name', async () => {
      const addAction = vi.spyOn(report, 'addAction');
      vi.mocked(viewer.fetchValidator).mockResolvedValue('');
      await steps.stepFetchValidator(1, {} as any, 5);
      expect(addAction).not.toHaveBeenCalled();
      addAction.mockRestore();
    });
  });

  describe('stepFetchGenerators', () => {
    it('should call identifyGenerators', () => {
      vi.mocked(viewer.identifyGenerators).mockReturnValue([
        { name: 'g.cpp' },
      ] as any);
      const result = steps.stepFetchGenerators(
        1,
        { resourceFiles: [], sourceFiles: [], auxFiles: [] },
        'wcmp',
        'val.cpp'
      );
      expect(result).toHaveLength(1);
    });
  });

  describe('stepFetchSampleTests', () => {
    it('should fetch samples', async () => {
      vi.mocked(viewer.fetchSampleTests).mockResolvedValue([{}] as any);
      await steps.stepFetchSampleTests(1, {} as any, 5);
      expect(viewer.logSampleTestsFetch).toHaveBeenCalled();
    });
  });

  describe('stepDisplayProblemView', () => {
    it('should call displayProblemDetails', () => {
      steps.stepDisplayProblemView(
        1,
        {} as any,
        [],
        [],
        { resourceFiles: [], sourceFiles: [], auxFiles: [] },
        [],
        '',
        '',
        [],
        []
      );
      expect(viewer.displayProblemDetails).toHaveBeenCalled();
    });
  });

  describe('stepCommitChanges', () => {
    it('should commit via sdk', async () => {
      const sdk = {
        commitChanges: vi.fn().mockResolvedValue(undefined),
      } as any;
      await steps.stepCommitChanges(1, sdk, 5, 'msg');
      expect(sdk.commitChanges).toHaveBeenCalledWith(5, { message: 'msg' });
    });
  });

  describe('stepValidatePackageType', () => {
    it('should pass for valid package type', () => {
      vi.mocked(remoteUtils.isValidPackageType).mockReturnValue(true);
      expect(() => steps.stepValidatePackageType(1, 'standard')).not.toThrow();
    });

    it('should throw for invalid package type', () => {
      vi.mocked(remoteUtils.isValidPackageType).mockReturnValue(false);
      expect(() => steps.stepValidatePackageType(1, 'bogus')).toThrow(
        'Invalid package type: bogus'
      );
      expect(() => steps.stepValidatePackageType(1, 'bogus')).toThrow(
        expect.objectContaining({ exitCode: 2 })
      );
    });
  });

  describe('stepBuildPackage', () => {
    it('should resolve when build completes READY', async () => {
      vi.useFakeTimers();
      const sdk = {
        listPackages: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValue([{ id: 5, state: 'READY', comment: 'ok' }]),
        buildPackage: vi.fn().mockResolvedValue(undefined),
      } as any;
      const promise = steps.stepBuildPackage(1, sdk, 7, 'standard');
      await vi.advanceTimersByTimeAsync(60000);
      const result = await promise;
      expect(result.state).toBe('READY');
      expect(result.id).toBe(5);
      vi.useRealTimers();
    });

    it.each([
      ['standard', false, true],
      ['linux', true, true],
      ['windows', true, true],
      ['full', true, true],
    ])(
      'should call buildPackage for %s with full=%s, verify=%s',
      async (type, full, verify) => {
        vi.useFakeTimers();
        const sdk = {
          listPackages: vi
            .fn()
            .mockResolvedValueOnce([])
            .mockResolvedValue([{ id: 5, state: 'READY', comment: 'ok' }]),
          buildPackage: vi.fn().mockResolvedValue(undefined),
        } as any;
        const promise = steps.stepBuildPackage(1, sdk, 7, type);
        await vi.advanceTimersByTimeAsync(60000);
        await promise;
        expect(sdk.buildPackage).toHaveBeenCalledWith(7, full, verify);
        vi.useRealTimers();
      }
    );

    it('should throw when build fails', async () => {
      vi.useFakeTimers();
      const sdk = {
        listPackages: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValue([{ id: 6, state: 'FAILED', comment: 'oops' }]),
        buildPackage: vi.fn().mockResolvedValue(undefined),
      } as any;
      const promise = steps.stepBuildPackage(1, sdk, 7, 'full');
      promise.catch(() => undefined);
      await vi.advanceTimersByTimeAsync(60000);
      await expect(promise).rejects.toThrow('Package build failed: oops');
      // Polygon answered: the problem itself did not build, so code 1
      await expect(promise).rejects.not.toBeInstanceOf(PolymanError);
      vi.useRealTimers();
    });

    it('should fail with exit code 4 when no package shows up in time', async () => {
      vi.useFakeTimers();
      const sdk = {
        listPackages: vi.fn().mockResolvedValue([]),
        buildPackage: vi.fn().mockResolvedValue(undefined),
      } as any;
      const promise = steps.stepBuildPackage(1, sdk, 7, 'standard');
      promise.catch(() => undefined);
      // Still waiting after 15 minutes: the message says 30.
      let settled = false;
      promise.then(
        () => (settled = true),
        () => (settled = true)
      );
      await vi.advanceTimersByTimeAsync(15 * 60000);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(15 * 60000);
      await expect(promise).rejects.toThrow(
        'Package build timed out after 30 minutes'
      );
      await expect(promise).rejects.toHaveProperty('exitCode', 4);
      vi.useRealTimers();
    });
  });

  describe('stepCreatePulledProblemDirectory', () => {
    it('should create dirs that do not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
      steps.stepCreatePulledProblemDirectory(1, 'mydir');
      expect(fs.mkdirSync).toHaveBeenCalled();
    });

    it('should skip mkdir for dirs that already exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      steps.stepCreatePulledProblemDirectory(1, 'mydir');
      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe('stepDownloadProblemFilesAndSetUpConfig', () => {
    const pullWithChecker = async (
      checker: object,
      validatorResult: object = {
        count: 1,
        data: { name: 'val', source: 'val.cpp' },
      },
      sourceTypes: Record<string, string> = {},
      checkerCount = 1
    ) => {
      vi.mocked(remoteUtils.fetchProblemInfo).mockResolvedValue({
        name: 'p',
        owner: 'o',
        timeLimit: 1000,
        memoryLimit: 256,
        inputFile: 'stdin',
        outputFile: 'stdout',
        interactive: false,
      } as any);
      vi.mocked(pulling.downloadSolutions).mockResolvedValue({
        count: 1,
        data: [],
        failures: [],
      });
      vi.mocked(pulling.downloadChecker).mockResolvedValue({
        count: checkerCount,
        data: checker,
        failures: [],
      } as any);
      vi.mocked(pulling.downloadValidator).mockResolvedValue({
        failures: [],
        ...validatorResult,
      } as any);
      vi.mocked(pulling.downloadGenerators).mockResolvedValue({
        count: 2,
        data: [],
        failures: [],
        resources: [],
        sourceTypes,
      });
      vi.mocked(pulling.downloadStatements).mockResolvedValue({
        count: 0,
        config: {},
        failures: [],
      } as any);
      vi.mocked(pulling.fetchProblemMetadata).mockResolvedValue({
        description: 'd',
        tags: ['t'],
        failures: [],
      });
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

      return steps.stepDownloadProblemFilesAndSetUpConfig(
        1,
        {} as any,
        7,
        'savePath'
      );
    };

    it('should aggregate downloads and write Config.json', async () => {
      await pullWithChecker({
        name: 'wcmp',
        source: 'wcmp.cpp',
        isStandard: true,
      });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('Config.json'),
        expect.any(String),
        'utf-8'
      );
      expect(pulling.downloadGenerators).toHaveBeenCalledWith(
        expect.anything(),
        7,
        expect.stringContaining('savePath'),
        ['val']
      );
    });

    it('should return no warnings when the validator was pulled', async () => {
      const result = await pullWithChecker({
        name: 'wcmp',
        source: 'wcmp.cpp',
        isStandard: true,
      });
      expect(result).toEqual({ warnings: [], failures: [], resources: [] });
    });

    it('should return a warning when Polygon has no validator', async () => {
      const { warnings, failures } = await pullWithChecker(
        { name: 'wcmp', source: 'wcmp.cpp', isStandard: true },
        {
          count: 0,
          data: { name: 'validator', source: 'val.cpp' },
          missing: true,
        }
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('no validator set for problem 7');
      expect(failures).toEqual([]);
    });

    const failure = (component: string, name: string, error: string) => ({
      component,
      name,
      error,
      message: `Could not download ${component} ${name} (${error})`,
    });

    it('returns each failed file download as a failure, not a warning, and records it as a failed action', async () => {
      const addAction = vi.spyOn(report, 'addAction');
      const addWarning = vi.spyOn(report, 'addWarning');
      vi.mocked(remoteUtils.fetchProblemInfo).mockResolvedValue({
        name: 'p',
        owner: 'o',
        timeLimit: 1000,
        memoryLimit: 256,
        inputFile: 'stdin',
        outputFile: 'stdout',
        interactive: false,
      } as any);
      vi.mocked(pulling.downloadSolutions).mockResolvedValue({
        count: 1,
        data: [{ name: 'main', source: './solutions/main.cpp', tag: 'MA' }],
        failures: [failure('solution', 'wa', 'no access')],
      } as any);
      vi.mocked(pulling.downloadChecker).mockResolvedValue({
        count: 1,
        data: { name: 'chk', source: './checker/chk.cpp', isStandard: false },
        failures: [failure('checker', 'checker tests', 'boom')],
      });
      vi.mocked(pulling.downloadValidator).mockResolvedValue({
        count: 1,
        data: { name: 'val', source: './validator/val.cpp' },
        failures: [failure('validator', 'validator tests', 'boom')],
      });
      vi.mocked(pulling.downloadGenerators).mockResolvedValue({
        count: 1,
        data: [],
        failures: [
          failure('generator', 'gen', 'boom'),
          failure('resource', 'olymp.sty', 'boom'),
        ],
        resources: ['testlib.h'],
        sourceTypes: {},
      });
      vi.mocked(pulling.downloadStatements).mockResolvedValue({
        count: 0,
        config: {},
        failures: [failure('statement', 'statements', 'boom')],
      } as any);
      vi.mocked(pulling.fetchProblemMetadata).mockResolvedValue({
        failures: [failure('metadata', 'tags', 'boom')],
      });
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

      const result = await steps.stepDownloadProblemFilesAndSetUpConfig(
        1,
        {} as any,
        7,
        'savePath'
      );

      const recorded = addAction.mock.calls.map(call => call[0]);
      addAction.mockRestore();
      addWarning.mockRestore();
      expect(result.warnings).toEqual([]);
      expect(addWarning).not.toHaveBeenCalled();
      expect(result.failures.map(f => f.name)).toEqual([
        'wa',
        'checker tests',
        'validator tests',
        'gen',
        'olymp.sty',
        'statements',
        'tags',
      ]);
      expect(result.resources).toEqual(['testlib.h']);
      const failedAction = (
        component: string,
        name: string,
        error: string
      ) => ({
        component,
        name,
        action: 'download',
        ok: false,
        error,
      });
      expect(recorded).toEqual([
        { component: 'solution', name: 'main', action: 'download', ok: true },
        failedAction('solution', 'wa', 'no access'),
        { component: 'checker', name: 'chk', action: 'download', ok: true },
        failedAction('checker', 'checker tests', 'boom'),
        { component: 'validator', name: 'val', action: 'download', ok: true },
        failedAction('validator', 'validator tests', 'boom'),
        {
          component: 'resource',
          name: 'testlib.h',
          action: 'download',
          ok: true,
        },
        failedAction('generator', 'gen', 'boom'),
        failedAction('resource', 'olymp.sty', 'boom'),
        failedAction('statement', 'statements', 'boom'),
        failedAction('metadata', 'tags', 'boom'),
        { component: 'config', name: 'Config.json', action: 'write', ok: true },
      ]);
    });

    it('keeps a placeholder in warnings next to a failed file download', async () => {
      vi.mocked(remoteUtils.fetchProblemInfo).mockResolvedValue({
        name: 'p',
        owner: 'o',
        timeLimit: 1000,
        memoryLimit: 256,
        inputFile: 'stdin',
        outputFile: 'stdout',
        interactive: false,
      } as any);
      vi.mocked(pulling.downloadSolutions).mockResolvedValue({
        count: 0,
        data: [{ name: 'acc', source: './solutions/acc.cpp', tag: 'MA' }],
        failures: [failure('solution', 'wa', 'no access')],
        placeholder: 'acc.cpp placeholder',
      } as any);
      vi.mocked(pulling.downloadChecker).mockResolvedValue({
        count: 0,
        data: { name: 'wcmp', source: 'wcmp.cpp', isStandard: true },
        failures: [],
      });
      vi.mocked(pulling.downloadValidator).mockResolvedValue({
        count: 1,
        data: { name: 'val', source: './validator/val.cpp' },
        failures: [],
      });
      vi.mocked(pulling.downloadGenerators).mockResolvedValue({
        count: 0,
        data: [],
        failures: [],
        resources: [],
        sourceTypes: {},
      });
      vi.mocked(pulling.downloadStatements).mockResolvedValue({
        count: 0,
        config: {},
        failures: [],
      } as any);
      vi.mocked(pulling.fetchProblemMetadata).mockResolvedValue({
        failures: [],
      });
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

      const result = await steps.stepDownloadProblemFilesAndSetUpConfig(
        1,
        {} as any,
        7,
        'savePath'
      );

      expect(result.warnings).toEqual(['acc.cpp placeholder']);
      expect(result.failures.map(f => f.message)).toEqual([
        'Could not download solution wa (no access)',
      ]);
    });

    it('records a failed validator download when Polygon has none', async () => {
      const addAction = vi.spyOn(report, 'addAction');
      await pullWithChecker(
        { name: 'wcmp', source: 'wcmp.cpp', isStandard: true },
        {
          count: 0,
          data: { name: 'validator', source: 'val.cpp' },
          missing: true,
        }
      );
      const recorded = addAction.mock.calls.map(call => call[0]);
      addAction.mockRestore();
      expect(recorded).toEqual([
        { component: 'checker', name: 'wcmp', action: 'download', ok: true },
        {
          component: 'validator',
          name: 'validator',
          action: 'download',
          ok: false,
          error: 'Polygon has no validator set for this problem',
        },
        { component: 'config', name: 'Config.json', action: 'write', ok: true },
      ]);
    });

    it('should not download a custom checker as a generator', async () => {
      await pullWithChecker({
        name: 'chk',
        source: './checker/chk.cpp',
        isStandard: false,
      });
      expect(pulling.downloadGenerators).toHaveBeenCalledWith(
        expect.anything(),
        7,
        expect.stringContaining('savePath'),
        ['val', 'chk']
      );
    });

    it('keeps the sourceType of a downloaded checker and validator', async () => {
      await pullWithChecker(
        { name: 'chk', source: './checker/chk.cpp', isStandard: false },
        { count: 2, data: { name: 'val', source: './validator/val.cpp' } },
        { 'chk.cpp': 'cpp.g++17', 'val.cpp': 'cpp.gcc14-64-msys2-g++23' }
      );
      const written = vi
        .mocked(fs.writeFileSync)
        .mock.calls.find(([file]) => String(file).endsWith('Config.json'));
      const config = JSON.parse(written?.[1] as string) as {
        checker: { sourceType?: string };
        validator: { sourceType?: string };
      };
      expect(config.checker.sourceType).toBe('cpp.g++17');
      expect(config.validator.sourceType).toBe('cpp.gcc14-64-msys2-g++23');
    });

    it.each(['__proto__', 'constructor', 'toString'])(
      'adds no sourceType when the checker and validator are named %s',
      async name => {
        await pullWithChecker(
          { name, source: name, isStandard: false },
          { count: 1, data: { name, source: name } }
        );
        const written = vi
          .mocked(fs.writeFileSync)
          .mock.calls.find(([file]) => String(file).endsWith('Config.json'));
        const config = JSON.parse(written?.[1] as string) as {
          checker: object;
          validator: object;
        };
        expect(config.checker).not.toHaveProperty('sourceType');
        expect(config.validator).not.toHaveProperty('sourceType');
      }
    );

    it('adds no sourceType to a checker or validator that was not downloaded', async () => {
      await pullWithChecker(
        { name: 'chk', source: 'chk.cpp', isStandard: true },
        { count: 0, data: { name: 'val', source: 'val.cpp' }, missing: true },
        { 'chk.cpp': 'cpp.g++17', 'val.cpp': 'cpp.g++17' },
        0
      );
      const written = vi
        .mocked(fs.writeFileSync)
        .mock.calls.find(([file]) => String(file).endsWith('Config.json'));
      const config = JSON.parse(written?.[1] as string) as {
        checker: object;
        validator: object;
      };
      expect(config.checker).not.toHaveProperty('sourceType');
      expect(config.validator).not.toHaveProperty('sourceType');
    });
  });

  describe('stepDownloadTests', () => {
    it('should fail with exit code 2 when Config.json is not valid JSON', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('{ not json');
      const error: unknown = await steps
        .stepDownloadTests(1, {} as any, 7, 'tests', 'savePath')
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PolymanError);
      expect((error as PolymanError).exitCode).toBe(2);
      expect((error as PolymanError).cause).toBeInstanceOf(SyntaxError);
    });

    it('should throw when Config.json is missing', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      await expect(
        steps.stepDownloadTests(1, {} as any, 7, 'tests', 'savePath')
      ).rejects.toThrow('Config.json not found');
      await expect(
        steps.stepDownloadTests(1, {} as any, 7, 'tests', 'savePath')
      ).rejects.toHaveProperty('exitCode', 2);
    });

    it('should add new testset to config when not present', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(baseConfig({ testsets: [] }))
      );
      vi.mocked(
        pulling.downloadTestsetAndBuildGenerationScripts
      ).mockResolvedValue({
        testset: { name: 'tests', generatorScript: { commands: [] } },
        manualCount: 0,
      } as any);
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
      const result = await steps.stepDownloadTests(
        1,
        {} as any,
        7,
        'tests',
        'savePath'
      );
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('records a successful testset download', async () => {
      const addAction = vi.spyOn(report, 'addAction');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(baseConfig({ testsets: [] }))
      );
      vi.mocked(
        pulling.downloadTestsetAndBuildGenerationScripts
      ).mockResolvedValue({
        testset: { name: 'tests', generatorScript: { commands: [] } },
        manualCount: 0,
      } as any);
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
      await steps.stepDownloadTests(1, {} as any, 7, 'tests', 'savePath');
      expect(addAction.mock.calls.map(call => call[0])).toEqual([
        { component: 'testset', name: 'tests', action: 'download', ok: true },
      ]);
      addAction.mockRestore();
    });

    it('should update existing testset in config', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(
          baseConfig({ testsets: [{ name: 'tests', generatorScript: {} }] })
        )
      );
      vi.mocked(
        pulling.downloadTestsetAndBuildGenerationScripts
      ).mockResolvedValue({
        testset: { name: 'tests', generatorScript: { commands: [{}] } },
        manualCount: 1,
      } as any);
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
      await steps.stepDownloadTests(1, {} as any, 7, 'tests', 'savePath');
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should warn but resolve if download throws', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(baseConfig({ testsets: [] }))
      );
      vi.mocked(
        pulling.downloadTestsetAndBuildGenerationScripts
      ).mockRejectedValue(new Error('boom'));
      await expect(
        steps.stepDownloadTests(1, {} as any, 7, 'tests', 'savePath')
      ).resolves.toBe(false);
      expect(formatter.fmt.warning).toHaveBeenCalled();
    });

    it('says why the download failed in the warning', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(baseConfig({ testsets: [] }))
      );
      vi.mocked(
        pulling.downloadTestsetAndBuildGenerationScripts
      ).mockRejectedValue(new Error('Refusing unsafe test index from Polygon'));
      await steps.stepDownloadTests(1, {} as any, 7, 'tests', 'savePath');
      expect(formatter.fmt.warning).toHaveBeenCalledWith(
        expect.stringContaining('Refusing unsafe test index from Polygon')
      );
    });
  });

  describe('stepDownloadTests with a hostile error message', () => {
    it('escapes control characters from Polygon in the warning', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(baseConfig({ testsets: [] }))
      );
      vi.mocked(
        pulling.downloadTestsetAndBuildGenerationScripts
      ).mockRejectedValue(
        new Error('Polygon API Error: \u001b[2J\nfake line \u202e\u009b')
      );
      await steps.stepDownloadTests(1, {} as any, 7, 'tests', 'savePath');
      const warnings = vi
        .mocked(formatter.fmt.warning)
        .mock.calls.map(c => String(c[0]));
      const warning = warnings.find(w =>
        w.includes('Could not fetch tests information')
      );
      expect(warning).toBeDefined();
      // eslint-disable-next-line no-control-regex
      expect(warning).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e]/);
      expect(warning).toContain('\\u001b[2J\\u000afake line');
    });
  });

  describe('stepDownloadTests with a non-Error rejection', () => {
    it('still names the reason when something other than an Error is thrown', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify(baseConfig({ testsets: [] }))
      );
      vi.mocked(
        pulling.downloadTestsetAndBuildGenerationScripts
      ).mockRejectedValue('plain string failure');
      await expect(
        steps.stepDownloadTests(1, {} as any, 7, 'tests', 'savePath')
      ).resolves.toBe(false);
      expect(formatter.fmt.warning).toHaveBeenCalledWith(
        expect.stringContaining('plain string failure')
      );
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });
  });

  describe('stepReadConfig', () => {
    it('should fail with exit code 2 when Config.json is not valid JSON', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('{ not json');
      let error: unknown;
      try {
        steps.stepReadConfig(1, '/dir');
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(PolymanError);
      expect((error as PolymanError).exitCode).toBe(2);
      expect((error as PolymanError).cause).toBeInstanceOf(SyntaxError);
    });

    it('should read and parse Config.json', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      const cfg = baseConfig();
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cfg));
      const result = steps.stepReadConfig(1, '/dir');
      expect(result.name).toBe('p');
    });

    it('should throw when missing', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(() => steps.stepReadConfig(1, '/dir')).toThrow(
        'Config.json not found'
      );
      expect(() => steps.stepReadConfig(1, '/dir')).toThrow(
        expect.objectContaining({ exitCode: 2 })
      );
    });
  });

  describe('stepUpdateProblemInfo', () => {
    it('should call updateProblemInfo', async () => {
      const config = baseConfig();
      await steps.stepUpdateProblemInfo(1, {} as any, 7, config);
      expect(pushing.updateProblemInfo).toHaveBeenCalledWith({}, 7, config);
    });
  });

  describe('stepUploadSolutions', () => {
    it('should call uploadSolutions', async () => {
      vi.mocked(pushing.uploadSolutions).mockResolvedValue(3);
      const config = baseConfig();
      await steps.stepUploadSolutions(1, {} as any, 7, '/dir', config);
      expect(pushing.uploadSolutions).toHaveBeenCalled();
    });
  });

  describe('failed uploads', () => {
    it('should not report solutions as uploaded when a solution failed', async () => {
      vi.mocked(pushing.uploadSolutions).mockImplementation(
        (..._args: unknown[]) => {
          (_args[4] as string[]).push('solution java-sol: boom');
          return Promise.resolve(0);
        }
      );
      const failures: string[] = [];
      await steps.stepUploadSolutions(
        1,
        {} as any,
        7,
        '/dir',
        baseConfig(),
        failures
      );
      expect(failures).toEqual(['solution java-sol: boom']);
      expect(formatter.fmt.stepComplete).not.toHaveBeenCalled();
      expect(formatter.fmt.warning).toHaveBeenCalledWith(
        expect.stringContaining('Solutions uploaded with 1 failure(s)')
      );
    });

    it('should not report the checker as uploaded when a checker test failed', async () => {
      vi.mocked(pushing.uploadChecker).mockImplementation(
        (..._args: unknown[]) => {
          (_args[4] as string[]).push('checker tests: boom');
          return Promise.resolve(1);
        }
      );
      const failures: string[] = [];
      await steps.stepUploadChecker(
        1,
        {} as any,
        7,
        '/dir',
        baseConfig(),
        failures
      );
      expect(formatter.fmt.stepComplete).not.toHaveBeenCalled();
      expect(formatter.fmt.warning).toHaveBeenCalledWith(
        expect.stringContaining('with 1 failure(s)')
      );
    });

    it('should not report the validator as uploaded when it recorded a failure', async () => {
      vi.mocked(pushing.uploadValidator).mockImplementation(
        (..._args: unknown[]) => {
          (_args[4] as string[]).push('x: boom');
          return Promise.resolve(1);
        }
      );
      const failures: string[] = [];
      await steps.stepUploadValidator(
        1,
        {} as any,
        7,
        '/dir',
        baseConfig(),
        failures
      );
      expect(failures).toEqual(['x: boom']);
      expect(formatter.fmt.stepComplete).not.toHaveBeenCalled();
      expect(formatter.fmt.warning).toHaveBeenCalledWith(
        expect.stringContaining('Validator uploaded with 1 failure(s)')
      );
    });

    it('should not report the missing validator as uploaded when it recorded a failure', async () => {
      vi.mocked(pushing.uploadValidator).mockImplementation(
        (..._args: unknown[]) => {
          (_args[4] as string[]).push('x: boom');
          return Promise.resolve(0);
        }
      );
      const failures: string[] = [];
      await steps.stepUploadValidator(
        1,
        {} as any,
        7,
        '/dir',
        baseConfig(),
        failures
      );
      expect(failures).toEqual(['x: boom']);
      expect(formatter.fmt.stepComplete).not.toHaveBeenCalled();
      expect(formatter.fmt.warning).toHaveBeenCalledWith(
        expect.stringContaining('No validator to upload with 1 failure(s)')
      );
    });

    it('should not report statements as uploaded when it recorded a failure', async () => {
      vi.mocked(pushing.uploadStatements).mockImplementation(
        (..._args: unknown[]) => {
          (_args[4] as string[]).push('x: boom');
          return Promise.resolve(0);
        }
      );
      const failures: string[] = [];
      await steps.stepUploadStatements(
        1,
        {} as any,
        7,
        '/dir',
        baseConfig(),
        failures
      );
      expect(failures).toEqual(['x: boom']);
      expect(formatter.fmt.stepComplete).not.toHaveBeenCalled();
      expect(formatter.fmt.warning).toHaveBeenCalledWith(
        expect.stringContaining('Statements uploaded with 1 failure(s)')
      );
    });

    it('should not report generators as uploaded when it recorded a failure', async () => {
      vi.mocked(pushing.uploadGenerators).mockImplementation(
        (..._args: unknown[]) => {
          (_args[4] as string[]).push('x: boom');
          return Promise.resolve(0);
        }
      );
      const failures: string[] = [];
      await steps.stepUploadGenerators(
        1,
        {} as any,
        7,
        '/dir',
        baseConfig(),
        failures
      );
      expect(failures).toEqual(['x: boom']);
      expect(formatter.fmt.stepComplete).not.toHaveBeenCalled();
      expect(formatter.fmt.warning).toHaveBeenCalledWith(
        expect.stringContaining('Generators uploaded with 1 failure(s)')
      );
    });

    it('should not report metadata as uploaded when it recorded a failure', async () => {
      vi.mocked(pushing.uploadMetadata).mockImplementation(((
        ..._args: unknown[]
      ) => {
        (_args[3] as string[]).push('x: boom');
        return Promise.resolve(undefined);
      }) as any);
      const failures: string[] = [];
      await steps.stepUploadMetadata(1, {} as any, 7, baseConfig(), failures);
      expect(failures).toEqual(['x: boom']);
      expect(formatter.fmt.stepComplete).not.toHaveBeenCalled();
      expect(formatter.fmt.warning).toHaveBeenCalledWith(
        expect.stringContaining('Metadata uploaded with 1 failure(s)')
      );
    });

    it('should not report testsets as uploaded when it recorded a failure', async () => {
      vi.mocked(pushing.uploadTestsets).mockImplementation(
        (..._args: unknown[]) => {
          (_args[4] as string[]).push('x: boom');
          return Promise.resolve({ testsCount: 0, manualsCount: 0 });
        }
      );
      const failures: string[] = [];
      await steps.stepUploadTestsets(
        1,
        {} as any,
        7,
        '/dir',
        baseConfig(),
        failures
      );
      expect(failures).toEqual(['x: boom']);
      expect(formatter.fmt.stepComplete).not.toHaveBeenCalled();
      expect(formatter.fmt.warning).toHaveBeenCalledWith(
        expect.stringContaining('Testsets uploaded with 1 failure(s)')
      );
    });

    it('should only count failures added by the step itself', async () => {
      vi.mocked(pushing.uploadGenerators).mockResolvedValue(1);
      await steps.stepUploadGenerators(1, {} as any, 7, '/dir', baseConfig(), [
        'solution x: earlier failure',
      ]);
      expect(formatter.fmt.stepComplete).toHaveBeenCalledWith(
        'Generators uploaded'
      );
    });
  });

  describe('stepUploadChecker', () => {
    it('should report standard checker uploaded', async () => {
      vi.mocked(pushing.uploadChecker).mockResolvedValue(1);
      const config = baseConfig();
      await steps.stepUploadChecker(1, {} as any, 7, '/dir', config);
      expect(formatter.fmt.stepComplete).toHaveBeenCalledWith(
        'Standard Checker Updated'
      );
    });

    it('should report custom checker uploaded', async () => {
      vi.mocked(pushing.uploadChecker).mockResolvedValue(1);
      const config = baseConfig({
        checker: { name: 'c', source: 'c.cpp', isStandard: false },
      });
      await steps.stepUploadChecker(1, {} as any, 7, '/dir', config);
      expect(formatter.fmt.stepComplete).toHaveBeenCalledWith(
        'Checker uploaded'
      );
    });
  });

  describe('stepUploadValidator', () => {
    it('should report no validator when count is 0', async () => {
      vi.mocked(pushing.uploadValidator).mockResolvedValue(0);
      const config = baseConfig();
      await steps.stepUploadValidator(1, {} as any, 7, '/dir', config);
      expect(formatter.fmt.stepComplete).toHaveBeenCalledWith(
        'No validator to upload'
      );
    });

    it('records no upload action when Config.json has no validator', async () => {
      const addAction = vi.spyOn(report, 'addAction');
      vi.mocked(pushing.uploadValidator).mockResolvedValue(0);
      const config = baseConfig({ validator: undefined });
      await steps.stepUploadValidator(1, {} as any, 7, '/dir', config);
      expect(addAction).not.toHaveBeenCalled();
      addAction.mockRestore();
    });

    it('should report uploaded when count > 0', async () => {
      vi.mocked(pushing.uploadValidator).mockResolvedValue(1);
      const config = baseConfig();
      await steps.stepUploadValidator(1, {} as any, 7, '/dir', config);
      expect(formatter.fmt.stepComplete).toHaveBeenCalledWith(
        'Validator uploaded'
      );
    });
  });

  describe('stepUploadGenerators', () => {
    it('should call uploadGenerators', async () => {
      vi.mocked(pushing.uploadGenerators).mockResolvedValue(2);
      await steps.stepUploadGenerators(1, {} as any, 7, '/dir', baseConfig());
      expect(pushing.uploadGenerators).toHaveBeenCalled();
    });
  });

  describe('stepUploadStatements', () => {
    it('should call uploadStatements', async () => {
      vi.mocked(pushing.uploadStatements).mockResolvedValue(1);
      await steps.stepUploadStatements(1, {} as any, 7, '/dir', baseConfig());
      expect(pushing.uploadStatements).toHaveBeenCalled();
    });
  });

  describe('stepUploadMetadata', () => {
    it('should log description and tags when present', async () => {
      const config = baseConfig({
        description: 'A long description for the problem',
        tags: ['math', 'dp'],
      });
      await steps.stepUploadMetadata(1, {} as any, 7, config);
      expect(pushing.uploadMetadata).toHaveBeenCalled();
      expect(formatter.fmt.info).toHaveBeenCalledWith(
        expect.stringContaining('Description')
      );
    });

    it('should not log tags or description when absent', async () => {
      const config = baseConfig();
      await steps.stepUploadMetadata(1, {} as any, 7, config);
      expect(pushing.uploadMetadata).toHaveBeenCalled();
    });
  });

  describe('stepUploadTestsets', () => {
    it('should call uploadTestsets and report counts', async () => {
      vi.mocked(pushing.uploadTestsets).mockResolvedValue({
        testsCount: 10,
        manualsCount: 3,
      });
      await steps.stepUploadTestsets(1, {} as any, 7, '/dir', baseConfig());
      expect(pushing.uploadTestsets).toHaveBeenCalled();
    });
  });

  describe('stepCreateProblemOnPolygon', () => {
    it('should return new problem id', async () => {
      const sdk = {
        createProblem: vi.fn().mockResolvedValue({ id: 99 }),
      } as any;
      const result = await steps.stepCreateProblemOnPolygon(1, sdk, 'two-sum');
      expect(result).toBe(99);
    });

    it('should wrap thrown errors', async () => {
      const sdk = {
        createProblem: vi.fn().mockRejectedValue(new Error('upstream')),
      } as any;
      await expect(
        steps.stepCreateProblemOnPolygon(1, sdk, 'x')
      ).rejects.toThrow('Failed to create problem on Polygon: upstream');
      await expect(
        steps.stepCreateProblemOnPolygon(1, sdk, 'x')
      ).rejects.toHaveProperty('exitCode', 4);
    });

    it('should wrap non-Error rejections', async () => {
      const sdk = {
        createProblem: vi.fn().mockRejectedValue('strerr'),
      } as any;
      await expect(
        steps.stepCreateProblemOnPolygon(1, sdk, 'x')
      ).rejects.toThrow('Failed to create problem on Polygon: strerr');
    });
  });

  describe('stepUpdateConfigWithProblemId', () => {
    it('should write Config.json with new id and name', () => {
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
      const config = baseConfig({ name: 'old', problemId: undefined });
      steps.stepUpdateConfigWithProblemId(1, '/dir', config, 42, 'new-name');
      expect(config.problemId).toBe(42);
      expect(config.name).toBe('new-name');
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('Config.json'),
        expect.any(String),
        'utf-8'
      );
    });
  });
  describe('uploadActions', () => {
    it('marks every item ok when the step added no failures', () => {
      expect(steps.uploadActions('solution', ['main', 'wa'], [])).toEqual([
        { component: 'solution', name: 'main', action: 'upload', ok: true },
        { component: 'solution', name: 'wa', action: 'upload', ok: true },
      ]);
    });

    it('fails the item named in a failure and keeps the others ok', () => {
      expect(
        steps.uploadActions(
          'solution',
          ['main', 'wa'],
          ['solution wa: Polygon API Error: x: y']
        )
      ).toEqual([
        { component: 'solution', name: 'main', action: 'upload', ok: true },
        {
          component: 'solution',
          name: 'wa',
          action: 'upload',
          ok: false,
          error: 'Polygon API Error: x: y',
        },
      ]);
    });

    it('fails a testset for its sub-step failures and keeps their labels', () => {
      expect(
        steps.uploadActions(
          'testset',
          ['tests'],
          ['testset tests script: bad', 'testset tests group g1: no']
        )
      ).toEqual([
        {
          component: 'testset',
          name: 'tests',
          action: 'upload',
          ok: false,
          error: 'testset tests script: bad; testset tests group g1: no',
        },
      ]);
    });

    it('matches a failure labelled with the component or the item name', () => {
      expect(
        steps.uploadActions('validator', ['val'], ['validator: not found'])
      ).toEqual([
        {
          component: 'validator',
          name: 'val',
          action: 'upload',
          ok: false,
          error: 'not found',
        },
      ]);
      expect(
        steps.uploadActions('metadata', ['description', 'tags'], ['tags: no'])
      ).toEqual([
        {
          component: 'metadata',
          name: 'description',
          action: 'upload',
          ok: true,
        },
        {
          component: 'metadata',
          name: 'tags',
          action: 'upload',
          ok: false,
          error: 'no',
        },
      ]);
    });

    it('does not blame an item whose name is a prefix of the failed one', () => {
      expect(
        steps.uploadActions(
          'solution',
          ['main', 'main 2'],
          ['solution main 2: boom']
        )
      ).toEqual([
        { component: 'solution', name: 'main', action: 'upload', ok: true },
        {
          component: 'solution',
          name: 'main 2',
          action: 'upload',
          ok: false,
          error: 'boom',
        },
      ]);
    });

    it('blames the real item when its name contains ": "', () => {
      expect(
        steps.uploadActions('solution', ['a: b', 'ok'], ['solution a: b: boom'])
      ).toEqual([
        {
          component: 'solution',
          name: 'a: b',
          action: 'upload',
          ok: false,
          error: 'boom',
        },
        { component: 'solution', name: 'ok', action: 'upload', ok: true },
      ]);
    });

    it('tries the longest name first when one name prefixes another', () => {
      expect(
        steps.uploadActions('solution', ['a', 'a: b'], ['solution a: b: boom'])
      ).toEqual([
        { component: 'solution', name: 'a', action: 'upload', ok: true },
        {
          component: 'solution',
          name: 'a: b',
          action: 'upload',
          ok: false,
          error: 'boom',
        },
      ]);
    });

    it('adds failures that belong to no item as their own entries', () => {
      expect(
        steps.uploadActions('checker', ['chk'], ['checker test #2: rejected'])
      ).toEqual([
        { component: 'checker', name: 'chk', action: 'upload', ok: true },
        {
          component: 'checker',
          name: 'checker test #2',
          action: 'upload',
          ok: false,
          error: 'rejected',
        },
      ]);
    });
  });

  describe('remote steps with a --json report', () => {
    it('records the upload step actions in the report', async () => {
      const addAction = vi.spyOn(report, 'addAction');
      vi.mocked(pushing.uploadSolutions).mockImplementation(
        async (_sdk, _id, _dir, _config, failures = []) => {
          failures.push('solution wa: rejected');
          return Promise.resolve(1);
        }
      );
      const config = baseConfig({
        solutions: [
          { name: 'main', source: 'main.cpp', tag: 'MA' },
          { name: 'wa', source: 'wa.cpp', tag: 'WA' },
        ],
      });
      await steps.stepUploadSolutions(1, {} as any, 7, '/p', config, []);
      expect(addAction.mock.calls.map(call => call[0])).toEqual([
        { component: 'solution', name: 'main', action: 'upload', ok: true },
        {
          component: 'solution',
          name: 'wa',
          action: 'upload',
          ok: false,
          error: 'rejected',
        },
      ]);
      addAction.mockRestore();
    });

    it('records a checker that failed to upload before rethrowing', async () => {
      const addAction = vi.spyOn(report, 'addAction');
      vi.mocked(pushing.uploadChecker).mockRejectedValue(new Error('gone'));
      const config = baseConfig({
        checker: { name: 'chk', source: 'chk.cpp' },
      });
      await expect(
        steps.stepUploadChecker(1, {} as any, 7, '/p', config, [])
      ).rejects.toThrow('gone');
      expect(addAction).toHaveBeenCalledWith({
        component: 'checker',
        name: 'chk',
        action: 'upload',
        ok: false,
        error: 'gone',
      });
      addAction.mockRestore();
    });

    it('registers the credentials as secrets', () => {
      const setSecrets = vi.spyOn(report, 'setSecrets');
      vi.mocked(remoteUtils.readCredentials).mockReturnValue({
        apiKey: 'k',
        secret: 's',
      });
      steps.stepReadCredentials(1);
      expect(setSecrets).toHaveBeenCalledWith(['k', 's']);
      setSecrets.mockRestore();
    });

    it('does not prompt for problem creation while --json is active', async () => {
      vi.mocked(utils.stdinIsInteractive).mockReturnValue(true);
      const isActive = vi.spyOn(report, 'isActive').mockReturnValue(true);
      await expect(steps.stepPromptCreateProblem(1)).rejects.toThrow(
        /--json is set, so polyman does not prompt; pass --yes/
      );
      isActive.mockRestore();
    });

    it('does not prompt for a problem name while --json is active', async () => {
      vi.mocked(utils.stdinIsInteractive).mockReturnValue(true);
      const isActive = vi.spyOn(report, 'isActive').mockReturnValue(true);
      const sdk = {
        listProblems: vi.fn().mockResolvedValue([]),
      } as unknown as Parameters<typeof steps.stepGetValidProblemName>[1];
      await expect(
        steps.stepGetValidProblemName(1, sdk, undefined)
      ).rejects.toBeInstanceOf(NonInteractiveError);
      isActive.mockRestore();
    });
  });

  describe('stepPromptCreateProblem', () => {
    it('returns true without prompting when --yes is given', async () => {
      const result = await steps.stepPromptCreateProblem(1, { yes: true });
      expect(result).toBe(true);
      expect(utils.stdinIsInteractive).not.toHaveBeenCalled();
      expect(formatter.fmt.stepComplete).toHaveBeenCalledWith(
        'Confirmed via --yes'
      );
    });

    it('fails fast instead of prompting when stdin is not a terminal', async () => {
      vi.mocked(utils.stdinIsInteractive).mockReturnValue(false);
      await expect(steps.stepPromptCreateProblem(1)).rejects.toThrow(
        /stdin is not a terminal; pass --yes/
      );
      await expect(steps.stepPromptCreateProblem(1)).rejects.toBeInstanceOf(
        NonInteractiveError
      );
    });

    it('prompts on a terminal and accepts yes', async () => {
      vi.mocked(utils.stdinIsInteractive).mockReturnValue(true);
      const close = vi.fn();
      vi.doMock('readline', () => ({
        createInterface: () => ({
          question: (_q: string, cb: (a: string) => void) => cb('yes'),
          close,
        }),
      }));
      const result = await steps.stepPromptCreateProblem(1);
      expect(result).toBe(true);
      expect(close).toHaveBeenCalled();
      vi.doUnmock('readline');
    });

    it('prompts on a terminal and treats anything but yes/y as cancel', async () => {
      vi.mocked(utils.stdinIsInteractive).mockReturnValue(true);
      vi.doMock('readline', () => ({
        createInterface: () => ({
          question: (_q: string, cb: (a: string) => void) => cb('no'),
          close: vi.fn(),
        }),
      }));
      const result = await steps.stepPromptCreateProblem(1);
      expect(result).toBe(false);
      expect(formatter.fmt.stepComplete).toHaveBeenCalledWith('User cancelled');
      vi.doUnmock('readline');
    });
  });

  describe('stepGetValidProblemName', () => {
    type Sdk = Parameters<typeof steps.stepGetValidProblemName>[1];
    const sdkWith = (names: string[]): Sdk =>
      ({
        listProblems: vi.fn().mockResolvedValue(names.map(name => ({ name }))),
      }) as unknown as Sdk;

    it('accepts a valid --name that is free on Polygon', async () => {
      vi.mocked(utils.stdinIsInteractive).mockReturnValue(false);
      const name = await steps.stepGetValidProblemName(
        1,
        sdkWith(['other']),
        'config-name',
        { explicitName: 'two-sum' }
      );
      expect(name).toBe('two-sum');
    });

    it('rejects an invalid --name with the naming rule instead of prompting', async () => {
      vi.mocked(utils.stdinIsInteractive).mockReturnValue(true);
      await expect(
        steps.stepGetValidProblemName(1, sdkWith([]), undefined, {
          explicitName: 'Two Sum',
        })
      ).rejects.toThrow(
        'Invalid problem name "Two Sum". Name must be lowercase, no spaces, only dashes allowed.'
      );
    });

    it('fails with exit code 2 on an invalid --name', async () => {
      vi.mocked(utils.stdinIsInteractive).mockReturnValue(false);
      const error: unknown = await steps
        .stepGetValidProblemName(1, sdkWith([]), undefined, {
          explicitName: 'Two Sum',
        })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(PolymanError);
      expect((error as PolymanError).exitCode).toBe(2);
    });

    it('keeps exit code 1 for a --name that already exists on Polygon', async () => {
      vi.mocked(utils.stdinIsInteractive).mockReturnValue(false);
      const error: unknown = await steps
        .stepGetValidProblemName(1, sdkWith(['two-sum']), undefined, {
          explicitName: 'two-sum',
        })
        .catch((e: unknown) => e);
      expect((error as Error).message).toContain('already exists on Polygon');
      expect((error as { exitCode?: number }).exitCode).not.toBe(2);
    });

    it('rejects a --name that already exists on Polygon', async () => {
      vi.mocked(utils.stdinIsInteractive).mockReturnValue(true);
      await expect(
        steps.stepGetValidProblemName(1, sdkWith(['Two-Sum']), undefined, {
          explicitName: 'two-sum',
        })
      ).rejects.toThrow('Problem name "two-sum" already exists on Polygon.');
    });

    it('uses a valid Config.json name without prompting when headless', async () => {
      vi.mocked(utils.stdinIsInteractive).mockReturnValue(false);
      const name = await steps.stepGetValidProblemName(
        1,
        sdkWith([]),
        'max-flow'
      );
      expect(name).toBe('max-flow');
    });

    it('fails fast when headless and no usable name is available', async () => {
      vi.mocked(utils.stdinIsInteractive).mockReturnValue(false);
      await expect(
        steps.stepGetValidProblemName(1, sdkWith([]), undefined)
      ).rejects.toBeInstanceOf(NonInteractiveError);
      await expect(
        steps.stepGetValidProblemName(1, sdkWith([]), undefined)
      ).rejects.toThrow(/pass --name <name>/);
    });

    it('fails fast when headless and the Config.json name is invalid', async () => {
      vi.mocked(utils.stdinIsInteractive).mockReturnValue(false);
      await expect(
        steps.stepGetValidProblemName(1, sdkWith([]), 'Bad Name')
      ).rejects.toThrow('Invalid problem name "Bad Name"');
    });

    it('assumes the name is free when Polygon cannot be queried', async () => {
      vi.mocked(utils.stdinIsInteractive).mockReturnValue(false);
      const sdk = {
        listProblems: vi.fn().mockRejectedValue(new Error('offline')),
      } as unknown as Sdk;
      const name = await steps.stepGetValidProblemName(1, sdk, 'two-sum');
      expect(name).toBe('two-sum');
    });

    it('prompts on a terminal until a valid free name is typed', async () => {
      vi.mocked(utils.stdinIsInteractive).mockReturnValue(true);
      const answers = ['Bad Name', 'taken', 'fresh-name'];
      const close = vi.fn();
      vi.doMock('readline', () => ({
        createInterface: () => ({
          question: (_q: string, cb: (a: string) => void) =>
            cb(answers.shift() ?? ''),
          close,
        }),
      }));
      const name = await steps.stepGetValidProblemName(
        1,
        sdkWith(['taken']),
        undefined
      );
      expect(name).toBe('fresh-name');
      expect(close).toHaveBeenCalledTimes(1);
      expect(formatter.fmt.error).toHaveBeenCalledWith(
        expect.stringContaining('Invalid problem name "Bad Name"')
      );
      expect(formatter.fmt.error).toHaveBeenCalledWith(
        expect.stringContaining('already exists on Polygon')
      );
      vi.doUnmock('readline');
    });
  });
});
