import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as validator from '../../src/helpers/validator';
import { executor } from '../../src/executor';
import * as utils from '../../src/helpers/utils';
import * as testsetHelper from '../../src/helpers/testset';
import { fmt } from '../../src/formatter';
import fs from 'fs';
import path from 'path';

vi.mock('fs');
vi.mock('path');
vi.mock('../../src/executor', () => ({
  executor: {
    executeWithRedirect: vi.fn(),
    cleanup: vi.fn(),
  },
}));
vi.mock('../../src/helpers/utils');
vi.mock('../../src/helpers/testset');
vi.mock('../../src/formatter', () => ({
  fmt: {
    error: vi.fn(),
    warning: vi.fn(),
    bold: vi.fn((str: string) => str),
    cross: vi.fn(() => '✗'),
  },
}));

describe('validator.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(path.resolve).mockImplementation((...args: string[]) =>
      args.join('/')
    );
    vi.mocked(path.join).mockImplementation((...args: string[]) =>
      args.join('/')
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ensureValidatorExists', () => {
    it('should not throw if validator is defined', () => {
      expect(() =>
        validator.ensureValidatorExists({ name: 'val', source: 'val.cpp' })
      ).not.toThrow();
    });

    it('should throw if validator is undefined', () => {
      expect(() => validator.ensureValidatorExists(undefined)).toThrow(
        'No validator defined in the configuration file.'
      );
    });
  });

  describe('compileValidator', () => {
    it('should compile validator successfully', async () => {
      const mockValidator = { name: 'val', source: 'validator/val.cpp' };
      vi.mocked(utils.compileCPP).mockResolvedValue();

      await expect(
        validator.compileValidator(mockValidator)
      ).resolves.not.toThrow();

      expect(utils.compileCPP).toHaveBeenCalledWith('validator/val.cpp');
    });

    it('should throw if validator has no source file', async () => {
      const mockValidator = { name: 'val' } as any;

      await expect(validator.compileValidator(mockValidator)).rejects.toThrow(
        'Validator has no source file specified'
      );

      expect(utils.compileCPP).not.toHaveBeenCalled();
    });

    it('should propagate compilation errors', async () => {
      const mockValidator = { name: 'val', source: 'validator/val.cpp' };
      const compileError = new Error('Compilation failed');
      vi.mocked(utils.compileCPP).mockRejectedValue(compileError);

      await expect(validator.compileValidator(mockValidator)).rejects.toThrow(
        'Compilation failed'
      );
    });

    it('should handle non-Error compilation failures', async () => {
      const mockValidator = { name: 'val', source: 'validator/val.cpp' };
      vi.mocked(utils.compileCPP).mockRejectedValue('string error');

      await expect(validator.compileValidator(mockValidator)).rejects.toThrow(
        'Failed to compile validator'
      );
    });
  });

  describe('validateSingleTest', () => {
    it('should execute validator successfully on valid test', async () => {
      const mockValidator = { name: 'val', source: 'val.cpp' };
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(executor.executeWithRedirect).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        success: true,
      });

      await expect(
        validator.validateSingleTest(mockValidator, 'testsets', 1)
      ).resolves.not.toThrow();

      expect(utils.getCompiledCommandToRun).toHaveBeenCalledWith(mockValidator);
      expect(fs.existsSync).toHaveBeenCalled();
      expect(executor.executeWithRedirect).toHaveBeenCalled();
    });

    it('should throw if test file does not exist', async () => {
      const mockValidator = { name: 'val', source: 'val.cpp' };
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(utils.throwError).mockImplementation(e => {
        throw e instanceof Error ? e : new Error(String(e));
      });

      await expect(
        validator.validateSingleTest(mockValidator, 'testsets', 1)
      ).rejects.toThrow('Test file not found');
    });

    it('should throw with detailed error message when validator fails', async () => {
      const mockValidator = { name: 'val', source: 'val.cpp' };
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(executor.executeWithRedirect).mockImplementation(
        (_cmd, opts: any) => {
          if (opts.onError) {
            opts.onError({ stderr: 'Invalid input', exitCode: 1 });
          }
          throw new Error('Invalid input');
        }
      );
      vi.mocked(utils.throwError).mockImplementation(e => {
        throw e instanceof Error ? e : new Error(String(e));
      });

      await expect(
        validator.validateSingleTest(mockValidator, 'testsets', 5)
      ).rejects.toThrow('Test 5 failed validation');
    });
  });

  describe('validateTestset', () => {
    it('should validate all tests in testset successfully', async () => {
      const mockValidator = { name: 'val', source: 'val.cpp' };
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(utils.getTestFiles).mockReturnValue(['test1.txt', 'test2.txt']);
      vi.mocked(executor.executeWithRedirect).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        success: true,
      });
      vi.mocked(executor.cleanup).mockResolvedValue();

      await expect(
        validator.validateTestset(mockValidator, 'samples')
      ).resolves.not.toThrow();

      expect(executor.cleanup).toHaveBeenCalled();
    });

    it('should throw if testset directory does not exist', async () => {
      const mockValidator = { name: 'val', source: 'val.cpp' };
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(utils.throwError).mockImplementation(e => {
        throw e instanceof Error ? e : new Error(String(e));
      });
      vi.mocked(executor.cleanup).mockResolvedValue();

      await expect(
        validator.validateTestset(mockValidator, 'nonexistent')
      ).rejects.toThrow('Testset directory not found');

      expect(executor.cleanup).toHaveBeenCalled();
    });

    it('should throw if no test files found in testset', async () => {
      const mockValidator = { name: 'val', source: 'val.cpp' };
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(utils.getTestFiles).mockReturnValue([]);
      vi.mocked(utils.throwError).mockImplementation(e => {
        throw e instanceof Error ? e : new Error(String(e));
      });
      vi.mocked(executor.cleanup).mockResolvedValue();

      await expect(
        validator.validateTestset(mockValidator, 'empty')
      ).rejects.toThrow('No test files found in testset');

      expect(executor.cleanup).toHaveBeenCalled();
    });

    it('should log errors for failed tests and throw at end', async () => {
      const mockValidator = { name: 'val', source: 'val.cpp' };
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(utils.getTestFiles).mockReturnValue(['test1.txt', 'test2.txt']);
      vi.mocked(executor.executeWithRedirect)
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
          success: true,
        })
        .mockImplementation((_cmd, opts: any) => {
          if (opts.onError) {
            opts.onError({ stderr: 'Validation error', exitCode: 1 });
          }
          throw new Error('Validation error');
        });
      vi.mocked(utils.logError).mockImplementation(() => {});
      vi.mocked(executor.cleanup).mockResolvedValue();

      await expect(
        validator.validateTestset(mockValidator, 'samples')
      ).rejects.toThrow('Some tests failed validation');

      expect(utils.logError).toHaveBeenCalled();
      expect(executor.cleanup).toHaveBeenCalled();
    });
  });

  describe('validateGroup', () => {
    it('should validate all tests in group successfully', async () => {
      const mockValidator = { name: 'val', source: 'val.cpp' };
      const mockTestset = {
        name: 'testsets',
        groups: [{ name: 'samples', commands: [] }],
      };
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(testsetHelper.getGeneratorCommands).mockReturnValue([
        { type: 'generator', generator: 'gen', group: 'samples' },
        { type: 'generator', generator: 'gen', group: 'other' },
      ]);
      vi.mocked(executor.executeWithRedirect).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        success: true,
      });
      vi.mocked(executor.cleanup).mockResolvedValue();

      await expect(
        validator.validateGroup(mockValidator, mockTestset, 'samples')
      ).resolves.not.toThrow();

      expect(executor.cleanup).toHaveBeenCalled();
    });

    it('should throw if testset directory does not exist', async () => {
      const mockValidator = { name: 'val', source: 'val.cpp' };
      const mockTestset = { name: 'testsets', groups: [] };
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
      vi.mocked(fs.existsSync).mockReturnValue(false);
      vi.mocked(utils.throwError).mockImplementation(e => {
        throw e instanceof Error ? e : new Error(String(e));
      });
      vi.mocked(executor.cleanup).mockResolvedValue();

      await expect(
        validator.validateGroup(mockValidator, mockTestset, 'samples')
      ).rejects.toThrow('Testset directory not found');

      expect(executor.cleanup).toHaveBeenCalled();
    });

    it('should throw if no tests found in group', async () => {
      const mockValidator = { name: 'val', source: 'val.cpp' };
      const mockTestset = { name: 'testsets', groups: [] };
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(testsetHelper.getGeneratorCommands).mockReturnValue([
        { type: 'generator', generator: 'gen', group: 'other' },
      ]);
      vi.mocked(utils.throwError).mockImplementation(e => {
        throw e instanceof Error ? e : new Error(String(e));
      });
      vi.mocked(executor.cleanup).mockResolvedValue();

      await expect(
        validator.validateGroup(mockValidator, mockTestset, 'samples')
      ).rejects.toThrow('No tests found in group');

      expect(executor.cleanup).toHaveBeenCalled();
    });

    it('should handle commands with ranges', async () => {
      const mockValidator = { name: 'val', source: 'val.cpp' };
      const mockTestset = { name: 'testsets', groups: [] };
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(testsetHelper.getGeneratorCommands).mockReturnValue([
        {
          type: 'generator',
          generator: 'gen',
          group: 'samples',
          range: [1, 3],
        },
      ]);
      vi.mocked(executor.executeWithRedirect).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        success: true,
      });
      vi.mocked(executor.cleanup).mockResolvedValue();

      await expect(
        validator.validateGroup(mockValidator, mockTestset, 'samples')
      ).resolves.not.toThrow();

      expect(executor.executeWithRedirect).toHaveBeenCalledTimes(3);
      expect(executor.cleanup).toHaveBeenCalled();
    });

    it('should log errors for failed tests in group', async () => {
      const mockValidator = { name: 'val', source: 'val.cpp' };
      const mockTestset = { name: 'testsets', groups: [] };
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(testsetHelper.getGeneratorCommands).mockReturnValue([
        { type: 'generator', generator: 'gen', group: 'samples' },
      ]);
      vi.mocked(executor.executeWithRedirect).mockImplementation(
        (_cmd, opts: any) => {
          if (opts.onError) {
            opts.onError({ stderr: 'Group validation error', exitCode: 1 });
          }
          throw new Error('Group validation error');
        }
      );
      vi.mocked(utils.logError).mockImplementation(() => {});
      vi.mocked(executor.cleanup).mockResolvedValue();

      await expect(
        validator.validateGroup(mockValidator, mockTestset, 'samples')
      ).rejects.toThrow('Some tests in group samples failed validation');

      expect(utils.logError).toHaveBeenCalled();
      expect(executor.cleanup).toHaveBeenCalled();
    });
  });

  describe('validateAllTestsets', () => {
    it('should validate all testsets successfully', async () => {
      const mockValidator = { name: 'val', source: 'val.cpp' };
      const mockTestsets = [{ name: 'samples' }, { name: 'tests' }];
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(utils.getTestFiles).mockReturnValue(['test1.txt']);
      vi.mocked(executor.executeWithRedirect).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        success: true,
      });
      vi.mocked(executor.cleanup).mockResolvedValue();

      await expect(
        validator.validateAllTestsets(mockValidator, mockTestsets)
      ).resolves.not.toThrow();
    });

    it('should log errors and throw if any testset fails', async () => {
      const mockValidator = { name: 'val', source: 'val.cpp' };
      const mockTestsets = [{ name: 'samples' }, { name: 'tests' }];
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
      vi.mocked(fs.existsSync)
        .mockReturnValueOnce(true)
        .mockReturnValueOnce(false);
      vi.mocked(utils.getTestFiles).mockReturnValue(['test1.txt']);
      vi.mocked(executor.executeWithRedirect).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        success: true,
      });
      vi.mocked(utils.throwError).mockImplementation(e => {
        throw e instanceof Error ? e : new Error(String(e));
      });
      vi.mocked(utils.logError).mockImplementation(() => {});
      vi.mocked(executor.cleanup).mockResolvedValue();

      await expect(
        validator.validateAllTestsets(mockValidator, mockTestsets)
      ).rejects.toThrow('Some testsets failed validation');

      expect(utils.logError).toHaveBeenCalled();
    });
  });

  describe('testValidatorItself', () => {
    it('should skip tests if no testsFilePath specified', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        validator: { name: 'val', source: 'val.cpp' },
      } as any);
      vi.mocked(executor.cleanup).mockResolvedValue();
      vi.mocked(utils.removeDirectoryRecursively).mockImplementation(() => {});

      await expect(validator.testValidatorItself()).resolves.not.toThrow();

      expect(fmt.warning).toHaveBeenCalledWith(
        expect.stringContaining('No validator tests file path')
      );
      expect(executor.cleanup).toHaveBeenCalled();
      expect(utils.removeDirectoryRecursively).toHaveBeenCalledWith(
        'validator_tests'
      );
    });

    it('should run validator tests successfully', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        validator: {
          name: 'val',
          source: 'val.cpp',
          testsFilePath: 'validator_tests.json',
        },
      } as any);
      (vi.mocked(fs.readFile) as any).mockImplementation(
        (path: unknown, encoding: unknown, callback: unknown) => {
          const cb = callback as (err: Error | null, data: string) => void;
          cb(null, JSON.stringify({ tests: [] }));
        }
      );
      vi.mocked(utils.ensureDirectoryExists).mockImplementation(() => {});
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
      vi.mocked(executor.executeWithRedirect).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        success: true,
      });
      vi.mocked(executor.cleanup).mockResolvedValue();
      vi.mocked(utils.removeDirectoryRecursively).mockImplementation(() => {});

      await expect(validator.testValidatorItself()).resolves.not.toThrow();

      expect(executor.cleanup).toHaveBeenCalled();
      expect(utils.removeDirectoryRecursively).toHaveBeenCalledWith(
        'validator_tests'
      );
    });

    it('should throw if validator is not defined', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({} as any);
      vi.mocked(utils.throwError).mockImplementation(e => {
        throw e instanceof Error ? e : new Error(String(e));
      });
      vi.mocked(executor.cleanup).mockResolvedValue();
      vi.mocked(utils.removeDirectoryRecursively).mockImplementation(() => {});

      await expect(validator.testValidatorItself()).rejects.toThrow(
        'No validator defined'
      );

      expect(executor.cleanup).toHaveBeenCalled();
      expect(utils.removeDirectoryRecursively).toHaveBeenCalledWith(
        'validator_tests'
      );
    });

    it('should cleanup even if tests fail', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        validator: {
          name: 'val',
          source: 'val.cpp',
          testsFilePath: 'validator_tests.json',
        },
      } as any);
      (vi.mocked(fs.readFile) as any).mockImplementation(
        (path: unknown, encoding: unknown, callback: unknown) => {
          const cb = callback as (err: Error | null, data: string) => void;
          cb(new Error('File read error'), '');
        }
      );
      vi.mocked(utils.throwError).mockImplementation(e => {
        throw e instanceof Error ? e : new Error(String(e));
      });
      vi.mocked(executor.cleanup).mockResolvedValue();
      vi.mocked(utils.removeDirectoryRecursively).mockImplementation(() => {});

      await expect(validator.testValidatorItself()).rejects.toThrow();

      expect(executor.cleanup).toHaveBeenCalled();
      expect(utils.removeDirectoryRecursively).toHaveBeenCalledWith(
        'validator_tests'
      );
    });
  });

  describe('runValidatorTests', () => {
    it('should run all validator tests successfully', async () => {
      const mockValidator = {
        name: 'val',
        source: 'val.cpp',
        testsFilePath: 'validator_tests.json',
      };
      (vi.mocked(fs.readFile) as any).mockImplementation(
        (path: unknown, encoding: unknown, callback: unknown) => {
          const cb = callback as (err: Error | null, data: string) => void;
          cb(
            null,
            JSON.stringify({
              tests: [
                { index: 1, input: '1 2', expectedVerdict: 'VALID' },
                { index: 2, input: '-1', expectedVerdict: 'INVALID' },
              ],
            })
          );
        }
      );
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
      vi.mocked(executor.executeWithRedirect)
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
          success: true,
        })
        .mockImplementation((_cmd, opts: any) => {
          if (opts.onError) {
            opts.onError({ stderr: 'Invalid', exitCode: 1 });
          }
          return Promise.resolve({
            stdout: '',
            stderr: '',
            exitCode: 1,
            success: false,
          });
        });
      vi.mocked(executor.cleanup).mockResolvedValue();

      await expect(
        validator.runValidatorTests(mockValidator)
      ).resolves.not.toThrow();

      expect(executor.cleanup).toHaveBeenCalled();
    });

    it('should throw if some validator tests fail', async () => {
      const mockValidator = {
        name: 'val',
        source: 'val.cpp',
        testsFilePath: 'validator_tests.json',
      };
      (vi.mocked(fs.readFile) as any).mockImplementation(
        (path: unknown, encoding: unknown, callback: unknown) => {
          const cb = callback as (err: Error | null, data: string) => void;
          cb(
            null,
            JSON.stringify({
              tests: [{ index: 1, input: '1 2', expectedVerdict: 'VALID' }],
            })
          );
        }
      );
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
      vi.mocked(executor.executeWithRedirect).mockImplementation(
        (_cmd, opts: any) => {
          if (opts.onError) {
            opts.onError({ stderr: 'Unexpected error', exitCode: 1 });
          }
          throw new Error('Unexpected error');
        }
      );
      vi.mocked(executor.cleanup).mockResolvedValue();

      await expect(validator.runValidatorTests(mockValidator)).rejects.toThrow(
        'Some validator tests failed'
      );

      expect(fmt.error).toHaveBeenCalled();
      expect(executor.cleanup).toHaveBeenCalled();
    });

    it('should propagate parse errors', async () => {
      const mockValidator = {
        name: 'val',
        source: 'val.cpp',
        testsFilePath: 'validator_tests.json',
      };
      (vi.mocked(fs.readFile) as any).mockImplementation(
        (path: unknown, encoding: unknown, callback: unknown) => {
          const cb = callback as (err: Error | null, data: string) => void;
          cb(new Error('Parse error'), '');
        }
      );
      vi.mocked(utils.throwError).mockImplementation(e => {
        throw e instanceof Error ? e : new Error(String(e));
      });
      vi.mocked(executor.cleanup).mockResolvedValue();

      await expect(validator.runValidatorTests(mockValidator)).rejects.toThrow(
        'Failed to read validator tests file'
      );

      expect(executor.cleanup).toHaveBeenCalled();
    });

    it('should cleanup even if tests fail', async () => {
      const mockValidator = {
        name: 'val',
        source: 'val.cpp',
        testsFilePath: 'validator_tests.json',
      };
      (vi.mocked(fs.readFile) as any).mockImplementation(
        (path: unknown, encoding: unknown, callback: unknown) => {
          const cb = callback as (err: Error | null, data: string) => void;
          cb(
            null,
            JSON.stringify({
              tests: [{ index: 1, input: '1 2', expectedVerdict: 'VALID' }],
            })
          );
        }
      );
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
      vi.mocked(executor.executeWithRedirect).mockRejectedValue(
        new Error('Execution failed')
      );
      vi.mocked(executor.cleanup).mockResolvedValue();

      await expect(
        validator.runValidatorTests(mockValidator)
      ).rejects.toThrow();

      expect(executor.cleanup).toHaveBeenCalled();
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle timeout in validator execution', async () => {
      const mockValidator = { name: 'val', source: 'val.cpp' };
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation(() => undefined as never);
      vi.mocked(executor.cleanup).mockResolvedValue();

      vi.mocked(executor.executeWithRedirect).mockImplementation(
        async (_cmd, opts: any) => {
          if (opts.onTimeout) {
            await opts.onTimeout();
          }
          return { stdout: '', stderr: '', exitCode: 0, success: true };
        }
      );

      await validator.validateSingleTest(mockValidator, 'testsets', 1);

      expect(fmt.error).toHaveBeenCalledWith(
        expect.stringContaining('Exceeded Time Limit')
      );
      expect(executor.cleanup).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);

      mockExit.mockRestore();
    });

    it('should handle memory exceeded in validator execution', async () => {
      const mockValidator = { name: 'val', source: 'val.cpp' };
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const mockExit = vi
        .spyOn(process, 'exit')
        .mockImplementation(() => undefined as never);
      vi.mocked(executor.cleanup).mockResolvedValue();

      vi.mocked(executor.executeWithRedirect).mockImplementation(
        async (_cmd, opts: any) => {
          if (opts.onMemoryExceeded) {
            await opts.onMemoryExceeded();
          }
          return { stdout: '', stderr: '', exitCode: 0, success: true };
        }
      );

      await validator.validateSingleTest(mockValidator, 'testsets', 1);

      expect(fmt.error).toHaveBeenCalledWith(
        expect.stringContaining('Exceeded Memory Limit')
      );
      expect(executor.cleanup).toHaveBeenCalled();
      expect(mockExit).toHaveBeenCalledWith(1);

      mockExit.mockRestore();
    });

    it('should handle validator expecting INVALID but getting VALID', async () => {
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(executor.executeWithRedirect).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        success: true,
      });

      const mockValidator2 = {
        name: 'val',
        source: 'val.cpp',
        testsFilePath: 'validator_tests.json',
      };
      (vi.mocked(fs.readFile) as any).mockImplementation(
        (path: unknown, encoding: unknown, callback: unknown) => {
          const cb = callback as (err: Error | null, data: string) => void;
          cb(
            null,
            JSON.stringify({
              tests: [{ index: 1, input: '1 2', expectedVerdict: 'INVALID' }],
            })
          );
        }
      );
      vi.mocked(executor.cleanup).mockResolvedValue();

      await expect(validator.runValidatorTests(mockValidator2)).rejects.toThrow(
        'Some validator tests failed'
      );
    });

    it('should handle invalid JSON in validator tests file', async () => {
      const mockValidator = {
        name: 'val',
        source: 'val.cpp',
        testsFilePath: 'validator_tests.json',
      };
      (vi.mocked(fs.readFile) as any).mockImplementation(
        (path: unknown, encoding: unknown, callback: unknown) => {
          const cb = callback as (err: Error | null, data: string) => void;
          cb(null, 'invalid json');
        }
      );
      vi.mocked(utils.throwError).mockImplementation(e => {
        throw e instanceof Error ? e : new Error(String(e));
      });
      vi.mocked(executor.cleanup).mockResolvedValue();

      await expect(validator.runValidatorTests(mockValidator)).rejects.toThrow(
        'Failed to parse validator tests JSON'
      );
    });

    it('should handle missing tests property in JSON', async () => {
      const mockValidator = {
        name: 'val',
        source: 'val.cpp',
        testsFilePath: 'validator_tests.json',
      };
      (vi.mocked(fs.readFile) as any).mockImplementation(
        (path: unknown, encoding: unknown, callback: unknown) => {
          const cb = callback as (err: Error | null, data: string) => void;
          cb(null, JSON.stringify({ other: 'data' }));
        }
      );
      vi.mocked(utils.throwError).mockImplementation(e => {
        throw e instanceof Error ? e : new Error(String(e));
      });
      vi.mocked(executor.cleanup).mockResolvedValue();

      await expect(validator.runValidatorTests(mockValidator)).rejects.toThrow(
        'Invalid validator tests JSON structure'
      );
    });
  });

  describe('additional coverage tests', () => {
    it('should handle ranges in non-target groups correctly', async () => {
      const mockValidator = { name: 'val', source: 'val.cpp' };
      const mockTestset = { name: 'testsets', groups: [] };
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(testsetHelper.getGeneratorCommands).mockReturnValue([
        {
          type: 'generator',
          generator: 'gen',
          group: 'other',
          range: [1, 5],
        },
        {
          type: 'generator',
          generator: 'gen',
          group: 'samples',
        },
      ]);
      vi.mocked(executor.executeWithRedirect).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        success: true,
      });
      vi.mocked(executor.cleanup).mockResolvedValue();

      await expect(
        validator.validateGroup(mockValidator, mockTestset, 'samples')
      ).resolves.not.toThrow();

      // Should only execute once for the single test in 'samples' group
      expect(executor.executeWithRedirect).toHaveBeenCalledTimes(1);
      expect(executor.cleanup).toHaveBeenCalled();
    });

    it('should create validator test files when running testValidatorItself', async () => {
      vi.mocked(utils.readConfigFile).mockReturnValue({
        validator: {
          name: 'val',
          source: 'val.cpp',
          testsFilePath: 'validator_tests.json',
        },
      } as any);
      (vi.mocked(fs.readFile) as any).mockImplementation(
        (path: unknown, encoding: unknown, callback: unknown) => {
          const cb = callback as (err: Error | null, data: string) => void;
          cb(
            null,
            JSON.stringify({
              tests: [
                { index: 1, input: '5 10', expectedVerdict: 'VALID' },
                { index: 2, input: '-1 5', expectedVerdict: 'INVALID' },
              ],
            })
          );
        }
      );
      vi.mocked(utils.ensureDirectoryExists).mockImplementation(() => {});
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
      vi.mocked(executor.executeWithRedirect)
        .mockResolvedValueOnce({
          stdout: '',
          stderr: '',
          exitCode: 0,
          success: true,
        })
        .mockImplementation((_cmd, opts: any) => {
          if (opts.onError) {
            opts.onError({ stderr: 'Invalid input', exitCode: 1 });
          }
          return Promise.resolve({
            stdout: '',
            stderr: '',
            exitCode: 1,
            success: false,
          });
        });
      vi.mocked(executor.cleanup).mockResolvedValue();
      vi.mocked(utils.removeDirectoryRecursively).mockImplementation(() => {});

      await expect(validator.testValidatorItself()).resolves.not.toThrow();

      // Verify file writing operations were called
      expect(utils.ensureDirectoryExists).toHaveBeenCalledWith(
        'validator_tests'
      );
      expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
      expect(executor.cleanup).toHaveBeenCalled();
      expect(utils.removeDirectoryRecursively).toHaveBeenCalledWith(
        'validator_tests'
      );
    });
  });
});
