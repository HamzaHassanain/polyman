import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import * as pushing from '../../../src/helpers/remote/pushing';
import fs from 'fs';
import type { PathLike, PathOrFileDescriptor } from 'fs';
import type { PolygonSDK } from '../../../src/polygon';
import type ConfigFile from '../../../src/types';

vi.mock('fs');
vi.mock('../../../src/formatter', () => ({
  fmt: {
    warning: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    newLine: vi.fn(),
    cross: vi.fn().mockReturnValue('x'),
    bold: vi.fn().mockImplementation((s: string) => s),
    highlight: vi.fn().mockImplementation((s: string) => s),
  },
}));
vi.mock('../../../src/helpers/remote/utils', () => ({
  normalizeLineEndingsFromSystemToRemote: vi.fn((content: string) => content),
}));
vi.mock('../../../src/helpers/utils', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../src/helpers/utils')>();
  return {
    ...actual,
    logError: vi.fn(),
    throwError: vi.fn((error: unknown, message = '') => {
      throw error instanceof Error
        ? error
        : new Error(`${message}: ${String(error)}`);
    }),
  };
});

/**
 * Subset of PolygonSDK methods exercised by pushing.ts. Each entry is a Mock
 * so the tests can configure return values with the full vitest mock API
 * without having to reach through the type system.
 */
type MockedSdk = {
  saveSolution: Mock;
  saveFile: Mock;
  setChecker: Mock;
  setValidator: Mock;
  saveCheckerTest: Mock;
  saveValidatorTest: Mock;
  saveStatement: Mock;
  saveGeneralDescription: Mock;
  saveTags: Mock;
  saveScript: Mock;
  saveTest: Mock;
  enableGroups: Mock;
  updateProblemInfo: Mock;
};

/**
 * Build the mocked SDK and a `PolygonSDK`-typed handle pointing at the same
 * underlying mocks. Production code only ever sees the typed handle, while
 * test code uses the raw `MockedSdk` for assertions.
 */
function buildSdk(): { sdk: PolygonSDK; mocks: MockedSdk } {
  const mocks: MockedSdk = {
    saveSolution: vi.fn().mockResolvedValue(undefined),
    saveFile: vi.fn().mockResolvedValue(undefined),
    setChecker: vi.fn().mockResolvedValue(undefined),
    setValidator: vi.fn().mockResolvedValue(undefined),
    saveCheckerTest: vi.fn().mockResolvedValue(undefined),
    saveValidatorTest: vi.fn().mockResolvedValue(undefined),
    saveStatement: vi.fn().mockResolvedValue(undefined),
    saveGeneralDescription: vi.fn().mockResolvedValue(undefined),
    saveTags: vi.fn().mockResolvedValue(undefined),
    saveScript: vi.fn().mockResolvedValue(undefined),
    saveTest: vi.fn().mockResolvedValue(undefined),
    enableGroups: vi.fn().mockResolvedValue(undefined),
    updateProblemInfo: vi.fn().mockResolvedValue(undefined),
  };
  const sdk = mocks as unknown as PolygonSDK;
  return { sdk, mocks };
}

/**
 * Construct a `ConfigFile` from a partial without forcing tests to fill in
 * unrelated required fields.
 */
function asConfig(partial: Partial<ConfigFile>): ConfigFile {
  return partial as unknown as ConfigFile;
}

const mockedReadFileSync = vi.mocked(fs.readFileSync);
const mockedExistsSync = vi.mocked(fs.existsSync);

/**
 * Type the read-file callback so the lint rules accept the path argument
 * without an `any`. We always read text, so a string is the right return type.
 */
type ReadFileCallback = (path: PathOrFileDescriptor) => string;

function mockReadFileSyncWith(impl: ReadFileCallback): void {
  // `fs.readFileSync` is heavily overloaded; the cast below narrows our
  // text-only mock to a single signature compatible with the union return
  // type expected by vi.mocked.
  mockedReadFileSync.mockImplementation(impl as typeof fs.readFileSync);
}

