/**
 * @fileoverview Unit tests for Polygon SDK (polygon.ts)
 * Tests API signature generation, request building, parameter encoding, and error handling
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PolygonSDK } from '../../polygon.js';
import type { Problem, ProblemInfo, Solution, Test } from '../../types.js';

describe('PolygonSDK - Initialization', () => {
  it('should create SDK instance with valid config', () => {
    const sdk = new PolygonSDK({
      apiKey: 'test-key',
      apiSecret: 'test-secret',
    });
    
    expect(sdk).toBeInstanceOf(PolygonSDK);
  });

  it('should use default base URL if not provided', () => {
    const sdk = new PolygonSDK({
      apiKey: 'test-key',
      apiSecret: 'test-secret',
    });
    
    expect(sdk['baseUrl']).toBe('https://polygon.codeforces.com/api');
  });

  it('should use custom base URL if provided', () => {
    const sdk = new PolygonSDK({
      apiKey: 'test-key',
      apiSecret: 'test-secret',
      baseUrl: 'https://custom.api.com',
    });
    
    expect(sdk['baseUrl']).toBe('https://custom.api.com');
  });
});

describe('PolygonSDK - Signature Generation', () => {
  let sdk: PolygonSDK;

  beforeEach(() => {
    sdk = new PolygonSDK({
      apiKey: 'test-api-key',
      apiSecret: 'test-secret-key',
    });
  });

  it('should generate valid signature format', () => {
    const signature = sdk['generateSignature']('problems.list', {});
    
    // Signature should be: 6 random chars + 128 hex chars (SHA-512)
    expect(signature).toMatch(/^[a-z0-9]{6}[a-f0-9]{128}$/);
  });

  it('should include method name in signature', () => {
    const sig1 = sdk['generateSignature']('problems.list', {});
    const sig2 = sdk['generateSignature']('problem.info', {});
    
    // Different methods should produce different signatures
    expect(sig1).not.toBe(sig2);
  });

  it('should include parameters in signature', () => {
    const sig1 = sdk['generateSignature']('problem.info', { problemId: 123 });
    const sig2 = sdk['generateSignature']('problem.info', { problemId: 456 });
    
    // Different parameters should produce different signatures
    expect(sig1).not.toBe(sig2);
  });

  it('should include apiKey in signature calculation', () => {
    const sdk1 = new PolygonSDK({
      apiKey: 'key1',
      apiSecret: 'secret',
    });
    const sdk2 = new PolygonSDK({
      apiKey: 'key2',
      apiSecret: 'secret',
    });
    
    const sig1 = sdk1['generateSignature']('problems.list', {});
    const sig2 = sdk2['generateSignature']('problems.list', {});
    
    // Different API keys should produce different signatures
    expect(sig1).not.toBe(sig2);
  });

  it('should sort parameters lexicographically', () => {
    // Mock Math.random to make the random prefix deterministic
    const originalRandom = Math.random;
    Math.random = () => 0.123456;
    
    try {
      // The signature should be the same regardless of parameter order
      const params1 = { z: 'last', a: 'first', m: 'middle' };
      const params2 = { a: 'first', m: 'middle', z: 'last' };
      
      const sig1 = sdk['generateSignature']('test.method', params1);
      const sig2 = sdk['generateSignature']('test.method', params2);
      
      expect(sig1).toBe(sig2);
    } finally {
      Math.random = originalRandom;
    }
  });

  it('should handle boolean parameters', () => {
    const signature = sdk['generateSignature']('test.method', {
      enabled: true,
      disabled: false,
    });
    
    expect(signature).toMatch(/^[a-z0-9]{6}[a-f0-9]{128}$/);
  });

  it('should handle numeric parameters', () => {
    const signature = sdk['generateSignature']('problem.info', {
      problemId: 12345,
      revision: 10,
    });
    
    expect(signature).toMatch(/^[a-z0-9]{6}[a-f0-9]{128}$/);
  });

  it('should produce deterministic signatures (excluding random prefix)', () => {
    // Mock Math.random to make it deterministic
    const originalRandom = Math.random;
    Math.random = () => 0.123456;
    
    try {
      const sig1 = sdk['generateSignature']('problems.list', {});
      const sig2 = sdk['generateSignature']('problems.list', {});
      
      // Same random seed should produce same signature
      expect(sig1).toBe(sig2);
    } finally {
      Math.random = originalRandom;
    }
  });

  it('should include time parameter in signature', () => {
    // Mock Date.now for deterministic testing
    const originalDateNow = Date.now;
    let callCount = 0;
    Date.now = () => {
      callCount++;
      return callCount * 1000000; // Different times
    };
    
    try {
      const sig1 = sdk['generateSignature']('problems.list', {});
      const sig2 = sdk['generateSignature']('problems.list', {});
      
      // Different times should produce different signatures
      expect(sig1).not.toBe(sig2);
    } finally {
      Date.now = originalDateNow;
    }
  });
});

describe('PolygonSDK - Request Building', () => {
  let sdk: PolygonSDK;
  let fetchMock: any;

  beforeEach(() => {
    sdk = new PolygonSDK({
      apiKey: 'test-key',
      apiSecret: 'test-secret',
    });

    // Mock fetch
    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should build correct request URL', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ status: 'OK', result: [] }),
    });

    await sdk['request']('problems.list', {});

    expect(fetchMock).toHaveBeenCalledWith(
      'https://polygon.codeforces.com/api/problems.list',
      expect.any(Object)
    );
  });

  it('should use POST method', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ status: 'OK', result: [] }),
    });

    await sdk['request']('problems.list', {});

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('should include required authentication parameters', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ status: 'OK', result: [] }),
    });

    await sdk['request']('problems.list', {});

    const callArgs = fetchMock.mock.calls[0][1];
    const body = callArgs.body.toString();
    
    expect(body).toContain('apiKey=test-key');
    expect(body).toContain('time=');
    expect(body).toContain('apiSig=');
  });

  it('should convert all parameters to strings', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ status: 'OK', result: {} }),
    });

    await sdk['request']('problem.info', {
      problemId: 123,
      enabled: true,
    });

    const callArgs = fetchMock.mock.calls[0][1];
    const body = callArgs.body.toString();
    
    expect(body).toContain('problemId=123');
    expect(body).toContain('enabled=true');
  });

  it('should set correct content type header', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({ status: 'OK', result: [] }),
    });

    await sdk['request']('problems.list', {});

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      })
    );
  });
});

describe('PolygonSDK - Response Handling', () => {
  let sdk: PolygonSDK;
  let fetchMock: any;

  beforeEach(() => {
    sdk = new PolygonSDK({
      apiKey: 'test-key',
      apiSecret: 'test-secret',
    });

    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return result on successful response', async () => {
    const mockResult = [{ id: 1, name: 'test' }];
    fetchMock.mockResolvedValue({
      json: async () => ({ status: 'OK', result: mockResult }),
    });

    const result = await sdk['request']('problems.list', {});
    expect(result).toEqual(mockResult);
  });

  it('should throw error on FAILED status', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        status: 'FAILED',
        comment: 'Invalid API key',
      }),
    });

    await expect(sdk['request']('problems.list', {})).rejects.toThrow(
      'Polygon API Error: Invalid API key'
    );
  });

  it('should return raw text when returnRaw is true', async () => {
    const rawText = 'Raw file content';
    fetchMock.mockResolvedValue({
      text: async () => rawText,
    });

    const result = await sdk['request']('problem.viewFile', {}, true);
    expect(result).toBe(rawText);
  });

  it('should handle JSON parsing errors gracefully', async () => {
    fetchMock.mockResolvedValue({
      json: async () => {
        throw new Error('Invalid JSON');
      },
    });

    await expect(sdk['request']('problems.list', {})).rejects.toThrow();
  });
});

describe('PolygonSDK - Parameter Encoding', () => {
  let sdk: PolygonSDK;
  let fetchMock: any;

  beforeEach(() => {
    sdk = new PolygonSDK({
      apiKey: 'test-key',
      apiSecret: 'test-secret',
    });

    fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ status: 'OK', result: {} }),
    });
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should encode special characters in parameters', async () => {
    await sdk['request']('test.method', {
      text: 'Hello World!',
    });

    const body = fetchMock.mock.calls[0][1].body.toString();
    expect(body).toContain('text=Hello+World%21');
  });

  it('should handle empty string parameters', async () => {
    await sdk['request']('test.method', {
      emptyField: '',
    });

    const body = fetchMock.mock.calls[0][1].body.toString();
    expect(body).toContain('emptyField=');
  });

  it('should handle parameters with special characters', async () => {
    await sdk['request']('test.method', {
      special: 'a&b=c',
    });

    const body = fetchMock.mock.calls[0][1].body.toString();
    // URLSearchParams should encode & and =
    expect(body).toContain('special=a%26b%3Dc');
  });
});

describe('PolygonSDK - Error Handling', () => {
  let sdk: PolygonSDK;
  let fetchMock: any;

  beforeEach(() => {
    sdk = new PolygonSDK({
      apiKey: 'test-key',
      apiSecret: 'test-secret',
    });

    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should handle network errors', async () => {
    fetchMock.mockRejectedValue(new Error('Network error'));

    await expect(sdk['request']('problems.list', {})).rejects.toThrow(
      'Network error'
    );
  });

  it('should handle timeout errors', async () => {
    fetchMock.mockImplementation(
      () =>
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Timeout')), 100);
        })
    );

    await expect(sdk['request']('problems.list', {})).rejects.toThrow();
  });

  it('should include error comment in error message', async () => {
    fetchMock.mockResolvedValue({
      json: async () => ({
        status: 'FAILED',
        comment: 'Problem not found',
      }),
    });

    await expect(sdk['request']('problem.info', {})).rejects.toThrow(
      'Problem not found'
    );
  });
});

describe('PolygonSDK - High-Level Methods', () => {
  let sdk: PolygonSDK;
  let fetchMock: any;

  beforeEach(() => {
    sdk = new PolygonSDK({
      apiKey: 'test-key',
      apiSecret: 'test-secret',
    });

    fetchMock = vi.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('listProblems', () => {
    it('should call problems.list endpoint', async () => {
      const mockProblems: Problem[] = [
        {
          id: 1,
          owner: 'test',
          name: 'Problem A',
          deleted: false,
          favourite: false,
          accessType: 'OWNER',
          revision: 1,
          modified: false,
        },
      ];

      fetchMock.mockResolvedValue({
        json: async () => ({ status: 'OK', result: mockProblems }),
      });

      const problems = await sdk.listProblems();
      expect(problems).toEqual(mockProblems);
    });

    it('should pass filter parameters', async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({ status: 'OK', result: [] }),
      });

      await sdk.listProblems({ owner: 'testuser', showDeleted: true });

      const body = fetchMock.mock.calls[0][1].body.toString();
      expect(body).toContain('owner=testuser');
      expect(body).toContain('showDeleted=true');
    });
  });

  describe('createProblem', () => {
    it('should call problem.create with name', async () => {
      const mockProblem: Problem = {
        id: 123,
        owner: 'test',
        name: 'New Problem',
        deleted: false,
        favourite: false,
        accessType: 'OWNER',
        revision: 1,
        modified: false,
      };

      fetchMock.mockResolvedValue({
        json: async () => ({ status: 'OK', result: mockProblem }),
      });

      const problem = await sdk.createProblem('New Problem');
      expect(problem.name).toBe('New Problem');
      expect(problem.id).toBe(123);
    });
  });

  describe('getProblemInfo', () => {
    it('should return problem info', async () => {
      const mockInfo: ProblemInfo = {
        inputFile: 'stdin',
        outputFile: 'stdout',
        interactive: false,
        timeLimit: 2000,
        memoryLimit: 256,
      };

      fetchMock.mockResolvedValue({
        json: async () => ({ status: 'OK', result: mockInfo }),
      });

      const info = await sdk.getProblemInfo(123);
      expect(info.timeLimit).toBe(2000);
      expect(info.memoryLimit).toBe(256);
    });

    it('should pass PIN if provided', async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({ status: 'OK', result: {} }),
      });

      await sdk.getProblemInfo(123, 'secret-pin');

      const body = fetchMock.mock.calls[0][1].body.toString();
      expect(body).toContain('pin=secret-pin');
    });
  });

  describe('saveSolution', () => {
    it('should upload solution with correct parameters', async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({ status: 'OK', result: null }),
      });

      await sdk.saveSolution(
        123,
        'main.cpp',
        '#include <iostream>',
        'MA',
        { sourceType: 'cpp.g++17' }
      );

      const body = fetchMock.mock.calls[0][1].body.toString();
      expect(body).toContain('problemId=123');
      expect(body).toContain('name=main.cpp');
      expect(body).toContain('tag=MA');
      expect(body).toContain('sourceType=cpp.g%2B%2B17');
    });

    it('should handle Buffer input', async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({ status: 'OK', result: null }),
      });

      const code = Buffer.from('#include <iostream>');
      await sdk.saveSolution(123, 'main.cpp', code, 'MA');

      const body = fetchMock.mock.calls[0][1].body.toString();
      expect(body).toContain('file=');
    });
  });

  describe('getTests', () => {
    it('should return array of tests', async () => {
      const mockTests: Test[] = [
        {
          index: 1,
          manual: true,
          useInStatements: false,
          input: '1 2',
        },
        {
          index: 2,
          manual: false,
          useInStatements: false,
          scriptLine: 'gen 10',
        },
      ];

      fetchMock.mockResolvedValue({
        json: async () => ({ status: 'OK', result: mockTests }),
      });

      const tests = await sdk.getTests(123, 'tests');
      expect(tests).toHaveLength(2);
      expect(tests[0].manual).toBe(true);
      expect(tests[1].scriptLine).toBe('gen 10');
    });

    it('should pass noInputs flag', async () => {
      fetchMock.mockResolvedValue({
        json: async () => ({ status: 'OK', result: [] }),
      });

      await sdk.getTests(123, 'tests', true);

      const body = fetchMock.mock.calls[0][1].body.toString();
      expect(body).toContain('noInputs=true');
    });
  });
});
