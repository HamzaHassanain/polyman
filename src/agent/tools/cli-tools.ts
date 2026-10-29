/**
 * CLI tools: each one runs a polyman command through `ctx.runner` with
 * `--json`, and turns the report into a short digest for the model. The full
 * {@link RunResult} goes to `data` for the UI.
 *
 * Exit codes (see `src/errors.ts`): 0 ok, 1 the problem is wrong (a normal
 * result, the model reads it and fixes the problem), 2 bad arguments or
 * Config.json, 3 a missing tool, 4 Polygon or network, 130/143 cancelled.
 */

import fs from 'fs';
import path from 'path';
import type { RunResult } from '../runner/types';
import type {
  GenerateReport,
  PathReport,
  RunReport,
  SelfTestReport,
  SolutionTestReport,
  TestResult,
  TestVerdict,
  ValidateReport,
  VerifyReport,
} from '../../types';
import type { Tool, ToolContext, ToolOutput } from './types';

const SECOND = 1000;
const CREATE_TIMEOUT_MS = 60 * SECOND;
const RUN_TIMEOUT_MS = 300 * SECOND;
const VERIFY_TIMEOUT_MS = 600 * SECOND;
/**
 * Extra time the registry gives a tool over its CLI timeout, so the runner
 * stops the run first and the result says "timed out", not "cancelled".
 */
const TOOL_SLACK_MS = 15 * SECOND;

/** Most failing items a digest lists. */
const MAX_ITEMS = 15;
/** Most lines of a `verify` or `run` digest. */
const MAX_REPORT_LINES = 40;
/** Stderr lines shown when there is no JSON report. */
const STDERR_LINES = 20;
/** Error lines shown for exit 2 and 4. */
const MAX_ERROR_LINES = 10;

/** A problem folder name for `create_problem`. */
export const PROBLEM_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** A testset, solution or self-test target name. Never starts with `-`. */
export const NAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/;

const VERDICT_ORDER: TestVerdict[] = ['OK', 'WA', 'PE', 'TLE', 'MLE', 'RTE'];

/** Programs a missing-tool error (exit 3) may name. */
const KNOWN_TOOLS: [RegExp, string][] = [
  [/clang\+\+/i, 'clang++'],
  [/g\+\+(-\d+)?/i, 'g++'],
  [/javac/i, 'javac'],
  [/\bjava\b/i, 'java'],
  [/kotlinc/i, 'kotlinc'],
  [/pypy/i, 'pypy'],
  [/python/i, 'Python 3'],
];

interface TestsetArgs {
  testset?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The report, when stdout was a JSON object. */
export function reportOf<T>(result: RunResult): T | undefined {
  return isObject(result.json) ? (result.json as T) : undefined;
}

function nonEmptyLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => line.trim() !== '');
}

function lastStderrLines(result: RunResult, count: number): string[] {
  return nonEmptyLines(result.stderrTail).slice(-count);
}

/** The error lines of a run: the report's `errors`, else the end of stderr. */
function errorLines(result: RunResult, count: number): string[] {
  const report = reportOf<{ errors?: unknown }>(result);
  const errors = Array.isArray(report?.errors)
    ? report.errors.filter((e): e is string => typeof e === 'string')
    : [];
  if (errors.length > 0) return errors.slice(0, count);
  return lastStderrLines(result, count);
}

export function logLine(result: RunResult): string {
  return `Full log: ${result.logPath || '(not written)'}`;
}

