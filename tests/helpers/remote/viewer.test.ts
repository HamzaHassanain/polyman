import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as viewer from '../../../src/helpers/remote/viewer';
import { fmt } from '../../../src/formatter';
import type { PolygonSDK } from '../../../src/polygon';
import type {
  FilesResponse,
  File as ProblemFile,
  Package,
  ProblemInfo,
  Solution,
  Statement,
  Test,
} from '../../../src/types';

vi.mock('../../../src/formatter', () => ({
  fmt: {
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    newLine: vi.fn(),
    section: vi.fn(),
    highlight: vi.fn().mockImplementation((s: string) => `H(${s})`),
    infoIcon: vi.fn().mockReturnValue('i'),
  },
}));

// Re-typed view of fmt where each method is `this: void` so reading method
// references does not trip the `unbound-method` rule.
type FmtMockShape = {
  info: (this: void, ...args: unknown[]) => void;
  error: (this: void, ...args: unknown[]) => void;
  warning: (this: void, ...args: unknown[]) => void;
  newLine: (this: void) => void;
  section: (this: void, ...args: unknown[]) => void;
  highlight: (this: void, s: string) => string;
  infoIcon: (this: void) => string;
};

// Build a typed mock SDK with only the methods viewer.ts uses.
type SdkMethod =
  | 'getStatements'
  | 'getSolutions'
  | 'getFiles'
  | 'listPackages'
  | 'getChecker'
  | 'getValidator'
  | 'getTests';
type MockedSdkPart = {
  [K in SdkMethod]: ReturnType<typeof vi.fn>;
};

function createMockSdk(): {
  sdk: PolygonSDK;
  mocks: MockedSdkPart;
} {
  const mocks: MockedSdkPart = {
    getStatements: vi.fn(),
    getSolutions: vi.fn(),
    getFiles: vi.fn(),
    listPackages: vi.fn(),
    getChecker: vi.fn(),
    getValidator: vi.fn(),
    getTests: vi.fn(),
  };
  const sdk = mocks as unknown as PolygonSDK;
  return { sdk, mocks };
}

const mockedFmt = vi.mocked(fmt as unknown as FmtMockShape);

// Type-safe access to fmt.info call args (each call's first arg is a string).
function getInfoCallStrings(): string[] {
  return mockedFmt.info.mock.calls.map(call => {
    const first = call[0];
    return typeof first === 'string' ? first : '';
  });
}

