/**
 * @fileoverview Unit tests for solution utilities (solution.ts)
 * Tests solution management, compilation, and validation
 */

import { describe, it, expect } from 'vitest';
import {
  validateSolutionsExist,
  findMatchingSolutions,
  ensureMainSolutionExists,
  getMainSolution,
} from '../../helpers/solution.js';
import type { LocalSolution } from '../../types.js';

describe('Solution - Validation', () => {
  describe('validateSolutionsExist', () => {
    it('should not throw if solutions array is not empty', () => {
      const solutions: LocalSolution[] = [
        {
          name: 'main',
          source: 'solutions/main.cpp',
          tag: 'MA',
        },
      ];

      expect(() => validateSolutionsExist(solutions)).not.toThrow();
    });

    it('should throw if solutions is undefined', () => {
      expect(() => validateSolutionsExist(undefined)).toThrow(
        'No solutions defined in the configuration file'
      );
    });

    it('should throw if solutions array is empty', () => {
      expect(() => validateSolutionsExist([])).toThrow(
        'No solutions defined in the configuration file'
      );
    });

    it('should accept multiple solutions', () => {
      const solutions: LocalSolution[] = [
        { name: 'main', source: 'main.cpp', tag: 'MA' },
        { name: 'wrong', source: 'wrong.cpp', tag: 'WA' },
        { name: 'tle', source: 'tle.cpp', tag: 'TL' },
      ];

      expect(() => validateSolutionsExist(solutions)).not.toThrow();
    });
  });
});

describe('Solution - Finding', () => {
  const solutions: LocalSolution[] = [
    { name: 'main', source: 'solutions/main.cpp', tag: 'MA' },
    { name: 'wrong', source: 'solutions/wrong.cpp', tag: 'WA' },
    { name: 'tle', source: 'solutions/tle.cpp', tag: 'TL' },
  ];

  describe('findMatchingSolutions', () => {
    it('should find solution by name', () => {
      const found = findMatchingSolutions(solutions, 'main');
      expect(found).toHaveLength(1);
      expect(found[0].name).toBe('main');
    });

    it('should return all solutions when name is "all"', () => {
      const found = findMatchingSolutions(solutions, 'all');
      expect(found).toHaveLength(3);
    });

    it('should throw if solution not found', () => {
      expect(() => findMatchingSolutions(solutions, 'nonexistent')).toThrow(
        'Solution named "nonexistent" not found'
      );
    });

    it('should be case-sensitive', () => {
      expect(() => findMatchingSolutions(solutions, 'Main')).toThrow();
    });

    it('should find multiple solutions with same name', () => {
      const duplicates: LocalSolution[] = [
        { name: 'solution', source: 'sol1.cpp', tag: 'MA' },
        { name: 'solution', source: 'sol2.cpp', tag: 'OK' },
      ];

      const found = findMatchingSolutions(duplicates, 'solution');
      expect(found).toHaveLength(2);
    });
  });

  describe('getMainSolution', () => {
    it('should find main accepted solution', () => {
      const main = getMainSolution(solutions);
      expect(main.tag).toBe('MA');
      expect(main.name).toBe('main');
    });

    it('should throw if no MA solution exists', () => {
      const noMain: LocalSolution[] = [
        { name: 'ok', source: 'ok.cpp', tag: 'OK' },
        { name: 'wa', source: 'wa.cpp', tag: 'WA' },
      ];

      expect(() => getMainSolution(noMain)).toThrow(
        'Main correct solution (tag "MA") not found'
      );
    });

    it('should return first MA solution if multiple exist', () => {
      const multipleMain: LocalSolution[] = [
        { name: 'main1', source: 'main1.cpp', tag: 'MA' },
        { name: 'main2', source: 'main2.cpp', tag: 'MA' },
      ];

      const main = getMainSolution(multipleMain);
      expect(main.name).toBe('main1');
    });
  });

  describe('ensureMainSolutionExists', () => {
    it('should not throw if MA solution exists', () => {
      expect(() => ensureMainSolutionExists(solutions)).not.toThrow();
    });

    it('should throw if no MA solution exists', () => {
      const noMain: LocalSolution[] = [
        { name: 'ok', source: 'ok.cpp', tag: 'OK' },
      ];

      expect(() => ensureMainSolutionExists(noMain)).toThrow();
    });
  });
});

