import type { ReadStream } from 'fs';
import fs from 'fs';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { executor } from '../../src/executor';
import { fmt } from '../../src/formatter';
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
    const cwd = '/tmp/polyman path 3)test';

    /** Makes `Config.json` in cwd resolve to the given content. */
    function mockConfig(content: string | undefined): void {
      existsSyncMock.mockImplementation(p => {
        return content !== undefined && String(p).endsWith('Config.json');
      });
      readFileSyncMock.mockImplementation(p => {
        if (content !== undefined && String(p).endsWith('Config.json')) {
          return content;
        }
        throw new Error(`unexpected read: ${String(p)}`);
      });
    }

    let cwdSpy: MockInstance<() => string>;

    beforeEach(() => {
      cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(cwd);
      mockConfig(undefined);
      delete process.env['POLYMAN_CXX'];
      delete process.env['POLYMAN_JAVAC'];
    });

    afterEach(() => {
      cwdSpy.mockRestore();
      delete process.env['POLYMAN_CXX'];
      delete process.env['POLYMAN_JAVAC'];
    });

    describe('resolveCppCompiler', () => {
      it('defaults to g++ without env or config', () => {
        expect(utils.resolveCppCompiler()).toBe('g++');
      });

      it('reads compiler.cpp from Config.json', () => {
        mockConfig(JSON.stringify({ compiler: { cpp: 'g++-15' } }));
        expect(utils.resolveCppCompiler()).toBe('g++-15');
      });

      it('prefers POLYMAN_CXX over Config.json', () => {
        mockConfig(JSON.stringify({ compiler: { cpp: 'g++-15' } }));
        process.env['POLYMAN_CXX'] = 'clang++';
        expect(utils.resolveCppCompiler()).toBe('clang++');
      });

      it('ignores blank env and config values', () => {
        mockConfig(JSON.stringify({ compiler: { cpp: '   ' } }));
        process.env['POLYMAN_CXX'] = '';
        expect(utils.resolveCppCompiler()).toBe('g++');
      });

      it('falls back to g++ when Config.json is malformed', () => {
        mockConfig('{ not json');
        expect(utils.resolveCppCompiler()).toBe('g++');
      });
    });

    describe('resolveCppFlags', () => {
      it('is empty without config', () => {
        expect(utils.resolveCppFlags()).toEqual([]);
      });

      it('returns compiler.flags from Config.json', () => {
        mockConfig(
          JSON.stringify({ compiler: { flags: ['-O2', '-std=c++23'] } })
        );
        expect(utils.resolveCppFlags()).toEqual(['-O2', '-std=c++23']);
      });

      it('drops non-string and empty entries', () => {
        mockConfig(
          JSON.stringify({ compiler: { flags: ['-O2', 3, '', null] } })
        );
        expect(utils.resolveCppFlags()).toEqual(['-O2']);
      });
    });

    describe('resolveJavaCompiler', () => {
      it('defaults to javac', () => {
        expect(utils.resolveJavaCompiler()).toBe('javac');
      });

      it('reads compiler.javac from Config.json', () => {
        mockConfig(
          JSON.stringify({ compiler: { javac: '/opt/jdk/bin/javac' } })
        );
        expect(utils.resolveJavaCompiler()).toBe('/opt/jdk/bin/javac');
      });

      it('prefers POLYMAN_JAVAC over Config.json', () => {
        mockConfig(
          JSON.stringify({ compiler: { javac: '/opt/jdk/bin/javac' } })
        );
        process.env['POLYMAN_JAVAC'] = 'javac-21';
        expect(utils.resolveJavaCompiler()).toBe('javac-21');
      });
    });

    describe('compileCPP', () => {
      it('should compile cpp file with g++ by default', async () => {
        await utils.compileCPP('main.cpp');

        expect(executeMock()).toHaveBeenCalledWith(
          expect.stringMatching(/^['"]g\+\+['"] -iquote/),
          expect.anything()
        );
      });

      it.skipIf(process.platform === 'win32')(
        'should protect C++ paths containing spaces and parentheses',
        async () => {
          await utils.compileCPP('gen.cpp');

          expect(executeMock()).toHaveBeenCalledWith(
            "'g++' -iquote '/tmp/polyman path 3)test' " +
              "-o '/tmp/polyman path 3)test/gen' " +
              "'/tmp/polyman path 3)test/gen.cpp'",
            expect.anything()
          );
        }
      );

      it.skipIf(process.platform === 'win32')(
        'should use compiler.cpp and compiler.flags from Config.json',
        async () => {
          mockConfig(
            JSON.stringify({
              compiler: { cpp: 'g++-15', flags: ['-O2', '-std=c++23'] },
            })
          );

          await utils.compileCPP('gen.cpp');

          expect(executeMock()).toHaveBeenCalledWith(
            "'g++-15' '-O2' '-std=c++23' -iquote '/tmp/polyman path 3)test' " +
              "-o '/tmp/polyman path 3)test/gen' " +
              "'/tmp/polyman path 3)test/gen.cpp'",
            expect.anything()
          );
        }
      );

      it.skipIf(process.platform === 'win32')(
        'should let POLYMAN_CXX override Config.json and quote paths with spaces',
        async () => {
          mockConfig(JSON.stringify({ compiler: { cpp: 'g++-15' } }));
          process.env['POLYMAN_CXX'] = '/opt/my compilers/bin/clang++';

          await utils.compileCPP('gen.cpp');

          expect(executeMock()).toHaveBeenCalledWith(
            "'/opt/my compilers/bin/clang++' -iquote '/tmp/polyman path 3)test' " +
              "-o '/tmp/polyman path 3)test/gen' " +
              "'/tmp/polyman path 3)test/gen.cpp'",
            expect.anything()
          );
        }
      );

      it('should throw if file is not .cpp', async () => {
        await expect(utils.compileCPP('main.c')).rejects.toThrow(
          /Expected .cpp file/
        );
      });
    });

    describe('compileJava', () => {
      it('should compile java file with javac by default', async () => {
        await utils.compileJava('Main.java');
        expect(executeMock()).toHaveBeenCalledWith(
          expect.stringMatching(/^['"]javac['"] /),
          expect.anything()
        );
      });

      it.skipIf(process.platform === 'win32')(
        'should protect Java source paths containing spaces and parentheses',
        async () => {
          await utils.compileJava('Main.java');

          expect(executeMock()).toHaveBeenCalledWith(
            "'javac' '/tmp/polyman path 3)test/Main.java'",
            expect.anything()
          );
        }
      );

      it.skipIf(process.platform === 'win32')(
        'should use POLYMAN_JAVAC when set',
        async () => {
          process.env['POLYMAN_JAVAC'] = '/opt/jdk 21/bin/javac';

          await utils.compileJava('Main.java');

          expect(executeMock()).toHaveBeenCalledWith(
            "'/opt/jdk 21/bin/javac' '/tmp/polyman path 3)test/Main.java'",
            expect.anything()
          );
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
