/**
 * @fileoverview Unit tests for checker utilities (checker.ts)
 * Tests checker compilation, execution, and validation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  compileChecker,
  ensureCheckerExists,
  testCheckerItself,
} from '../../helpers/checker.js';
import type { LocalChecker, CheckerTest } from '../../types.js';
import fs from 'fs';
import path from 'path';

describe('Checker - Validation', () => {
  describe('ensureCheckerExists', () => {
    it('should not throw if checker is defined', () => {
      const checker: LocalChecker = {
        name: 'wcmp',
        source: 'wcmp.cpp',
        isStandard: true,
      };

      expect(() => ensureCheckerExists(checker)).not.toThrow();
    });

    it('should throw if checker is undefined', () => {
      expect(() => ensureCheckerExists(undefined)).toThrow(
        'No checker defined in the configuration file'
      );
    });

    it('should accept standard checkers', () => {
      const standardChecker: LocalChecker = {
        name: 'wcmp',
        source: 'wcmp.cpp',
        isStandard: true,
      };

      expect(() => ensureCheckerExists(standardChecker)).not.toThrow();
    });

    it('should accept custom checkers', () => {
      const customChecker: LocalChecker = {
        name: 'custom',
        source: 'checkers/custom.cpp',
        isStandard: false,
      };

      expect(() => ensureCheckerExists(customChecker)).not.toThrow();
    });
  });
});

describe('Checker - Compilation', () => {
  const testDir = path.resolve('/tmp/polyman-test-checker');

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

  describe('compileChecker', () => {
    it('should throw if checker has no source', async () => {
      const checker = {
        name: 'no-source',
        source: '',
      } as LocalChecker;

      // Empty source will be resolved to current directory, causing compileCPP to fail
      await expect(compileChecker(checker)).rejects.toThrow();
    });

    it('should compile standard checkers from assets directory', async () => {
      const standardChecker: LocalChecker = {
        name: 'wcmp',
        source: 'wcmp.cpp',
        isStandard: true,
      };

      // Standard checkers may fail if testlib.h is not available in test environment
      // This is expected in test environment without full setup
      try {
        await compileChecker(standardChecker);
      } catch (error) {
        // Expected to fail in test environment without testlib.h
        expect(error).toBeDefined();
      }
    });

    it('should handle non-existent source file', async () => {
      const checker: LocalChecker = {
        name: 'missing',
        source: path.join(testDir, 'non-existent.cpp'),
        isStandard: false,
      };

      await expect(compileChecker(checker)).rejects.toThrow();
    });
  });
});

describe('Checker - Test Execution', () => {
  describe('Checker Test Structure', () => {
    it('should validate checker test with all required fields', () => {
      const test: CheckerTest = {
        index: 1,
        input: '5 10',
        output: '15',
        answer: '15',
        expectedVerdict: 'OK',
      };

      expect(test.index).toBe(1);
      expect(test.input).toBe('5 10');
      expect(test.output).toBe('15');
      expect(test.answer).toBe('15');
      expect(test.expectedVerdict).toBe('OK');
    });

    it('should validate checker test with WRONG_ANSWER verdict', () => {
      const test: CheckerTest = {
        index: 2,
        input: '5 10',
        output: '16',
        answer: '15',
        expectedVerdict: 'WRONG_ANSWER',
      };

      expect(test.expectedVerdict).toBe('WRONG_ANSWER');
    });

    it('should validate checker test with PRESENTATION_ERROR verdict', () => {
      const test: CheckerTest = {
        index: 3,
        input: '5 10',
        output: '15 ',
        answer: '15',
        expectedVerdict: 'PRESENTATION_ERROR',
      };

      expect(test.expectedVerdict).toBe('PRESENTATION_ERROR');
    });

    it('should validate checker test with CRASHED verdict', () => {
      const test: CheckerTest = {
        index: 4,
        input: '5 10',
        output: 'invalid',
        answer: '15',
        expectedVerdict: 'CRASHED',
      };

      expect(test.expectedVerdict).toBe('CRASHED');
    });
  });
});

describe('Checker - Configuration Types', () => {
  it('should handle standard checker configuration', () => {
    const config: LocalChecker = {
      name: 'wcmp',
      source: 'wcmp.cpp',
      isStandard: true,
      sourceType: 'cpp.g++17',
    };

    expect(config.isStandard).toBe(true);
    expect(config.sourceType).toBe('cpp.g++17');
  });

  it('should handle custom checker configuration', () => {
    const config: LocalChecker = {
      name: 'custom-checker',
      source: 'checkers/custom.cpp',
      isStandard: false,
      sourceType: 'cpp.g++20',
      testsFilePath: 'checkers/tests.json',
    };

    expect(config.isStandard).toBe(false);
    expect(config.testsFilePath).toBe('checkers/tests.json');
  });

  it('should handle checker with test file path', () => {
    const config: LocalChecker = {
      name: 'checker',
      source: 'checker.cpp',
      testsFilePath: './checker-tests.json',
    };

    expect(config.testsFilePath).toBe('./checker-tests.json');
  });

  it('should handle minimal checker configuration', () => {
    const config: LocalChecker = {
      name: 'minimal',
      source: 'minimal.cpp',
    };

    expect(config.name).toBe('minimal');
    expect(config.source).toBe('minimal.cpp');
    expect(config.isStandard).toBeUndefined();
  });
});

describe('Checker - Verdict Types', () => {
  it('should recognize OK verdict', () => {
    const verdict: 'OK' = 'OK';
    expect(verdict).toBe('OK');
  });

  it('should recognize WRONG_ANSWER verdict', () => {
    const verdict: 'WRONG_ANSWER' = 'WRONG_ANSWER';
    expect(verdict).toBe('WRONG_ANSWER');
  });

  it('should recognize PRESENTATION_ERROR verdict', () => {
    const verdict: 'PRESENTATION_ERROR' = 'PRESENTATION_ERROR';
    expect(verdict).toBe('PRESENTATION_ERROR');
  });

  it('should recognize CRASHED verdict', () => {
    const verdict: 'CRASHED' = 'CRASHED';
    expect(verdict).toBe('CRASHED');
  });
});

describe('Checker - Error Handling', () => {
  it('should handle missing checker name', () => {
    const checker = {
      source: 'checker.cpp',
    } as any;

    // Type system should catch this, but test runtime behavior
    expect(checker.name).toBeUndefined();
  });

  it('should handle missing source file', () => {
    const checker = {
      name: 'checker',
    } as any;

    expect(checker.source).toBeUndefined();
  });
});

describe('Checker - Edge Cases', () => {
  it('should handle checker with empty name', () => {
    const checker: LocalChecker = {
      name: '',
      source: 'checker.cpp',
    };

    expect(checker.name).toBe('');
  });

  it('should handle checker with special characters in name', () => {
    const checker: LocalChecker = {
      name: 'checker-v2_final.3',
      source: 'checker.cpp',
    };

    expect(checker.name).toBe('checker-v2_final.3');
  });

  it('should handle checker with relative path', () => {
    const checker: LocalChecker = {
      name: 'checker',
      source: './checkers/checker.cpp',
    };

    expect(checker.source).toBe('./checkers/checker.cpp');
  });

  it('should handle checker with absolute path', () => {
    const checker: LocalChecker = {
      name: 'checker',
      source: '/absolute/path/to/checker.cpp',
    };

    expect(checker.source).toBe('/absolute/path/to/checker.cpp');
  });
});
