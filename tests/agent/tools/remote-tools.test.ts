import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  CliRunner,
  RunOptions,
  RunResult,
} from '../../../src/agent/runner/types';
import {
  NOT_SET_UP,
  polygonProblemId,
  pushFlags,
  remoteTools,
  type PolygonCredentials,
} from '../../../src/agent/tools/remote-tools';
import type {
  Sandbox,
  Tool,
  ToolContext,
} from '../../../src/agent/tools/types';

/** Obviously fake, never a real key. */
const FAKE: PolygonCredentials = {
  apiKey: 'a'.repeat(40),
  secret: 'b'.repeat(40),
};

interface Call {
  args: string[];
  opts: RunOptions;
}

/** Records the calls and answers with the queued results. */
class FakeRunner implements CliRunner {
  readonly calls: Call[] = [];
  readonly results: Partial<RunResult>[] = [];

  run(args: string[], opts: RunOptions): Promise<RunResult> {
    this.calls.push({ args, opts });
    return Promise.resolve({
      exitCode: 0,
      reason: 'exited',
      stdoutTail: '',
      stderrTail: '',
      logPath: '/logs/run.log',
      durationMs: 10,
      ...(this.results.shift() ?? {}),
    });
  }
}

const sandbox: Sandbox = {
  root: '/unused',
  resolve: p => Promise.resolve(p),
};

let dir: string;
let runner: FakeRunner;
let credentials: PolygonCredentials | null;
let ctx: ToolContext;

function tool(name: string): Tool {
  const found = remoteTools({ credentials: () => credentials }).find(
    t => t.name === name
  );
  if (!found) throw new Error(`no tool ${name}`);
  return found;
}

function writeConfig(fields: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(dir, 'Config.json'),
    JSON.stringify({ name: 'pairs-sum', ...fields })
  );
}

function remoteReport(fields: Record<string, unknown>): Partial<RunResult> {
  return {
    json: {
      schemaVersion: 1,
      polymanVersion: '3.1.0',
      command: 'remote push',
      ok: true,
      exitCode: 0,
      durationMs: 5,
      errors: [],
      problemId: null,
      actions: [],
      warnings: [],
      ...fields,
    },
  };
}

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pm-remote-')));
  runner = new FakeRunner();
  credentials = FAKE;
  ctx = {
    problemDir: dir,
    signal: new AbortController().signal,
    runner,
    sandbox,
    progress: () => {},
    setProblemDir: () => {},
  };
  writeConfig({ problemId: 12345 });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('remoteTools', () => {
  it('has the four tools, all remote but the read-only view', () => {
    const tools = remoteTools({ credentials: () => FAKE });
    expect(tools.map(t => [t.name, t.risk, t.needsProblem])).toEqual([
      ['remote_push', 'remote', true],
      ['remote_commit', 'remote', true],
      ['remote_package', 'remote', true],
      ['remote_view', 'read', true],
    ]);
    for (const t of tools) {
      expect(t.parameters['type']).toBe('object');
      expect(t.parameters['additionalProperties']).toBe(false);
      expect(t.timeoutMs).toBeGreaterThan(0);
    }
  });

  it('has no register tool', () => {
    const names = remoteTools().map(t => t.name);
    expect(names.some(n => n.includes('register'))).toBe(false);
  });

  it('describes the push for the approval', () => {
    expect(
      tool('remote_push').describe?.({
        components: ['tests', 'solutions'],
        newProblemName: 'pairs-sum',
      })
    ).toEqual({
      title: 'Push the problem to Polygon',
      command: 'polyman remote push . -s -t --yes --name pairs-sum --json',
    });
  });
});

