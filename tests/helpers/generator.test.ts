import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as generator from '../../src/helpers/generator';
import { executor } from '../../src/executor';
import * as utils from '../../src/helpers/utils';
import fs from 'fs';
import type {
  LocalGenerator,
  LocalTestset,
  ResolvedTest,
} from '../../src/types';

vi.mock('../../src/executor', () => ({
  executor: {
    executeWithRedirect: vi.fn(),
    execute: vi.fn(),
    cleanup: vi.fn(),
  },
}));

vi.mock('../../src/helpers/utils', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../src/helpers/utils')>();
  return {
    ...actual,
    compileCPP: vi.fn(),
    throwError: vi.fn((err: unknown, msg: string) => {
      throw new Error(`${msg}: ${(err as Error)?.message ?? String(err)}`);
    }),
    ensureDirectoryExists: vi.fn(),
    getCompiledCommandToRun: vi
      .fn()
      .mockImplementation((g: LocalGenerator) => `./compiled/${g.name}`),
  };
});

vi.mock('../../src/formatter', () => ({
  fmt: {
    warning: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    cross: vi.fn().mockReturnValue('x'),
    bold: vi.fn().mockImplementation((s: string) => s),
  },
}));

vi.mock('fs');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ensureGeneratorsExist', () => {
  it('throws on undefined or empty', () => {
    expect(() => generator.ensureGeneratorsExist(undefined)).toThrow(
      /No test generators/
    );
    expect(() => generator.ensureGeneratorsExist([])).toThrow();
  });
  it('passes on non-empty', () => {
    expect(() =>
      generator.ensureGeneratorsExist([{ name: 'g', source: 'g.cpp' }])
    ).not.toThrow();
  });
});

describe('compileGenerator', () => {
  it('rejects generators with no source', async () => {
    await expect(
      generator.compileGenerator({ name: 'g', source: '' })
    ).rejects.toThrow(/no source file/);
  });

  it('compiles via compileCPP', async () => {
    await generator.compileGenerator({ name: 'g', source: 'g.cpp' });
    expect(utils.compileCPP).toHaveBeenCalledWith('g.cpp');
  });
});

describe('compileGeneratorsForTests', () => {
  it('compiles each unique generator referenced by the resolved tests', async () => {
    const generators: LocalGenerator[] = [
      { name: 'g1', source: 'g1.cpp' },
      { name: 'g2', source: 'g2.cpp' },
      { name: 'g3', source: 'g3.cpp' },
    ];
    const tests: ResolvedTest[] = [
      {
        index: 1,
        source: {
          kind: 'generator',
          generator: 'g1',
          args: [],
          multiOutputs: null,
        },
      },
      {
        index: 2,
        source: {
          kind: 'generator',
          generator: 'g2',
          args: [],
          multiOutputs: null,
        },
      },
      {
        index: 3,
        source: {
          kind: 'generator',
          generator: 'g1',
          args: [],
          multiOutputs: null,
        },
      },
      {
        index: 4,
        source: { kind: 'manual', inputFile: 'm.in' },
      },
    ];
    const map = await generator.compileGeneratorsForTests(tests, generators);
    expect(map.size).toBe(2);
    expect(map.has('g1')).toBe(true);
    expect(map.has('g2')).toBe(true);
    expect(utils.compileCPP).toHaveBeenCalledTimes(2);
  });

  it('throws on unknown generator reference', async () => {
    const tests: ResolvedTest[] = [
      {
        index: 1,
        source: {
          kind: 'generator',
          generator: 'missing',
          args: [],
          multiOutputs: null,
        },
      },
    ];
    await expect(
      generator.compileGeneratorsForTests(tests, [])
    ).rejects.toThrow(/"missing" not found/);
  });
});

