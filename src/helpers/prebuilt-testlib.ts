/**
 * @fileoverview Compiles testlib once per problem and links it into every
 * program that includes it.
 *
 * Most of a testlib program's compile time is spent on testlib itself, not
 * on the program. The first compile that needs testlib splits the problem's
 * `testlib.h` (see `testlib-split.ts`) into a declarations-only header and
 * an implementation, and compiles the implementation into `testlib.o`:
 *
 * ```
 * .polyman/cache/testlib/<key>/
 *   testlib.h          declarations only; found first through -iquote
 *   testlib.impl.cpp   every definition
 *   testlib.o          compiled once, linked into each program
 * ```
 *
 * `key` covers the contents of `testlib.h`, the compiler, the flags, and the
 * platform, so editing testlib or changing `cppStandard` builds a new object.
 * The problem's `testlib.h` is never modified.
 *
 * A source is only linked against the object when it includes the
 * problem-root `testlib.h` before defining anything that could change how
 * testlib compiles. If the split is not possible, or a program fails to
 * compile or link against it while it compiles against the original header,
 * the split is marked unsupported for that key and polyman compiles against
 * the original header, as before.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { executor } from '../executor';
import {
  CACHE_DIR,
  DEFAULT_MAX_ENTRY_AGE_MS,
  getCompilerIdentity,
  isCacheEnabled,
  writeAtomically,
} from './compile-cache';
import { quoteShellArgument } from './shell';
import {
  SPLIT_FORMAT_VERSION,
  includesTestlibFirst,
  splitTestlib,
} from './testlib-split';

const TESTLIB = 'testlib.h';
const IMPLEMENTATION = 'testlib.impl.cpp';
const OBJECT = 'testlib.o';
const UNSUPPORTED = 'unsupported';

/**
 * Building the object is a one-time cost that can exceed the per-compile
 * timeout on slow machines, so it gets a longer one.
 */
const OBJECT_COMPILE_TIMEOUT_MS = 60000;

/**
 * A prebuilt testlib, ready to compile a program against.
 */
export interface PrebuiltTestlib {
  key: string;
  /** Holds the declarations-only `testlib.h`; goes first in `-iquote`. */
  includeDir: string;
  /** testlib's definitions, linked into the program. */
  objectPath: string;
}

/**
 * The compile that wants to use the prebuilt testlib.
 */
export interface PrebuiltTestlibRequest {
  /** Absolute path of the source being compiled. */
  sourcePath: string;
  /** Compiler executable, e.g. `g++`. */
  compiler: string;
  /** Flags the program is compiled with; the object uses the same. */
  flags: string[];
}

/**
 * A prebuilt testlib as reported by {@link listPrebuiltTestlibs}.
 */
export interface PrebuiltTestlibEntry {
  key: string;
  /** testlib's `VERSION`, when the header defines one. */
  version: string | null;
  objectSize: number;
  lastUsedAt: Date;
}

const prepared = new Map<string, Promise<PrebuiltTestlib | null>>();

function sha256(data: crypto.BinaryLike): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * Forgets which prebuilt objects this process has prepared.
 */
export function resetPrebuiltTestlibState(): void {
  prepared.clear();
}

/**
 * Absolute path of the directory holding prebuilt testlib objects for the
 * problem in the current working directory.
 *
 * @returns {string} `<cwd>/.polyman/cache/testlib`
 */
export function getPrebuiltTestlibDir(): string {
  return path.resolve(process.cwd(), CACHE_DIR, 'testlib');
}

function markUnsupported(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, UNSUPPORTED), '');
}

