import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NodeCliRunner } from '../../../src/agent/runner/cli-runner';
import type {
  CliRunner,
  RunOptions,
  RunResult,
} from '../../../src/agent/runner/types';
import { cliTools } from '../../../src/agent/tools/cli-tools';
import type {
  Sandbox,
  Tool,
  ToolContext,
} from '../../../src/agent/tools/types';

interface Call {
  args: string[];
  opts: RunOptions;
}

/** Records the calls and answers with the queued results. */
class FakeRunner implements CliRunner {
  readonly calls: Call[] = [];
  readonly results: (Partial<RunResult> | Error)[] = [];
  /** Lines sent to onLine on each run. */
  lines: string[] = [];

  run(args: string[], opts: RunOptions): Promise<RunResult> {
    this.calls.push({ args, opts });
    for (const line of this.lines) opts.onLine?.(line);
    const next = this.results.shift() ?? {};
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({
      exitCode: 0,
      reason: 'exited',
      stdoutTail: '',
      stderrTail: '',
      logPath: '/logs/run.log',
      durationMs: 10,
      ...next,
    });
  }
}

const sandbox: Sandbox = {
  root: '/unused',
  resolve: p => Promise.resolve(p),
};

let dir: string;
let runner: FakeRunner;
let progress: string[];
let problemDirs: string[];
let controller: AbortController;
let ctx: ToolContext;

