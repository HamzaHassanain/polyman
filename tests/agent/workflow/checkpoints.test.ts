import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  CliCheckpoints,
  MemoCheckpoints,
  chooseChecker,
  verifyDigest,
} from '../../../src/agent/workflow/checkpoints';
import {
  compileCpp,
  removeBinary,
  runOnInput,
  sameTokens,
} from '../../../src/agent/workflow/compile';
import type {
  CliRunner,
  RunOptions,
  RunResult,
} from '../../../src/agent/runner/types';
import type {
  Checkpoint,
  Checkpoints,
  PlanTask,
} from '../../../src/agent/workflow/types';

const FENCE = '```';

const SPEC = `# Input
The first line has n and k. The second line has n integers.

# Output
One integer: the number of pairs.

# Samples
## Input 1
${FENCE}
4 6
1 5 3 3
${FENCE}
## Output 1
${FENCE}
2
${FENCE}

# Decisions
- Time limit 2 seconds, memory limit 512 MB.
`;

const CORRECT = `#include <iostream>
#include <map>
int main() {
  long long n, k; std::cin >> n >> k;
  std::map<long long, long long> cnt; long long ans = 0;
  for (int i = 0; i < n; i++) { long long a; std::cin >> a; ans += cnt[k - a]; cnt[a]++; }
  std::cout << ans << "\\n";
}
`;

const WRONG = `#include <iostream>
int main() { std::cout << 7 << "\\n"; }
`;

const BROKEN = `int main() { this is not c++ }
`;

