import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PolymanError } from '../../src/errors';
import { runInDirectory } from '../../src/helpers/directory';

describe('runInDirectory', () => {
  const originalCwd = process.cwd();
  let temp: string;

  beforeEach(() => {
    temp = fs.mkdtempSync(path.join(os.tmpdir(), 'polyman-directory-'));
  });

  afterEach(() => {
    process.chdir(originalCwd);
    fs.rmSync(temp, { recursive: true, force: true });
  });

  it('runs the action in the current directory when no directory is given', async () => {
    const action = vi.fn(() => Promise.resolve(process.cwd()));

    await expect(runInDirectory(undefined, action)).resolves.toBe(originalCwd);
    expect(action).toHaveBeenCalledOnce();
    expect(process.cwd()).toBe(originalCwd);
  });

  it('runs the action in the given directory and restores the cwd', async () => {
    const target = path.join(temp, 'problem');
    fs.mkdirSync(target);
    let cwdDuringAction = '';

    const result = await runInDirectory(target, () => {
      cwdDuringAction = process.cwd();
      return Promise.resolve(42);
    });

    expect(cwdDuringAction).toBe(target);
    expect(result).toBe(42);
    expect(process.cwd()).toBe(originalCwd);
  });

  it('accepts a relative directory', async () => {
    const target = path.join(temp, 'relative-problem');
    fs.mkdirSync(target);

    await runInDirectory(path.relative(originalCwd, target), () => {
      expect(process.cwd()).toBe(target);
      return Promise.resolve();
    });
    expect(process.cwd()).toBe(originalCwd);
  });

  it('restores the cwd when the action throws', async () => {
    const target = path.join(temp, 'broken');
    fs.mkdirSync(target);
    const failure = new Error('verify failed');

    await expect(
      runInDirectory(target, () => Promise.reject(failure))
    ).rejects.toBe(failure);
    expect(process.cwd()).toBe(originalCwd);
  });

  it('fails with exit code 2 when the directory does not exist', async () => {
    const action = vi.fn(() => Promise.resolve());
    const missing = path.join(temp, 'missing');

    await expect(runInDirectory(missing, action)).rejects.toMatchObject({
      name: 'PolymanError',
      exitCode: 2,
      message: `Directory not found: ${missing}`,
    } satisfies Partial<PolymanError>);
    expect(action).not.toHaveBeenCalled();
    expect(process.cwd()).toBe(originalCwd);
  });

  it('fails with exit code 2 when the path is a file', async () => {
    const file = path.join(temp, 'not-a-dir.txt');
    fs.writeFileSync(file, '');

    await expect(
      runInDirectory(file, () => Promise.resolve())
    ).rejects.toBeInstanceOf(PolymanError);
    expect(process.cwd()).toBe(originalCwd);
  });
});
