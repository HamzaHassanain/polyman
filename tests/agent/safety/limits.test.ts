/**
 * Group 5: output size and time. A huge result is cut before the model reads
 * it, and a run that takes too long is killed with everything it started.
 */

import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NodeCliRunner,
  TAIL_END_CHARS,
  TAIL_HEAD_CHARS,
} from '../../../src/agent/runner/cli-runner';
import type { RunOptions } from '../../../src/agent/runner/types';
import {
  FAKE_CLI,
  isAlive,
  makeFolders,
  makeHarness,
  removeFolders,
  spyTool,
  waitFor,
  type Folders,
} from './helpers';

const CAP = 8192;

let f: Folders;

beforeEach(() => {
  f = makeFolders();
});

afterEach(() => {
  removeFolders(f);
});

function textTool(name: string, content: string) {
  return spyTool(name, {
    risk: 'read',
    run: () => Promise.resolve({ content }),
  });
}

describe('safety: output size', () => {
  it('a result over 8 KB is cut and says so', async () => {
    const h = makeHarness(f.root, {
      extraTools: [textTool('big', 'a'.repeat(100_000) + 'THE END')],
    });
    const out = await h.call('big', { path: 'x' });
    expect(Buffer.byteLength(out.content)).toBeLessThanOrEqual(CAP);
    expect(out.content).toMatch(/\[\.\.\. \d+ bytes cut \.\.\.\]/);
    expect(out.content.startsWith('aaa')).toBe(true);
    expect(out.content.endsWith('THE END')).toBe(true);
  });

  it('cutting never splits a multi-byte character', async () => {
    const h = makeHarness(f.root, {
      extraTools: [textTool('euro', '€'.repeat(20_000))],
    });
    const out = await h.call('euro', { path: 'x' });
    expect(Buffer.byteLength(out.content)).toBeLessThanOrEqual(CAP);
    expect(out.content).not.toContain('�');
    expect(out.content).toContain('bytes cut');
  });

  it('a result under the cap is kept whole', async () => {
    const text = 'b'.repeat(CAP - 10);
    const h = makeHarness(f.root, { extraTools: [textTool('ok', text)] });
    expect((await h.call('ok', { path: 'x' })).content).toBe(text);
  });

  it('reading a huge file through read_file is cut too', async () => {
    const line = 'x'.repeat(200);
    fs.writeFileSync(
      path.join(f.root, 'big.txt'),
      `${Array.from({ length: 5000 }, () => line).join('\n')}\n`
    );
    const h = makeHarness(f.root);
    const out = await h.call('read_file', { path: 'big.txt' });
    expect(Buffer.byteLength(out.content)).toBeLessThanOrEqual(CAP);
    expect(out.content).toContain('bytes cut');
  });
});

describe('safety: time limits', () => {
  it('a tool that hangs and ignores the signal times out', async () => {
    const hang = spyTool('hang', {
      risk: 'read',
      timeoutMs: 50,
      run: () => new Promise(() => {}),
    });
    const h = makeHarness(f.root, { extraTools: [hang] });
    const started = Date.now();
    const out = await h.call('hang', { path: 'x' });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('timed out');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('the tool gets an aborted signal when its time is up', async () => {
    let seen: AbortSignal | undefined;
    const slow = spyTool('slow', {
      risk: 'read',
      timeoutMs: 50,
      run: (_args, ctx) => {
        seen = ctx.signal;
        return new Promise(() => {});
      },
    });
    const h = makeHarness(f.root, { extraTools: [slow] });
    await h.call('slow', { path: 'x' });
    expect(seen?.aborted).toBe(true);
  });
});

describe('safety: CLI runs', () => {
  let logs: string;
  let runner: NodeCliRunner;

  beforeEach(() => {
    logs = path.join(f.base, 'logs');
    runner = new NodeCliRunner({ cliPath: FAKE_CLI, logDir: () => logs });
  });

  function options(extra: Partial<RunOptions> = {}): RunOptions {
    return {
      cwd: f.root,
      timeoutMs: 20_000,
      signal: new AbortController().signal,
      ...extra,
    };
  }

  function pidIn(file: string): number {
    return Number(fs.readFileSync(file, 'utf8'));
  }

  it.skipIf(process.platform === 'win32')(
    'a run over its timeout is killed, and its child too',
    async () => {
      const pidFile = path.join(f.base, 'child.pid');
      const result = await runner.run(
        [`child:${pidFile}`, 'sleep:60000'],
        options({ timeoutMs: 500 })
      );
      expect(result.reason).toBe('timeout');
      expect(result.exitCode).toBeNull();
      expect(result.durationMs).toBeLessThan(10_000);
      const pid = pidIn(pidFile);
      expect(await waitFor(() => !isAlive(pid))).toBe(true);
    },
    20_000
  );

  it.skipIf(process.platform === 'win32')(
    'a run that ignores SIGTERM is still killed',
    async () => {
      const pidFile = path.join(f.base, 'child.pid');
      const result = await runner.run(
        ['ignore-term', `child:${pidFile}`, 'sleep:60000'],
        options({ timeoutMs: 300 })
      );
      expect(result.reason).toBe('timeout');
      const pid = pidIn(pidFile);
      expect(await waitFor(() => !isAlive(pid))).toBe(true);
    },
    20_000
  );

  it.skipIf(process.platform === 'win32')(
    'cancel kills the run and its child',
    async () => {
      const pidFile = path.join(f.base, 'child.pid');
      const controller = new AbortController();
      const running = runner.run(
        [`child:${pidFile}`, 'sleep:60000'],
        options({ signal: controller.signal })
      );
      await waitFor(() => fs.existsSync(pidFile));
      controller.abort();
      const result = await running;
      expect(result.reason).toBe('cancelled');
      const pid = pidIn(pidFile);
      expect(await waitFor(() => !isAlive(pid))).toBe(true);
    },
    20_000
  );

  it('arguments go to the CLI as they are, never through a shell', async () => {
    const marker = path.join(f.base, 'pwned');
    const args = [
      `out:$(touch ${marker})`,
      `out:a; touch ${marker}`,
      `out:\`touch ${marker}\``,
      `out:| touch ${marker} &&`,
    ];
    const result = await runner.run(args, options());
    expect(result.exitCode).toBe(0);
    expect(result.stdoutTail).toContain(`$(touch ${marker})`);
    expect(result.stdoutTail).toContain(`a; touch ${marker}`);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('a flood of output keeps only the start and the end', async () => {
    const result = await runner.run(['big:2000000'], options());
    expect(result.stdoutTail.length).toBeLessThanOrEqual(
      TAIL_HEAD_CHARS + TAIL_END_CHARS + 200
    );
    expect(result.stdoutTail).toContain('characters cut');
  });
});
