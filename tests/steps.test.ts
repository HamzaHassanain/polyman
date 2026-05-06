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
import * as remoteUtils from '../src/helpers/remote/utils';
import * as pulling from '../src/helpers/remote/pulling';
import * as pushing from '../src/helpers/remote/pushing';
import * as viewer from '../src/helpers/remote/viewer';
import * as polygonModule from '../src/polygon';
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
        { name: 'tests' } as any,
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
      await steps.stepGenerateSingleTest(
        1,
        config,
        { name: 'tests' } as any,
        2
      );
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
        { name: 'tests' } as any,
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
        { name: 'tests' } as any,
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
      await steps.stepGenerateTestsForGroup(
        1,
        config,
        { name: 'tests' } as any,
        'g'
      );
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
      } as any);
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
      } as any);
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
      vi.mocked(viewer.fetchStatements).mockResolvedValue([] as any);
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
      } as any);
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

  describe('stepFetchGenerators', () => {
    it('should call identifyGenerators', () => {
      vi.mocked(viewer.identifyGenerators).mockReturnValue([
        { name: 'g.cpp' },
      ] as any);
      const result = steps.stepFetchGenerators(
        1,
        { resourceFiles: [], sourceFiles: [], auxFiles: [] } as any,
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
        { resourceFiles: [], sourceFiles: [], auxFiles: [] } as any,
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
      await vi.advanceTimersByTimeAsync(30000);
      const result = await promise;
      expect(result.state).toBe('READY');
      expect(result.id).toBe(5);
      vi.useRealTimers();
    });

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
      await vi.advanceTimersByTimeAsync(30000);
      await expect(promise).rejects.toThrow('Package build failed: oops');
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
    it('should aggregate downloads and write Config.json', async () => {
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
      } as any);
      vi.mocked(pulling.downloadChecker).mockResolvedValue({
        count: 1,
        data: { name: 'wcmp', source: 'wcmp.cpp' },
      } as any);
      vi.mocked(pulling.downloadValidator).mockResolvedValue({
        count: 1,
        data: { name: 'val', source: 'val.cpp' },
      } as any);
      vi.mocked(pulling.downloadGenerators).mockResolvedValue({
        count: 2,
        data: [],
      } as any);
      vi.mocked(pulling.downloadStatements).mockResolvedValue({
        count: 0,
        config: {},
      } as any);
      vi.mocked(pulling.fetchProblemMetadata).mockResolvedValue({
        description: 'd',
        tags: ['t'],
      } as any);
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);

      await steps.stepDownloadProblemFilesAndSetUpConfig(
        1,
        {} as any,
        7,
        'savePath'
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('Config.json'),
        expect.any(String),
        'utf-8'
      );
    });
  });

  describe('stepDownloadTests', () => {
    it('should throw when Config.json is missing', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      await expect(
        steps.stepDownloadTests(1, {} as any, 7, 'tests', 'savePath')
      ).rejects.toThrow('Config.json not found');
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
      await steps.stepDownloadTests(1, {} as any, 7, 'tests', 'savePath');
      expect(fs.writeFileSync).toHaveBeenCalled();
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
      ).resolves.toBeUndefined();
      expect(formatter.fmt.warning).toHaveBeenCalled();
    });
  });

  describe('stepReadConfig', () => {
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
});
