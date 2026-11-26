import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MockedFunction } from 'vitest';
import * as pulling from '../../../src/helpers/remote/pulling';
import fs from 'fs';
import path from 'path';
import { fmt } from '../../../src/formatter';
import type { PolygonSDK } from '../../../src/polygon';
import type { StatementConfig } from '../../../src/types';
import { normalizeLineEndingsFromRemoteToSystem } from '../../../src/helpers/remote/utils';

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
  };
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

    it('keeps the Polygon sourceType of each solution', async () => {
      mockSdk.getSolutions.mockResolvedValue([
        {
          name: 'main.cpp',
          modificationTimeSeconds: 0,
          length: 0,
          sourceType: 'cpp.gcc14-64-msys2-g++23',
          tag: 'MA',
        },
        {
          name: 'second.cpp',
          modificationTimeSeconds: 0,
          length: 0,
          sourceType: 'cpp.g++17',
          tag: 'OK',
        },
      ]);
      mockSdk.viewSolution.mockResolvedValue('code');

      const result = await pulling.downloadSolutions(asSdk(mockSdk), 1, 'dir');

      expect(result.data).toEqual([
        {
          name: 'main',
          source: './solutions/main.cpp',
          tag: 'MA',
          sourceType: 'cpp.gcc14-64-msys2-g++23',
        },
        {
          name: 'second',
          source: './solutions/second.cpp',
          tag: 'OK',
          sourceType: 'cpp.g++17',
        },
      ]);
    });

    it('writes no sourceType when Polygon sends an empty one', async () => {
      mockSdk.getSolutions.mockResolvedValue([
        {
          name: 'main.cpp',
          modificationTimeSeconds: 0,
          length: 0,
          sourceType: '',
          tag: 'MA',
        },
      ]);
      mockSdk.viewSolution.mockResolvedValue('code');

      const result = await pulling.downloadSolutions(asSdk(mockSdk), 1, 'dir');

      expect(result.data[0]).not.toHaveProperty('sourceType');
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
      expect(result.failures).toEqual([
        {
          component: 'solution',
          name: 'b',
          error: 'boom',
          message:
            'Could not download the solution b.cpp (boom): Config.json does not list it',
        },
      ]);
      expect(result.placeholder).toBeUndefined();
    });

    it('should return the solution placeholder when getSolutions fails', async () => {
      mockSdk.getSolutions.mockRejectedValue(new Error('network'));

      const result = await pulling.downloadSolutions(asSdk(mockSdk), 1, 'dir');

      expect(result.count).toBe(0);
      expect(result.data).toEqual([
        { name: 'main', source: './solutions/acc.cpp', tag: 'MA' },
      ]);
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join('dir', 'solutions'), {
        recursive: true,
      });
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should return the solution placeholder when no solutions returned', async () => {
      mockSdk.getSolutions.mockResolvedValue([]);

      const result = await pulling.downloadSolutions(asSdk(mockSdk), 1, 'dir');

      expect(result.count).toBe(0);
      expect(result.data[0].name).toBe('main');
      expect(result.data[0].tag).toBe('MA');
      expect(result.data[0].source).toBe('./solutions/acc.cpp');
    });

    it('should return the solution placeholder when all viewSolution calls fail', async () => {
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
      expect(result.data[0].source).toBe('./solutions/acc.cpp');
    });

    describe('Java class naming', () => {
      const entry = (name: string, sourceType: string) => ({
        name,
        modificationTimeSeconds: 0,
        length: 0,
        sourceType,
        tag: 'OK' as const,
      });
      const javaCode =
        'public class Main {\n  String s = "Main";\n  public static void main(String[] a) { new Main(); }\n}\n';

      it('renames Main to the file name for a Java solution', async () => {
        mockSdk.getSolutions.mockResolvedValue([
          entry('Solution.java', 'java21'),
        ]);
        mockSdk.viewSolution.mockResolvedValue(javaCode);

        await pulling.downloadSolutions(asSdk(mockSdk), 1, 'dir');

        const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
        expect(written).toContain('public class Solution {');
        expect(written).toContain('new Solution();');
        expect(written).toContain('"Main"');
      });

      it('leaves Main.java unchanged', async () => {
        mockSdk.getSolutions.mockResolvedValue([entry('Main.java', 'java21')]);
        mockSdk.viewSolution.mockResolvedValue(javaCode);

        await pulling.downloadSolutions(asSdk(mockSdk), 1, 'dir');

        expect(vi.mocked(fs.writeFileSync).mock.calls[0][1]).toBe(javaCode);
      });

      it('renames Main for an uppercase .JAVA extension', async () => {
        mockSdk.getSolutions.mockResolvedValue([
          entry('Solution.JAVA', 'java21'),
        ]);
        mockSdk.viewSolution.mockResolvedValue(javaCode);

        await pulling.downloadSolutions(asSdk(mockSdk), 1, 'dir');

        const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
        expect(written).toContain('public class Solution {');
        expect(written).toContain('new Solution();');
        expect(written).not.toContain('public class Main');
      });

      it.each(['sol-a.java', '1a.java', 'class.java'])(
        'leaves %s byte-identical when the base name is not an identifier',
        async name => {
          const code = 'public class Main {\n  Main() {}\n}\n';
          mockSdk.getSolutions.mockResolvedValue([entry(name, 'java21')]);
          mockSdk.viewSolution.mockResolvedValue(code);

          await pulling.downloadSolutions(asSdk(mockSdk), 1, 'dir');

          expect(vi.mocked(fs.writeFileSync).mock.calls[0][1]).toBe(code);
        }
      );

      it('renames Main in CRLF remote content, then normalizes line endings', async () => {
        const actual = await vi.importActual<
          typeof import('../../../src/helpers/remote/utils')
        >('../../../src/helpers/remote/utils');
        vi.mocked(
          normalizeLineEndingsFromRemoteToSystem
        ).mockImplementationOnce(actual.normalizeLineEndingsFromRemoteToSystem);
        const crlf =
          'public class Main {\r\n  Main() {}\r\n  String s = "Main";\r\n}\r\n';
        mockSdk.getSolutions.mockResolvedValue([
          entry('Solution.java', 'java21'),
        ]);
        mockSdk.viewSolution.mockResolvedValue(crlf);

        await pulling.downloadSolutions(asSdk(mockSdk), 1, 'dir');

        // The rename sees the CRLF text and normalization receives its result.
        expect(normalizeLineEndingsFromRemoteToSystem).toHaveBeenCalledWith(
          'public class Solution {\r\n  Solution() {}\r\n  String s = "Main";\r\n}\r\n'
        );
        const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
        const lf =
          'public class Solution {\n  Solution() {}\n  String s = "Main";\n}\n';
        // On win32 the remote text is kept as is; elsewhere CRLF becomes LF.
        expect(written).toBe(
          process.platform === 'win32' ? lf.replace(/\n/g, '\r\n') : lf
        );
      });

      it('leaves C++ solutions unchanged', async () => {
        const cpp = 'class Main {};\n';
        mockSdk.getSolutions.mockResolvedValue([
          entry('Main2.cpp', 'cpp.g++17'),
        ]);
        mockSdk.viewSolution.mockResolvedValue(cpp);

        await pulling.downloadSolutions(asSdk(mockSdk), 1, 'dir');

        expect(vi.mocked(fs.writeFileSync).mock.calls[0][1]).toBe(cpp);
      });
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
      // The tests file was not written, so Config.json must not point at it.
      expect(result.data.testsFilePath).toBeUndefined();
      expect(result.failures).toEqual([
        {
          component: 'checker',
          name: 'checker tests',
          error: 'no tests',
          message:
            'Could not download the checker tests (no tests): Config.json has no testsFilePath for the checker, so its self-tests are skipped',
        },
      ]);
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
      // The tests file was not written, so Config.json must not point at it.
      expect(result.data.testsFilePath).toBeUndefined();
      expect(result.failures).toEqual([
        {
          component: 'validator',
          name: 'validator tests',
          error: 'no tests',
          message:
            'Could not download the validator tests (no tests): Config.json has no testsFilePath for the validator, so its self-tests are skipped',
        },
      ]);
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

    it('should return the validator placeholder when getValidator fails', async () => {
      mockSdk.getValidator.mockRejectedValue(new Error('boom'));

      const result = await pulling.downloadValidator(asSdk(mockSdk), 1, 'dir');

      expect(result.data).toEqual({
        name: 'validator',
        source: './validator/val.cpp',
      });
      expect(result.count).toBe(0);
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join('dir', 'validator'), {
        recursive: true,
      });
    });

    it('should return the validator placeholder when viewFile fails', async () => {
      mockSdk.getValidator.mockResolvedValue('validator.cpp');
      mockSdk.viewFile.mockRejectedValue(new Error('view fail'));

      const result = await pulling.downloadValidator(asSdk(mockSdk), 1, 'dir');

      expect(result.data.source).toBe('./validator/val.cpp');
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
        ['validator']
      );

      expect(result.count).toBe(1);
      expect(result.data).toHaveLength(1);
      expect(result.data[0].name).toBe('gen');
      expect(result.data[0].source).toBe('./generators/gen.cpp');
      expect(result.data[0].sourceType).toBe('cpp.g++17');
      expect(result.sourceTypes).toEqual({
        'gen.cpp': 'cpp.g++17',
        'check.cpp': 'checker',
        'val.cpp': 'validator',
        'sol.cpp': 'solution.cpp',
        'validator.cpp': 'cpp.g++17',
      });
    });

    it('should skip the validator when it uses a .cc or .cxx extension', async () => {
      mockSdk.getFiles.mockResolvedValue({
        sourceFiles: [
          { name: 'gen.cc', modificationTimeSeconds: 0, length: 0 },
          { name: 'validator.cc', modificationTimeSeconds: 0, length: 0 },
          { name: 'validator.cxx', modificationTimeSeconds: 0, length: 0 },
        ],
        resourceFiles: [],
        auxFiles: [],
      });
      mockSdk.viewFile.mockResolvedValue('code');

      const result = await pulling.downloadGenerators(
        asSdk(mockSdk),
        1,
        'dir',
        ['validator']
      );

      expect(result.count).toBe(1);
      expect(result.data).toEqual([
        { name: 'gen', source: './generators/gen.cc' },
      ]);
    });

    it('should skip the checker, whose sourceType is only its compiler', async () => {
      mockSdk.getFiles.mockResolvedValue({
        sourceFiles: [
          {
            name: 'chk.cpp',
            modificationTimeSeconds: 0,
            length: 0,
            sourceType: 'cpp.g++17',
          },
          {
            name: 'gen.cpp',
            modificationTimeSeconds: 0,
            length: 0,
            sourceType: 'cpp.g++17',
          },
          {
            name: 'val.cpp',
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
        ['val', 'chk']
      );

      expect(result.data).toEqual([
        {
          name: 'gen',
          source: './generators/gen.cpp',
          sourceType: 'cpp.g++17',
        },
      ]);
      expect(mockSdk.viewFile).toHaveBeenCalledTimes(1);
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
        ['val']
      );

      expect(result.count).toBe(2);
      expect(result.data.map(g => g.name)).toEqual(['gen1', 'gen3']);
      expect(result.failures).toEqual([
        {
          component: 'generator',
          name: 'gen2',
          error: 'fail',
          message:
            'Could not download the generator gen2.cpp (fail): Config.json does not list it',
        },
      ]);
    });

    it('should return empty data when getFiles fails', async () => {
      mockSdk.getFiles.mockRejectedValue(new Error('boom'));

      const result = await pulling.downloadGenerators(
        asSdk(mockSdk),
        1,
        'dir',
        ['val']
      );

      expect(result.count).toBe(0);
      expect(result.data).toEqual([]);
      expect(result.sourceTypes).toEqual({});
    });

    it.each(['__proto__', 'constructor', 'toString'])(
      'should map a file named %s to its own sourceType',
      async name => {
        mockSdk.getFiles.mockResolvedValue({
          sourceFiles: [
            {
              name,
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
          []
        );

        expect(result.sourceTypes[name]).toBe('cpp.g++17');
        expect(Object.keys(result.sourceTypes)).toEqual([name]);
      }
    );

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
        ['val']
      );

      expect(result.count).toBe(0);
      expect(result.data).toEqual([]);
    });

    const resource = (name: string) => ({
      name,
      modificationTimeSeconds: 0,
      length: 0,
    });

    it('writes a testlib.h resource file next to Config.json', async () => {
      mockSdk.getFiles.mockResolvedValue({
        sourceFiles: [],
        resourceFiles: [resource('testlib.h'), resource('common.h')],
        auxFiles: [],
      });
      mockSdk.viewFile.mockImplementation(
        (_id: number, _type: string, name: string) =>
          Promise.resolve(`// Polygon ${name}\n`)
      );

      const result = await pulling.downloadGenerators(
        asSdk(mockSdk),
        1,
        'dir',
        []
      );

      expect(mockSdk.viewFile).toHaveBeenCalledWith(1, 'resource', 'testlib.h');
      expect(mockSdk.viewFile).toHaveBeenCalledWith(1, 'resource', 'common.h');
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join('dir', 'testlib.h'),
        '// Polygon testlib.h\n',
        'utf-8'
      );
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        path.join('dir', 'common.h'),
        '// Polygon common.h\n',
        'utf-8'
      );
      expect(result.resources).toEqual(['testlib.h', 'common.h']);
      expect(result.count).toBe(2);
      // A resource file is not a generator.
      expect(result.data).toEqual([]);
      expect(result.failures).toEqual([]);
    });

    it('returns a failed resource file download as a pull failure', async () => {
      mockSdk.getFiles.mockResolvedValue({
        sourceFiles: [],
        resourceFiles: [resource('testlib.h'), resource('common.h')],
        auxFiles: [],
      });
      mockSdk.viewFile.mockImplementation(
        (_id: number, _type: string, name: string) =>
          name === 'testlib.h'
            ? Promise.reject(new Error('Polygon API Error: no access'))
            : Promise.resolve('code')
      );

      const result = await pulling.downloadGenerators(
        asSdk(mockSdk),
        1,
        'dir',
        []
      );

      expect(result.resources).toEqual(['common.h']);
      expect(result.failures).toEqual([
        {
          component: 'resource',
          name: 'testlib.h',
          error: 'Polygon API Error: no access',
          message:
            'Could not download the resource file testlib.h (Polygon API Error: no access): it is not in the problem folder',
        },
      ]);
      expect(fs.writeFileSync).not.toHaveBeenCalledWith(
        path.join('dir', 'testlib.h'),
        expect.anything(),
        expect.anything()
      );
    });

    it.each([
      '../testlib.h',
      'sub/x.h',
      '..\\x.h',
      'Config.json',
      'config.JSON',
    ])('does not write a resource file named %s', async name => {
      mockSdk.getFiles.mockResolvedValue({
        sourceFiles: [],
        resourceFiles: [resource(name)],
        auxFiles: [],
      });
      mockSdk.viewFile.mockResolvedValue('code');

      const result = await pulling.downloadGenerators(
        asSdk(mockSdk),
        1,
        'dir',
        []
      );

      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(mockSdk.viewFile).not.toHaveBeenCalled();
      expect(result.resources).toEqual([]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0].component).toBe('resource');
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
        ['val']
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
      expect(result.failures).toEqual([
        {
          component: 'statement',
          name: 'statements',
          error: 'boom',
          message:
            'Could not download the statements (boom): Config.json lists no statements',
        },
      ]);
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

    it('leaves out the description and warns when viewGeneralDescription fails', async () => {
      mockSdk.viewGeneralDescription.mockRejectedValue(new Error('boom'));
      mockSdk.viewTags.mockResolvedValue(['x']);

      const result = await pulling.fetchProblemMetadata(asSdk(mockSdk), 1);

      expect(result).toEqual({
        tags: ['x'],
        failures: [
          {
            component: 'metadata',
            name: 'description',
            error: 'boom',
            message:
              'Could not download the description (boom): Config.json has no description, so push will not change it on Polygon',
          },
        ],
      });
      expect('description' in result).toBe(false);
    });

    it('leaves out the tags and warns when viewTags fails', async () => {
      mockSdk.viewGeneralDescription.mockResolvedValue('desc');
      mockSdk.viewTags.mockRejectedValue(new Error('boom'));

      const result = await pulling.fetchProblemMetadata(asSdk(mockSdk), 1);

      expect(result).toEqual({
        description: 'desc',
        failures: [
          {
            component: 'metadata',
            name: 'tags',
            error: 'boom',
            message:
              'Could not download the tags (boom): Config.json has no tags, so push will not change them on Polygon',
          },
        ],
      });
      expect('tags' in result).toBe(false);
    });

    it('leaves out both fields with one warning each when both calls fail', async () => {
      mockSdk.viewGeneralDescription.mockRejectedValue(new Error('a'));
      mockSdk.viewTags.mockRejectedValue(new Error('b'));

      const result = await pulling.fetchProblemMetadata(asSdk(mockSdk), 1);

      expect(result).toEqual({
        failures: [
          {
            component: 'metadata',
            name: 'description',
            error: 'a',
            message:
              'Could not download the description (a): Config.json has no description, so push will not change it on Polygon',
          },
          {
            component: 'metadata',
            name: 'tags',
            error: 'b',
            message:
              'Could not download the tags (b): Config.json has no tags, so push will not change them on Polygon',
          },
        ],
      });
    });

    it('keeps an empty description and empty tags that Polygon returned', async () => {
      mockSdk.viewGeneralDescription.mockResolvedValue('');
      mockSdk.viewTags.mockResolvedValue([]);

      const result = await pulling.fetchProblemMetadata(asSdk(mockSdk), 1);

      expect(result).toEqual({ description: '', tags: [], failures: [] });
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

    it('refuses a test index that is not a non-negative integer', async () => {
      mockSdk.getTests.mockResolvedValue([
        {
          index: '../../../../evil' as unknown as number,
          manual: true,
          input: 'x',
          useInStatements: false,
        },
      ]);
      mockSdk.getScript.mockResolvedValue('');

      await expect(
        pulling.downloadTestsetAndBuildGenerationScripts(
          asSdk(mockSdk),
          1,
          'dir',
          'tests',
          []
        )
      ).rejects.toThrow(/Refusing unsafe test index/);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it.each([
      ['negative', -1],
      ['float', 1.5],
      ['NaN', NaN],
      ['Infinity', Infinity],
      ['null', null],
      ['undefined', undefined],
      ['numeric string', '1'],
    ])('refuses a %s test index', async (_label, index) => {
      mockSdk.getTests.mockResolvedValue([
        {
          index: index as unknown as number,
          manual: true,
          input: 'x',
          useInStatements: false,
        },
      ]);
      mockSdk.getScript.mockResolvedValue('');

      await expect(
        pulling.downloadTestsetAndBuildGenerationScripts(
          asSdk(mockSdk),
          1,
          'dir',
          'tests',
          []
        )
      ).rejects.toThrow(/Refusing unsafe test index/);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('does not create the manual directory when the index is refused', async () => {
      mockSdk.getTests.mockResolvedValue([
        { index: -3, manual: true, input: 'x', useInStatements: false },
      ]);
      mockSdk.getScript.mockResolvedValue('');

      await expect(
        pulling.downloadTestsetAndBuildGenerationScripts(
          asSdk(mockSdk),
          1,
          'dir',
          'tests',
          []
        )
      ).rejects.toThrow(/Refusing unsafe test index/);
      const created = vi
        .mocked(fs.mkdirSync)
        .mock.calls.map(call => String(call[0]));
      expect(created.some(dir => dir.includes('manual'))).toBe(false);
    });

    it('escapes control characters of a refused index in the message', async () => {
      mockSdk.getTests.mockResolvedValue([
        {
          index: '\u009b31m\u202efake\u2028' as unknown as number,
          manual: true,
          input: 'x',
          useInStatements: false,
        },
      ]);
      mockSdk.getScript.mockResolvedValue('');

      const error = await pulling
        .downloadTestsetAndBuildGenerationScripts(
          asSdk(mockSdk),
          1,
          'dir',
          'tests',
          []
        )
        .catch((e: unknown) => e as Error);
      expect(error.message).toMatch(/Refusing unsafe test index/);
      expect(error.message).not.toMatch(/[\u0080-\u009f\u2028\u202e]/);
      expect(error.message).toContain('\\u202e');
    });

    it('accepts index 0 and writes m-00.in', async () => {
      mockSdk.getTests.mockResolvedValue([
        { index: 0, manual: true, input: 'zero', useInStatements: false },
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
      expect(result.testset.manualTests![0]).toMatchObject({
        input: './manual/tests/m-00.in',
        index: 0,
      });
      expect(vi.mocked(fs.writeFileSync).mock.calls[0][0]).toMatch(/m-00\.in$/);
    });

    it('does not check the index of tests that are not manual', async () => {
      mockSdk.getTests.mockResolvedValue([
        { index: -1, manual: false, input: 'x', useInStatements: false },
        { index: 1.5, manual: false, useInStatements: false },
        { index: -2, manual: true, useInStatements: false },
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
      expect(fs.writeFileSync).not.toHaveBeenCalled();
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

  describe('names from Polygon are plain file names', () => {
    const written = () =>
      vi.mocked(fs.writeFileSync).mock.calls.map(c => String(c[0]));

    it('accepts legitimate names with spaces, dots and extensions', () => {
      for (const name of ['my sol.v2.cpp', 'a b.py', 'Main.java', '.hidden']) {
        expect(pulling.assertPlainName(name)).toBe(name);
      }
    });

    it('refuses names with newline, ESC, C1 or bidi characters, so they never reach Config.json', async () => {
      for (const name of ['a\nb.cpp', 'a\x1b[2Jb', 'a\u009bb', 'a\u202eb']) {
        expect(() => pulling.assertPlainName(name)).toThrow(/unsafe name/);
      }
      mockSdk.getSolutions.mockResolvedValue([
        { name: 'a\n  forged.cpp', tag: 'OK' },
        { name: 'ünï 😀.cpp', tag: 'OK' },
      ] as never);
      mockSdk.viewSolution.mockResolvedValue('code');
      const result = await pulling.downloadSolutions(asSdk(mockSdk), 1, 'dir');
      expect(result.data.map(s => s.name)).toEqual(['ünï 😀']);
    });

    it('printable escapes control characters but keeps non-ASCII text', () => {
      expect(pulling.printable('ünï 😀 日本.cpp')).toBe('ünï 😀 日本.cpp');
      expect(pulling.printable('a\nb\u2028c\u2067d')).toBe(
        'a\\u000ab\\u2028c\\u2067d'
      );
    });

    it('refuses empty, dot, NUL and separator names', () => {
      for (const name of ['', '.', '..', 'a\0b', 'a/b', 'a\\b', '../x']) {
        expect(() => pulling.assertPlainName(name)).toThrow(/unsafe name/);
      }
    });

    it('tells the user why a solution was refused and keeps going', async () => {
      mockSdk.getSolutions.mockResolvedValue([
        { name: '../../evil.cpp', tag: 'MA' },
        { name: 'ok.cpp', tag: 'OK' },
      ] as never);
      mockSdk.viewSolution.mockResolvedValue('code');

      const result = await pulling.downloadSolutions(asSdk(mockSdk), 1, 'dir');

      expect(result.data.map(s => s.name)).toEqual(['ok']);
      const warnings = vi.mocked(fmt).warning.mock.calls.map(c => c[0]);
      expect(warnings.some(w => w.includes('Refusing unsafe name'))).toBe(true);
    });

    it('skips only the unsafe statement language, not the others', async () => {
      mockSdk.getStatements.mockResolvedValue({
        '../../evil': { name: 'x', legend: 'bad' },
        english: { name: 'Problem', legend: 'good' },
      } as never);

      const result = await pulling.downloadStatements(asSdk(mockSdk), 1, 'dir');

      expect(Object.keys(result.config)).toEqual(['english']);
      expect(written().some(p => p.includes('evil'))).toBe(false);
      expect(written().some(p => p.includes('legend.tex'))).toBe(true);
      expect(result.failures).toEqual([
        {
          component: 'statement',
          name: '../../evil',
          error: 'Refusing unsafe name from Polygon: "../../evil"',
          message:
            'Could not download the statement "../../evil" (Refusing unsafe name from Polygon: "../../evil"): Config.json does not list it',
        },
      ]);
    });

    it('does not write a solution whose name climbs out of the directory', async () => {
      mockSdk.getSolutions.mockResolvedValue([
        { name: '../../evil.cpp', tag: 'MA' },
        { name: 'ok.cpp', tag: 'OK' },
      ] as never);
      mockSdk.viewSolution.mockResolvedValue('code');

      const result = await pulling.downloadSolutions(asSdk(mockSdk), 1, 'dir');

      expect(written().some(p => p.includes('evil'))).toBe(false);
      expect(mockSdk.viewSolution).not.toHaveBeenCalledWith(
        1,
        '../../evil.cpp'
      );
      expect(result.count).toBe(1);
    });

    it('does not write a generator whose name has a path separator', async () => {
      mockSdk.getFiles.mockResolvedValue({
        sourceFiles: [
          { name: '..\\..\\evil.cpp', sourceType: 'cpp.g++17' },
          { name: 'sub/evil.cpp', sourceType: 'cpp.g++17' },
        ],
        resourceFiles: [],
        auxFiles: [],
      } as never);
      mockSdk.viewFile.mockResolvedValue('code');

      const result = await pulling.downloadGenerators(
        asSdk(mockSdk),
        1,
        'dir',
        []
      );

      expect(written()).toEqual([]);
      expect(result.count).toBe(0);
    });

    it('does not write a checker or validator with a traversal name', async () => {
      mockSdk.getChecker.mockResolvedValue('../../evil.cpp');
      mockSdk.getValidator.mockResolvedValue('../evil.cpp');
      mockSdk.viewFile.mockResolvedValue('code');

      await pulling.downloadChecker(asSdk(mockSdk), 1, 'dir');
      await pulling.downloadValidator(asSdk(mockSdk), 1, 'dir');

      expect(written()).toEqual([]);
    });

    it('does not create statement folders from a traversal language name', async () => {
      mockSdk.getStatements.mockResolvedValue({
        '../../evil': { name: 'x', legend: 'text' },
      } as never);

      await pulling.downloadStatements(asSdk(mockSdk), 1, 'dir');

      expect(written()).toEqual([]);
      expect(vi.mocked(fs.mkdirSync)).not.toHaveBeenCalled();
    });

    it('falls back to the default checker and says why when the name is unsafe', async () => {
      mockSdk.getChecker.mockResolvedValue('../../evil.cpp');

      const result = await pulling.downloadChecker(asSdk(mockSdk), 1, 'dir');

      expect(result.data).toEqual({
        name: 'ncmp',
        source: 'ncmp.cpp',
        isStandard: true,
      });
      expect(result.count).toBe(0);
      expect(mockSdk.viewFile).not.toHaveBeenCalled();
      const errors = vi.mocked(fmt).error.mock.calls.map(c => c[0]);
      expect(errors.some(e => e.includes('Refusing unsafe name'))).toBe(true);
    });

    it('refuses a standard checker name that climbs out after std:: is removed', async () => {
      mockSdk.getChecker.mockResolvedValue('std::../evil.cpp');

      const result = await pulling.downloadChecker(asSdk(mockSdk), 1, 'dir');

      expect(result.data.source).toBe('ncmp.cpp');
      expect(written()).toEqual([]);
    });

    it('says no validator is set, not unsafe, when Polygon returns an empty name', async () => {
      mockSdk.getValidator.mockResolvedValue('');

      const result = await pulling.downloadValidator(
        asSdk(mockSdk),
        265691,
        'dir'
      );

      expect(result.data).toEqual({
        name: 'validator',
        source: './validator/val.cpp',
      });
      expect(result.count).toBe(0);
      expect(result.missing).toBe(true);
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join('dir', 'validator'), {
        recursive: true,
      });
      expect(fs.writeFileSync).not.toHaveBeenCalled();
      expect(mockSdk.viewFile).not.toHaveBeenCalled();
      const warnings = vi.mocked(fmt).warning.mock.calls.map(c => c[0]);
      expect(
        warnings.some(w =>
          w.includes('No validator set on Polygon for problem 265691')
        )
      ).toBe(true);
      const errors = vi.mocked(fmt).error.mock.calls.map(c => c[0]);
      expect(errors.some(e => e.includes('unsafe'))).toBe(false);
    });

    it('does not flag a refused unsafe name as a missing validator', async () => {
      mockSdk.getValidator.mockResolvedValue('../x');

      const result = await pulling.downloadValidator(asSdk(mockSdk), 1, 'dir');

      expect(result.missing).toBeUndefined();
      const errors = vi.mocked(fmt).error.mock.calls.map(c => c[0]);
      expect(errors.some(e => e.includes('Refusing unsafe name'))).toBe(true);
    });

    it('falls back to the default validator and says why when the name is unsafe', async () => {
      mockSdk.getValidator.mockResolvedValue('..\\evil.cpp');

      const result = await pulling.downloadValidator(asSdk(mockSdk), 1, 'dir');

      expect(result.data).toEqual({
        name: 'validator',
        source: './validator/val.cpp',
      });
      expect(result.count).toBe(0);
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join('dir', 'validator'), {
        recursive: true,
      });
      expect(mockSdk.viewFile).not.toHaveBeenCalled();
      const errors = vi.mocked(fmt).error.mock.calls.map(c => c[0]);
      expect(errors.some(e => e.includes('Refusing unsafe name'))).toBe(true);
    });

    it('still downloads the safe generators around an unsafe one and warns', async () => {
      mockSdk.getFiles.mockResolvedValue({
        sourceFiles: [
          { name: 'gen1.cpp', sourceType: 'cpp.g++17' },
          { name: '../../evil.cpp', sourceType: 'cpp.g++17' },
          { name: 'gen2.cpp', sourceType: 'cpp.g++17' },
        ],
        resourceFiles: [],
        auxFiles: [],
      } as never);
      mockSdk.viewFile.mockResolvedValue('code');

      const result = await pulling.downloadGenerators(
        asSdk(mockSdk),
        1,
        'dir',
        []
      );

      expect(result.data.map(g => g.name)).toEqual(['gen1', 'gen2']);
      expect(result.count).toBe(2);
      expect(written().some(p => p.includes('evil'))).toBe(false);
      const warnings = vi.mocked(fmt).warning.mock.calls.map(c => c[0]);
      expect(warnings.some(w => w.includes('Refusing unsafe name'))).toBe(true);
    });

    it('falls back to the default solution when every solution name is unsafe', async () => {
      mockSdk.getSolutions.mockResolvedValue([
        { name: '../evil.cpp', tag: 'MA' },
        { name: 'sub/evil.cpp', tag: 'OK' },
      ] as never);

      const result = await pulling.downloadSolutions(asSdk(mockSdk), 1, 'dir');

      expect(result.count).toBe(0);
      expect(result.data[0]?.source).toBe('./solutions/acc.cpp');
      expect(fs.mkdirSync).toHaveBeenCalledWith(path.join('dir', 'solutions'), {
        recursive: true,
      });
      expect(mockSdk.viewSolution).not.toHaveBeenCalled();
      expect(written()).toEqual([]);
    });

    it('refuses a name that is not a string', () => {
      expect(() => pulling.assertPlainName(undefined as never)).toThrow(
        /unsafe name/
      );
      expect(() => pulling.assertPlainName(42 as never)).toThrow(/unsafe name/);
    });

    it.each(['..', '.', '', 'a/b', 'a\\b', '../..'])(
      'skips statement language %j and warns, keeping the other languages',
      async lang => {
        mockSdk.getStatements.mockResolvedValue({
          [lang]: { name: 'x', legend: 'bad' },
          english: { name: 'Problem', legend: 'good' },
        } as never);

        const result = await pulling.downloadStatements(
          asSdk(mockSdk),
          1,
          'dir'
        );

        expect(Object.keys(result.config)).toEqual(['english']);
        const warnings = vi.mocked(fmt).warning.mock.calls.map(c => c[0]);
        expect(warnings.some(w => w.includes('Skipping statement'))).toBe(true);
        expect(written().every(p => p.includes('english'))).toBe(true);
      }
    );

    it('escapes control characters in names echoed in warnings', async () => {
      const evil = 'a\n  ✔ forged\x1b[2J\u009b\u202eb.cpp';
      mockSdk.getSolutions.mockResolvedValue([
        { name: evil, tag: 'OK' },
      ] as never);
      mockSdk.viewSolution.mockRejectedValue(new Error(`no ${evil}`));
      mockSdk.getFiles.mockResolvedValue({
        sourceFiles: [{ name: evil, sourceType: 'cpp.g++17' }],
      } as never);
      mockSdk.viewFile.mockRejectedValue(new Error(`no ${evil}`));
      mockSdk.getStatements.mockResolvedValue({
        [evil + '/x']: { name: 'x' },
      } as never);

      await pulling.downloadSolutions(asSdk(mockSdk), 1, 'dir');
      await pulling.downloadGenerators(asSdk(mockSdk), 1, 'dir', []);
      await pulling.downloadStatements(asSdk(mockSdk), 1, 'dir');

      const warnings = vi.mocked(fmt).warning.mock.calls.map(c => c[0]);
      expect(warnings.length).toBeGreaterThanOrEqual(3);
      for (const w of warnings) {
        // eslint-disable-next-line no-control-regex
        expect(w).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e]/);
      }
    });

    it('escapes control characters in the reason for checker and validator failures', async () => {
      const evil = 'boom\n  ✔ forged\x1b[2J\u009b\u202e';
      mockSdk.getChecker.mockResolvedValue('check.cpp');
      mockSdk.getValidator.mockResolvedValue('val.cpp');
      mockSdk.viewFile.mockRejectedValue(new Error(evil));

      await pulling.downloadChecker(asSdk(mockSdk), 1, 'dir');
      await pulling.downloadValidator(asSdk(mockSdk), 1, 'dir');

      const errors = vi.mocked(fmt).error.mock.calls.map(c => c[0]);
      expect(errors.length).toBeGreaterThanOrEqual(2);
      for (const e of errors) {
        // eslint-disable-next-line no-control-regex
        expect(e).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e]/);
      }
    });
  });
});
