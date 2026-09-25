/**
 * @fileoverview Content-addressed cache for compiled executables.
 *
 * Every C++ compile goes through {@link cachedCompile}. The cache key is a
 * SHA-256 over everything that decides the produced binary:
 *   - the compiler identity (`<compiler> --version`),
 *   - the path-independent flags (`-O2`, `-std=...`),
 *   - the source bytes,
 *   - the bytes of every local header reached through `#include "..."`
 *     (recursively; `testlib.h` included).
 *
 * On a hit the stored binary is copied to where the compiler would have
 * written it and the compiler is not invoked. Any change to one of the inputs
 * yields a new key, so stale binaries are never served. Entries live under
 * `<problem>/.polyman/cache/compiled/` as `<key>.bin` + `<key>.json`; the
 * metadata file's mtime records when the entry was last used and drives
 * eviction.
 *
 * The cache never makes a compile fail: if a key cannot be computed or the
 * store cannot be written, polyman compiles exactly as it would without it.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { executor } from '../executor';
import { fmt } from '../formatter';

/** Bumped whenever the key derivation or on-disk layout changes. */
export const CACHE_FORMAT_VERSION = 1;

/** Cache root, relative to the problem directory. */
export const CACHE_DIR = path.join('.polyman', 'cache');

/** Upper bound on the total size of cached binaries (256 MB). */
export const DEFAULT_MAX_CACHE_BYTES = 256 * 1024 * 1024;

/** Entries unused for longer than this are evicted (30 days). */
export const DEFAULT_MAX_ENTRY_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const COMPILER_PROBE_TIMEOUT_MS = 10000;
const STRAY_FILE_GRACE_MS = 60 * 60 * 1000;
const INCLUDE_PATTERN = /^\s*#\s*include\s*"([^"]+)"/gm;

/**
 * Everything the cache needs to know about one compilation.
 */
export interface CompileRequest {
  /** Absolute path of the source file. */
  sourcePath: string;
  /** Absolute path of the file the compiler writes (`.exe` on Windows). */
  binaryPath: string;
  /** Compiler executable, e.g. `g++`. */
  compiler: string;
  /** Flags that affect the binary and do not embed paths. */
  flags: string[];
  /**
   * Directories searched for `#include "..."` after the including file's own
   * directory (the `-iquote` dirs), in order.
   */
  includeDirs: string[];
}

/**
 * Metadata stored next to each cached binary.
 */
export interface CacheEntryMeta {
  formatVersion: number;
  key: string;
  /**
   * Source path relative to the problem directory, or `…/<dir>/<file>` when
   * it lies outside it. For display only.
   */
  source: string;
  compiler: string;
  flags: string[];
  sourceHash: string;
  /**
   * Local headers the source depends on, relative to the problem directory,
   * mapped to their SHA-256. Includes that did not resolve to a local file
   * map to null.
   */
  dependencies: Record<string, string | null>;
  binaryHash: string;
  binarySize: number;
  /** How long the compile that produced this entry took. */
  compileMs: number;
  createdAt: string;
}

/**
 * A cache entry as reported by {@link listCacheEntries}.
 */
export interface CacheEntry extends CacheEntryMeta {
  lastUsedAt: Date;
}

/**
 * Hit/miss counters for the current process.
 */
export interface CacheStats {
  hits: number;
  misses: number;
  /** Sum of the original compile times of every hit. */
  savedMs: number;
}

interface CacheKey {
  key: string;
  sourceHash: string;
  dependencies: Record<string, string | null>;
}

let enabled = true;
let stats: CacheStats = { hits: 0, misses: 0, savedMs: 0 };
const compilerIdentities = new Map<string, Promise<string>>();

/**
 * Turns the cache on or off for the rest of the process. When off, every
 * compile runs and nothing is read from or written to the cache.
 *
 * @param {boolean} value - Whether to use the cache
 */
export function setCacheEnabled(value: boolean): void {
  enabled = value;
}

/**
 * Whether compiles currently go through the cache.
 *
 * @returns {boolean} True unless disabled with `--no-cache`
 */
export function isCacheEnabled(): boolean {
  return enabled;
}

/**
 * Hit/miss counters accumulated since the process started (or since
 * {@link resetCompileCacheState}).
 *
 * @returns {CacheStats} A copy of the counters
 */
export function getCacheStats(): CacheStats {
  return { ...stats };
}

/**
 * Forgets per-process state: counters, remembered compiler identities, and
 * the enabled flag.
 */
export function resetCompileCacheState(): void {
  enabled = true;
  stats = { hits: 0, misses: 0, savedMs: 0 };
  compilerIdentities.clear();
}

