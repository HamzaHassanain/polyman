import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as generator from '../../src/helpers/generator';
import { executor } from '../../src/executor';
import type { ExecutionOptions, ExecutionResult } from '../../src/executor';
import * as utils from '../../src/helpers/utils';
import { fmt } from '../../src/formatter';
import fs from 'fs';
import path from 'path';
import type {
  LocalGenerator,
  LocalTestset,
  GeneratorScriptCommand,
} from '../../src/types';

vi.mock('../../src/executor', () => ({
  executor: {
    executeWithRedirect: vi.fn(),
    cleanup: vi.fn(),
  },
}));

vi.mock('../../src/helpers/utils', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../src/helpers/utils')>();
  return {
    ...actual,
    compileCPP: vi.fn(),
    readConfigFile: vi.fn(),
    throwError: vi.fn((err: unknown, msg: string) => {
      throw new Error(`${msg}: ${(err as Error).message}`);
    }),
    ensureDirectoryExists: vi.fn(),
    removeDirectoryRecursively: vi.fn(),
    getCompiledCommandToRun: vi.fn(),
  };
});

vi.mock('../../src/formatter', () => ({
  fmt: {
    warning: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    cross: vi.fn().mockReturnValue('❌'),
    bold: vi.fn().mockImplementation((s: string) => `BOLD(${s})`),
    highlight: vi.fn().mockImplementation((s: string) => `HIGHLIGHT(${s})`),
  },
}));

vi.mock('fs');
vi.mock('path', async importOriginal => {
  const actual = await importOriginal<typeof import('path')>();
  const mockResolve = vi.fn((...args: string[]) => args.join('/'));
  const mockJoin = vi.fn((...args: string[]) => args.join('/'));

  return {
    ...actual,
    resolve: mockResolve,
    join: mockJoin,
    default: {
      ...actual,
      resolve: mockResolve,
      join: mockJoin,
    },
  };
});

// Typed mock references. Class methods on `executor` and `path` would trip
// `@typescript-eslint/unbound-method` when pulled off their host, so we recast
// each host as a plain record of standalone functions before grabbing the
// mock — this drops the implicit `this` type without using `any`.
type StandaloneExec = {
  executeWithRedirect: typeof executor.executeWithRedirect;
  cleanup: typeof executor.cleanup;
};
type StandaloneFmt = {
  error: typeof fmt.error;
};
type StandalonePath = {
  resolve: typeof path.resolve;
  join: typeof path.join;
};
const standaloneExec = executor as unknown as StandaloneExec;
const standaloneFmt = fmt as unknown as StandaloneFmt;
const standalonePath = path as unknown as StandalonePath;

const executeWithRedirectMock = vi.mocked(standaloneExec.executeWithRedirect);
const cleanupMock = vi.mocked(standaloneExec.cleanup);
const fmtErrorMock = vi.mocked(standaloneFmt.error);
const compileCPPMock = vi.mocked(utils.compileCPP);
const throwErrorMock = vi.mocked(utils.throwError);
const ensureDirectoryExistsMock = vi.mocked(utils.ensureDirectoryExists);
const getCompiledCommandToRunMock = vi.mocked(utils.getCompiledCommandToRun);
const existsSyncMock = vi.mocked(fs.existsSync);
const copyFileMock = vi.mocked(fs.copyFile);
const pathResolveMock = vi.mocked(standalonePath.resolve);
const pathJoinMock = vi.mocked(standalonePath.join);

type ProcessExit = (code?: string | number | null) => never;
const mockProcessExit = (() => undefined) as unknown as ProcessExit;

type CopyFileCallback = (err: NodeJS.ErrnoException | null) => void;
type CopyFileImpl = (
  src: fs.PathLike,
  dest: fs.PathLike,
  callback: CopyFileCallback
) => void;

const successResult: ExecutionResult = {
  stdout: '',
  stderr: '',
  exitCode: 0,
  success: true,
};