describe('viewer.ts', () => {
  let sdk: PolygonSDK;
  let mocks: MockedSdkPart;

  beforeEach(() => {
    vi.clearAllMocks();
    ({ sdk, mocks } = createMockSdk());
  });

  describe('fetchStatements', () => {
    it('should return statements list', async () => {
      mocks.getStatements.mockResolvedValue({ english: { name: 'S' } });
      const result = await viewer.fetchStatements(sdk, 1);
      expect(result).toHaveLength(1);
      expect(result[0]?.language).toBe('english');
    });

    it('should return empty list on error', async () => {
      mocks.getStatements.mockRejectedValue(new Error('fail'));
      const result = await viewer.fetchStatements(sdk, 1);
      expect(result).toEqual([]);
    });

    it('should map multiple statements with language key', async () => {
      mocks.getStatements.mockResolvedValue({
        english: { name: 'A', encoding: 'UTF-8' },
        russian: { name: 'B', encoding: 'CP1251' },
      });
      const result = await viewer.fetchStatements(sdk, 42);
      expect(result).toHaveLength(2);
      expect(result.map(s => s.language).sort()).toEqual([
        'english',
        'russian',
      ]);
      expect(result[0]?.name).toBeDefined();
    });

    it('should return empty array when no statements', async () => {
      mocks.getStatements.mockResolvedValue({});
      const result = await viewer.fetchStatements(sdk, 1);
      expect(result).toEqual([]);
    });
  });

  describe('fetchSolutions', () => {
    it('should return solutions list', async () => {
      const solutions = [{ name: 'sol.cpp', tag: 'MA' }];
      mocks.getSolutions.mockResolvedValue(solutions);
      const result = await viewer.fetchSolutions(sdk, 1);
      expect(result).toEqual(solutions);
    });

    it('should return empty list on error', async () => {
      mocks.getSolutions.mockRejectedValue(new Error('boom'));
      const result = await viewer.fetchSolutions(sdk, 1);
      expect(result).toEqual([]);
    });
  });

  describe('fetchFiles', () => {
    it('should return files response', async () => {
      const files = {
        resourceFiles: [{ name: 'r' }],
        sourceFiles: [{ name: 's' }],
        auxFiles: [],
      };
      mocks.getFiles.mockResolvedValue(files);
      const result = await viewer.fetchFiles(sdk, 1);
      expect(result).toEqual(files);
    });

    it('should return empty FilesResponse shape on error', async () => {
      mocks.getFiles.mockRejectedValue(new Error('fail'));
      const result = await viewer.fetchFiles(sdk, 1);
      expect(result).toEqual({
        resourceFiles: [],
        sourceFiles: [],
        auxFiles: [],
      });
    });
  });

  describe('fetchPackages', () => {
    it('should return packages', async () => {
      const pkgs = [{ id: 1, state: 'READY', revision: 1, type: 'standard' }];
      mocks.listPackages.mockResolvedValue(pkgs);
      const result = await viewer.fetchPackages(sdk, 1);
      expect(result).toEqual(pkgs);
    });

    it('should return empty on error', async () => {
      mocks.listPackages.mockRejectedValue(new Error('x'));
      const result = await viewer.fetchPackages(sdk, 1);
      expect(result).toEqual([]);
    });
  });

  describe('fetchChecker', () => {
    it('should return checker name', async () => {
      mocks.getChecker.mockResolvedValue('check.cpp');
      const result = await viewer.fetchChecker(sdk, 1);
      expect(result).toBe('check.cpp');
    });

    it('should return empty string on error', async () => {
      mocks.getChecker.mockRejectedValue(new Error('x'));
      const result = await viewer.fetchChecker(sdk, 1);
      expect(result).toBe('');
    });
  });

  describe('fetchValidator', () => {
    it('should return validator name', async () => {
      mocks.getValidator.mockResolvedValue('validate.cpp');
      const result = await viewer.fetchValidator(sdk, 1);
      expect(result).toBe('validate.cpp');
    });

    it('should return empty string on error', async () => {
      mocks.getValidator.mockRejectedValue(new Error('x'));
      const result = await viewer.fetchValidator(sdk, 1);
      expect(result).toBe('');
    });
  });

  describe('identifyGenerators', () => {
    it('should filter out checker, validator, and solutions', () => {
      const files: FilesResponse = {
        resourceFiles: [],
        auxFiles: [],
        sourceFiles: [
          {
            name: 'gen.cpp',
            sourceType: 'cpp.g++17',
            modificationTimeSeconds: 0,
            length: 0,
          },
          {
            name: 'check.cpp',
            sourceType: 'checker.cpp',
            modificationTimeSeconds: 0,
            length: 0,
          },
          {
            name: 'val.cpp',
            sourceType: 'validator.cpp',
            modificationTimeSeconds: 0,
            length: 0,
          },
          {
            name: 'sol.cpp',
            sourceType: 'solution.cpp.g++17',
            modificationTimeSeconds: 0,
            length: 0,
          },
          {
            name: 'my_check.cpp',
            sourceType: 'cpp.g++17',
            modificationTimeSeconds: 0,
            length: 0,
          },
          {
            name: 'my_validator.cpp',
            sourceType: 'cpp.g++17',
            modificationTimeSeconds: 0,
            length: 0,
          },
        ],
      };
      const result = viewer.identifyGenerators(
        files,
        'my_check.cpp',
        'my_validator.cpp'
      );
      expect(result.map(f => f.name)).toEqual(['gen.cpp']);
    });

    it('should handle missing sourceType', () => {
      const files: FilesResponse = {
        resourceFiles: [],
        auxFiles: [],
        sourceFiles: [
          { name: 'gen.cpp', modificationTimeSeconds: 0, length: 0 },
        ],
      };
      const result = viewer.identifyGenerators(files, '', '');
      expect(result).toHaveLength(1);
    });

    it('should return empty when sourceFiles empty', () => {
      const files: FilesResponse = {
        resourceFiles: [],
        auxFiles: [],
        sourceFiles: [],
      };
      expect(viewer.identifyGenerators(files, '', '')).toEqual([]);
    });
  });

  describe('fetchSampleTests', () => {
    it('should filter to only useInStatements tests', async () => {
      mocks.getTests.mockResolvedValue([
        { index: 1, useInStatements: true },
        { index: 2, useInStatements: false },
        { index: 3, useInStatements: true },
      ]);
      const result = await viewer.fetchSampleTests(sdk, 7);
      expect(result.map(t => t.index)).toEqual([1, 3]);
      expect(mocks.getTests).toHaveBeenCalledWith(7, 'tests', true);
    });

    it('should return empty list on error', async () => {
      mocks.getTests.mockRejectedValue(new Error('boom'));
      const result = await viewer.fetchSampleTests(sdk, 1);
      expect(result).toEqual([]);
    });

    it('should return empty list when no samples match', async () => {
      mocks.getTests.mockResolvedValue([{ index: 1, useInStatements: false }]);
      const result = await viewer.fetchSampleTests(sdk, 1);
      expect(result).toEqual([]);
    });
  });

  describe('displayProblemDetails', () => {
    const baseInfo: ProblemInfo = {
      inputFile: 'stdin',
      outputFile: 'stdout',
      interactive: false,
      timeLimit: 1000,
      memoryLimit: 256,
    };

    const emptyFiles: FilesResponse = {
      resourceFiles: [],
      sourceFiles: [],
      auxFiles: [],
    };

    it('should display all sections when populated', () => {
      const statements: Array<Statement & { language: string }> = [
        {
          language: 'english',
          encoding: 'UTF-8',
          name: 'Problem',
          legend: 'a'.repeat(80),
          input: '',
          output: '',
        },
      ];
      const solutions: Solution[] = [
        {
          name: 'main.cpp',
          tag: 'MA',
          modificationTimeSeconds: 0,
          length: 0,
          sourceType: 'cpp.g++17',
        },
        {
          name: 'alt.cpp',
          tag: 'OK',
          modificationTimeSeconds: 0,
          length: 0,
          sourceType: 'cpp.g++17',
        },
        {
          name: 'wa.cpp',
          tag: 'WA',
          modificationTimeSeconds: 0,
          length: 0,
          sourceType: 'cpp.g++17',
        },
      ];
      const files: FilesResponse = {
        resourceFiles: [{ name: 'r.h', modificationTimeSeconds: 0, length: 0 }],
        sourceFiles: [{ name: 's.cpp', modificationTimeSeconds: 0, length: 0 }],
        auxFiles: [{ name: 'a.txt', modificationTimeSeconds: 0, length: 0 }],
      };
      const packages: Package[] = [
        {
          id: 1,
          state: 'READY',
          type: 'standard',
          revision: 3,
          creationTimeSeconds: 0,
          comment: '',
        },
        {
          id: 2,
          state: 'PENDING',
          type: 'linux',
          revision: 4,
          creationTimeSeconds: 0,
          comment: '',
        },
      ];
      const generators: ProblemFile[] = [
        { name: 'gen.cpp', modificationTimeSeconds: 0, length: 0 },
      ];
      const samples: Test[] = [
        {
          index: 1,
          useInStatements: true,
          manual: false,
          points: 0,
        },
      ];

      viewer.displayProblemDetails(
        baseInfo,
        statements,
        solutions,
        files,
        packages,
        'check.cpp',
        'val.cpp',
        generators,
        samples
      );

      const sectionMock = mockedFmt.section;
      const infoMock = mockedFmt.info;
      const newLineMock = mockedFmt.newLine;
      expect(sectionMock).toHaveBeenCalledWith('PROBLEM DETAILS');
      expect(infoMock).toHaveBeenCalled();
      expect(newLineMock).toHaveBeenCalled();
    });

    it('should show interactive Yes when interactive', () => {
      viewer.displayProblemDetails(
        { ...baseInfo, interactive: true },
        [],
        [],
        emptyFiles,
        [],
        '',
        '',
        [],
        []
      );
      const calls = getInfoCallStrings();
      expect(calls.some(s => s.includes('Yes'))).toBe(true);
    });

    it('should skip empty sections gracefully', () => {
      viewer.displayProblemDetails(
        baseInfo,
        [],
        [],
        emptyFiles,
        [],
        '',
        '',
        [],
        []
      );
      expect(mockedFmt.section).toHaveBeenCalledTimes(1);
    });

    it('should skip statement legend when not present', () => {
      viewer.displayProblemDetails(
        baseInfo,
        [
          {
            language: 'english',
            encoding: 'UTF-8',
            name: 'P',
            legend: '',
            input: '',
            output: '',
          },
        ],
        [],
        emptyFiles,
        [],
        '',
        '',
        [],
        []
      );
      const calls = getInfoCallStrings();
      expect(calls.some(s => s.includes('Legend:'))).toBe(false);
    });

    it('should not display latest ready package when none ready', () => {
      viewer.displayProblemDetails(
        baseInfo,
        [],
        [],
        emptyFiles,
        [
          {
            id: 1,
            state: 'PENDING',
            type: 'standard',
            revision: 1,
            creationTimeSeconds: 0,
          },
        ],
        '',
        '',
        [],
        []
      );
      const calls = getInfoCallStrings();
      expect(calls.some(s => s.includes('Latest ready'))).toBe(false);
    });
  });

  describe('logStatementsFetch', () => {
    it('should log info if statements found', () => {
      viewer.logStatementsFetch([
        {
          encoding: 'UTF-8',
          name: 'X',
          legend: '',
          input: '',
          output: '',
        } as Statement & { language: string },
      ]);
      expect(mockedFmt.info).toHaveBeenCalled();
      const calls = getInfoCallStrings();
      expect(calls.some(s => s.includes('Found'))).toBe(true);
    });

    it('should log "No statements found" when empty', () => {
      viewer.logStatementsFetch([]);
      const calls = getInfoCallStrings();
      expect(calls.some(s => s.includes('No statements found'))).toBe(true);
    });

    it('should log each statement', () => {
      viewer.logStatementsFetch([
        {
          encoding: 'UTF-8',
          name: 'A',
          legend: '',
          input: '',
          output: '',
          language: 'english',
        } as Statement & { language: string },
        {
          encoding: 'CP1251',
          name: 'B',
          legend: '',
          input: '',
          output: '',
          language: 'russian',
        } as Statement & { language: string },
      ]);
      const calls = getInfoCallStrings();
      expect(calls.filter(s => s.includes('-')).length).toBeGreaterThanOrEqual(
        2
      );
    });
  });

  describe('logSolutionsFetch', () => {
    it('should log groupings of solutions by tag', () => {
      const solutions: Solution[] = [
        {
          name: 'a.cpp',
          tag: 'MA',
          modificationTimeSeconds: 0,
          length: 0,
          sourceType: 'cpp.g++17',
        },
        {
          name: 'b.cpp',
          tag: 'OK',
          modificationTimeSeconds: 0,
          length: 0,
          sourceType: 'cpp.g++17',
        },
        {
          name: 'c.cpp',
          tag: 'OK',
          modificationTimeSeconds: 0,
          length: 0,
          sourceType: 'cpp.g++17',
        },
      ];
      viewer.logSolutionsFetch(solutions);
      const calls = getInfoCallStrings();
      expect(calls.some(s => s.includes('Found'))).toBe(true);
      expect(calls.some(s => s.includes('MA'))).toBe(true);
      expect(calls.some(s => s.includes('OK'))).toBe(true);
    });

    it('should log "No solutions found" when empty', () => {
      viewer.logSolutionsFetch([]);
      const calls = getInfoCallStrings();
      expect(calls.some(s => s.includes('No solutions found'))).toBe(true);
    });
  });

  describe('logFilesFetch', () => {
    it('should log totals and per-category counts', () => {
      const files: FilesResponse = {
        resourceFiles: [{ name: 'r.h', modificationTimeSeconds: 0, length: 0 }],
        sourceFiles: [
          { name: 's.cpp', modificationTimeSeconds: 0, length: 0 },
          { name: 't.cpp', modificationTimeSeconds: 0, length: 0 },
        ],
        auxFiles: [],
      };
      viewer.logFilesFetch(files);
      const calls = getInfoCallStrings();
      expect(calls.some(s => s.includes('Found'))).toBe(true);
      expect(calls.some(s => s.includes('Resource files: 1'))).toBe(true);
      expect(calls.some(s => s.includes('Source files: 2'))).toBe(true);
      expect(calls.some(s => s.includes('Aux files'))).toBe(false);
    });

    it('should log "No files found" when empty', () => {
      viewer.logFilesFetch({
        resourceFiles: [],
        sourceFiles: [],
        auxFiles: [],
      });
      const calls = getInfoCallStrings();
      expect(calls.some(s => s.includes('No files found'))).toBe(true);
    });
  });

  describe('logPackagesFetch', () => {
    it('should log up to 5 packages then "and N more"', () => {
      const pkgs: Package[] = Array.from({ length: 7 }, (_, i) => ({
        id: i + 1,
        state: 'READY',
        type: 'standard',
        revision: i + 1,
        creationTimeSeconds: 0,
        comment: '',
      }));
      viewer.logPackagesFetch(pkgs);
      const calls = getInfoCallStrings();
      expect(calls.some(s => s.includes('Found'))).toBe(true);
      expect(calls.some(s => s.includes('and 2 more'))).toBe(true);
    });

    it('should log "No packages found" when empty', () => {
      viewer.logPackagesFetch([]);
      const calls = getInfoCallStrings();
      expect(calls.some(s => s.includes('No packages found'))).toBe(true);
    });

    it('should mark non-READY packages with hourglass', () => {
      viewer.logPackagesFetch([
        {
          id: 1,
          state: 'PENDING',
          type: 'linux',
          revision: 1,
          creationTimeSeconds: 0,
          comment: '',
        },
      ]);
      const calls = getInfoCallStrings();
      expect(calls.some(s => s.includes('⏳'))).toBe(true);
    });

    it('should not show "and N more" when count <= 5', () => {
      const pkgs: Package[] = Array.from({ length: 3 }, (_, i) => ({
        id: i + 1,
        state: 'READY',
        type: 'standard',
        revision: i + 1,
        creationTimeSeconds: 0,
        comment: '',
      }));
      viewer.logPackagesFetch(pkgs);
      const calls = getInfoCallStrings();
      expect(calls.some(s => s.includes('more'))).toBe(false);
    });
  });

  describe('logCheckerFetch', () => {
    it('should log checker name when present', () => {
      viewer.logCheckerFetch('ncmp.cpp');
      const calls = getInfoCallStrings();
      expect(calls.some(s => s.includes('Checker:'))).toBe(true);
    });

    it('should log no checker when empty', () => {
      viewer.logCheckerFetch('');
      const calls = getInfoCallStrings();
      expect(calls.some(s => s.includes('No checker configured'))).toBe(true);
    });
  });

  describe('logValidatorFetch', () => {
    it('should log validator name when present', () => {
      viewer.logValidatorFetch('val.cpp');
      const calls = getInfoCallStrings();
      expect(calls.some(s => s.includes('Validator:'))).toBe(true);
    });

    it('should log no validator when empty', () => {
      viewer.logValidatorFetch('');
      const calls = getInfoCallStrings();
      expect(calls.some(s => s.includes('No validator configured'))).toBe(true);
    });
  });

  describe('logGeneratorsIdentified', () => {
    it('should log each generator', () => {
      viewer.logGeneratorsIdentified([
        { name: 'gen1.cpp', modificationTimeSeconds: 0, length: 0 },
        { name: 'gen2.cpp', modificationTimeSeconds: 0, length: 0 },
      ]);
      const calls = getInfoCallStrings();
      expect(calls.some(s => s.includes('gen1.cpp'))).toBe(true);
      expect(calls.some(s => s.includes('gen2.cpp'))).toBe(true);
    });

    it('should log "No generators found" when empty', () => {
      viewer.logGeneratorsIdentified([]);
      const calls = getInfoCallStrings();
      expect(calls.some(s => s.includes('No generators found'))).toBe(true);
    });
  });

  describe('logSampleTestsFetch', () => {
    it('should log each sample test by index', () => {
      viewer.logSampleTestsFetch([
        { index: 1, useInStatements: true, manual: false, points: 0 },
        { index: 2, useInStatements: true, manual: false, points: 0 },
      ]);
      const calls = getInfoCallStrings();
      expect(calls.some(s => s.includes('Test #1'))).toBe(true);
      expect(calls.some(s => s.includes('Test #2'))).toBe(true);
    });

    it('should log "No sample tests found" when empty', () => {
      viewer.logSampleTestsFetch([]);
      const calls = getInfoCallStrings();
      expect(calls.some(s => s.includes('No sample tests found'))).toBe(true);
    });
  });
});
