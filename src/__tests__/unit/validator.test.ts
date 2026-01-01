/**
 * @fileoverview Unit tests for validator utilities (validator.ts)
 * Tests validator compilation, execution, and validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  compileValidator,
  ensureValidatorExists,
} from '../../helpers/validator.js';
import type { LocalValidator, ValidatorTest } from '../../types.js';
import fs from 'fs';
import path from 'path';

describe('Validator - Validation', () => {
  describe('ensureValidatorExists', () => {
    it('should not throw if validator is defined', () => {
      const validator: LocalValidator = {
        name: 'validator',
        source: 'validators/validator.cpp',
      };

      expect(() => ensureValidatorExists(validator)).not.toThrow();
    });

    it('should throw if validator is undefined', () => {
      expect(() => ensureValidatorExists(undefined)).toThrow(
        'No validator defined in the configuration file'
      );
    });

    it('should accept validator with all optional fields', () => {
      const validator: LocalValidator = {
        name: 'validator',
        source: 'validators/validator.cpp',
        sourceType: 'cpp.g++17',
        testsFilePath: 'validators/tests.json',
      };

      expect(() => ensureValidatorExists(validator)).not.toThrow();
    });

    it('should accept minimal validator', () => {
      const validator: LocalValidator = {
        name: 'val',
        source: 'val.cpp',
      };

      expect(() => ensureValidatorExists(validator)).not.toThrow();
    });
  });
});

describe('Validator - Compilation', () => {
  const testDir = path.resolve('/tmp/polyman-test-validator');

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

  describe('compileValidator', () => {
    it('should throw if validator has no source', async () => {
      const validator = {
        name: 'no-source',
        source: '',
      } as LocalValidator;

      await expect(compileValidator(validator)).rejects.toThrow(
        'Validator has no source file specified'
      );
    });

    it('should handle non-existent source file', async () => {
      const validator: LocalValidator = {
        name: 'missing',
        source: path.join(testDir, 'non-existent.cpp'),
      };

      await expect(compileValidator(validator)).rejects.toThrow();
    });

    it('should throw error for invalid source path', async () => {
      const validator: LocalValidator = {
        name: 'invalid',
        source: '/invalid/path/validator.cpp',
      };

      await expect(compileValidator(validator)).rejects.toThrow();
    });
  });
});

describe('Validator - Test Structure', () => {
  describe('ValidatorTest Type', () => {
    it('should validate test with VALID verdict', () => {
      const test: ValidatorTest = {
        index: 1,
        input: '5 10',
        expectedVerdict: 'VALID',
      };

      expect(test.index).toBe(1);
      expect(test.input).toBe('5 10');
      expect(test.expectedVerdict).toBe('VALID');
    });

    it('should validate test with INVALID verdict', () => {
      const test: ValidatorTest = {
        index: 2,
        input: '-1 5',
        expectedVerdict: 'INVALID',
      };

      expect(test.expectedVerdict).toBe('INVALID');
    });

    it('should validate test with testset', () => {
      const test: ValidatorTest = {
        index: 3,
        input: '100 200',
        expectedVerdict: 'VALID',
        testset: 'tests',
      };

      expect(test.testset).toBe('tests');
    });

    it('should validate test with group', () => {
      const test: ValidatorTest = {
        index: 4,
        input: '1000 2000',
        expectedVerdict: 'VALID',
        group: 'large',
      };

      expect(test.group).toBe('large');
    });

    it('should validate test with testset and group', () => {
      const test: ValidatorTest = {
        index: 5,
        input: '10 20',
        expectedVerdict: 'VALID',
        testset: 'tests',
        group: 'small',
      };

      expect(test.testset).toBe('tests');
      expect(test.group).toBe('small');
    });
  });
});

describe('Validator - Configuration Types', () => {
  it('should handle validator with source type', () => {
    const config: LocalValidator = {
      name: 'validator',
      source: 'validators/validator.cpp',
      sourceType: 'cpp.g++17',
    };

    expect(config.sourceType).toBe('cpp.g++17');
  });

  it('should handle validator with tests file path', () => {
    const config: LocalValidator = {
      name: 'validator',
      source: 'validators/validator.cpp',
      testsFilePath: 'validators/tests.json',
    };

    expect(config.testsFilePath).toBe('validators/tests.json');
  });

  it('should handle validator with all fields', () => {
    const config: LocalValidator = {
      name: 'full-validator',
      source: 'validators/full.cpp',
      sourceType: 'cpp.g++20',
      testsFilePath: 'validators/full-tests.json',
    };

    expect(config.name).toBe('full-validator');
    expect(config.source).toBe('validators/full.cpp');
    expect(config.sourceType).toBe('cpp.g++20');
    expect(config.testsFilePath).toBe('validators/full-tests.json');
  });

  it('should handle minimal validator', () => {
    const config: LocalValidator = {
      name: 'minimal',
      source: 'minimal.cpp',
    };

    expect(config.name).toBe('minimal');
    expect(config.source).toBe('minimal.cpp');
    expect(config.sourceType).toBeUndefined();
    expect(config.testsFilePath).toBeUndefined();
  });
});

describe('Validator - Verdict Types', () => {
  it('should recognize VALID verdict', () => {
    const verdict: 'VALID' = 'VALID';
    expect(verdict).toBe('VALID');
  });

  it('should recognize INVALID verdict', () => {
    const verdict: 'INVALID' = 'INVALID';
    expect(verdict).toBe('INVALID');
  });

  it('should work with verdict in test', () => {
    const test: ValidatorTest = {
      index: 1,
      input: 'test',
      expectedVerdict: 'VALID',
    };

    const verdict = test.expectedVerdict;
    expect(['VALID', 'INVALID']).toContain(verdict);
  });
});

describe('Validator - Error Handling', () => {
  it('should handle missing validator name', () => {
    const validator = {
      source: 'validator.cpp',
    } as any;

    expect(validator.name).toBeUndefined();
  });

  it('should handle missing source file', () => {
    const validator = {
      name: 'validator',
    } as any;

    expect(validator.source).toBeUndefined();
  });

  it('should handle invalid source type', () => {
    const validator: LocalValidator = {
      name: 'validator',
      source: 'validator.cpp',
      sourceType: 'invalid-type' as any,
    };

    // Type system won't catch this at runtime
    expect(validator.sourceType).toBe('invalid-type');
  });
});

describe('Validator - Edge Cases', () => {
  it('should handle validator with empty name', () => {
    const validator: LocalValidator = {
      name: '',
      source: 'validator.cpp',
    };

    expect(validator.name).toBe('');
  });

  it('should handle validator with special characters in name', () => {
    const validator: LocalValidator = {
      name: 'validator-v2_final.3',
      source: 'validator.cpp',
    };

    expect(validator.name).toBe('validator-v2_final.3');
  });

  it('should handle validator with relative path', () => {
    const validator: LocalValidator = {
      name: 'validator',
      source: './validators/validator.cpp',
    };

    expect(validator.source).toBe('./validators/validator.cpp');
  });

  it('should handle validator with absolute path', () => {
    const validator: LocalValidator = {
      name: 'validator',
      source: '/absolute/path/to/validator.cpp',
    };

    expect(validator.source).toBe('/absolute/path/to/validator.cpp');
  });

  it('should handle test with empty input', () => {
    const test: ValidatorTest = {
      index: 1,
      input: '',
      expectedVerdict: 'INVALID',
    };

    expect(test.input).toBe('');
  });

  it('should handle test with multiline input', () => {
    const test: ValidatorTest = {
      index: 1,
      input: '5\n1 2 3 4 5',
      expectedVerdict: 'VALID',
    };

    expect(test.input).toContain('\n');
  });

  it('should handle test with special characters', () => {
    const test: ValidatorTest = {
      index: 1,
      input: '!@#$%^&*()',
      expectedVerdict: 'INVALID',
    };

    expect(test.input).toBe('!@#$%^&*()');
  });
});

describe('Validator - Multiple Validators', () => {
  it('should handle array of validators', () => {
    const validators: LocalValidator[] = [
      {
        name: 'val1',
        source: 'validators/val1.cpp',
      },
      {
        name: 'val2',
        source: 'validators/val2.cpp',
      },
    ];

    expect(validators).toHaveLength(2);
    expect(validators[0].name).toBe('val1');
    expect(validators[1].name).toBe('val2');
  });

  it('should handle empty validators array', () => {
    const validators: LocalValidator[] = [];
    expect(validators).toHaveLength(0);
  });
});