describe('remote_push', () => {
  it('pushes everything with no flags, in the problem folder', async () => {
    runner.results.push(
      remoteReport({
        problemId: 12345,
        actions: [
          {
            component: 'solution',
            name: 'main.cpp',
            action: 'upload',
            ok: true,
          },
        ],
      })
    );
    const out = await tool('remote_push').run({}, ctx);
    expect(runner.calls[0]?.args).toEqual(['remote', 'push', '.', '--json']);
    expect(runner.calls[0]?.opts.cwd).toBe(dir);
    expect(out.isError).toBeUndefined();
    expect(out.content).toContain('pushed to Polygon problem 12345, 1 uploads');
    expect(out.content).toContain('remote_commit');
  });

  it('passes one flag per component, in a fixed order', async () => {
    runner.results.push(remoteReport({ problemId: 12345 }));
    await tool('remote_push').run(
      { components: ['tests', 'checker', 'solutions'] },
      ctx
    );
    expect(runner.calls[0]?.args).toEqual([
      'remote',
      'push',
      '.',
      '-s',
      '-c',
      '-t',
      '--json',
    ]);
    expect(pushFlags(undefined)).toEqual([]);
    expect(pushFlags([])).toEqual([]);
    expect(
      pushFlags(['info', 'metadata', 'statements', 'generators', 'validator'])
    ).toEqual(['-v', '-g', '-S', '-m', '-i']);
  });

  it('asks for newProblemName when the problem is not on Polygon', async () => {
    writeConfig({});
    const out = await tool('remote_push').run({}, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toContain('newProblemName');
    expect(runner.calls).toHaveLength(0);
  });

  it('creates a new problem with --yes --name, never a prompt', async () => {
    writeConfig({});
    runner.results.push(
      remoteReport({
        problemId: 777,
        actions: [
          {
            component: 'problem',
            name: 'pairs-sum',
            action: 'create',
            ok: true,
          },
        ],
      })
    );
    const out = await tool('remote_push').run(
      { newProblemName: 'pairs-sum' },
      ctx
    );
    expect(runner.calls[0]?.args).toEqual([
      'remote',
      'push',
      '.',
      '--yes',
      '--name',
      'pairs-sum',
      '--json',
    ]);
    expect(out.content).toContain(
      'pushed to Polygon problem 777 (new problem)'
    );
  });

  it('does not pass --name when the problem is already on Polygon', async () => {
    runner.results.push(remoteReport({ problemId: 12345 }));
    await tool('remote_push').run({ newProblemName: 'other' }, ctx);
    expect(runner.calls[0]?.args).toEqual(['remote', 'push', '.', '--json']);
  });

  it('rejects a bad new problem name', async () => {
    writeConfig({});
    const out = await tool('remote_push').run({ newProblemName: '--yes' }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toContain('Invalid Polygon problem name');
    expect(runner.calls).toHaveLength(0);
  });

  it('lists the failed uploads', async () => {
    runner.results.push({
      exitCode: 1,
      ...remoteReport({
        ok: false,
        exitCode: 1,
        problemId: 12345,
        actions: [
          {
            component: 'solution',
            name: 'main.cpp',
            action: 'upload',
            ok: true,
          },
          {
            component: 'checker',
            name: 'chk.cpp',
            action: 'upload',
            ok: false,
            error: 'compilation failed',
          },
        ],
      }),
    });
    const out = await tool('remote_push').run({}, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toContain('1 of 2 uploads failed');
    expect(out.content).toContain(
      'checker chk.cpp (upload) FAILED: compilation failed'
    );
  });

  it('says how to set up Polygon when there are no credentials', async () => {
    credentials = null;
    const out = await tool('remote_push').run({}, ctx);
    expect(out).toEqual({ content: NOT_SET_UP, isError: true });
    expect(out.content).toContain('polyman remote register');
    expect(out.content).toContain('not in this chat');
    expect(runner.calls).toHaveLength(0);
  });

  it('gives the Polygon error for exit 4', async () => {
    runner.results.push({
      exitCode: 4,
      ...remoteReport({ ok: false, errors: ['Polygon said: no access'] }),
    });
    const out = await tool('remote_push').run({}, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toContain('exit 4, Polygon or network');
    expect(out.content).toContain('no access');
  });
});

describe('remote_commit, remote_package, remote_view', () => {
  it('commits with the message as one argument', async () => {
    runner.results.push(remoteReport({ problemId: 12345 }));
    const out = await tool('remote_commit').run(
      { message: 'Added tests for n = 1' },
      ctx
    );
    expect(runner.calls[0]?.args).toEqual([
      'remote',
      'commit',
      '.',
      'Added tests for n = 1',
      '--json',
    ]);
    expect(out.content).toContain('committed Polygon problem 12345');
  });

  it('builds a package of the given type', async () => {
    runner.results.push(remoteReport({ problemId: 12345 }));
    const out = await tool('remote_package').run({ type: 'standard' }, ctx);
    expect(runner.calls[0]?.args).toEqual([
      'remote',
      'package',
      '.',
      'standard',
      '--json',
    ]);
    expect(out.content).toContain('standard package is ready');
  });

  it('says when Polygon failed the package build', async () => {
    runner.results.push({
      ...remoteReport({ problemId: 12345 }),
      stderrTail: 'PACKAGE BUILD FAILED!\nState: FAILED\n',
    });
    const out = await tool('remote_package').run({ type: 'linux' }, ctx);
    expect(out.content).toContain('linux package build FAILED');
    expect(out.isError).toBe(true);
  });

  it('rejects the full package type', async () => {
    const out = await tool('remote_package').run({ type: 'full' }, ctx);
    expect(out.isError).toBe(true);
    expect(runner.calls).toHaveLength(0);
  });

  it('shows the view from stderr', async () => {
    runner.results.push({
      ...remoteReport({ problemId: 12345 }),
      stderrTail: 'Name: pairs-sum\nTime limit: 1000 ms\n',
    });
    const out = await tool('remote_view').run({}, ctx);
    expect(runner.calls[0]?.args).toEqual(['remote', 'view', '.', '--json']);
    expect(out.content).toContain('Polygon problem 12345:');
    expect(out.content).toContain('Time limit: 1000 ms');
  });

  it('need the problem on Polygon first', async () => {
    writeConfig({});
    for (const [name, args] of [
      ['remote_commit', { message: 'x' }],
      ['remote_package', { type: 'standard' }],
      ['remote_view', {}],
    ] as const) {
      const out = await tool(name).run(args, ctx);
      expect(out.isError).toBe(true);
      expect(out.content).toContain('Push it first with remote_push');
    }
    expect(runner.calls).toHaveLength(0);
  });

  it('need the credentials', async () => {
    credentials = null;
    for (const [name, args] of [
      ['remote_commit', { message: 'x' }],
      ['remote_package', { type: 'standard' }],
      ['remote_view', {}],
    ] as const) {
      const out = await tool(name).run(args, ctx);
      expect(out.content).toBe(NOT_SET_UP);
    }
    expect(runner.calls).toHaveLength(0);
  });
});

describe('polygonProblemId', () => {
  it('reads the id, or null', () => {
    expect(polygonProblemId(dir)).toBe(12345);
    writeConfig({});
    expect(polygonProblemId(dir)).toBeNull();
    fs.writeFileSync(path.join(dir, 'Config.json'), '{ nope');
    expect(polygonProblemId(dir)).toBeNull();
    expect(polygonProblemId(path.join(dir, 'missing'))).toBeNull();
  });
});
