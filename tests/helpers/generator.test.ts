import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as generator from '../../src/helpers/generator';
import { executor } from '../../src/executor';
import * as utils from '../../src/helpers/utils';
import { fmt } from '../../src/formatter';
import fs from 'fs';
import path from 'path';

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
    throwError: vi.fn((err, msg) => {
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
    bold: vi.fn().mockImplementation(s => `BOLD(${s})`),
    highlight: vi.fn().mockImplementation(s => `HIGHLIGHT(${s})`),
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

describe('generator.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(utils.compileCPP).mockReset();
    vi.mocked(utils.compileCPP).mockResolvedValue(undefined);

    vi.mocked(utils.throwError).mockReset();
    vi.mocked(utils.throwError).mockImplementation((err, msg) => {
      throw new Error(`${msg}: ${(err as Error).message}`);
    });

    vi.mocked(utils.getCompiledCommandToRun).mockReset();

    (path.resolve as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (...args: string[]) => args.join('/').replace(/\/+/g, '/')
    );
    (path.join as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (...args: string[]) => args.join('/').replace(/\/+/g, '/')
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
      vi.mocked(executor.executeWithRedirect).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        success: true,
      });

      await expect(
        generator.runGenerator(mockExecCommand, mockArgs, mockOutput)
      ).resolves.not.toThrow();

      expect(executor.executeWithRedirect).toHaveBeenCalledWith(
        `${mockExecCommand} 10 20`,
        expect.objectContaining({
          timeout: expect.any(Number),
          memoryLimitMB: expect.any(Number),
          silent: true,
        }),
        undefined,
        mockOutput
      );
    });

    it('should handle timeout callback correctly', async () => {
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as any);

      vi.mocked(executor.executeWithRedirect).mockImplementation(
        async (cmd, options) => {
          if (options?.onTimeout) {
            await options.onTimeout({
              stdout: '',
              stderr: '',
              exitCode: 124,
              success: false,
            });
          }
          return { stdout: '', stderr: '', exitCode: 124, success: false };
        }
      );

      await generator.runGenerator(mockExecCommand, mockArgs, mockOutput);

      expect(fmt.error).toHaveBeenCalledWith(
        expect.stringContaining('Generator Unexpectedly Exceeded Time Limit')
      );
      expect(executor.cleanup).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle memory limit callback correctly', async () => {
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => {}) as any);

      vi.mocked(executor.executeWithRedirect).mockImplementation(
        async (cmd, options) => {
          if (options?.onMemoryExceeded) {
            await options.onMemoryExceeded({
              stdout: '',
              stderr: '',
              exitCode: 137,
              success: false,
            });
          }
          return { stdout: '', stderr: '', exitCode: 137, success: false };
        }
      );

      await generator.runGenerator(mockExecCommand, mockArgs, mockOutput);

      expect(fmt.error).toHaveBeenCalledWith(
        expect.stringContaining('Generator Unexpectedly Exceeded Memory Limit')
      );
      expect(executor.cleanup).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('compileGenerator', () => {
    it('should compile generator successfully', async () => {
      const gen = { name: 'gen', source: 'gen.cpp' };
      vi.mocked(utils.compileCPP).mockResolvedValue(undefined);

      await expect(generator.compileGenerator(gen)).resolves.toBeUndefined();
      expect(utils.compileCPP).toHaveBeenCalledWith('gen.cpp');
    });

    it('should throw if no source file specified', async () => {
      const gen = { name: 'gen' } as any;
      await expect(generator.compileGenerator(gen)).rejects.toThrow(
        'Generator gen has no source file specified'
      );
    });

    it('should rethrow errors from compilation', async () => {
      const gen = { name: 'gen', source: 'gen.cpp' };
      vi.mocked(utils.compileCPP).mockReset();
      vi.mocked(utils.compileCPP).mockImplementation(() => {
        throw new Error('Compile Error');
      });

      await expect(generator.compileGenerator(gen)).rejects.toThrow(
        'Compile Error'
      );
    });

    it('should wrap non-Error compilation failures', async () => {
      const gen = { name: 'gen', source: 'gen.cpp' };
      vi.mocked(utils.compileCPP).mockReset();
      vi.mocked(utils.compileCPP).mockRejectedValue('Bad thing');

      await expect(generator.compileGenerator(gen)).rejects.toThrow(
        'Failed to compile generator gen'
      );
    });
  });

  describe('compileAllGenerators', () => {
    it('should compile only needed generators', async () => {
      const generators = [
        { name: 'gen1', source: 'gen1.cpp' },
        { name: 'gen2', source: 'gen2.cpp' },
      ];
      const commands = [
        { type: 'generator', generator: 'gen1', args: [] },
        { type: 'generator', generator: 'gen1', args: [] },
        { type: 'generator', generator: 'gen1', args: [] },
        { type: 'manual', manualFile: 'manual.txt' },
      ] as any;

      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./gen1.exe');

      const map = await generator.compileAllGenerators(commands, generators);

      expect(utils.compileCPP).toHaveBeenCalledTimes(1);
      expect(utils.compileCPP).toHaveBeenCalledWith('gen1.cpp');
      expect(map.get('gen1')).toBe('./gen1.exe');
      expect(map.has('gen2')).toBe(false);
    });

    it('should throw if used generator is not found', async () => {
      const generators = [{ name: 'gen1', source: 'gen1.cpp' }];
      const commands = [
        { type: 'generator', generator: 'missing', args: [] },
      ] as any;

      await expect(
        generator.compileAllGenerators(commands, generators)
      ).rejects.toThrow('Generator "missing" not found');
    });

    it('should rethrow compilation errors with context', async () => {
      const generators = [{ name: 'gen1', source: 'gen1.cpp' }];
      const commands = [
        { type: 'generator', generator: 'gen1', args: [] },
      ] as any;

      vi.mocked(utils.compileCPP).mockImplementation(() => {
        throw new Error('Compile Fail');
      });

      await expect(
        generator.compileAllGenerators(commands, generators)
      ).rejects.toThrow('Failed to compile generator gen1: Compile Fail');
    });
  });

  describe('compileGeneratorsForTestsets', () => {
    it('should compile unique generators from all testsets', async () => {
      const generators = [
        { name: 'g1', source: 'g1.cpp' },
        { name: 'g2', source: 'g2.cpp' },
        { name: 'g2', source: 'g2.cpp' },
        { name: 'g3', source: 'g3.cpp' },
      ];
      const testsets = [
        {
          generatorScript: {
            commands: [{ type: 'generator', generator: 'g1' }],
          },
        },
        {
          generatorScript: {
            commands: [
              { type: 'generator', generator: 'g2' },
              { type: 'generator', generator: 'g1' },
            ],
          },
        },
      ] as any;

      await generator.compileGeneratorsForTestsets(testsets, generators);

      expect(utils.compileCPP).toHaveBeenCalledTimes(2);
      expect(utils.compileCPP).toHaveBeenCalledWith('g1.cpp');
      expect(utils.compileCPP).toHaveBeenCalledWith('g2.cpp');
    });

    it('should throw if generator mismatch', async () => {
      const generators = [{ name: 'g1', source: 'g1.cpp' }];
      const testsets = [
        {
          generatorScript: {
            commands: [{ type: 'generator', generator: 'g2' }],
          },
        },
      ] as any;

      await expect(
        generator.compileGeneratorsForTestsets(testsets, generators)
      ).rejects.toThrow('Generator "g2" not found');
    });

    it('should ignore non-generator commands', async () => {
      const generators = [{ name: 'g1', source: 'g1.cpp' }];
      const testsets = [
        {
          generatorScript: {
            commands: [{ type: 'manual', manualFile: 'm.txt' }],
          },
        },
      ] as any;

      await generator.compileGeneratorsForTestsets(testsets, generators);
      expect(utils.compileCPP).not.toHaveBeenCalled();
    });

    it('should skip testsets without generator scripts', async () => {
      const generators = [{ name: 'g1', source: 'g1.cpp' }];
      const testsets = [{}, { generatorScript: {} }] as any;

      await generator.compileGeneratorsForTestsets(testsets, generators);
      expect(utils.compileCPP).not.toHaveBeenCalled();
    });
  });

  describe('executeGeneratorScript', () => {
    const generators = [{ name: 'gen1', source: 'gen1.cpp' }];

    it('should use default output directory if not provided', async () => {
      const commands = [{ type: 'manual', manualFile: 'manual.txt' }] as any;
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.copyFile).mockImplementation(((
        s: any,
        d: any,
        cb: any
      ): void => {
        cb(null);
      }) as any);

      await generator.executeGeneratorScript(commands, generators, '' as any);

      expect(utils.ensureDirectoryExists).toHaveBeenCalledWith(
        expect.stringContaining('testsets')
      );
      expect(fs.copyFile).toHaveBeenCalledWith(
        expect.stringContaining('manual.txt'),
        expect.stringContaining('test1.txt'),
        expect.any(Function)
      );
    });

    it('should handle generator range execution', async () => {
      const commands = [
        { type: 'generator', generator: 'gen1', range: [1, 2] },
      ] as any;

      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./gen1.exe');
      vi.mocked(executor.executeWithRedirect).mockResolvedValue({
        success: true,
      } as any);

      await generator.executeGeneratorScript(commands, generators, 'outdir');

      expect(executor.executeWithRedirect).toHaveBeenCalledTimes(2);
      expect(executor.executeWithRedirect).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('./gen1.exe 1'),
        expect.anything(),
        undefined,
        expect.stringContaining('test1.txt')
      );
      expect(executor.executeWithRedirect).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('./gen1.exe 2'),
        expect.anything(),
        undefined,
        expect.stringContaining('test2.txt')
      );
    });

    it('should throw if manual file does not exist', async () => {
      const commands = [{ type: 'manual', manualFile: 'missing.txt' }] as any;
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await expect(
        generator.executeGeneratorScript(commands, generators, 'outdir')
      ).rejects.toThrow('Some tests failed to generate');
      expect(fmt.error).toHaveBeenCalledWith(
        expect.stringContaining('Manual test file not found')
      );
    });

    it('should throw if generator not compiled', async () => {
      const commands = [
        { type: 'generator', generator: 'genUnknown', range: [1, 1] },
      ] as any;
      await expect(
        generator.executeGeneratorScript(commands, generators, 'outdir')
      ).rejects.toThrow('Some tests failed to generate');
      expect(fmt.error).toHaveBeenCalledWith(
        expect.stringContaining('Generator "genUnknown" not compiled')
      );
    });

    it('should throw if range is invalid', async () => {
      const commands = [{ type: 'generator', generator: 'gen1' }] as any;
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./gen1.exe');

      await expect(
        generator.executeGeneratorScript(commands, generators, 'outdir')
      ).rejects.toThrow('Some tests failed to generate');
      expect(fmt.error).toHaveBeenCalledWith(
        expect.stringContaining('missing valid range')
      );
    });

    it('should throw if command type is unknown', async () => {
      const commands = [{ type: 'unknown' }] as any;
      await expect(
        generator.executeGeneratorScript(commands, generators, 'outdir')
      ).rejects.toThrow('Some tests failed to generate');
      expect(fmt.error).toHaveBeenCalledWith(
        expect.stringContaining('Invalid command type')
      );
    });

    it('should fail if copyFile errors', async () => {
      const commands = [{ type: 'manual', manualFile: 'exists.txt' }] as any;
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.copyFile).mockImplementation(((
        s: any,
        d: any,
        cb: any
      ): void => {
        cb(new Error('Copy Failed'));
      }) as any);

      await expect(
        generator.executeGeneratorScript(commands, generators, 'outdir')
      ).rejects.toThrow('Some tests failed to generate');
      expect(fmt.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to copy manual test: Copy Failed')
      );
    });
  });
});
