/**
 * @fileoverview Runs an action in a chosen problem directory.
 *
 * Local commands read Config.json and problem files from the current working
 * directory. A command that accepts a directory uses this helper so the rest
 * of its code stays unchanged and keeps resolving paths against the cwd.
 */

import fs from 'fs';
import path from 'path';

import { PolymanError } from '../errors';

/**
 * Runs `action` with the process working directory set to `directory`.
 *
 * The directory is resolved against the current working directory. When
 * `directory` is omitted, `action` runs in the current directory. The original
 * working directory is restored even when `action` throws, so callers can be
 * used from long-running processes and tests as well as from the CLI.
 *
 * @param directory - Problem folder from the command line, or undefined
 * @param action - Work to run with that folder as the working directory
 * @returns Whatever `action` returns
 *
 * @throws {PolymanError} With exit code 2 if the path is not a directory
 *
 * @example
 * await runInDirectory('./my-problem', () => fullVerificationAction());
 */
export async function runInDirectory<T>(
  directory: string | undefined,
  action: () => Promise<T>
): Promise<T> {
  if (directory === undefined) {
    return action();
  }

  const target = path.resolve(process.cwd(), directory);
  if (!fs.existsSync(target)) {
    throw new PolymanError(`Directory not found: ${directory}`, 2);
  }
  if (!fs.statSync(target).isDirectory()) {
    throw new PolymanError(`Not a directory: ${directory}`, 2);
  }

  const previous = process.cwd();
  if (target === previous) {
    return action();
  }

  process.chdir(target);
  try {
    return await action();
  } finally {
    process.chdir(previous);
  }
}
