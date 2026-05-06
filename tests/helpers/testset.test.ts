import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as testset from '../../src/helpers/testset';
import * as generator from '../../src/helpers/generator';
import * as utils from '../../src/helpers/utils';
import { LocalTestset } from '../../src/types';

vi.mock('../../src/helpers/generator');
vi.mock('../../src/helpers/utils');
vi.mock('fs');
vi.mock('../../src/formatter');

describe('testset.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ensureTestsetsExist', () => {
    it('should not throw if testsets exist', () => {
      const ts: LocalTestset = { name: 'ts1' };
      expect(() => testset.ensureTestsetsExist([ts])).not.toThrow();
    });

    it('should throw if testsets is undefined', () => {
      expect(() => testset.ensureTestsetsExist(undefined)).toThrow(
        'No testsets defined'
      );
    });

    it('should throw if testsets is empty', () => {
      expect(() => testset.ensureTestsetsExist([])).toThrow(
        'No testsets defined'
      );
    });
  });

  describe('findTestset', () => {
    const testsets: LocalTestset[] = [
      { name: 'main', generatorScript: { script: '' } },
    ];

    it('should find testset by name', () => {
      expect(testset.findTestset(testsets, 'main')).toEqual(testsets[0]);
    });

    it('should throw if testset not found', () => {
      expect(() => testset.findTestset(testsets, 'missing')).toThrow(
        /Testset "missing" not found/
      );
    });
  });

  describe('getTestIndicesForGroup', () => {
    const ts: LocalTestset = {
      name: 'main',
      generatorScript: {
        script:
          '<#-- @group small -->\ngen 1 > 1\ngen 2 > 2\n<#-- @group large -->\ngen 3 > 3',
      },
      manualTests: [{ input: './m.in', index: 5, group: 'samples' }],
    };

    it('returns indices in the named group', () => {
      expect(testset.getTestIndicesForGroup(ts, 'small')).toEqual([1, 2]);
      expect(testset.getTestIndicesForGroup(ts, 'large')).toEqual([3]);
      expect(testset.getTestIndicesForGroup(ts, 'samples')).toEqual([5]);
    });

    it('groupName "all" returns every index', () => {
      expect(testset.getTestIndicesForGroup(ts, 'all').sort()).toEqual([
        1, 2, 3, 5,
      ]);
    });
  });

  describe('generateTestsForTestset', () => {
    it('uses default testsets/<name> directory', async () => {
      vi.mocked(generator.resolveTestsetTests).mockReturnValue([]);
      vi.mocked(generator.executeResolvedTests).mockResolvedValue();
      vi.mocked(utils.ensureDirectoryExists).mockImplementation(() => {});
      const ts: LocalTestset = {
        name: 'main',
        generatorScript: { script: '' },
      };
      await testset.generateTestsForTestset(ts, []);
      expect(utils.ensureDirectoryExists).toHaveBeenCalledWith(
        expect.stringContaining('testsets/main')
      );
      expect(generator.executeResolvedTests).toHaveBeenCalled();
    });

    it('honors a custom output directory', async () => {
      vi.mocked(generator.resolveTestsetTests).mockReturnValue([]);
      vi.mocked(generator.executeResolvedTests).mockResolvedValue();
      vi.mocked(utils.ensureDirectoryExists).mockImplementation(() => {});
      const ts: LocalTestset = {
        name: 'main',
        generatorScript: { script: '' },
      };
      await testset.generateTestsForTestset(ts, [], '/custom/path');
      expect(utils.ensureDirectoryExists).toHaveBeenCalledWith('/custom/path');
    });
  });

  describe('generateSingleTest', () => {
    it('runs only the resolved test with the given index', async () => {
      vi.mocked(generator.resolveTestsetTests).mockReturnValue([
        {
          index: 1,
          source: { kind: 'manual', inputFile: './a.in' },
        },
        {
          index: 2,
          source: { kind: 'manual', inputFile: './b.in' },
        },
      ]);
      vi.mocked(generator.executeResolvedTests).mockResolvedValue();

      await testset.generateSingleTest({ name: 'main' } as LocalTestset, 2, []);
      expect(generator.executeResolvedTests).toHaveBeenCalledWith(
        [expect.objectContaining({ index: 2 })],
        [],
        expect.anything()
      );
    });

    it('throws when the index does not exist', async () => {
      vi.mocked(generator.resolveTestsetTests).mockReturnValue([
        {
          index: 1,
          source: { kind: 'manual', inputFile: './a.in' },
        },
      ]);
      await expect(
        testset.generateSingleTest({ name: 'main' } as LocalTestset, 99, [])
      ).rejects.toThrow(/Test 99 not found/);
    });
  });

  describe('generateTestsForGroup', () => {
    it('passes only matching-group tests to the executor', async () => {
      vi.mocked(generator.resolveTestsetTests).mockReturnValue([
        {
          index: 1,
          source: { kind: 'manual', inputFile: './a.in' },
          group: 'g1',
        },
        {
          index: 2,
          source: { kind: 'manual', inputFile: './b.in' },
          group: 'g2',
        },
        {
          index: 3,
          source: { kind: 'manual', inputFile: './c.in' },
          group: 'g1',
        },
      ]);
      vi.mocked(generator.executeResolvedTests).mockResolvedValue();
      await testset.generateTestsForGroup(
        { name: 'main' } as LocalTestset,
        'g1',
        []
      );
      const passed = vi.mocked(generator.executeResolvedTests).mock.calls[0][0];
      expect(passed.map(t => t.index)).toEqual([1, 3]);
    });

    it('groupName "all" runs every resolved test', async () => {
      vi.mocked(generator.resolveTestsetTests).mockReturnValue([
        {
          index: 1,
          source: { kind: 'manual', inputFile: './a.in' },
        },
        {
          index: 2,
          source: { kind: 'manual', inputFile: './b.in' },
        },
      ]);
      vi.mocked(generator.executeResolvedTests).mockResolvedValue();
      await testset.generateTestsForGroup(
        { name: 'main' } as LocalTestset,
        'all',
        []
      );
      const passed = vi.mocked(generator.executeResolvedTests).mock.calls[0][0];
      expect(passed).toHaveLength(2);
    });

    it('throws when no tests match the group', async () => {
      vi.mocked(generator.resolveTestsetTests).mockReturnValue([
        {
          index: 1,
          source: { kind: 'manual', inputFile: './a.in' },
          group: 'g1',
        },
      ]);
      await expect(
        testset.generateTestsForGroup(
          { name: 'main' } as LocalTestset,
          'missing',
          []
        )
      ).rejects.toThrow(/No tests found in group/);
    });
  });

  describe('generateAllTestsets', () => {
    it('iterates every testset', async () => {
      vi.mocked(generator.resolveTestsetTests).mockReturnValue([]);
      vi.mocked(generator.executeResolvedTests).mockResolvedValue();
      const ts1: LocalTestset = { name: 'a', generatorScript: { script: '' } };
      const ts2: LocalTestset = { name: 'b', generatorScript: { script: '' } };
      await testset.generateAllTestsets([ts1, ts2], []);
      expect(generator.executeResolvedTests).toHaveBeenCalledTimes(2);
    });
  });

  describe('listTestsets', () => {
    it('reports test count and group names', () => {
      const ts: LocalTestset = {
        name: 'ts1',
        generatorScript: { script: 'gen 1 > 1\ngen 2 > 2' },
        groups: [{ name: 'g1' }],
      };
      const out = testset.listTestsets([ts])[0];
      expect(out).toContain('ts1: 2 tests');
      expect(out).toContain('groups: g1');
    });

    it('handles testsets with no script and no groups', () => {
      const ts: LocalTestset = { name: 'ts1' };
      const out = testset.listTestsets([ts])[0];
      expect(out).toContain('ts1: 0 tests');
      expect(out).toContain('groups: none');
    });
  });
});