/** Removes prebuilt objects unused for longer than the cache's maximum age. */
function pruneOthers(keep: string): void {
  const root = getPrebuiltTestlibDir();
  const now = Date.now();
  for (const key of fs.readdirSync(root)) {
    if (key === keep) continue;
    const dir = path.join(root, key);
    const object = path.join(dir, OBJECT);
    const stamp = fs.existsSync(object) ? object : dir;
    if (now - fs.statSync(stamp).mtimeMs > DEFAULT_MAX_ENTRY_AGE_MS) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
}

async function prepare(
  key: string,
  testlib: string,
  request: PrebuiltTestlibRequest
): Promise<PrebuiltTestlib | null> {
  const dir = path.join(getPrebuiltTestlibDir(), key);
  const prebuilt: PrebuiltTestlib = {
    key,
    includeDir: dir,
    objectPath: path.join(dir, OBJECT),
  };
  const headerPath = path.join(dir, TESTLIB);

  if (fs.existsSync(path.join(dir, UNSUPPORTED))) return null;
  if (fs.existsSync(prebuilt.objectPath) && fs.existsSync(headerPath)) {
    const now = new Date();
    fs.utimesSync(prebuilt.objectPath, now, now);
    return prebuilt;
  }

  const split = splitTestlib(testlib);
  if (split === null) {
    markUnsupported(dir);
    return null;
  }

  fs.mkdirSync(dir, { recursive: true });
  const implementationPath = path.join(dir, IMPLEMENTATION);
  writeAtomically(implementationPath, tmp =>
    fs.writeFileSync(tmp, split.implementation)
  );
  writeAtomically(headerPath, tmp => fs.writeFileSync(tmp, split.header));

  const tmpObject = `${prebuilt.objectPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await executor.execute(
      [
        request.compiler,
        ...request.flags,
        '-c',
        '-o',
        quoteShellArgument(tmpObject),
        quoteShellArgument(implementationPath),
      ].join(' '),
      { timeout: OBJECT_COMPILE_TIMEOUT_MS, silent: true }
    );
    fs.renameSync(tmpObject, prebuilt.objectPath);
  } catch {
    markUnsupported(dir);
    return null;
  } finally {
    fs.rmSync(tmpObject, { force: true });
  }

  pruneOthers(key);
  return prebuilt;
}

/**
 * Returns the prebuilt testlib to compile `request.sourcePath` against,
 * building it on first use. Returns null when the source must be compiled
 * against the original header: the cache is disabled (`--no-cache`), the
 * source is not a testlib program, it has its own `testlib.h` next to it,
 * it defines something before including testlib, or testlib cannot be split.
 *
 * Never throws; any problem means "compile as usual".
 *
 * @param {PrebuiltTestlibRequest} request - The compile that wants it
 * @returns {Promise<PrebuiltTestlib | null>} The prebuilt testlib, or null
 *
 * @example
 * const prebuilt = await findPrebuiltTestlib({
 *   sourcePath: '/p/validator/val.cpp', compiler: 'g++', flags: ['-O2', '-std=c++23'],
 * });
 * // g++ -O2 -std=c++23 -iquote <prebuilt.includeDir> -iquote /p -o val <prebuilt.objectPath> val.cpp
 */
export async function findPrebuiltTestlib(
  request: PrebuiltTestlibRequest
): Promise<PrebuiltTestlib | null> {
  if (!isCacheEnabled()) return null;

  try {
    const root = process.cwd();
    const sourceDir = path.dirname(request.sourcePath);
    const testlibPath = path.join(root, TESTLIB);
    // g++ looks next to the including file before any -iquote directory, so
    // only a source that reaches the problem-root testlib.h through -iquote
    // can be pointed at the declarations-only copy.
    if (
      path.resolve(sourceDir) === path.resolve(root) ||
      fs.existsSync(path.join(sourceDir, TESTLIB)) ||
      !fs.existsSync(testlibPath) ||
      !includesTestlibFirst(fs.readFileSync(request.sourcePath, 'utf-8'))
    ) {
      return null;
    }

    const testlib = fs.readFileSync(testlibPath, 'utf-8');
    const key = sha256(
      JSON.stringify({
        formatVersion: SPLIT_FORMAT_VERSION,
        compiler: request.compiler,
        compilerIdentity: await getCompilerIdentity(request.compiler),
        platform: process.platform,
        arch: process.arch,
        flags: request.flags,
        testlib: sha256(testlib),
      })
    );

    // Programs compiled in parallel share one build of the object.
    let pending = prepared.get(key);
    if (!pending) {
      pending = prepare(key, testlib, request).catch(() => null);
      prepared.set(key, pending);
    }
    return await pending;
  } catch {
    return null;
  }
}

/**
 * Records that a program failed to build against `prebuilt` although it
 * builds against the original header, so the split is wrong for this
 * testlib; later compiles use the original header.
 *
 * @param {PrebuiltTestlib} prebuilt - The prebuilt testlib that failed
 */
export function markPrebuiltTestlibUnsupported(
  prebuilt: PrebuiltTestlib
): void {
  prepared.set(prebuilt.key, Promise.resolve(null));
  try {
    markUnsupported(prebuilt.includeDir);
  } catch {
    // Only this process will skip it; that is still correct.
  }
}

/**
 * Lists the prebuilt testlib objects of the current problem, most recently
 * used first.
 *
 * @returns {PrebuiltTestlibEntry[]} Prebuilt objects
 */
export function listPrebuiltTestlibs(): PrebuiltTestlibEntry[] {
  const root = getPrebuiltTestlibDir();
  if (!fs.existsSync(root)) return [];

  const entries: PrebuiltTestlibEntry[] = [];
  for (const key of fs.readdirSync(root)) {
    const object = path.join(root, key, OBJECT);
    const header = path.join(root, key, TESTLIB);
    if (!fs.existsSync(object) || !fs.existsSync(header)) continue;
    const stat = fs.statSync(object);
    const version = /#define\s+VERSION\s+"([^"]+)"/.exec(
      fs.readFileSync(header, 'utf-8')
    );
    entries.push({
      key,
      version: version?.[1] ?? null,
      objectSize: stat.size,
      lastUsedAt: stat.mtime,
    });
  }
  return entries.sort(
    (a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime()
  );
}
