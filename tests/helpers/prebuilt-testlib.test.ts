import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { executor } from '../../src/executor';
import {
  resetCompileCacheState,
  setCacheEnabled,
} from '../../src/helpers/compile-cache';
import * as prebuilt from '../../src/helpers/prebuilt-testlib';
import type { PrebuiltTestlibRequest } from '../../src/helpers/prebuilt-testlib';
import { MINI_TESTLIB } from './mini-testlib';

vi.mock('../../src/executor');
vi.mock('../../src/formatter');

const executeMock = vi.mocked(executor)['execute'];

let tmpDir: string;
let cwdSpy: MockInstance<() => string>;

function write(relative: string, content: string): string {
  const file = path.join(tmpDir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function request(
  overrides: Partial<PrebuiltTestlibRequest> = {}
): PrebuiltTestlibRequest {
  return {
    sourcePath: path.join(tmpDir, 'validator', 'val.cpp'),
    compiler: 'g++',
    flags: ['-O2', '-std=c++23'],
    ...overrides,
  };
}

/** Commands that built an object (not `g++ --version`). */
function objectBuilds(): string[] {
  return executeMock.mock.calls
    .map(([command]) => command)
    .filter(command => command.includes(' -c '));
}

/**
 * Stand-in for g++: answers `--version` and "compiles" by writing the `-o`
 * file.
 */
function fakeCompiler(options: { failObject?: boolean } = {}) {
  executeMock.mockImplementation((command: string) => {
    if (command.endsWith('--version')) {
      return Promise.resolve({
        stdout: 'g++ (GCC) 13.2.0',
        stderr: '',
        exitCode: 0,
        success: true,
      });
    }
    if (options.failObject) return Promise.reject(new Error('cc1plus: error'));
    const output = /-o ('[^']+'|"[^"]+")/.exec(command)?.[1] ?? '';
    fs.writeFileSync(output.slice(1, -1), 'OBJECT');
    return Promise.resolve({
      stdout: '',
      stderr: '',
      exitCode: 0,
      success: true,
    });
  });
}

describe('prebuilt-testlib.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCompileCacheState();
    prebuilt.resetPrebuiltTestlibState();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'polyman-prebuilt-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    write('testlib.h', MINI_TESTLIB);
    write('validator/val.cpp', '#include "testlib.h"\nint main() {}\n');
    fakeCompiler();
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('findPrebuiltTestlib', () => {
    it('builds the object once and writes the split header', async () => {
      const result = await prebuilt.findPrebuiltTestlib(request());

      expect(result).not.toBeNull();
      expect(fs.readFileSync(result!.objectPath, 'utf-8')).toBe('OBJECT');
      const header = fs.readFileSync(
        path.join(result!.includeDir, 'testlib.h'),
        'utf-8'
      );
      expect(header).toContain('int nextId();');
      expect(objectBuilds()).toEqual([
        expect.stringMatching(
          /^g\+\+ -O2 -std=c\+\+23 -c -o .*testlib\.impl\.cpp'?"?$/
        ),
      ]);
    });

    it('reuses the object in later compiles and later processes', async () => {
      const first = await prebuilt.findPrebuiltTestlib(request());
      write('checker/chk.cpp', '#include "testlib.h"\nint main() {}\n');
      await prebuilt.findPrebuiltTestlib(
        request({ sourcePath: path.join(tmpDir, 'checker', 'chk.cpp') })
      );
      prebuilt.resetPrebuiltTestlibState();
      const later = await prebuilt.findPrebuiltTestlib(request());

      expect(later).toEqual(first);
      expect(objectBuilds()).toHaveLength(1);
    });

    it('builds once for compiles that run in parallel', async () => {
      const results = await Promise.all([
        prebuilt.findPrebuiltTestlib(request()),
        prebuilt.findPrebuiltTestlib(request()),
        prebuilt.findPrebuiltTestlib(request()),
      ]);

      expect(new Set(results.map(r => r?.objectPath)).size).toBe(1);
      expect(objectBuilds()).toHaveLength(1);
    });

    it('builds a new object when testlib.h or the flags change', async () => {
      const first = await prebuilt.findPrebuiltTestlib(request());
      write('testlib.h', `${MINI_TESTLIB}\n// edited\n`);
      const edited = await prebuilt.findPrebuiltTestlib(request());
      const cxx17 = await prebuilt.findPrebuiltTestlib(
        request({ flags: ['-O2', '-std=c++17'] })
      );

      expect(new Set([first?.key, edited?.key, cxx17?.key]).size).toBe(3);
      expect(objectBuilds()).toHaveLength(3);
    });

    it.each([
      [
        'the source defines something before including testlib',
        () =>
          write('validator/val.cpp', '#define EJUDGE\n#include "testlib.h"\n'),
      ],
      [
        'the source has its own testlib.h next to it',
        () => write('validator/testlib.h', MINI_TESTLIB),
      ],
      [
        'the problem has no testlib.h',
        () => fs.rmSync(path.join(tmpDir, 'testlib.h')),
      ],
      ['the cache is disabled', () => setCacheEnabled(false)],
    ])('returns null when %s', async (_name, arrange) => {
      arrange();

      expect(await prebuilt.findPrebuiltTestlib(request())).toBeNull();
      expect(objectBuilds()).toEqual([]);
    });

    it('returns null for a source in the problem root', async () => {
      write('main.cpp', '#include "testlib.h"\nint main() {}\n');

      expect(
        await prebuilt.findPrebuiltTestlib(
          request({ sourcePath: path.join(tmpDir, 'main.cpp') })
        )
      ).toBeNull();
    });

    it('marks a testlib it cannot split and stops trying', async () => {
      write('testlib.h', 'namespace testlib { void f() {} }\n');

      expect(await prebuilt.findPrebuiltTestlib(request())).toBeNull();
      prebuilt.resetPrebuiltTestlibState();
      expect(await prebuilt.findPrebuiltTestlib(request())).toBeNull();
      expect(objectBuilds()).toEqual([]);
    });

    it('marks a testlib whose object fails to compile and stops trying', async () => {
      fakeCompiler({ failObject: true });

      expect(await prebuilt.findPrebuiltTestlib(request())).toBeNull();
      prebuilt.resetPrebuiltTestlibState();
      expect(await prebuilt.findPrebuiltTestlib(request())).toBeNull();
      expect(objectBuilds()).toHaveLength(1);
    });

    it('returns null when the compiler version is unavailable', async () => {
      executeMock.mockRejectedValue(new Error('g++: not found'));

      expect(await prebuilt.findPrebuiltTestlib(request())).toBeNull();
    });

    it('removes prebuilt objects unused for longer than the maximum age', async () => {
      const old = await prebuilt.findPrebuiltTestlib(request());
      const longAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      fs.utimesSync(old!.objectPath, longAgo, longAgo);

      write('testlib.h', `${MINI_TESTLIB}\n// v2\n`);
      await prebuilt.findPrebuiltTestlib(request());

      expect(fs.existsSync(old!.includeDir)).toBe(false);
    });
  });

  describe('markPrebuiltTestlibUnsupported', () => {
    it('makes this and later processes use the original header', async () => {
      const result = await prebuilt.findPrebuiltTestlib(request());
      prebuilt.markPrebuiltTestlibUnsupported(result!);

      expect(await prebuilt.findPrebuiltTestlib(request())).toBeNull();
      prebuilt.resetPrebuiltTestlibState();
      expect(await prebuilt.findPrebuiltTestlib(request())).toBeNull();
    });
  });

  describe('listPrebuiltTestlibs', () => {
    it('returns nothing without a cache directory', () => {
      expect(prebuilt.listPrebuiltTestlibs()).toEqual([]);
    });

    it('lists built objects with their testlib version', async () => {
      const result = await prebuilt.findPrebuiltTestlib(request());

      expect(prebuilt.listPrebuiltTestlibs()).toEqual([
        expect.objectContaining({
          key: result!.key,
          version: '0.9.99',
          objectSize: 'OBJECT'.length,
        }),
      ]);
    });
  });
});