function hasGpp(): boolean {
  try {
    execFileSync('g++', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function task(kind: PlanTask['kind'], ownsFiles: string[] = []): PlanTask {
  return { id: 't1', kind, title: kind, dependsOn: [], brief: '', ownsFiles };
}

/** A fake runner that answers each command from a table. */
class FakeRunner implements CliRunner {
  calls: string[][] = [];
  constructor(private readonly answers: Record<string, Partial<RunResult>>) {}

  run(args: string[], _opts: RunOptions): Promise<RunResult> {
    this.calls.push(args);
    const answer = this.answers[args.join(' ')] ?? {};
    return Promise.resolve({
      exitCode: 0,
      reason: 'exited',
      stdoutTail: '',
      stderrTail: '',
      logPath: '/tmp/log',
      durationMs: 1,
      ...answer,
    });
  }
}

const signal = new AbortController().signal;
let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'polyman-cp-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** Writes each file under `dir` with some text of its own. */
async function writeFiles(files: string[]): Promise<void> {
  for (const file of files) {
    await fs.mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await fs.writeFile(path.join(dir, file), `written for ${file}\n`);
  }
}

describe('sameTokens', () => {
  it('compares whitespace-separated tokens', () => {
    expect(sameTokens('1 2\n3\n', ' 1\t2 3')).toBe(true);
    expect(sameTokens('1 2', '1 2 3')).toBe(false);
    expect(sameTokens('', '\n')).toBe(true);
  });
});

describe.skipIf(!hasGpp())('compile and samples (needs g++)', () => {
  const checkpoints = new CliCheckpoints(new FakeRunner({}));

  it('a correct solution passes the sample', async () => {
    await fs.mkdir(path.join(dir, 'solutions'));
    await fs.writeFile(path.join(dir, 'solutions/main.cpp'), CORRECT);
    const cp = await checkpoints.check(
      task('main_solution', ['solutions/main.cpp']),
      SPEC,
      dir,
      signal
    );
    expect(cp).toEqual({ name: 'samples', ok: true, digest: '1 samples ok' });
  });

  it('a wrong solution gives the expected/got digest', async () => {
    await fs.writeFile(path.join(dir, 'brute.cpp'), WRONG);
    const cp = await checkpoints.check(
      task('brute_force', ['brute.cpp']),
      SPEC,
      dir,
      signal
    );
    expect(cp.ok).toBe(false);
    expect(cp.digest).toBe('sample 1: expected 2 got 7');
  });

  it('a syntax error gives the compiler error', async () => {
    await fs.writeFile(path.join(dir, 'main.cpp'), BROKEN);
    const cp = await checkpoints.check(
      task('main_solution', ['main.cpp']),
      SPEC,
      dir,
      signal
    );
    expect(cp.ok).toBe(false);
    expect(cp.digest).toMatch(/^compile error\n/);
    expect(cp.digest).toContain('main.cpp');
    expect(cp.digest.split('\n').length).toBeLessThanOrEqual(17);
  });

  it('wrong_solution only needs to compile', async () => {
    await fs.writeFile(path.join(dir, 'wa.cpp'), WRONG);
    const cp = await checkpoints.check(
      task('wrong_solution', ['wa.cpp']),
      SPEC,
      dir,
      signal
    );
    expect(cp.ok).toBe(true);
  });

  it('runOnInput reports a timeout', async () => {
    await fs.writeFile(
      path.join(dir, 'loop.cpp'),
      'int main() { volatile int x = 0; for (;;) x++; }\n'
    );
    const compiled = await compileCpp('loop.cpp', dir, signal);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    const run = await runOnInput(compiled.binary, '', 200, signal);
    expect(run).toEqual({
      ok: false,
      error: 'timed out after 200 ms',
      timedOut: true,
    });
    await removeBinary(compiled.binary);
  });
});

describe('CliCheckpoints with a fake runner', () => {
  it('statement: files must exist and not be empty', async () => {
    const checkpoints = new CliCheckpoints(new FakeRunner({}));
    await fs.writeFile(path.join(dir, 'legend.tex'), 'A legend');
    await fs.writeFile(path.join(dir, 'input.tex'), '  \n');
    const cp = await checkpoints.check(
      task('statement', ['legend.tex', 'input.tex', 'output.tex']),
      SPEC,
      dir,
      signal
    );
    expect(cp.ok).toBe(false);
    expect(cp.digest).toBe('missing: output.tex\nempty: input.tex');

    await fs.writeFile(path.join(dir, 'input.tex'), 'x');
    await fs.writeFile(path.join(dir, 'output.tex'), 'y');
    const good = await checkpoints.check(
      task('statement', ['legend.tex', 'input.tex', 'output.tex']),
      SPEC,
      dir,
      signal
    );
    expect(good.ok).toBe(true);
  });

  it('statement_critic is always ok', async () => {
    const checkpoints = new CliCheckpoints(new FakeRunner({}));
    const cp = await checkpoints.check(
      task('statement_critic'),
      SPEC,
      dir,
      signal
    );
    expect(cp.ok).toBe(true);
  });

  it('validator runs test validator and digests failed cases', async () => {
    const runner = new FakeRunner({
      'test validator --json': {
        exitCode: 1,
        json: {
          ok: false,
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
              message: 'accepted n = 0',
            },
          ],
        },
      },
    });
    await writeFiles(['validator/val.cpp']);
    const cp = await new CliCheckpoints(runner).check(
      task('validator', ['validator/val.cpp']),
      SPEC,
      dir,
      signal
    );
    expect(runner.calls).toEqual([['test', 'validator', '--json']]);
    expect(cp.ok).toBe(false);
    expect(cp.digest).toBe(
      'case 2: expected INVALID got VALID (accepted n = 0)'
    );
  });

  it('generators runs generate --all', async () => {
    const runner = new FakeRunner({});
    await writeFiles(['generators/gen.cpp']);
    const cp = await new CliCheckpoints(runner).check(
      task('generators', ['generators/gen.cpp']),
      SPEC,
      dir,
      signal
    );
    expect(runner.calls).toEqual([['generate', '--all', '--json']]);
    expect(cp.ok).toBe(true);
  });

  it('validator and generators fail when a file is missing or still the template', async () => {
    const template = await fs.mkdtemp(path.join(os.tmpdir(), 'polyman-tpl-'));
    try {
      await fs.mkdir(path.join(template, 'validator'));
      await fs.writeFile(path.join(template, 'validator/val.cpp'), 'tpl\n');
      await fs.mkdir(path.join(dir, 'validator'));
      await fs.writeFile(path.join(dir, 'validator/val.cpp'), 'tpl\n');
      const runner = new FakeRunner({});
      const checkpoints = new CliCheckpoints(runner, template);

      const same = await checkpoints.check(
        task('validator', ['validator/val.cpp', 'validator/tests.json']),
        SPEC,
        dir,
        signal
      );
      expect(same.ok).toBe(false);
      expect(same.name).toBe('validator files');
      expect(same.digest).toBe(
        'missing: validator/tests.json\nstill the template file, not written for this problem: validator/val.cpp'
      );

      const gen = await checkpoints.check(
        task('generators', ['./generators/gen.cpp']),
        SPEC,
        dir,
        signal
      );
      expect(gen.ok).toBe(false);
      expect(gen.digest).toBe('missing: generators/gen.cpp');
      // The CLI never ran: a worker that wrote nothing must not pass.
      expect(runner.calls).toEqual([]);

      await fs.writeFile(path.join(dir, 'validator/val.cpp'), 'mine\n');
      await writeFiles(['validator/tests.json']);
      const good = await checkpoints.check(
        task('validator', ['validator/val.cpp', 'validator/tests.json']),
        SPEC,
        dir,
        signal
      );
      expect(good.ok).toBe(true);
    } finally {
      await fs.rm(template, { recursive: true, force: true });
    }
  });

  it('generate_validate fails when Config.json still uses the template validator or script', async () => {
    const template = await fs.mkdtemp(path.join(os.tmpdir(), 'polyman-tpl-'));
    try {
      await fs.mkdir(path.join(template, 'generators'));
      await fs.writeFile(
        path.join(template, 'generators/gen-script.txt'),
        'g\n'
      );
      await fs.mkdir(path.join(dir, 'generators'));
      await fs.writeFile(path.join(dir, 'generators/gen-script.txt'), 'g\n');
      await writeFiles(['validator/val.cpp']);
      await fs.writeFile(
        path.join(dir, 'Config.json'),
        JSON.stringify({
          validator: { name: 'v', source: './validator/val.cpp' },
          generators: [{ name: 'gen', source: './generators/unused.cpp' }],
          testsets: [
            {
              name: 'tests',
              generatorScript: { scriptFile: './generators/gen-script.txt' },
            },
          ],
        })
      );
      const runner = new FakeRunner({});
      const out = await new CliCheckpoints(runner, template).runNoModelTask(
        task('generate_validate'),
        SPEC,
        dir,
        signal
      );
      expect(out.checkpoint.ok).toBe(false);
      expect(out.checkpoint.digest).toContain(
        'still the template file, not written for this problem: generators/gen-script.txt'
      );
      expect(runner.calls).toEqual([]);
    } finally {
      await fs.rm(template, { recursive: true, force: true });
    }
  });

  it('a timeout of the CLI is a failed checkpoint', async () => {
    const runner = new FakeRunner({
      'generate --all --json': { exitCode: null, reason: 'timeout' },
    });
    await writeFiles(['g.cpp']);
    const cp = await new CliCheckpoints(runner).check(
      task('generators', ['g.cpp']),
      SPEC,
      dir,
      signal
    );
    expect(cp).toEqual({
      name: 'generate',
      ok: false,
      digest: 'generate: timed out',
    });
  });

  it('scaffold needs Config.json and sets the limits from the spec', async () => {
    const checkpoints = new CliCheckpoints(new FakeRunner({}));
    const missing = await checkpoints.runNoModelTask(
      task('scaffold'),
      SPEC,
      dir,
      signal
    );
    expect(missing.checkpoint.ok).toBe(false);
    expect(missing.checkpoint.digest).toContain('Config.json not found');

    await fs.writeFile(path.join(dir, 'Config.json'), '{}');
    const out = await checkpoints.runNoModelTask(
      task('scaffold'),
      SPEC,
      dir,
      signal
    );
    expect(out.checkpoint.ok).toBe(true);
    expect(out.configPatch).toEqual({
      set: { timeLimit: 2000, memoryLimit: 512 },
    });
  });

  it('scaffold removes the template examples', async () => {
    const template = path.resolve(__dirname, '../../../template');
    await fs.cp(template, dir, { recursive: true });
    const checkpoints = new CliCheckpoints(new FakeRunner({}), template);
    const out = await checkpoints.runNoModelTask(
      task('scaffold'),
      SPEC,
      dir,
      signal
    );
    expect(out.checkpoint.ok).toBe(true);
    expect(out.checkpoint.digest).toContain(
      'removed template examples: solution correct2, solution tle_solution, test ./manual/tests/m-01-sample.in'
    );
    const config = JSON.parse(
      await fs.readFile(path.join(dir, 'Config.json'), 'utf-8')
    ) as { solutions: { name: string }[] };
    expect(config.solutions.map(s => s.name)).toEqual(['main']);
  });

  it('checker returns a config patch', async () => {
    const checkpoints = new CliCheckpoints(new FakeRunner({}));
    const out = await checkpoints.runNoModelTask(
      task('checker'),
      SPEC,
      dir,
      signal
    );
    expect(out.checkpoint).toEqual({
      name: 'checker',
      ok: true,
      digest: 'checker: ncmp',
    });
    expect(out.configPatch).toEqual({
      checker: { name: 'ncmp', isStandard: true },
    });
  });

  it('generate_validate runs generate then validate', async () => {
    const runner = new FakeRunner({
      'validate --all --json': {
        exitCode: 1,
        json: {
          ok: false,
          errors: [],
          tests: [
            {
              testset: 'tests',
              index: 3,
              valid: false,
              message: 'n is out of range',
            },
          ],
        },
      },
    });
    const out = await new CliCheckpoints(runner).runNoModelTask(
      task('generate_validate'),
      SPEC,
      dir,
      signal
    );
    expect(runner.calls).toEqual([
      ['generate', '--all', '--json'],
      ['validate', '--all', '--json'],
    ]);
    expect(out.checkpoint).toEqual({
      name: 'validate',
      ok: false,
      digest: 'test tests#3 invalid: n is out of range',
    });
  });

  it('generate_validate names the generator line or manual test of an invalid test', async () => {
    const runner = new FakeRunner({
      'generate --all --json': {
        exitCode: 0,
        json: {
          ok: true,
          errors: [],
          tests: [
            { testset: 'tests', index: 1, source: 'manual', ok: true },
            {
              testset: 'tests',
              index: 2,
              source: 'generator',
              generator: 'gen-edge',
              args: ['max_ans'],
              ok: true,
            },
          ],
        },
      },
      'validate --all --json': {
        exitCode: 1,
        json: {
          ok: false,
          errors: ['Some tests failed validation'],
          tests: [
            { testset: 'tests', index: 1, valid: false, message: 'bad eoln' },
            { testset: 'tests', index: 2, valid: false, message: 'n too big' },
          ],
        },
      },
    });
    const out = await new CliCheckpoints(runner).runNoModelTask(
      task('generate_validate'),
      SPEC,
      dir,
      signal
    );
    const lines = out.checkpoint.digest.split('\n');
    expect(lines[0]).toBe(
      'test tests#1 (from a manual test) invalid: bad eoln'
    );
    expect(lines[1]).toBe(
      'test tests#2 (from generator gen-edge max_ans) invalid: n too big'
    );
    expect(lines[2]).toMatch(/generator \(or manual test\) is wrong/);
  });

  it('verify digests the report and names the solution files', async () => {
    await fs.writeFile(
      path.join(dir, 'Config.json'),
      JSON.stringify({
        solutions: [
          { name: 'wa-1', source: './solutions/wa-1.cpp', tag: 'WA' },
        ],
      })
    );
    const runner = new FakeRunner({
      'verify --json': {
        exitCode: 1,
        json: {
          ok: false,
          failedStep: 'solutions',
          steps: [
            {
              name: 'solutions',
              ok: false,
              errors: ['wa-1 does not match its tag'],
            },
          ],
          warnings: [],
          solutions: [
            {
              name: 'wa-1',
              tag: 'WA',
              matchesTag: false,
              reason: 'passed every test',
              tests: [
                {
                  testset: 'tests',
                  index: 1,
                  verdict: 'OK',
                  timeMs: 3,
                  message: '',
                },
              ],
            },
          ],
        },
      },
    });
    const out = await new CliCheckpoints(runner).runNoModelTask(
      task('verify'),
      SPEC,
      dir,
      signal
    );
    expect(out.checkpoint.ok).toBe(false);
    expect(out.checkpoint.digest).toBe(
      [
        'failed step: solutions',
        'solutions: wa-1 does not match its tag',
        'solution wa-1 (solutions/wa-1.cpp) tag WA: passed every test',
      ].join('\n')
    );
  });

  it('verify passes on exit 0', async () => {
    const out = await new CliCheckpoints(new FakeRunner({})).runNoModelTask(
      task('verify'),
      SPEC,
      dir,
      signal
    );
    expect(out.checkpoint).toEqual({
      name: 'verify',
      ok: true,
      digest: 'verify passed',
    });
  });
});

describe('chooseChecker', () => {
  it('uses the Checker decision first', () => {
    expect(
      chooseChecker('# Output\nYES or NO\n# Decisions\n- Checker: wcmp.')
    ).toEqual({
      name: 'wcmp',
    });
    expect(chooseChecker('# Decisions\n- Checker: magic')).toHaveProperty(
      'error'
    );
  });

  it('picks from the output section', () => {
    expect(chooseChecker('# Output\nOne integer: the answer.')).toEqual({
      name: 'ncmp',
    });
    expect(
      chooseChecker('# Output\nPrint YES if it is possible, else NO.')
    ).toEqual({
      name: 'yesno',
    });
    expect(chooseChecker('# Output\nThe resulting string.')).toEqual({
      name: 'wcmp',
    });
  });

  it('refuses "any valid answer"', () => {
    expect(
      chooseChecker(
        '# Output\nAny permutation. If there are many, print any valid answer.'
      )
    ).toEqual({ error: 'custom checker needed, not supported yet' });
  });
});

describe('verifyDigest', () => {
  it('handles a missing report', () => {
    expect(verifyDigest(undefined)).toBe('verify printed no JSON report');
  });
});

describe('MemoCheckpoints', () => {
  class Counting implements Checkpoints {
    checks = 0;
    result: Checkpoint = { name: 'generate', ok: true, digest: '' };
    check(): Promise<Checkpoint> {
      this.checks++;
      return Promise.resolve({ ...this.result });
    }
    runNoModelTask(): Promise<{ checkpoint: Checkpoint }> {
      return Promise.resolve({ checkpoint: { ...this.result } });
    }
  }

  it('skips the second check of a task when its files did not change', async () => {
    const inner = new Counting();
    const memo = new MemoCheckpoints(inner);
    const t = task('generators', ['gen.cpp']);
    await fs.writeFile(path.join(dir, 'gen.cpp'), 'v1');
    await fs.writeFile(path.join(dir, 'Config.json'), '{}');

    expect((await memo.check(t, SPEC, dir, signal)).ok).toBe(true);
    expect((await memo.check(t, SPEC, dir, signal)).ok).toBe(true);
    expect(inner.checks).toBe(1);

    // A changed owned file or Config.json runs the check again.
    await fs.writeFile(path.join(dir, 'gen.cpp'), 'v2');
    await memo.check(t, SPEC, dir, signal);
    expect(inner.checks).toBe(2);
    await fs.writeFile(path.join(dir, 'Config.json'), '{"a":1}');
    await memo.check(t, SPEC, dir, signal);
    expect(inner.checks).toBe(3);
  });

  it('never remembers a failed check', async () => {
    const inner = new Counting();
    inner.result = { name: 'generate', ok: false, digest: 'bad' };
    const memo = new MemoCheckpoints(inner);
    const t = task('generators', ['gen.cpp']);
    await fs.writeFile(path.join(dir, 'gen.cpp'), 'v1');
    await memo.check(t, SPEC, dir, signal);
    await memo.check(t, SPEC, dir, signal);
    expect(inner.checks).toBe(2);
  });
});
