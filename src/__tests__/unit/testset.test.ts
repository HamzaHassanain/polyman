/**
 * @fileoverview Unit tests for testset utilities (testset.ts)
 * Tests testset management, selection, and generation
 */

import { describe, it, expect } from 'vitest';
import {
  ensureTestsetsExist,
  findTestset,
  getGeneratorCommands,
  listTestsets,
} from '../../helpers/testset.js';
import type {
  LocalTestset,
  GeneratorScriptCommand,
  LocalGenerator,
} from '../../types.js';

describe('Testset - Validation', () => {
  describe('ensureTestsetsExist', () => {
    it('should not throw if testsets array is not empty', () => {
      const testsets: LocalTestset[] = [
        {
          name: 'tests',
        },
      ];

      expect(() => ensureTestsetsExist(testsets)).not.toThrow();
    });

    it('should throw if testsets is undefined', () => {
      expect(() => ensureTestsetsExist(undefined)).toThrow(
        'No testsets defined in the configuration file'
      );
    });

    it('should throw if testsets array is empty', () => {
      expect(() => ensureTestsetsExist([])).toThrow(
        'No testsets defined in the configuration file'
      );
    });

    it('should accept multiple testsets', () => {
      const testsets: LocalTestset[] = [
        { name: 'tests' },
        { name: 'pretests' },
        { name: 'stress' },
      ];

      expect(() => ensureTestsetsExist(testsets)).not.toThrow();
    });
  });
});

describe('Testset - Finding', () => {
  describe('findTestset', () => {
    const testsets: LocalTestset[] = [
      { name: 'tests' },
      { name: 'pretests' },
      { name: 'stress' },
    ];

    it('should find testset by name', () => {
      const found = findTestset(testsets, 'tests');
      expect(found.name).toBe('tests');
    });

    it('should throw if testset not found', () => {
      expect(() => findTestset(testsets, 'nonexistent')).toThrow(
        'Testset "nonexistent" not found'
      );
    });

    it('should list available testsets in error message', () => {
      try {
        findTestset(testsets, 'wrong');
      } catch (error) {
        expect((error as Error).message).toContain('tests, pretests, stress');
      }
    });

    it('should be case-sensitive', () => {
      expect(() => findTestset(testsets, 'Tests')).toThrow();
    });

    it('should find first matching testset', () => {
      const duplicates: LocalTestset[] = [
        { name: 'tests' },
        { name: 'tests' },
      ];
      const found = findTestset(duplicates, 'tests');
      expect(found.name).toBe('tests');
    });
  });
});

describe('Testset - Generator Commands', () => {
  describe('getGeneratorCommands', () => {
    it('should return commands from testset', () => {
      const testset: LocalTestset = {
        name: 'tests',
        generatorScript: {
          commands: [
            {
              type: 'generator',
              generator: 'gen',
              args: ['10'],
            },
          ],
        },
      };

      const commands = getGeneratorCommands(testset);
      expect(commands).toHaveLength(1);
      expect(commands[0].generator).toBe('gen');
    });

    it('should throw if testset has no generator script', () => {
      const testset: LocalTestset = {
        name: 'tests',
      };

      expect(() => getGeneratorCommands(testset)).toThrow(
        'Testset "tests" has no generator script defined'
      );
    });

    it('should throw if generator script has no commands', () => {
      const testset: LocalTestset = {
        name: 'tests',
        generatorScript: {
          commands: [],
        },
      };

      expect(() => getGeneratorCommands(testset)).toThrow(
        'generator script has no commands'
      );
    });

    it('should handle multiple commands', () => {
      const testset: LocalTestset = {
        name: 'tests',
        generatorScript: {
          commands: [
            { type: 'generator', generator: 'gen1', args: ['10'] },
            { type: 'generator', generator: 'gen2', args: ['20'] },
            { type: 'manual', manualFile: 'test.txt' },
          ],
        },
      };

      const commands = getGeneratorCommands(testset);
      expect(commands).toHaveLength(3);
    });
  });
});

describe('Testset - Configuration Types', () => {
  it('should handle testset with generator script', () => {
    const testset: LocalTestset = {
      name: 'tests',
      generatorScript: {
        commands: [{ type: 'generator', generator: 'gen', args: [] }],
      },
    };

    expect(testset.generatorScript).toBeDefined();
    expect(testset.generatorScript?.commands).toHaveLength(1);
  });

  it('should handle testset with groups', () => {
    const testset: LocalTestset = {
      name: 'tests',
      groupsEnabled: true,
      groups: [
        {
          name: 'small',
          pointsPolicy: 'EACH_TEST',
          feedbackPolicy: 'COMPLETE',
        },
        {
          name: 'large',
          pointsPolicy: 'COMPLETE_GROUP',
          feedbackPolicy: 'ICPC',
          dependencies: ['small'],
        },
      ],
    };

    expect(testset.groups).toHaveLength(2);
    expect(testset.groups?.[1].dependencies).toContain('small');
  });

  it('should handle testset with points', () => {
    const testset: LocalTestset = {
      name: 'tests',
      pointsEnabled: true,
      generatorScript: {
        commands: [
          {
            type: 'generator',
            generator: 'gen',
            args: ['10'],
            points: 50,
          },
        ],
      },
    };

    expect(testset.pointsEnabled).toBe(true);
    expect(testset.generatorScript?.commands[0].points).toBe(50);
  });

  it('should handle minimal testset', () => {
    const testset: LocalTestset = {
      name: 'tests',
    };

    expect(testset.name).toBe('tests');
    expect(testset.generatorScript).toBeUndefined();
    expect(testset.groups).toBeUndefined();
  });
});

