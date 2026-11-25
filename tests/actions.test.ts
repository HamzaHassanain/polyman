/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as actions from '../src/actions';
import * as steps from '../src/steps';
import * as utils from '../src/helpers/utils';
import { NonInteractiveError } from '../src/helpers/errors';
import { PolymanError, exitCodeFor } from '../src/errors';
import * as formatter from '../src/formatter';
import * as testset from '../src/helpers/testset';
import * as solution from '../src/helpers/solution';
import * as createTemplate from '../src/helpers/create-template';
import * as compileCache from '../src/helpers/compile-cache';
import * as validatorSelfTests from '../src/helpers/validator-selftests';
import { report } from '../src/report';
import type { LocalSolution } from '../src/types';
import fs from 'fs';
import path from 'path';

vi.mock('../src/steps');
vi.mock('../src/helpers/utils');
vi.mock('../src/helpers/testset');
vi.mock('../src/helpers/solution');
vi.mock('../src/helpers/create-template');
vi.mock('../src/helpers/compile-cache');
vi.mock('../src/helpers/validator-selftests');
vi.mock('../src/formatter');
vi.mock('fs');

interface ReportDoc {
  schemaVersion: number;
  polymanVersion: string;
  command: string;
  ok: boolean;
  solution?: string;
  tag?: string | null;
  tests?: unknown[];
  summary?: unknown;
  errors?: string[];
  failedStep?: string | null;
  steps?: { name: string; ok: boolean; errors: string[] }[];
  solutions?: unknown[];
  warnings?: string[];
}

/** Awaits an action that must fail and returns what it threw. */
const failure = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error('expected the action to fail');
    },
    (error: unknown) => error
  );

const writtenJson = (): ReportDoc => {
  const calls = vi.mocked(fs.writeSync).mock.calls;
  expect(calls).toHaveLength(1);
  return JSON.parse(String(calls[0][1])) as ReportDoc;
};

