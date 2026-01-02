
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as pushing from '../../../src/helpers/remote/pushing';
import fs from 'fs';

vi.mock('fs');
vi.mock('../../../src/formatter');
vi.mock('../../../src/helpers/remote/utils', () => ({
    normalizeLineEndingsFromSystemToRemote: vi.fn((content) => content),
}));

describe('pushing.ts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const mockSdk = {
        saveSolution: vi.fn(),
        saveFile: vi.fn(),
        setChecker: vi.fn(),
        setValidator: vi.fn(),
        saveStatement: vi.fn(),
        updateInfo: vi.fn(),
        saveTest: vi.fn(), 
        // ... methods
    } as any;

    const mockConfig = {
        solutions: [{ name: 'sol', source: 'sol.cpp', tag: 'MA' }],
        checker: { name: 'check', source: 'check.cpp' },
        validator: { name: 'val', source: 'val.cpp' },
        statements: { english: { language: 'english', name: 'Prob' } },
        testsets: [],
    } as any;

  describe('uploadSolutions', () => {
      it('should upload solutions successfully', async () => {
          vi.mocked(fs.readFileSync).mockReturnValue('code');
          vi.mocked(fs.existsSync).mockReturnValue(true);
          
          const result = await pushing.uploadSolutions(mockSdk, 1, 'dir', mockConfig);
          
          expect(mockSdk.saveSolution).toHaveBeenCalled();
          expect(result).toBe(1);
      });
  });

  describe('uploadChecker', () => {
      it('should upload checker successfully', async () => {
          vi.mocked(fs.readFileSync).mockReturnValue('code');
          vi.mocked(fs.existsSync).mockReturnValue(true);
          
          const result = await pushing.uploadChecker(mockSdk, 1, 'dir', mockConfig);
          
          expect(mockSdk.setChecker).toHaveBeenCalled();
          expect(result).toBe(1);
      });
  });
});
