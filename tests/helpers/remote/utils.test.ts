
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as remoteUtils from '../../../src/helpers/remote/utils';
import fs from 'fs';
import path from 'path';

vi.mock('fs');
vi.mock('../../../src/helpers/utils'); // for readConfigFile if used

describe('remote/utils.ts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

  describe('normalizeLineEndings', () => {
    it('should convert win to unix', () => {
      expect(remoteUtils.normalizeLineEndingsFromWinToUnix('a\r\nb')).toBe('a\nb');
    });

    it('should convert unix to win', () => {
        expect(remoteUtils.normalizeLineEndingsFromUnixToWin('a\nb')).toBe('a\r\nb');
    });
  });

  describe('getPolymanDirectory', () => {
      it('should return path in home directory', () => {
          const home = process.env.HOME || process.env.USERPROFILE;
          expect(remoteUtils.getPolymanDirectory()).toContain(home);
          expect(remoteUtils.getPolymanDirectory()).toContain('.polyman');
      });
  });

  describe('readCredentials', () => {
      it('should throw if dir not exist', () => {
          vi.mocked(fs.existsSync).mockReturnValue(false);
          expect(() => remoteUtils.readCredentials()).toThrow();
      });

      it('should read credentials successfully', () => {
          vi.mocked(fs.existsSync).mockReturnValue(true);
          vi.mocked(fs.readFileSync).mockImplementation((p) => {
              if (String(p).includes('api_key')) return 'mykey';
              if (String(p).includes('secret_key')) return 'mysecret';
              return '';
          });

          const creds = remoteUtils.readCredentials();
          expect(creds.apiKey).toBe('mykey');
          expect(creds.secret).toBe('mysecret');
      });
  });
});
