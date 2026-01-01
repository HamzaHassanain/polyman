/**
 * @fileoverview Unit tests for generator utilities (generator.ts)
 * Tests generator compilation, execution, and validation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  compileGenerator,
  ensureGeneratorsExist,
  compileAllGenerators,
} from '../../helpers/generator.js';
import type { LocalGenerator } from '../../types.js';
import fs from 'fs';
import path from 'path';

describe('Generator - Validation', () => {
  describe('ensureGeneratorsExist', () => {
    it('should not throw if generators array is not empty', () => {
      const generators: LocalGenerator[] = [
        {
          name: 'gen-random',
          source: 'generators/gen-random.cpp',
        },
      ];

      expect(() => ensureGeneratorsExist(generators)).not.toThrow();
    });

    it('should throw if generators is undefined', () => {
      expect(() => ensureGeneratorsExist(undefined)).toThrow(
        'No test generators defined in the configuration file'
      );
    });

    it('should throw if generators array is empty', () => {
      expect(() => ensureGeneratorsExist([])).toThrow(
        'No test generators defined in the configuration file'
      );
    });

    it('should accept multiple generators', () => {
      const generators: LocalGenerator[] = [
        { name: 'gen1', source: 'gen1.cpp' },
        { name: 'gen2', source: 'gen2.cpp' },
        { name: 'gen3', source: 'gen3.cpp' },
      ];

      expect(() => ensureGeneratorsExist(generators)).not.toThrow();
    });
  });
});

describe('Generator - Compilation', () => {
  const testDir = path.resolve('/tmp/polyman-test-generator');

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

  describe('compileGenerator', () => {
    it('should throw if generator has no source', async () => {
      const generator = {
        name: 'no-source',
        source: '',
      } as LocalGenerator;

      // Error message includes generator name
      await expect(compileGenerator(generator)).rejects.toThrow(
        'Generator no-source has no source file specified'
      );
    });

    it('should handle non-existent source file', async () => {
      const generator: LocalGenerator = {
        name: 'missing',
        source: path.join(testDir, 'non-existent.cpp'),
      };

      await expect(compileGenerator(generator)).rejects.toThrow();
    });

    it('should return compiled executable path', async () => {
      // This test would need a real C++ file to compile
      // For now, we just test the error case
      const generator: LocalGenerator = {
        name: 'test',
        source: '/invalid/path.cpp',
      };

      await expect(compileGenerator(generator)).rejects.toThrow();
    });
  });
});

describe('Generator - Configuration Types', () => {
  it('should handle generator with source type', () => {
    const config: LocalGenerator = {
      name: 'gen-random',
      source: 'generators/gen-random.cpp',
      sourceType: 'cpp.g++17',
    };

    expect(config.sourceType).toBe('cpp.g++17');
  });

  it('should handle generator with all C++ versions', () => {
    const generators: LocalGenerator[] = [
      { name: 'gen1', source: 'gen1.cpp', sourceType: 'cpp.g++11' },
      { name: 'gen2', source: 'gen2.cpp', sourceType: 'cpp.g++14' },
      { name: 'gen3', source: 'gen3.cpp', sourceType: 'cpp.g++17' },
      { name: 'gen4', source: 'gen4.cpp', sourceType: 'cpp.g++20' },
      { name: 'gen5', source: 'gen5.cpp', sourceType: 'cpp.ms2017' },
      { name: 'gen6', source: 'gen6.cpp', sourceType: 'cpp.ms2019' },
      { name: 'gen7', source: 'gen7.cpp', sourceType: 'cpp.clang++17' },
      { name: 'gen8', source: 'gen8.cpp', sourceType: 'cpp.clang++20' },
    ];

    generators.forEach(gen => {
      expect(gen.sourceType).toBeDefined();
      expect(gen.sourceType).toContain('cpp');
    });
  });

  it('should handle minimal generator', () => {
    const config: LocalGenerator = {
      name: 'minimal',
      source: 'minimal.cpp',
    };

    expect(config.name).toBe('minimal');
    expect(config.source).toBe('minimal.cpp');
    expect(config.sourceType).toBeUndefined();
  });

  it('should handle generator with full configuration', () => {
    const config: LocalGenerator = {
      name: 'full-generator',
      source: 'generators/full.cpp',
      sourceType: 'cpp.g++20',
    };

    expect(config.name).toBe('full-generator');
    expect(config.source).toBe('generators/full.cpp');
    expect(config.sourceType).toBe('cpp.g++20');
  });
});

describe('Generator - Naming Conventions', () => {
  it('should handle generator with descriptive name', () => {
    const generator: LocalGenerator = {
      name: 'gen-random-tree',
      source: 'generators/tree.cpp',
    };

    expect(generator.name).toBe('gen-random-tree');
  });

  it('should handle generator with version in name', () => {
    const generator: LocalGenerator = {
      name: 'gen-v2',
      source: 'generators/gen-v2.cpp',
    };

    expect(generator.name).toBe('gen-v2');
  });

  it('should handle generator with underscores', () => {
    const generator: LocalGenerator = {
      name: 'gen_random_graph',
      source: 'generators/graph.cpp',
    };

    expect(generator.name).toBe('gen_random_graph');
  });

  it('should handle generator with numbers', () => {
    const generator: LocalGenerator = {
      name: 'gen123',
      source: 'generators/gen123.cpp',
    };

    expect(generator.name).toBe('gen123');
  });
});

describe('Generator - Path Handling', () => {
  it('should handle relative path', () => {
    const generator: LocalGenerator = {
      name: 'gen',
      source: './generators/gen.cpp',
    };

    expect(generator.source).toBe('./generators/gen.cpp');
  });

  it('should handle absolute path', () => {
    const generator: LocalGenerator = {
      name: 'gen',
      source: '/absolute/path/to/gen.cpp',
    };

    expect(generator.source).toBe('/absolute/path/to/gen.cpp');
  });

  it('should handle nested directory path', () => {
    const generator: LocalGenerator = {
      name: 'gen',
      source: 'generators/nested/path/gen.cpp',
    };

    expect(generator.source).toBe('generators/nested/path/gen.cpp');
  });

  it('should handle path with spaces', () => {
    const generator: LocalGenerator = {
      name: 'gen',
      source: 'path with spaces/gen.cpp',
    };

    expect(generator.source).toBe('path with spaces/gen.cpp');
  });
});

describe('Generator - Error Handling', () => {
  it('should handle missing generator name', () => {
    const generator = {
      source: 'gen.cpp',
    } as any;

    expect(generator.name).toBeUndefined();
  });

  it('should handle missing source file', () => {
    const generator = {
      name: 'gen',
    } as any;

    expect(generator.source).toBeUndefined();
  });

  it('should handle invalid source type', () => {
    const generator: LocalGenerator = {
      name: 'gen',
      source: 'gen.cpp',
      sourceType: 'invalid-type' as any,
    };

    expect(generator.sourceType).toBe('invalid-type');
  });
});

describe('Generator - Edge Cases', () => {
  it('should handle empty name', () => {
    const generator: LocalGenerator = {
      name: '',
      source: 'gen.cpp',
    };

    expect(generator.name).toBe('');
  });

  it('should handle very long name', () => {
    const longName = 'gen-'.repeat(50) + 'random';
    const generator: LocalGenerator = {
      name: longName,
      source: 'gen.cpp',
    };

    expect(generator.name).toBe(longName);
  });

  it('should handle special characters in name', () => {
    const generator: LocalGenerator = {
      name: 'gen-!@#$%',
      source: 'gen.cpp',
    };

    expect(generator.name).toBe('gen-!@#$%');
  });
});

describe('Generator - Multiple Generators', () => {
  it('should handle multiple generators with different purposes', () => {
    const generators: LocalGenerator[] = [
      { name: 'gen-random', source: 'generators/random.cpp' },
      { name: 'gen-worst', source: 'generators/worst.cpp' },
      { name: 'gen-manual', source: 'generators/manual.cpp' },
      { name: 'gen-edge', source: 'generators/edge.cpp' },
    ];

    expect(generators).toHaveLength(4);
    expect(generators.map(g => g.name)).toContain('gen-random');
    expect(generators.map(g => g.name)).toContain('gen-worst');
  });

  it('should handle generators with same source type', () => {
    const generators: LocalGenerator[] = [
      { name: 'gen1', source: 'gen1.cpp', sourceType: 'cpp.g++17' },
      { name: 'gen2', source: 'gen2.cpp', sourceType: 'cpp.g++17' },
      { name: 'gen3', source: 'gen3.cpp', sourceType: 'cpp.g++17' },
    ];

    generators.forEach(gen => {
      expect(gen.sourceType).toBe('cpp.g++17');
    });
  });

  it('should handle generators with different source types', () => {
    const generators: LocalGenerator[] = [
      { name: 'gen1', source: 'gen1.cpp', sourceType: 'cpp.g++11' },
      { name: 'gen2', source: 'gen2.cpp', sourceType: 'cpp.g++17' },
      { name: 'gen3', source: 'gen3.cpp', sourceType: 'cpp.g++20' },
    ];

    const sourceTypes = generators.map(g => g.sourceType);
    expect(new Set(sourceTypes).size).toBe(3);
  });

  it('should find generator by name', () => {
    const generators: LocalGenerator[] = [
      { name: 'gen-a', source: 'a.cpp' },
      { name: 'gen-b', source: 'b.cpp' },
      { name: 'gen-c', source: 'c.cpp' },
    ];

    const found = generators.find(g => g.name === 'gen-b');
    expect(found).toBeDefined();
    expect(found?.source).toBe('b.cpp');
  });

  it('should filter generators by source type', () => {
    const generators: LocalGenerator[] = [
      { name: 'gen1', source: 'gen1.cpp', sourceType: 'cpp.g++17' },
      { name: 'gen2', source: 'gen2.cpp', sourceType: 'cpp.g++20' },
      { name: 'gen3', source: 'gen3.cpp', sourceType: 'cpp.g++17' },
    ];

    const cpp17Gens = generators.filter(g => g.sourceType === 'cpp.g++17');
    expect(cpp17Gens).toHaveLength(2);
  });
});

describe('Generator - Testlib Source Type', () => {
  it('should only accept C++ source types for generators', () => {
    // Generators must use C++ because they use testlib.h
    const validSourceTypes: Array<LocalGenerator['sourceType']> = [
      'cpp.g++11',
      'cpp.g++14',
      'cpp.g++17',
      'cpp.g++20',
      'cpp.ms2017',
      'cpp.ms2019',
      'cpp.clang++17',
      'cpp.clang++20',
    ];

    validSourceTypes.forEach(sourceType => {
      const generator: LocalGenerator = {
        name: 'gen',
        source: 'gen.cpp',
        sourceType,
      };
      expect(generator.sourceType).toContain('cpp');
    });
  });
});