/**
 * Absolute path of the directory holding cached binaries for the problem in
 * the current working directory.
 *
 * @returns {string} `<cwd>/.polyman/cache/compiled`
 */
export function getCompiledCacheDir(): string {
  return path.resolve(process.cwd(), CACHE_DIR, 'compiled');
}

function sha256(data: crypto.BinaryLike): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hashFile(filePath: string): string {
  return sha256(fs.readFileSync(filePath));
}

function toCacheRelative(filePath: string): string {
  return path.relative(process.cwd(), filePath).split(path.sep).join('/');
}

/**
 * Label for a source in `cache status`: its path relative to the problem
 * directory, or `…/<dir>/<file>` for a source outside it (standard checkers
 * compile from the package's `assets/`).
 */
function toDisplayPath(filePath: string): string {
  const relative = toCacheRelative(filePath);
  if (!relative.startsWith('../') && !path.isAbsolute(relative)) {
    return relative;
  }
  return `…/${relative.split('/').slice(-2).join('/')}`;
}

function resolveQuotedInclude(
  name: string,
  fromDir: string,
  includeDirs: string[]
): string | null {
  for (const dir of [fromDir, ...includeDirs]) {
    const candidate = path.resolve(dir, name);
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

/**
 * Finds every local header a source reaches through `#include "..."`,
 * following includes recursively. Each include is looked up in the including
 * file's directory first and then in `includeDirs`, mirroring g++ with
 * `-iquote`. Angle-bracket includes are system headers and are covered by
 * the compiler identity instead.
 *
 * The scan is textual: includes inside `#if` blocks or comments are counted
 * too, which can only cause an unnecessary recompile, never a stale binary.
 *
 * @param {string} sourcePath - Absolute path of the source file
 * @param {string[]} includeDirs - Extra quoted-include search directories
 * @returns {Record<string, string | null>} Dependency (relative to the
 *   problem directory, or the include spelling when it did not resolve) →
 *   SHA-256 of its contents, or null when it did not resolve
 *
 * @example
 * scanDependencies('/p/generators/gen.cpp', ['/p']);
 * // { 'testlib.h': 'a3f1...' }
 */
export function scanDependencies(
  sourcePath: string,
  includeDirs: string[]
): Record<string, string | null> {
  const dependencies: Record<string, string | null> = {};
  const visited = new Set<string>([path.resolve(sourcePath)]);
  const pending = [path.resolve(sourcePath)];

  while (pending.length > 0) {
    const file = pending.pop()!;
    const text = fs.readFileSync(file, 'utf-8');
    for (const match of text.matchAll(INCLUDE_PATTERN)) {
      const name = match[1];
      const resolved = resolveQuotedInclude(
        name,
        path.dirname(file),
        includeDirs
      );
      if (resolved === null) {
        dependencies[`unresolved:${name}`] = null;
        continue;
      }
      if (visited.has(resolved)) continue;
      visited.add(resolved);
      dependencies[toCacheRelative(resolved)] = hashFile(resolved);
      pending.push(resolved);
    }
  }

  return Object.fromEntries(
    Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b))
  );
}

/**
 * Identifies the compiler by its `--version` output, so upgrading or
 * switching compilers invalidates every entry. Probed once per compiler per
 * process.
 *
 * @param {string} compiler - Compiler executable, e.g. `g++`
 * @returns {Promise<string>} The `--version` output
 *
 * @throws {Error} If the compiler cannot be run or prints nothing
 */
export function getCompilerIdentity(compiler: string): Promise<string> {
  let identity = compilerIdentities.get(compiler);
  if (!identity) {
    identity = executor
      .execute(`${compiler} --version`, {
        timeout: COMPILER_PROBE_TIMEOUT_MS,
        silent: true,
      })
      .then(result => {
        const output = result.stdout.trim();
        if (!output) {
          throw new Error(`${compiler} --version printed nothing`);
        }
        return output;
      });
    compilerIdentities.set(compiler, identity);
  }
  return identity;
}

async function computeKey(request: CompileRequest): Promise<CacheKey> {
  const compilerIdentity = await getCompilerIdentity(request.compiler);
  const sourceHash = hashFile(request.sourcePath);
  const dependencies = scanDependencies(
    request.sourcePath,
    request.includeDirs
  );
  const key = sha256(
    JSON.stringify({
      formatVersion: CACHE_FORMAT_VERSION,
      compiler: request.compiler,
      compilerIdentity,
      // `--version` output can be identical across architectures.
      platform: process.platform,
      arch: process.arch,
      flags: request.flags,
      sourceHash,
      dependencies,
    })
  );
  return { key, sourceHash, dependencies };
}

