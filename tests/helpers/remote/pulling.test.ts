
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as pulling from '../../../src/helpers/remote/pulling';
import fs from 'fs';
import path from 'path';

vi.mock('fs');
vi.mock('../../../src/formatter');
vi.mock('../../../src/helpers/remote/utils', () => ({
    normalizeLineEndingsFromRemoteToSystem: vi.fn((content) => content),
}));

describe('pulling.ts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const mockSdk = {
        getSolutions: vi.fn(),
        getFiles: vi.fn(),
        getChecker: vi.fn(),
        getValidator: vi.fn(),
        getStatements: vi.fn(),
        getTests: vi.fn(),
        getProblemInfo: vi.fn(),
        viewSolution: vi.fn(),
        viewFile: vi.fn(),
        getCheckerTests: vi.fn(),
        getValidatorTests: vi.fn(),
        // Mock specific methods used by pulling (deduced from context or assumptions)
        // If pulling uses sdk.problem.saveFile it might look different, but usually it fetches content then saves.
        // Let's assume fetching content via SDK methods.
        // Actually pulling.ts outline showed: "downloadSolutions(sdk, ...)"
        // It likely calls sdk.getSolutions() then saves files.
    } as any;

  describe('downloadSolutions', () => {
      it('should download solutions successfully', async () => {
          const solutions = [{ name: 'sol', source: 'cpp', tag: 'MA' }];
          mockSdk.getSolutions.mockResolvedValue(solutions);
          mockSdk.viewSolution.mockResolvedValue('code');
          
          // Mock save file logic if it uses direct fs usage or utils
          // pulling likely uses fs.writeFileSync
          
          const result = await pulling.downloadSolutions(mockSdk, 1, 'dir');
          
          expect(mockSdk.getSolutions).toHaveBeenCalledWith(1);
          expect(result.count).toBe(1);
      });
  });

  describe('downloadChecker', () => {
      it('should download checker successfully', async () => {
          mockSdk.getChecker.mockResolvedValue('checker.cpp');
          mockSdk.viewFile.mockResolvedValue('code');
          mockSdk.getCheckerTests.mockResolvedValue([]);
          
          const result = await pulling.downloadChecker(mockSdk, 1, 'dir');
          
          expect(mockSdk.getChecker).toHaveBeenCalledWith(1);
          expect(result.data).toBeDefined();
      });
  });

   describe('downloadValidator', () => {
      it('should download validator successfully', async () => {
          mockSdk.getValidator.mockResolvedValue('validator.cpp');
          mockSdk.viewFile.mockResolvedValue('code');
          mockSdk.getValidatorTests.mockResolvedValue([]);
          
          const result = await pulling.downloadValidator(mockSdk, 1, 'dir');
          
          expect(mockSdk.getValidator).toHaveBeenCalledWith(1);
          expect(result.data).toBeDefined();
      });
  });
});
