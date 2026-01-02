
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as utils from '../../src/helpers/utils';
import fs from 'fs';
import path from 'path';

// Manual mock for fs to ensure structure is correct
vi.mock('fs', () => {
    return {
        default: {
            existsSync: vi.fn(),
            rmSync: vi.fn(),
            mkdirSync: vi.fn(),
            writeFileSync: vi.fn(),
            readdirSync: vi.fn(() => []), // default return for other tests
            readFileSync: vi.fn(),
            createReadStream: vi.fn(),
        }
    };
});

vi.mock('child_process', () => ({
  exec: vi.fn(),
}));

describe('utils.ts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

  describe('isNumeric', () => {
    it('should return true for numeric strings', () => {
      expect(utils.isNumeric('123')).toBe(true);
    });
  });

  describe('filterTestsByRange', () => {
    const testFiles = ['test1.txt', 'test2.txt'];
    it('should return all tests if no range is specified', () => {
      expect(utils.filterTestsByRange(testFiles)).toEqual(testFiles);
    });
  });

  describe('ensureDirectoryExists', () => {
    it('should call fs.mkdirSync with recursive: true', () => {
      const dirName = 'test-dir';
      vi.mocked(fs.existsSync).mockReturnValue(false); 
      // check if ensureDirectoryExists checks existence first?
      // implementation: if (!fs.existsSync) fs.mkdirSync
      utils.ensureDirectoryExists(dirName);
      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining(dirName), { recursive: true });
    });
  });
  
  describe('removeDirectoryRecursively', () => {
      it('should call fs.rmSync with recursive: true if directory exists', () => {
          const dirName = 'test-dir';
          vi.mocked(fs.existsSync).mockReturnValue(true);
          utils.removeDirectoryRecursively(dirName);
          expect(fs.rmSync).toHaveBeenCalledWith(expect.stringContaining(dirName), { recursive: true, force: true });
      });

       it('should not call fs.rmSync if directory does not exist', () => {
          const dirName = 'non-existent-dir';
          vi.mocked(fs.existsSync).mockReturnValue(false);
          utils.removeDirectoryRecursively(dirName);
          expect(fs.rmSync).not.toHaveBeenCalled();
      });
  });
});