describe('compileGeneratorsForTestsets', () => {
  it('compiles every generator referenced across testsets', async () => {
    const generators: LocalGenerator[] = [
      { name: 'gen', source: 'gen.cpp' },
      { name: 'other', source: 'other.cpp' },
    ];
    const testsets: LocalTestset[] = [
      { name: 'a', generatorScript: { script: 'gen 1 > 1' } },
      { name: 'b', generatorScript: { script: 'other 2 > 1\ngen 3 > 2' } },
    ];
    await generator.compileGeneratorsForTestsets(testsets, generators);
    expect(utils.compileCPP).toHaveBeenCalledTimes(2);
  });

  it('throws when a script references an undefined generator', async () => {
    await expect(
      generator.compileGeneratorsForTestsets(
        [{ name: 'a', generatorScript: { script: 'unknown 1 > 1' } }],
        []
      )
    ).rejects.toThrow(/"unknown" not found/);
  });
});

describe('executeResolvedTests', () => {
  it('copies manual inputs to test<index>.txt', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const copyFile = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(fs, 'promises', {
      configurable: true,
      value: { copyFile },
    });
    const tests: ResolvedTest[] = [
      { index: 5, source: { kind: 'manual', inputFile: './m.in' } },
    ];
    await generator.executeResolvedTests(tests, [], '/out');
    expect(copyFile).toHaveBeenCalledWith(
      expect.stringContaining('m.in'),
      expect.stringContaining('test5.txt')
    );
  });

  it('runs single-output generators with stdout redirected to test<index>.txt', async () => {
    const executeWithRedirect = vi.mocked(
      (executor as { executeWithRedirect: typeof executor.executeWithRedirect })
        .executeWithRedirect
    );
    executeWithRedirect.mockResolvedValue({
      stdout: '',
      stderr: '',
      exitCode: 0,
      success: true,
    });
    const tests: ResolvedTest[] = [
      {
        index: 3,
        source: {
          kind: 'generator',
          generator: 'gen',
          args: ['7'],
          multiOutputs: null,
        },
      },
    ];
    await generator.executeResolvedTests(
      tests,
      [{ name: 'gen', source: 'gen.cpp' }],
      '/out'
    );
    const args = executeWithRedirect.mock.calls[0];
    expect(args[0]).toContain(
      process.platform === 'win32' ? 'gen "7"' : "gen '7'"
    );
    expect(args[3]).toContain('test3.txt');
  });

  it.skipIf(process.platform === 'win32')(
    'quotes generator script arguments as literal shell arguments',
    async () => {
      const executeWithRedirect = vi.mocked(
        (
          executor as {
            executeWithRedirect: typeof executor.executeWithRedirect;
          }
        ).executeWithRedirect
      );
      executeWithRedirect.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
        success: true,
      });
      const tests: ResolvedTest[] = [
        {
          index: 3,
          source: {
            kind: 'generator',
            generator: 'gen',
            args: ["O'Brien", '3)'],
            multiOutputs: null,
          },
        },
      ];

      await generator.executeResolvedTests(
        tests,
        [{ name: 'gen', source: 'gen.cpp' }],
        '/out'
      );

      const args = executeWithRedirect.mock.calls[0];
      expect(args[0]).toContain("'O'\\''Brien'");
      expect(args[0]).toContain("'3)'");
    }
  );

  it('throws when manual file is missing', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);
    const tests: ResolvedTest[] = [
      { index: 1, source: { kind: 'manual', inputFile: './m.in' } },
    ];
    await expect(
      generator.executeResolvedTests(tests, [], '/out')
    ).rejects.toThrow(/Some tests failed/);
  });
});

describe('resolveTestsetTests', () => {
  it('parses, validates, and resolves into indexed tests', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const ts: LocalTestset = {
      name: 'main',
      generatorScript: { script: 'gen 1 > 2\ngen 2 > $' },
      manualTests: [{ input: './m.in', index: 1 }],
    };
    const result = generator.resolveTestsetTests(ts, [
      { name: 'gen', source: 'gen.cpp' },
    ]);
    expect(result.map(t => t.index)).toEqual([1, 2, 3]);
    expect(result[0].source.kind).toBe('manual');
  });

  it('throws when the script references an undefined generator', () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    const ts: LocalTestset = {
      name: 'main',
      generatorScript: { script: 'bogus 1 > 1' },
    };
    expect(() => generator.resolveTestsetTests(ts, [])).toThrow(
      /"bogus".*not found/s
    );
  });
});
