
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as testset from '../../src/helpers/testset';
import * as generator from '../../src/helpers/generator';
import * as utils from '../../src/helpers/utils';
import fs from 'fs';

vi.mock('../../src/helpers/generator');
vi.mock('../../src/helpers/utils');
vi.mock('fs');
vi.mock('../../src/formatter');
vi.mock('../../src/helpers/script-parser', () => ({
    validateGeneratorCommands: vi.fn(),
}));

describe('testset.ts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

  describe('findTestset', () => {
    const testsets: any[] = [{ name: 'main', generatorScript: { commands: [] } }];

    it('should find testset by name', () => {
      expect(testset.findTestset(testsets, 'main')).toEqual(testsets[0]);
    });

    it('should throw if testset not found', () => {
      expect(() => testset.findTestset(testsets, 'missing')).toThrow();
    });
  });

  describe('generateTestsForTestset', () => {
      it('should generate tests successfully', async () => {
          const mockTestset = { name: 'main', generatorScript: { commands: [{ type: 'generator', command: 'gen', args: [] }] } } as any;
          vi.mocked(utils.ensureDirectoryExists).mockImplementation(() => {});
          vi.mocked(generator.executeGeneratorScript).mockResolvedValue(undefined);

          await expect(testset.generateTestsForTestset(mockTestset, [])).resolves.not.toThrow();
          expect(generator.executeGeneratorScript).toHaveBeenCalled();
      });
  });
});