function entryPaths(key: string): { bin: string; meta: string } {
  const dir = getCompiledCacheDir();
  return {
    bin: path.join(dir, `${key}.bin`),
    meta: path.join(dir, `${key}.json`),
  };
}

function removeEntry(key: string): void {
  const { bin, meta } = entryPaths(key);
  fs.rmSync(meta, { force: true });
  fs.rmSync(bin, { force: true });
}

function readMeta(metaPath: string): CacheEntryMeta | null {
  try {
    const meta = JSON.parse(
      fs.readFileSync(metaPath, 'utf-8')
    ) as CacheEntryMeta;
    return meta.formatVersion === CACHE_FORMAT_VERSION ? meta : null;
  } catch {
    return null;
  }
}

/**
 * Copies a cached binary to `binaryPath` when a valid entry exists. An entry
 * whose binary is missing or does not match its recorded hash is evicted.
 *
 * @returns The entry's metadata on a hit, null on a miss
 */
function restoreFromCache(
  key: string,
  binaryPath: string
): CacheEntryMeta | null {
  const { bin, meta: metaPath } = entryPaths(key);
  if (!fs.existsSync(metaPath)) return null;

  const meta = readMeta(metaPath);
  if (
    meta === null ||
    meta.key !== key ||
    !fs.existsSync(bin) ||
    hashFile(bin) !== meta.binaryHash
  ) {
    removeEntry(key);
    return null;
  }

  if (!fs.existsSync(binaryPath) || hashFile(binaryPath) !== meta.binaryHash) {
    fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
    fs.copyFileSync(bin, binaryPath);
    fs.chmodSync(binaryPath, 0o755);
  }

  const now = new Date();
  fs.utimesSync(metaPath, now, now);
  return meta;
}

/**
 * Writes a file atomically: concurrent compiles of the same source may race
 * to store the same entry, and a reader must never see a partial file.
 *
 * @param {string} target - Final path of the file
 * @param {(tmp: string) => void} write - Writes the contents to `tmp`
 */
