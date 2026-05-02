import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import { PolygonSDK } from '../src/polygon';

const mockConfig = {
  apiKey: 'key',
  apiSecret: 'secret',
};

interface FetchCall {
  url: string;
  body: URLSearchParams;
  method: string;
  contentType: string;
}

function parseFetchCall(call: unknown[]): FetchCall {
  const url = call[0] as string;
  const init = call[1] as {
    method: string;
    body: URLSearchParams;
    headers: Record<string, string>;
  };
  return {
    url,
    body: init.body,
    method: init.method,
    contentType: init.headers['Content-Type'] ?? '',
  };
}

function makeJsonResponse(payload: unknown) {
  return {
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(JSON.stringify(payload)),
  };
}

function makeTextResponse(text: string) {
  return {
    json: () => Promise.resolve({ status: 'OK', result: text }),
    text: () => Promise.resolve(text),
  };
}

describe('PolygonSDK', () => {
  let sdk: PolygonSDK;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    sdk = new PolygonSDK(mockConfig);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use default base URL when not provided', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'OK', result: [] })
      );
      const s = new PolygonSDK({ apiKey: 'k', apiSecret: 's' });
      await s.listProblems();
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toBe('https://polygon.codeforces.com/api/problems.list');
    });

    it('should respect custom baseUrl', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'OK', result: [] })
      );
      const s = new PolygonSDK({
        apiKey: 'k',
        apiSecret: 's',
        baseUrl: 'https://example.com/api',
      });
      await s.listProblems();
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toBe('https://example.com/api/problems.list');
    });
  });

  describe('signature generation', () => {
    it('should compute SHA-512 signature with deterministic salt and time', async () => {
      const fixedSalt = 0.123456789;
      const fixedTimeMs = 1700000000000;
      vi.spyOn(Math, 'random').mockReturnValue(fixedSalt);
      vi.spyOn(Date, 'now').mockReturnValue(fixedTimeMs);

      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'OK', result: [] })
      );

      await sdk.listProblems();

      const rand = fixedSalt.toString(36).substring(2, 8);
      const time = Math.floor(fixedTimeMs / 1000);
      const allParams: Record<string, string | number> = {
        apiKey: 'key',
        time,
      };
      const sortedKeys = Object.keys(allParams).sort();
      const paramString = sortedKeys
        .map(k => `${k}=${String(allParams[k])}`)
        .join('&');
      const stringToHash = `${rand}/problems.list?${paramString}#secret`;
      const expectedHash = crypto
        .createHash('sha512')
        .update(stringToHash)
        .digest('hex');
      const expectedSig = rand + expectedHash;

      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('apiSig')).toBe(expectedSig);
      expect(call.body.get('apiKey')).toBe('key');
      expect(call.body.get('time')).toBe(String(time));
    });

    it('should include params in signature when provided', async () => {
      const fixedSalt = 0.5;
      const fixedTimeMs = 1700000000000;
      vi.spyOn(Math, 'random').mockReturnValue(fixedSalt);
      vi.spyOn(Date, 'now').mockReturnValue(fixedTimeMs);

      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'OK', result: { id: 5 } })
      );

      await sdk.getProblemInfo(42);

      const rand = fixedSalt.toString(36).substring(2, 8);
      const time = Math.floor(fixedTimeMs / 1000);
      const allParams: Record<string, string | number> = {
        problemId: 42,
        apiKey: 'key',
        time,
      };
      const sortedKeys = Object.keys(allParams).sort();
      const paramString = sortedKeys
        .map(k => `${k}=${String(allParams[k])}`)
        .join('&');
      const stringToHash = `${rand}/problem.info?${paramString}#secret`;
      const expectedHash = crypto
        .createHash('sha512')
        .update(stringToHash)
        .digest('hex');
      const expectedSig = rand + expectedHash;

      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('apiSig')).toBe(expectedSig);
      expect(call.body.get('problemId')).toBe('42');
    });

    it('should produce different signatures across calls due to random salt', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'OK', result: [] })
      );

      const sigs = new Set<string>();
      for (let i = 0; i < 5; i++) {
        await sdk.listProblems();
      }
      for (const call of fetchMock.mock.calls) {
        const parsed = parseFetchCall(call);
        sigs.add(parsed.body.get('apiSig')!);
      }
      expect(sigs.size).toBeGreaterThan(1);
    });

    it('should produce 134-character signature (6 prefix + 128 hex)', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'OK', result: [] })
      );
      await sdk.listProblems();
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      const sig = call.body.get('apiSig')!;
      expect(sig.length).toBe(6 + 128);
    });
  });

  describe('request envelope handling', () => {
    it('should POST with form-urlencoded content type', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'OK', result: [] })
      );
      await sdk.listProblems();
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.method).toBe('POST');
      expect(call.contentType).toBe('application/x-www-form-urlencoded');
    });

    it('should throw with comment on FAILED status', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'FAILED', comment: 'bad credentials' })
      );
      await expect(sdk.listProblems()).rejects.toThrow(
        'Polygon API Error: bad credentials'
      );
    });

    it('should throw with undefined comment on FAILED status without comment', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'FAILED' }));
      await expect(sdk.listProblems()).rejects.toThrow(
        'Polygon API Error: undefined'
      );
    });

    it('should propagate network errors from fetch', async () => {
      fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(sdk.listProblems()).rejects.toThrow('ECONNREFUSED');
    });

    it('should stringify boolean and number params for body', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'OK', result: [] })
      );
      await sdk.listProblems({ showDeleted: true, id: 7 });
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('showDeleted')).toBe('true');
      expect(call.body.get('id')).toBe('7');
    });
  });

  describe('listProblems', () => {
    it('should return list on OK status', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({
          status: 'OK',
          result: [
            { id: 1, name: 'A' },
            { id: 2, name: 'B' },
          ],
        })
      );
      const problems = await sdk.listProblems();
      expect(problems).toHaveLength(2);
    });

    it('should pass filter options to body', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'OK', result: [] })
      );
      await sdk.listProblems({ owner: 'alice', name: 'foo' });
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('owner')).toBe('alice');
      expect(call.body.get('name')).toBe('foo');
    });

    it('should throw on FAILED', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'FAILED', comment: 'denied' })
      );
      await expect(sdk.listProblems()).rejects.toThrow(
        'Polygon API Error: denied'
      );
    });
  });

  describe('createProblem', () => {
    it('should send name and parse result', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'OK', result: { id: 99, name: 'X' } })
      );
      const p = await sdk.createProblem('X');
      expect(p.id).toBe(99);
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('name')).toBe('X');
      expect(call.url).toContain('/problem.create');
    });

    it('should reject on FAILED', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'FAILED', comment: 'duplicate' })
      );
      await expect(sdk.createProblem('X')).rejects.toThrow(
        'Polygon API Error: duplicate'
      );
    });
  });

  describe('getProblemInfo', () => {
    it('should request problem.info with problemId', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({
          status: 'OK',
          result: { timeLimit: 1000, memoryLimit: 256 },
        })
      );
      const info = await sdk.getProblemInfo(11);
      expect(info.timeLimit).toBe(1000);
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toContain('/problem.info');
      expect(call.body.get('problemId')).toBe('11');
      expect(call.body.get('pin')).toBeNull();
    });

    it('should include pin when provided', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'OK', result: {} })
      );
      await sdk.getProblemInfo(11, 'secretpin');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('pin')).toBe('secretpin');
    });

    it('should throw on FAILED', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'FAILED', comment: 'no access' })
      );
      await expect(sdk.getProblemInfo(11)).rejects.toThrow('no access');
    });
  });

  describe('updateProblemInfo', () => {
    it('should merge info fields into body', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.updateProblemInfo(1, {
        timeLimit: 2000,
        memoryLimit: 512,
        interactive: true,
      });
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('timeLimit')).toBe('2000');
      expect(call.body.get('memoryLimit')).toBe('512');
      expect(call.body.get('interactive')).toBe('true');
      expect(call.url).toContain('/problem.updateInfo');
    });
  });

  describe('working copy operations', () => {
    it('updateWorkingCopy should call problem.updateWorkingCopy', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.updateWorkingCopy(5, 'pin');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toContain('/problem.updateWorkingCopy');
      expect(call.body.get('pin')).toBe('pin');
    });

    it('discardWorkingCopy should call problem.discardWorkingCopy', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.discardWorkingCopy(5);
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toContain('/problem.discardWorkingCopy');
      expect(call.body.get('problemId')).toBe('5');
    });

    it('commitChanges should pass options', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.commitChanges(5, { minorChanges: true, message: 'hello' });
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toContain('/problem.commitChanges');
      expect(call.body.get('minorChanges')).toBe('true');
      expect(call.body.get('message')).toBe('hello');
    });

    it('commitChanges should work without options', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.commitChanges(5);
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('problemId')).toBe('5');
    });
  });

  describe('statements', () => {
    it('getStatements should request problem.statements', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({
          status: 'OK',
          result: { english: { name: 'P' } },
        })
      );
      const statements = await sdk.getStatements(7);
      expect(statements['english']).toBeDefined();
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toContain('/problem.statements');
    });

    it('saveStatement should pass lang and statement fields', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.saveStatement(7, 'english', { legend: 'do stuff' }, 'p');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toContain('/problem.saveStatement');
      expect(call.body.get('lang')).toBe('english');
      expect(call.body.get('legend')).toBe('do stuff');
      expect(call.body.get('pin')).toBe('p');
    });

    it('getStatementResources should return file array', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'OK', result: [{ name: 'a.png' }] })
      );
      const r = await sdk.getStatementResources(7);
      expect(r).toHaveLength(1);
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toContain('/problem.statementResources');
    });

    it('saveStatementResource should pass through string', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.saveStatementResource(7, 'note.txt', 'plain text');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('file')).toBe('plain text');
      expect(call.body.get('name')).toBe('note.txt');
    });

    it('saveStatementResource should base64-encode buffer', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      const buf = Buffer.from('hello');
      await sdk.saveStatementResource(7, 'pic.png', buf, true, 'pp');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('file')).toBe(buf.toString('base64'));
      expect(call.body.get('checkExisting')).toBe('true');
      expect(call.body.get('pin')).toBe('pp');
    });
  });

  describe('checker / validator / interactor', () => {
    it('getChecker should return raw text', async () => {
      fetchMock.mockResolvedValue(makeTextResponse('wcmp.cpp'));
      const c = await sdk.getChecker(1);
      expect(c).toBe('wcmp.cpp');
    });

    it('setChecker should call problem.setChecker with autoUpdate=false', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.setChecker(1, 'check.cpp', 'pp');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toContain('/problem.setChecker');
      expect(call.body.get('checker')).toBe('check.cpp');
      expect(call.body.get('autoUpdate')).toBe('false');
      expect(call.body.get('pin')).toBe('pp');
    });

    it('getValidator should return text', async () => {
      fetchMock.mockResolvedValue(makeTextResponse('val.cpp'));
      const v = await sdk.getValidator(1);
      expect(v).toBe('val.cpp');
    });

    it('setValidator should call problem.setValidator', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.setValidator(1, 'val.cpp');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toContain('/problem.setValidator');
      expect(call.body.get('validator')).toBe('val.cpp');
    });

    it('getExtraValidators should return array', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'OK', result: ['a.cpp', 'b.cpp'] })
      );
      const list = await sdk.getExtraValidators(1);
      expect(list).toEqual(['a.cpp', 'b.cpp']);
    });

    it('getInteractor should return text', async () => {
      fetchMock.mockResolvedValue(makeTextResponse('inter.cpp'));
      const i = await sdk.getInteractor(1);
      expect(i).toBe('inter.cpp');
    });

    it('setInteractor should call problem.setInteractor', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.setInteractor(1, 'inter.cpp');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toContain('/problem.setInteractor');
      expect(call.body.get('interactor')).toBe('inter.cpp');
    });
  });

  describe('validator/checker tests', () => {
    it('getValidatorTests should return list', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({
          status: 'OK',
          result: [{ index: 1, expectedVerdict: 'VALID' }],
        })
      );
      const t = await sdk.getValidatorTests(1);
      expect(t).toHaveLength(1);
    });

    it('saveValidatorTest should pass options', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.saveValidatorTest(
        1,
        2,
        '5 10',
        'INVALID',
        { testset: 'tests', testGroup: 'small', checkExisting: false },
        'pp'
      );
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toContain('/problem.saveValidatorTest');
      expect(call.body.get('testIndex')).toBe('2');
      expect(call.body.get('testInput')).toBe('5 10');
      expect(call.body.get('testVerdict')).toBe('INVALID');
      expect(call.body.get('testset')).toBe('tests');
      expect(call.body.get('testGroup')).toBe('small');
      expect(call.body.get('pin')).toBe('pp');
    });

    it('getCheckerTests should return list', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({
          status: 'OK',
          result: [{ index: 1, expectedVerdict: 'OK' }],
        })
      );
      const t = await sdk.getCheckerTests(1);
      expect(t).toHaveLength(1);
    });

    it('saveCheckerTest should pass all fields', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.saveCheckerTest(1, 1, '5 10', '15', '15', 'OK', true, 'pp');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toContain('/problem.saveCheckerTest');
      expect(call.body.get('testInput')).toBe('5 10');
      expect(call.body.get('testOutput')).toBe('15');
      expect(call.body.get('testAnswer')).toBe('15');
      expect(call.body.get('testVerdict')).toBe('OK');
      expect(call.body.get('checkExisting')).toBe('true');
      expect(call.body.get('pin')).toBe('pp');
    });

    it('saveCheckerTest should omit checkExisting when undefined', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.saveCheckerTest(1, 1, 'a', 'b', 'b', 'OK');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('checkExisting')).toBeNull();
    });
  });

  describe('files', () => {
    it('getFiles should return FilesResponse', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({
          status: 'OK',
          result: { resourceFiles: [], sourceFiles: [], auxFiles: [] },
        })
      );
      const r = await sdk.getFiles(1);
      expect(r.sourceFiles).toEqual([]);
    });

    it('viewFile should return raw string', async () => {
      fetchMock.mockResolvedValue(makeTextResponse('int main() {}'));
      const code = await sdk.viewFile(1, 'source', 'main.cpp');
      expect(code).toBe('int main() {}');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('type')).toBe('source');
      expect(call.body.get('name')).toBe('main.cpp');
    });

    it('saveFile should pass through string content', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.saveFile(1, 'source', 'gen.cpp', 'src code', {
        sourceType: 'cpp.g++17',
      });
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toContain('/problem.saveFile');
      expect(call.body.get('file')).toBe('src code');
      expect(call.body.get('sourceType')).toBe('cpp.g++17');
    });

    it('saveFile should base64-encode buffer', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      const buf = Buffer.from([0x00, 0x01, 0xff]);
      await sdk.saveFile(1, 'resource', 'r.bin', buf, undefined, 'pp');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('file')).toBe(buf.toString('base64'));
      expect(call.body.get('pin')).toBe('pp');
    });

    it('saveFile should pass forTypes/stages/assets/checkExisting', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.saveFile(1, 'resource', 'g.h', 'data', {
        forTypes: 'cpp.*',
        stages: 'COMPILE',
        assets: 'SOLUTION',
        checkExisting: false,
      });
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('forTypes')).toBe('cpp.*');
      expect(call.body.get('stages')).toBe('COMPILE');
      expect(call.body.get('assets')).toBe('SOLUTION');
      expect(call.body.get('checkExisting')).toBe('false');
    });
  });

  describe('solutions', () => {
    it('getSolutions should return list', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({
          status: 'OK',
          result: [{ name: 'main.cpp', tag: 'MA' }],
        })
      );
      const sols = await sdk.getSolutions(1);
      expect(sols[0]?.name).toBe('main.cpp');
    });

    it('viewSolution should return raw text', async () => {
      fetchMock.mockResolvedValue(makeTextResponse('source'));
      const code = await sdk.viewSolution(1, 'main.cpp', 'pp');
      expect(code).toBe('source');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('name')).toBe('main.cpp');
      expect(call.body.get('pin')).toBe('pp');
    });

    it('saveSolution should encode buffer and include tag', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      const buf = Buffer.from('binary');
      await sdk.saveSolution(1, 'sol.cpp', buf, 'MA', {
        sourceType: 'cpp.g++17',
        checkExisting: true,
      });
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toContain('/problem.saveSolution');
      expect(call.body.get('file')).toBe(buf.toString('base64'));
      expect(call.body.get('tag')).toBe('MA');
      expect(call.body.get('sourceType')).toBe('cpp.g++17');
      expect(call.body.get('checkExisting')).toBe('true');
    });

    it('saveSolution should accept string content', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.saveSolution(1, 'sol.cpp', 'plain', 'WA');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('file')).toBe('plain');
      expect(call.body.get('tag')).toBe('WA');
    });

    it('editSolutionExtraTags should pass remove/options', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.editSolutionExtraTags(
        1,
        'slow.cpp',
        false,
        { testGroup: 'large', tag: 'TL' },
        'pp'
      );
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toContain('/problem.editSolutionExtraTags');
      expect(call.body.get('remove')).toBe('false');
      expect(call.body.get('testGroup')).toBe('large');
      expect(call.body.get('tag')).toBe('TL');
      expect(call.body.get('pin')).toBe('pp');
    });
  });

  describe('script methods', () => {
    it('getScript should return raw text', async () => {
      fetchMock.mockResolvedValue(makeTextResponse('gen 1 10 > $\n'));
      const s = await sdk.getScript(1, 'tests');
      expect(s).toBe('gen 1 10 > $\n');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('testset')).toBe('tests');
    });

    it('saveScript should send source field', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.saveScript(1, 'tests', 'gen 5 > $', 'pp');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toContain('/problem.saveScript');
      expect(call.body.get('source')).toBe('gen 5 > $');
      expect(call.body.get('pin')).toBe('pp');
    });
  });

  describe('tests methods', () => {
    it('getTests should return list', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({
          status: 'OK',
          result: [{ index: 1, manual: true }],
        })
      );
      const t = await sdk.getTests(1, 'tests');
      expect(t).toHaveLength(1);
    });

    it('getTests should pass noInputs flag', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'OK', result: [] })
      );
      await sdk.getTests(1, 'tests', true, 'pp');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('noInputs')).toBe('true');
      expect(call.body.get('pin')).toBe('pp');
    });

    it('getTestInput should return raw input', async () => {
      fetchMock.mockResolvedValue(makeTextResponse('5 10\n'));
      const v = await sdk.getTestInput(1, 'tests', 1);
      expect(v).toBe('5 10\n');
    });

    it('getTestAnswer should return raw answer', async () => {
      fetchMock.mockResolvedValue(makeTextResponse('15\n'));
      const v = await sdk.getTestAnswer(1, 'tests', 1);
      expect(v).toBe('15\n');
    });

    it('saveTest should pass options and testInput', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.saveTest(
        1,
        'tests',
        2,
        '1 2',
        {
          testGroup: 'small',
          testPoints: 5,
          testDescription: 'desc',
          testUseInStatements: true,
        },
        'pp'
      );
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toContain('/problem.saveTest');
      expect(call.body.get('testInput')).toBe('1 2');
      expect(call.body.get('testGroup')).toBe('small');
      expect(call.body.get('testPoints')).toBe('5');
      expect(call.body.get('testDescription')).toBe('desc');
      expect(call.body.get('testUseInStatements')).toBe('true');
      expect(call.body.get('pin')).toBe('pp');
    });

    it('saveTest should omit empty testInput', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.saveTest(1, 'tests', 2, '');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('testInput')).toBeNull();
    });

    it('setTestGroup should join indices with comma', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.setTestGroup(1, 'tests', 'small', [1, 2, 3, 5]);
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toContain('/problem.setTestGroup');
      expect(call.body.get('testIndices')).toBe('1,2,3,5');
      expect(call.body.get('testGroup')).toBe('small');
    });

    it('enableGroups should pass enable flag', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.enableGroups(1, 'tests', true);
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toContain('/problem.enableGroups');
      expect(call.body.get('enable')).toBe('true');
    });

    it('enablePoints should pass enable flag', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.enablePoints(1, false);
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toContain('/problem.enablePoints');
      expect(call.body.get('enable')).toBe('false');
    });

    it('viewTestGroup should return list', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({
          status: 'OK',
          result: [{ name: 'g1', pointsPolicy: 'EACH_TEST' }],
        })
      );
      const groups = await sdk.viewTestGroup(1, 'tests');
      expect(groups).toHaveLength(1);
    });

    it('viewTestGroup should include group when provided', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'OK', result: [] })
      );
      await sdk.viewTestGroup(1, 'tests', 'small', 'pp');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('group')).toBe('small');
      expect(call.body.get('pin')).toBe('pp');
    });

    it('saveTestGroup should pass policy and dependencies', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.saveTestGroup(1, 'tests', 'g1', {
        pointsPolicy: 'COMPLETE_GROUP',
        feedbackPolicy: 'ICPC',
        dependencies: 'easy,medium',
      });
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toContain('/problem.saveTestGroup');
      expect(call.body.get('pointsPolicy')).toBe('COMPLETE_GROUP');
      expect(call.body.get('feedbackPolicy')).toBe('ICPC');
      expect(call.body.get('dependencies')).toBe('easy,medium');
    });
  });

  describe('tags / descriptions / tutorial', () => {
    it('viewTags should return array', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'OK', result: ['dp', 'math'] })
      );
      expect(await sdk.viewTags(1)).toEqual(['dp', 'math']);
    });

    it('saveTags should join with comma', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.saveTags(1, ['dp', 'greedy'], 'pp');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('tags')).toBe('dp,greedy');
      expect(call.body.get('pin')).toBe('pp');
    });

    it('saveTags with empty array should send empty string', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.saveTags(1, []);
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('tags')).toBe('');
    });

    it('viewGeneralDescription should return text', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'OK', result: 'desc' })
      );
      expect(await sdk.viewGeneralDescription(1)).toBe('desc');
    });

    it('saveGeneralDescription should pass description', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.saveGeneralDescription(1, 'foo', 'pp');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('description')).toBe('foo');
      expect(call.body.get('pin')).toBe('pp');
    });

    it('viewGeneralTutorial should return text', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'OK', result: 'tut' })
      );
      expect(await sdk.viewGeneralTutorial(1)).toBe('tut');
    });

    it('saveGeneralTutorial should pass tutorial', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.saveGeneralTutorial(1, 'apply DP');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('tutorial')).toBe('apply DP');
    });
  });

  describe('packages', () => {
    it('listPackages should return array', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({
          status: 'OK',
          result: [{ id: 1, state: 'READY' }],
        })
      );
      const pkgs = await sdk.listPackages(1);
      expect(pkgs).toHaveLength(1);
    });

    it('downloadPackage should return Buffer with binary data', async () => {
      const binary = '\x00\x01\xff';
      fetchMock.mockResolvedValue({
        json: () => Promise.resolve({ status: 'OK', result: binary }),
        text: () => Promise.resolve(binary),
      });
      const buf = await sdk.downloadPackage(1, 99, 'linux', 'pp');
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf).toEqual(Buffer.from(binary, 'binary'));
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('packageId')).toBe('99');
      expect(call.body.get('type')).toBe('linux');
      expect(call.body.get('pin')).toBe('pp');
    });

    it('downloadPackage without optional type', async () => {
      fetchMock.mockResolvedValue({
        json: () => Promise.resolve({ status: 'OK', result: 'data' }),
        text: () => Promise.resolve('data'),
      });
      await sdk.downloadPackage(1, 99);
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('type')).toBeNull();
    });

    it('buildPackage should pass full/verify flags', async () => {
      fetchMock.mockResolvedValue(makeJsonResponse({ status: 'OK' }));
      await sdk.buildPackage(1, true, false, 'pp');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toContain('/problem.buildPackage');
      expect(call.body.get('full')).toBe('true');
      expect(call.body.get('verify')).toBe('false');
      expect(call.body.get('pin')).toBe('pp');
    });
  });

  describe('contest methods', () => {
    it('getContestProblems should return problem array', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({
          status: 'OK',
          result: [{ id: 1, name: 'A' }],
        })
      );
      const problems = await sdk.getContestProblems(789);
      expect(problems).toHaveLength(1);
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.url).toContain('/contest.problems');
      expect(call.body.get('contestId')).toBe('789');
    });

    it('getContestProblems should propagate FAILED', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'FAILED', comment: 'no contest' })
      );
      await expect(sdk.getContestProblems(789)).rejects.toThrow('no contest');
    });

    it('getContestProblems should send pin', async () => {
      fetchMock.mockResolvedValue(
        makeJsonResponse({ status: 'OK', result: [] })
      );
      await sdk.getContestProblems(789, 'cpin');
      const call = parseFetchCall(fetchMock.mock.calls[0]);
      expect(call.body.get('pin')).toBe('cpin');
    });
  });

  // Original baseline tests preserved
  it('should list problems', async () => {
    const mockResponse = {
      status: 'OK',
      result: [{ id: 1, name: 'Problem' }],
    };
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve(mockResponse),
    });

    const problems = await sdk.listProblems();
    expect(problems).toHaveLength(1);
    expect(problems[0]?.id).toBe(1);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('should handle API failure', async () => {
    const mockResponse = {
      status: 'FAILED',
      comment: 'Access denied',
    };
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve(mockResponse),
    });

    await expect(sdk.listProblems()).rejects.toThrow(
      'Polygon API Error: Access denied'
    );
  });

  it('should create problem', async () => {
    const mockResponse = {
      status: 'OK',
      result: { id: 2, name: 'New Prob' },
    };
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve(mockResponse),
    });

    const prob = await sdk.createProblem('New Prob');
    expect(prob.id).toBe(2);
  });

  it('should generate correct signature', async () => {
    const mockResponse = { status: 'OK', result: [] };
    fetchMock.mockResolvedValue({
      json: () => Promise.resolve(mockResponse),
    });

    await sdk.listProblems();

    const call = parseFetchCall(fetchMock.mock.calls[0]);
    expect(call.body.toString()).toContain('apiSig=');
    expect(call.body.toString()).toContain('apiKey=key');
    expect(call.body.toString()).toContain('time=');
  });
});