export function oneLine(text: string, max = 300): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}...` : flat;
}

function missingToolName(lines: string[]): string {
  const text = lines.join('\n');
  for (const [pattern, name] of KNOWN_TOOLS) {
    if (pattern.test(text)) return name;
  }
  return 'A needed program';
}

/**
 * The digest for the endings that do not depend on the command: timeout,
 * cancel, exit 2, 3, 4 and runs without a JSON report. Null when the report
 * digest of the command should be used.
 */
export function commonDigest(
  name: string,
  result: RunResult
): ToolOutput | null {
  if (result.reason === 'timeout') {
    return {
      content: `${name} timed out after ${Math.round(result.durationMs / SECOND)} s and was stopped. ${logLine(result)}`,
      isError: true,
      data: result,
    };
  }
  if (result.reason === 'cancelled') {
    return { content: `${name} was cancelled.`, isError: true, data: result };
  }
  const code = result.exitCode;
  if (code === 130 || code === 143) {
    return {
      content: `${name} was cancelled (exit ${code}).`,
      isError: true,
      data: result,
    };
  }
  if (code === 2) {
    return {
      content: [
        `${name} FAILED (exit 2, bad arguments or Config.json):`,
        ...errorLines(result, MAX_ERROR_LINES).map(line => `  ${line}`),
        logLine(result),
      ].join('\n'),
      isError: true,
      data: result,
    };
  }
  if (code === 3) {
    const lines = errorLines(result, MAX_ERROR_LINES);
    return {
      content: [
        `${missingToolName(lines)} is missing on this machine. Tell the user.`,
        ...lines.map(line => `  ${line}`),
      ].join('\n'),
      isError: true,
      data: result,
    };
  }
  if (code === 4) {
    return {
      content: [
        `${name} FAILED (exit 4, Polygon or network):`,
        ...errorLines(result, MAX_ERROR_LINES).map(line => `  ${line}`),
        logLine(result),
      ].join('\n'),
      isError: true,
      data: result,
    };
  }
  if (reportOf(result) === undefined) {
    if (code === 0) return { content: `${name} OK`, data: result };
    return {
      content: [
        `${name} FAILED (exit ${code ?? 'killed'})`,
        ...lastStderrLines(result, STDERR_LINES),
        logLine(result),
      ].join('\n'),
      data: result,
    };
  }
  return null;
}

/** Top-level errors of a failed report, when no item explains the failure. */
function reportErrors(report: { ok: boolean; errors: string[] }): string[] {
  if (report.ok) return [];
  return report.errors.slice(0, MAX_ITEMS).map(e => `  ${oneLine(e)}`);
}

function limited(lines: string[], total: number): string[] {
  if (total <= lines.length) return lines;
  return [...lines, `  ... ${total - lines.length} more`];
}

function generateDigest(report: GenerateReport): string[] {
  const tests = Array.isArray(report.tests) ? report.tests : [];
  const failed = tests.filter(t => !t.ok);
  const lines = [
    `generate ${report.ok ? 'OK' : 'FAILED'}: ${tests.length} tests, ${tests.length - failed.length} ok, ${failed.length} failed`,
  ];
  const items = failed.slice(0, MAX_ITEMS).map(t => {
    const source =
      t.source === 'generator'
        ? ` (${[t.generator ?? 'generator', ...(t.args ?? [])].join(' ')})`
        : ' (manual)';
    return `  ${t.testset} #${t.index}${source}: ${oneLine(t.error ?? 'failed')}`;
  });
  lines.push(...limited(items, failed.length));
  if (failed.length === 0) lines.push(...reportErrors(report));
  return lines;
}

function validateDigest(report: ValidateReport): string[] {
  const tests = Array.isArray(report.tests) ? report.tests : [];
  const invalid = tests.filter(t => !t.valid);
  const lines = [
    `validate ${report.ok ? 'OK' : 'FAILED'}: ${tests.length} tests, ${tests.length - invalid.length} valid, ${invalid.length} invalid`,
  ];
  const items = invalid.slice(0, MAX_ITEMS).map(t => {
    const where = t.group ? `${t.testset}/${t.group}` : t.testset;
    return `  ${where} #${t.index}: ${oneLine(t.message || 'invalid')}`;
  });
  lines.push(...limited(items, invalid.length));
  if (invalid.length === 0) lines.push(...reportErrors(report));
  return lines;
}

function selfTestDigest(report: SelfTestReport): string[] {
  const cases = Array.isArray(report.cases) ? report.cases : [];
  const target = report.target ?? 'target';
  if (cases.length === 0) {
    return [
      `test ${target} ${report.ok ? 'OK' : 'FAILED'}: no self-tests ran (standard checker or no tests file)`,
      ...reportErrors(report),
    ];
  }
  const failed = cases.filter(c => !c.ok);
  const lines = [
    `test ${target} ${report.ok ? 'OK' : 'FAILED'}: ${cases.length} cases, ${cases.length - failed.length} ok, ${failed.length} failed`,
  ];
  const items = failed.slice(0, MAX_ITEMS).map(c => {
    const actual =
      c.actual === null ? `exit code ${c.exitCode ?? '?'}` : c.actual;
    const message = c.message ? `: ${oneLine(c.message)}` : '';
    return `  case ${c.index}: expected ${c.expected}, got ${actual}${message}`;
  });
  lines.push(...limited(items, failed.length));
  if (failed.length === 0) lines.push(...reportErrors(report));
  return lines;
}

