import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as testlibDownload from '../../src/helpers/testlib-download';
import https from 'https';
import type { IncomingMessage, ClientRequest } from 'http';
import { EventEmitter } from 'events';

vi.mock('https');

type GetCallback = (res: IncomingMessage) => void;
type HttpsGet = (url: string, cb: GetCallback) => ClientRequest;
const mockedGet: import('vitest').MockedFunction<HttpsGet> =
  https.get as unknown as import('vitest').MockedFunction<HttpsGet>;

interface MockResponse extends EventEmitter {
  statusCode?: number;
  headers: { location?: string };
}

function createMockResponse(
  statusCode: number,
  headers: { location?: string } = {}
): MockResponse {
  const emitter = new EventEmitter() as MockResponse;
  emitter.statusCode = statusCode;
  emitter.headers = headers;
  return emitter;
}

describe('testlib-download.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('downloadFile', () => {
    it('should download file successfully', async () => {
      const mockResponse = createMockResponse(200);

      mockedGet.mockImplementation((_url, cb) => {
        if (cb instanceof Function) cb(mockResponse as IncomingMessage);
        return new EventEmitter() as unknown as ClientRequest;
      });

      const promise = testlibDownload.downloadFile('http://example.com');

      mockResponse.emit('data', Buffer.from('content'));
      mockResponse.emit('end');

      await expect(promise).resolves.toBe('content');
    });

    it('should handle redirect', async () => {
      const reqEmitter = new EventEmitter() as unknown as ClientRequest;

      mockedGet
        .mockImplementationOnce((_url, cb) => {
          const resStart = createMockResponse(302, {
            location: 'http://redirect.com',
          });
          if (cb instanceof Function) cb(resStart as IncomingMessage);
          return reqEmitter;
        })
        .mockImplementationOnce((_url, cb) => {
          const resFinal = createMockResponse(200);
          if (cb instanceof Function) cb(resFinal as IncomingMessage);
          setTimeout(() => {
            resFinal.emit('data', Buffer.from('redirected'));
            resFinal.emit('end');
          }, 10);
          return reqEmitter;
        });

      await expect(
        testlibDownload.downloadFile('http://start.com')
      ).resolves.toBe('redirected');
    });

    it('should reject on error status', async () => {
      mockedGet.mockImplementation((_url, cb) => {
        const res = createMockResponse(404);
        if (cb instanceof Function) cb(res as IncomingMessage);
        return new EventEmitter() as unknown as ClientRequest;
      });

      await expect(
        testlibDownload.downloadFile('http://fail.com')
      ).rejects.toThrow('HTTP status: 404');
    });

    it('should reject on request error', async () => {
      const req = new EventEmitter();
      mockedGet.mockReturnValue(req as unknown as ClientRequest);

      const promise = testlibDownload.downloadFile('http://error.com');
      req.emit('error', new Error('network error'));

      await expect(promise).rejects.toThrow('Download failed: network error');
    });
  });
});
