import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as remoteUtils from '../../../src/helpers/remote/utils';
import fs from 'fs';
import { PolygonSDK } from '../../../src/polygon';
import type { Problem, ProblemInfo } from '../../../src/types';

vi.mock('fs');
vi.mock('../../../src/helpers/utils');
vi.mock('../../../src/polygon', () => ({
  PolygonSDK: vi.fn(),
}));

describe('remote/utils.ts', () => {
  const ORIGINAL_ENV = { ...process.env };
  const ORIGINAL_PLATFORM = process.platform;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    Object.defineProperty(process, 'platform', {
      value: ORIGINAL_PLATFORM,
    });
  });

  describe('normalizeLineEndings', () => {
    it('should convert win to unix', () => {
      expect(remoteUtils.normalizeLineEndingsFromWinToUnix('a\r\nb')).toBe(
        'a\nb'
      );
    });

    it('should convert unix to win', () => {
      expect(remoteUtils.normalizeLineEndingsFromUnixToWin('a\nb')).toBe(
        'a\r\nb'
      );
    });

    it('should handle old Mac CR endings (win to unix)', () => {
      expect(remoteUtils.normalizeLineEndingsFromWinToUnix('a\rb\rc')).toBe(
        'a\nb\nc'
      );
    });

    it('should collapse 3+ newlines to 2 (win to unix)', () => {
      expect(remoteUtils.normalizeLineEndingsFromWinToUnix('a\n\n\n\nb')).toBe(
        'a\n\nb'
      );
    });

    it('should preserve single and double newlines (win to unix)', () => {
      expect(remoteUtils.normalizeLineEndingsFromWinToUnix('a\nb\n\nc')).toBe(
        'a\nb\n\nc'
      );
    });

    it('should handle empty string (win to unix)', () => {
      expect(remoteUtils.normalizeLineEndingsFromWinToUnix('')).toBe('');
    });

    it('should handle mixed encodings (unix to win)', () => {
      expect(
        remoteUtils.normalizeLineEndingsFromUnixToWin('a\r\nb\rc\nd')
      ).toBe('a\r\nb\r\nc\r\nd');
    });

    it('should collapse and convert excessive newlines (unix to win)', () => {
      expect(remoteUtils.normalizeLineEndingsFromUnixToWin('a\n\n\n\nb')).toBe(
        'a\r\n\r\nb'
      );
    });

    it('should handle empty string (unix to win)', () => {
      expect(remoteUtils.normalizeLineEndingsFromUnixToWin('')).toBe('');
    });
  });

  describe('normalizeLineEndingsFromRemoteToSystem', () => {
    it('should pass through content unchanged on win32', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(remoteUtils.normalizeLineEndingsFromRemoteToSystem('a\r\nb')).toBe(
        'a\r\nb'
      );
    });

    it('should normalize to unix on non-win32', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      expect(remoteUtils.normalizeLineEndingsFromRemoteToSystem('a\r\nb')).toBe(
        'a\nb'
      );
    });
  });

  describe('normalizeLineEndingsFromSystemToRemote', () => {
    it('should pass through content unchanged on win32', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' });
      expect(remoteUtils.normalizeLineEndingsFromSystemToRemote('a\nb')).toBe(
        'a\nb'
      );
    });

    it('should normalize to win on non-win32', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' });
      expect(remoteUtils.normalizeLineEndingsFromSystemToRemote('a\nb')).toBe(
        'a\r\nb'
      );
    });
  });

  describe('getPolymanDirectory', () => {
    it('should return path in HOME directory', () => {
      process.env['HOME'] = '/home/user';
      delete process.env['USERPROFILE'];
      expect(remoteUtils.getPolymanDirectory()).toContain('/home/user');
      expect(remoteUtils.getPolymanDirectory()).toContain('.polyman');
    });

    it('should fall back to USERPROFILE if HOME is missing', () => {
      delete process.env['HOME'];
      process.env['USERPROFILE'] = 'C:\\Users\\foo';
      expect(remoteUtils.getPolymanDirectory()).toContain('C:\\Users\\foo');
      expect(remoteUtils.getPolymanDirectory()).toContain('.polyman');
    });

    it('should throw if no home directory env is available', () => {
      delete process.env['HOME'];
      delete process.env['USERPROFILE'];
      expect(() => remoteUtils.getPolymanDirectory()).toThrow(
        'Could not determine home directory'
      );
    });
  });

  describe('readCredentials', () => {
    it('should throw if api_key file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(() => remoteUtils.readCredentials()).toThrow(/API key not found/);
    });

    it('should throw if secret_key file does not exist', () => {
      vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
        return String(p).includes('api_key');
      });
      expect(() => remoteUtils.readCredentials()).toThrow(
        /API secret not found/
      );
    });

    it('should throw if credentials are empty', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('   ');
      expect(() => remoteUtils.readCredentials()).toThrow(
        /API credentials are empty/
      );
    });

    it('should read and trim credentials successfully', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (String(p).includes('api_key')) return '  mykey\n';
          if (String(p).includes('secret_key')) return 'mysecret  ';
          return '';
        }
      );

      const creds = remoteUtils.readCredentials();
      expect(creds.apiKey).toBe('mykey');
      expect(creds.secret).toBe('mysecret');
    });
  });

  describe('initializeSDK', () => {
    it('should construct PolygonSDK with credentials', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(
        (p: fs.PathOrFileDescriptor) => {
          if (String(p).includes('api_key')) return 'k';
          if (String(p).includes('secret_key')) return 's';
          return '';
        }
      );

      remoteUtils.initializeSDK();
      expect(PolygonSDK).toHaveBeenCalledWith({
        apiKey: 'k',
        apiSecret: 's',
      });
    });

    it('should propagate errors from readCredentials', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(() => remoteUtils.initializeSDK()).toThrow(/API key not found/);
    });
  });

  describe('areCredentialsRegistered', () => {
    it('should return true when both files exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      expect(remoteUtils.areCredentialsRegistered()).toBe(true);
    });

    it('should return false when api_key is missing', () => {
      vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) =>
        String(p).includes('secret_key')
      );
      expect(remoteUtils.areCredentialsRegistered()).toBe(false);
    });

    it('should return false when secret_key is missing', () => {
      vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) =>
        String(p).includes('api_key')
      );
      expect(remoteUtils.areCredentialsRegistered()).toBe(false);
    });

    it('should return false on getPolymanDirectory error', () => {
      delete process.env['HOME'];
      delete process.env['USERPROFILE'];
      expect(remoteUtils.areCredentialsRegistered()).toBe(false);
    });
  });

  describe('fetchProblemInfo', () => {
    it('should merge problem info with problem from list', async () => {
      const problemInfo: ProblemInfo = {
        inputFile: 'stdin',
        outputFile: 'stdout',
        interactive: false,
        timeLimit: 1000,
        memoryLimit: 256,
      };
      const problems: Problem[] = [
        {
          id: 1,
          owner: 'a',
          name: 'A',
          deleted: false,
          favourite: false,
          accessType: 'OWNER',
          revision: 1,
          modified: false,
        },
        {
          id: 42,
          owner: 'me',
          name: 'My',
          deleted: false,
          favourite: false,
          accessType: 'OWNER',
          revision: 2,
          modified: true,
        },
      ];
      const sdk = {
        getProblemInfo: vi.fn().mockResolvedValue(problemInfo),
        listProblems: vi.fn().mockResolvedValue(problems),
      } as unknown as PolygonSDK;

      const result = await remoteUtils.fetchProblemInfo(sdk, 42);
      expect(result.id).toBe(42);
      expect(result.name).toBe('My');
      expect(result.timeLimit).toBe(1000);
      expect(result.modified).toBe(true);
    });

    it('should throw if problem not found in list', async () => {
      const sdk = {
        getProblemInfo: vi.fn().mockResolvedValue({}),
        listProblems: vi.fn().mockResolvedValue([]),
      } as unknown as PolygonSDK;

      await expect(remoteUtils.fetchProblemInfo(sdk, 999)).rejects.toThrow(
        'Problem not found'
      );
    });
  });

  describe('getProblemId', () => {
    it('should return numeric id when input is numeric', () => {
      expect(remoteUtils.getProblemId('123456')).toBe(123456);
    });

    it('should parse numeric prefix', () => {
      expect(remoteUtils.getProblemId('0')).toBe(0);
    });

    it('should throw if Config.json does not exist for path', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      expect(() => remoteUtils.getProblemId('./some-path')).toThrow(
        /Config\.json not found at/
      );
    });

    it('should throw if Config.json missing problemId', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ name: 'p' }));
      expect(() => remoteUtils.getProblemId('./prob')).toThrow(
        /Config\.json does not contain problemId field/
      );
    });

    it('should read problemId from Config.json', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ name: 'p', problemId: 7777 })
      );
      expect(remoteUtils.getProblemId('./prob')).toBe(7777);
    });
  });

  describe('formatProblemInfo', () => {
    it('should format problem without modified flag', () => {
      const problem: Problem = {
        id: 100,
        owner: 'alice',
        name: 'Sum',
        deleted: false,
        favourite: false,
        accessType: 'OWNER',
        revision: 1,
        modified: false,
      };
      expect(remoteUtils.formatProblemInfo(problem)).toBe(
        '[100] Sum (owner: alice, access: OWNER)'
      );
    });

    it('should append (modified) when problem is modified', () => {
      const problem: Problem = {
        id: 200,
        owner: 'bob',
        name: 'Diff',
        deleted: false,
        favourite: false,
        accessType: 'WRITE',
        revision: 3,
        modified: true,
      };
      expect(remoteUtils.formatProblemInfo(problem)).toBe(
        '[200] Diff (owner: bob, access: WRITE) (modified)'
      );
    });
  });

  describe('saveProblemIdToConfig', () => {
    it('should write problemId into existing Config.json', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ name: 'p' }));

      remoteUtils.saveProblemIdToConfig('Config.json', 42);

      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      expect(writeCall[0]).toBe('Config.json');
      const written = writeCall[1] as string;
      expect(written).not.toContain('\r\n');
      const parsed = JSON.parse(written) as {
        problemId: number;
        name: string;
      };
      expect(parsed.problemId).toBe(42);
      expect(parsed.name).toBe('p');
      expect(writeCall[2]).toBe('utf-8');
    });

    it('should overwrite existing problemId', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ name: 'p', problemId: 1 })
      );

      remoteUtils.saveProblemIdToConfig('Config.json', 999);

      const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
      const parsed = JSON.parse(written) as { problemId: number };
      expect(parsed.problemId).toBe(999);
    });

    it('should propagate read errors', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('ENOENT');
      });
      expect(() =>
        remoteUtils.saveProblemIdToConfig('missing.json', 1)
      ).toThrow('ENOENT');
    });
  });

  describe('isValidPackageType', () => {
    it('should return true for valid lowercase types', () => {
      expect(remoteUtils.isValidPackageType('standard')).toBe(true);
      expect(remoteUtils.isValidPackageType('full')).toBe(true);
      expect(remoteUtils.isValidPackageType('linux')).toBe(true);
      expect(remoteUtils.isValidPackageType('windows')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(remoteUtils.isValidPackageType('STANDARD')).toBe(true);
      expect(remoteUtils.isValidPackageType('Full')).toBe(true);
      expect(remoteUtils.isValidPackageType('LiNuX')).toBe(true);
    });

    it('should return false for invalid types', () => {
      expect(remoteUtils.isValidPackageType('mac')).toBe(false);
      expect(remoteUtils.isValidPackageType('')).toBe(false);
      expect(remoteUtils.isValidPackageType('partial')).toBe(false);
    });
  });
});