export function writeAtomically(
  target: string,
  write: (tmp: string) => void
): void {
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    write(tmp);
    fs.renameSync(tmp, target);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function storeInCache(
  request: CompileRequest,
  cacheKey: CacheKey,
  compileMs: number
): void {
  const { bin, meta: metaPath } = entryPaths(cacheKey.key);
  fs.mkdirSync(path.dirname(bin), { recursive: true });

  const binary = fs.readFileSync(request.binaryPath);
  const meta: CacheEntryMeta = {
    formatVersion: CACHE_FORMAT_VERSION,
    key: cacheKey.key,
    source: toDisplayPath(request.sourcePath),
    compiler: request.compiler,
    flags: request.flags,
    sourceHash: cacheKey.sourceHash,
    dependencies: cacheKey.dependencies,
    binaryHash: sha256(binary),
    binarySize: binary.length,
    compileMs,
    createdAt: new Date().toISOString(),
  };

  // Binary first: an entry only counts once its metadata exists.
  writeAtomically(bin, tmp => fs.writeFileSync(tmp, binary));
  writeAtomically(metaPath, tmp =>
    fs.writeFileSync(tmp, `${JSON.stringify(meta, null, 2)}\n`)
  );
}

/**
 * Runs `compile` unless an up-to-date binary for `request` is cached, in
 * which case that binary is restored to `request.binaryPath` instead. After
 * a real compile the result is stored for next time and old entries are
 * pruned.
 *
 * Cache problems (unreadable files, a compiler that cannot report its
 * version, a read-only problem directory) never fail the compile; they only
 * mean the compile is not cached.
 *
 * @param {CompileRequest} request - What is being compiled and how
 * @param {() => Promise<void>} compile - Performs the real compilation and
 *   writes `request.binaryPath`
 * @returns {Promise<void>} Resolves once `request.binaryPath` is up to date
 *
 * @throws {Error} Whatever `compile` throws
 *
 * @example
 * await cachedCompile(
 *   { sourcePath, binaryPath, compiler: 'g++', flags: ['-O2'], includeDirs: [cwd] },
 *   () => executor.execute(command, { timeout: 10000, silent: true })
 * );
 */
export async function cachedCompile(
  request: CompileRequest,
  compile: () => Promise<unknown>
): Promise<void> {
  if (!enabled) {
    await compile();
    return;
  }

  let cacheKey: CacheKey | null = null;
  try {
    cacheKey = await computeKey(request);
    const hit = restoreFromCache(cacheKey.key, request.binaryPath);
    if (hit) {
      stats.hits++;
      stats.savedMs += hit.compileMs;
      return;
    }
  } catch {
    cacheKey = null;
  }

  // Counted before compiling so a compile that fails still shows as a miss.
  stats.misses++;
  const startedAt = Date.now();
  await compile();
  const compileMs = Date.now() - startedAt;

  if (cacheKey === null) return;
  try {
    // A source edited while the compiler ran would be stored under the key
    // of the old contents; skip storing rather than serve a stale binary.
    const after = await computeKey(request);
    if (after.key !== cacheKey.key) return;
    storeInCache(request, cacheKey, compileMs);
    pruneCache();
  } catch {
    // The binary is in place; failing to cache it is not an error.
  }
}

/**
 * Lists every valid entry in the current problem's cache, most recently
 * used first.
 *
 * @returns {CacheEntry[]} Cached entries
 */
export function listCacheEntries(): CacheEntry[] {
  const dir = getCompiledCacheDir();
  if (!fs.existsSync(dir)) return [];

  const entries: CacheEntry[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const metaPath = path.join(dir, file);
    const meta = readMeta(metaPath);
    if (meta === null) continue;
    entries.push({ ...meta, lastUsedAt: fs.statSync(metaPath).mtime });
  }
  return entries.sort(
    (a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime()
  );
}

/**
 * Evicts entries unused for longer than `maxAgeMs`, then the least recently
 * used entries until the cached binaries fit in `maxBytes`. Also removes
 * files that do not belong to a valid entry (orphaned binaries, metadata
 * from an older cache format).
 *
 * @param {Object} [options] - Limits
 * @param {number} [options.maxBytes] - Size budget for cached binaries
 * @param {number} [options.maxAgeMs] - Maximum time since last use
 * @param {number} [options.now] - Current time in ms (for tests)
 * @returns {number} Number of entries evicted
 */
export function pruneCache(
  options: { maxBytes?: number; maxAgeMs?: number; now?: number } = {}
): number {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_CACHE_BYTES;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_MAX_ENTRY_AGE_MS;
  const now = options.now ?? Date.now();
  const dir = getCompiledCacheDir();
  if (!fs.existsSync(dir)) return 0;

  const entries = listCacheEntries();
  const valid = new Set(entries.map(e => e.key));
  for (const file of fs.readdirSync(dir)) {
    const key = file.replace(/\.(bin|json)$/, '');
    if (valid.has(key)) continue;
    // A parallel compile writes its binary before its metadata; only sweep
    // stray files old enough that no compile can still be writing them.
    const filePath = path.join(dir, file);
    if (now - fs.statSync(filePath).mtimeMs > STRAY_FILE_GRACE_MS) {
      fs.rmSync(filePath, { force: true });
    }
  }

  let evicted = 0;
  let totalBytes = 0;
  // Most recently used first: keep entries while they fit.
  for (const entry of entries) {
    const tooOld = now - entry.lastUsedAt.getTime() > maxAgeMs;
    if (tooOld || totalBytes + entry.binarySize > maxBytes) {
      removeEntry(entry.key);
      evicted++;
    } else {
      totalBytes += entry.binarySize;
    }
  }
  return evicted;
}

/**
 * Deletes the current problem's whole cache directory.
 *
 * @returns {number} Number of entries that were removed
 */
export function clearCache(): number {
  const count = listCacheEntries().length;
  fs.rmSync(path.resolve(process.cwd(), CACHE_DIR), {
    recursive: true,
    force: true,
  });
  return count;
}

/**
 * Formats a byte count for humans.
 *
 * @param {number} bytes - Size in bytes
 * @returns {string} e.g. `512 B`, `1.5 KB`, `3.2 MB`
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Formats a duration for humans.
 *
 * @param {number} ms - Duration in milliseconds
 * @returns {string} e.g. `850ms`, `12.4s`
 */
export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Prints this process's cache hits, misses, and the compile time the hits
 * saved. Prints nothing if nothing was compiled or the cache is disabled.
 *
 * @example
 * logCacheSummary();
 * // ⚡ Compile cache: 5 hits, 1 miss · saved ~12.4s
 */
export function logCacheSummary(): void {
  const { hits, misses, savedMs } = stats;
  if (!enabled || hits + misses === 0) return;
  const hitText = `${hits} hit${hits === 1 ? '' : 's'}`;
  const missText = `${misses} miss${misses === 1 ? '' : 'es'}`;
  const saved = hits > 0 ? ` · saved ~${formatDuration(savedMs)}` : '';
  fmt.info(`  ⚡ Compile cache: ${hitText}, ${missText}${saved}`);
}
