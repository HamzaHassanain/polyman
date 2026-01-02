import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as solution from '../../src/helpers/solution';
import { executor } from '../../src/executor';
import * as utils from '../../src/helpers/utils';
import fs from 'fs';

vi.mock('../../src/executor', () => ({
  executor: {
    execute: vi.fn(),
    executeWithRedirect: vi.fn(),
    cleanup: vi.fn(),
  },
}));
vi.mock('../../src/helpers/utils');
vi.mock('../../src/helpers/checker');
vi.mock('fs');
vi.mock('../../src/formatter');

describe('solution.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findMatchingSolutions', () => {
    const solutions: any[] = [
      { name: 'main', source: 'main.cpp', type: 'main-correct' },
      { name: 'wa', source: 'wa.cpp', type: 'wrong-answer' },
    ];

    it('should return all solutions if name is all', () => {
      expect(solution.findMatchingSolutions(solutions, 'all')).toEqual(
        solutions
      );
    });

    it('should return matching solution', () => {
      expect(solution.findMatchingSolutions(solutions, 'main')).toEqual([
        solutions[0],
      ]);
    });

    it('should throw if solution not found', () => {
      expect(() =>
        solution.findMatchingSolutions(solutions, 'missing')
      ).toThrow();
    });
  });

  describe('runSolutionOnSingleTest', () => {
    it('should execute solution successfully', async () => {
      vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./solution');
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(executor.executeWithRedirect).mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        success: true,
      });

      const mockSolution = {
        name: 'main',
        source: 'main.cpp',
        type: 'main-correct',
      } as any;
      await expect(
        solution.runSolutionOnSingleTest(mockSolution, {} as any, 'testsets', 1)
      ).resolves.not.toThrow();
    });
  });
});
