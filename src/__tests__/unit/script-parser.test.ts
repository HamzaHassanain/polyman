/**
 * @fileoverview Unit tests for script parser (script-parser.ts)
 * Tests parsing of generator commands and validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateGeneratorCommands } from '../../helpers/script-parser.js';
import type { GeneratorScriptCommand } from '../../types.js';
import fs from 'fs';
import path from 'path';

describe('Script Parser - Generator Command Validation', () => {
  const testDir = path.resolve('/tmp/polyman-test-parser');

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

  describe('validateGeneratorCommands', () => {
    it('should validate valid generator commands', () => {
      const commands: GeneratorScriptCommand[] = [
        {
          type: 'generator',
          generator: 'gen-random',
          args: ['10', '100'],
        },
        {
          type: 'generator',
          generator: 'gen-large',
          args: ['1000'],
        },
      ];

      const generators = ['gen-random', 'gen-large'];

      expect(() =>
        validateGeneratorCommands(commands, generators)
      ).not.toThrow();
    });

    it('should validate manual test commands', () => {
      const testFilePath = path.join(testDir, 'test1.txt');
      fs.writeFileSync(testFilePath, '1 2 3');

      const commands: GeneratorScriptCommand[] = [
        {
          type: 'manual',
          manualFile: testFilePath,
          group: 'samples',
        },
      ];

      expect(() => validateGeneratorCommands(commands, [])).not.toThrow();
    });

    it('should throw error if generator is missing', () => {
      const commands: GeneratorScriptCommand[] = [
        {
          type: 'generator',
          args: ['10'],
        } as GeneratorScriptCommand,
      ];

      expect(() => validateGeneratorCommands(commands, ['gen'])).toThrow(
        'Generator command missing generator name'
      );
    });

    it('should throw error if generator not found in available generators', () => {
      const commands: GeneratorScriptCommand[] = [
        {
          type: 'generator',
          generator: 'non-existent-gen',
          args: ['10'],
        },
      ];

      const generators = ['gen-random', 'gen-large'];

      expect(() => validateGeneratorCommands(commands, generators)).toThrow(
        'Generator "non-existent-gen" not found in configuration'
      );
    });

    it('should throw error if manual file is missing', () => {
      const commands: GeneratorScriptCommand[] = [
        {
          type: 'manual',
          group: 'samples',
        } as GeneratorScriptCommand,
      ];

      expect(() => validateGeneratorCommands(commands, [])).toThrow(
        'Manual command missing file path'
      );
    });

    it('should throw error if manual file does not exist', () => {
      const commands: GeneratorScriptCommand[] = [
        {
          type: 'manual',
          manualFile: '/non/existent/file.txt',
          group: 'samples',
        },
      ];

      expect(() => validateGeneratorCommands(commands, [])).toThrow(
        'Manual test file not found'
      );
    });

    it('should validate mixed generator and manual commands', () => {
      const testFilePath = path.join(testDir, 'sample.txt');
      fs.writeFileSync(testFilePath, '5 10');

      const commands: GeneratorScriptCommand[] = [
        {
          type: 'manual',
          manualFile: testFilePath,
          group: 'samples',
        },
        {
          type: 'generator',
          generator: 'gen-random',
          args: ['10'],
        },
        {
          type: 'generator',
          generator: 'gen-large',
          args: ['1000', '10000'],
        },
      ];

      const generators = ['gen-random', 'gen-large'];

      expect(() =>
        validateGeneratorCommands(commands, generators)
      ).not.toThrow();
    });

    it('should handle commands with optional fields', () => {
      const commands: GeneratorScriptCommand[] = [
        {
          type: 'generator',
          generator: 'gen',
          args: ['10'],
          group: 'small',
          points: 10,
          useInStatements: true,
        },
      ];

      expect(() => validateGeneratorCommands(commands, ['gen'])).not.toThrow();
    });

    it('should handle commands with range', () => {
      const commands: GeneratorScriptCommand[] = [
        {
          type: 'generator',
          generator: 'gen',
          args: ['10'],
          range: [1, 10],
        },
      ];

      expect(() => validateGeneratorCommands(commands, ['gen'])).not.toThrow();
    });

    it('should handle empty commands array', () => {
      expect(() => validateGeneratorCommands([], [])).not.toThrow();
    });

    it('should provide helpful error message with available generators', () => {
      const commands: GeneratorScriptCommand[] = [
        {
          type: 'generator',
          generator: 'wrong-gen',
          args: [],
        },
      ];

      const generators = ['gen-a', 'gen-b', 'gen-c'];

      try {
        validateGeneratorCommands(commands, generators);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('gen-a, gen-b, gen-c');
      }
    });

    it('should handle relative and absolute paths for manual files', () => {
      const testFilePath = path.join(testDir, 'test.txt');
      fs.writeFileSync(testFilePath, 'data');

      const originalCwd = process.cwd();
      try {
        process.chdir(testDir);

        const commands: GeneratorScriptCommand[] = [
          {
            type: 'manual',
            manualFile: 'test.txt', // Relative path
          },
        ];

        expect(() => validateGeneratorCommands(commands, [])).not.toThrow();
      } finally {
        process.chdir(originalCwd);
      }
    });

    it('should validate commands with all generator types', () => {
      const testFile = path.join(testDir, 'manual.txt');
      fs.writeFileSync(testFile, 'input');

      const commands: GeneratorScriptCommand[] = [
        {
          type: 'manual',
          manualFile: testFile,
          group: 'samples',
          useInStatements: true,
        },
        {
          type: 'generator',
          generator: 'gen-simple',
          args: [],
        },
        {
          type: 'generator',
          generator: 'gen-args',
          args: ['1', '2', '3'],
        },
        {
          type: 'generator',
          generator: 'gen-group',
          args: ['10'],
          group: 'large',
        },
        {
          type: 'generator',
          generator: 'gen-points',
          args: ['100'],
          points: 50,
        },
        {
          type: 'generator',
          generator: 'gen-range',
          args: ['5'],
          range: [1, 5],
        },
      ];

      const generators = [
        'gen-simple',
        'gen-args',
        'gen-group',
        'gen-points',
        'gen-range',
      ];

      expect(() =>
        validateGeneratorCommands(commands, generators)
      ).not.toThrow();
    });
  });
});

describe('Script Parser - Command Types', () => {
  it('should recognize manual command type', () => {
    const testDir = path.resolve('/tmp/polyman-test-types');
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
    
    const testFile = path.join(testDir, 'test.txt');
    fs.writeFileSync(testFile, 'data');

    try {
      const command: GeneratorScriptCommand = {
        type: 'manual',
        manualFile: testFile,
      };

      expect(command.type).toBe('manual');
      expect(command.manualFile).toBeDefined();

      validateGeneratorCommands([command], []);
    } finally {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should recognize generator command type', () => {
    const command: GeneratorScriptCommand = {
      type: 'generator',
      generator: 'gen',
      args: ['10'],
    };

    expect(command.type).toBe('generator');
    expect(command.generator).toBeDefined();
    expect(command.args).toBeDefined();

    validateGeneratorCommands([command], ['gen']);
  });
});

describe('Script Parser - Edge Cases', () => {
  const testDir = path.resolve('/tmp/polyman-test-edge');

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

  it('should handle generator with no arguments', () => {
    const commands: GeneratorScriptCommand[] = [
      {
        type: 'generator',
        generator: 'gen-no-args',
        args: [],
      },
    ];

    expect(() =>
      validateGeneratorCommands(commands, ['gen-no-args'])
    ).not.toThrow();
  });

  it('should handle manual file with special characters in path', () => {
    const specialDir = path.join(testDir, 'special dir with spaces');
    fs.mkdirSync(specialDir);
    const testFile = path.join(specialDir, 'test file.txt');
    fs.writeFileSync(testFile, 'data');

    const commands: GeneratorScriptCommand[] = [
      {
        type: 'manual',
        manualFile: testFile,
      },
    ];

    expect(() => validateGeneratorCommands(commands, [])).not.toThrow();
  });

  it('should handle generator names with special characters', () => {
    const commands: GeneratorScriptCommand[] = [
      {
        type: 'generator',
        generator: 'gen-special_chars.v2',
        args: ['10'],
      },
    ];

    expect(() =>
      validateGeneratorCommands(commands, ['gen-special_chars.v2'])
    ).not.toThrow();
  });

  it('should handle commands with undefined optional fields', () => {
    const commands: GeneratorScriptCommand[] = [
      {
        type: 'generator',
        generator: 'gen',
        args: ['10'],
        group: undefined,
        points: undefined,
        useInStatements: undefined,
      },
    ];

    expect(() => validateGeneratorCommands(commands, ['gen'])).not.toThrow();
  });

  it('should handle very long argument lists', () => {
    const longArgs = Array.from({ length: 100 }, (_, i) => i.toString());
    const commands: GeneratorScriptCommand[] = [
      {
        type: 'generator',
        generator: 'gen',
        args: longArgs,
      },
    ];

    expect(() => validateGeneratorCommands(commands, ['gen'])).not.toThrow();
  });

  it('should validate case-sensitive generator names', () => {
    const commands: GeneratorScriptCommand[] = [
      {
        type: 'generator',
        generator: 'GenRandom',
        args: ['10'],
      },
    ];

    // Should not match 'genrandom' or 'GENRANDOM'
    expect(() =>
      validateGeneratorCommands(commands, ['genrandom'])
    ).toThrow();

    // Should match exact case
    expect(() =>
      validateGeneratorCommands(commands, ['GenRandom'])
    ).not.toThrow();
  });
});
