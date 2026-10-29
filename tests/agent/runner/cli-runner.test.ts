import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NodeCliRunner,
  TAIL_END_CHARS,
  TAIL_HEAD_CHARS,
  defaultLogDir,
  stripAnsi,
} from '../../../src/agent/runner/cli-runner';
import type { RunOptions } from '../../../src/agent/runner/types';

const FAKE_CLI = path.join(__dirname, '..', 'fixtures', 'fake-cli.mjs');

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pm-runner-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function options(extra: Partial<RunOptions> = {}): RunOptions {
  return {
    cwd: dir,
    timeoutMs: 20000,
    signal: new AbortController().signal,
    ...extra,
  };
}

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

describe('NodeCliRunner', () => {
  const runner = new NodeCliRunner({ cliPath: FAKE_CLI });

  it('returns the output and the exit code', async () => {
    const result = await runner.run(
      ['out:hello', 'err:warn 1', 'exit:1'],
      options()
    );
    expect(result.exitCode).toBe(1);
    expect(result.reason).toBe('exited');
    expect(result.stdoutTail).toBe('hello\n');
    expect(result.stderrTail).toBe('warn 1\n');
    expect(result.json).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('sends stderr lines, and stdout lines without --json, to onLine', async () => {
    const lines: string[] = [];
    await runner.run(
      ['out:a', 'err:b', 'ansi', 'raw:no newline'],
      options({ onLine: line => lines.push(line) })
    );
    expect(lines).toEqual(['a', 'b', 'red line', 'no newline']);

    const jsonLines: string[] = [];
    await runner.run(
      ['out:{}', 'err:progress', '--json'],
      options({ onLine: line => jsonLines.push(line) })
    );
    expect(jsonLines).toEqual(['progress']);
  });

  it('parses stdout with --json, and leaves bad JSON undefined', async () => {
    const good = await runner.run(
      ['out:{"ok": true, "n": 3}', 'err:human output', '--json'],
      options()
    );
    expect(good.json).toEqual({ ok: true, n: 3 });

    const bad = await runner.run(['out:{not json', '--json'], options());
    expect(bad.json).toBeUndefined();
    expect(bad.exitCode).toBe(0);
  });

  it('sets the agent environment and the folder', async () => {
    const result = await runner.run(['env', '--json'], options());
    expect(result.json).toEqual({
      POLYMAN_AGENT: '1',
      NO_COLOR: '1',
      FORCE_COLOR: '0',
      cwd: fs.realpathSync(dir),
    });
  });

  it('cuts long tails to the start and the end', async () => {
    const size = 100_000;
    const result = await runner.run(
      [`big:${size}`, `bigerr:${size}`],
      options()
    );
    for (const tail of [result.stdoutTail, result.stderrTail]) {
      expect(tail).toContain('characters cut, see the full log');
      expect(tail.length).toBeLessThan(TAIL_HEAD_CHARS + TAIL_END_CHARS + 200);
      expect(tail.startsWith('xxxx')).toBe(true);
      expect(tail.endsWith('x\n')).toBe(true);
    }
    // The log keeps everything.
    const log = fs.readFileSync(result.logPath, 'utf8');
    expect(log.length).toBeGreaterThan(2 * size);
  });

  it('keeps a short output whole, and strips ANSI codes', async () => {
    const result = await runner.run([`bigerr:10000`, 'ansi'], options());
    expect(result.stderrTail).not.toContain('cut');
    expect(result.stderrTail.endsWith('red line\n')).toBe(true);
    expect(result.stderrTail.length).toBe(10000 + 'red line\n'.length);
  });

  it('writes the full log under .polyman/agent/logs', async () => {
    const result = await runner.run(
      ['verify', 'out:{}', 'err:step 1', '--json'],
      options()
    );
    expect(path.dirname(result.logPath)).toBe(defaultLogDir(dir));
    expect(path.basename(result.logPath)).toMatch(/-verify\.log$/);
    const log = fs.readFileSync(result.logPath, 'utf8');
    expect(log).toContain('$ polyman verify');
    expect(log).toContain('step 1');
    expect(log).toContain('--- exit 0, exited');
  });

  it('uses a custom log folder', async () => {
    const logs = path.join(dir, 'my-logs');
    const custom = new NodeCliRunner({ cliPath: FAKE_CLI, logDir: () => logs });
    const result = await custom.run(['out:x'], options());
    expect(path.dirname(result.logPath)).toBe(logs);
  });

  it('kills the child and its child on timeout', async () => {
    const pidFile = path.join(dir, 'grandchild.pid');
    const result = await runner.run(
      [`child:${pidFile}`, 'out:started', 'sleep:30000'],
      options({ timeoutMs: 1000 })
    );
    expect(result.reason).toBe('timeout');
    expect(result.stdoutTail).toContain('started');
    expect(result.durationMs).toBeLessThan(10000);
    const grandchild = Number(fs.readFileSync(pidFile, 'utf8'));
    expect(grandchild).toBeGreaterThan(0);
    expect(await waitFor(() => !isAlive(grandchild))).toBe(true);
  }, 20000);

  it('kills the run when the signal aborts', async () => {
    const controller = new AbortController();
    const pidFile = path.join(dir, 'grandchild.pid');
    setTimeout(() => controller.abort(), 500);
    const result = await runner.run(
      [`child:${pidFile}`, 'sleep:30000'],
      options({ signal: controller.signal })
    );
    expect(result.reason).toBe('cancelled');
    const grandchild = Number(fs.readFileSync(pidFile, 'utf8'));
    expect(await waitFor(() => !isAlive(grandchild))).toBe(true);
  }, 20000);

  it('runs two calls one after the other', async () => {
    const order: string[] = [];
    const first = runner
      .run(['sleep:400', 'out:first'], options())
      .then(result => {
        order.push('first');
        return result;
      });
    const second = runner.run(['out:second'], options()).then(result => {
      order.push('second');
      return result;
    });
    const [a, b] = await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
    expect(a.durationMs).toBeGreaterThanOrEqual(350);
    expect(b.stdoutTail).toBe('second\n');
  });

  it('rejects a call that waits for the lock when it is aborted', async () => {
    const busy = runner.run(['sleep:400'], options());
    const controller = new AbortController();
    const waiting = runner.run(
      ['out:never'],
      options({ signal: controller.signal })
    );
    controller.abort();
    await expect(waiting).rejects.toThrow();
    expect((await busy).exitCode).toBe(0);
  });
});

describe('stripAnsi', () => {
  it('removes color codes', () => {
    expect(stripAnsi('\u001b[1;31mbad\u001b[0m ok')).toBe('bad ok');
  });
});
