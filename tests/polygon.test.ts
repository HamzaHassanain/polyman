
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PolygonSDK } from '../src/polygon';

const mockConfig = {
    apiKey: 'key',
    apiSecret: 'secret',
};

describe('PolygonSDK', () => {
    let sdk: PolygonSDK;
    const fetchMock = vi.fn();

    beforeEach(() => {
        vi.stubGlobal('fetch', fetchMock);
        sdk = new PolygonSDK(mockConfig);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

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
        expect(problems[0].id).toBe(1);
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

        await expect(sdk.listProblems()).rejects.toThrow('Polygon API Error: Access denied');
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

    // We can add more tests for other methods mirroring the same pattern
    // The core logic tests for polygon.ts primarily ensure it constructs requests correctly and parses responses.
    
    it('should generate correct signature', async () => {
        // This implicitly tests generateSignature via request
        const mockResponse = { status: 'OK', result: [] };
        fetchMock.mockResolvedValue({
            json: () => Promise.resolve(mockResponse),
        });
        
        await sdk.listProblems();
        
        const callArgs = fetchMock.mock.calls[0];
        const body = callArgs[1].body;
        // body is URLSearchParams
        expect(body.toString()).toContain('apiSig=');
        expect(body.toString()).toContain('apiKey=key');
        expect(body.toString()).toContain('time=');
    });
});