/** Like `10 tests, OK 9, WA 1, max 120 ms`. */
function verdictSummary(tests: TestResult[]): string {
  if (tests.length === 0) return 'no tests ran';
  const counts = new Map<TestVerdict, number>();
  let maxMs = 0;
  for (const test of tests) {
    counts.set(test.verdict, (counts.get(test.verdict) ?? 0) + 1);
    maxMs = Math.max(maxMs, test.timeMs ?? 0);
  }
  const parts = VERDICT_ORDER.filter(v => counts.has(v)).map(
    v => `${v} ${counts.get(v)}`
  );
  return `${tests.length} tests, ${parts.join(', ')}, max ${Math.round(maxMs)} ms`;
}

function firstFailingTest(tests: TestResult[]): string | null {
  const test = tests.find(t => t.verdict !== 'OK');
  if (!test) return null;
  const where = test.group ? `${test.testset}/${test.group}` : test.testset;
  const who = test.solution ? `${test.solution} ` : '';
  const message = test.message ? `: ${oneLine(test.message)}` : '';
  return `First failing: ${who}${where} #${test.index} ${test.verdict}${message}`;
}

function solutionTestDigest(report: SolutionTestReport): string[] {
  const tests = Array.isArray(report.tests) ? report.tests : [];
  const tag = report.tag ? ` (${report.tag})` : '';
  const match = report.matchesTag
    ? 'matches its tag'
    : 'does NOT match its tag';
  const lines = [
    `test ${report.solution}${tag} ${report.ok ? 'OK' : 'FAILED'}: ${match}. ${oneLine(report.reason ?? '')}`,
    `  ${verdictSummary(tests)}`,
  ];
  const failing = tests.filter(t => t.verdict !== 'OK');
  const items = failing.slice(0, MAX_ITEMS).map(t => {
    const message = t.message ? `: ${oneLine(t.message)}` : '';
    return `  ${t.testset} #${t.index} ${t.verdict}${message}`;
  });
  lines.push(...limited(items, failing.length));
  if (tests.length === 0) lines.push(...reportErrors(report));
  return lines;
}

function runDigest(report: RunReport): string[] {
  const tests = Array.isArray(report.tests) ? report.tests : [];
  const lines = [`run ${report.solution} ${report.ok ? 'passed' : 'FAILED'}`];
  const bySolution = new Map<string, TestResult[]>();
  for (const test of tests) {
    const name = test.solution ?? report.solution;
    const list = bySolution.get(name) ?? [];
    list.push(test);
    bySolution.set(name, list);
  }
  const multi = bySolution.size > 1;
  for (const [name, list] of bySolution) {
    const tag = !multi && report.tag ? ` (${report.tag})` : '';
    lines.push(`  ${name}${tag}: ${verdictSummary(list)}`);
  }
  const failing = firstFailingTest(tests);
  if (failing) lines.push(failing);
  if (!report.ok && Array.isArray(report.errors)) {
    lines.push(
      ...report.errors.slice(0, MAX_ITEMS).map(e => `  ${oneLine(e)}`)
    );
  }
  return lines;
}

