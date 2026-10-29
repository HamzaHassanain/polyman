/**
 * The checks of `prove_idea`: real runs of the quick programs, never the
 * model's opinion. A brute force judges the intended solution on many small
 * random tests, the samples of the spec are checked against both, the
 * intended solution must run a max test in the time limit, and each wrong
 * approach must really fail.
 */

import {
  compileCpp,
  removeBinary,
  runOnInput,
  sameTokens,
  type RunOutput,
} from './compile';
import { PROVE_DIR } from './recipes';
import { parseSpec } from './spec';
import type { Checkpoint, PlanTask, Spec } from './types';

/** The sizes of one proof. */
export const PROVE_LIMITS = {
  /** Small random tests of the stress test and of each wrong approach. */
  smallTests: 300,
  /** Max tests of the time check and of each wrong approach. */
  maxTests: 3,
  /** Time of one run on a small test. */
  smallTimeoutMs: 2000,
  /** Time of one generator run. */
  genTimeoutMs: 10_000,
  /** The time limit when the spec has none. */
  defaultTimeLimitMs: 1000,
};

/** The quick programs, inside the problem folder. */
export const PROVE_FILES = {
  brute: `${PROVE_DIR}/brute.cpp`,
  main: `${PROVE_DIR}/main.cpp`,
  gen: `${PROVE_DIR}/gen.cpp`,
};

const MAX_DIGEST_LINES = 20;

function ok(name: string, digest: string): Checkpoint {
  return { name, ok: true, digest };
}

function fail(name: string, digest: string): Checkpoint {
  const lines = digest.trim().split('\n');
  const shown =
    lines.length <= MAX_DIGEST_LINES
      ? lines
      : [
          ...lines.slice(0, MAX_DIGEST_LINES),
          `... ${lines.length - MAX_DIGEST_LINES} more lines`,
        ];
  return { name, ok: false, digest: shown.join('\n') };
}

