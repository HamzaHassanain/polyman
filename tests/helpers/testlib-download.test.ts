
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as testlibDownload from '../../src/helpers/testlib-download';
import https from 'https';
import { EventEmitter } from 'events';

vi.mock('https');

describe('testlib-download.ts', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

  describe('downloadFile', () => {
      it('should download file successfully', async () => {
          const mockResponse = new EventEmitter() as any;
          mockResponse.statusCode = 200;
          
          (https.get as unknown as any).mockImplementation((_url : unknown, cb : unknown) => {
              if (cb && cb instanceof Function) cb(mockResponse);
              return new EventEmitter() as any; // request object
          });

          const promise = testlibDownload.downloadFile('http://example.com');
          
          mockResponse.emit('data', Buffer.from('content'));
          mockResponse.emit('end');

          await expect(promise).resolves.toBe('content');
      });

       it('should handle redirect', async () => {
           // Mock first response (302)
           // This is tricky because recursion calls https.get again.
           // We can mock implementation to return different responses based on call count or URL.
            const reqEmitter = new EventEmitter();
           
           (https.get as unknown as any).mockImplementationOnce((_url:unknown, cb:unknown) => {
               const resStart = new EventEmitter() as any;
               resStart.statusCode = 302;
               resStart.headers = { location: 'http://redirect.com' };
               if (cb && cb instanceof Function) cb(resStart);
               return reqEmitter as any;
           }).mockImplementationOnce((_url:unknown, cb:unknown) => {
               const resFinal = new EventEmitter() as any;
               resFinal.statusCode = 200;
               if (cb && cb instanceof Function) cb(resFinal);
               setTimeout(() => {
                   resFinal.emit('data', Buffer.from('redirected'));
                   resFinal.emit('end');
               }, 10);
               return reqEmitter as any;
           });

           await expect(testlibDownload.downloadFile('http://start.com')).resolves.toBe('redirected');
       });

       it('should reject on error status', async () => {
           (https.get as unknown as any).mockImplementation((_url : unknown , cb : unknown) => {
               const res = new EventEmitter() as any;
               res.statusCode = 404;
               if (cb && cb instanceof Function) cb(res);
               return new EventEmitter() as any;
           });
           
           await expect(testlibDownload.downloadFile('http://fail.com')).rejects.toThrow('HTTP status: 404');
       });
       
       it('should reject on request error', async () => {
           const req = new EventEmitter();
           (https.get as unknown as any).mockReturnValue(req as any);
           
           const promise = testlibDownload.downloadFile('http://error.com');
           req.emit('error', new Error('network error'));
           
           await expect(promise).rejects.toThrow('Download failed: network error');
       });
  });
});
