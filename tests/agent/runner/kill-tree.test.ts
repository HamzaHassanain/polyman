import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { killTree } from '../../../src/agent/runner/kill-tree';

const FAKE_CLI = path.join(__dirname, '..', 'fixtures', 'fake-cli.mjs');

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-kill-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check: () => boolean, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return check();
}

/** Starts the fake CLI as a group leader and waits for its grandchild. */
async function startGroup(
  extra: string[]
): Promise<{ pid: number; grandchild: number; exited: Promise<void> }> {
  const pidFile = path.join(dir, 'grandchild.pid');
  const child = spawn(
    process.execPath,
    [FAKE_CLI, ...extra, `child:${pidFile}`, 'out:ready', 'sleep:30000'],
    { detached: true, stdio: ['ignore', 'pipe', 'ignore'] }
  );
  const exited = new Promise<void>(resolve =>
    child.on('exit', () => resolve())
  );
  await new Promise<void>(resolve => {
    child.stdout.on('data', () => resolve());
  });
  const grandchild = Number(fs.readFileSync(pidFile, 'utf8'));
  return { pid: child.pid!, grandchild, exited };
}

describe.skipIf(process.platform === 'win32')('killTree (POSIX)', () => {
  it('kills the group with SIGTERM', async () => {
    const group = await startGroup([]);
    await killTree(group.pid, 2000);
    await group.exited;
    expect(await waitFor(() => !isAlive(group.grandchild))).toBe(true);
  }, 15000);

  it('uses SIGKILL when SIGTERM is ignored', async () => {
    const group = await startGroup(['ignore-term']);
    const started = Date.now();
    await killTree(group.pid, 300);
    await group.exited;
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(await waitFor(() => !isAlive(group.grandchild))).toBe(true);
  }, 15000);

  it('ignores a process that is already gone', async () => {
    const group = await startGroup([]);
    await killTree(group.pid, 1000);
    await group.exited;
    await expect(killTree(group.pid, 100)).resolves.toBeUndefined();
  }, 15000);
});
