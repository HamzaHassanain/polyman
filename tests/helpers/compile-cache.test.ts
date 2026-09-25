import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { executor } from '../../src/executor';
import { fmt } from '../../src/formatter';
import * as cache from '../../src/helpers/compile-cache';
import type { CompileRequest } from '../../src/helpers/compile-cache';

vi.mock('../../src/executor');
vi.mock('../../src/formatter');

const executeMock = vi.mocked(executor)['execute'];
const fmtInfoMock = vi.mocked(fmt)['info'];

let tmpDir: string;
let cwdSpy: MockInstance<() => string>;

function write(relative: string, content: string): string {
  const file = path.join(tmpDir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

function request(overrides: Partial<CompileRequest> = {}): CompileRequest {
  return {
    sourcePath: path.join(tmpDir, 'solutions', 'main.cpp'),
    binaryPath: path.join(tmpDir, 'solutions', 'main'),
    compiler: 'g++',
    flags: ['-O2', '-std=c++23'],
    includeDirs: [tmpDir],
    ...overrides,
  };
}

/**
 * Stand-in for g++: writes a "binary" derived from the current source so a
 * restored binary can be told apart from a freshly compiled one.
 */
function fakeCompiler(req: CompileRequest = request()) {
  return vi.fn(() => {
    const source = fs.readFileSync(req.sourcePath, 'utf-8');
    fs.writeFileSync(req.binaryPath, `BINARY(${source})`);
    return Promise.resolve();
  });
}

function compilerVersion(stdout: string) {
  executeMock.mockResolvedValue({
    stdout,
    stderr: '',
    exitCode: 0,
    success: true,
  });
}

function cachedFiles(): string[] {
  const dir = cache.getCompiledCacheDir();
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

describe('compile-cache.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.resetCompileCacheState();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'polyman-cache-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tmpDir);
    compilerVersion('g++ (GCC) 13.2.0\n');
    write('testlib.h', '// testlib v1\n');
    write(
      'solutions/main.cpp',
      '#include "testlib.h"\n#include <bits/stdc++.h>\nint main() {}\n'
    );
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('cachedCompile', () => {
    it('compiles on a miss and restores the cached binary on a hit', async () => {
      const compile = fakeCompiler();

      await cache.cachedCompile(request(), compile);
      const built = fs.readFileSync(request().binaryPath, 'utf-8');
      fs.rmSync(request().binaryPath);

      await cache.cachedCompile(request(), compile);

      expect(compile).toHaveBeenCalledTimes(1);
      expect(fs.readFileSync(request().binaryPath, 'utf-8')).toBe(built);
      expect(cache.getCacheStats()).toMatchObject({ hits: 1, misses: 1 });
    });

    it('probes the compiler version once per process', async () => {
      await cache.cachedCompile(request(), fakeCompiler());
      await cache.cachedCompile(request(), fakeCompiler());

      expect(executeMock).toHaveBeenCalledTimes(1);
      expect(executeMock).toHaveBeenCalledWith(
        'g++ --version',
        expect.objectContaining({ silent: true })
      );
    });

    it('records the compile time and reports it as saved on a hit', async () => {
      const now = vi.spyOn(Date, 'now');
      now.mockReturnValueOnce(1000).mockReturnValueOnce(4500);
      await cache.cachedCompile(request(), fakeCompiler());
      now.mockRestore();

      await cache.cachedCompile(request(), fakeCompiler());

      expect(cache.getCacheStats().savedMs).toBe(3500);
      expect(cache.listCacheEntries()[0]?.compileMs).toBe(3500);
    });

    it('recompiles when the source changes', async () => {
      const compile = fakeCompiler();
      await cache.cachedCompile(request(), compile);

      write('solutions/main.cpp', '#include "testlib.h"\nint main() { }\n');
      await cache.cachedCompile(request(), compile);

      expect(compile).toHaveBeenCalledTimes(2);
    });

    it('recompiles when an included header changes', async () => {
      const compile = fakeCompiler();
      await cache.cachedCompile(request(), compile);

      write('testlib.h', '// testlib v2\n');
      await cache.cachedCompile(request(), compile);

      expect(compile).toHaveBeenCalledTimes(2);
    });

    it('recompiles when a nested local header changes', async () => {
      write('solutions/main.cpp', '#include "lib/a.h"\nint main() {}\n');
      write('solutions/lib/a.h', '#include "b.h"\n');
      write('solutions/lib/b.h', 'int b = 1;\n');
      const compile = fakeCompiler();
      await cache.cachedCompile(request(), compile);

      write('solutions/lib/b.h', 'int b = 2;\n');
      await cache.cachedCompile(request(), compile);

      expect(compile).toHaveBeenCalledTimes(2);
    });

    it('recompiles when the flags change', async () => {
      const compile = fakeCompiler();
      await cache.cachedCompile(request(), compile);
      await cache.cachedCompile(
        request({ flags: ['-O2', '-std=c++17'] }),
        compile
      );

      expect(compile).toHaveBeenCalledTimes(2);
    });

    it('recompiles when the compiler version changes', async () => {
      const compile = fakeCompiler();
      await cache.cachedCompile(request(), compile);

      cache.resetCompileCacheState();
      compilerVersion('g++ (GCC) 14.1.0\n');
      await cache.cachedCompile(request(), compile);

      expect(compile).toHaveBeenCalledTimes(2);
    });

    it('recompiles on a different architecture with the same compiler version', async () => {
      const compile = fakeCompiler();
      await cache.cachedCompile(request(), compile);

      const arch = process.arch;
      const otherArch = arch === 'arm64' ? 'x64' : 'arm64';
      Object.defineProperty(process, 'arch', { value: otherArch });
      try {
        await cache.cachedCompile(request(), compile);
      } finally {
        Object.defineProperty(process, 'arch', { value: arch });
      }

      expect(compile).toHaveBeenCalledTimes(2);
    });

    it('reuses a binary across sources with identical contents', async () => {
      const source = fs.readFileSync(request().sourcePath, 'utf-8');
      write('solutions/copy.cpp', source);
      const copy = request({
        sourcePath: path.join(tmpDir, 'solutions', 'copy.cpp'),
        binaryPath: path.join(tmpDir, 'solutions', 'copy'),
      });
      const compile = fakeCompiler();

      await cache.cachedCompile(request(), compile);
      await cache.cachedCompile(copy, fakeCompiler(copy));

      expect(compile).toHaveBeenCalledTimes(1);
      expect(fs.existsSync(copy.binaryPath)).toBe(true);
    });

    it('evicts a corrupted cached binary and recompiles', async () => {
      const compile = fakeCompiler();
      await cache.cachedCompile(request(), compile);
      const bin = cachedFiles().find(f => f.endsWith('.bin'))!;
      fs.writeFileSync(path.join(cache.getCompiledCacheDir(), bin), 'garbage');
      fs.rmSync(request().binaryPath);

      await cache.cachedCompile(request(), compile);

      expect(compile).toHaveBeenCalledTimes(2);
      expect(fs.readFileSync(request().binaryPath, 'utf-8')).toMatch(
        /^BINARY\(/
      );
    });

    it('replaces an output binary that differs from the cached one', async () => {
      const compile = fakeCompiler();
      await cache.cachedCompile(request(), compile);
      const built = fs.readFileSync(request().binaryPath, 'utf-8');
      fs.writeFileSync(request().binaryPath, 'stale');

      await cache.cachedCompile(request(), compile);

      expect(compile).toHaveBeenCalledTimes(1);
      expect(fs.readFileSync(request().binaryPath, 'utf-8')).toBe(built);
    });

    it('neither reads nor writes the cache when disabled', async () => {
      const compile = fakeCompiler();
      await cache.cachedCompile(request(), compile);

      cache.setCacheEnabled(false);
      await cache.cachedCompile(request(), compile);
      write('solutions/main.cpp', 'int main() { return 0; }\n');
      await cache.cachedCompile(request(), compile);

      expect(cache.isCacheEnabled()).toBe(false);
      expect(compile).toHaveBeenCalledTimes(3);
      expect(cache.listCacheEntries()).toHaveLength(1);
    });

    it('propagates compile errors, stores nothing, and counts a miss', async () => {
      const compile = vi.fn(() => Promise.reject(new Error('syntax error')));

      await expect(cache.cachedCompile(request(), compile)).rejects.toThrow(
        'syntax error'
      );
      expect(cachedFiles()).toEqual([]);
      expect(cache.getCacheStats()).toMatchObject({ hits: 0, misses: 1 });
    });

    it('falls back to compiling when the compiler version is unavailable', async () => {
      executeMock.mockRejectedValue(new Error('g++: not found'));
      const compile = fakeCompiler();

      await cache.cachedCompile(request(), compile);
      await cache.cachedCompile(request(), compile);

      expect(compile).toHaveBeenCalledTimes(2);
      expect(cachedFiles()).toEqual([]);
    });

    it('does not cache a binary whose source changed during compilation', async () => {
      const compile = vi.fn(() => {
        fs.writeFileSync(request().binaryPath, 'BINARY(old)');
        write('solutions/main.cpp', 'int main() { /* edited */ }\n');
        return Promise.resolve();
      });

      await cache.cachedCompile(request(), compile);

      expect(cachedFiles()).toEqual([]);
    });

    it('stores metadata describing the entry', async () => {
      await cache.cachedCompile(request(), fakeCompiler());

      const [entry] = cache.listCacheEntries();
      expect(entry).toMatchObject({
        formatVersion: cache.CACHE_FORMAT_VERSION,
        source: 'solutions/main.cpp',
        compiler: 'g++',
        flags: ['-O2', '-std=c++23'],
      });
      expect(Object.keys(entry.dependencies)).toEqual(['testlib.h']);
      expect(entry.binarySize).toBe(fs.statSync(request().binaryPath).size);
    });

    it('labels a source outside the problem directory by its last two segments', async () => {
      const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'polyman-assets-'));
      try {
        const sourcePath = path.join(outside, 'checkers', 'wcmp.cpp');
        fs.mkdirSync(path.dirname(sourcePath));
        fs.writeFileSync(sourcePath, '#include "testlib.h"\nint main() {}\n');
        const req = request({
          sourcePath,
          binaryPath: path.join(outside, 'checkers', 'wcmp'),
        });

        await cache.cachedCompile(req, fakeCompiler(req));

        expect(cache.listCacheEntries()[0]?.source).toBe('…/checkers/wcmp.cpp');
      } finally {
        fs.rmSync(outside, { recursive: true, force: true });
      }
    });
  });

  describe('scanDependencies', () => {
    it('prefers the including file directory over the include dirs', () => {
      write('solutions/testlib.h', '// local copy\n');

      const deps = cache.scanDependencies(request().sourcePath, [tmpDir]);

      expect(Object.keys(deps)).toEqual(['solutions/testlib.h']);
    });

    it('records includes that do not resolve to a local file', () => {
      write('solutions/main.cpp', '#include "nowhere.h"\nint main() {}\n');

      expect(cache.scanDependencies(request().sourcePath, [tmpDir])).toEqual({
        'unresolved:nowhere.h': null,
      });
    });

    it('ignores angle-bracket includes', () => {
      write('solutions/main.cpp', '#include <testlib.h>\nint main() {}\n');

      expect(cache.scanDependencies(request().sourcePath, [tmpDir])).toEqual(
        {}
      );
    });

    it('terminates on include cycles', () => {
      write('solutions/main.cpp', '#include "a.h"\n');
      write('solutions/a.h', '#include "b.h"\n');
      write('solutions/b.h', '#include "a.h"\n#include "main.cpp"\n');

      expect(
        Object.keys(cache.scanDependencies(request().sourcePath, [tmpDir]))
      ).toEqual(['solutions/a.h', 'solutions/b.h']);
    });
  });

  describe('pruneCache', () => {
    async function cacheSources(names: string[]): Promise<void> {
      for (const name of names) {
        write(`solutions/${name}.cpp`, `int ${name};\n`);
        const req = request({
          sourcePath: path.join(tmpDir, 'solutions', `${name}.cpp`),
          binaryPath: path.join(tmpDir, 'solutions', name),
        });
        await cache.cachedCompile(req, fakeCompiler(req));
      }
    }

    function setLastUsed(source: string, when: Date): void {
      const entry = cache.listCacheEntries().find(e => e.source === source)!;
      const meta = path.join(cache.getCompiledCacheDir(), `${entry.key}.json`);
      fs.utimesSync(meta, when, when);
    }

    it('evicts least recently used entries beyond the size budget', async () => {
      await cacheSources(['a', 'b', 'c']);
      setLastUsed('solutions/a.cpp', new Date('2026-01-03'));
      setLastUsed('solutions/b.cpp', new Date('2026-01-01'));
      setLastUsed('solutions/c.cpp', new Date('2026-01-02'));
      const size = cache.listCacheEntries()[0].binarySize;

      const evicted = cache.pruneCache({
        maxBytes: size * 2,
        now: new Date('2026-01-04').getTime(),
      });

      expect(evicted).toBe(1);
      expect(
        cache
          .listCacheEntries()
          .map(e => e.source)
          .sort()
      ).toEqual(['solutions/a.cpp', 'solutions/c.cpp']);
    });

    it('evicts entries unused for longer than the maximum age', async () => {
      await cacheSources(['a', 'b']);
      setLastUsed('solutions/a.cpp', new Date('2026-01-01'));
      setLastUsed('solutions/b.cpp', new Date('2026-03-01'));

      cache.pruneCache({
        maxAgeMs: 7 * 24 * 60 * 60 * 1000,
        now: new Date('2026-03-02').getTime(),
      });

      expect(cache.listCacheEntries().map(e => e.source)).toEqual([
        'solutions/b.cpp',
      ]);
    });

    it('sweeps old stray files but keeps fresh ones', async () => {
      await cacheSources(['a']);
      const dir = cache.getCompiledCacheDir();
      const old = path.join(dir, 'orphan.bin');
      const fresh = path.join(dir, 'in-flight.bin');
      fs.writeFileSync(old, 'x');
      fs.writeFileSync(fresh, 'x');
      const longAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      fs.utimesSync(old, longAgo, longAgo);

      cache.pruneCache();

      expect(fs.existsSync(old)).toBe(false);
      expect(fs.existsSync(fresh)).toBe(true);
      expect(cache.listCacheEntries()).toHaveLength(1);
    });

    it('does nothing without a cache directory', () => {
      expect(cache.pruneCache()).toBe(0);
    });
  });

  describe('listCacheEntries / clearCache', () => {
    it('returns nothing without a cache directory', () => {
      expect(cache.listCacheEntries()).toEqual([]);
    });

    it('skips metadata from another cache format', async () => {
      await cache.cachedCompile(request(), fakeCompiler());
      const dir = cache.getCompiledCacheDir();
      fs.writeFileSync(
        path.join(dir, 'old.json'),
        JSON.stringify({ formatVersion: 0 })
      );
      fs.writeFileSync(path.join(dir, 'broken.json'), '{');

      expect(cache.listCacheEntries()).toHaveLength(1);
    });

    it('clearCache removes the whole cache and reports the count', async () => {
      await cache.cachedCompile(request(), fakeCompiler());

      expect(cache.clearCache()).toBe(1);
      expect(fs.existsSync(path.join(tmpDir, cache.CACHE_DIR))).toBe(false);
      expect(cache.clearCache()).toBe(0);
    });
  });

  describe('formatting', () => {
    it('formatBytes', () => {
      expect(cache.formatBytes(512)).toBe('512 B');
      expect(cache.formatBytes(1536)).toBe('1.5 KB');
      expect(cache.formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    });

    it('formatDuration', () => {
      expect(cache.formatDuration(850)).toBe('850ms');
      expect(cache.formatDuration(12_400)).toBe('12.4s');
    });

    it('logCacheSummary prints hits, misses and time saved', async () => {
      const now = vi.spyOn(Date, 'now');
      now.mockReturnValueOnce(0).mockReturnValueOnce(2000);
      await cache.cachedCompile(request(), fakeCompiler());
      now.mockRestore();
      await cache.cachedCompile(request(), fakeCompiler());

      cache.logCacheSummary();

      expect(fmtInfoMock).toHaveBeenCalledWith(
        '  ⚡ Compile cache: 1 hit, 1 miss · saved ~2.0s'
      );
    });

    it('logCacheSummary is silent when nothing was compiled', () => {
      cache.logCacheSummary();
      expect(fmtInfoMock).not.toHaveBeenCalled();
    });

    it('logCacheSummary is silent when the cache is disabled', async () => {
      cache.setCacheEnabled(false);
      await cache.cachedCompile(request(), fakeCompiler());
      cache.logCacheSummary();
      expect(fmtInfoMock).not.toHaveBeenCalled();
    });
  });
});