function tool(name: string): Tool {
  const found = cliTools().find(t => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
}

function report(fields: Record<string, unknown>): Record<string, unknown> {
  return { schemaVersion: 1, polymanVersion: '3.1.0', ...fields };
}

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pm-cli-')));
  runner = new FakeRunner();
  progress = [];
  problemDirs = [];
  controller = new AbortController();
  ctx = {
    problemDir: dir,
    signal: controller.signal,
    runner,
    sandbox,
    progress: line => progress.push(line),
    setProblemDir: d => problemDirs.push(d),
  };
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('cliTools', () => {
  it('has the six tools with closed object schemas', () => {
    const tools = cliTools();
    expect(tools.map(t => [t.name, t.risk, t.needsProblem])).toEqual([
      ['create_problem', 'write', false],
      ['generate', 'run', true],
      ['validate', 'run', true],
      ['run_solution', 'run', true],
      ['test_target', 'run', true],
      ['verify', 'run', true],
    ]);
    for (const t of tools) {
      expect(t.parameters['type']).toBe('object');
      expect(t.parameters['additionalProperties']).toBe(false);
      expect(t.timeoutMs).toBeGreaterThan(0);
    }
  });

  it('describes the commands for approvals', () => {
    expect(tool('verify').describe?.({})).toEqual({
      title: 'Verify the problem',
      command: 'polyman verify --json',
    });
    expect(
      tool('run_solution').describe?.({ name: 'wa', testset: 'tests' })
    ).toEqual({
      title: 'Run solution wa',
      command: 'polyman run wa -t tests --json',
    });
  });
});

describe('args, folder and timeouts', () => {
  const cases: [string, unknown, string[], number][] = [
    ['generate', {}, ['generate', '--all', '--json'], 300_000],
    [
      'generate',
      { testset: 'tests' },
      ['generate', '-t', 'tests', '--json'],
      300_000,
    ],
    ['validate', {}, ['validate', '--all', '--json'], 300_000],
    [
      'validate',
      { testset: 'big' },
      ['validate', '-t', 'big', '--json'],
      300_000,
    ],
    [
      'run_solution',
      { name: 'acc' },
      ['run', 'acc', '--all', '--json'],
      300_000,
    ],
    [
      'run_solution',
      { name: 'acc', testset: 'tests' },
      ['run', 'acc', '-t', 'tests', '--json'],
      300_000,
    ],
    [
      'test_target',
      { what: 'checker' },
      ['test', 'checker', '--json'],
      300_000,
    ],
    ['verify', {}, ['verify', '--json'], 600_000],
  ];

  for (const [name, args, expected, timeoutMs] of cases) {
    it(`${name} ${JSON.stringify(args)} runs ${expected.join(' ')}`, async () => {
      runner.lines = ['compiling'];
      await tool(name).run(args, ctx);
      expect(runner.calls).toHaveLength(1);
      const call = runner.calls[0];
      expect(call.args).toEqual(expected);
      expect(call.opts.cwd).toBe(dir);
      expect(call.opts.timeoutMs).toBe(timeoutMs);
      expect(call.opts.signal).toBe(controller.signal);
      expect(progress).toEqual(['compiling']);
    });
  }

  it('refuses names that look like flags', async () => {
    const outs = [
      await tool('generate').run({ testset: '--all' }, ctx),
      await tool('run_solution').run({ name: '-x' }, ctx),
      await tool('test_target').run({ what: 'a b' }, ctx),
    ];
    for (const out of outs) {
      expect(out.isError).toBe(true);
      expect(out.content).toContain('Invalid');
    }
    expect(runner.calls).toHaveLength(0);
  });

  it('fails without a problem folder', async () => {
    ctx.problemDir = null;
    await expect(tool('verify').run({}, ctx)).rejects.toThrow(
      'Create the problem first'
    );
  });
});

describe('create_problem', () => {
  it('checks the name before running', async () => {
    for (const name of ['Pairs', '-rf', 'a/b', '../x', '', 'a b']) {
      const out = await tool('create_problem').run({ name }, ctx);
      expect(out.isError).toBe(true);
      expect(out.content).toContain('Invalid problem name');
    }
    expect(runner.calls).toHaveLength(0);
  });

  it('refuses a folder that exists', async () => {
    fs.mkdirSync(path.join(dir, 'pairs'));
    const out = await tool('create_problem').run({ name: 'pairs' }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toContain('already exists');
    expect(runner.calls).toHaveLength(0);
  });

  it('runs new, then download-testlib in the new folder, and sets the folder', async () => {
    const target = path.join(dir, 'pairs-sum');
    runner.results.push(
      {
        json: report({
          ok: true,
          command: 'new',
          exitCode: 0,
          errors: [],
          path: target,
        }),
      },
      {
        json: report({
          ok: true,
          command: 'download-testlib',
          exitCode: 0,
          errors: [],
        }),
      }
    );
    const out = await tool('create_problem').run({ name: 'pairs-sum' }, ctx);
    expect(
      runner.calls.map(c => [c.args, c.opts.cwd, c.opts.timeoutMs])
    ).toEqual([
      [['new', 'pairs-sum', '--json'], dir, 60_000],
      [['download-testlib', '--json'], target, 60_000],
    ]);
    expect(problemDirs).toEqual([target]);
    expect(out.isError).toBeUndefined();
    expect(out.content).toContain(`Created the problem folder ${target}`);
  });

  it('uses the current folder when there is no problem folder', async () => {
    ctx.problemDir = null;
    runner.results.push({
      exitCode: 2,
      json: report({ ok: false, errors: ['exists'] }),
    });
    await tool('create_problem').run({ name: `pm-test-${Date.now()}` }, ctx);
    expect(runner.calls[0].opts.cwd).toBe(process.cwd());
  });

  it('stops when new fails', async () => {
    runner.results.push({
      exitCode: 2,
      json: report({
        ok: false,
        errors: ['Directory exists', 'Hint: pick another name'],
      }),
    });
    const out = await tool('create_problem').run({ name: 'pairs' }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toContain('Directory exists');
    expect(out.content).toContain('Hint: pick another name');
    expect(runner.calls).toHaveLength(1);
    expect(problemDirs).toEqual([]);
  });

  it('keeps the new folder when download-testlib fails', async () => {
    runner.results.push(
      { json: report({ ok: true, path: path.join(dir, 'pairs') }) },
      {
        exitCode: 4,
        json: report({ ok: false, errors: ['Download failed: ENOTFOUND'] }),
      }
    );
    const out = await tool('create_problem').run({ name: 'pairs' }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toContain('downloading testlib.h failed');
    expect(out.content).toContain('ENOTFOUND');
    expect(problemDirs).toEqual([path.join(dir, 'pairs')]);
  });
});

describe('digests for the exit codes', () => {
  it('exit 2: error with the message and the hint', async () => {
    runner.results.push({
      exitCode: 2,
      json: report({
        ok: false,
        command: 'run',
        tests: [],
        errors: ['Solution named "x" not found', 'Hint: check Config.json'],
      }),
    });
    const out = await tool('run_solution').run({ name: 'x' }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toBe(
      [
        'run_solution FAILED (exit 2, bad arguments or Config.json):',
        '  Solution named "x" not found',
        '  Hint: check Config.json',
        'Full log: /logs/run.log',
      ].join('\n')
    );
  });

  it('exit 3: names the missing tool', async () => {
    runner.results.push({
      exitCode: 3,
      json: report({ ok: false, errors: ['Compiler g++ was not found'] }),
    });
    const out = await tool('verify').run({}, ctx);
    expect(out.isError).toBe(true);
    expect(out.content.split('\n')[0]).toBe(
      'g++ is missing on this machine. Tell the user.'
    );
  });

  it('exit 3: falls back when the tool is unknown', async () => {
    runner.results.push({ exitCode: 3, stderrTail: 'something is missing\n' });
    const out = await tool('verify').run({}, ctx);
    expect(out.content).toContain(
      'A needed program is missing on this machine'
    );
    expect(out.content).toContain('something is missing');
  });

  it('exit 4: error', async () => {
    runner.results.push({
      exitCode: 4,
      json: report({ ok: false, errors: ['timeout'] }),
    });
    const out = await tool('generate').run({}, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toContain('exit 4, Polygon or network');
  });

  it('exit 130 and 143: one line', async () => {
    runner.results.push({ exitCode: 130 }, { exitCode: 143 });
    const a = await tool('verify').run({}, ctx);
    const b = await tool('verify').run({}, ctx);
    expect(a.content).toBe('verify was cancelled (exit 130).');
    expect(b.content).toBe('verify was cancelled (exit 143).');
  });

  it('timeout and cancel: one line', async () => {
    runner.results.push(
      { exitCode: null, reason: 'timeout', durationMs: 600_000 },
      { exitCode: null, reason: 'cancelled' }
    );
    const a = await tool('verify').run({}, ctx);
    const b = await tool('verify').run({}, ctx);
    expect(a.isError).toBe(true);
    expect(a.content).toBe(
      'verify timed out after 600 s and was stopped. Full log: /logs/run.log'
    );
    expect(b.content).toBe('verify was cancelled.');
  });

  it('a runner that rejects after an abort says cancelled', async () => {
    controller.abort();
    runner.results.push(new Error('aborted'));
    const out = await tool('validate').run({}, ctx);
    expect(out).toEqual({ content: 'validate was cancelled.', isError: true });
  });

  it('no JSON: OK, or FAILED with the end of stderr', async () => {
    runner.results.push({ exitCode: 0 });
    const ok = await tool('generate').run({}, ctx);
    expect(ok.content).toBe('generate OK');

    const stderr = Array.from({ length: 30 }, (_, i) => `err ${i + 1}`).join(
      '\n\n'
    );
    runner.results.push({ exitCode: 1, stderrTail: stderr });
    const failed = await tool('generate').run({}, ctx);
    const lines = failed.content.split('\n');
    expect(lines[0]).toBe('generate FAILED (exit 1)');
    expect(lines.slice(1, 21)).toEqual(
      Array.from({ length: 20 }, (_, i) => `err ${i + 11}`)
    );
    expect(lines[21]).toBe('Full log: /logs/run.log');
    expect(failed.isError).toBeUndefined();
  });

  it('keeps the full RunResult in data', async () => {
    runner.results.push({ exitCode: 0, json: report({ ok: true, tests: [] }) });
    const out = await tool('generate').run({}, ctx);
    expect(out.data).toMatchObject({ exitCode: 0, logPath: '/logs/run.log' });
  });
});

describe('report digests', () => {
  it('generate: counts and failing tests, max 15', async () => {
    const tests = [
      { testset: 'tests', index: 1, source: 'manual', ok: true },
      ...Array.from({ length: 20 }, (_, i) => ({
        testset: 'tests',
        index: i + 2,
        source: 'generator',
        generator: 'gen',
        args: ['10', String(i)],
        ok: false,
        error: 'generator crashed',
      })),
    ];
    runner.results.push({
      exitCode: 1,
      json: report({ ok: false, command: 'generate', errors: ['x'], tests }),
    });
    const out = await tool('generate').run({}, ctx);
    const lines = out.content.split('\n');
    expect(out.isError).toBeUndefined();
    expect(lines[0]).toBe('generate FAILED: 21 tests, 1 ok, 20 failed');
    expect(lines[1]).toBe('  tests #2 (gen 10 0): generator crashed');
    expect(lines[16]).toBe('  ... 5 more');
    expect(lines[17]).toBe('Full log: /logs/run.log');
  });

  it('generate: shows the errors when no test failed', async () => {
    runner.results.push({
      exitCode: 1,
      json: report({
        ok: false,
        errors: ['Failed to compile gen.cpp'],
        tests: [],
      }),
    });
    const out = await tool('generate').run({}, ctx);
    expect(out.content).toContain('  Failed to compile gen.cpp');
  });

  it('validate: counts and invalid tests', async () => {
    runner.results.push({
      exitCode: 1,
      json: report({
        ok: false,
        errors: [],
        tests: [
          { testset: 'tests', index: 1, valid: true, message: '' },
          {
            testset: 'tests',
            index: 2,
            valid: false,
            message: 'n out of range',
          },
        ],
      }),
    });
    const out = await tool('validate').run({}, ctx);
    expect(out.content.split('\n')).toEqual([
      'validate FAILED: 2 tests, 1 valid, 1 invalid',
      '  tests #2: n out of range',
      'Full log: /logs/run.log',
    ]);
  });

  it('test_target validator: failing cases', async () => {
    runner.results.push({
      exitCode: 1,
      json: report({
        ok: false,
        command: 'test validator',
        target: 'validator',
        errors: [],
        cases: [
          {
            index: 1,
            expected: 'VALID',
            actual: 'VALID',
            ok: true,
            message: '',
          },
          {
            index: 2,
            expected: 'INVALID',
            actual: 'VALID',
            ok: false,
            message: 'accepted',
          },
        ],
      }),
    });
    const out = await tool('test_target').run({ what: 'validator' }, ctx);
    expect(out.content.split('\n')).toEqual([
      'test validator FAILED: 2 cases, 1 ok, 1 failed',
      '  case 2: expected INVALID, got VALID: accepted',
      'Full log: /logs/run.log',
    ]);
  });

  it('test_target checker without self-tests', async () => {
    runner.results.push({
      json: report({ ok: true, target: 'checker', errors: [], cases: [] }),
    });
    const out = await tool('test_target').run({ what: 'checker' }, ctx);
    expect(out.content).toContain('test checker OK: no self-tests ran');
  });

  it('test_target solution: tag match and failing tests', async () => {
    runner.results.push({
      exitCode: 1,
      json: report({
        ok: false,
        command: 'test',
        solution: 'wa',
        tag: 'WA',
        mainSolution: 'acc',
        matchesTag: false,
        reason: 'expected WA on at least one test',
        errors: [],
        tests: [
          {
            testset: 'tests',
            index: 1,
            verdict: 'OK',
            timeMs: 12,
            message: '',
          },
          {
            testset: 'tests',
            index: 2,
            verdict: 'TLE',
            timeMs: 2000,
            message: 'too slow',
          },
        ],
      }),
    });
    const out = await tool('test_target').run({ what: 'wa' }, ctx);
    expect(out.content.split('\n')).toEqual([
      'test wa (WA) FAILED: does NOT match its tag. expected WA on at least one test',
      '  2 tests, OK 1, TLE 1, max 2000 ms',
      '  tests #2 TLE: too slow',
      'Full log: /logs/run.log',
    ]);
  });

  it('run: summary per solution and the first failing test', async () => {
    runner.results.push({
      exitCode: 0,
      json: report({
        ok: true,
        command: 'run',
        solution: 'wa',
        tag: 'WA',
        errors: [],
        tests: [
          {
            testset: 'tests',
            index: 1,
            verdict: 'OK',
            timeMs: 15,
            message: '',
          },
          {
            testset: 'tests',
            index: 2,
            verdict: 'WA',
            timeMs: 30,
            message: 'expected 3, got 4',
          },
        ],
      }),
    });
    const out = await tool('run_solution').run({ name: 'wa' }, ctx);
    expect(out.content.split('\n')).toEqual([
      'run wa passed',
      '  wa (WA): 2 tests, OK 1, WA 1, max 30 ms',
      'First failing: tests #2 WA: expected 3, got 4',
      'Full log: /logs/run.log',
    ]);
  });

  it('verify passed: one line per solution', async () => {
    runner.results.push({
      json: report({
        ok: true,
        command: 'verify',
        failedStep: null,
        steps: [{ name: 'generate', ok: true, errors: [] }],
        warnings: [],
        solutions: [
          {
            name: 'acc',
            tag: 'MA',
            matchesTag: true,
            reason: 'ok',
            tests: [
              {
                testset: 'tests',
                index: 1,
                verdict: 'OK',
                timeMs: 40,
                message: '',
              },
            ],
          },
          {
            name: 'tle',
            tag: 'TL',
            matchesTag: true,
            reason: 'ok',
            tests: [
              {
                testset: 'tests',
                index: 1,
                verdict: 'TLE',
                timeMs: 2003,
                message: '',
              },
            ],
          },
        ],
      }),
    });
    const out = await tool('verify').run({}, ctx);
    expect(out.isError).toBeUndefined();
    expect(out.content.split('\n')).toEqual([
      'verify passed',
      '  acc (MA): 1 tests, OK 1, max 40 ms',
      '  tle (TL): 1 tests, TLE 1, max 2003 ms',
      'Full log: /logs/run.log',
    ]);
  });

  it('verify FAILED at a step: shows the step errors', async () => {
    runner.results.push({
      exitCode: 1,
      json: report({
        ok: false,
        failedStep: 'validate',
        steps: [
          { name: 'generate', ok: true, errors: [] },
          {
            name: 'validate',
            ok: false,
            errors: ['Test 3 is invalid: n > 10^5'],
          },
        ],
        warnings: ['statement is short'],
        solutions: [],
      }),
    });
    const out = await tool('verify').run({}, ctx);
    expect(out.isError).toBeUndefined();
    expect(out.content.split('\n')).toEqual([
      'verify FAILED at "validate"',
      'Step "validate" errors:',
      '  Test 3 is invalid: n > 10^5',
      'Warnings: statement is short',
      'Full log: /logs/run.log',
    ]);
  });

  it('verify FAILED on a solution: shows its reason, at most 40 lines', async () => {
    const solutions = Array.from({ length: 60 }, (_, i) => ({
      name: `s${i}`,
      tag: 'OK',
      matchesTag: i !== 0,
      reason: i === 0 ? 'got WA on test 2' : 'ok',
      tests: [
        {
          testset: 'tests',
          index: 2,
          verdict: i === 0 ? 'WA' : 'OK',
          timeMs: 5,
          message: 'differ',
        },
      ],
    }));
    runner.results.push({
      exitCode: 1,
      json: report({
        ok: false,
        failedStep: 'solutions',
        steps: [{ name: 'solutions', ok: false, errors: [] }],
        warnings: [],
        solutions,
      }),
    });
    const out = await tool('verify').run({}, ctx);
    const lines = out.content.split('\n');
    expect(lines).toHaveLength(40);
    expect(lines[0]).toBe('verify FAILED at "solutions"');
    expect(lines[1]).toBe(
      '  s0 (OK): 1 tests, WA 1, max 5 ms (does NOT match its tag)'
    );
    expect(lines[38]).toMatch(/more lines in the log$/);
    expect(lines[39]).toBe('Full log: /logs/run.log');

    runner.results.push({
      exitCode: 1,
      json: report({
        ok: false,
        failedStep: 'solutions',
        steps: [{ name: 'solutions', ok: false, errors: [] }],
        warnings: [],
        solutions: solutions.slice(0, 2),
      }),
    });
    const small = await tool('verify').run({}, ctx);
    expect(small.content).toContain('s0: got WA on test 2');
    expect(small.content).toContain('First failing: tests #2 WA: differ');
  });
});

const REAL_CLI = path.join(__dirname, '..', '..', '..', 'dist', 'cli.js');

describe('real CLI smoke test', () => {
  it.skipIf(!fs.existsSync(REAL_CLI))(
    'create_problem and generate with the real polyman',
    async () => {
      const realCtx: ToolContext = {
        ...ctx,
        runner: new NodeCliRunner({ cliPath: REAL_CLI }),
        setProblemDir: d => {
          realCtx.problemDir = d;
          problemDirs.push(d);
        },
      };
      const created = await tool('create_problem').run(
        { name: 'smoke' },
        realCtx
      );
      expect(created.content).toContain('Created');
      const problem = path.join(dir, 'smoke');
      expect(problemDirs).toEqual([problem]);
      expect(fs.existsSync(path.join(problem, 'Config.json'))).toBe(true);
      expect(created.isError, created.content).toBeUndefined();

      const generated = await tool('generate').run({}, realCtx);
      expect(generated.isError, generated.content).toBeUndefined();
      expect(generated.content).toMatch(
        /^generate OK: \d+ tests, \d+ ok, 0 failed/
      );
      const data = generated.data as RunResult;
      expect(data.exitCode).toBe(0);
      expect(fs.existsSync(data.logPath)).toBe(true);
      expect(
        data.logPath.startsWith(path.join(problem, '.polyman', 'agent', 'logs'))
      ).toBe(true);
      expect(
        fs.readdirSync(path.join(problem, 'testsets', 'tests')).length
      ).toBeGreaterThan(0);
    },
    120_000
  );
});
