import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MockedFunction } from 'vitest';
import * as pulling from '../../../src/helpers/remote/pulling';
import fs from 'fs';
import type { PolygonSDK } from '../../../src/polygon';
import type { StatementConfig } from '../../../src/types';

vi.mock('fs');
vi.mock('../../../src/formatter', () => ({
  fmt: {
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    cross: vi.fn().mockReturnValue('X'),
  },
}));
vi.mock('../../../src/helpers/remote/utils', () => ({
  normalizeLineEndingsFromRemoteToSystem: vi.fn((content: string) => content),
}));

/**
 * Subset of {@link PolygonSDK} actually exercised by these tests, with each
 * method typed as a vitest mock so `.mockResolvedValue` etc. are available.
 */
type MockedSdkMethods =
  | 'getSolutions'
  | 'getFiles'
  | 'getChecker'
  | 'getValidator'
  | 'getStatements'
  | 'getTests'
  | 'getScript'
  | 'getProblemInfo'
  | 'viewSolution'
  | 'viewFile'
  | 'viewGeneralDescription'
  | 'viewTags'
  | 'getCheckerTests'
  | 'getValidatorTests';

type MockSdk = {
  [K in MockedSdkMethods]: MockedFunction<PolygonSDK[K]>;
};

function createMockSdk(): MockSdk {
  return {
    getSolutions: vi.fn(),
    getFiles: vi.fn(),
    getChecker: vi.fn(),
    getValidator: vi.fn(),
    getStatements: vi.fn(),
    getTests: vi.fn(),
    getScript: vi.fn(),
    getProblemInfo: vi.fn(),
    viewSolution: vi.fn(),
    viewFile: vi.fn(),
    viewGeneralDescription: vi.fn(),
    viewTags: vi.fn(),
    getCheckerTests: vi.fn(),
    getValidatorTests: vi.fn(),
  } as MockSdk;
}

/** Cast a partial mock SDK to the full {@link PolygonSDK} shape via `unknown`. */
function asSdk(sdk: MockSdk): PolygonSDK {
  return sdk as unknown as PolygonSDK;
}

