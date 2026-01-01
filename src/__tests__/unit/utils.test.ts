/**
 * @fileoverview Unit tests for utility functions (utils.ts)
 * Tests file operations, config parsing, filtering, and error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  compileCPP,
  compileJava,
  filterTestsByRange,
  getTestFiles,
  readConfigFile,
  isNumeric,
  ensureDirectoryExists,
  removeDirectoryRecursively,
  readFirstLine,
  getCompiledCommandToRun,
  ENV,
} from '../../helpers/utils.js';
import type ConfigFile from '../../types.js';

describe('Utils - File Operations', () => {
  const testDir = path.resolve('/tmp/polyman-test-utils');

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('ensureDirectoryExists', () => {
    it('should create a new directory if it does not exist', () => {
      const dirPath = path.join(testDir, 'new-dir');
      const originalCwd = process.cwd();
      
      try {
        process.chdir(testDir);
        ensureDirectoryExists('new-dir');
        expect(fs.existsSync(dirPath)).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should not throw if directory already exists', () => {
      const dirPath = path.join(testDir, 'existing-dir');
      fs.mkdirSync(dirPath);
      const originalCwd = process.cwd();
      
      try {
        process.chdir(testDir);
        expect(() => ensureDirectoryExists('existing-dir')).not.toThrow();
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should create nested directories recursively', () => {
      const originalCwd = process.cwd();
      
      try {
        process.chdir(testDir);
        ensureDirectoryExists('nested/path/to/dir');
        const nestedPath = path.join(testDir, 'nested/path/to/dir');
        expect(fs.existsSync(nestedPath)).toBe(true);
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('removeDirectoryRecursively', () => {
    it('should remove directory and all its contents', () => {
      const dirPath = path.join(testDir, 'to-remove');
      fs.mkdirSync(dirPath);
      fs.writeFileSync(path.join(dirPath, 'file.txt'), 'content');
      
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        removeDirectoryRecursively('to-remove');
        expect(fs.existsSync(dirPath)).toBe(false);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should not throw if directory does not exist', () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        expect(() => removeDirectoryRecursively('non-existent')).not.toThrow();
      } finally {
        process.chdir(originalCwd);
      }
    });
  });

  describe('readFirstLine', () => {
    it('should read the first line of a file', async () => {
      const filePath = path.join(testDir, 'test.txt');
      fs.writeFileSync(filePath, 'First line\nSecond line\nThird line');
      
      const firstLine = await readFirstLine(filePath);
      expect(firstLine).toBe('First line');
    });

    it('should handle files with only one line', async () => {
      const filePath = path.join(testDir, 'single-line.txt');
      fs.writeFileSync(filePath, 'Only line');
      
      const firstLine = await readFirstLine(filePath);
      expect(firstLine).toBe('Only line');
    });

    it('should handle empty files', async () => {
      const filePath = path.join(testDir, 'empty.txt');
      fs.writeFileSync(filePath, '');
      
      const firstLine = await readFirstLine(filePath);
      expect(firstLine).toBe('');
    });

    it('should handle files with CRLF line endings', async () => {
      const filePath = path.join(testDir, 'crlf.txt');
      fs.writeFileSync(filePath, 'First line\r\nSecond line');
      
      const firstLine = await readFirstLine(filePath);
      expect(firstLine).toBe('First line');
    });
  });
});

describe('Utils - Config File', () => {
  const testDir = path.resolve('/tmp/polyman-test-config');

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('readConfigFile', () => {
    it('should parse valid Config.json', () => {
      const configPath = path.join(testDir, 'Config.json');
      const validConfig: ConfigFile = {
        name: 'test-problem',
        timeLimit: 2000,
        memoryLimit: 256,
        inputFile: 'stdin',
        outputFile: 'stdout',
        interactive: false,
        statements: {},
        solutions: [],
        checker: {
          name: 'wcmp',
          source: 'wcmp.cpp',
        },
        validator: {
          name: 'validator',
          source: 'validators/validator.cpp',
        },
      };
      
      fs.writeFileSync(configPath, JSON.stringify(validConfig, null, 2));
      
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        const config = readConfigFile();
        expect(config.name).toBe('test-problem');
        expect(config.timeLimit).toBe(2000);
        expect(config.memoryLimit).toBe(256);
        expect(config.solutions).toHaveLength(0);
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should throw error if Config.json does not exist', () => {
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        expect(() => readConfigFile()).toThrow();
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should throw error if Config.json is invalid JSON', () => {
      const configPath = path.join(testDir, 'Config.json');
      fs.writeFileSync(configPath, '{ invalid json }');
      
      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);
        expect(() => readConfigFile()).toThrow();
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});

describe('Utils - Test Filtering', () => {
  describe('filterTestsByRange', () => {
    const testFiles = [
      'test1.txt',
      'test2.txt',
      'test3.txt',
      'test5.txt',
      'test10.txt',
      'test20.txt',
    ];

    it('should filter tests within range', () => {
      const filtered = filterTestsByRange(testFiles, 2, 5);
      expect(filtered).toEqual(['test2.txt', 'test3.txt', 'test5.txt']);
    });

    it('should return all tests if no range specified', () => {
      const filtered = filterTestsByRange(testFiles, undefined, undefined);
      expect(filtered).toEqual(testFiles);
    });

    it('should handle edge case with begin = 1', () => {
      const filtered = filterTestsByRange(testFiles, 1, 3);
      expect(filtered).toEqual(['test1.txt', 'test2.txt', 'test3.txt']);
    });

    it('should handle range with only one test', () => {
      const filtered = filterTestsByRange(testFiles, 10, 10);
      expect(filtered).toEqual(['test10.txt']);
    });

    it('should return empty array if range has no matches', () => {
      const filtered = filterTestsByRange(testFiles, 100, 200);
      expect(filtered).toEqual([]);
    });

    it('should filter only files starting with "test"', () => {
      const mixedFiles = ['test1.txt', 'sample.txt', 'test2.txt', 'input.txt'];
      const filtered = filterTestsByRange(mixedFiles, 1, 2);
      expect(filtered).toEqual(['test1.txt', 'test2.txt']);
    });
  });

  describe('getTestFiles', () => {
    const testDir = path.resolve('/tmp/polyman-test-files');

    beforeEach(() => {
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }
      // Create test files
      fs.writeFileSync(path.join(testDir, 'test1.txt'), '');
      fs.writeFileSync(path.join(testDir, 'test3.txt'), '');
      fs.writeFileSync(path.join(testDir, 'test2.txt'), '');
      fs.writeFileSync(path.join(testDir, 'test10.txt'), '');
      fs.writeFileSync(path.join(testDir, 'sample.txt'), '');
    });

    afterEach(() => {
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should return only files starting with "test"', () => {
      const testFiles = getTestFiles(testDir);
      expect(testFiles).toEqual(['test1.txt', 'test2.txt', 'test3.txt', 'test10.txt']);
    });

    it('should return files in sorted order by test number', () => {
      const testFiles = getTestFiles(testDir);
      expect(testFiles[0]).toBe('test1.txt');
      expect(testFiles[1]).toBe('test2.txt');
      expect(testFiles[2]).toBe('test3.txt');
      expect(testFiles[3]).toBe('test10.txt');
    });

    it('should return empty array for empty directory', () => {
      const emptyDir = path.join(testDir, 'empty');
      fs.mkdirSync(emptyDir);
      const testFiles = getTestFiles(emptyDir);
      expect(testFiles).toEqual([]);
    });
  });
});

describe('Utils - Numeric Check', () => {
  describe('isNumeric', () => {
    it('should return true for numeric strings', () => {
      expect(isNumeric('42')).toBe(true);
      expect(isNumeric('0')).toBe(true);
      expect(isNumeric('123')).toBe(true);
    });

    it('should return false for non-numeric strings', () => {
      expect(isNumeric('abc')).toBe(false);
      expect(isNumeric('all')).toBe(false);
      expect(isNumeric('')).toBe(false);
    });

    it('should handle negative numbers', () => {
      expect(isNumeric('-42')).toBe(true);
    });

    it('should handle decimal numbers', () => {
      expect(isNumeric('3.14')).toBe(true);
    });
  });
});

describe('Utils - Command Generation', () => {
  describe('getCompiledCommandToRun', () => {
    it('should return correct command for C++ files', () => {
      const solution = {
        name: 'main',
        source: 'solutions/main.cpp',
        tag: 'MA' as const,
      };
      
      const originalCwd = process.cwd();
      const command = getCompiledCommandToRun(solution);
      expect(command).toContain('main');
      expect(command).not.toContain('.cpp');
    });

    it('should return correct command for Java files', () => {
      const solution = {
        name: 'Main',
        source: 'solutions/Main.java',
        tag: 'MA' as const,
      };
      
      const command = getCompiledCommandToRun(solution);
      expect(command).toContain('java -cp');
      expect(command).toContain('Main');
    });

    it('should return correct command for Python files', () => {
      const solution = {
        name: 'main',
        source: 'solutions/main.py',
        tag: 'MA' as const,
      };
      
      const command = getCompiledCommandToRun(solution);
      expect(command).toContain('python');
      expect(command).toContain('main.py');
    });

    it('should return correct command for JavaScript files', () => {
      const solution = {
        name: 'main',
        source: 'solutions/main.js',
        tag: 'MA' as const,
      };
      
      const command = getCompiledCommandToRun(solution);
      expect(command).toContain('node');
      expect(command).toContain('main.js');
    });

    it('should handle standard checkers', () => {
      const checker = {
        name: 'wcmp',
        source: 'wcmp.cpp',
        isStandard: true,
      };
      
      const command = getCompiledCommandToRun(checker);
      expect(command).toContain('wcmp');
      expect(command).toContain('assets');
      expect(command).toContain('checkers');
    });

    it('should throw error for unsupported file extensions', () => {
      const solution = {
        name: 'main',
        source: 'solutions/main.rb',
        tag: 'MA' as const,
      };
      
      expect(() => getCompiledCommandToRun(solution)).toThrow('Unsupported source file extension');
    });
  });
});

describe('Utils - Environment Detection', () => {
  it('should detect platform environment', () => {
    expect(ENV).toBeDefined();
    expect(['win', 'unix']).toContain(ENV);
  });
});