describe('Testset - Listing', () => {
  describe('listTestsets', () => {
    it('should return formatted testset info', () => {
      const testsets: LocalTestset[] = [
        { name: 'tests' },
        { name: 'pretests' },
      ];

      const names = listTestsets(testsets);
      expect(names).toHaveLength(2);
      expect(names[0]).toContain('tests');
      expect(names[1]).toContain('pretests');
    });

    it('should handle empty array', () => {
      const names = listTestsets([]);
      expect(names).toEqual([]);
    });

    it('should maintain order', () => {
      const testsets: LocalTestset[] = [
        { name: 'z-test' },
        { name: 'a-test' },
        { name: 'm-test' },
      ];

      const names = listTestsets(testsets);
      expect(names).toHaveLength(3);
      expect(names[0]).toContain('z-test');
      expect(names[1]).toContain('a-test');
      expect(names[2]).toContain('m-test');
    });

    it('should include test count and groups info', () => {
      const testsets: LocalTestset[] = [
        {
          name: 'tests',
          generatorScript: {
            commands: [
              { type: 'generator', generator: 'gen', args: ['10'] },
              { type: 'generator', generator: 'gen', args: ['20'] },
            ],
          },
          groups: [
            { name: 'small' },
            { name: 'large' },
          ],
        },
      ];

      const names = listTestsets(testsets);
      expect(names[0]).toContain('tests');
      expect(names[0]).toContain('2 tests');
      expect(names[0]).toContain('small, large');
    });
  });
});

describe('Testset - Group Configuration', () => {
  it('should handle complete group configuration', () => {
    const testset: LocalTestset = {
      name: 'tests',
      groupsEnabled: true,
      groups: [
        {
          name: 'samples',
          pointsPolicy: 'EACH_TEST',
          feedbackPolicy: 'COMPLETE',
          dependencies: [],
        },
        {
          name: 'small',
          pointsPolicy: 'COMPLETE_GROUP',
          feedbackPolicy: 'ICPC',
          dependencies: ['samples'],
        },
        {
          name: 'large',
          pointsPolicy: 'COMPLETE_GROUP',
          feedbackPolicy: 'POINTS',
          dependencies: ['samples', 'small'],
        },
      ],
    };

    expect(testset.groups).toHaveLength(3);
    expect(testset.groups?.[2].dependencies).toHaveLength(2);
  });

  it('should handle different points policies', () => {
    const policies: Array<'COMPLETE_GROUP' | 'EACH_TEST'> = [
      'COMPLETE_GROUP',
      'EACH_TEST',
    ];

    policies.forEach(policy => {
      const testset: LocalTestset = {
        name: 'tests',
        groups: [
          {
            name: 'group1',
            pointsPolicy: policy,
            feedbackPolicy: 'COMPLETE',
          },
        ],
      };
      expect(testset.groups?.[0].pointsPolicy).toBe(policy);
    });
  });

  it('should handle different feedback policies', () => {
    const policies: Array<'NONE' | 'POINTS' | 'ICPC' | 'COMPLETE'> = [
      'NONE',
      'POINTS',
      'ICPC',
      'COMPLETE',
    ];

    policies.forEach(policy => {
      const testset: LocalTestset = {
        name: 'tests',
        groups: [
          {
            name: 'group1',
            feedbackPolicy: policy,
          },
        ],
      };
      expect(testset.groups?.[0].feedbackPolicy).toBe(policy);
    });
  });
});

describe('Testset - Generator Script Formats', () => {
  it('should handle commands array format', () => {
    const testset: LocalTestset = {
      name: 'tests',
      generatorScript: {
        commands: [{ type: 'generator', generator: 'gen', args: ['10'] }],
      },
    };

    expect(testset.generatorScript?.commands).toBeDefined();
  });

  it('should handle inline script format', () => {
    const testset: LocalTestset = {
      name: 'tests',
      generatorScript: {
        script: 'gen 1 > $\ngen 2 > $\ngen 3 > $',
      },
    };

    expect(testset.generatorScript?.script).toBeDefined();
  });

  it('should handle script file format', () => {
    const testset: LocalTestset = {
      name: 'tests',
      generatorScript: {
        scriptFile: './tests/generation-script.txt',
      },
    };

    expect(testset.generatorScript?.scriptFile).toBeDefined();
  });

  it('should handle mixed format with priority', () => {
    const testset: LocalTestset = {
      name: 'tests',
      generatorScript: {
        commands: [{ type: 'generator', generator: 'gen', args: ['10'] }],
        script: 'gen 1 > $',
        scriptFile: './script.txt',
      },
    };

    // Commands should have priority
    const commands = getGeneratorCommands(testset);
    expect(commands).toHaveLength(1);
  });
});

describe('Testset - Edge Cases', () => {
  it('should handle testset with empty name', () => {
    const testset: LocalTestset = {
      name: '',
    };

    expect(testset.name).toBe('');
  });

  it('should handle testset with special characters in name', () => {
    const testset: LocalTestset = {
      name: 'tests-v2_final.3',
    };

    expect(testset.name).toBe('tests-v2_final.3');
  });

  it('should handle groups with no dependencies', () => {
    const testset: LocalTestset = {
      name: 'tests',
      groups: [
        {
          name: 'group1',
          dependencies: [],
        },
      ],
    };

    expect(testset.groups?.[0].dependencies).toEqual([]);
  });

  it('should handle groups with undefined dependencies', () => {
    const testset: LocalTestset = {
      name: 'tests',
      groups: [
        {
          name: 'group1',
        },
      ],
    };

    expect(testset.groups?.[0].dependencies).toBeUndefined();
  });
});