describe('generator.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    compileCPPMock.mockReset();
    compileCPPMock.mockResolvedValue(undefined);

    throwErrorMock.mockReset();
    throwErrorMock.mockImplementation((err: unknown, msg: string) => {
      throw new Error(`${msg}: ${(err as Error).message}`);
    });

    getCompiledCommandToRunMock.mockReset();

    pathResolveMock.mockImplementation((...args: string[]) =>
      args.join('/').replace(/\/+/g, '/')
    );
    pathJoinMock.mockImplementation((...args: string[]) =>
      args.join('/').replace(/\/+/g, '/')
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('ensureGeneratorsExist', () => {
    it('should not throw if generators are defined and non-empty', () => {
      expect(() =>
        generator.ensureGeneratorsExist([{ name: 'gen', source: 'gen.cpp' }])
      ).not.toThrow();
    });

    it('should throw if generators array is undefined', () => {
      expect(() => generator.ensureGeneratorsExist(undefined)).toThrow(
        'No test generators defined in the configuration file.'
      );
    });

    it('should throw if generators array is empty', () => {
      expect(() => generator.ensureGeneratorsExist([])).toThrow(
        'No test generators defined in the configuration file.'
      );
    });
  });

  describe('runGenerator', () => {
    const mockExecCommand = './gen';
    const mockArgs = ['10', '20'];
    const mockOutput = 'tests/test1.txt';

    it('should execute generator successfully', async () => {
      executeWithRedirectMock.mockResolvedValue(successResult);

      await expect(
        generator.runGenerator(mockExecCommand, mockArgs, mockOutput)
      ).resolves.not.toThrow();

      expect(executeWithRedirectMock).toHaveBeenCalledWith(
        `${mockExecCommand} 10 20`,
        expect.objectContaining({
          timeout: expect.any(Number) as number,
          memoryLimitMB: expect.any(Number) as number,
          silent: true,
        }),
        undefined,
        mockOutput
      );
    });

    it('should handle timeout callback correctly', async () => {
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation(mockProcessExit);

      const timeoutResult: ExecutionResult = {
        stdout: '',
        stderr: '',
        exitCode: 124,
        success: false,
      };

      executeWithRedirectMock.mockImplementation(
        (
          _cmd: string,
          options: ExecutionOptions,
          _inputFile?: string,
          _outputFile?: string
        ) => {
          if (options.onTimeout) {
            options.onTimeout(timeoutResult);
          }
          return Promise.resolve(timeoutResult);
        }
      );

      await generator.runGenerator(mockExecCommand, mockArgs, mockOutput);

      expect(fmtErrorMock).toHaveBeenCalledWith(
        expect.stringContaining('Generator Unexpectedly Exceeded Time Limit')
      );
      expect(cleanupMock).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle memory limit callback correctly', async () => {
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation(mockProcessExit);

      const memResult: ExecutionResult = {
        stdout: '',
        stderr: '',
        exitCode: 137,
        success: false,
      };

      executeWithRedirectMock.mockImplementation(
        (
          _cmd: string,
          options: ExecutionOptions,
          _inputFile?: string,
          _outputFile?: string
        ) => {
          if (options.onMemoryExceeded) {
            options.onMemoryExceeded(memResult);
          }
          return Promise.resolve(memResult);
        }
      );

      await generator.runGenerator(mockExecCommand, mockArgs, mockOutput);

      expect(fmtErrorMock).toHaveBeenCalledWith(
        expect.stringContaining('Generator Unexpectedly Exceeded Memory Limit')
      );
      expect(cleanupMock).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('compileGenerator', () => {
    it('should compile generator successfully', async () => {
      const gen: LocalGenerator = { name: 'gen', source: 'gen.cpp' };
      compileCPPMock.mockResolvedValue(undefined);

      await expect(generator.compileGenerator(gen)).resolves.toBeUndefined();
      expect(compileCPPMock).toHaveBeenCalledWith('gen.cpp');
    });

    it('should throw if no source file specified', async () => {
      const gen = { name: 'gen', source: '' } as LocalGenerator;
      await expect(generator.compileGenerator(gen)).rejects.toThrow(
        'Generator gen has no source file specified'
      );
    });

    it('should rethrow errors from compilation', async () => {
      const gen: LocalGenerator = { name: 'gen', source: 'gen.cpp' };
      compileCPPMock.mockReset();
      compileCPPMock.mockImplementation(() => {
        throw new Error('Compile Error');
      });

      await expect(generator.compileGenerator(gen)).rejects.toThrow(
        'Compile Error'
      );
    });

    it('should wrap non-Error compilation failures', async () => {
      const gen: LocalGenerator = { name: 'gen', source: 'gen.cpp' };
      compileCPPMock.mockReset();
      compileCPPMock.mockRejectedValue('Bad thing');

      await expect(generator.compileGenerator(gen)).rejects.toThrow(
        'Failed to compile generator gen'
      );
    });
  });

  describe('compileAllGenerators', () => {
    it('should compile only needed generators', async () => {
      const generators: LocalGenerator[] = [
        { name: 'gen1', source: 'gen1.cpp' },
        { name: 'gen2', source: 'gen2.cpp' },
      ];
      const commands: GeneratorScriptCommand[] = [
        { type: 'generator', generator: 'gen1' },
        { type: 'generator', generator: 'gen1' },
        { type: 'generator', generator: 'gen1' },
        { type: 'manual', manualFile: 'manual.txt' },
      ];

      getCompiledCommandToRunMock.mockReturnValue('./gen1.exe');

      const map = await generator.compileAllGenerators(commands, generators);

      expect(compileCPPMock).toHaveBeenCalledTimes(1);
      expect(compileCPPMock).toHaveBeenCalledWith('gen1.cpp');
      expect(map.get('gen1')).toBe('./gen1.exe');
      expect(map.has('gen2')).toBe(false);
    });

    it('should throw if used generator is not found', async () => {
      const generators: LocalGenerator[] = [
        { name: 'gen1', source: 'gen1.cpp' },
      ];
      const commands: GeneratorScriptCommand[] = [
        { type: 'generator', generator: 'missing' },
      ];

      await expect(
        generator.compileAllGenerators(commands, generators)
      ).rejects.toThrow('Generator "missing" not found');
    });

    it('should rethrow compilation errors with context', async () => {
      const generators: LocalGenerator[] = [
        { name: 'gen1', source: 'gen1.cpp' },
      ];
      const commands: GeneratorScriptCommand[] = [
        { type: 'generator', generator: 'gen1' },
      ];

      compileCPPMock.mockImplementation(() => {
        throw new Error('Compile Fail');
      });

      await expect(
        generator.compileAllGenerators(commands, generators)
      ).rejects.toThrow('Failed to compile generator gen1: Compile Fail');
    });
  });

  describe('compileGeneratorsForTestsets', () => {
    it('should compile unique generators from all testsets', async () => {
      const generators: LocalGenerator[] = [
        { name: 'g1', source: 'g1.cpp' },
        { name: 'g2', source: 'g2.cpp' },
        { name: 'g2', source: 'g2.cpp' },
        { name: 'g3', source: 'g3.cpp' },
      ];
      const testsets: LocalTestset[] = [
        {
          name: 'tests',
          generatorScript: {
            commands: [{ type: 'generator', generator: 'g1' }],
          },
        },
        {
          name: 'tests2',
          generatorScript: {
            commands: [
              { type: 'generator', generator: 'g2' },
              { type: 'generator', generator: 'g1' },
            ],
          },
        },
      ];

      await generator.compileGeneratorsForTestsets(testsets, generators);

      expect(compileCPPMock).toHaveBeenCalledTimes(2);
      expect(compileCPPMock).toHaveBeenCalledWith('g1.cpp');
      expect(compileCPPMock).toHaveBeenCalledWith('g2.cpp');
    });

    it('should throw if generator mismatch', async () => {
      const generators: LocalGenerator[] = [{ name: 'g1', source: 'g1.cpp' }];
      const testsets: LocalTestset[] = [
        {
          name: 'tests',
          generatorScript: {
            commands: [{ type: 'generator', generator: 'g2' }],
          },
        },
      ];

      await expect(
        generator.compileGeneratorsForTestsets(testsets, generators)
      ).rejects.toThrow('Generator "g2" not found');
    });

    it('should ignore non-generator commands', async () => {
      const generators: LocalGenerator[] = [{ name: 'g1', source: 'g1.cpp' }];
      const testsets: LocalTestset[] = [
        {
          name: 'tests',
          generatorScript: {
            commands: [{ type: 'manual', manualFile: 'm.txt' }],
          },
        },
      ];

      await generator.compileGeneratorsForTestsets(testsets, generators);
      expect(compileCPPMock).not.toHaveBeenCalled();
    });

    it('should skip testsets without generator scripts', async () => {
      const generators: LocalGenerator[] = [{ name: 'g1', source: 'g1.cpp' }];
      const testsets: LocalTestset[] = [
        { name: 'a' },
        { name: 'b', generatorScript: {} },
      ];

      await generator.compileGeneratorsForTestsets(testsets, generators);
      expect(compileCPPMock).not.toHaveBeenCalled();
    });
  });

  describe('executeGeneratorScript', () => {
    const generators: LocalGenerator[] = [{ name: 'gen1', source: 'gen1.cpp' }];

    it('should use default output directory if not provided', async () => {
      const commands: GeneratorScriptCommand[] = [
        { type: 'manual', manualFile: 'manual.txt' },
      ];
      existsSyncMock.mockReturnValue(true);
      const copyFileImpl: CopyFileImpl = (_src, _dest, cb) => {
        cb(null);
      };
      copyFileMock.mockImplementation(
        copyFileImpl as unknown as typeof fs.copyFile
      );

      await generator.executeGeneratorScript(commands, generators, '');

      expect(ensureDirectoryExistsMock).toHaveBeenCalledWith(
        expect.stringContaining('testsets')
      );
      expect(copyFileMock).toHaveBeenCalledWith(
        expect.stringContaining('manual.txt'),
        expect.stringContaining('test1.txt'),
        expect.any(Function)
      );
    });

    it('should handle generator range execution', async () => {
      const commands: GeneratorScriptCommand[] = [
        { type: 'generator', generator: 'gen1', range: [1, 2] },
      ];

      getCompiledCommandToRunMock.mockReturnValue('./gen1.exe');
      executeWithRedirectMock.mockResolvedValue(successResult);

      await generator.executeGeneratorScript(commands, generators, 'outdir');

      expect(executeWithRedirectMock).toHaveBeenCalledTimes(2);
      expect(executeWithRedirectMock).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('./gen1.exe 1'),
        expect.anything(),
        undefined,
        expect.stringContaining('test1.txt')
      );
      expect(executeWithRedirectMock).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('./gen1.exe 2'),
        expect.anything(),
        undefined,
        expect.stringContaining('test2.txt')
      );
    });

    it('should throw if manual file does not exist', async () => {
      const commands: GeneratorScriptCommand[] = [
        { type: 'manual', manualFile: 'missing.txt' },
      ];
      existsSyncMock.mockReturnValue(false);

      await expect(
        generator.executeGeneratorScript(commands, generators, 'outdir')
      ).rejects.toThrow('Some tests failed to generate');
      expect(fmtErrorMock).toHaveBeenCalledWith(
        expect.stringContaining('Manual test file not found')
      );
    });

    it('should throw if generator not compiled', async () => {
      const commands: GeneratorScriptCommand[] = [
        { type: 'generator', generator: 'genUnknown', range: [1, 1] },
      ];
      await expect(
        generator.executeGeneratorScript(commands, generators, 'outdir')
      ).rejects.toThrow('Some tests failed to generate');
      expect(fmtErrorMock).toHaveBeenCalledWith(
        expect.stringContaining('Generator "genUnknown" not compiled')
      );
    });

    it('should throw if range is invalid', async () => {
      const commands: GeneratorScriptCommand[] = [
        { type: 'generator', generator: 'gen1' },
      ];
      getCompiledCommandToRunMock.mockReturnValue('./gen1.exe');

      await expect(
        generator.executeGeneratorScript(commands, generators, 'outdir')
      ).rejects.toThrow('Some tests failed to generate');
      expect(fmtErrorMock).toHaveBeenCalledWith(
        expect.stringContaining('missing valid range')
      );
    });

    it('should throw if command type is unknown', async () => {
      const commands = [
        { type: 'unknown' } as unknown as GeneratorScriptCommand,
      ];
      await expect(
        generator.executeGeneratorScript(commands, generators, 'outdir')
      ).rejects.toThrow('Some tests failed to generate');
      expect(fmtErrorMock).toHaveBeenCalledWith(
        expect.stringContaining('Invalid command type')
      );
    });

    it('should fail if copyFile errors', async () => {
      const commands: GeneratorScriptCommand[] = [
        { type: 'manual', manualFile: 'exists.txt' },
      ];
      existsSyncMock.mockReturnValue(true);
      const copyFileImpl: CopyFileImpl = (_src, _dest, cb) => {
        cb(new Error('Copy Failed') as NodeJS.ErrnoException);
      };
      copyFileMock.mockImplementation(
        copyFileImpl as unknown as typeof fs.copyFile
      );

      await expect(
        generator.executeGeneratorScript(commands, generators, 'outdir')
      ).rejects.toThrow('Some tests failed to generate');
      expect(fmtErrorMock).toHaveBeenCalledWith(
        expect.stringContaining('Failed to copy manual test: Copy Failed')
      );
    });
  });
});
