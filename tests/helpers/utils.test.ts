import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as utils from '../../src/helpers/utils';
import fs from 'fs';
import { executor } from '../../src/executor';
import path from 'path';
import { fmt } from '../../src/formatter';

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
const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
  throw new Error('process.exit called');
}) as any);

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
      vi.mocked(fs.readdirSync).mockReturnValue([
        'test10.txt',
        'test2.txt',
        'other.txt',
      ] as any);
      const result = utils.getTestFiles('dir');
      expect(result).toEqual(['test2.txt', 'test10.txt']);
    });
  });

  describe('Compilation', () => {
    describe('compileCPP', () => {
      it('should compile cpp file', async () => {
        await utils.compileCPP('main.cpp');
        expect(executor.execute).toHaveBeenCalledWith(
          expect.stringContaining('g++ -o'),
          expect.anything()
        );
      });
      it('should throw if file is not .cpp', async () => {
        await expect(utils.compileCPP('main.c')).rejects.toThrow(
          /Expected .cpp file/
        );
      });
    });

    describe('compileJava', () => {
      it('should compile java file', async () => {
        await utils.compileJava('Main.java');
        expect(executor.execute).toHaveBeenCalledWith(
          expect.stringContaining('javac'),
          expect.anything()
        );
      });
    });
  });

  describe('Directories', () => {
    describe('ensureDirectoryExists', () => {
      it('should create directory if missing', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        utils.ensureDirectoryExists('new-dir');
        expect(fs.mkdirSync).toHaveBeenCalledWith(
          expect.stringContaining('new-dir'),
          { recursive: true }
        );
      });
      it('should do nothing if directory exists', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        utils.ensureDirectoryExists('exists');
        expect(fs.mkdirSync).not.toHaveBeenCalled();
      });
    });

    describe('removeDirectoryRecursively', () => {
      it('should remove directory if exists', () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        utils.removeDirectoryRecursively('del-dir');
        expect(fs.rmSync).toHaveBeenCalledWith(
          expect.stringContaining('del-dir'),
          { recursive: true, force: true }
        );
      });
      it('should do nothing if directory missing', () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);
        utils.removeDirectoryRecursively('missing');
        expect(fs.rmSync).not.toHaveBeenCalled();
      });
    });
  });

  describe('readConfigFile', () => {
    it('should return parsed config', () => {
      vi.mocked(fs.readFileSync).mockReturnValue('{"solutions": []}');
      expect(utils.readConfigFile()).toEqual({ solutions: [] });
    });
    it('should throw if file reading fails', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('Fail');
      });
      expect(() => utils.readConfigFile()).toThrow('Fail');
    });
  });

  describe('readFirstLine', () => {
    it('should return first line from stream', async () => {
      const mockOn = vi.fn();
      // Simulate data event then end
      mockOn.mockImplementation((event, cb) => {
        if (event === 'data') {
          setTimeout(() => cb('first line\nsecond line'), 0);
        }
      });

      vi.mocked(fs.createReadStream).mockReturnValue({
        on: mockOn,
        close: vi.fn(),
      } as any);
      await expect(utils.readFirstLine('file.txt')).resolves.toBe('first line');
    });

    it('should handle empty file', async () => {
      const mockOn = vi.fn();
      // Simulate end without data
      mockOn.mockImplementation((event, cb) => {
        if (event === 'end') {
          setTimeout(cb, 0);
        }
      });

      vi.mocked(fs.createReadStream).mockReturnValue({
        on: mockOn,
        close: vi.fn(),
      } as any);
      await expect(utils.readFirstLine('file.txt')).resolves.toBe('');
    });

    it('should handle stream error', async () => {
      const mockOn = vi.fn();
      // Simulate error
      mockOn.mockImplementation((event, cb) => {
        if (event === 'error') {
          setTimeout(() => cb(new Error('Stream Error')), 0);
        }
      });

      vi.mocked(fs.createReadStream).mockReturnValue({
        on: mockOn,
        close: vi.fn(),
      } as any);
      await expect(utils.readFirstLine('file.txt')).rejects.toThrow(
        'Stream Error'
      );
    });
  });

  describe('getCompiledCommandToRun', () => {
    it('should handle .cpp', () => {
      const obj = { source: 'main.cpp', name: 'main' } as any;
      expect(utils.getCompiledCommandToRun(obj)).toContain('main');
      expect(utils.getCompiledCommandToRun(obj)).not.toContain('.cpp');
    });

    it('should handle .java', () => {
      const obj = { source: 'pkg/Main.java', name: 'Main' } as any;
      // Should return java -cp ... Main
      expect(utils.getCompiledCommandToRun(obj)).toContain('java -cp');
    });

    it('should handle .py', () => {
      const obj = { source: 'script.py', name: 'script' } as any;
      expect(utils.getCompiledCommandToRun(obj)).toContain('python');
    });

    it('should handle .js', () => {
      const obj = { source: 'script.js', name: 'script' } as any;
      expect(utils.getCompiledCommandToRun(obj)).toContain('node');
    });

    it('should throw on unknown extension', () => {
      const obj = { source: 'script.rb', name: 'script' } as any;
      expect(() => utils.getCompiledCommandToRun(obj)).toThrow(
        /Unsupported source file extension/
      );
    });

    it('should handle standard checkers', () => {
      const obj = { source: 'std.cpp', isStandard: true } as any;
      const res = utils.getCompiledCommandToRun(obj);
      expect(res).toContain('assets/checkers/std');
    });
  });

  describe('Error Handling', () => {
    it('logError should call fmt.error', () => {
      utils.logError('message');
      expect(fmt.error).toHaveBeenCalled();
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
});