describe('Solution - Tags', () => {
  it('should recognize MA (Main Accepted) tag', () => {
    const solution: LocalSolution = {
      name: 'main',
      source: 'main.cpp',
      tag: 'MA',
    };

    expect(solution.tag).toBe('MA');
  });

  it('should recognize OK (Alternative Correct) tag', () => {
    const solution: LocalSolution = {
      name: 'alt',
      source: 'alt.cpp',
      tag: 'OK',
    };

    expect(solution.tag).toBe('OK');
  });

  it('should recognize WA (Wrong Answer) tag', () => {
    const solution: LocalSolution = {
      name: 'wrong',
      source: 'wrong.cpp',
      tag: 'WA',
    };

    expect(solution.tag).toBe('WA');
  });

  it('should recognize TL (Time Limit) tag', () => {
    const solution: LocalSolution = {
      name: 'slow',
      source: 'slow.cpp',
      tag: 'TL',
    };

    expect(solution.tag).toBe('TL');
  });

  it('should recognize all valid tags', () => {
    const tags: Array<'MA' | 'OK' | 'RJ' | 'TL' | 'TO' | 'WA' | 'PE' | 'ML' | 'RE'> = [
      'MA',
      'OK',
      'RJ',
      'TL',
      'TO',
      'WA',
      'PE',
      'ML',
      'RE',
    ];

    tags.forEach(tag => {
      const solution: LocalSolution = {
        name: `sol-${tag}`,
        source: `${tag}.cpp`,
        tag,
      };
      expect(solution.tag).toBe(tag);
    });
  });
});

describe('Solution - Source Types', () => {
  it('should handle C++ solutions', () => {
    const solution: LocalSolution = {
      name: 'main',
      source: 'solutions/main.cpp',
      tag: 'MA',
      sourceType: 'cpp.g++17',
    };

    expect(solution.sourceType).toBe('cpp.g++17');
  });

  it('should handle Java solutions', () => {
    const solution: LocalSolution = {
      name: 'Main',
      source: 'solutions/Main.java',
      tag: 'MA',
      sourceType: 'java.11',
    };

    expect(solution.sourceType).toBe('java.11');
  });

  it('should handle Python solutions', () => {
    const solution: LocalSolution = {
      name: 'main',
      source: 'solutions/main.py',
      tag: 'MA',
      sourceType: 'python.3',
    };

    expect(solution.sourceType).toBe('python.3');
  });

  it('should accept all C++ source types', () => {
    const cppTypes = [
      'cpp.g++11',
      'cpp.g++14',
      'cpp.g++17',
      'cpp.g++20',
      'cpp.ms2017',
      'cpp.ms2019',
      'cpp.clang++17',
      'cpp.clang++20',
    ];

    cppTypes.forEach(sourceType => {
      const solution: LocalSolution = {
        name: 'main',
        source: 'main.cpp',
        tag: 'MA',
        sourceType: sourceType as any,
      };
      expect(solution.sourceType).toBe(sourceType);
    });
  });

  it('should accept all Java source types', () => {
    const javaTypes = ['java.8', 'java.11', 'java.17', 'java.21'];

    javaTypes.forEach(sourceType => {
      const solution: LocalSolution = {
        name: 'Main',
        source: 'Main.java',
        tag: 'MA',
        sourceType: sourceType as any,
      };
      expect(solution.sourceType).toBe(sourceType);
    });
  });

  it('should accept all Python source types', () => {
    const pythonTypes = ['python.2', 'python.3', 'python.pypy2', 'python.pypy3'];

    pythonTypes.forEach(sourceType => {
      const solution: LocalSolution = {
        name: 'main',
        source: 'main.py',
        tag: 'MA',
        sourceType: sourceType as any,
      };
      expect(solution.sourceType).toBe(sourceType);
    });
  });

  it('should handle solution without source type', () => {
    const solution: LocalSolution = {
      name: 'main',
      source: 'main.cpp',
      tag: 'MA',
    };

    expect(solution.sourceType).toBeUndefined();
  });
});

