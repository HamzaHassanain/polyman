/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as actions from '../src/actions';
import * as steps from '../src/steps';
import * as utils from '../src/helpers/utils';
import * as formatter from '../src/formatter';
import * as testset from '../src/helpers/testset';
import * as solution from '../src/helpers/solution';
import * as createTemplate from '../src/helpers/create-template';
import fs from 'fs';

vi.mock('../src/steps');
vi.mock('../src/helpers/utils');
vi.mock('../src/helpers/testset');
vi.mock('../src/helpers/solution');
vi.mock('../src/helpers/create-template');
vi.mock('../src/formatter');
vi.mock('fs');

describe('actions.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    vi.spyOn(process, 'cwd').mockReturnValue('/mock/cwd');
    vi.mocked(utils.isNumeric).mockImplementation((s: string) =>
      /^[0-9]+$/.test(s)
    );
    vi.mocked(testset.findTestset).mockImplementation(
      (_sets: any, name: string) => ({ name }) as any
    );
    vi.mocked(solution.findMatchingSolutions).mockImplementation(
      (sols: any) => sols || []
    );
  });

  describe('createTemplateAction', () => {
    it('should create template successfully', () => {
      actions.createTemplateAction('prob');
      expect(steps.stepCreateDirectoryStructure).toHaveBeenCalled();
      expect(steps.stepCopyTemplateFiles).toHaveBeenCalled();
      expect(formatter.fmt.successBox).toHaveBeenCalled();
      expect(createTemplate.logTemplateCreationSuccess).toHaveBeenCalledWith(
        'prob'
      );
    });

    it('should handle errors', () => {
      vi.mocked(steps.stepCreateDirectoryStructure).mockImplementation(() => {
        throw new Error('fail');
      });
      actions.createTemplateAction('prob');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('should handle non-Error throws', () => {
      vi.mocked(steps.stepCreateDirectoryStructure).mockImplementation(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'string-error';
      });
      actions.createTemplateAction('prob');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('listAvailableCheckersAction', () => {
    it('should warn when no checker files found', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([] as any);
      actions.listAvailableCheckersAction();
      expect(formatter.fmt.warning).toHaveBeenCalled();
    });

    it('should list checkers with descriptions', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        'ncmp.cpp',
        'wcmp.cpp',
        'testlib.h',
        'readme.txt',
      ] as any);
      vi.mocked(fs.readFileSync).mockReturnValue(
        '// Description: number compare\nint main() {}\n' as any
      );
      actions.listAvailableCheckersAction();
      expect(fs.readFileSync).toHaveBeenCalled();
      expect(formatter.fmt.log).toHaveBeenCalled();
    });

    it('should handle checker file with no description', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['x.cpp'] as any);
      vi.mocked(fs.readFileSync).mockReturnValue('int main() {}\n' as any);
      actions.listAvailableCheckersAction();
      expect(formatter.fmt.log).toHaveBeenCalled();
    });

    it('should error when checkers directory missing', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      actions.listAvailableCheckersAction();
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('downloadTestlibAction', () => {
    it('should download testlib successfully on linux', async () => {
      const original = process.platform;
      Object.defineProperty(process, 'platform', { value: 'linux' });
      vi.mocked(steps.stepDownloadTestlib).mockResolvedValue('code');
      await actions.downloadTestlibAction();
      expect(steps.stepDownloadTestlib).toHaveBeenCalled();
      expect(steps.stepSaveTestlibToDirectory).toHaveBeenCalled();
      expect(formatter.fmt.successBox).toHaveBeenCalled();
      Object.defineProperty(process, 'platform', { value: original });
    });

    it('should download testlib on win32', async () => {
      const original = process.platform;
      Object.defineProperty(process, 'platform', { value: 'win32' });
      vi.mocked(steps.stepDownloadTestlib).mockResolvedValue('code');
      await actions.downloadTestlibAction();
      expect(steps.stepSaveTestlibToDirectory).toHaveBeenCalled();
      Object.defineProperty(process, 'platform', { value: original });
    });

    it('should handle download failure', async () => {
      vi.mocked(steps.stepDownloadTestlib).mockRejectedValue(
        new Error('network')
      );
      await actions.downloadTestlibAction();
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('generateTestsAction', () => {
    it('should generate all tests', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      await actions.generateTestsAction('all');
      expect(steps.stepGenerateAllTestsets).toHaveBeenCalled();
      expect(steps.stepCompileGeneratorsForTestsets).toHaveBeenCalled();
    });

    it('should generate specific testset', async () => {
      const config: any = { testsets: [{ name: 'ts1' }] };
      vi.mocked(utils.readConfigFile).mockReturnValue(config);
      await actions.generateTestsAction('ts1');
      expect(steps.stepCompileGeneratorsForTestset).toHaveBeenCalled();
      expect(steps.stepGenerateTestsForTestset).toHaveBeenCalled();
    });

    it('should generate group when modifier is non-numeric', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        testsets: [{ name: 'ts1' }],
      } as any);
      await actions.generateTestsAction('ts1', 'samples');
      expect(steps.stepCompileGeneratorsForGroup).toHaveBeenCalled();
      expect(steps.stepGenerateTestsForGroup).toHaveBeenCalled();
    });

    it('should generate single test when modifier is numeric', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        testsets: [{ name: 'ts1' }],
      } as any);
      await actions.generateTestsAction('ts1', '5');
      expect(steps.stepCompileGeneratorsForSingleTest).toHaveBeenCalled();
      expect(steps.stepGenerateSingleTest).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      vi.mocked(utils.readConfigFile).mockImplementation(() => {
        throw new Error('bad config');
      });
      await actions.generateTestsAction('all');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('validateTestsAction', () => {
    it('should validate all tests', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      await actions.validateTestsAction('all');
      expect(steps.stepValidateAllTestsets).toHaveBeenCalled();
      expect(steps.stepCompileValidator).toHaveBeenCalled();
    });

    it('should validate single testset', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        testsets: [{ name: 'ts1' }],
      } as any);
      await actions.validateTestsAction('ts1');
      expect(steps.stepValidateTestset).toHaveBeenCalled();
    });

    it('should validate group', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        testsets: [{ name: 'ts1' }],
      } as any);
      await actions.validateTestsAction('ts1', 'samples');
      expect(steps.stepValidateGroup).toHaveBeenCalled();
    });

    it('should validate single test', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        testsets: [{ name: 'ts1' }],
      } as any);
      await actions.validateTestsAction('ts1', '3');
      expect(steps.stepValidateSingleTest).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      vi.mocked(utils.readConfigFile).mockImplementation(() => {
        throw new Error('bad');
      });
      await actions.validateTestsAction('all');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('runSolutionAction', () => {
    const cfg: any = {
      solutions: [{ name: 'main', tag: 'MA' }],
      testsets: [{ name: 'ts1' }],
    };

    it('should run solutions on all tests', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue(cfg);
      await actions.runSolutionAction('main', 'all');
      expect(steps.stepRunSolutionsOnAllTestsets).toHaveBeenCalled();
    });

    it('should run on entire testset', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue(cfg);
      await actions.runSolutionAction('main', 'ts1');
      expect(steps.stepRunSolutionsOnTestset).toHaveBeenCalled();
    });

    it('should run on group', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue(cfg);
      await actions.runSolutionAction('main', 'ts1', 'samples');
      expect(steps.stepRunSolutionsOnGroup).toHaveBeenCalled();
    });

    it('should run on single test', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue(cfg);
      await actions.runSolutionAction('main', 'ts1', '4');
      expect(steps.stepRunSolutionsOnTest).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      vi.mocked(utils.readConfigFile).mockImplementation(() => {
        throw new Error('boom');
      });
      await actions.runSolutionAction('main', 'all');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('testWhatAction', () => {
    it('should test validator', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      await actions.testWhatAction('validator');
      expect(steps.stepCompileValidator).toHaveBeenCalled();
      expect(steps.stepTestValidator).toHaveBeenCalled();
    });

    it('should test checker', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      await actions.testWhatAction('checker');
      expect(steps.stepCompileChecker).toHaveBeenCalled();
      expect(steps.stepTestChecker).toHaveBeenCalled();
    });

    it('should test a solution by name (default branch)', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      vi.mocked(steps.stepValidateConfigForSolutionTest).mockReturnValue({
        mainSolution: { name: 'main', tag: 'MA' },
        targetSolution: { name: 'wa', tag: 'WA' },
      } as any);
      await actions.testWhatAction('wa');
      expect(steps.stepValidateConfigForSolutionTest).toHaveBeenCalled();
      expect(steps.stepCompileSolutions).toHaveBeenCalled();
      expect(steps.stepCompileChecker).toHaveBeenCalled();
      expect(steps.stepTestSolutionBehavior).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      vi.mocked(utils.readConfigFile).mockImplementation(() => {
        throw new Error('x');
      });
      await actions.testWhatAction('validator');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('fullVerificationAction', () => {
    it('should run full verification', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      await actions.fullVerificationAction();
      expect(steps.stepCompileGeneratorsForTestsets).toHaveBeenCalled();
      expect(steps.stepGenerateTestsForVerification).toHaveBeenCalled();
      expect(steps.stepCompileValidator).toHaveBeenCalled();
      expect(steps.stepTestValidator).toHaveBeenCalled();
      expect(steps.stepValidateGeneratedTests).toHaveBeenCalled();
      expect(steps.stepCompileChecker).toHaveBeenCalled();
      expect(steps.stepTestChecker).toHaveBeenCalled();
      expect(steps.stepCompileSolutionsForVerification).toHaveBeenCalled();
      expect(steps.stepRunSolutionsForVerification).toHaveBeenCalled();
      expect(steps.stepVerifySolutionsAgainstMainCorrect).toHaveBeenCalled();
      expect(formatter.fmt.successBox).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      vi.mocked(utils.readConfigFile).mockImplementation(() => {
        throw new Error('z');
      });
      await actions.fullVerificationAction();
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('listTestsetsAction', () => {
    it('should list testsets', () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        testsets: [{ name: 'ts1' }, { name: 'ts2' }],
      } as any);
      vi.mocked(testset.listTestsets).mockReturnValue(['ts1: 5', 'ts2: 10']);
      actions.listTestsetsAction();
      expect(testset.listTestsets).toHaveBeenCalled();
      expect(formatter.fmt.log).toHaveBeenCalled();
    });

    it('should handle errors', () => {
      vi.mocked(utils.readConfigFile).mockImplementation(() => {
        throw new Error('q');
      });
      actions.listTestsetsAction();
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('listSolutionsAction', () => {
    it('should warn when no solutions', () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({ solutions: [] } as any);
      actions.listSolutionsAction();
      expect(formatter.fmt.warning).toHaveBeenCalled();
    });

    it('should warn when solutions undefined', () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      actions.listSolutionsAction();
      expect(formatter.fmt.warning).toHaveBeenCalled();
    });

    it('should list solutions with known and unknown tags', () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        solutions: [
          { name: 'main', source: 'sol/main.cpp', tag: 'MA' },
          { name: 'weird', source: 'sol/w.cpp', tag: 'XX' },
        ],
      } as any);
      actions.listSolutionsAction();
      expect(formatter.fmt.log).toHaveBeenCalled();
    });

    it('should handle errors', () => {
      vi.mocked(utils.readConfigFile).mockImplementation(() => {
        throw new Error('p');
      });
      actions.listSolutionsAction();
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('listGeneratorsAction', () => {
    it('should warn when no generators', () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        generators: [],
      } as any);
      actions.listGeneratorsAction();
      expect(formatter.fmt.warning).toHaveBeenCalled();
    });

    it('should warn when generators undefined', () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      actions.listGeneratorsAction();
      expect(formatter.fmt.warning).toHaveBeenCalled();
    });

    it('should list generators', () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        generators: [
          { name: 'gen1', source: 'gen/g1.cpp' },
          { name: 'gen2', source: 'gen/g2.cpp' },
        ],
      } as any);
      actions.listGeneratorsAction();
      expect(formatter.fmt.log).toHaveBeenCalled();
    });

    it('should handle errors', () => {
      vi.mocked(utils.readConfigFile).mockImplementation(() => {
        throw new Error('e');
      });
      actions.listGeneratorsAction();
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('registerApiKeyAndSecretAction', () => {
    it('should register credentials creating directory', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(fs.mkdirSync).mockImplementation(() => undefined);
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
      actions.registerApiKeyAndSecretAction('apikey', 'secret');
      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
      expect(formatter.fmt.successBox).toHaveBeenCalled();
    });

    it('should register without creating directory if exists', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
      actions.registerApiKeyAndSecretAction('apikey', 'secret');
      expect(fs.mkdirSync).not.toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
    });

    it('should handle errors', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error('write fail');
      });
      actions.registerApiKeyAndSecretAction('apikey', 'secret');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('remoteListProblemsAction', () => {
    beforeEach(() => {
      vi.mocked(steps.stepReadCredentials).mockReturnValue({
        apiKey: 'k',
        secret: 's',
      } as any);
      vi.mocked(steps.stepInitializeSDK).mockReturnValue({} as any);
    });

    it('should list all problems', async () => {
      vi.mocked(steps.stepListProblems).mockResolvedValue([
        { id: 1, name: 'p', owner: 'me', accessType: 'OWNER' },
      ] as any);
      await actions.remoteListProblemsAction();
      expect(steps.stepDisplayProblems).toHaveBeenCalled();
      expect(formatter.fmt.successBox).toHaveBeenCalled();
    });

    it('should filter problems by owner', async () => {
      vi.mocked(steps.stepListProblems).mockResolvedValue([
        { id: 1, name: 'p', owner: 'tourist', accessType: 'OWNER' },
        { id: 2, name: 'q', owner: 'someone', accessType: 'READ' },
      ] as any);
      await actions.remoteListProblemsAction('TOURIST');
      expect(steps.stepDisplayProblems).toHaveBeenCalledWith(
        expect.any(Number),
        expect.arrayContaining([expect.objectContaining({ owner: 'tourist' })])
      );
    });

    it('should warn when owner has no problems', async () => {
      vi.mocked(steps.stepListProblems).mockResolvedValue([
        { id: 1, name: 'p', owner: 'me', accessType: 'OWNER' },
      ] as any);
      await actions.remoteListProblemsAction('nobody');
      expect(formatter.fmt.warning).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      vi.mocked(steps.stepReadCredentials).mockImplementation(() => {
        throw new Error('no creds');
      });
      await actions.remoteListProblemsAction();
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('remotePullProblemAction', () => {
    beforeEach(() => {
      vi.mocked(steps.stepReadCredentials).mockReturnValue({} as any);
      vi.mocked(steps.stepInitializeSDK).mockReturnValue({} as any);
      vi.mocked(steps.stepGetProblemId).mockReturnValue(123 as any);
    });

    it('should pull all by default', async () => {
      await actions.remotePullProblemAction('123', './out', { all: true });
      expect(steps.stepFetchProblemInfo).toHaveBeenCalled();
      expect(steps.stepCreatePulledProblemDirectory).toHaveBeenCalled();
      expect(steps.stepDownloadProblemFilesAndSetUpConfig).toHaveBeenCalled();
      expect(steps.stepDownloadTests).toHaveBeenCalled();
    });

    it('should pull selected testsets when tests option is comma list', async () => {
      await actions.remotePullProblemAction('123', './out', {
        tests: 'ts1,ts2',
      });
      expect(steps.stepDownloadTests).toHaveBeenCalledTimes(2);
    });

    it('should skip tests when not requested', async () => {
      await actions.remotePullProblemAction('123', './out', {
        solutions: true,
      });
      expect(steps.stepDownloadTests).not.toHaveBeenCalled();
      expect(steps.stepFetchProblemInfo).not.toHaveBeenCalled();
    });

    it('should pull info only when info option', async () => {
      await actions.remotePullProblemAction('123', './out', { info: true });
      expect(steps.stepFetchProblemInfo).toHaveBeenCalled();
      expect(steps.stepDownloadTests).not.toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      vi.mocked(steps.stepReadCredentials).mockImplementation(() => {
        throw new Error('e');
      });
      await actions.remotePullProblemAction('123', './out');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('remotePushProblemAction', () => {
    beforeEach(() => {
      vi.mocked(steps.stepReadCredentials).mockReturnValue({} as any);
      vi.mocked(steps.stepInitializeSDK).mockReturnValue({} as any);
    });

    it('should push existing problem with all sections', async () => {
      vi.mocked(steps.stepReadConfig).mockReturnValue({
        problemId: 42,
        name: 'p',
        solutions: [{ name: 'main' }],
        checker: { name: 'c' },
        validator: { name: 'v' },
        generators: [{ name: 'g' }],
        statements: { name: 's' },
        testsets: [{ name: 'ts' }],
      } as any);
      await actions.remotePushProblemAction('./prob');
      expect(steps.stepUpdateProblemInfo).toHaveBeenCalled();
      expect(steps.stepUploadSolutions).toHaveBeenCalled();
      expect(steps.stepUploadChecker).toHaveBeenCalled();
      expect(steps.stepUploadValidator).toHaveBeenCalled();
      expect(steps.stepUploadGenerators).toHaveBeenCalled();
      expect(steps.stepUploadStatements).toHaveBeenCalled();
      expect(steps.stepUploadMetadata).toHaveBeenCalled();
      expect(steps.stepUploadTestsets).toHaveBeenCalled();
      expect(formatter.fmt.successBox).toHaveBeenCalled();
    });

    it('should warn for missing components on pushAll', async () => {
      vi.mocked(steps.stepReadConfig).mockReturnValue({
        problemId: 42,
        name: 'p',
      } as any);
      await actions.remotePushProblemAction('./prob');
      expect(formatter.fmt.warning).toHaveBeenCalled();
    });

    it('should error for missing components when specifically requested', async () => {
      vi.mocked(steps.stepReadConfig).mockReturnValue({
        problemId: 42,
        name: 'p',
      } as any);
      await actions.remotePushProblemAction('./prob', {
        solutions: true,
        checker: true,
        validator: true,
        generators: true,
        statements: true,
        tests: true,
      });
      expect(formatter.fmt.error).toHaveBeenCalled();
    });

    it('should create new problem when no problemId and user confirms', async () => {
      vi.mocked(steps.stepReadConfig).mockReturnValue({
        name: 'newprob',
      } as any);
      vi.mocked(steps.stepPromptCreateProblem).mockResolvedValue(true);
      vi.mocked(steps.stepGetValidProblemName).mockResolvedValue('newprob');
      vi.mocked(steps.stepCreateProblemOnPolygon).mockResolvedValue(99);
      await actions.remotePushProblemAction('./prob');
      expect(steps.stepCreateProblemOnPolygon).toHaveBeenCalled();
      expect(steps.stepUpdateConfigWithProblemId).toHaveBeenCalled();
    });

    it('should cancel push if user declines new problem creation', async () => {
      vi.mocked(steps.stepReadConfig).mockReturnValue({
        name: 'newprob',
      } as any);
      vi.mocked(steps.stepPromptCreateProblem).mockResolvedValue(false);
      await actions.remotePushProblemAction('./prob');
      expect(steps.stepCreateProblemOnPolygon).not.toHaveBeenCalled();
      expect(steps.stepUploadSolutions).not.toHaveBeenCalled();
    });

    it('should push only checker when checker option set', async () => {
      vi.mocked(steps.stepReadConfig).mockReturnValue({
        problemId: 42,
        name: 'p',
        checker: { name: 'c' },
      } as any);
      await actions.remotePushProblemAction('./prob', { checker: true });
      expect(steps.stepUploadChecker).toHaveBeenCalled();
      expect(steps.stepUploadSolutions).not.toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      vi.mocked(steps.stepReadCredentials).mockImplementation(() => {
        throw new Error('e');
      });
      await actions.remotePushProblemAction('./prob');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('remoteViewProblemAction', () => {
    beforeEach(() => {
      vi.mocked(steps.stepReadCredentials).mockReturnValue({} as any);
      vi.mocked(steps.stepInitializeSDK).mockReturnValue({} as any);
      vi.mocked(steps.stepGetProblemId).mockReturnValue(7 as any);
      vi.mocked(steps.stepFetchProblemInfo).mockResolvedValue({} as any);
      vi.mocked(steps.stepFetchStatements).mockResolvedValue({} as any);
      vi.mocked(steps.stepFetchSolutions).mockResolvedValue([] as any);
      vi.mocked(steps.stepFetchFiles).mockResolvedValue([] as any);
      vi.mocked(steps.stepFetchPackages).mockResolvedValue([] as any);
      vi.mocked(steps.stepFetchChecker).mockResolvedValue({} as any);
      vi.mocked(steps.stepFetchValidator).mockResolvedValue({} as any);
      vi.mocked(steps.stepFetchGenerators).mockReturnValue([] as any);
      vi.mocked(steps.stepFetchSampleTests).mockResolvedValue([] as any);
    });

    it('should view problem details', async () => {
      await actions.remoteViewProblemAction('7');
      expect(steps.stepDisplayProblemView).toHaveBeenCalled();
      expect(formatter.fmt.successBox).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      vi.mocked(steps.stepFetchProblemInfo).mockRejectedValue(
        new Error('not found')
      );
      await actions.remoteViewProblemAction('7');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('remoteCommitProblemAction', () => {
    beforeEach(() => {
      vi.mocked(steps.stepReadCredentials).mockReturnValue({} as any);
      vi.mocked(steps.stepInitializeSDK).mockReturnValue({} as any);
      vi.mocked(steps.stepGetProblemId).mockReturnValue(11 as any);
    });

    it('should commit changes', async () => {
      await actions.remoteCommitProblemAction('./p', 'msg');
      expect(steps.stepCommitChanges).toHaveBeenCalled();
      expect(formatter.fmt.successBox).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      vi.mocked(steps.stepCommitChanges).mockRejectedValue(new Error('fail'));
      await actions.remoteCommitProblemAction('./p', 'msg');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('remotePackageProblemAction', () => {
    beforeEach(() => {
      vi.mocked(steps.stepReadCredentials).mockReturnValue({} as any);
      vi.mocked(steps.stepInitializeSDK).mockReturnValue({} as any);
      vi.mocked(steps.stepGetProblemId).mockReturnValue(13 as any);
    });

    it('should build package successfully', async () => {
      vi.mocked(steps.stepBuildPackage).mockResolvedValue({
        id: 1,
        state: 'READY',
        comment: 'done',
      } as any);
      await actions.remotePackageProblemAction('./p', 'standard');
      expect(steps.stepValidatePackageType).toHaveBeenCalled();
      expect(formatter.fmt.successBox).toHaveBeenCalled();
    });

    it('should report failed package build', async () => {
      vi.mocked(steps.stepBuildPackage).mockResolvedValue({
        id: 2,
        state: 'FAILED',
      } as any);
      await actions.remotePackageProblemAction('./p', 'full');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
    });

    it('should handle errors', async () => {
      vi.mocked(steps.stepValidatePackageType).mockImplementation(() => {
        throw new Error('bad type');
      });
      await actions.remotePackageProblemAction('./p', 'unknown');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });
});