function verifyDigest(report: VerifyReport): string[] {
  const lines = [
    report.ok
      ? 'verify passed'
      : `verify FAILED at "${report.failedStep ?? 'unknown step'}"`,
  ];
  const solutions = Array.isArray(report.solutions) ? report.solutions : [];
  for (const solution of solutions) {
    const match = solution.matchesTag ? '' : ' (does NOT match its tag)';
    lines.push(
      `  ${solution.name} (${solution.tag}): ${verdictSummary(solution.tests ?? [])}${match}`
    );
  }
  const steps = Array.isArray(report.steps) ? report.steps : [];
  const failedStep =
    steps.find(s => s.name === report.failedStep) ?? steps.find(s => !s.ok);
  const wrong = solutions.find(s => !s.matchesTag);
  if (failedStep && failedStep.errors.length > 0) {
    lines.push(`Step "${failedStep.name}" errors:`);
    lines.push(...failedStep.errors.slice(0, 10).map(e => `  ${oneLine(e)}`));
  } else if (wrong) {
    lines.push(`${wrong.name}: ${oneLine(wrong.reason)}`);
    const failing = firstFailingTest(wrong.tests ?? []);
    if (failing) lines.push(failing);
  }
  const warnings = Array.isArray(report.warnings) ? report.warnings : [];
  if (warnings.length > 0) {
    lines.push(
      `Warnings: ${warnings
        .slice(0, 3)
        .map(w => oneLine(w, 150))
        .join(' | ')}`
    );
  }
  return lines;
}

/** Joins digest lines, adds the log line, and keeps at most `max` lines. */
export function finish(
  lines: string[],
  result: RunResult,
  max: number
): string {
  const body =
    lines.length > max - 1
      ? [
          ...lines.slice(0, max - 2),
          `... ${lines.length - (max - 2)} more lines in the log`,
        ]
      : lines;
  return [...body, logLine(result)].join('\n');
}

/** Runs one polyman command for a tool, with the tool's timeout. */
function runCli(
  ctx: ToolContext,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<RunResult> {
  return ctx.runner.run(args, {
    cwd,
    timeoutMs,
    signal: ctx.signal,
    onLine: line => ctx.progress(line),
  });
}

/** Runs a command, and says "cancelled" when the run was aborted early. */
export async function runForTool(
  name: string,
  ctx: ToolContext,
  args: string[],
  cwd: string,
  timeoutMs: number
): Promise<RunResult | ToolOutput> {
  try {
    return await runCli(ctx, args, cwd, timeoutMs);
  } catch (error) {
    if (ctx.signal.aborted) {
      return { content: `${name} was cancelled.`, isError: true };
    }
    throw error;
  }
}

export function isOutput(value: RunResult | ToolOutput): value is ToolOutput {
  return 'content' in value;
}

export function problemDirOf(ctx: ToolContext): string {
  if (ctx.problemDir === null) {
    throw new Error('No problem folder yet. Create the problem first.');
  }
  return ctx.problemDir;
}

function badName(what: string, value: string): ToolOutput {
  return {
    content: `Invalid ${what} "${value}": use letters, digits, "_", "." and "-", not starting with "-"`,
    isError: true,
  };
}

/** `--all` or `-t <testset>`, after the command words. */
function testsetArgs(args: TestsetArgs): string[] {
  return args.testset === undefined ? ['--all'] : ['-t', args.testset];
}

type Digest = (result: RunResult) => string;

/** Builds a tool that runs one command in the problem folder. */
async function runInProblem(
  name: string,
  ctx: ToolContext,
  args: string[],
  timeoutMs: number,
  digest: Digest
): Promise<ToolOutput> {
  const ran = await runForTool(name, ctx, args, problemDirOf(ctx), timeoutMs);
  if (isOutput(ran)) return ran;
  const common = commonDigest(name, ran);
  if (common) return common;
  return { content: digest(ran), data: ran };
}

const testsetSchema = {
  type: 'string',
  pattern: NAME_PATTERN.source,
  description: 'One testset name. Leave it out for all testsets',
};

const createProblem: Tool<{ name: string }> = {
  name: 'create_problem',
  description:
    'Create a new problem folder from the polyman template and download ' +
    'testlib.h into it. Use it once, before any other problem tool. The new ' +
    'folder becomes the problem folder.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        pattern: PROBLEM_NAME_PATTERN.source,
        description:
          'Folder name: lowercase letters, digits and "-", like "pairs-sum"',
      },
    },
    required: ['name'],
    additionalProperties: false,
  },
  risk: 'write',
  needsProblem: false,
  timeoutMs: 2 * CREATE_TIMEOUT_MS + TOOL_SLACK_MS,
  describe: args => ({
    title: `Create problem ${args.name}`,
    command: `polyman new ${args.name} && polyman download-testlib`,
  }),
  async run(args, ctx) {
    if (!PROBLEM_NAME_PATTERN.test(args.name)) {
      return {
        content: `Invalid problem name "${args.name}": use lowercase letters, digits and "-" (like "pairs-sum"), not starting with "-"`,
        isError: true,
      };
    }
    const parent = ctx.problemDir ?? process.cwd();
    const dir = path.resolve(parent, args.name);
    if (fs.existsSync(dir)) {
      return {
        content: `The folder ${dir} already exists. Pick another name or ask the user.`,
        isError: true,
      };
    }

    const created = await runForTool(
      'create_problem',
      ctx,
      ['new', args.name, '--json'],
      parent,
      CREATE_TIMEOUT_MS
    );
    if (isOutput(created)) return created;
    if (created.reason !== 'exited' || created.exitCode !== 0) {
      const failed = commonDigest('create_problem', created) ?? {
        content: finish(
          [
            `create_problem FAILED (exit ${created.exitCode ?? 'killed'}):`,
            ...errorLines(created, MAX_ERROR_LINES).map(line => `  ${line}`),
          ],
          created,
          MAX_REPORT_LINES
        ),
        data: created,
      };
      return { ...failed, isError: true };
    }
    const report = reportOf<PathReport>(created);
    const problemDir =
      typeof report?.path === 'string' && report.path !== ''
        ? report.path
        : dir;
    ctx.setProblemDir(problemDir);

    const testlib = await runForTool(
      'create_problem',
      ctx,
      ['download-testlib', '--json'],
      problemDir,
      CREATE_TIMEOUT_MS
    );
    if (isOutput(testlib)) {
      return {
        ...testlib,
        content: `Created ${problemDir}, but download-testlib was cancelled.`,
      };
    }
    if (testlib.reason !== 'exited' || testlib.exitCode !== 0) {
      const why = commonDigest('download-testlib', testlib)?.content ?? '';
      return {
        content: [
          `Created ${problemDir} (it is now the problem folder), but downloading testlib.h failed:`,
          why ||
            finish(
              errorLines(testlib, MAX_ERROR_LINES),
              testlib,
              MAX_REPORT_LINES
            ),
        ].join('\n'),
        isError: true,
        data: testlib,
      };
    }
    return {
      content: `Created the problem folder ${problemDir} with testlib.h. It is now the problem folder.`,
      data: testlib,
    };
  },
};