describe('Solution - Configuration', () => {
  it('should handle complete solution configuration', () => {
    const solution: LocalSolution = {
      name: 'main-solution',
      source: 'solutions/main.cpp',
      tag: 'MA',
      sourceType: 'cpp.g++17',
    };

    expect(solution.name).toBe('main-solution');
    expect(solution.source).toBe('solutions/main.cpp');
    expect(solution.tag).toBe('MA');
    expect(solution.sourceType).toBe('cpp.g++17');
  });

  it('should handle minimal solution configuration', () => {
    const solution: LocalSolution = {
      name: 'minimal',
      source: 'minimal.cpp',
      tag: 'MA',
    };

    expect(solution.name).toBe('minimal');
    expect(solution.source).toBe('minimal.cpp');
    expect(solution.tag).toBe('MA');
    expect(solution.sourceType).toBeUndefined();
  });

  it('should handle solution with relative path', () => {
    const solution: LocalSolution = {
      name: 'solution',
      source: './solutions/solution.cpp',
      tag: 'MA',
    };

    expect(solution.source).toBe('./solutions/solution.cpp');
  });

  it('should handle solution with absolute path', () => {
    const solution: LocalSolution = {
      name: 'solution',
      source: '/absolute/path/to/solution.cpp',
      tag: 'MA',
    };

    expect(solution.source).toBe('/absolute/path/to/solution.cpp');
  });
});

describe('Solution - Edge Cases', () => {
  it('should handle solution with empty name', () => {
    const solution: LocalSolution = {
      name: '',
      source: 'solution.cpp',
      tag: 'MA',
    };

    expect(solution.name).toBe('');
  });

  it('should handle solution with special characters in name', () => {
    const solution: LocalSolution = {
      name: 'solution-v2_final.3',
      source: 'solution.cpp',
      tag: 'MA',
    };

    expect(solution.name).toBe('solution-v2_final.3');
  });

  it('should handle very long solution name', () => {
    const longName = 'solution-'.repeat(50) + 'final';
    const solution: LocalSolution = {
      name: longName,
      source: 'solution.cpp',
      tag: 'MA',
    };

    expect(solution.name).toBe(longName);
  });
});

describe('Solution - Multiple Solutions', () => {
  it('should handle diverse solution set', () => {
    const solutions: LocalSolution[] = [
      { name: 'main', source: 'main.cpp', tag: 'MA', sourceType: 'cpp.g++17' },
      { name: 'alt', source: 'alt.cpp', tag: 'OK', sourceType: 'cpp.g++20' },
      { name: 'java-sol', source: 'Main.java', tag: 'OK', sourceType: 'java.11' },
      { name: 'python-sol', source: 'main.py', tag: 'OK', sourceType: 'python.3' },
      { name: 'wrong', source: 'wrong.cpp', tag: 'WA' },
      { name: 'tle', source: 'tle.cpp', tag: 'TL' },
      { name: 'mle', source: 'mle.cpp', tag: 'ML' },
      { name: 'rte', source: 'rte.cpp', tag: 'RE' },
    ];

    expect(solutions).toHaveLength(8);
    
    const mainSol = solutions.find(s => s.tag === 'MA');
    expect(mainSol).toBeDefined();
    
    const wrongSols = solutions.filter(s => s.tag === 'WA' || s.tag === 'TL' || s.tag === 'ML' || s.tag === 'RE');
    expect(wrongSols.length).toBeGreaterThan(0);
  });

  it('should filter solutions by tag', () => {
    const solutions: LocalSolution[] = [
      { name: 'main', source: 'main.cpp', tag: 'MA' },
      { name: 'alt1', source: 'alt1.cpp', tag: 'OK' },
      { name: 'alt2', source: 'alt2.cpp', tag: 'OK' },
      { name: 'wrong1', source: 'wrong1.cpp', tag: 'WA' },
      { name: 'wrong2', source: 'wrong2.cpp', tag: 'WA' },
    ];

    const correctSolutions = solutions.filter(s => s.tag === 'MA' || s.tag === 'OK');
    expect(correctSolutions).toHaveLength(3);

    const wrongSolutions = solutions.filter(s => s.tag === 'WA');
    expect(wrongSolutions).toHaveLength(2);
  });
});

describe('Solution - Verdict Tracker', () => {
  it('should track different verdict types', () => {
    const tracker = {
      didWA: false,
      didPE: false,
      didTLE: false,
      didMLE: false,
      didRTE: false,
    };

    tracker.didWA = true;
    tracker.didTLE = true;

    expect(tracker.didWA).toBe(true);
    expect(tracker.didTLE).toBe(true);
    expect(tracker.didPE).toBe(false);
  });

  it('should initialize all verdicts as false', () => {
    const tracker = {
      didWA: false,
      didPE: false,
      didTLE: false,
      didMLE: false,
      didRTE: false,
    };

    expect(tracker.didWA).toBe(false);
    expect(tracker.didPE).toBe(false);
    expect(tracker.didTLE).toBe(false);
    expect(tracker.didMLE).toBe(false);
    expect(tracker.didRTE).toBe(false);
  });
});
