
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as viewer from '../../../src/helpers/remote/viewer';
import { fmt } from '../../../src/formatter';

vi.mock('../../../src/formatter');

describe('viewer.ts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const mockSdk = {
        getStatements: vi.fn(),
        getSolutions: vi.fn(),
        getFiles: vi.fn(),
    } as any;

  describe('fetchStatements', () => {
      it('should return statements list', async () => {
          mockSdk.getStatements.mockResolvedValue({ english: { name: 'S' } });
          const result = await viewer.fetchStatements(mockSdk, 1);
          expect(result).toHaveLength(1);
          expect(result[0].language).toBe('english');
      });

      it('should return empty list on error', async () => {
          mockSdk.getStatements.mockRejectedValue(new Error('fail'));
          const result = await viewer.fetchStatements(mockSdk, 1);
          expect(result).toEqual([]);
      });
  });

  describe('logStatementsFetch', () => {
      it('should log info if statements found', () => {
          viewer.logStatementsFetch([{ language: 'CPP', encoding: 'UTF-8' } as any]);
          expect(fmt.info).toHaveBeenCalled();
      });
  });
});