/** `0.41 s`. */
export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)} s`;
}

/** The output on one line, cut. */
function short(text: string, max = 60): string {
  const flat = text.trim().replace(/\s+/g, ' ');
  if (flat === '') return '(nothing)';
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

/** A test input for the digest, at most `lines` lines. */
function showInput(input: string, lines = 8): string[] {
  const all = input.trimEnd().split('\n');
  const shown = all.slice(0, lines).map(l => `  ${l.slice(0, 100)}`);
  if (all.length > lines) shown.push(`  ... ${all.length - lines} more lines`);
  return shown;
}

function withEol(text: string): string {
  return text.endsWith('\n') ? text : `${text}\n`;
}

/** Compiled programs by name, or the compile error of the first bad one. */
type Binaries = Record<string, string>;

/**
 * Compiles `files` (name to source), runs `fn` with the binaries, and
 * removes them after, even on an error.
 */
async function withBinaries(
  name: string,
  files: Record<string, string>,
  problemDir: string,
  signal: AbortSignal,
  fn: (bin: Binaries) => Promise<Checkpoint>
): Promise<Checkpoint> {
  const bin: Binaries = {};
  try {
    for (const [key, file] of Object.entries(files)) {
      const compiled = await compileCpp(file, problemDir, signal);
      if (!compiled.ok) {
        const error = compiled.error.trim().split('\n').slice(0, 15);
        return fail(name, [`${file}: compile error`, ...error].join('\n'));
      }
      bin[key] = compiled.binary;
    }
    return await fn(bin);
  } finally {
    await Promise.all(Object.values(bin).map(b => removeBinary(b)));
  }
}

/** One test from the generator: `gen <seed> small|max`. */
function generate(
  gen: string,
  seed: number,
  mode: 'small' | 'max',
  signal: AbortSignal
): Promise<RunOutput> {
  return runOnInput(gen, '', PROVE_LIMITS.genTimeoutMs, signal, [
    String(seed),
    mode,
  ]);
}

/** The time limit of the spec, and whether the spec had one. */
function timeLimit(spec: Spec): { ms: number; fromSpec: boolean } {
  const ms = parseSpec(spec).timeLimitMs;
  return ms === undefined
    ? { ms: PROVE_LIMITS.defaultTimeLimitMs, fromSpec: false }
    : { ms, fromSpec: true };
}

/** The time a run on a max test may take: 3 times the limit, 15 s at most. */
function maxRunTimeout(limitMs: number): number {
  return Math.min(limitMs * 3, 15_000);
}

/**
 * The worker check of the quick programs. A brute force and the main
 * solution must compile and run on every sample input (the outputs are
 * compared later, by `sample_check`: a sample may be the wrong one). The
 * generator must give a test for each seed, the same one for the same
 * seed, and different ones for different seeds. A wrong solution must
 * compile.
 */
export async function protoCheck(
  task: PlanTask,
  spec: Spec,
  problemDir: string,
  signal: AbortSignal
): Promise<Checkpoint> {
  const file = task.ownsFiles[0];
  if (file === undefined) return fail('compile', 'the task owns no file');
  switch (task.kind) {
    case 'proto_brute':
    case 'proto_main':
      return withBinaries('samples', { prog: file }, problemDir, signal, bin =>
        runsOnSamples(bin['prog'], spec, signal)
      );
    case 'proto_gen':
      return withBinaries('generator', { gen: file }, problemDir, signal, bin =>
        generatorWorks(bin['gen'], signal)
      );
    default:
      return withBinaries('compile', { prog: file }, problemDir, signal, () =>
        Promise.resolve(ok('compile', 'compiles'))
      );
  }
}

async function runsOnSamples(
  binary: string,
  spec: Spec,
  signal: AbortSignal
): Promise<Checkpoint> {
  const samples = parseSpec(spec).samples;
  for (const sample of samples) {
    const run = await runOnInput(binary, withEol(sample.input), 5000, signal);
    if (!run.ok) return fail('samples', `sample ${sample.index}: ${run.error}`);
  }
  return ok(
    'samples',
    samples.length > 0
      ? `compiles, runs on ${samples.length} samples`
      : 'compiles, no samples in the spec'
  );
}

async function generatorWorks(
  gen: string,
  signal: AbortSignal
): Promise<Checkpoint> {
  const small: string[] = [];
  for (let seed = 1; seed <= 5; seed++) {
    const run = await generate(gen, seed, 'small', signal);
    if (!run.ok) return fail('generator', `gen ${seed} small: ${run.error}`);
    if (run.stdout.trim() === '')
      return fail('generator', `gen ${seed} small printed nothing`);
    small.push(run.stdout);
  }
  const again = await generate(gen, 1, 'small', signal);
  if (!again.ok || again.stdout !== small[0]) {
    return fail(
      'generator',
      'gen 1 small gave another test the second time: seed the random generator with the seed'
    );
  }
  if (new Set(small).size === 1) {
    return fail(
      'generator',
      'seeds 1 to 5 gave the same test: use the seed for the random values'
    );
  }
  const max = await generate(gen, 1, 'max', signal);
  if (!max.ok) return fail('generator', `gen 1 max: ${max.error}`);
  if (max.stdout.trim() === '')
    return fail('generator', 'gen 1 max printed nothing');
  return ok('generator', 'small and max tests, one per seed');
}

/** Runs a `prove_idea` check: stress, samples, max test or a wrong one. */
export function proveCheck(
  task: PlanTask,
  spec: Spec,
  problemDir: string,
  signal: AbortSignal
): Promise<Checkpoint> {
  const { brute, main, gen } = PROVE_FILES;
  switch (task.kind) {
    case 'stress':
      return withBinaries(
        'stress',
        { brute, main, gen },
        problemDir,
        signal,
        bin => stress(bin, signal)
      );
    case 'sample_check':
      return withBinaries('samples', { brute, main }, problemDir, signal, bin =>
        sampleCheck(bin, spec, signal)
      );
    case 'max_test':
      return withBinaries('max test', { main, gen }, problemDir, signal, bin =>
        maxTest(bin, spec, signal)
      );
    case 'kill_wrong': {
      const wrong = task.params?.['file'];
      const tag = task.params?.['tag'] ?? 'WA';
      if (!wrong) return Promise.resolve(fail('kill', 'the task has no file'));
      return withBinaries(
        'kill',
        { wrong, main, gen },
        problemDir,
        signal,
        bin => kill(bin, tag, spec, signal)
      );
    }
    default:
      return Promise.resolve(
        fail(task.kind, `kind ${task.kind} is not a prove check`)
      );
  }
}

/** Brute and main must agree on every small random test. */
async function stress(bin: Binaries, signal: AbortSignal): Promise<Checkpoint> {
  const count = PROVE_LIMITS.smallTests;
  for (let seed = 1; seed <= count; seed++) {
    if (signal.aborted) return fail('stress', 'cancelled');
    const test = await generate(bin['gen'], seed, 'small', signal);
    if (!test.ok) return fail('stress', `gen ${seed} small: ${test.error}`);
    const run = (b: string): Promise<RunOutput> =>
      runOnInput(b, test.stdout, PROVE_LIMITS.smallTimeoutMs, signal);
    const brute = await run(bin['brute']);
    if (!brute.ok) {
      return fail(
        'stress',
        [
          `small test ${seed}: brute ${brute.error}`,
          'input:',
          ...showInput(test.stdout),
        ].join('\n')
      );
    }
    const main = await run(bin['main']);
    if (!main.ok) {
      return fail(
        'stress',
        [
          `small test ${seed}: main ${main.error}`,
          'input:',
          ...showInput(test.stdout),
        ].join('\n')
      );
    }
    if (!sameTokens(brute.stdout, main.stdout)) {
      return fail(
        'stress',
        [
          `small test ${seed}: brute says ${short(brute.stdout, 30)}, main says ${short(main.stdout, 30)}`,
          'input:',
          ...showInput(test.stdout),
          `brute: ${short(brute.stdout, 200)}`,
          `main: ${short(main.stdout, 200)}`,
        ].join('\n')
      );
    }
  }
  return ok('stress', `${count} random small tests: brute = main`);
}

/**
 * The samples of the spec against brute and main. When brute and main agree
 * and the spec does not, the sample is the likely mistake: two programs
 * written apart agree, the hand-made output does not.
 */
async function sampleCheck(
  bin: Binaries,
  spec: Spec,
  signal: AbortSignal
): Promise<Checkpoint> {
  const samples = parseSpec(spec).samples;
  if (samples.length === 0) return fail('samples', 'the spec has no samples');
  const issues: string[] = [];
  for (const sample of samples) {
    const input = withEol(sample.input);
    const brute = await runOnInput(bin['brute'], input, 5000, signal);
    const main = await runOnInput(bin['main'], input, 5000, signal);
    if (!brute.ok || !main.ok) {
      const which = !brute.ok ? `brute ${brute.error}` : '';
      const other = !main.ok ? `main ${main.error}` : '';
      issues.push(
        `sample ${sample.index}: ${[which, other].filter(Boolean).join(', ')}`
      );
      continue;
    }
    const agree = sameTokens(brute.stdout, main.stdout);
    if (agree && sameTokens(brute.stdout, sample.output)) continue;
    issues.push(
      agree
        ? `sample ${sample.index} looks wrong: the spec says ${short(sample.output, 40)}, brute and main say ${short(brute.stdout, 40)}`
        : `sample ${sample.index}: brute says ${short(brute.stdout, 30)}, main says ${short(main.stdout, 30)}, the spec says ${short(sample.output, 30)}`
    );
  }
  if (issues.length > 0) return fail('samples', issues.join('\n'));
  return ok('samples', `${samples.length} samples: spec = brute = main`);
}

/** Main must run each max test in the time limit. */
async function maxTest(
  bin: Binaries,
  spec: Spec,
  signal: AbortSignal
): Promise<Checkpoint> {
  const limit = timeLimit(spec);
  const timeout = maxRunTimeout(limit.ms);
  let slowest = 0;
  for (let seed = 1; seed <= PROVE_LIMITS.maxTests; seed++) {
    const test = await generate(bin['gen'], seed, 'max', signal);
    if (!test.ok) return fail('max test', `gen ${seed} max: ${test.error}`);
    const run = await runOnInput(bin['main'], test.stdout, timeout, signal);
    if (!run.ok) {
      return fail(
        'max test',
        run.timedOut
          ? `max test ${seed}: main ran over ${seconds(timeout)}, the time limit is ${seconds(limit.ms)}`
          : `max test ${seed}: main ${run.error}`
      );
    }
    if (run.ms > limit.ms) {
      return fail(
        'max test',
        `max test ${seed}: main took ${seconds(run.ms)}, the time limit is ${seconds(limit.ms)}`
      );
    }
    slowest = Math.max(slowest, run.ms);
  }
  return ok(
    'max test',
    `slowest max test ${seconds(slowest)} of ${seconds(limit.ms)}${limit.fromSpec ? '' : ' (no time limit in the spec)'}`
  );
}

/** One test of {@link kill}. */
interface KillTest {
  label: string;
  seed: number;
  mode: 'small' | 'max';
}

/**
 * A wrong approach must fail the way its tag says: TL is too slow on a max
 * test, RE crashes, WA and PE give another answer than main, RJ does any
 * of these. Max tests go first: an overflow shows only on big values.
 */
async function kill(
  bin: Binaries,
  tag: string,
  spec: Spec,
  signal: AbortSignal
): Promise<Checkpoint> {
  const limit = timeLimit(spec);
  const maxTimeout = maxRunTimeout(limit.ms);
  const tests: KillTest[] = [];
  for (let seed = 1; seed <= PROVE_LIMITS.maxTests; seed++)
    tests.push({ label: `max test ${seed}`, seed, mode: 'max' });
  if (tag !== 'TL') {
    for (let seed = 1; seed <= PROVE_LIMITS.smallTests; seed++)
      tests.push({ label: `small test ${seed}`, seed, mode: 'small' });
  }

  let slowest = 0;
  for (const t of tests) {
    if (signal.aborted) return fail('kill', 'cancelled');
    const test = await generate(bin['gen'], t.seed, t.mode, signal);
    if (!test.ok) return fail('kill', `gen ${t.seed} ${t.mode}: ${test.error}`);
    const timeout = t.mode === 'max' ? maxTimeout : PROVE_LIMITS.smallTimeoutMs;
    const wrong = await runOnInput(bin['wrong'], test.stdout, timeout, signal);

    if (tag === 'TL') {
      if (!wrong.ok && wrong.timedOut) {
        return ok(
          'kill',
          `killed: ${t.label} ran over ${seconds(timeout)}, the limit is ${seconds(limit.ms)}`
        );
      }
      if (wrong.ok && wrong.ms > limit.ms) {
        return ok(
          'kill',
          `killed: ${t.label} took ${seconds(wrong.ms)}, the limit is ${seconds(limit.ms)}`
        );
      }
      if (wrong.ok) slowest = Math.max(slowest, wrong.ms);
      continue;
    }

    if (!wrong.ok) {
      if (tag === 'RE' && !wrong.timedOut) {
        return ok('kill', `killed: crashed on ${t.label} (${wrong.error})`);
      }
      if (tag === 'RJ') {
        return ok('kill', `killed: ${wrong.error} on ${t.label}`);
      }
      continue;
    }
    if (tag === 'RE') continue;
    const main = await runOnInput(bin['main'], test.stdout, timeout, signal);
    if (!main.ok) {
      return fail('kill', `main ${main.error} on ${t.label}, cannot judge it`);
    }
    if (!sameTokens(main.stdout, wrong.stdout)) {
      return ok(
        'kill',
        [
          `killed by ${t.label}: main says ${short(main.stdout, 30)}, it says ${short(wrong.stdout, 30)}`,
          ...(t.mode === 'small' ? ['input:', ...showInput(test.stdout)] : []),
        ].join('\n')
      );
    }
  }

  if (tag === 'TL') {
    return fail(
      'kill',
      `not killed: it ran every max test in the time limit (slowest ${seconds(slowest)} of ${seconds(limit.ms)})`
    );
  }
  return fail(
    'kill',
    [
      `not killed: it passed ${PROVE_LIMITS.maxTests} max and ${PROVE_LIMITS.smallTests} small tests`,
      'This approach may be right for this problem, or it needs a special test the random tests miss.',
    ].join('\n')
  );
}