const mockConfig: ConfigFile = asConfig({
  name: 'Prob',
  solutions: [{ name: 'sol', source: 'sol.cpp', tag: 'MA' }],
  checker: { name: 'check', source: 'check.cpp' },
  validator: { name: 'val', source: 'val.cpp' },
  statements: { english: { encoding: 'UTF-8', name: 'Prob' } },
  testsets: [],
});

describe('pushing.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('uploadSolutions', () => {
    it('should upload solutions successfully', async () => {
      const { sdk, mocks } = buildSdk();
      mockedReadFileSync.mockReturnValue('code');
      mockedExistsSync.mockReturnValue(true);

      const result = await pushing.uploadSolutions(sdk, 1, 'dir', mockConfig);

      expect(mocks.saveSolution).toHaveBeenCalled();
      expect(result).toBe(1);
    });

    it('should return 0 when solutions list is empty', async () => {
      const { sdk, mocks } = buildSdk();
      const result = await pushing.uploadSolutions(
        sdk,
        1,
        'dir',
        asConfig({ solutions: [] })
      );
      expect(result).toBe(0);
      expect(mocks.saveSolution).not.toHaveBeenCalled();
    });

    it('should return 0 when solutions is undefined', async () => {
      const { sdk } = buildSdk();
      const result = await pushing.uploadSolutions(sdk, 1, 'dir', asConfig({}));
      expect(result).toBe(0);
    });

    it('should detect java source type', async () => {
      const { sdk, mocks } = buildSdk();
      mockedReadFileSync.mockReturnValue('code');
      mockedExistsSync.mockReturnValue(true);
      const cfg = asConfig({
        solutions: [{ name: 's', source: 'Sol.java', tag: 'OK' }],
      });
      await pushing.uploadSolutions(sdk, 1, 'dir', cfg);
      expect(mocks.saveSolution).toHaveBeenCalledWith(
        1,
        'Sol.java',
        'code',
        'OK',
        expect.objectContaining({ sourceType: 'java11' })
      );
    });

    it('should detect python source type', async () => {
      const { sdk, mocks } = buildSdk();
      mockedReadFileSync.mockReturnValue('code');
      mockedExistsSync.mockReturnValue(true);
      const cfg = asConfig({
        solutions: [{ name: 's', source: 'sol.py', tag: 'WA' }],
      });
      await pushing.uploadSolutions(sdk, 1, 'dir', cfg);
      expect(mocks.saveSolution).toHaveBeenCalledWith(
        1,
        'sol.py',
        'code',
        'WA',
        expect.objectContaining({ sourceType: 'python.3' })
      );
    });

    it('should detect c source type', async () => {
      const { sdk, mocks } = buildSdk();
      mockedReadFileSync.mockReturnValue('code');
      mockedExistsSync.mockReturnValue(true);
      const cfg = asConfig({
        solutions: [{ name: 's', source: 'sol.c', tag: 'OK' }],
      });
      await pushing.uploadSolutions(sdk, 1, 'dir', cfg);
      expect(mocks.saveSolution).toHaveBeenCalledWith(
        1,
        'sol.c',
        'code',
        'OK',
        expect.objectContaining({ sourceType: 'c.gcc11' })
      );
    });

    it('should warn and continue when a solution file is missing', async () => {
      const { sdk, mocks } = buildSdk();
      mockedExistsSync.mockReturnValue(false);
      const cfg = asConfig({
        solutions: [
          { name: 'a', source: 'a.cpp', tag: 'MA' },
          { name: 'b', source: 'b.cpp', tag: 'OK' },
        ],
      });
      const result = await pushing.uploadSolutions(sdk, 1, 'dir', cfg);
      expect(result).toBe(0);
      expect(mocks.saveSolution).not.toHaveBeenCalled();
    });

    it('should keep counting on partial sdk failure', async () => {
      const { sdk, mocks } = buildSdk();
      mockedReadFileSync.mockReturnValue('code');
      mockedExistsSync.mockReturnValue(true);
      mocks.saveSolution
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('boom'));
      const cfg = asConfig({
        solutions: [
          { name: 'a', source: 'a.cpp', tag: 'MA' },
          { name: 'b', source: 'b.cpp', tag: 'OK' },
        ],
      });
      const result = await pushing.uploadSolutions(sdk, 1, 'dir', cfg);
      expect(result).toBe(1);
    });
  });

  describe('uploadChecker', () => {
    it('should upload custom checker successfully', async () => {
      const { sdk, mocks } = buildSdk();
      mockedReadFileSync.mockReturnValue('code');
      mockedExistsSync.mockReturnValue(true);

      const result = await pushing.uploadChecker(sdk, 1, 'dir', mockConfig);

      expect(mocks.saveFile).toHaveBeenCalled();
      expect(mocks.setChecker).toHaveBeenCalledWith(1, 'check.cpp');
      expect(result).toBe(1);
    });

    it('should set standard checker without uploading file', async () => {
      const { sdk, mocks } = buildSdk();
      const cfg = asConfig({
        checker: { name: 'wcmp', source: 'wcmp.cpp', isStandard: true },
      });

      const result = await pushing.uploadChecker(sdk, 1, 'dir', cfg);

      expect(mocks.setChecker).toHaveBeenCalledWith(1, 'std::wcmp.cpp');
      expect(mocks.saveFile).not.toHaveBeenCalled();
      expect(result).toBe(1);
    });

    it('should return 0 when no checker configured', async () => {
      const { sdk } = buildSdk();
      const result = await pushing.uploadChecker(sdk, 1, 'dir', asConfig({}));
      expect(result).toBe(0);
    });

    it('should throw if checker source file is missing', async () => {
      const { sdk } = buildSdk();
      mockedExistsSync.mockReturnValue(false);
      await expect(
        pushing.uploadChecker(sdk, 1, 'dir', mockConfig)
      ).rejects.toThrow();
    });

    it('should upload checker tests when testsFilePath is set', async () => {
      const { sdk, mocks } = buildSdk();
      mockedExistsSync.mockReturnValue(true);
      mockReadFileSyncWith(p => {
        if (String(p).includes('tests.json')) {
          return JSON.stringify({
            tests: [
              {
                index: 1,
                input: 'in',
                output: 'out',
                answer: 'ans',
                expectedVerdict: 'OK',
              },
            ],
          });
        }
        return 'code';
      });

      const cfg = asConfig({
        checker: {
          name: 'c',
          source: 'check.cpp',
          testsFilePath: 'tests.json',
        },
      });

      const result = await pushing.uploadChecker(sdk, 1, 'dir', cfg);

      expect(mocks.saveCheckerTest).toHaveBeenCalledWith(
        1,
        1,
        'in',
        'out',
        'ans',
        'OK'
      );
      expect(result).toBe(1);
    });

    it('should swallow malformed checker tests JSON', async () => {
      const { sdk, mocks } = buildSdk();
      mockedExistsSync.mockReturnValue(true);
      mockReadFileSyncWith(p => {
        if (String(p).includes('tests.json')) return 'not json';
        return 'code';
      });

      const cfg = asConfig({
        checker: {
          name: 'c',
          source: 'check.cpp',
          testsFilePath: 'tests.json',
        },
      });

      const result = await pushing.uploadChecker(sdk, 1, 'dir', cfg);
      expect(result).toBe(1);
      expect(mocks.saveCheckerTest).not.toHaveBeenCalled();
    });

    it('should skip incomplete checker tests', async () => {
      const { sdk, mocks } = buildSdk();
      mockedExistsSync.mockReturnValue(true);
      mockReadFileSyncWith(p => {
        if (String(p).includes('tests.json')) {
          return JSON.stringify({
            tests: [{ index: 1, input: 'in' }],
          });
        }
        return 'code';
      });

      const cfg = asConfig({
        checker: {
          name: 'c',
          source: 'check.cpp',
          testsFilePath: 'tests.json',
        },
      });

      const result = await pushing.uploadChecker(sdk, 1, 'dir', cfg);
      expect(result).toBe(1);
      expect(mocks.saveCheckerTest).not.toHaveBeenCalled();
    });

    it('should skip tests upload when testsFilePath does not exist on disk', async () => {
      const { sdk, mocks } = buildSdk();
      mockedExistsSync.mockImplementation(
        (p: PathLike) => !String(p).includes('tests.json')
      );
      mockedReadFileSync.mockReturnValue('code');

      const cfg = asConfig({
        checker: {
          name: 'c',
          source: 'check.cpp',
          testsFilePath: 'tests.json',
        },
      });

      const result = await pushing.uploadChecker(sdk, 1, 'dir', cfg);
      expect(result).toBe(1);
      expect(mocks.saveCheckerTest).not.toHaveBeenCalled();
    });
  });

  describe('uploadValidator', () => {
    it('should upload validator successfully', async () => {
      const { sdk, mocks } = buildSdk();
      mockedReadFileSync.mockReturnValue('code');
      mockedExistsSync.mockReturnValue(true);

      const result = await pushing.uploadValidator(sdk, 1, 'dir', mockConfig);

      expect(mocks.saveFile).toHaveBeenCalled();
      expect(mocks.setValidator).toHaveBeenCalledWith(1, 'val.cpp');
      expect(result).toBe(1);
    });

    it('should return 0 when no validator configured', async () => {
      const { sdk } = buildSdk();
      const result = await pushing.uploadValidator(sdk, 1, 'dir', asConfig({}));
      expect(result).toBe(0);
    });

    it('should return 0 when validator source missing', async () => {
      const { sdk } = buildSdk();
      mockedExistsSync.mockReturnValue(false);
      const result = await pushing.uploadValidator(sdk, 1, 'dir', mockConfig);
      expect(result).toBe(0);
    });

    it('should upload validator tests', async () => {
      const { sdk, mocks } = buildSdk();
      mockedExistsSync.mockReturnValue(true);
      mockReadFileSyncWith(p => {
        if (String(p).includes('tests.json')) {
          return JSON.stringify({
            tests: [
              { index: 1, input: 'a', expectedVerdict: 'VALID' },
              { input: 'b', expectedVerdict: 'INVALID' },
            ],
          });
        }
        return 'code';
      });

      const cfg = asConfig({
        validator: {
          name: 'v',
          source: 'val.cpp',
          testsFilePath: 'tests.json',
        },
      });

      const result = await pushing.uploadValidator(sdk, 1, 'dir', cfg);
      expect(result).toBe(1);
      expect(mocks.saveValidatorTest).toHaveBeenCalledWith(1, 1, 'a', 'VALID');
      expect(mocks.saveValidatorTest).toHaveBeenCalledWith(
        1,
        1,
        'b',
        'INVALID'
      );
    });

    it('should ignore malformed validator tests JSON', async () => {
      const { sdk, mocks } = buildSdk();
      mockedExistsSync.mockReturnValue(true);
      mockReadFileSyncWith(p => {
        if (String(p).includes('tests.json')) return 'not json';
        return 'code';
      });

      const cfg = asConfig({
        validator: {
          name: 'v',
          source: 'val.cpp',
          testsFilePath: 'tests.json',
        },
      });

      const result = await pushing.uploadValidator(sdk, 1, 'dir', cfg);
      expect(result).toBe(1);
      expect(mocks.saveValidatorTest).not.toHaveBeenCalled();
    });

    it('should swallow sdk failure and return 0', async () => {
      const { sdk, mocks } = buildSdk();
      mockedReadFileSync.mockReturnValue('code');
      mockedExistsSync.mockReturnValue(true);
      mocks.saveFile.mockRejectedValue(new Error('boom'));

      const result = await pushing.uploadValidator(sdk, 1, 'dir', mockConfig);
      expect(result).toBe(0);
    });
  });

  describe('uploadGenerators', () => {
    it('should upload generators successfully', async () => {
      const { sdk, mocks } = buildSdk();
      mockedReadFileSync.mockReturnValue('code');
      mockedExistsSync.mockReturnValue(true);
      const cfg = asConfig({
        generators: [
          { name: 'g1', source: 'g1.cpp' },
          { name: 'g2', source: 'g2.py' },
        ],
      });

      const result = await pushing.uploadGenerators(sdk, 1, 'dir', cfg);
      expect(result).toBe(2);
      expect(mocks.saveFile).toHaveBeenCalledTimes(2);
    });

    it('should return 0 when generators undefined', async () => {
      const { sdk } = buildSdk();
      const result = await pushing.uploadGenerators(
        sdk,
        1,
        'dir',
        asConfig({})
      );
      expect(result).toBe(0);
    });

    it('should return 0 when generators empty', async () => {
      const { sdk } = buildSdk();
      const result = await pushing.uploadGenerators(
        sdk,
        1,
        'dir',
        asConfig({ generators: [] })
      );
      expect(result).toBe(0);
    });

    it('should detect java generator source type', async () => {
      const { sdk, mocks } = buildSdk();
      mockedReadFileSync.mockReturnValue('code');
      mockedExistsSync.mockReturnValue(true);
      const cfg = asConfig({
        generators: [{ name: 'g', source: 'Gen.java' }],
      });
      await pushing.uploadGenerators(sdk, 1, 'dir', cfg);
      expect(mocks.saveFile).toHaveBeenCalledWith(
        1,
        'source',
        'Gen.java',
        'code',
        expect.objectContaining({ sourceType: 'java11' })
      );
    });

    it('should warn and skip missing generator files', async () => {
      const { sdk, mocks } = buildSdk();
      mockedExistsSync.mockReturnValue(false);
      const cfg = asConfig({
        generators: [{ name: 'g', source: 'gen.cpp' }],
      });
      const result = await pushing.uploadGenerators(sdk, 1, 'dir', cfg);
      expect(result).toBe(0);
      expect(mocks.saveFile).not.toHaveBeenCalled();
    });

    it('should keep counting on partial sdk failure', async () => {
      const { sdk, mocks } = buildSdk();
      mockedReadFileSync.mockReturnValue('code');
      mockedExistsSync.mockReturnValue(true);
      mocks.saveFile
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('boom'));
      const cfg = asConfig({
        generators: [
          { name: 'a', source: 'a.cpp' },
          { name: 'b', source: 'b.cpp' },
        ],
      });
      const result = await pushing.uploadGenerators(sdk, 1, 'dir', cfg);
      expect(result).toBe(1);
    });
  });

  describe('uploadStatements', () => {
    it('should return 0 when no statements', async () => {
      const { sdk } = buildSdk();
      const result = await pushing.uploadStatements(
        sdk,
        1,
        'dir',
        asConfig({})
      );
      expect(result).toBe(0);
    });

    it('should upload statement with all components present', async () => {
      const { sdk, mocks } = buildSdk();
      mockedExistsSync.mockReturnValue(true);
      mockReadFileSyncWith(p => `content-${String(p)}`);

      const cfg = asConfig({
        name: 'Default',
        statements: {
          english: {
            encoding: 'UTF-8',
            name: 'My Problem',
            legend: 'legend.tex',
            input: 'input.tex',
            output: 'output.tex',
            notes: 'notes.tex',
            tutorial: 'tutorial.tex',
            interaction: 'interaction.tex',
            scoring: 'scoring.tex',
          },
        },
      });

      const result = await pushing.uploadStatements(sdk, 1, 'dir', cfg);
      expect(result).toBe(1);
      expect(mocks.saveStatement).toHaveBeenCalledWith(
        1,
        'english',
        expect.objectContaining({
          encoding: 'UTF-8',
          name: 'My Problem',
          legend: expect.any(String) as string,
          input: expect.any(String) as string,
          output: expect.any(String) as string,
          notes: expect.any(String) as string,
          tutorial: expect.any(String) as string,
          interaction: expect.any(String) as string,
          scoring: expect.any(String) as string,
        })
      );
    });

    it('should skip non-existent statement component files', async () => {
      const { sdk, mocks } = buildSdk();
      mockedExistsSync.mockReturnValue(false);

      const cfg = asConfig({
        name: 'Default',
        statements: {
          english: {
            encoding: 'UTF-8',
            name: 'My Problem',
            legend: 'legend.tex',
            input: 'input.tex',
            output: 'output.tex',
            notes: 'notes.tex',
            tutorial: 'tutorial.tex',
            interaction: 'interaction.tex',
            scoring: 'scoring.tex',
          },
        },
      });

      const result = await pushing.uploadStatements(sdk, 1, 'dir', cfg);
      expect(result).toBe(1);
      const firstCall = mocks.saveStatement.mock.calls[0] as [
        number,
        string,
        Record<string, string | undefined>,
      ];
      const statementData = firstCall[2];
      expect(statementData.legend).toBeUndefined();
      expect(statementData.input).toBeUndefined();
    });

    it('should fall back to config.name when statement.name missing', async () => {
      const { sdk, mocks } = buildSdk();
      mockedExistsSync.mockReturnValue(false);
      const cfg = asConfig({
        name: 'FallbackName',
        statements: {
          english: {
            encoding: 'UTF-8',
          } as unknown as ConfigFile['statements'][string],
        },
      });
      await pushing.uploadStatements(sdk, 1, 'dir', cfg);
      expect(mocks.saveStatement).toHaveBeenCalledWith(
        1,
        'english',
        expect.objectContaining({ name: 'FallbackName', encoding: 'UTF-8' })
      );
    });

    it('should default encoding to UTF-8', async () => {
      const { sdk, mocks } = buildSdk();
      mockedExistsSync.mockReturnValue(false);
      const cfg = asConfig({
        name: 'P',
        statements: {
          english: { name: 'X' } as unknown as ConfigFile['statements'][string],
        },
      });
      await pushing.uploadStatements(sdk, 1, 'dir', cfg);
      expect(mocks.saveStatement).toHaveBeenCalledWith(
        1,
        'english',
        expect.objectContaining({ encoding: 'UTF-8' })
      );
    });

    it('should warn and continue on per-language failure', async () => {
      const { sdk, mocks } = buildSdk();
      mockedExistsSync.mockReturnValue(false);
      mocks.saveStatement
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValueOnce(undefined);
      const cfg = asConfig({
        name: 'P',
        statements: {
          english: { encoding: 'UTF-8', name: 'X' },
          russian: { encoding: 'UTF-8', name: 'Y' },
        },
      });
      const result = await pushing.uploadStatements(sdk, 1, 'dir', cfg);
      expect(result).toBe(1);
    });
  });

  describe('uploadMetadata', () => {
    it('should upload description and tags', async () => {
      const { sdk, mocks } = buildSdk();
      const cfg = asConfig({ description: 'desc', tags: ['dp', 'graphs'] });
      const result = await pushing.uploadMetadata(sdk, 1, cfg);
      expect(result).toBe(2);
      expect(mocks.saveGeneralDescription).toHaveBeenCalledWith(1, 'desc');
      expect(mocks.saveTags).toHaveBeenCalledWith(1, ['dp', 'graphs']);
    });

    it('should return 0 when no metadata', async () => {
      const { sdk } = buildSdk();
      const result = await pushing.uploadMetadata(sdk, 1, asConfig({}));
      expect(result).toBe(0);
    });

    it('should upload only description when tags missing', async () => {
      const { sdk, mocks } = buildSdk();
      const result = await pushing.uploadMetadata(
        sdk,
        1,
        asConfig({ description: 'd' })
      );
      expect(result).toBe(1);
      expect(mocks.saveGeneralDescription).toHaveBeenCalled();
      expect(mocks.saveTags).not.toHaveBeenCalled();
    });

    it('should still count description even if tags upload fails', async () => {
      const { sdk, mocks } = buildSdk();
      mocks.saveTags.mockRejectedValue(new Error('boom'));
      const cfg = asConfig({ description: 'd', tags: ['x'] });
      const result = await pushing.uploadMetadata(sdk, 1, cfg);
      expect(result).toBe(1);
    });

    it('should still count tags even if description upload fails', async () => {
      const { sdk, mocks } = buildSdk();
      mocks.saveGeneralDescription.mockRejectedValue(new Error('boom'));
      const cfg = asConfig({ description: 'd', tags: ['x'] });
      const result = await pushing.uploadMetadata(sdk, 1, cfg);
      expect(result).toBe(1);
    });

    it('should accept empty description string', async () => {
      const { sdk, mocks } = buildSdk();
      const result = await pushing.uploadMetadata(
        sdk,
        1,
        asConfig({ description: '' })
      );
      expect(result).toBe(1);
      expect(mocks.saveGeneralDescription).toHaveBeenCalledWith(1, '');
    });
  });

  describe('updateProblemInfo', () => {
    it('should send all populated fields', async () => {
      const { sdk, mocks } = buildSdk();
      const cfg = asConfig({
        inputFile: 'in.txt',
        outputFile: 'out.txt',
        interactive: true,
        timeLimit: 1000,
        memoryLimit: 256,
      });
      await pushing.updateProblemInfo(sdk, 1, cfg);
      expect(mocks.updateProblemInfo).toHaveBeenCalledWith(1, {
        inputFile: 'in.txt',
        outputFile: 'out.txt',
        interactive: true,
        timeLimit: 1000,
        memoryLimit: 256,
      });
    });

    it('should send empty object when nothing set', async () => {
      const { sdk, mocks } = buildSdk();
      await pushing.updateProblemInfo(sdk, 1, asConfig({}));
      expect(mocks.updateProblemInfo).toHaveBeenCalledWith(1, {});
    });

    it('should include interactive=false explicitly', async () => {
      const { sdk, mocks } = buildSdk();
      await pushing.updateProblemInfo(sdk, 1, asConfig({ interactive: false }));
      expect(mocks.updateProblemInfo).toHaveBeenCalledWith(1, {
        interactive: false,
      });
    });
  });

  describe('uploadTestsets', () => {
    it('should return zeros when no testsets', async () => {
      const { sdk } = buildSdk();
      const result = await pushing.uploadTestsets(sdk, 1, 'dir', asConfig({}));
      expect(result).toEqual({ testsCount: 0, manualsCount: 0 });
    });

    it('should return zeros when testsets array empty', async () => {
      const { sdk } = buildSdk();
      const result = await pushing.uploadTestsets(
        sdk,
        1,
        'dir',
        asConfig({ testsets: [] })
      );
      expect(result).toEqual({ testsCount: 0, manualsCount: 0 });
    });

    it('should warn and skip testsets without commands', async () => {
      const { sdk, mocks } = buildSdk();
      const cfg = asConfig({
        testsets: [{ name: 'tests', generatorScript: {} }],
      });
      const result = await pushing.uploadTestsets(sdk, 1, 'dir', cfg);
      expect(result).toEqual({ testsCount: 0, manualsCount: 0 });
      expect(mocks.saveScript).toHaveBeenCalledWith(1, 'tests', ' ');
    });

    it('should upload manual tests and generator script', async () => {
      const { sdk, mocks } = buildSdk();
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue('manual-input');

      const cfg = asConfig({
        generators: [{ name: 'gen', source: './gen.cpp' }],
        testsets: [
          {
            name: 'tests',
            groupsEnabled: true,
            generatorScript: {
              script: '<#-- @group main -->\ngen 1 > $\ngen 2 > $\ngen 3 > $',
            },
            manualTests: [
              {
                input: 'm1.txt',
                index: 4,
                group: 'samples',
                points: 5,
                useInStatements: true,
              },
            ],
          },
        ],
      });

      const result = await pushing.uploadTestsets(sdk, 1, 'dir', cfg);

      expect(mocks.enableGroups).toHaveBeenCalledWith(1, 'tests', true);
      expect(mocks.saveScript).toHaveBeenCalledWith(
        1,
        'tests',
        expect.stringContaining('gen 1 > $')
      );
      expect(mocks.saveTest).toHaveBeenCalledWith(
        1,
        'tests',
        4,
        'manual-input',
        expect.objectContaining({
          testGroup: 'samples',
          testPoints: 5,
          testUseInStatements: true,
        })
      );
      expect(result.manualsCount).toBe(1);
      expect(result.testsCount).toBe(4);
    });

    it('should throw inside manual promise creation when manual file is missing', async () => {
      const { sdk } = buildSdk();
      mockedExistsSync.mockReturnValue(false);

      const cfg = asConfig({
        testsets: [
          {
            name: 'tests',
            manualTests: [{ input: 'missing.txt', index: 1 }],
          },
        ],
      });

      const result = await pushing.uploadTestsets(sdk, 1, 'dir', cfg);
      expect(result.manualsCount).toBe(0);
    });

    it('should swallow enableGroups failure when groupsEnabled', async () => {
      const { sdk, mocks } = buildSdk();
      mocks.enableGroups.mockImplementation(
        (_id: number, _name: string, on: boolean) => {
          if (on) return Promise.reject(new Error('cannot enable'));
          return Promise.resolve(undefined);
        }
      );
      mockedExistsSync.mockReturnValue(true);
      mockedReadFileSync.mockReturnValue('m');

      const cfg = asConfig({
        generators: [{ name: 'gen', source: './gen.cpp' }],
        testsets: [
          {
            name: 'tests',
            groupsEnabled: true,
            generatorScript: { script: 'gen 1 > $\ngen 2 > $' },
            manualTests: [{ input: 'm.txt', index: 3 }],
          },
        ],
      });

      const result = await pushing.uploadTestsets(sdk, 1, 'dir', cfg);
      expect(result.testsCount).toBe(3);
    });

    it('should not call saveTest for generator tests with no per-test metadata', async () => {
      const { sdk, mocks } = buildSdk();
      const cfg = asConfig({
        generators: [{ name: 'gen', source: './gen.cpp' }],
        testsets: [
          {
            name: 'tests',
            generatorScript: { script: 'gen 1 > $\ngen 2 > $' },
          },
        ],
      });
      const result = await pushing.uploadTestsets(sdk, 1, 'dir', cfg);
      expect(result.testsCount).toBe(2);
      expect(mocks.saveTest).not.toHaveBeenCalled();
    });

    it('should swallow saveScript failure', async () => {
      const { sdk, mocks } = buildSdk();
      let scriptCalls = 0;
      mocks.saveScript.mockImplementation(() => {
        scriptCalls++;
        if (scriptCalls === 2) return Promise.reject(new Error('script fail'));
        return Promise.resolve(undefined);
      });
      const cfg = asConfig({
        generators: [{ name: 'gen', source: './gen.cpp' }],
        testsets: [
          {
            name: 'tests',
            generatorScript: { script: 'gen 1 > $' },
          },
        ],
      });
      const result = await pushing.uploadTestsets(sdk, 1, 'dir', cfg);
      expect(result.testsCount).toBe(1);
    });

    it('should swallow saveTest failure for grouped generator tests', async () => {
      const { sdk, mocks } = buildSdk();
      mocks.saveTest.mockRejectedValue(new Error('save test fail'));
      const cfg = asConfig({
        generators: [{ name: 'gen', source: './gen.cpp' }],
        testsets: [
          {
            name: 'tests',
            generatorScript: {
              script: '<#-- @group g1 -->\ngen 1 > $\ngen 2 > $',
            },
          },
        ],
      });
      const result = await pushing.uploadTestsets(sdk, 1, 'dir', cfg);
      expect(result.testsCount).toBe(2);
    });
  });
});