const generate: Tool<TestsetArgs> = {
  name: 'generate',
  description:
    'Build the test inputs from the generators and manual tests ' +
    '(polyman generate). Run it after changing generators or the script.',
  parameters: {
    type: 'object',
    properties: { testset: testsetSchema },
    additionalProperties: false,
  },
  risk: 'run',
  needsProblem: true,
  timeoutMs: RUN_TIMEOUT_MS + TOOL_SLACK_MS,
  describe: args => ({
    title: 'Generate tests',
    command: `polyman generate ${testsetArgs(args).join(' ')} --json`,
  }),
  run(args, ctx) {
    if (args.testset !== undefined && !NAME_PATTERN.test(args.testset)) {
      return Promise.resolve(badName('testset', args.testset));
    }
    return runInProblem(
      'generate',
      ctx,
      ['generate', ...testsetArgs(args), '--json'],
      RUN_TIMEOUT_MS,
      result =>
        finish(
          generateDigest(reportOf<GenerateReport>(result)!),
          result,
          MAX_REPORT_LINES
        )
    );
  },
};

const validate: Tool<TestsetArgs> = {
  name: 'validate',
  description:
    'Check every generated test with the validator (polyman validate). ' +
    'Run generate first.',
  parameters: {
    type: 'object',
    properties: { testset: testsetSchema },
    additionalProperties: false,
  },
  risk: 'run',
  needsProblem: true,
  timeoutMs: RUN_TIMEOUT_MS + TOOL_SLACK_MS,
  describe: args => ({
    title: 'Validate tests',
    command: `polyman validate ${testsetArgs(args).join(' ')} --json`,
  }),
  run(args, ctx) {
    if (args.testset !== undefined && !NAME_PATTERN.test(args.testset)) {
      return Promise.resolve(badName('testset', args.testset));
    }
    return runInProblem(
      'validate',
      ctx,
      ['validate', ...testsetArgs(args), '--json'],
      RUN_TIMEOUT_MS,
      result =>
        finish(
          validateDigest(reportOf<ValidateReport>(result)!),
          result,
          MAX_REPORT_LINES
        )
    );
  },
};

