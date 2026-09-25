import type { ReadStream } from 'fs';
import fs from 'fs';
import path from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { executor } from '../../src/executor';
import { fmt } from '../../src/formatter';
import { cachedCompile } from '../../src/helpers/compile-cache';
import * as utils from '../../src/helpers/utils';
import type {
  LocalChecker,
  LocalGenerator,
  LocalSolution,
  LocalValidator,
} from '../../src/types';

// Manual mock for fs
vi.mock('fs', () => {
  return {
    default: {
      existsSync: vi.fn(),
      rmSync: vi.fn(),
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(),
      readdirSync: vi.fn(() => []),
      readFileSync: vi.fn(),
      createReadStream: vi.fn(),
    },
  };
});

vi.mock('../../src/executor');
vi.mock('../../src/formatter');
// Pass-through: compile-cache.test.ts covers the cache itself.
vi.mock('../../src/helpers/compile-cache', () => ({
  cachedCompile: vi.fn(
    async (_request: unknown, compile: () => Promise<unknown>) => {
      await compile();
    }
  ),
}));

// Mock specific console methods to avoid clutter
const mockExit = vi
  .spyOn(process, 'exit')
  .mockImplementation((_code?: string | number | null) => {
    throw new Error('process.exit called');
  });

const executorMocked = vi.mocked(executor);
const fmtMocked = vi.mocked(fmt);
const executeMock = () => executorMocked['execute'];
const fmtErrorMock = () => fmtMocked['error'];

// Typed helpers for fs mocks (avoid `unbound-method` from passing mocked fns directly)
const readdirSyncMock = vi.mocked(fs.readdirSync);
const existsSyncMock = vi.mocked(fs.existsSync);
const mkdirSyncMock = vi.mocked(fs.mkdirSync);
const rmSyncMock = vi.mocked(fs.rmSync);
const readFileSyncMock = vi.mocked(fs.readFileSync);
const createReadStreamMock = vi.mocked(fs.createReadStream);

/**
 * Builds a minimal stand-in for `fs.ReadStream` whose `on` method routes to
 * the supplied implementation. Returned through `ReadStream` so the mocked
 * `createReadStream` signature is satisfied without `any`.
 */
function makeReadStreamStub(
  on: (event: string, cb: (arg: string | Error | undefined) => void) => unknown
): ReadStream {
  const stub: Pick<ReadStream, 'on' | 'close'> = {
    on: on as unknown as ReadStream['on'],
    close: vi.fn() as unknown as ReadStream['close'],
  };
  return stub as ReadStream;
}

