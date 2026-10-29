/**
 * Keeps every file access of a tool inside the problem folder.
 *
 * Paths are checked by their real path (symlinks followed), so a symlink
 * that points outside is outside. Some files are never written by tools:
 * the polyman cache, the saved sessions and `testlib.h`. In a workflow the
 * sandbox also gets the files the task owns, and refuses any other write.
 */

import * as fs from 'fs';
import * as path from 'path';
import { SandboxError, type Sandbox } from './types';

/** Options of a {@link FolderSandbox}. */
export interface FolderSandboxOptions {
  /**
   * The only files a write may touch, relative to the root, like the
   * `ownsFiles` of a workflow task. `*` matches inside one segment and a
   * trailing `/**` matches anything below a folder.
   */
  allowWrite?: string[];
}

/** Folders (relative, `/` separated) that tools never write into. */
const PROTECTED_DIRS = ['.polyman/cache', '.polyman/agent/sessions'];

/** How many symlinks we follow for one path before we give up. */
const MAX_LINKS = 40;

/** A {@link Sandbox} for one problem folder. */
export class FolderSandbox implements Sandbox {
  readonly root: string;
  private readonly allowWrite: string[] | undefined;
  private readonly allowPatterns: RegExp[] | undefined;

  constructor(root: string, opts: FolderSandboxOptions = {}) {
    const absolute = path.resolve(root);
    try {
      this.root = fs.realpathSync.native(absolute);
    } catch {
      this.root = absolute;
    }
    if (opts.allowWrite !== undefined) {
      this.allowWrite = opts.allowWrite.map(normalizePattern);
      this.allowPatterns = this.allowWrite.map(globToRegExp);
    }
  }

  async resolve(userPath: string, mode: 'read' | 'write'): Promise<string> {
    if (userPath.includes('\0')) {
      throw new SandboxError(`${userPath} is not a valid path`);
    }
    const realRoot = await realpathOrSelf(this.root);
    const real = await realpathMissingOk(
      path.resolve(realRoot, userPath),
      userPath
    );

    if (!isInside(realRoot, real)) {
      throw new SandboxError(`${userPath} is outside the problem folder`);
    }
    if (mode === 'read') return real;

    const rel = path.relative(realRoot, real).split(path.sep).join('/');
    const reason = protectedReason(rel);
    if (reason !== undefined) {
      throw new SandboxError(`${userPath} cannot be written: ${reason}`);
    }
    if (
      this.allowWrite !== undefined &&
      this.allowPatterns !== undefined &&
      !this.allowPatterns.some(re => re.test(rel))
    ) {
      const list =
        this.allowWrite.length > 0 ? this.allowWrite.join(', ') : '(none)';
      throw new SandboxError(
        `${userPath} is not one of the files this task owns: ${list}`
      );
    }
    return real;
  }
}

/** True when `real` is `root` or below it. `/x/pairs-evil` is not in `/x/pairs`. */
function isInside(root: string, real: string): boolean {
  if (real === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return real.startsWith(prefix);
}

/** Why a write to `rel` is refused, or undefined when it is allowed. */
function protectedReason(rel: string): string | undefined {
  // Lower case, so `.Polyman/Cache` on a case-insensitive disk is refused too.
  const lower = rel.toLowerCase();
  for (const dir of PROTECTED_DIRS) {
    if (lower === dir || lower.startsWith(dir + '/')) {
      return `${dir}/ is managed by polyman`;
    }
  }
  if (path.posix.basename(lower) === 'testlib.h') {
    return 'testlib.h is the upstream testlib, do not change it';
  }
  return undefined;
}

async function realpathOrSelf(p: string): Promise<string> {
  try {
    return await fs.promises.realpath(p);
  } catch {
    return p;
  }
}

/**
 * The real path of `absolute`, also when it does not exist yet: the nearest
 * existing parent is resolved and the missing part is added back. A dangling
 * symlink is followed to its target, so writing through it is checked too.
 */
async function realpathMissingOk(
  absolute: string,
  userPath: string
): Promise<string> {
  let current = absolute;
  const missing: string[] = [];
  let links = 0;

  for (;;) {
    try {
      const real = await fs.promises.realpath(current);
      return missing.length > 0 ? path.join(real, ...missing) : real;
    } catch (err) {
      const code = errorCode(err);
      if (code !== 'ENOENT' && code !== 'ENOTDIR') {
        throw new SandboxError(
          `${userPath} cannot be resolved (${code ?? 'unknown error'})`
        );
      }
    }

    const target = await readDanglingLink(current);
    if (target !== undefined) {
      if (++links > MAX_LINKS) {
        throw new SandboxError(`${userPath} has too many symlinks`);
      }
      current = path.resolve(path.dirname(current), target);
      continue;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      // Nothing exists, not even the file system root.
      return path.join(current, ...missing);
    }
    missing.unshift(path.basename(current));
    current = parent;
  }
}

/** The target of `p` when it is a symlink, else undefined. */
async function readDanglingLink(p: string): Promise<string | undefined> {
  try {
    const stat = await fs.promises.lstat(p);
    if (!stat.isSymbolicLink()) return undefined;
    return await fs.promises.readlink(p);
  } catch {
    return undefined;
  }
}

function errorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = err.code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

function normalizePattern(pattern: string): string {
  let p = pattern.split('\\').join('/');
  while (p.startsWith('./')) p = p.slice(2);
  return p;
}

/** `*` matches inside one segment, a trailing `/**` matches anything below. */
function globToRegExp(pattern: string): RegExp {
  let base = pattern;
  let below = '';
  if (base.endsWith('/**')) {
    base = base.slice(0, -3);
    below = '/.+';
  }
  const body = base
    .split('*')
    .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[^/]*');
  return new RegExp(`^${body}${below}$`);
}