const runSolution: Tool<{ name: string; testset?: string }> = {
  name: 'run_solution',
  description:
    'Run one solution on the generated tests (polyman run) and show the ' +
    'verdict and time of each test. It does not compare with the main ' +
    'solution: use test_target for that.',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        pattern: NAME_PATTERN.source,
        description: 'Solution name from Config.json',
      },
      testset: testsetSchema,
    },
    required: ['name'],
    additionalProperties: false,
  },
  risk: 'run',
  needsProblem: true,
  timeoutMs: RUN_TIMEOUT_MS + TOOL_SLACK_MS,
  describe: args => ({
    title: `Run solution ${args.name}`,
    command: `polyman run ${args.name} ${testsetArgs(args).join(' ')} --json`,
  }),
  run(args, ctx) {
    if (!NAME_PATTERN.test(args.name)) {
      return Promise.resolve(badName('solution name', args.name));
    }
    if (args.testset !== undefined && !NAME_PATTERN.test(args.testset)) {
      return Promise.resolve(badName('testset', args.testset));
    }
    return runInProblem(
      'run_solution',
      ctx,
      ['run', args.name, ...testsetArgs(args), '--json'],
      RUN_TIMEOUT_MS,
      result =>
        finish(
          runDigest(reportOf<RunReport>(result)!),
          result,
          MAX_REPORT_LINES
        )
    );
  },
};

const testTarget: Tool<{ what: string }> = {
  name: 'test_target',
  description:
    'Test one part of the problem (polyman test): "validator" or "checker" ' +
    'runs its self-tests, a solution name runs it against the main solution ' +
    'and checks that the verdicts match its tag.',
  parameters: {
    type: 'object',
    properties: {
      what: {
        type: 'string',
        pattern: NAME_PATTERN.source,
        description: '"validator", "checker" or a solution name',
      },
    },
    required: ['what'],
    additionalProperties: false,
  },
  risk: 'run',
  needsProblem: true,
  timeoutMs: RUN_TIMEOUT_MS + TOOL_SLACK_MS,
  describe: args => ({
    title: `Test ${args.what}`,
    command: `polyman test ${args.what} --json`,
  }),
  run(args, ctx) {
    if (!NAME_PATTERN.test(args.what)) {
      return Promise.resolve(badName('target', args.what));
    }
    return runInProblem(
      'test_target',
      ctx,
      ['test', args.what, '--json'],
      RUN_TIMEOUT_MS,
      result => {
        const report = reportOf<SolutionTestReport | SelfTestReport>(result)!;
        const lines =
          'solution' in report
            ? solutionTestDigest(report)
            : selfTestDigest(report);
        return finish(lines, result, MAX_REPORT_LINES);
      }
    );
  },
};

const verify: Tool<Record<string, never>> = {
  name: 'verify',
  description:
    'Check the whole problem (polyman verify): generate, validate, checker ' +
    'and validator self-tests, and every solution against its tag. Run it ' +
    'after changes, and read the report before fixing anything.',
  parameters: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  risk: 'run',
  needsProblem: true,
  timeoutMs: VERIFY_TIMEOUT_MS + TOOL_SLACK_MS,
  describe: () => ({
    title: 'Verify the problem',
    command: 'polyman verify --json',
  }),
  run(_args, ctx) {
    return runInProblem(
      'verify',
      ctx,
      ['verify', '--json'],
      VERIFY_TIMEOUT_MS,
      result =>
        finish(
          verifyDigest(reportOf<VerifyReport>(result)!),
          result,
          MAX_REPORT_LINES
        )
    );
  },
};

/** The CLI tools, for the registry. */
export function cliTools(): Tool[] {
  return [
    createProblem,
    generate,
    validate,
    runSolution,
    testTarget,
    verify,
  ] as Tool[];
}
