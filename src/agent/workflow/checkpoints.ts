/**
 * The real checks of each task kind (doc 10, "Checkpoint (our code)"). The
 * model never decides if a task passed: these checks do, with the compiler
 * and the polyman CLI.
 */

import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import type {
  GenerateReport,
  SelfTestReport,
  ValidateReport,
  VerifyReport,
} from '../../types';
import type { CliRunner, RunResult } from '../runner/types';
import { compileCpp, removeBinary, runOnInput, sameTokens } from './compile';
import { dropTemplateExamples } from './config-patch';
import { protoCheck, proveCheck } from './prove';
import { normalizePath } from './recipes';
import { parseSpec } from './spec';
import type {
  Checkpoint,
  Checkpoints,
  ConfigPatch,
  PlanTask,
  Spec,
} from './types';

/** Standard checkers the checker task may pick (from `assets/checkers`). */
export const STANDARD_CHECKERS = [
  'acmp',
  'caseicmp',
  'casencmp',
  'casewcmp',
  'dcmp',
  'fcmp',
  'hcmp',
  'icmp',
  'lcmp',
  'ncmp',
  'nyesno',
  'rcmp',
  'rcmp4',
  'rcmp6',
  'rcmp9',
  'rncmp',
  'uncmp',
  'wcmp',
  'yesno',
];

const TIMEOUTS = {
  testValidator: 120_000,
  generate: 300_000,
  validate: 300_000,
  verify: 600_000,
};

const MAX_DIGEST_LINES = 20;

/** The folder `polyman new` copies, next to `src/` and `dist/`. */
export const TEMPLATE_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'template'
);

function ok(name: string, digest = ''): Checkpoint {
  return { name, ok: true, digest };
}

function fail(name: string, digest: string): Checkpoint {
  return { name, ok: false, digest: clip(digest) };
}

/** Keeps a digest short: at most {@link MAX_DIGEST_LINES} lines. */
function clip(text: string, lines = MAX_DIGEST_LINES): string {
  const all = text.trim().split('\n');
  if (all.length <= lines) return all.join('\n');
  return [...all.slice(0, lines), `... ${all.length - lines} more lines`].join(
    '\n'
  );
}