describe('pulling.ts', () => {
  let mockSdk: MockSdk;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.writeFileSync).mockImplementation(() => undefined);
    // fs.mkdirSync is overloaded; cast through unknown to satisfy vitest's
    // generic without using `any`.
    (
      vi.mocked(fs.mkdirSync) as unknown as MockedFunction<() => undefined>
    ).mockImplementation(() => undefined);
    vi.mocked(fs.existsSync).mockReturnValue(false);
    mockSdk = createMockSdk();
  });

  describe('downloadSolutions', () => {
    it('should download solutions successfully', async () => {
      mockSdk.getSolutions.mockResolvedValue([
        {
          name: 'sol.cpp',
          modificationTimeSeconds: 0,
          length: 0,
          sourceType: 'cpp.g++17',
          tag: 'MA',
        },
      ]);
      mockSdk.viewSolution.mockResolvedValue('code');

      const result = await pulling.downloadSolutions(asSdk(mockSdk), 1, 'dir');

      expect(mockSdk.getSolutions).toHaveBeenCalledWith(1);
      expect(result.count).toBe(1);
      expect(result.data[0].name).toBe('sol');
      expect(result.data[0].source).toBe('./solutions/sol.cpp');
      expect(result.data[0].tag).toBe('MA');
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('should download multiple solutions and skip ones that fail viewSolution', async () => {
      mockSdk.getSolutions.mockResolvedValue([
        {
          name: 'a.cpp',
          modificationTimeSeconds: 0,
          length: 0,
          sourceType: 'cpp.g++17',
          tag: 'MA',
        },
        {
          name: 'b.cpp',
          modificationTimeSeconds: 0,
          length: 0,
          sourceType: 'cpp.g++17',
          tag: 'OK',
        },
        {
          name: 'c.cpp',
          modificationTimeSeconds: 0,
          length: 0,
          sourceType: 'cpp.g++17',
          tag: 'WA',
        },
      ]);
      mockSdk.viewSolution.mockImplementation((_id: number, name: string) => {
        if (name === 'b.cpp') return Promise.reject(new Error('boom'));
        return Promise.resolve('code');
      });

      const result = await pulling.downloadSolutions(asSdk(mockSdk), 1, 'dir');

      expect(result.count).toBe(2);
      expect(result.data).toHaveLength(2);
      expect(result.data.map(s => s.name)).toEqual(['a', 'c']);
    });

    it('should return default acc.cpp when getSolutions fails', async () => {
      mockSdk.getSolutions.mockRejectedValue(new Error('network'));

      const result = await pulling.downloadSolutions(asSdk(mockSdk), 1, 'dir');

      expect(result.count).toBe(0);
      expect(result.data).toEqual([
        { name: 'main', source: 'acc.cpp', tag: 'MA' },
      ]);
    });

    it('should return default acc.cpp when no solutions returned', async () => {
      mockSdk.getSolutions.mockResolvedValue([]);

      const result = await pulling.downloadSolutions(asSdk(mockSdk), 1, 'dir');

      expect(result.count).toBe(0);
      expect(result.data[0].name).toBe('main');
      expect(result.data[0].tag).toBe('MA');
    });

    it('should return default acc.cpp when all viewSolution calls fail', async () => {
      mockSdk.getSolutions.mockResolvedValue([
        {
          name: 'a.cpp',
          modificationTimeSeconds: 0,
          length: 0,
          sourceType: 'cpp.g++17',
          tag: 'OK',
        },
      ]);
      mockSdk.viewSolution.mockRejectedValue(new Error('fail'));

      const result = await pulling.downloadSolutions(asSdk(mockSdk), 1, 'dir');

      expect(result.count).toBe(0);
      expect(result.data[0].source).toBe('acc.cpp');
    });
  });

  describe('downloadChecker', () => {
    it('should download a custom checker with tests successfully', async () => {
      mockSdk.getChecker.mockResolvedValue('checker.cpp');
      mockSdk.viewFile.mockResolvedValue('code');
      mockSdk.getCheckerTests.mockResolvedValue([
        {
          index: 1,
          input: 'a',
          output: 'b',
          answer: 'c',
          expectedVerdict: 'OK',
        },
      ]);

      const result = await pulling.downloadChecker(asSdk(mockSdk), 1, 'dir');

      expect(mockSdk.getChecker).toHaveBeenCalledWith(1);
      expect(result.data.isStandard).toBe(false);
      expect(result.data.name).toBe('checker');
      expect(result.data.source).toBe('./checker/checker.cpp');
      expect(result.data.testsFilePath).toBe('./checker/checker_tests.json');
      expect(result.count).toBe(2);
      expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
    });

    it('should handle standard checker (std::ncmp.cpp) without writing files', async () => {
      mockSdk.getChecker.mockResolvedValue('std::ncmp.cpp');

      const result = await pulling.downloadChecker(asSdk(mockSdk), 1, 'dir');

      expect(result.data.isStandard).toBe(true);
      expect(result.data.name).toBe('ncmp');
      expect(result.data.source).toBe('ncmp.cpp');
      expect(result.data.testsFilePath).toBeUndefined();
      expect(result.count).toBe(0);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should download custom checker but warn when checker tests fail', async () => {
      mockSdk.getChecker.mockResolvedValue('checker.cpp');
      mockSdk.viewFile.mockResolvedValue('code');
      mockSdk.getCheckerTests.mockRejectedValue(new Error('no tests'));

      const result = await pulling.downloadChecker(asSdk(mockSdk), 1, 'dir');

      expect(result.count).toBe(1);
      expect(result.data.isStandard).toBe(false);
    });

    it('should normalize tests with missing fields', async () => {
      mockSdk.getChecker.mockResolvedValue('checker.cpp');
      mockSdk.viewFile.mockResolvedValue('code');
      mockSdk.getCheckerTests.mockResolvedValue([
        // The runtime data may legitimately omit fields the type marks
        // required; cast through unknown to model that without `any`.
        { index: 1 } as unknown as import('../../../src/types').CheckerTest,
        {
          index: 2,
          input: 'i',
        } as unknown as import('../../../src/types').CheckerTest,
      ]);

      const result = await pulling.downloadChecker(asSdk(mockSdk), 1, 'dir');

      expect(result.count).toBe(2);
      const writes = vi.mocked(fs.writeFileSync).mock.calls;
      const testWrite = writes.find(c =>
        String(c[0]).includes('checker_tests.json')
      );
      expect(testWrite).toBeDefined();
    });

    it('should return default ncmp when getChecker fails', async () => {
      mockSdk.getChecker.mockRejectedValue(new Error('boom'));

      const result = await pulling.downloadChecker(asSdk(mockSdk), 1, 'dir');

      expect(result.data).toEqual({
        name: 'ncmp',
        source: 'ncmp.cpp',
        isStandard: true,
      });
      expect(result.count).toBe(0);
    });
  });

  describe('downloadValidator', () => {
    it('should download validator with tests successfully', async () => {
      mockSdk.getValidator.mockResolvedValue('validator.cpp');
      mockSdk.viewFile.mockResolvedValue('code');
      mockSdk.getValidatorTests.mockResolvedValue([
        { index: 1, input: 'data', expectedVerdict: 'VALID' },
      ]);

      const result = await pulling.downloadValidator(asSdk(mockSdk), 1, 'dir');

      expect(mockSdk.getValidator).toHaveBeenCalledWith(1);
      expect(result.data.name).toBe('validator');
      expect(result.data.source).toBe('./validator/validator.cpp');
      expect(result.data.testsFilePath).toBe(
        './validator/validator_tests.json'
      );
      expect(result.count).toBe(2);
      expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
    });

    it('should download validator but warn when validator tests fail', async () => {
      mockSdk.getValidator.mockResolvedValue('validator.cpp');
      mockSdk.viewFile.mockResolvedValue('code');
      mockSdk.getValidatorTests.mockRejectedValue(new Error('no tests'));

      const result = await pulling.downloadValidator(asSdk(mockSdk), 1, 'dir');

      expect(result.count).toBe(1);
      expect(result.data.testsFilePath).toBe(
        './validator/validator_tests.json'
      );
    });

    it('should normalize validator tests with missing input', async () => {
      mockSdk.getValidator.mockResolvedValue('validator.cpp');
      mockSdk.viewFile.mockResolvedValue('code');
      mockSdk.getValidatorTests.mockResolvedValue([
        {
          index: 1,
        } as unknown as import('../../../src/types').ValidatorTest,
      ]);

      const result = await pulling.downloadValidator(asSdk(mockSdk), 1, 'dir');
      expect(result.count).toBe(2);
    });

    it('should return default val.cpp when getValidator fails', async () => {
      mockSdk.getValidator.mockRejectedValue(new Error('boom'));

      const result = await pulling.downloadValidator(asSdk(mockSdk), 1, 'dir');

      expect(result.data).toEqual({ name: 'validator', source: 'val.cpp' });
      expect(result.count).toBe(0);
    });

    it('should return default val.cpp when viewFile fails', async () => {
      mockSdk.getValidator.mockResolvedValue('validator.cpp');
      mockSdk.viewFile.mockRejectedValue(new Error('view fail'));

      const result = await pulling.downloadValidator(asSdk(mockSdk), 1, 'dir');

      expect(result.data.source).toBe('val.cpp');
      expect(result.count).toBe(0);
    });
  });

  describe('downloadGenerators', () => {
    it('should download generator files and skip checker/validator/solutions', async () => {
      mockSdk.getFiles.mockResolvedValue({
        sourceFiles: [
          {
            name: 'gen.cpp',
            modificationTimeSeconds: 0,
            length: 0,
            sourceType: 'cpp.g++17',
          },
          {
            name: 'check.cpp',
            modificationTimeSeconds: 0,
            length: 0,
            sourceType: 'checker',
          },
          {
            name: 'val.cpp',
            modificationTimeSeconds: 0,
            length: 0,
            sourceType: 'validator',
          },
          {
            name: 'sol.cpp',
            modificationTimeSeconds: 0,
            length: 0,
            sourceType: 'solution.cpp',
          },
          {
            name: 'validator.cpp',
            modificationTimeSeconds: 0,
            length: 0,
            sourceType: 'cpp.g++17',
          },
        ],
        resourceFiles: [],
        auxFiles: [],
      });
      mockSdk.viewFile.mockResolvedValue('code');

      const result = await pulling.downloadGenerators(
        asSdk(mockSdk),
        1,
        'dir',
        'validator'
      );

      expect(result.count).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('gen');
      expect(result.data[0].source).toBe('./generators/gen.cpp');
    });

    it('should warn but continue when individual viewFile fails', async () => {
      mockSdk.getFiles.mockResolvedValue({
        sourceFiles: [
          { name: 'gen1.cpp', modificationTimeSeconds: 0, length: 0 },
          { name: 'gen2.cpp', modificationTimeSeconds: 0, length: 0 },
          { name: 'gen3.cpp', modificationTimeSeconds: 0, length: 0 },
        ],
        resourceFiles: [],
        auxFiles: [],
      });
      mockSdk.viewFile.mockImplementation(
        (_id: number, _t: string, n: string) => {
          if (n === 'gen2.cpp') return Promise.reject(new Error('fail'));
          return Promise.resolve('code');
        }
      );

      const result = await pulling.downloadGenerators(
        asSdk(mockSdk),
        1,
        'dir',
        'val'
      );

      expect(result.count).toBe(2);
      expect(result.data.map(g => g.name)).toEqual(['gen1', 'gen3']);
    });

    it('should return empty data when getFiles fails', async () => {
      mockSdk.getFiles.mockRejectedValue(new Error('boom'));

      const result = await pulling.downloadGenerators(
        asSdk(mockSdk),
        1,
        'dir',
        'val'
      );

      expect(result.count).toBe(0);
      expect(result.data).toEqual([]);
    });

    it('should return empty data when no source files', async () => {
      mockSdk.getFiles.mockResolvedValue({
        sourceFiles: [],
        resourceFiles: [],
        auxFiles: [],
      });

      const result = await pulling.downloadGenerators(
        asSdk(mockSdk),
        1,
        'dir',
        'val'
      );

      expect(result.count).toBe(0);
      expect(result.data).toEqual([]);
    });

    it('should handle files without sourceType safely', async () => {
      mockSdk.getFiles.mockResolvedValue({
        sourceFiles: [
          { name: 'mystery.cpp', modificationTimeSeconds: 0, length: 0 },
        ],
        resourceFiles: [],
        auxFiles: [],
      });
      mockSdk.viewFile.mockResolvedValue('code');

      const result = await pulling.downloadGenerators(
        asSdk(mockSdk),
        1,
        'dir',
        'val'
      );
      expect(result.count).toBe(1);
      expect(result.data[0].name).toBe('mystery');
    });
  });

  describe('downloadStatements', () => {
    it('should download all statement components for one language', async () => {
      mockSdk.getStatements.mockResolvedValue({
        english: {
          encoding: 'UTF-8',
          name: 'My Problem',
          legend: 'legend body',
          input: 'input body',
          output: 'output body',
          notes: 'notes body',
          tutorial: 'tut body',
          interaction: 'inter body',
          scoring: 'score body',
        },
      });

      const result = await pulling.downloadStatements(asSdk(mockSdk), 1, 'dir');

      expect(result.problemName).toBe('My Problem');
      expect(result.count).toBe(7);
      expect(result.config.english).toBeDefined();
      const cfg: StatementConfig = result.config.english;
      expect(cfg.encoding).toBe('UTF-8');
      expect(cfg.name).toBe('My Problem');
      expect(cfg.legend).toBe('./statements/english/legend.tex');
      expect(cfg.input).toBe('./statements/english/input-format.tex');
      expect(cfg.output).toBe('./statements/english/output-format.tex');
      expect(cfg.notes).toBe('./statements/english/notes.tex');
      expect(cfg.tutorial).toBe('./statements/english/tutorial.tex');
      expect(cfg.interaction).toBe('./statements/english/interaction.tex');
      expect(cfg.scoring).toBe('./statements/english/scoring.tex');
      expect(fs.mkdirSync).toHaveBeenCalled();
    });

    it('should not create dir if it already exists', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockSdk.getStatements.mockResolvedValue({
        english: {
          encoding: 'UTF-8',
          name: 'P',
          legend: 'l',
          input: '',
          output: '',
        },
      });

      await pulling.downloadStatements(asSdk(mockSdk), 1, 'dir');

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it('should default encoding and name when missing', async () => {
      mockSdk.getStatements.mockResolvedValue({
        // Polygon may return partial statements; cast through unknown
        // to model that without `any`.
        russian: {
          legend: 'rus legend',
        } as unknown as import('../../../src/types').Statement,
      });

      const result = await pulling.downloadStatements(asSdk(mockSdk), 1, 'dir');

      const cfg: StatementConfig = result.config.russian;
      expect(cfg.encoding).toBe('UTF-8');
      expect(cfg.name).toBe('problem');
      expect(result.problemName).toBe('problem');
      expect(result.count).toBe(1);
    });

    it('should skip components that are absent', async () => {
      mockSdk.getStatements.mockResolvedValue({
        english: {
          encoding: 'UTF-8',
          name: 'X',
          legend: 'l',
          input: '',
          output: '',
        },
      });

      const result = await pulling.downloadStatements(asSdk(mockSdk), 1, 'dir');
      const cfg: StatementConfig = result.config.english;
      expect(cfg.legend).toBeDefined();
      expect(cfg.input).toBeUndefined();
      expect(cfg.output).toBeUndefined();
      expect(cfg.notes).toBeUndefined();
      expect(result.count).toBe(1);
    });

    it('should handle multiple languages', async () => {
      mockSdk.getStatements.mockResolvedValue({
        english: {
          encoding: 'UTF-8',
          name: 'En',
          legend: 'l1',
          input: '',
          output: '',
        },
        russian: {
          encoding: 'UTF-8',
          name: 'Ru',
          legend: 'l2',
          input: '',
          output: '',
        },
      });

      const result = await pulling.downloadStatements(asSdk(mockSdk), 1, 'dir');

      expect(Object.keys(result.config)).toEqual(['english', 'russian']);
      expect(result.count).toBe(2);
      expect(result.problemName).toBe('En');
    });

    it('should return empty config when getStatements fails', async () => {
      mockSdk.getStatements.mockRejectedValue(new Error('boom'));

      const result = await pulling.downloadStatements(asSdk(mockSdk), 1, 'dir');

      expect(result.config).toEqual({});
      expect(result.count).toBe(0);
      expect(result.problemName).toBe('problem');
    });
  });

  describe('fetchProblemMetadata', () => {
    it('should fetch description and tags successfully', async () => {
      mockSdk.viewGeneralDescription.mockResolvedValue('A great problem');
      mockSdk.viewTags.mockResolvedValue(['math', 'dp']);

      const result = await pulling.fetchProblemMetadata(asSdk(mockSdk), 1);

      expect(result.description).toBe('A great problem');
      expect(result.tags).toEqual(['math', 'dp']);
    });

    it('should return empty description when viewGeneralDescription fails', async () => {
      mockSdk.viewGeneralDescription.mockRejectedValue(new Error('boom'));
      mockSdk.viewTags.mockResolvedValue(['x']);

      const result = await pulling.fetchProblemMetadata(asSdk(mockSdk), 1);

      expect(result.description).toBe('');
      expect(result.tags).toEqual(['x']);
    });

    it('should return empty tags when viewTags fails', async () => {
      mockSdk.viewGeneralDescription.mockResolvedValue('desc');
      mockSdk.viewTags.mockRejectedValue(new Error('boom'));

      const result = await pulling.fetchProblemMetadata(asSdk(mockSdk), 1);

      expect(result.description).toBe('desc');
      expect(result.tags).toEqual([]);
    });

    it('should handle both calls failing gracefully', async () => {
      mockSdk.viewGeneralDescription.mockRejectedValue(new Error('a'));
      mockSdk.viewTags.mockRejectedValue(new Error('b'));

      const result = await pulling.fetchProblemMetadata(asSdk(mockSdk), 1);

      expect(result).toEqual({ description: '', tags: [] });
    });
  });

  describe('downloadTestsetAndBuildGenerationScripts', () => {
    it('builds testset with manual tests + verbatim script', async () => {
      mockSdk.getTests.mockResolvedValue([
        {
          index: 1,
          manual: true,
          input: 'manual data',
          useInStatements: true,
          group: 'g1',
          points: 10,
        },
        { index: 2, manual: false, useInStatements: false },
      ]);
      mockSdk.getScript.mockResolvedValue(
        '<#list 1..3 as s>\ngen ${s} > $\n</#list>'
      );

      const result = await pulling.downloadTestsetAndBuildGenerationScripts(
        asSdk(mockSdk),
        1,
        'dir',
        'tests',
        [{ name: 'GenName', source: './generators/gen.cpp' }]
      );

      expect(result.manualCount).toBe(1);
      expect(result.testset.name).toBe('tests');
      expect(result.testset.generatorScript?.script).toContain(
        '<#list 1..3 as s>'
      );
      expect(result.testset.manualTests).toHaveLength(1);
      expect(result.testset.manualTests![0]).toMatchObject({
        input: './manual/tests/m-01.in',
        index: 1,
        group: 'g1',
        points: 10,
        useInStatements: true,
      });
      expect(result.testset.groupsEnabled).toBe(true);
      expect(result.testset.groups).toEqual([{ name: 'g1' }]);
      expect(result.testset.pointsEnabled).toBe(true);
    });

    it('does not create directories that already exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      mockSdk.getTests.mockResolvedValue([]);
      mockSdk.getScript.mockResolvedValue('');

      await pulling.downloadTestsetAndBuildGenerationScripts(
        asSdk(mockSdk),
        1,
        'dir',
        'tests',
        []
      );

      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it('does not enable groups or points when not present', async () => {
      mockSdk.getTests.mockResolvedValue([
        { index: 1, manual: false, useInStatements: false },
      ]);
      mockSdk.getScript.mockResolvedValue('gen 1 > $');

      const result = await pulling.downloadTestsetAndBuildGenerationScripts(
        asSdk(mockSdk),
        1,
        'dir',
        'tests',
        []
      );

      expect(result.testset.groupsEnabled).toBeUndefined();
      expect(result.testset.pointsEnabled).toBeUndefined();
      expect(result.testset.manualTests).toBeUndefined();
      expect(result.testset.generatorScript?.script).toBe('gen 1 > $');
    });

    it('handles manual tests without group or points', async () => {
      mockSdk.getTests.mockResolvedValue([
        { index: 1, manual: true, input: 'data', useInStatements: false },
      ]);
      mockSdk.getScript.mockResolvedValue('');

      const result = await pulling.downloadTestsetAndBuildGenerationScripts(
        asSdk(mockSdk),
        1,
        'dir',
        'tests',
        []
      );

      expect(result.manualCount).toBe(1);
      const m = result.testset.manualTests![0];
      expect(m.group).toBeUndefined();
      expect(m.points).toBeUndefined();
      expect(m.useInStatements).toBeUndefined();
    });

    it('skips manual tests that have no input', async () => {
      mockSdk.getTests.mockResolvedValue([
        { index: 1, manual: true, useInStatements: false },
      ]);
      mockSdk.getScript.mockResolvedValue('');

      const result = await pulling.downloadTestsetAndBuildGenerationScripts(
        asSdk(mockSdk),
        1,
        'dir',
        'tests',
        []
      );

      expect(result.manualCount).toBe(0);
      expect(result.testset.manualTests).toBeUndefined();
    });

    it('stores the script text verbatim regardless of contents', async () => {
      mockSdk.getTests.mockResolvedValue([]);
      const verbatim =
        '<#-- @group main -->\n<#list 1..2 as s>\nGEN ${s} > $\n</#list>';
      mockSdk.getScript.mockResolvedValue(verbatim);

      const result = await pulling.downloadTestsetAndBuildGenerationScripts(
        asSdk(mockSdk),
        1,
        'dir',
        'tests',
        [{ name: 'genCanonical', source: './generators/gen.cpp' }]
      );

      expect(result.testset.generatorScript?.script).toBe(verbatim);
      expect(result.testset.manualTests).toBeUndefined();
    });

    it('stores unrecognized generator-name scripts unchanged', async () => {
      mockSdk.getTests.mockResolvedValue([]);
      const verbatim = 'unknownGen 5 > 5\nunknownGen 6 > 6\nunknownGen 7 > 7';
      mockSdk.getScript.mockResolvedValue(verbatim);

      const result = await pulling.downloadTestsetAndBuildGenerationScripts(
        asSdk(mockSdk),
        1,
        'dir',
        'tests',
        []
      );

      expect(result.testset.generatorScript?.script).toBe(verbatim);
    });

    it('keeps non-numeric <#list> bounds in the script verbatim', async () => {
      mockSdk.getTests.mockResolvedValue([]);
      const verbatim = '<#list a..b as s> gen ${s} > $ </#list>';
      mockSdk.getScript.mockResolvedValue(verbatim);

      const result = await pulling.downloadTestsetAndBuildGenerationScripts(
        asSdk(mockSdk),
        1,
        'dir',
        'tests',
        []
      );

      expect(result.testset.generatorScript?.script).toBe(verbatim);
    });

    it('returns an empty script when Polygon returns empty', async () => {
      mockSdk.getTests.mockResolvedValue([]);
      mockSdk.getScript.mockResolvedValue('');

      const result = await pulling.downloadTestsetAndBuildGenerationScripts(
        asSdk(mockSdk),
        1,
        'dir',
        'tests',
        [{ name: 'g', source: '' }]
      );

      expect(result.testset.generatorScript?.script).toBe('');
    });

    it('normalizes CRLF in manual test inputs to LF', async () => {
      mockSdk.getTests.mockResolvedValue([
        {
          index: 1,
          manual: true,
          input: 'line1\r\nline2\r\n',
          useInStatements: false,
        },
      ]);
      mockSdk.getScript.mockResolvedValue('');

      await pulling.downloadTestsetAndBuildGenerationScripts(
        asSdk(mockSdk),
        1,
        'dir',
        'tests',
        []
      );

      const writeCalls = vi.mocked(fs.writeFileSync).mock.calls;
      const manualWrite = writeCalls.find(c =>
        String(c[0]).includes('m-01.in')
      );
      expect(manualWrite).toBeDefined();
      expect(manualWrite![1]).toBe('line1\nline2\n');
    });
  });
});