describe('utils.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isNumeric', () => {
    it('should return true for numeric strings', () => {
      expect(utils.isNumeric('123')).toBe(true);
      expect(utils.isNumeric('0')).toBe(true);
      expect(utils.isNumeric('-1')).toBe(true);
    });
    it('should return false for non-numeric strings', () => {
      expect(utils.isNumeric('abc')).toBe(false);
      expect(utils.isNumeric('12a')).toBe(true); // Int parsing behavior
      expect(utils.isNumeric('all')).toBe(false);
    });
  });

  describe('filterTestsByRange', () => {
    const testFiles = ['test1.txt', 'test2.txt', 'test3.txt', 'not-test.txt'];
    it('should return all tests if no range is specified', () => {
      expect(utils.filterTestsByRange(testFiles)).toEqual(testFiles);
    });
    it('should filter by range', () => {
      expect(utils.filterTestsByRange(testFiles, 2, 3)).toEqual([
        'test2.txt',
        'test3.txt',
      ]);
    });
    it('should ignore non-test files during filtering', () => {
      expect(utils.filterTestsByRange(testFiles, 1, 3)).toEqual([
        'test1.txt',
        'test2.txt',
        'test3.txt',
      ]);
    });
    it('should handle NaN parsing gracefully', () => {
      expect(utils.filterTestsByRange(['testA.txt'], 1, 10)).toEqual([]);
    });
  });

  describe('getTestFiles', () => {
    it('should return sorted test files', () => {
      // `fs.readdirSync` is overloaded; cast to the string-array branch.
      (
        readdirSyncMock as unknown as ReturnType<
          typeof vi.fn<(p: string) => string[]>
        >
      ).mockReturnValue(['test10.txt', 'test2.txt', 'other.txt']);
      const result = utils.getTestFiles('dir');
      expect(result).toEqual(['test2.txt', 'test10.txt']);
    });
  });

  describe('Compilation', () => {
    describe('compileCPP', () => {
      beforeEach(() => {
        // Drop any Config.json stub left behind by a previous test.
        readFileSyncMock.mockReset();
      });

      it('should compile cpp file with -O2 and C++23 by default', async () => {
        await utils.compileCPP('main.cpp');

        expect(executeMock()).toHaveBeenCalledWith(
          expect.stringContaining('g++ -O2 -std=c++23 -iquote'),
          expect.anything()
        );
      });

      it('should honor the cppStandard option', async () => {
        await utils.compileCPP('main.cpp', { cppStandard: 'c++17' });

        expect(executeMock()).toHaveBeenCalledWith(
          expect.stringContaining('g++ -O2 -std=c++17 -iquote'),
          expect.anything()
        );
      });

      it('should read cppStandard from Config.json when no option given', async () => {
        (
          readFileSyncMock as unknown as ReturnType<
            typeof vi.fn<(...args: unknown[]) => string>
          >
        ).mockReturnValue('{"cppStandard": "c++20"}');

        await utils.compileCPP('main.cpp');

        expect(executeMock()).toHaveBeenCalledWith(
          expect.stringContaining('-std=c++20 '),
          expect.anything()
        );
      });

      it('should reject an invalid cppStandard from Config.json', async () => {
        (
          readFileSyncMock as unknown as ReturnType<
            typeof vi.fn<(...args: unknown[]) => string>
          >
        ).mockReturnValue('{"cppStandard": "c++23; rm -rf /"}');

        await expect(utils.compileCPP('main.cpp')).rejects.toThrow(
          /Invalid cppStandard/
        );
        expect(executeMock()).not.toHaveBeenCalled();
      });

      it.each(['.cc', '.cxx'])(
        'should compile %s file and strip the extension for the output',
        async ext => {
          const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/p');
          try {
            await utils.compileCPP(`solutions/main${ext}`);

            expect(executeMock()).toHaveBeenCalledWith(
              expect.stringContaining(
                `-o '/p/solutions/main' '/p/solutions/main${ext}'`
              ),
              expect.anything()
            );
          } finally {
            cwdSpy.mockRestore();
          }
        }
      );

      it.skipIf(process.platform === 'win32')(
        'should protect C++ paths containing spaces and parentheses',
        async () => {
          const cwdSpy = vi
            .spyOn(process, 'cwd')
            .mockReturnValue('/tmp/polyman path 3)test');

          try {
            await utils.compileCPP('gen.cpp');

            expect(executeMock()).toHaveBeenCalledWith(
              "g++ -O2 -std=c++23 -iquote '/tmp/polyman path 3)test' " +
                "-o '/tmp/polyman path 3)test/gen' " +
                "'/tmp/polyman path 3)test/gen.cpp'",
              expect.anything()
            );
          } finally {
            cwdSpy.mockRestore();
          }
        }
      );

      it('should throw if file is not a C++ source', async () => {
        await expect(utils.compileCPP('main.c')).rejects.toThrow(
          /Expected .cpp\/.cc\/.cxx file/
        );
        expect(executeMock()).not.toHaveBeenCalled();
      });

      it('should route the compile through the cache with its inputs', async () => {
        const cwd = path.resolve('/p');
        const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd);
        try {
          await utils.compileCPP('solutions/main.cpp', {
            cppStandard: 'c++20',
          });

          const output = path.join(cwd, 'solutions', 'main');
          expect(vi.mocked(cachedCompile)).toHaveBeenCalledWith(
            {
              sourcePath: path.join(cwd, 'solutions', 'main.cpp'),
              binaryPath:
                process.platform === 'win32' ? `${output}.exe` : output,
              compiler: 'g++',
              flags: ['-O2', '-std=c++20'],
              includeDirs: [cwd],
            },
            expect.any(Function)
          );
        } finally {
          cwdSpy.mockRestore();
        }
      });
    });

    describe('C++ source helpers', () => {
      beforeEach(() => {
        readFileSyncMock.mockReset();
      });

      it('isCppSource recognises .cpp, .cc and .cxx (case-insensitively)', () => {
        expect(utils.isCppSource('a/b/main.cpp')).toBe(true);
        expect(utils.isCppSource('main.cc')).toBe(true);
        expect(utils.isCppSource('main.cxx')).toBe(true);
        expect(utils.isCppSource('MAIN.CPP')).toBe(true);
        expect(utils.isCppSource('main.c')).toBe(false);
        expect(utils.isCppSource('main.py')).toBe(false);
        expect(utils.isCppSource('testlib.h')).toBe(false);
      });

      it('stripCppExtension removes only C++ extensions', () => {
        expect(utils.stripCppExtension('/p/main.cpp')).toBe('/p/main');
        expect(utils.stripCppExtension('/p/main.cc')).toBe('/p/main');
        expect(utils.stripCppExtension('/p/main.cxx')).toBe('/p/main');
        expect(utils.stripCppExtension('/p/Main.java')).toBe('/p/Main.java');
        expect(utils.stripCppExtension('ncmp')).toBe('ncmp');
      });

      it('resolveCppStandard falls back to c++23 without Config.json', () => {
        readFileSyncMock.mockImplementation(() => {
          throw new Error('ENOENT');
        });
        expect(utils.resolveCppStandard()).toBe(utils.DEFAULT_CPP_STANDARD);
        expect(utils.DEFAULT_CPP_STANDARD).toBe('c++23');
      });

      it('resolveCppStandard falls back to c++23 when the field is absent', () => {
        (
          readFileSyncMock as unknown as ReturnType<
            typeof vi.fn<(...args: unknown[]) => string>
          >
        ).mockReturnValue('{"solutions": []}');
        expect(utils.resolveCppStandard()).toBe('c++23');
      });

      it.each(['c++11', 'c++17', 'gnu++20', 'c++2b', 'c++26'])(
        'resolveCppStandard accepts %s',
        std => {
          (
            readFileSyncMock as unknown as ReturnType<
              typeof vi.fn<(...args: unknown[]) => string>
            >
          ).mockReturnValue(JSON.stringify({ cppStandard: std }));
          expect(utils.resolveCppStandard()).toBe(std);
        }
      );

      it.each(['17', 'c++', 'c++23 -fno-exceptions', 23])(
        'resolveCppStandard rejects %s',
        std => {
          (
            readFileSyncMock as unknown as ReturnType<
              typeof vi.fn<(...args: unknown[]) => string>
            >
          ).mockReturnValue(JSON.stringify({ cppStandard: std }));
          expect(() => utils.resolveCppStandard()).toThrow(
            /Invalid cppStandard/
          );
        }
      );
    });

    describe('compileJava', () => {
      it('should compile java file', async () => {
        await utils.compileJava('Main.java');
        expect(executeMock()).toHaveBeenCalledWith(
          expect.stringContaining('javac'),
          expect.anything()
        );
      });

      it.skipIf(process.platform === 'win32')(
        'should protect Java source paths containing spaces and parentheses',
        async () => {
          const cwdSpy = vi
            .spyOn(process, 'cwd')
            .mockReturnValue('/tmp/polyman path 3)test');

          try {
            await utils.compileJava('Main.java');

            expect(executeMock()).toHaveBeenCalledWith(
              "javac '/tmp/polyman path 3)test/Main.java'",
              expect.anything()
            );
          } finally {
            cwdSpy.mockRestore();
          }
        }
      );
    });
  });

  describe('Directories', () => {
    describe('ensureDirectoryExists', () => {
      it('should create directory if missing', () => {
        existsSyncMock.mockReturnValue(false);
        utils.ensureDirectoryExists('new-dir');
        expect(mkdirSyncMock).toHaveBeenCalledWith(
          expect.stringContaining('new-dir'),
          { recursive: true }
        );
      });
      it('should do nothing if directory exists', () => {
        existsSyncMock.mockReturnValue(true);
        utils.ensureDirectoryExists('exists');
        expect(mkdirSyncMock).not.toHaveBeenCalled();
      });
    });

    describe('removeDirectoryRecursively', () => {
      it('should remove directory if exists', () => {
        existsSyncMock.mockReturnValue(true);
        utils.removeDirectoryRecursively('del-dir');
        expect(rmSyncMock).toHaveBeenCalledWith(
          expect.stringContaining('del-dir'),
          { recursive: true, force: true }
        );
      });
      it('should do nothing if directory missing', () => {
        existsSyncMock.mockReturnValue(false);
        utils.removeDirectoryRecursively('missing');
        expect(rmSyncMock).not.toHaveBeenCalled();
      });
    });
  });

  describe('readConfigFile', () => {
    it('should return parsed config', () => {
      (
        readFileSyncMock as unknown as ReturnType<
          typeof vi.fn<(...args: unknown[]) => string>
        >
      ).mockReturnValue('{"solutions": []}');
      expect(utils.readConfigFile()).toEqual({ solutions: [] });
    });
    it('should throw if file reading fails', () => {
      readFileSyncMock.mockImplementation(() => {
        throw new Error('Fail');
      });
      expect(() => utils.readConfigFile()).toThrow('Fail');
    });
  });

  describe('readFirstLine', () => {
    it('should return first line from stream', async () => {
      const onImpl = (
        event: string,
        cb: (arg: string | Error | undefined) => void
      ): unknown => {
        if (event === 'data') {
          setTimeout(() => cb('first line\nsecond line'), 0);
        }
        return undefined;
      };
      createReadStreamMock.mockReturnValue(makeReadStreamStub(onImpl));
      await expect(utils.readFirstLine('file.txt')).resolves.toBe('first line');
    });

    it('should handle empty file', async () => {
      const onImpl = (
        event: string,
        cb: (arg: string | Error | undefined) => void
      ): unknown => {
        if (event === 'end') {
          setTimeout(() => cb(undefined), 0);
        }
        return undefined;
      };
      createReadStreamMock.mockReturnValue(makeReadStreamStub(onImpl));
      await expect(utils.readFirstLine('file.txt')).resolves.toBe('');
    });

    it('should handle stream error', async () => {
      const onImpl = (
        event: string,
        cb: (arg: string | Error | undefined) => void
      ): unknown => {
        if (event === 'error') {
          setTimeout(() => cb(new Error('Stream Error')), 0);
        }
        return undefined;
      };
      createReadStreamMock.mockReturnValue(makeReadStreamStub(onImpl));
      await expect(utils.readFirstLine('file.txt')).rejects.toThrow(
        'Stream Error'
      );
    });
  });

  describe('getCompiledCommandToRun', () => {
    it('should handle .cpp', () => {
      const obj: LocalSolution = {
        source: 'main.cpp',
        name: 'main',
        tag: 'MA',
      };
      expect(utils.getCompiledCommandToRun(obj)).toContain('main');
      expect(utils.getCompiledCommandToRun(obj)).not.toContain('.cpp');
    });

    it.each(['.cc', '.cxx'])('should handle %s like .cpp', ext => {
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue('/p');
      const obj: LocalSolution = {
        source: `solutions/main${ext}`,
        name: 'main',
        tag: 'MA',
      };
      try {
        expect(utils.getCompiledCommandToRun(obj)).toBe("'/p/solutions/main'");
      } finally {
        cwdSpy.mockRestore();
      }
    });

    it.skipIf(process.platform === 'win32')(
      'should protect C++ executable paths containing shell metacharacters',
      () => {
        const cwdSpy = vi
          .spyOn(process, 'cwd')
          .mockReturnValue("/tmp/polyman path 3)'test");
        const obj: LocalSolution = {
          source: 'main.cpp',
          name: 'main',
          tag: 'MA',
        };

        try {
          expect(utils.getCompiledCommandToRun(obj)).toBe(
            "'/tmp/polyman path 3)'\\''test/main'"
          );
        } finally {
          cwdSpy.mockRestore();
        }
      }
    );

    it('should handle .java', () => {
      const obj: LocalSolution = {
        source: 'pkg/Main.java',
        name: 'Main',
        tag: 'MA',
      };
      // Should return java -cp ... Main
      expect(utils.getCompiledCommandToRun(obj)).toContain('java -cp');
    });

    it.skipIf(process.platform === 'win32')(
      'should protect Java classpath paths containing shell metacharacters',
      () => {
        const cwdSpy = vi
          .spyOn(process, 'cwd')
          .mockReturnValue("/tmp/polyman path 3)'test");
        const obj: LocalSolution = {
          source: 'pkg/Main.java',
          name: 'Main',
          tag: 'MA',
        };

        try {
          const command = utils.getCompiledCommandToRun(obj);
          expect(command).toContain(
            "java -cp '/tmp/polyman path 3)'\\''test/pkg'"
          );
          expect(command).toContain("'Main'");
        } finally {
          cwdSpy.mockRestore();
        }
      }
    );

    it('should handle .py', () => {
      const obj: LocalSolution = {
        source: 'script.py',
        name: 'script',
        tag: 'MA',
      };
      expect(utils.getCompiledCommandToRun(obj)).toContain('python');
    });

    it.skipIf(process.platform === 'win32')(
      'should protect Python source paths containing shell metacharacters',
      () => {
        const cwdSpy = vi
          .spyOn(process, 'cwd')
          .mockReturnValue("/tmp/polyman path 3)'test");
        const obj: LocalSolution = {
          source: 'script.py',
          name: 'script',
          tag: 'MA',
        };

        try {
          expect(utils.getCompiledCommandToRun(obj)).toBe(
            "python '/tmp/polyman path 3)'\\''test/script.py'"
          );
        } finally {
          cwdSpy.mockRestore();
        }
      }
    );

    it('should handle .js', () => {
      const obj: LocalSolution = {
        source: 'script.js',
        name: 'script',
        tag: 'MA',
      };
      expect(utils.getCompiledCommandToRun(obj)).toContain('node');
    });

    it.skipIf(process.platform === 'win32')(
      'should protect JavaScript source paths containing shell metacharacters',
      () => {
        const cwdSpy = vi
          .spyOn(process, 'cwd')
          .mockReturnValue("/tmp/polyman path 3)'test");
        const obj: LocalSolution = {
          source: 'script.js',
          name: 'script',
          tag: 'MA',
        };

        try {
          expect(utils.getCompiledCommandToRun(obj)).toBe(
            "node '/tmp/polyman path 3)'\\''test/script.js'"
          );
        } finally {
          cwdSpy.mockRestore();
        }
      }
    );

    it('should throw on unknown extension', () => {
      const obj: LocalGenerator = { source: 'script.rb', name: 'script' };
      expect(() => utils.getCompiledCommandToRun(obj)).toThrow(
        /Unsupported source file extension/
      );
    });

    it('should handle standard checkers', () => {
      const obj: LocalChecker = {
        source: 'std.cpp',
        name: 'std',
        isStandard: true,
      };
      const res = utils.getCompiledCommandToRun(obj);
      expect(res).toContain('assets/checkers/std');
    });

    it('should not include cpp extension for standard checkers', () => {
      const obj: LocalChecker = {
        source: 'std.cpp',
        name: 'std',
        isStandard: true,
      };
      const res = utils.getCompiledCommandToRun(obj);
      expect(res).not.toContain('std.cpp');
    });
  });

  describe('Error Handling', () => {
    it('logError should call fmt.error', () => {
      utils.logError('message');
      expect(fmtErrorMock()).toHaveBeenCalled();
    });

    it('logErrorAndExit should call process.exit', () => {
      try {
        utils.logErrorAndExit('fatal');
      } catch (e) {
        expect(e instanceof Error).toBe(true);
        expect((e as Error).message).toBe('process.exit called');
      }
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('logErrorAndThrow should throw', () => {
      expect(() => utils.logErrorAndThrow('bad')).toThrow();
    });

    it('throwError should format error', () => {
      expect(() => utils.throwError('str error', 'ctx')).toThrow(
        /ctx: str error/
      );
    });
  });

  // Reference unused imports so TypeScript keeps them when stripping.
  void ([] as LocalValidator[]);
});