function oneLine(text: string, max = 120): string {
  const flat = text.trim().replace(/\s+/g, ' ');
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Why a CLI run that did not exit 0 failed, from its stderr. */
function runFailure(result: RunResult, what: string): string {
  if (result.reason === 'timeout') return `${what}: timed out`;
  if (result.reason === 'cancelled') return `${what}: cancelled`;
  const tail = result.stderrTail.trim().split('\n').slice(-10).join('\n');
  return `${what}: exit code ${String(result.exitCode)}${tail ? `\n${tail}` : ''}`;
}

/** A short digest of `generate --json`. */
export function generateDigest(report: unknown): string[] {
  if (!isObject(report)) return [];
  const r = report as Partial<GenerateReport>;
  const lines = [...(r.errors ?? [])];
  for (const t of r.tests ?? []) {
    if (!t.ok) {
      lines.push(
        `test ${t.testset}#${t.index}${t.generator ? ` (${t.generator})` : ''}: ${t.error ?? 'failed'}`
      );
    }
  }
  return lines;
}

/**
 * Where each test came from, from a `generate --json` report: like
 * `tests#3` -> `generator gen-edge max_ans` or `a manual test`.
 */
export function testOrigins(report: unknown): Map<string, string> {
  const origins = new Map<string, string>();
  if (!isObject(report)) return origins;
  const r = report as Partial<GenerateReport>;
  for (const t of r.tests ?? []) {
    origins.set(
      `${t.testset}#${t.index}`,
      t.source === 'manual'
        ? 'a manual test'
        : `generator ${[t.generator ?? '?', ...(t.args ?? [])].join(' ')}`
    );
  }
  return origins;
}

/**
 * A short digest of `validate --json`. With `origins` (see
 * {@link testOrigins}) each invalid test says which generator line or
 * manual test made it, so the manager knows which task to redo.
 */
export function validateDigest(
  report: unknown,
  origins: Map<string, string> = new Map()
): string[] {
  if (!isObject(report)) return [];
  const r = report as Partial<ValidateReport>;
  const lines: string[] = [];
  let invalid = 0;
  for (const t of r.tests ?? []) {
    if (t.valid) continue;
    invalid++;
    const origin = origins.get(`${t.testset}#${t.index}`);
    lines.push(
      `test ${t.testset}#${t.index}${origin ? ` (from ${origin})` : ''} invalid: ${oneLine(t.message)}`
    );
  }
  if (invalid === 0) return [...(r.errors ?? [])];
  if (origins.size > 0) {
    lines.push(
      'If the test breaks the constraints of the spec, the generator (or manual test) is wrong. If the test is valid, the validator is wrong.'
    );
  }
  return lines;
}

/** A short digest of `test validator --json`. */
export function selfTestDigest(report: unknown): string[] {
  if (!isObject(report)) return [];
  const r = report as Partial<SelfTestReport>;
  const lines = [...(r.errors ?? [])];
  for (const c of r.cases ?? []) {
    if (!c.ok) {
      lines.push(
        `case ${c.index}: expected ${c.expected} got ${String(c.actual)}${c.message ? ` (${oneLine(c.message, 80)})` : ''}`
      );
    }
  }
  return lines;
}

/**
 * A short digest of `verify --json`: the failed step and its errors, then
 * each solution that does not match its tag, with its source file so the
 * fix loop knows which files to give the fixer.
 */
export function verifyDigest(
  report: unknown,
  sources: Record<string, string> = {}
): string {
  if (!isObject(report)) return 'verify printed no JSON report';
  const r = report as Partial<VerifyReport>;
  if (r.ok) return 'verify passed';
  const lines: string[] = [];
  if (r.failedStep) lines.push(`failed step: ${r.failedStep}`);
  for (const step of r.steps ?? []) {
    if (step.ok) continue;
    for (const error of step.errors.slice(0, 5)) {
      lines.push(`${step.name}: ${oneLine(error, 160)}`);
    }
  }
  for (const s of r.solutions ?? []) {
    if (s.matchesTag) continue;
    const source = sources[s.name];
    const bad = s.tests.find(t => t.verdict !== 'OK');
    lines.push(
      `solution ${s.name}${source ? ` (${source})` : ''} tag ${s.tag}: ${oneLine(s.reason, 120)}` +
        (bad
          ? `; test ${bad.index}: ${bad.verdict}${bad.message ? ` ${oneLine(bad.message, 80)}` : ''}`
          : '')
    );
  }
  if (lines.length === 0) lines.push('verify failed');
  return clip(lines.join('\n'));
}

/** The checker a spec asks for, or an error when it needs a custom one. */
export function chooseChecker(
  spec: Spec
): { name: string } | { error: string } {
  const parsed = parseSpec(spec);
  if (parsed.checker) {
    const name = parsed.checker.toLowerCase();
    if (!STANDARD_CHECKERS.includes(name)) {
      return {
        error: `unknown standard checker ${parsed.checker}, use one of ${STANDARD_CHECKERS.join(', ')}`,
      };
    }
    return { name };
  }
  const output = parsed.sections['Output'] ?? '';
  if (/any (valid|correct) answer|any of them/i.test(`${output}\n${spec}`)) {
    return { error: 'custom checker needed, not supported yet' };
  }
  if (/\byes\b/i.test(output) && /\bno\b/i.test(output))
    return { name: 'yesno' };
  if (/\b(real|float|floating|decimal|precision)\b/i.test(output)) {
    return { name: 'wcmp' };
  }
  if (/\bintegers?\b|\bnumbers?\b/i.test(output)) return { name: 'ncmp' };
  return { name: 'wcmp' };
}

/** Reads solution name to source path from Config.json, best effort. */
async function solutionSources(
  problemDir: string
): Promise<Record<string, string>> {
  try {
    const config: unknown = JSON.parse(
      await fs.readFile(path.join(problemDir, 'Config.json'), 'utf-8')
    );
    const sources: Record<string, string> = {};
    if (isObject(config) && Array.isArray(config['solutions'])) {
      for (const s of config['solutions'] as unknown[]) {
        if (
          isObject(s) &&
          typeof s['name'] === 'string' &&
          typeof s['source'] === 'string'
        ) {
          sources[s['name']] = normalizePath(s['source']);
        }
      }
    }
    return sources;
  } catch {
    return {};
  }
}

/**
 * The validator and generator script files that Config.json uses, best
 * effort: the files `validate` and `generate` start from.
 */
export async function testFiles(problemDir: string): Promise<string[]> {
  let config: unknown;
  try {
    config = JSON.parse(
      await fs.readFile(path.join(problemDir, 'Config.json'), 'utf-8')
    );
  } catch {
    return [];
  }
  if (!isObject(config)) return [];
  const files: string[] = [];
  const add = (value: unknown): void => {
    if (typeof value === 'string' && value !== '') {
      const file = normalizePath(value);
      if (!files.includes(file)) files.push(file);
    }
  };
  const validator = config['validator'];
  if (isObject(validator)) add(validator['source']);
  // Not every generator entry: an unused template generator may stay in
  // Config.json. The script names the generators that run.
  if (Array.isArray(config['testsets'])) {
    for (const t of config['testsets'] as unknown[]) {
      const script = isObject(t) ? t['generatorScript'] : undefined;
      if (isObject(script)) add(script['scriptFile']);
    }
  }
  return files;
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/** The checkpoints, built on the real CLI through a {@link CliRunner}. */
export class CliCheckpoints implements Checkpoints {
  constructor(
    private readonly runner: CliRunner,
    /** Where the template examples that scaffold removes come from. */
    private readonly templateDir: string = TEMPLATE_DIR
  ) {}

  async check(
    task: PlanTask,
    spec: Spec,
    problemDir: string,
    signal: AbortSignal
  ): Promise<Checkpoint> {
    switch (task.kind) {
      case 'statement': {
        const unwritten = await this.unwrittenFiles(task.ownsFiles, problemDir);
        return unwritten ? fail('files', unwritten) : ok('files');
      }
      case 'statement_critic':
        return ok('critic');
      case 'main_solution':
      case 'brute_force':
        return this.samples(task, spec, problemDir, signal);
      case 'wrong_solution':
      case 'fix':
        return this.compiles(task, problemDir, signal);
      case 'proto_brute':
      case 'proto_main':
      case 'proto_gen':
      case 'proto_wrong':
        return protoCheck(task, spec, problemDir, signal);
      case 'validator': {
        const unwritten = await this.unwrittenFiles(task.ownsFiles, problemDir);
        if (unwritten) return fail('validator files', unwritten);
        const result = await this.cli(
          ['test', 'validator', '--json'],
          problemDir,
          TIMEOUTS.testValidator,
          signal
        );
        if (typeof result === 'string') return fail('test validator', result);
        if (result.exitCode === 0) return ok('test validator');
        const lines = selfTestDigest(result.json);
        return fail(
          'test validator',
          lines.length > 0
            ? lines.join('\n')
            : runFailure(result, 'test validator')
        );
      }
      case 'generators': {
        const unwritten = await this.unwrittenFiles(task.ownsFiles, problemDir);
        if (unwritten) return fail('generator files', unwritten);
        const result = await this.cli(
          ['generate', '--all', '--json'],
          problemDir,
          TIMEOUTS.generate,
          signal
        );
        if (typeof result === 'string') return fail('generate', result);
        if (result.exitCode === 0) return ok('generate');
        const lines = generateDigest(result.json);
        return fail(
          'generate',
          lines.length > 0 ? lines.join('\n') : runFailure(result, 'generate')
        );
      }
      default:
        return fail('checkpoint', `kind ${task.kind} has no worker checkpoint`);
    }
  }

  async runNoModelTask(
    task: PlanTask,
    spec: Spec,
    problemDir: string,
    signal: AbortSignal
  ): Promise<{ checkpoint: Checkpoint; configPatch?: ConfigPatch }> {
    switch (task.kind) {
      case 'scaffold': {
        if (!(await exists(path.join(problemDir, 'Config.json')))) {
          return {
            checkpoint: fail(
              'scaffold',
              `Config.json not found in ${problemDir}, create the problem first`
            ),
          };
        }
        // The template's example solutions and tests do not fit the new
        // problem, and the plan does not replace them.
        const dropped = await dropTemplateExamples(
          problemDir,
          this.templateDir
        );
        if ('error' in dropped) {
          return {
            checkpoint: fail(
              'scaffold',
              `cannot remove the template examples: ${dropped.error}`
            ),
          };
        }
        const removed = [
          ...dropped.solutions.map(s => `solution ${s}`),
          ...dropped.manualTests.map(t => `test ${t}`),
          ...dropped.statements.map(l => `statement ${l}`),
        ];
        const parsed = parseSpec(spec);
        const set: NonNullable<ConfigPatch['set']> = {};
        if (parsed.timeLimitMs !== undefined)
          set.timeLimit = parsed.timeLimitMs;
        if (parsed.memoryLimitMb !== undefined)
          set.memoryLimit = parsed.memoryLimitMb;
        const lines = [
          Object.keys(set).length > 0
            ? `limits: ${JSON.stringify(set)}`
            : 'no limits in the spec',
        ];
        if (removed.length > 0) {
          lines.push(`removed template examples: ${removed.join(', ')}`);
        }
        const checkpoint = ok('scaffold', lines.join('\n'));
        return Object.keys(set).length > 0
          ? { checkpoint, configPatch: { set } }
          : { checkpoint };
      }
      case 'checker': {
        const choice = chooseChecker(spec);
        if ('error' in choice)
          return { checkpoint: fail('checker', choice.error) };
        return {
          checkpoint: ok('checker', `checker: ${choice.name}`),
          configPatch: { checker: { name: choice.name, isStandard: true } },
        };
      }
      case 'generate_validate': {
        const used = await testFiles(problemDir);
        const unwritten =
          used.length > 0 ? await this.unwrittenFiles(used, problemDir) : null;
        if (unwritten) {
          return {
            checkpoint: fail(
              'test files',
              `${unwritten}\nThe validator and generator tasks must write these files for this problem.`
            ),
          };
        }
        const gen = await this.cli(
          ['generate', '--all', '--json'],
          problemDir,
          TIMEOUTS.generate,
          signal
        );
        if (typeof gen === 'string')
          return { checkpoint: fail('generate', gen) };
        if (gen.exitCode !== 0) {
          const lines = generateDigest(gen.json);
          return {
            checkpoint: fail(
              'generate',
              lines.length > 0 ? lines.join('\n') : runFailure(gen, 'generate')
            ),
          };
        }
        const val = await this.cli(
          ['validate', '--all', '--json'],
          problemDir,
          TIMEOUTS.validate,
          signal
        );
        if (typeof val === 'string')
          return { checkpoint: fail('validate', val) };
        if (val.exitCode !== 0) {
          const lines = validateDigest(val.json, testOrigins(gen.json));
          return {
            checkpoint: fail(
              'validate',
              lines.length > 0 ? lines.join('\n') : runFailure(val, 'validate')
            ),
          };
        }
        return { checkpoint: ok('generate + validate') };
      }
      case 'verify': {
        const result = await this.cli(
          ['verify', '--json'],
          problemDir,
          TIMEOUTS.verify,
          signal
        );
        if (typeof result === 'string')
          return { checkpoint: fail('verify', result) };
        if (result.exitCode === 0)
          return { checkpoint: ok('verify', 'verify passed') };
        if (result.json === undefined)
          return { checkpoint: fail('verify', runFailure(result, 'verify')) };
        const sources = await solutionSources(problemDir);
        return {
          checkpoint: fail('verify', verifyDigest(result.json, sources)),
        };
      }
      case 'stress':
      case 'sample_check':
      case 'max_test':
      case 'kill_wrong':
        return {
          checkpoint: await proveCheck(task, spec, problemDir, signal),
        };
      default:
        return {
          checkpoint: fail(task.kind, `kind ${task.kind} needs a worker`),
        };
    }
  }

  /** Runs the CLI. Returns the result, or an error text when it threw. */
  private async cli(
    args: string[],
    cwd: string,
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<RunResult | string> {
    try {
      return await this.runner.run(args, { cwd, timeoutMs, signal });
    } catch (error) {
      return `polyman ${args[0]} failed to start: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Why the files are not written yet: missing, empty, or still the
   * template's copy (a worker that wrote nothing must not pass because the
   * template file passes the check). `null` when every file is written.
   */
  async unwrittenFiles(
    files: string[],
    problemDir: string
  ): Promise<string | null> {
    if (files.length === 0) return 'the task owns no files';
    const missing: string[] = [];
    const empty: string[] = [];
    const template: string[] = [];
    for (const file of files) {
      const rel = normalizePath(file);
      let mine: Buffer;
      try {
        mine = await fs.readFile(path.resolve(problemDir, rel));
      } catch {
        missing.push(rel);
        continue;
      }
      if (mine.toString('utf-8').trim() === '') {
        empty.push(rel);
        continue;
      }
      if (path.isAbsolute(rel) || rel.startsWith('..')) continue;
      try {
        const original = await fs.readFile(path.join(this.templateDir, rel));
        if (original.equals(mine)) template.push(rel);
      } catch {
        // Not a template file.
      }
    }
    const lines: string[] = [];
    if (missing.length > 0) lines.push(`missing: ${missing.join(', ')}`);
    if (empty.length > 0) lines.push(`empty: ${empty.join(', ')}`);
    if (template.length > 0) {
      lines.push(
        `still the template file, not written for this problem: ${template.join(', ')}`
      );
    }
    return lines.length > 0 ? lines.join('\n') : null;
  }

  private async compiles(
    task: PlanTask,
    problemDir: string,
    signal: AbortSignal
  ): Promise<Checkpoint> {
    const files = task.ownsFiles.filter(f => /\.(cpp|cc|cxx)$/i.test(f));
    if (files.length === 0) {
      return task.kind === 'fix'
        ? ok('compile', 'no C++ files to compile')
        : fail('compile', 'the task owns no .cpp file');
    }
    for (const file of files) {
      const result = await compileCpp(file, problemDir, signal);
      if (!result.ok)
        return fail(
          'compile',
          `${file}: compile error\n${clip(result.error, 15)}`
        );
      await removeBinary(result.binary);
    }
    return ok('compile');
  }

  private async samples(
    task: PlanTask,
    spec: Spec,
    problemDir: string,
    signal: AbortSignal
  ): Promise<Checkpoint> {
    const file = task.ownsFiles.find(f => /\.(cpp|cc|cxx)$/i.test(f));
    if (!file)
      return fail(
        'samples',
        'only C++ solutions are checked, the task owns no .cpp file'
      );
    const compiled = await compileCpp(file, problemDir, signal);
    if (!compiled.ok)
      return fail('samples', `compile error\n${clip(compiled.error, 15)}`);
    try {
      const samples = parseSpec(spec).samples;
      if (samples.length === 0)
        return ok('samples', 'no samples in the spec, only compiled');
      for (const sample of samples) {
        const input = sample.input.endsWith('\n')
          ? sample.input
          : `${sample.input}\n`;
        const run = await runOnInput(compiled.binary, input, 5000, signal);
        if (!run.ok)
          return fail('samples', `sample ${sample.index}: ${run.error}`);
        if (!sameTokens(run.stdout, sample.output)) {
          return fail(
            'samples',
            `sample ${sample.index}: expected ${oneLine(sample.output, 200)} got ${oneLine(run.stdout, 200) || '(nothing)'}`
          );
        }
      }
      return ok('samples', `${samples.length} samples ok`);
    } finally {
      await removeBinary(compiled.binary);
    }
  }
}

/**
 * Remembers the last passed check of each task with a fingerprint of the
 * task's files and Config.json. When `finish_task` already ran the check
 * in the worker session and nothing changed since, the scheduler's check
 * gives the same result at once instead of running the compiler or
 * `polyman generate` again. Any change to those files runs it again.
 */
export class MemoCheckpoints implements Checkpoints {
  private readonly passed = new Map<
    string,
    { fingerprint: string; checkpoint: Checkpoint }
  >();

  constructor(private readonly inner: Checkpoints) {}

  async check(
    task: PlanTask,
    spec: Spec,
    problemDir: string,
    signal: AbortSignal
  ): Promise<Checkpoint> {
    const key = `${task.id}\n${task.kind}`;
    const before = await fingerprint(task, spec, problemDir);
    const memo = this.passed.get(key);
    if (memo && memo.fingerprint === before) return { ...memo.checkpoint };
    this.passed.delete(key);
    const checkpoint = await this.inner.check(task, spec, problemDir, signal);
    // The files may change while the check runs (another worker's patch):
    // only remember a result whose input did not move.
    if (
      checkpoint.ok &&
      (await fingerprint(task, spec, problemDir)) === before
    ) {
      this.passed.set(key, { fingerprint: before, checkpoint });
    }
    return checkpoint;
  }

  runNoModelTask(
    task: PlanTask,
    spec: Spec,
    problemDir: string,
    signal: AbortSignal
  ): Promise<{ checkpoint: Checkpoint; configPatch?: ConfigPatch }> {
    return this.inner.runNoModelTask(task, spec, problemDir, signal);
  }
}

/** A hash of the task, the spec, its files and Config.json. */
async function fingerprint(
  task: PlanTask,
  spec: Spec,
  problemDir: string
): Promise<string> {
  const hash = createHash('sha256');
  hash.update(JSON.stringify(task));
  hash.update('\0');
  hash.update(spec);
  for (const file of ['Config.json', ...task.ownsFiles]) {
    hash.update(`\0${file}\0`);
    try {
      hash.update(await fs.readFile(path.resolve(problemDir, file)));
    } catch {
      hash.update('(missing)');
    }
  }
  return hash.digest('hex');
}