describe('actions.ts', () => {
  afterEach(() => {
    report.reset();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'exit').mockImplementation((() => {}) as any);
    vi.spyOn(process, 'cwd').mockReturnValue('/mock/cwd');
    vi.mocked(utils.isNumeric).mockImplementation((s: string) =>
      /^[0-9]+$/.test(s)
    );
    vi.mocked(utils.isCppSource).mockImplementation((f: string) =>
      /\.(cpp|cc|cxx)$/.test(f)
    );
    vi.mocked(testset.findTestset).mockImplementation(
      (_sets: any, name: string) => ({ name })
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
      expect(() => actions.createTemplateAction('prob')).toThrow('fail');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should handle non-Error throws', () => {
      vi.mocked(steps.stepCreateDirectoryStructure).mockImplementation(() => {
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'string-error';
      });
      expect(() => actions.createTemplateAction('prob')).toThrow(
        'string-error'
      );
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe('listAvailableCheckersAction', () => {
    it('should warn when no checker files found', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([]);
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
        '// Description: number compare\nint main() {}\n'
      );
      actions.listAvailableCheckersAction();
      expect(fs.readFileSync).toHaveBeenCalled();
      expect(formatter.fmt.log).toHaveBeenCalled();
    });

    it('should handle checker file with no description', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue(['x.cpp'] as any);
      vi.mocked(fs.readFileSync).mockReturnValue('int main() {}\n');
      actions.listAvailableCheckersAction();
      expect(formatter.fmt.log).toHaveBeenCalled();
    });

    it('should error when checkers directory missing', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(() => actions.listAvailableCheckersAction()).toThrow();
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
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
      await expect(actions.downloadTestlibAction()).rejects.toThrow('network');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
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
      await expect(actions.generateTestsAction('all')).rejects.toThrow(
        'bad config'
      );
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should rethrow a PolymanError with its code and leave the message to cli.ts', async () => {
      const thrown = new PolymanError('No generator named "gen9"', 2);
      vi.mocked(utils.readConfigFile).mockImplementation(() => {
        throw thrown;
      });
      const error = await failure(actions.generateTestsAction('all'));
      expect(error).toBe(thrown);
      expect(exitCodeFor(error)).toBe(2);
      expect(formatter.fmt.errorBox).toHaveBeenCalledWith(
        'TEST GENERATION FAILED!'
      );
      // cli.ts prints the message once; the action must not print it again
      expect(formatter.fmt.error).not.toHaveBeenCalled();
    });

    it('should not write a report without --json', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      await actions.generateTestsAction('all');
      expect(fs.writeSync).not.toHaveBeenCalled();
      expect(formatter.fmt.setOutput).not.toHaveBeenCalled();
    });

    it('should emit a generate JSON report listing every test with --json', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        testsets: [{ name: 'ts1' }],
      } as any);
      vi.mocked(steps.stepGenerateTestsForTestset).mockImplementationOnce(
        async () => {
          report.recordGeneratedTest({
            testset: 'ts1',
            index: 1,
            source: 'manual',
            ok: true,
          });
          report.recordGeneratedTest({
            testset: 'ts1',
            index: 2,
            source: 'generator',
            generator: 'gen',
            args: ['10'],
            ok: true,
          });
          await Promise.resolve();
        }
      );
      await actions.generateTestsAction('ts1', undefined, { json: true });
      expect(formatter.fmt.setOutput).toHaveBeenCalledWith('stderr');
      expect(writtenJson()).toMatchObject({
        schemaVersion: 1,
        command: 'generate',
        ok: true,
        exitCode: 0,
        errors: [],
        tests: [
          { testset: 'ts1', index: 1, source: 'manual', ok: true },
          {
            testset: 'ts1',
            index: 2,
            source: 'generator',
            generator: 'gen',
            args: ['10'],
            ok: true,
          },
        ],
      });
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should emit a failed generate JSON report with the failed test', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      vi.mocked(steps.stepGenerateAllTestsets).mockImplementationOnce(
        async () => {
          report.recordGeneratedTest({
            testset: 'ts1',
            index: 3,
            source: 'generator',
            generator: 'gen',
            args: [],
            ok: false,
            error: 'generator crashed',
          });
          await Promise.resolve();
          throw new PolymanError('Some tests failed to generate', 1);
        }
      );
      await expect(
        actions.generateTestsAction('all', undefined, { json: true })
      ).rejects.toThrow('Some tests failed to generate');
      expect(writtenJson()).toMatchObject({
        command: 'generate',
        ok: false,
        exitCode: 1,
        errors: ['Some tests failed to generate'],
        tests: [{ index: 3, ok: false, error: 'generator crashed' }],
      });
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should put the PolymanError exit code in the generate JSON report', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      vi.mocked(steps.stepCompileGeneratorsForTestsets).mockRejectedValueOnce(
        new PolymanError('No test generators defined', 2)
      );
      await expect(
        actions.generateTestsAction('all', undefined, { json: true })
      ).rejects.toThrow('No test generators defined');
      expect(writtenJson()).toMatchObject({
        ok: false,
        exitCode: 2,
        errors: ['No test generators defined'],
        tests: [],
      });
      expect(process.exit).not.toHaveBeenCalled();
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
      await expect(actions.validateTestsAction('all')).rejects.toThrow('bad');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should not write a report without --json', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      await actions.validateTestsAction('all');
      expect(fs.writeSync).not.toHaveBeenCalled();
    });

    it('should emit a validate JSON report with valid and invalid tests', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        testsets: [{ name: 'ts1' }],
      } as any);
      vi.mocked(steps.stepValidateGroup).mockImplementationOnce(async () => {
        report.recordValidatedTest({
          testset: 'ts1',
          group: 'samples',
          index: 1,
          valid: true,
          message: '',
        });
        report.recordValidatedTest({
          testset: 'ts1',
          group: 'samples',
          index: 2,
          valid: false,
          message: 'FAIL Integer 0 violates the range [1, 10]',
        });
        await Promise.resolve();
        throw new PolymanError(
          'Some tests in group samples failed validation',
          1
        );
      });
      await expect(
        actions.validateTestsAction('ts1', 'samples', { json: true })
      ).rejects.toThrow('Some tests in group samples failed validation');
      expect(formatter.fmt.setOutput).toHaveBeenCalledWith('stderr');
      expect(writtenJson()).toMatchObject({
        schemaVersion: 1,
        command: 'validate',
        ok: false,
        exitCode: 1,
        errors: ['Some tests in group samples failed validation'],
        tests: [
          {
            testset: 'ts1',
            group: 'samples',
            index: 1,
            valid: true,
            message: '',
          },
          {
            testset: 'ts1',
            group: 'samples',
            index: 2,
            valid: false,
            message: 'FAIL Integer 0 violates the range [1, 10]',
          },
        ],
      });
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should emit an ok validate JSON report on success', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      vi.mocked(steps.stepValidateAllTestsets).mockImplementationOnce(
        async () => {
          report.recordValidatedTest({
            testset: 'ts1',
            index: 1,
            valid: true,
            message: '',
          });
          await Promise.resolve();
        }
      );
      await actions.validateTestsAction('all', undefined, { json: true });
      expect(writtenJson()).toMatchObject({
        command: 'validate',
        ok: true,
        exitCode: 0,
        errors: [],
        tests: [{ testset: 'ts1', index: 1, valid: true, message: '' }],
      });
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should exit with 2 and say so in the report when there is no validator', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      vi.mocked(steps.stepValidateConfigForValidator).mockImplementationOnce(
        () => {
          throw new PolymanError(
            'No validator defined in the configuration file.',
            2
          );
        }
      );
      await expect(
        actions.validateTestsAction('all', undefined, { json: true })
      ).rejects.toThrow('No validator defined in the configuration file.');
      expect(writtenJson()).toMatchObject({
        ok: false,
        exitCode: 2,
        errors: ['No validator defined in the configuration file.'],
      });
      expect(process.exit).not.toHaveBeenCalled();
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
      await expect(actions.runSolutionAction('main', 'all')).rejects.toThrow(
        'boom'
      );
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should not write a report without --json', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue(cfg);
      await actions.runSolutionAction('main', 'all');
      expect(fs.writeSync).not.toHaveBeenCalled();
      expect(formatter.fmt.setOutput).not.toHaveBeenCalled();
    });

    it('should emit a run JSON report on success with --json', async () => {
      const mainSolution: LocalSolution = {
        name: 'main',
        source: 'main.cpp',
        tag: 'MA',
        sourceType: 'cpp.g++17',
      };
      vi.mocked(utils.readConfigFile).mockReturnValue(cfg);
      vi.mocked(steps.stepRunSolutionsOnAllTestsets).mockImplementationOnce(
        async () => {
          report.recordTest(mainSolution, {
            testset: 'ts1',
            index: 1,
            verdict: 'OK',
            timeMs: 7,
            message: '',
          });
          await Promise.resolve();
        }
      );
      await actions.runSolutionAction('main', 'all', undefined, { json: true });
      expect(formatter.fmt.setOutput).toHaveBeenCalledWith('stderr');
      const doc = writtenJson();
      expect(doc).toMatchObject({
        schemaVersion: 1,
        command: 'run',
        ok: true,
        solution: 'main',
        tag: 'MA',
        tests: [
          { testset: 'ts1', index: 1, verdict: 'OK', timeMs: 7, message: '' },
        ],
        summary: { total: 1, byVerdict: { OK: 1 } },
        errors: [],
      });
      expect(typeof doc.polymanVersion).toBe('string');
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should emit a failed run JSON report with the error when a step throws', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue(cfg);
      vi.mocked(steps.stepCompileSolutions).mockRejectedValueOnce(
        new Error('g++ exploded')
      );
      await expect(
        actions.runSolutionAction('main', 'ts1', '4', { json: true })
      ).rejects.toThrow('g++ exploded');
      const doc = writtenJson();
      expect(doc.ok).toBe(false);
      expect(doc.command).toBe('run');
      expect(doc.errors).toContain('g++ exploded');
      expect(doc.tests).toEqual([]);
      expect(process.exit).not.toHaveBeenCalled();
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
      await expect(actions.testWhatAction('validator')).rejects.toThrow('x');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should rethrow a PolymanError with its code and leave the exit to cli.ts', async () => {
      const thrown = new PolymanError('No checker defined', 2);
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      vi.mocked(steps.stepValidateConfigForChecker).mockImplementationOnce(
        () => {
          throw thrown;
        }
      );
      const error = await failure(actions.testWhatAction('checker'));
      expect(error).toBe(thrown);
      expect(exitCodeFor(error)).toBe(2);
      expect(formatter.fmt.error).not.toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should not write a report without --json', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      await actions.testWhatAction('validator');
      expect(fs.writeSync).not.toHaveBeenCalled();
      expect(formatter.fmt.setOutput).not.toHaveBeenCalled();
    });

    it('should emit a self-test report for test validator --json', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      vi.mocked(steps.stepTestValidator).mockImplementationOnce(async () => {
        report.recordSelfTestCase({
          index: 1,
          expected: 'INVALID',
          actual: 'INVALID',
          ok: true,
          message: 'FAIL Expected integer',
        });
        await Promise.resolve();
      });
      await actions.testWhatAction('validator', { json: true });
      expect(formatter.fmt.setOutput).toHaveBeenCalledWith('stderr');
      const doc = writtenJson();
      expect(doc).toMatchObject({
        schemaVersion: 1,
        command: 'test validator',
        ok: true,
        exitCode: 0,
        errors: [],
        target: 'validator',
        cases: [
          {
            index: 1,
            expected: 'INVALID',
            actual: 'INVALID',
            ok: true,
            message: 'FAIL Expected integer',
          },
        ],
      });
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should emit a failed self-test report with the exit code for test checker --json', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      vi.mocked(steps.stepTestChecker).mockImplementationOnce(async () => {
        report.recordSelfTestCase({
          index: 2,
          expected: 'WRONG_ANSWER',
          actual: 'OK',
          ok: false,
          message: 'Expected WRONG_ANSWER but got OK',
        });
        await Promise.resolve();
        throw new PolymanError('Some checker tests failed', 1);
      });
      await expect(
        actions.testWhatAction('checker', { json: true })
      ).rejects.toThrow('Some checker tests failed');
      const doc = writtenJson();
      expect(doc).toMatchObject({
        command: 'test checker',
        ok: false,
        exitCode: 1,
        target: 'checker',
        cases: [
          { index: 2, expected: 'WRONG_ANSWER', actual: 'OK', ok: false },
        ],
      });
      expect(doc.errors).toContain('Some checker tests failed');
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should report exit code 2 in the JSON for a usage error', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      vi.mocked(steps.stepValidateConfigForValidator).mockImplementationOnce(
        () => {
          throw new PolymanError('No validator defined', 2);
        }
      );
      await expect(
        actions.testWhatAction('validator', { json: true })
      ).rejects.toThrow('No validator defined');
      expect(writtenJson()).toMatchObject({
        ok: false,
        exitCode: 2,
        cases: [],
        errors: ['No validator defined'],
      });
      expect(process.exit).not.toHaveBeenCalled();
    });

    describe('test <solution> --json', () => {
      const mainSol: LocalSolution = {
        name: 'main',
        source: 'main.cpp',
        tag: 'MA',
        sourceType: 'cpp.g++17',
      };
      const waSol: LocalSolution = {
        name: 'wa',
        source: 'wa.cpp',
        tag: 'WA',
        sourceType: 'cpp.g++17',
      };

      beforeEach(() => {
        vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
        vi.mocked(steps.stepValidateConfigForSolutionTest).mockReturnValue({
          mainSolution: mainSol,
          targetSolution: waSol,
        });
      });

      it('should report the target tests compared with the main solution', async () => {
        vi.mocked(steps.stepTestSolutionBehavior).mockImplementationOnce(
          async () => {
            report.recordTest(mainSol, {
              testset: 'tests',
              index: 1,
              verdict: 'OK',
              timeMs: 2,
              message: '',
            });
            report.recordTest(waSol, {
              testset: 'tests',
              index: 1,
              verdict: 'OK',
              timeMs: 3,
              message: '',
            });
            report.updateTestVerdict(waSol, 'tests', 1, 'WA', 'wrong 1st');
            await Promise.resolve();
          }
        );
        await actions.testWhatAction('wa', { json: true });
        const doc = writtenJson();
        expect(doc).toMatchObject({
          command: 'test',
          ok: true,
          exitCode: 0,
          solution: 'wa',
          tag: 'WA',
          mainSolution: 'main',
          matchesTag: true,
          reason: 'Behaves as expected',
          tests: [
            {
              testset: 'tests',
              index: 1,
              verdict: 'WA',
              timeMs: 3,
              message: 'wrong 1st',
            },
          ],
          summary: { total: 1, byVerdict: { WA: 1 } },
          errors: [],
        });
        expect(process.exit).not.toHaveBeenCalled();
      });

      it('should report a tag mismatch as matchesTag false and exit 1', async () => {
        vi.mocked(steps.stepTestSolutionBehavior).mockRejectedValueOnce(
          new Error('Solution wa marked as WA but did not get Wrong Answer')
        );
        await expect(
          actions.testWhatAction('wa', { json: true })
        ).rejects.toThrow('did not get Wrong Answer');
        const doc = writtenJson();
        expect(doc).toMatchObject({
          command: 'test',
          ok: false,
          exitCode: 1,
          matchesTag: false,
          reason: 'Solution wa marked as WA but did not get Wrong Answer',
        });
        expect(doc.errors).toContain(
          'Solution wa marked as WA but did not get Wrong Answer'
        );
        expect(process.exit).not.toHaveBeenCalled();
      });

      it('should record a main solution failure as the target not matching its tag (current behaviour)', async () => {
        // stepTestSolutionBehavior raises a plain Error for a main solution
        // failure, with nothing to tell it apart from a target failure, so
        // the target is reported as not matching its tag.
        const mainFailure =
          'Failed to run Main Solution: \n\tmain crashed on test 1';
        vi.mocked(steps.stepTestSolutionBehavior).mockRejectedValueOnce(
          new Error(mainFailure)
        );
        await expect(
          actions.testWhatAction('wa', { json: true })
        ).rejects.toThrow('main crashed on test 1');
        const doc = writtenJson();
        expect(doc).toMatchObject({
          command: 'test',
          ok: false,
          exitCode: 1,
          solution: 'wa',
          mainSolution: 'main',
          matchesTag: false,
          reason: mainFailure,
        });
        expect(doc.errors).toContain(mainFailure);
        expect(process.exit).not.toHaveBeenCalled();
      });

      it('should report an unknown solution before any comparison', async () => {
        vi.mocked(
          steps.stepValidateConfigForSolutionTest
        ).mockImplementationOnce(() => {
          throw new Error('No solution named "nope" found.');
        });
        await expect(
          actions.testWhatAction('nope', { json: true })
        ).rejects.toThrow('No solution named "nope" found.');
        expect(writtenJson()).toMatchObject({
          command: 'test',
          ok: false,
          solution: 'nope',
          mainSolution: null,
          matchesTag: false,
          tests: [],
          errors: ['No solution named "nope" found.'],
        });
      });
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
      await expect(actions.fullVerificationAction()).rejects.toThrow('z');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should stop before running anything when timeLimitMultipliers is invalid', async () => {
      const config = { timeLimitMultipliers: { java: 0 } };
      vi.mocked(utils.readConfigFile).mockReturnValue(config as any);
      vi.mocked(solution.validateTimeLimitMultipliers).mockImplementationOnce(
        () => {
          throw new Error(
            'Invalid timeLimitMultipliers.java in Config.json: 0'
          );
        }
      );
      await expect(actions.fullVerificationAction()).rejects.toThrow(
        'Invalid timeLimitMultipliers.java in Config.json: 0'
      );
      expect(solution.validateTimeLimitMultipliers).toHaveBeenCalledWith(
        config
      );
      expect(steps.stepCompileGeneratorsForTestsets).not.toHaveBeenCalled();
      expect(steps.stepRunSolutionsForVerification).not.toHaveBeenCalled();
      expect(formatter.fmt.successBox).not.toHaveBeenCalled();
      expect(formatter.fmt.errorBox).toHaveBeenCalledWith(
        'VERIFICATION FAILED!'
      );
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should print the compile cache summary on success and failure', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      await actions.fullVerificationAction();
      expect(compileCache.logCacheSummary).toHaveBeenCalledTimes(1);

      vi.mocked(utils.readConfigFile).mockImplementation(() => {
        throw new Error('z');
      });
      await expect(actions.fullVerificationAction()).rejects.toThrow('z');
      expect(compileCache.logCacheSummary).toHaveBeenCalledTimes(2);
    });

    it('should emit a verify JSON report listing every step on success', async () => {
      const main: LocalSolution = {
        name: 'main',
        source: 'main.cpp',
        tag: 'MA',
        sourceType: 'cpp.g++17',
      };
      const wa: LocalSolution = {
        name: 'wa',
        source: 'wa.cpp',
        tag: 'WA',
        sourceType: 'cpp.g++17',
      };
      vi.mocked(utils.readConfigFile).mockReturnValue({
        solutions: [main, wa],
      } as any);
      vi.mocked(steps.stepRunSolutionsForVerification).mockImplementationOnce(
        async () => {
          report.recordTest(main, {
            testset: 'tests',
            index: 1,
            verdict: 'OK',
            timeMs: 2,
            message: '',
          });
          report.setSolutionOutcome(main, true, 'Main solution ran');
          report.recordTest(wa, {
            testset: 'tests',
            index: 1,
            verdict: 'OK',
            timeMs: 3,
            message: '',
          });
          await Promise.resolve();
        }
      );
      vi.mocked(
        steps.stepVerifySolutionsAgainstMainCorrect
      ).mockImplementationOnce(async () => {
        report.updateTestVerdict(wa, 'tests', 1, 'WA', 'expected 1 found 2');
        report.setSolutionOutcome(wa, true, 'Behaves as expected');
        await Promise.resolve();
      });

      await actions.fullVerificationAction({ json: true });

      const doc = writtenJson();
      expect(doc.command).toBe('verify');
      expect(doc.ok).toBe(true);
      expect(doc.failedStep).toBeNull();
      expect(doc.steps!.map(s => s.name)).toEqual([
        'read-config',
        'compile-generators',
        'generate-tests',
        'compile-validator',
        'test-validator',
        'validate-tests',
        'compile-checker',
        'test-checker',
        'compile-solutions',
        'run-solutions',
        'verify-solutions',
      ]);
      expect(doc.steps!.every(s => s.ok)).toBe(true);
      expect(doc.solutions).toEqual([
        {
          name: 'main',
          tag: 'MA',
          matchesTag: true,
          reason: 'Main solution ran',
          tests: [
            {
              testset: 'tests',
              index: 1,
              verdict: 'OK',
              timeMs: 2,
              message: '',
            },
          ],
        },
        {
          name: 'wa',
          tag: 'WA',
          matchesTag: true,
          reason: 'Behaves as expected',
          tests: [
            {
              testset: 'tests',
              index: 1,
              verdict: 'WA',
              timeMs: 3,
              message: 'expected 1 found 2',
            },
          ],
        },
      ]);
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should emit a failed verify JSON report naming the aborting step', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      vi.mocked(steps.stepTestValidator).mockRejectedValueOnce(
        new Error('Some validator tests failed')
      );

      await expect(
        actions.fullVerificationAction({ json: true })
      ).rejects.toThrow('Some validator tests failed');

      const doc = writtenJson();
      expect(doc.ok).toBe(false);
      expect(doc.failedStep).toBe('test-validator');
      expect(doc.steps!.map(s => s.name)).toEqual([
        'read-config',
        'compile-generators',
        'generate-tests',
        'compile-validator',
        'test-validator',
      ]);
      expect(doc.steps![4]).toEqual({
        name: 'test-validator',
        ok: false,
        errors: ['Some validator tests failed'],
      });
      expect(doc.solutions).toEqual([]);
      expect(steps.stepValidateGeneratedTests).not.toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should warn, without failing, when the validator has no INVALID self-tests', async () => {
      const warning = 'the validator has no INVALID self-tests';
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      vi.mocked(validatorSelfTests.validatorSelfTestWarning).mockReturnValue(
        warning
      );

      await actions.fullVerificationAction({ json: true });

      const doc = writtenJson();
      expect(doc.ok).toBe(true);
      expect(doc.failedStep).toBeNull();
      expect(doc.warnings).toEqual([warning]);
      expect(formatter.fmt.warning).toHaveBeenCalledWith(
        expect.stringContaining(warning)
      );
      // once where it is found and once in the closing summary
      const printed = vi
        .mocked(formatter.fmt.warning)
        .mock.calls.filter(([m]) => m.includes(warning));
      expect(printed).toHaveLength(2);
      expect(formatter.fmt.successBox).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should repeat the warning in the summary when verification fails later', async () => {
      const warning = 'the validator has no INVALID self-tests';
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      vi.mocked(validatorSelfTests.validatorSelfTestWarning).mockReturnValue(
        warning
      );
      vi.mocked(steps.stepValidateGeneratedTests).mockRejectedValueOnce(
        new Error('bad test')
      );

      await expect(
        actions.fullVerificationAction({ json: true })
      ).rejects.toThrow('bad test');

      const doc = writtenJson();
      expect(doc.ok).toBe(false);
      expect(doc.warnings).toEqual([warning]);
      const printed = vi
        .mocked(formatter.fmt.warning)
        .mock.calls.filter(([m]) => m.includes(warning));
      expect(printed).toHaveLength(2);
    });

    it('should skip the warning when test-validator itself fails', async () => {
      const warning = 'the validator has no INVALID self-tests';
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      vi.mocked(validatorSelfTests.validatorSelfTestWarning).mockReturnValue(
        warning
      );
      vi.mocked(steps.stepTestValidator).mockRejectedValueOnce(
        new Error('Some validator tests failed')
      );

      await expect(
        actions.fullVerificationAction({ json: true })
      ).rejects.toThrow('Some validator tests failed');

      const doc = writtenJson();
      expect(doc.failedStep).toBe('test-validator');
      expect(doc.warnings).toEqual([]);
      expect(
        validatorSelfTests.validatorSelfTestWarning
      ).not.toHaveBeenCalled();
      const printed = vi
        .mocked(formatter.fmt.warning)
        .mock.calls.filter(([m]) => m.includes(warning));
      expect(printed).toHaveLength(0);
    });

    it('should report no warnings when the validator has INVALID self-tests', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      vi.mocked(validatorSelfTests.validatorSelfTestWarning).mockReturnValue(
        null
      );

      await actions.fullVerificationAction({ json: true });

      const doc = writtenJson();
      expect(doc.warnings).toEqual([]);
      expect(formatter.fmt.warning).not.toHaveBeenCalled();
    });

    it('should stop at read-config when a source file named in Config.json is missing', async () => {
      const config = {
        validator: { name: 'validator', source: 'val.cpp' },
      };
      vi.mocked(utils.readConfigFile).mockReturnValue(config as any);
      vi.mocked(utils.ensureConfigSourcesExist).mockImplementationOnce(() => {
        throw new Error('validator file not found: val.cpp');
      });

      await expect(
        actions.fullVerificationAction({ json: true })
      ).rejects.toThrow('validator file not found: val.cpp');

      expect(utils.ensureConfigSourcesExist).toHaveBeenCalledWith(config);
      const doc = writtenJson();
      expect(doc.ok).toBe(false);
      expect(doc.failedStep).toBe('read-config');
      expect(doc.steps).toEqual([
        {
          name: 'read-config',
          ok: false,
          errors: ['validator file not found: val.cpp'],
        },
      ]);
      expect(steps.stepCompileValidator).not.toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should attribute a Config.json read failure to read-config', async () => {
      vi.mocked(utils.readConfigFile).mockImplementationOnce(() => {
        throw new Error('ENOENT Config.json');
      });
      await expect(
        actions.fullVerificationAction({ json: true })
      ).rejects.toThrow('ENOENT Config.json');
      const doc = writtenJson();
      expect(doc.failedStep).toBe('read-config');
      expect(doc.steps).toEqual([
        { name: 'read-config', ok: false, errors: ['ENOENT Config.json'] },
      ]);
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
      expect(() => actions.listTestsetsAction()).toThrow('q');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
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
      expect(() => actions.listSolutionsAction()).toThrow('p');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe('cacheStatusAction', () => {
    const entry = (source: string, binarySize: number) =>
      ({
        source,
        binarySize,
        compileMs: 2500,
        lastUsedAt: new Date('2026-09-24T10:15:00Z'),
      }) as any;

    it('should report an empty cache', () => {
      vi.mocked(compileCache.listCacheEntries).mockReturnValue([]);
      actions.cacheStatusAction();
      expect(formatter.fmt.info).toHaveBeenCalledWith(
        expect.stringContaining('Cache is empty')
      );
      expect(formatter.fmt.log).not.toHaveBeenCalled();
    });

    it('should list every cached binary', () => {
      vi.mocked(compileCache.listCacheEntries).mockReturnValue([
        entry('solutions/main.cpp', 100),
        entry('generators/gen.cpp', 200),
      ]);
      vi.mocked(compileCache.formatBytes).mockImplementation(n => `${n} B`);
      vi.mocked(compileCache.formatDuration).mockReturnValue('2.5s');
      for (const colour of ['dim', 'highlight', 'primary'] as const) {
        vi.mocked(formatter.fmt[colour]).mockImplementation(t => t);
      }

      actions.cacheStatusAction();

      expect(formatter.fmt.info).toHaveBeenCalledWith(
        expect.stringContaining('cached binaries')
      );
      expect(compileCache.formatBytes).toHaveBeenCalledWith(300);
      expect(formatter.fmt.log).toHaveBeenCalledTimes(2);
      expect(formatter.fmt.log).toHaveBeenCalledWith(
        expect.stringMatching(/last used \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
      );
    });

    it('should show when a binary was last used in local time', () => {
      const originalTz = process.env['TZ'];
      process.env['TZ'] = 'Asia/Kolkata'; // UTC+05:30, no daylight saving
      try {
        vi.mocked(compileCache.listCacheEntries).mockReturnValue([
          entry('solutions/main.cpp', 100),
        ]);
        vi.mocked(formatter.fmt.dim).mockImplementation(t => t);

        actions.cacheStatusAction();

        expect(formatter.fmt.log).toHaveBeenCalledWith(
          expect.stringContaining('last used 2026-09-24 15:45')
        );
      } finally {
        if (originalTz === undefined) delete process.env['TZ'];
        else process.env['TZ'] = originalTz;
      }
    });

    it('should handle errors', () => {
      vi.mocked(compileCache.listCacheEntries).mockImplementation(() => {
        throw new Error('EACCES');
      });
      expect(() => actions.cacheStatusAction()).toThrow('EACCES');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe('cacheClearAction', () => {
    it('should clear the cache and report the count', () => {
      vi.mocked(compileCache.clearCache).mockReturnValue(3);
      actions.cacheClearAction();
      expect(compileCache.clearCache).toHaveBeenCalled();
      expect(formatter.fmt.success).toHaveBeenCalledWith(
        expect.stringContaining('3 entries removed')
      );
    });

    it('should handle errors', () => {
      vi.mocked(compileCache.clearCache).mockImplementation(() => {
        throw new Error('EBUSY');
      });
      expect(() => actions.cacheClearAction()).toThrow('EBUSY');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
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
      expect(() => actions.listGeneratorsAction()).toThrow('e');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
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
      expect(() =>
        actions.registerApiKeyAndSecretAction('apikey', 'secret')
      ).toThrow('write fail');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe('remoteListProblemsAction', () => {
    beforeEach(() => {
      vi.mocked(steps.stepReadCredentials).mockReturnValue({
        apiKey: 'k',
        secret: 's',
      });
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
      await expect(actions.remoteListProblemsAction()).rejects.toThrow(
        'no creds'
      );
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe('remotePullProblemAction', () => {
    beforeEach(() => {
      vi.mocked(steps.stepReadCredentials).mockReturnValue({} as any);
      vi.mocked(steps.stepInitializeSDK).mockReturnValue({} as any);
      vi.mocked(steps.stepGetProblemId).mockReturnValue(123);
      vi.mocked(steps.stepDownloadProblemFilesAndSetUpConfig).mockResolvedValue(
        { warnings: [], failures: [], resources: [] }
      );
    });

    it('should repeat the pull warnings after the success box', async () => {
      vi.mocked(steps.stepDownloadProblemFilesAndSetUpConfig).mockResolvedValue(
        {
          warnings: ['Polygon has no validator set for problem 123'],
          failures: [],
          resources: [],
        }
      );
      await actions.remotePullProblemAction('123', './out', { all: true });
      const warning = vi
        .mocked(formatter.fmt.warning)
        .mock.calls.find(c => String(c[0]).includes('no validator set'));
      expect(warning).toBeDefined();
      expect(
        vi.mocked(formatter.fmt.successBox).mock.invocationCallOrder[0]
      ).toBeLessThan(
        vi.mocked(formatter.fmt.warning).mock.invocationCallOrder[0]
      );
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should not warn when the pull had no warnings', async () => {
      await actions.remotePullProblemAction('123', './out', { all: true });
      expect(formatter.fmt.warning).not.toHaveBeenCalled();
    });

    it('lists the pulled resource files in the summary', async () => {
      vi.mocked(steps.stepDownloadProblemFilesAndSetUpConfig).mockResolvedValue(
        { warnings: [], failures: [], resources: ['testlib.h', 'common.h'] }
      );
      await actions.remotePullProblemAction('123', './out', { all: true });
      const line = vi
        .mocked(formatter.fmt.info)
        .mock.calls.map(c => String(c[0]))
        .find(text => text.includes('Resource files'));
      expect(line).toContain('testlib.h, common.h');
    });

    it('does not print a resource files line when there are none', async () => {
      await actions.remotePullProblemAction('123', './out', { all: true });
      const lines = vi
        .mocked(formatter.fmt.info)
        .mock.calls.map(c => String(c[0]));
      expect(lines.some(text => text.includes('Resource files'))).toBe(false);
    });

    const refusedSolution = {
      component: 'solution',
      name: 'wa',
      error: 'Polygon API Error: no access',
      message:
        'Could not download the solution wa.cpp (Polygon API Error: no access): Config.json does not list it',
    };

    it('should list failed downloads, fail with exit code 4 and skip the success box', async () => {
      vi.mocked(steps.stepDownloadTests).mockResolvedValue(true);
      vi.mocked(steps.stepDownloadProblemFilesAndSetUpConfig).mockResolvedValue(
        { warnings: [], failures: [refusedSolution], resources: [] }
      );
      const error = await failure(
        actions.remotePullProblemAction('123', './out', { all: true })
      );
      expect(error).toBeInstanceOf(PolymanError);
      expect((error as PolymanError).message).toBe(
        'Some files were not downloaded from Polygon'
      );
      expect((error as PolymanError).exitCode).toBe(4);
      expect(formatter.fmt.errorBox).toHaveBeenCalledWith(
        'PULL COMPLETED WITH ERRORS'
      );
      expect(formatter.fmt.errorBox).not.toHaveBeenCalledWith(
        'FAILED TO PULL PROBLEM!'
      );
      expect(formatter.fmt.error).toHaveBeenCalledWith(
        expect.stringContaining(refusedSolution.message)
      );
      expect(formatter.fmt.successBox).not.toHaveBeenCalled();
      // The pull does not stop early: the testsets are still downloaded.
      expect(steps.stepDownloadTests).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should still repeat the placeholder warnings when a download failed', async () => {
      vi.mocked(steps.stepDownloadProblemFilesAndSetUpConfig).mockResolvedValue(
        {
          warnings: ['Polygon has no validator set for problem 123'],
          failures: [refusedSolution],
          resources: [],
        }
      );
      const error = await failure(
        actions.remotePullProblemAction('123', './out', { all: true })
      );
      expect((error as PolymanError).exitCode).toBe(4);
      const warning = vi
        .mocked(formatter.fmt.warning)
        .mock.calls.find(c => String(c[0]).includes('no validator set'));
      expect(warning).toBeDefined();
    });

    it('should pull all by default', async () => {
      vi.mocked(steps.stepDownloadTests).mockResolvedValue(true);
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

    describe('testset summary', () => {
      const infoLines = (): string[] =>
        vi.mocked(formatter.fmt.info).mock.calls.map(c => String(c[0]));

      beforeEach(() => {
        vi.mocked(formatter.fmt.highlight).mockImplementation((s: string) => s);
        vi.mocked(steps.stepDownloadTests).mockResolvedValue(true);
      });

      it('should not claim tests were downloaded when the download failed', async () => {
        vi.mocked(steps.stepDownloadTests).mockResolvedValue(false);
        await actions.remotePullProblemAction('123', './out', {});
        const lines = infoLines();
        expect(lines.some(l => l.includes('Testsets downloaded'))).toBe(false);
        expect(lines.some(l => l.includes('-t a,b'))).toBe(true);
      });

      it('should say which testset was pulled when -t is not given', async () => {
        await actions.remotePullProblemAction('123', './out', {});
        const lines = infoLines();
        expect(lines.some(l => l.includes('Testsets downloaded: tests'))).toBe(
          true
        );
        expect(steps.stepDownloadTests).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.anything(),
          'tests',
          expect.anything()
        );
        expect(lines.some(l => l.includes('-t a,b'))).toBe(true);
      });

      it('should not print the testset summary when -t names testsets', async () => {
        await actions.remotePullProblemAction('123', './out', {
          tests: 'ts1,ts2',
        });
        const lines = infoLines();
        expect(lines.some(l => l.includes('Testsets downloaded'))).toBe(false);
        expect(lines.some(l => l.includes('Other testsets'))).toBe(false);
      });

      it('should not print the testset summary when tests are not pulled', async () => {
        await actions.remotePullProblemAction('123', './out', {
          solutions: true,
        });
        const lines = infoLines();
        expect(lines.some(l => l.includes('Testsets downloaded'))).toBe(false);
        expect(lines.some(l => l.includes('Other testsets'))).toBe(false);
      });

      it('should print the testset summary when --all is set', async () => {
        await actions.remotePullProblemAction('123', './out', { all: true });
        const lines = infoLines();
        expect(lines.some(l => l.includes('Testsets downloaded'))).toBe(true);
        expect(lines.some(l => l.includes('Other testsets'))).toBe(true);
      });

      it('should not print the testset summary when --all is set with -t', async () => {
        await actions.remotePullProblemAction('123', './out', {
          all: true,
          tests: 'a',
        });
        const lines = infoLines();
        expect(lines.some(l => l.includes('Testsets downloaded'))).toBe(false);
        expect(lines.some(l => l.includes('Other testsets'))).toBe(false);
      });

      it('should treat an empty -t as the default testset', async () => {
        await actions.remotePullProblemAction('123', './out', { tests: '' });
        expect(steps.stepDownloadTests).toHaveBeenCalledTimes(1);
        expect(steps.stepDownloadTests).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          expect.anything(),
          'tests',
          expect.anything()
        );
        const lines = infoLines();
        expect(lines.some(l => l.includes('Testsets downloaded'))).toBe(true);
        expect(lines.some(l => l.includes('Other testsets'))).toBe(true);
      });
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
      await expect(
        actions.remotePullProblemAction('123', './out')
      ).rejects.toThrow('e');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe('remotePushProblemAction', () => {
    beforeEach(() => {
      vi.mocked(steps.stepReadCredentials).mockReturnValue({} as any);
      vi.mocked(steps.stepInitializeSDK).mockReturnValue({} as any);
    });

    it('should fail with exit code 2 when the push needs a prompt but stdin is not a terminal', async () => {
      vi.mocked(steps.stepReadConfig).mockReturnValue({ name: 'p' } as any);
      vi.mocked(steps.stepPromptCreateProblem).mockRejectedValue(
        new NonInteractiveError('stdin is not a terminal; pass --yes')
      );
      const error = await failure(actions.remotePushProblemAction('./prob'));
      expect(error).toBeInstanceOf(NonInteractiveError);
      expect((error as Error).message).toContain('pass --yes');
      expect(exitCodeFor(error)).toBe(2);
      expect(formatter.fmt.errorBox).toHaveBeenCalledWith(
        'FAILED TO PUSH PROBLEM!'
      );
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should still fail with exit code 1 for other push errors', async () => {
      vi.mocked(steps.stepReadConfig).mockReturnValue({ name: 'p' } as any);
      vi.mocked(steps.stepPromptCreateProblem).mockRejectedValue(
        new Error('boom')
      );
      const error = await failure(actions.remotePushProblemAction('./prob'));
      expect((error as Error).message).toBe('boom');
      expect(exitCodeFor(error)).toBe(1);
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('should keep the exit code of a PolymanError from a step', async () => {
      vi.mocked(steps.stepReadCredentials).mockImplementation(() => {
        throw new PolymanError('API key not found', 3);
      });
      const error = await failure(actions.remotePushProblemAction('./prob'));
      expect(exitCodeFor(error)).toBe(3);
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

    it('should list failures, fail with exit code 4 and skip the success box when a step fails', async () => {
      vi.mocked(steps.stepReadConfig).mockReturnValue({
        problemId: 42,
        name: 'p',
        solutions: [{ name: 'main' }],
      } as any);
      vi.mocked(steps.stepUploadSolutions).mockImplementationOnce(
        (..._args: unknown[]) => {
          const failures = _args[5] as string[];
          failures.push("solution java-sol: Unknown file type 'java.11'");
          return Promise.resolve();
        }
      );
      const error = await failure(actions.remotePushProblemAction('./prob'));
      expect(error).toBeInstanceOf(PolymanError);
      expect((error as PolymanError).message).toBe(
        'Some items were not uploaded to Polygon'
      );
      expect((error as PolymanError).exitCode).toBe(4);
      expect(formatter.fmt.errorBox).toHaveBeenCalledWith(
        'PUSH COMPLETED WITH ERRORS'
      );
      expect(formatter.fmt.errorBox).not.toHaveBeenCalledWith(
        'FAILED TO PUSH PROBLEM!'
      );
      expect(formatter.fmt.error).toHaveBeenCalledWith(
        expect.stringContaining(
          "solution java-sol: Unknown file type 'java.11'"
        )
      );
      expect(process.exit).not.toHaveBeenCalled();
      expect(formatter.fmt.successBox).not.toHaveBeenCalled();
    });

    const fullConfig = () =>
      ({
        problemId: 42,
        name: 'p',
        solutions: [{ name: 'main' }],
        checker: { name: 'c' },
        validator: { name: 'v' },
        generators: [{ name: 'g' }],
        statements: { name: 's' },
        testsets: [{ name: 'ts' }],
      }) as any;

    const uploadSteps = [
      'stepUploadSolutions',
      'stepUploadChecker',
      'stepUploadValidator',
      'stepUploadGenerators',
      'stepUploadStatements',
      'stepUploadMetadata',
      'stepUploadTestsets',
    ] as const;

    it('should pass the same failures list to every upload step', async () => {
      vi.mocked(steps.stepReadConfig).mockReturnValue(fullConfig());
      await actions.remotePushProblemAction('./prob');
      const lists = uploadSteps.map(name => {
        const args = vi.mocked(steps[name]).mock.calls[0] as unknown[];
        return args[args.length - 1];
      });
      expect(Array.isArray(lists[0])).toBe(true);
      for (const list of lists) expect(list).toBe(lists[0]);
    });

    it.each(uploadSteps.filter(name => name !== 'stepUploadSolutions'))(
      'should list a failure from %s, fail with exit code 4 and skip the success box',
      async name => {
        vi.mocked(steps.stepReadConfig).mockReturnValue(fullConfig());
        vi.mocked(steps[name]).mockImplementationOnce(((...args: unknown[]) => {
          (args[args.length - 1] as string[]).push(`${name}: boom`);
          return Promise.resolve(1);
        }) as any);
        const error = await failure(actions.remotePushProblemAction('./prob'));
        expect(exitCodeFor(error)).toBe(4);
        expect(formatter.fmt.errorBox).toHaveBeenCalledWith(
          'PUSH COMPLETED WITH ERRORS'
        );
        expect(formatter.fmt.error).toHaveBeenCalledWith(
          expect.stringContaining(`${name}: boom`)
        );
        expect(process.exit).not.toHaveBeenCalled();
        expect(formatter.fmt.successBox).not.toHaveBeenCalled();
      }
    );

    it('should print the success box and not exit when nothing failed', async () => {
      vi.mocked(steps.stepReadConfig).mockReturnValue({
        problemId: 42,
        name: 'p',
        solutions: [{ name: 'main' }],
      } as any);
      vi.mocked(steps.stepUploadSolutions).mockResolvedValue(undefined);
      await actions.remotePushProblemAction('./prob');
      expect(formatter.fmt.successBox).toHaveBeenCalledWith(
        'PROBLEM PUSHED SUCCESSFULLY!'
      );
      expect(process.exit).not.toHaveBeenCalled();
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

    it('should forward --yes and --name to the creation steps', async () => {
      vi.mocked(steps.stepReadConfig).mockReturnValue({
        name: 'from-config',
      } as any);
      vi.mocked(steps.stepPromptCreateProblem).mockResolvedValue(true);
      vi.mocked(steps.stepGetValidProblemName).mockResolvedValue('two-sum');
      vi.mocked(steps.stepCreateProblemOnPolygon).mockResolvedValue(5);
      await actions.remotePushProblemAction('./prob', {
        yes: true,
        name: 'two-sum',
      });
      expect(steps.stepPromptCreateProblem).toHaveBeenCalledWith(
        expect.any(Number),
        { yes: true }
      );
      expect(steps.stepGetValidProblemName).toHaveBeenCalledWith(
        expect.any(Number),
        expect.anything(),
        'from-config',
        { explicitName: 'two-sum' }
      );
      expect(steps.stepCreateProblemOnPolygon).toHaveBeenCalledWith(
        expect.any(Number),
        expect.anything(),
        'two-sum'
      );
    });

    it('should not prompt at all when Config.json already has a problemId', async () => {
      vi.mocked(steps.stepReadConfig).mockReturnValue({
        problemId: 42,
        name: 'p',
      } as any);
      await actions.remotePushProblemAction('./prob', { yes: true });
      expect(steps.stepPromptCreateProblem).not.toHaveBeenCalled();
      expect(steps.stepGetValidProblemName).not.toHaveBeenCalled();
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
      await expect(actions.remotePushProblemAction('./prob')).rejects.toThrow(
        'e'
      );
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe('remoteViewProblemAction', () => {
    beforeEach(() => {
      vi.mocked(steps.stepReadCredentials).mockReturnValue({} as any);
      vi.mocked(steps.stepInitializeSDK).mockReturnValue({} as any);
      vi.mocked(steps.stepGetProblemId).mockReturnValue(7);
      vi.mocked(steps.stepFetchProblemInfo).mockResolvedValue({} as any);
      vi.mocked(steps.stepFetchStatements).mockResolvedValue({} as any);
      vi.mocked(steps.stepFetchSolutions).mockResolvedValue([]);
      vi.mocked(steps.stepFetchFiles).mockResolvedValue([] as any);
      vi.mocked(steps.stepFetchPackages).mockResolvedValue([]);
      vi.mocked(steps.stepFetchChecker).mockResolvedValue({} as any);
      vi.mocked(steps.stepFetchValidator).mockResolvedValue({} as any);
      vi.mocked(steps.stepFetchGenerators).mockReturnValue([]);
      vi.mocked(steps.stepFetchSampleTests).mockResolvedValue([]);
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
      await expect(actions.remoteViewProblemAction('7')).rejects.toThrow(
        'not found'
      );
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe('remoteCommitProblemAction', () => {
    beforeEach(() => {
      vi.mocked(steps.stepReadCredentials).mockReturnValue({} as any);
      vi.mocked(steps.stepInitializeSDK).mockReturnValue({} as any);
      vi.mocked(steps.stepGetProblemId).mockReturnValue(11);
    });

    it('should commit changes', async () => {
      await actions.remoteCommitProblemAction('./p', 'msg');
      expect(steps.stepCommitChanges).toHaveBeenCalled();
      expect(formatter.fmt.successBox).toHaveBeenCalled();
    });

    it('should forward minorChanges to stepCommitChanges', async () => {
      await actions.remoteCommitProblemAction('./p', 'msg', {
        minorChanges: true,
      });
      expect(steps.stepCommitChanges).toHaveBeenCalledWith(
        expect.any(Number),
        expect.anything(),
        11,
        'msg',
        true
      );
    });

    it('should handle errors', async () => {
      vi.mocked(steps.stepCommitChanges).mockRejectedValue(new Error('fail'));
      await expect(
        actions.remoteCommitProblemAction('./p', 'msg')
      ).rejects.toThrow('fail');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe('remotePackageProblemAction', () => {
    beforeEach(() => {
      vi.mocked(steps.stepReadCredentials).mockReturnValue({} as any);
      vi.mocked(steps.stepInitializeSDK).mockReturnValue({} as any);
      vi.mocked(steps.stepGetProblemId).mockReturnValue(13);
    });

    it('should build package successfully', async () => {
      vi.mocked(steps.stepBuildPackage).mockResolvedValue({
        id: 1,
        state: 'READY',
        comment: 'done',
      });
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
      await expect(
        actions.remotePackageProblemAction('./p', 'unknown')
      ).rejects.toThrow('bad type');
      expect(formatter.fmt.errorBox).toHaveBeenCalled();
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe('--json for new, download-testlib and list', () => {
    const doc = (): Record<string, unknown> =>
      writtenJson() as unknown as Record<string, unknown>;

    beforeEach(() => {
      vi.mocked(steps.stepCreateDirectoryStructure).mockReset();
      vi.mocked(steps.stepDownloadTestlib).mockReset();
      vi.mocked(utils.readConfigFile).mockReset();
    });

    it('new --json reports the created path and never prompts', () => {
      actions.createTemplateAction('prob', { json: true });
      expect(formatter.fmt.setOutput).toHaveBeenCalledWith('stderr');
      expect(doc()).toMatchObject({
        schemaVersion: 1,
        command: 'new',
        ok: true,
        exitCode: 0,
        path: path.resolve('/mock/cwd', 'prob'),
        errors: [],
      });
      expect(typeof doc()['durationMs']).toBe('number');
      expect(steps.stepPromptCreateProblem).not.toHaveBeenCalled();
    });

    it('new --json reports a failure with a message', () => {
      vi.mocked(steps.stepCreateDirectoryStructure).mockImplementation(() => {
        throw new Error('EEXIST');
      });
      expect(() =>
        actions.createTemplateAction('prob', { json: true })
      ).toThrow('EEXIST');
      report.finish(false);
      expect(doc()).toMatchObject({
        command: 'new',
        ok: false,
        exitCode: 1,
        errors: ['EEXIST'],
      });
      expect(process.exit).not.toHaveBeenCalled();
    });

    it('new without --json writes no report', () => {
      actions.createTemplateAction('prob');
      expect(fs.writeSync).not.toHaveBeenCalled();
    });

    it('download-testlib --json reports the path of testlib.h', async () => {
      vi.mocked(steps.stepDownloadTestlib).mockResolvedValue('code');
      await actions.downloadTestlibAction({ json: true });
      expect(doc()).toMatchObject({
        command: 'download-testlib',
        ok: true,
        exitCode: 0,
        path: path.join('/mock/cwd', 'testlib.h'),
      });
    });

    it('download-testlib --json reports a failure', async () => {
      vi.mocked(steps.stepDownloadTestlib).mockRejectedValue(
        new Error('network')
      );
      await expect(
        actions.downloadTestlibAction({ json: true })
      ).rejects.toThrow('network');
      expect(doc()).toMatchObject({
        command: 'download-testlib',
        ok: false,
        exitCode: 1,
        errors: ['network'],
      });
    });

    it('list checkers --json returns name and description', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        'ncmp.cpp',
        'testlib.h',
      ] as any);
      vi.mocked(fs.readFileSync).mockReturnValue(
        '// Description: number compare\nint main() {}\n'
      );
      actions.listAvailableCheckersAction({ json: true });
      expect(doc()).toMatchObject({
        command: 'list checkers',
        ok: true,
        exitCode: 0,
        items: [{ name: 'ncmp.cpp', description: 'number compare' }],
      });
    });

    it('list checkers --json gives an empty list when none found', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([]);
      actions.listAvailableCheckersAction({ json: true });
      expect(doc()).toMatchObject({ ok: true, items: [] });
    });

    it('list checkers --json reports a missing directory', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(() =>
        actions.listAvailableCheckersAction({ json: true })
      ).toThrow();
      expect(doc()).toMatchObject({
        ok: false,
        exitCode: 1,
        errors: ['Checkers directory not found'],
      });
    });

    it('list testsets --json returns name, tests and groups', () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        testsets: [{ name: 'ts1' }],
      } as any);
      vi.mocked(testset.listTestsets).mockReturnValue(['ts1: 3 tests']);
      vi.mocked(testset.describeTestsets).mockReturnValue([
        { name: 'ts1', tests: 3, groups: ['samples'] },
      ]);
      actions.listTestsetsAction({ json: true });
      expect(doc()).toMatchObject({
        command: 'list testsets',
        ok: true,
        items: [{ name: 'ts1', tests: 3, groups: ['samples'] }],
      });
    });

    it('list testsets --json fails without a readable Config.json', () => {
      vi.mocked(utils.readConfigFile).mockImplementation(() => {
        throw new Error('no Config.json');
      });
      expect(() => actions.listTestsetsAction({ json: true })).toThrow(
        'no Config.json'
      );
      expect(doc()).toMatchObject({
        command: 'list testsets',
        ok: false,
        exitCode: 1,
        errors: ['no Config.json'],
      });
    });

    it('list solutions --json returns name, source and tag', () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        solutions: [{ name: 'main', source: 'sol/main.cpp', tag: 'MA' }],
      } as any);
      actions.listSolutionsAction({ json: true });
      expect(doc()).toMatchObject({
        command: 'list solutions',
        ok: true,
        items: [{ name: 'main', source: 'sol/main.cpp', tag: 'MA' }],
      });
    });

    it('list solutions --json gives an empty list for no solutions', () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({ solutions: [] } as any);
      actions.listSolutionsAction({ json: true });
      expect(doc()).toMatchObject({ ok: true, exitCode: 0, items: [] });
    });

    it('list solutions --json fails without a readable Config.json', () => {
      vi.mocked(utils.readConfigFile).mockImplementation(() => {
        throw new Error('no Config.json');
      });
      expect(() => actions.listSolutionsAction({ json: true })).toThrow(
        'no Config.json'
      );
      expect(doc()).toMatchObject({ ok: false, exitCode: 1 });
      expect(doc()['errors']).toEqual(['no Config.json']);
    });

    it('list generators --json returns name and source', () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        generators: [{ name: 'gen', source: 'gen/gen.cpp' }],
      } as any);
      actions.listGeneratorsAction({ json: true });
      expect(doc()).toMatchObject({
        command: 'list generators',
        ok: true,
        items: [{ name: 'gen', source: 'gen/gen.cpp' }],
      });
    });

    it('list generators --json gives an empty list for no generators', () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      actions.listGeneratorsAction({ json: true });
      expect(doc()).toMatchObject({ ok: true, items: [] });
    });

    it('list generators --json fails without a readable Config.json', () => {
      vi.mocked(utils.readConfigFile).mockImplementation(() => {
        throw new Error('no Config.json');
      });
      expect(() => actions.listGeneratorsAction({ json: true })).toThrow(
        'no Config.json'
      );
      expect(doc()).toMatchObject({ ok: false, exitCode: 1 });
      expect(doc()['errors']).toEqual(['no Config.json']);
    });

    it('list solutions --json reports the exit code of a PolymanError', () => {
      vi.mocked(utils.readConfigFile).mockImplementation(() => {
        throw new PolymanError('Unexpected token in Config.json', 2);
      });
      expect(() => actions.listSolutionsAction({ json: true })).toThrow(
        'Unexpected token in Config.json'
      );
      expect(doc()).toMatchObject({ ok: false, exitCode: 2 });
    });

    it('download-testlib --json reports exit code 4 for a network failure', async () => {
      vi.mocked(steps.stepDownloadTestlib).mockRejectedValue(
        new PolymanError('Download failed: ECONNRESET', 4)
      );
      const error = await failure(
        actions.downloadTestlibAction({ json: true })
      );
      expect(exitCodeFor(error)).toBe(4);
      expect(doc()).toMatchObject({ ok: false, exitCode: 4 });
    });

    it('download-testlib --json reports exit code 2 when it keeps an existing testlib.h', async () => {
      vi.mocked(steps.stepDownloadTestlib).mockResolvedValue('code');
      vi.mocked(steps.stepSaveTestlibToDirectory).mockImplementationOnce(() => {
        throw new PolymanError('testlib.h was not replaced', 2);
      });
      const error = await failure(
        actions.downloadTestlibAction({ json: true })
      );
      expect(exitCodeFor(error)).toBe(2);
      expect(doc()).toMatchObject({
        ok: false,
        exitCode: 2,
        errors: ['testlib.h was not replaced'],
      });
      expect(formatter.fmt.successBox).not.toHaveBeenCalled();
    });

    it('list without --json writes no report', () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({ solutions: [] } as any);
      actions.listSolutionsAction();
      expect(fs.writeSync).not.toHaveBeenCalled();
    });
  });
});
