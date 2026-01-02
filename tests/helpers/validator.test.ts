
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as validator from '../../src/helpers/validator';
import { executor } from '../../src/executor';
import * as utils from '../../src/helpers/utils';
import fs from 'fs';
import path from 'path';

vi.mock('fs');
vi.mock('../../src/executor', () => ({
  executor: {
    executeWithRedirect: vi.fn(),
    cleanup: vi.fn(),
  },
}));
vi.mock('../../src/helpers/utils');
vi.mock('../../src/formatter');

describe('validator.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ensureValidatorExists', () => {
    it('should not throw if validator is defined', () => {
      expect(() => validator.ensureValidatorExists({ name: 'val', source: 'val.cpp' })).not.toThrow();
    });

    it('should throw if validator is undefined', () => {
      expect(() => validator.ensureValidatorExists(undefined)).toThrow('No validator defined');
    });
  });

  describe('validateSingleTest', () => {
      it('should execute validator successfully', async () => {
          const mockValidator = { name: 'val', source: 'val.cpp' };
          vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
          vi.mocked(fs.existsSync).mockReturnValue(true);
          vi.mocked(executor.executeWithRedirect).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, success: true });

          await expect(validator.validateSingleTest(mockValidator, 'testsets', 1)).resolves.not.toThrow();
          
          expect(utils.getCompiledCommandToRun).toHaveBeenCalledWith(mockValidator);
          expect(fs.existsSync).toHaveBeenCalled();
          expect(executor.executeWithRedirect).toHaveBeenCalled();
      });

      it('should throw if test file does not exist', async () => {
          const mockValidator = { name: 'val', source: 'val.cpp' };
          vi.mocked(utils.getCompiledCommandToRun).mockReturnValue('./val');
          vi.mocked(fs.existsSync).mockReturnValue(false);
          vi.mocked(utils.throwError).mockImplementation((e, m) => { throw new Error(`${m}: ${e}`); });

          await expect(validator.validateSingleTest(mockValidator, 'testsets', 1)).rejects.toThrow('Failed to validate test');
      });
  });
});
