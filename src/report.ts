/**
 * @fileoverview Machine-readable result collection for `--json` runs.
 *
 * Actions opt in with `report.startRun()` / `report.startVerify()`. From then
 * on the formatter prints human output to stderr, every `fmt.error` line is
 * captured against the current step, helpers record per-test verdicts, and
 * `report.finish()` writes exactly one JSON document to stdout. A process
 * `exit` hook guarantees the document is written even when the process exits
 * before the action calls `finish()`, for example on SIGINT.
 */

import fs from 'fs';
import path from 'path';
import { fmt } from './formatter';
import type {
  DiffComponent,
  DiffReport,
  GeneratedTestResult,
  GenerateReport,
  JsonReport,
  ListReport,
  LocalSolution,
  PathReport,
  RemoteAction,
  RemoteReport,
  RunReport,
  SelfTestCase,
  SelfTestReport,
  SelfTestTarget,
  SolutionResult,
  SolutionTag,
  SolutionTestReport,
  StepResult,
  TestResult,
  TestVerdict,
  ValidatedTestResult,
  ValidateReport,
  VerifyReport,
} from './types';

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');

/**
 * Removes ANSI colour codes so captured messages are plain text.
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

/**
 * Writes all of `text` to `fd`. On macOS Node keeps a piped stdout
 * non-blocking, so one `writeSync` can write only the first part, or fail
 * with EAGAIN while the pipe is full. On Linux the pipe is blocking and this
 * is a single write.
 */
export function writeAllSync(fd: number, text: string): void {
  const data = Buffer.from(text);
  let offset = 0;
  while (offset < data.length) {
    try {
      offset += fs.writeSync(fd, data, offset);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EAGAIN') throw error;
      // The reader has not drained the pipe yet, wait a moment.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1);
    }
  }
}

function readPolymanVersion(): string {
  try {
    const raw = fs.readFileSync(
      path.join(__dirname, '..', 'package.json'),
      'utf8'
    );
    const parsed = JSON.parse(raw) as { version?: unknown };
    return typeof parsed.version === 'string' ? parsed.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Counts tests per verdict for the `summary` of a run-like report. */
function summarize(tests: TestResult[]): RunReport['summary'] {
  const byVerdict: Partial<Record<TestVerdict, number>> = {};
  for (const test of tests) {
    byVerdict[test.verdict] = (byVerdict[test.verdict] ?? 0) + 1;
  }
  return { total: tests.length, byVerdict };
}

interface SolutionEntry {
  name: string;
  tag: SolutionTag;
  matchesTag: boolean | null;
  reason: string;
  tests: TestResult[];
}

type SimpleKind =
  | 'path'
  | 'list'
  | 'generate'
  | 'validate'
  | 'selftest'
  | 'solution-test'
  | 'remote'
  | 'diff';

interface SimpleOutput {
  kind: SimpleKind;
  startedAt: number;
  path: string;
  items: unknown[];
  generated: GeneratedTestResult[];
  validated: ValidatedTestResult[];
  target: SelfTestTarget;
  cases: SelfTestCase[];
  mainSolution: string | null;
  problemId: number | null;
  actions: RemoteAction[];
  components: DiffComponent[];
}

/** Text that replaces a credential found in a report message. */
const REDACTED = '[REDACTED]';

interface ActiveReport {
  command: string;
  simple: SimpleOutput | null;
  requestedSolution: string;
  requestedTag: SolutionTag | null;
  steps: StepResult[];
  currentStep: StepResult | null;
  failedStep: string | null;
  errors: string[];
  warnings: string[];
  solutions: Map<string, SolutionEntry>;
}

/**
 * Collects step, solution, and per-test results for a JSON report.
 * Every method is a no-op until `startRun` / `startVerify` is called, so
 * helpers can record unconditionally.
 */
export class ReportCollector {
  private active: ActiveReport | null = null;
  private finished = false;
  private secrets: string[] = [];
  private exitHookInstalled = false;

  /** Whether a JSON report is being collected. */
  isActive(): boolean {
    return this.active !== null && !this.finished;
  }

  /** Begin collecting a `run` report for the requested solution name. */
  startRun(solutionName: string): void {
    this.start('run', solutionName);
  }

  /** Begin collecting a `verify` report. */
  startVerify(): void {
    this.start('verify', '');
  }

  /**
   * Begin collecting a report for a command that returns a single path
   * (`new`, `download-testlib`). Attach it with `setPath`.
   */
  startPath(command: string): void {
    this.start(command, '', 'path');
  }

  /**
   * Begin collecting a report for a command that returns a list
   * (`list ...`). Attach the items with `setItems`.
   */
  startList(command: string): void {
    this.start(command, '', 'list');
  }

  /**
   * Begin collecting a `generate` report. Helpers add one entry per test
   * with `recordGeneratedTest`.
   */
  startGenerate(): void {
    this.start('generate', '', 'generate');
  }

  /**
   * Begin collecting a `validate` report. Helpers add one entry per test
   * with `recordValidatedTest`.
   */
  startValidate(): void {
    this.start('validate', '', 'validate');
  }

  /**
   * Records the result of generating one test. Ignored unless a `generate`
   * report is active, so `verify` does not collect these.
   */
  recordGeneratedTest(result: GeneratedTestResult): void {
    const simple = this.active?.simple;
    if (simple?.kind !== 'generate') return;
    const entry: GeneratedTestResult = { ...result };
    if (entry.error !== undefined) {
      entry.error = stripAnsi(entry.error).trim();
    }
    upsertTest(simple.generated, entry);
  }

  /**
   * Records the validator result for one test. Ignored unless a `validate`
   * report is active, so `verify` does not collect these.
   */
  recordValidatedTest(result: ValidatedTestResult): void {
    const simple = this.active?.simple;
    if (simple?.kind !== 'validate') return;
    upsertTest(simple.validated, {
      ...result,
      message: stripAnsi(result.message).trim(),
    });
  }

  /**
   * Begin collecting a `test validator` / `test checker` report. Helpers add
   * each case with `recordSelfTestCase`.
   */
  startSelfTest(target: SelfTestTarget): void {
    this.start(`test ${target}`, '', 'selftest');
    if (this.active?.simple) this.active.simple.target = target;
  }

  /**
   * Begin collecting a `test <solution>` report. Attach the solutions with
   * `setSolutionTest`; the target's tests are recorded like in `run`.
   */
  startSolutionTest(solutionName: string): void {
    this.start('test', solutionName, 'solution-test');
  }

  /** Records one validator or checker self-test case. */
  recordSelfTestCase(testCase: SelfTestCase): void {
    if (this.active?.simple?.kind !== 'selftest') return;
    this.active.simple.cases.push({
      ...testCase,
      message: stripAnsi(testCase.message).trim(),
    });
  }

  /**
   * Records the main and the target solution of a `test <solution>` report.
   */
  setSolutionTest(main: LocalSolution, target: LocalSolution): void {
    if (this.active?.simple?.kind !== 'solution-test') return;
    this.active.simple.mainSolution = main.name;
    this.setRunSolutions([target]);
  }

  /**
   * Begin collecting a report for a Polygon command (`remote pull`, ...).
   * Only errors passed to `fail` / `addError` are kept, so the summary lines
   * the human output prints with `fmt.error` do not end up in `errors`.
   */
  startRemote(command: string): void {
    this.start(command, '', 'remote');
    fmt.setErrorSink(null);
  }

  /** Sets the Polygon problem ID of a remote report. */
  setProblemId(problemId: number): void {
    if (!this.active?.simple) return;
    this.active.simple.problemId = problemId;
  }

  /**
   * Records one upload, download or change in a remote report. The error
   * text is stored without colour codes.
   */
  addAction(entry: RemoteAction): void {
    if (this.active?.simple?.kind !== 'remote') return;
    const action: RemoteAction = {
      component: entry.component,
      name: entry.name,
      action: entry.action,
      ok: entry.ok,
    };
    if (entry.error !== undefined) {
      action.error = stripAnsi(entry.error).trim();
    }
    this.active.simple.actions.push(action);
  }

  /**
   * Begin collecting a diff report (`remote diff`, `remote push --dry-run`).
   * Like `startRemote`, only errors passed to `fail` / `addError` are kept.
   */
  startDiff(command: string): void {
    this.start(command, '', 'diff');
    fmt.setErrorSink(null);
  }

  /**
   * Records how one component differs between the local problem and Polygon.
   * Ignored unless a diff report is active.
   */
  addDiffComponent(entry: DiffComponent): void {
    if (this.active?.simple?.kind !== 'diff') return;
    this.active.simple.components.push({ ...entry });
  }

  /**
   * Remembers values (the Polygon API key and secret) that must never be
   * printed. Every message in the JSON document has them replaced.
   */
  setSecrets(values: string[]): void {
    this.secrets = values.filter(value => value.length > 0);
  }

  /** Sets the `path` of a path report. */
  setPath(value: string): void {
    if (!this.active?.simple) return;
    this.active.simple.path = value;
  }

  /** Sets the `items` of a list report. */
  setItems(items: unknown[]): void {
    if (!this.active?.simple) return;
    this.active.simple.items = items;
  }

  /**
   * Records which solutions a `run` matched. With exactly one match the
   * report's `tag` is that solution's tag; otherwise it is null.
   */
  setRunSolutions(solutions: LocalSolution[]): void {
    if (!this.active) return;
    for (const solution of solutions) {
      this.ensureSolution(solution);
    }
    this.active.requestedTag =
      solutions.length === 1 ? (solutions[0]?.tag ?? null) : null;
  }

  /** Marks the start of a named pipeline step. */
  beginStep(name: string): void {
    if (!this.active) return;
    const step: StepResult = { name, ok: true, errors: [] };
    this.active.steps.push(step);
    this.active.currentStep = step;
  }

  /**
   * Captures an error line against the current step. Called by the formatter
   * for every `fmt.error` while a report is active.
   */
  addError(message: string): void {
    if (!this.active) return;
    const clean = stripAnsi(message).trim();
    if (!clean) return;
    if (!this.active.errors.includes(clean)) {
      this.active.errors.push(clean);
    }
    const step = this.active.currentStep;
    if (step && !step.errors.includes(clean)) {
      step.errors.push(clean);
    }
  }

  /**
   * Records a warning. Warnings never fail a step; they are listed in the
   * `warnings` array of the verify and remote reports.
   */
  addWarning(message: string): void {
    if (!this.active) return;
    const clean = stripAnsi(message).trim();
    if (clean && !this.active.warnings.includes(clean)) {
      this.active.warnings.push(clean);
    }
  }

  /**
   * Marks the current step as failed with the given message. The first
   * failure decides `failedStep`.
   */
  fail(message: string): void {
    if (!this.active) return;
    this.addError(message);
    const step = this.active.currentStep;
    if (step) {
      step.ok = false;
      this.active.failedStep ??= step.name;
    }
  }

  /** Records a test executed for a solution. */
  recordTest(solution: LocalSolution, result: TestResult): void {
    if (!this.active) return;
    const entry = this.ensureSolution(solution);
    const existing = entry.tests.find(
      t => t.testset === result.testset && t.index === result.index
    );
    if (existing) {
      Object.assign(existing, result);
    } else {
      entry.tests.push({ ...result });
    }
  }

  /**
   * Updates the verdict of an already recorded test, e.g. after the checker
   * judged the output. Creates the entry if the run happened elsewhere.
   */
  updateTestVerdict(
    solution: LocalSolution,
    testset: string,
    index: number,
    verdict: TestVerdict,
    message: string
  ): void {
    if (!this.active) return;
    const entry = this.ensureSolution(solution);
    const existing = entry.tests.find(
      t => t.testset === testset && t.index === index
    );
    if (existing) {
      existing.verdict = verdict;
      existing.message = stripAnsi(message).trim();
    } else {
      entry.tests.push({
        testset,
        index,
        verdict,
        timeMs: 0,
        message: stripAnsi(message).trim(),
      });
    }
  }

  /** Records whether a solution's observed verdicts satisfy its tag. */
  setSolutionOutcome(
    solution: LocalSolution,
    matchesTag: boolean,
    reason: unknown
  ): void {
    if (!this.active) return;
    const entry = this.ensureSolution(solution);
    entry.matchesTag = matchesTag;
    entry.reason = stripAnsi(errorMessage(reason)).trim();
  }

  /**
   * Writes the JSON document to stdout exactly once. Safe to call more than
   * once; later calls are ignored.
   *
   * @param ok - Whether the command succeeded
   * @param exitCode - The code the process will exit with, shown as
   *   `exitCode` in every report except `run` and `verify`.
   *   Defaults to 0 when ok and 1 otherwise.
   */
  finish(ok: boolean, exitCode: number = ok ? 0 : 1): void {
    if (!this.active || this.finished) return;
    this.finished = true;
    if (!ok) {
      const step = this.active.currentStep;
      if (step && this.active.failedStep === null) {
        step.ok = false;
        this.active.failedStep = step.name;
      }
    }
    const document = this.render(ok, exitCode);
    writeAllSync(process.stdout.fd, `${JSON.stringify(document, null, 2)}\n`);
  }

  /** Discards any collected state and restores the formatter (tests). */
  reset(): void {
    this.active = null;
    this.finished = false;
    this.secrets = [];
    fmt.setOutput('stdout');
    fmt.setErrorSink(null);
  }

  private start(
    command: string,
    requestedSolution: string,
    simpleKind: SimpleKind | null = null
  ): void {
    this.active = {
      command,
      simple:
        simpleKind === null
          ? null
          : {
              kind: simpleKind,
              startedAt: Date.now(),
              path: '',
              items: [],
              generated: [],
              validated: [],
              target: 'validator',
              cases: [],
              mainSolution: null,
              problemId: null,
              actions: [],
              components: [],
            },
      requestedSolution,
      requestedTag: null,
      steps: [],
      currentStep: null,
      failedStep: null,
      errors: [],
      warnings: [],
      solutions: new Map(),
    };
    this.finished = false;
    fmt.setOutput('stderr');
    fmt.setErrorSink(message => this.addError(message));
    if (!this.exitHookInstalled) {
      this.exitHookInstalled = true;
      process.on('exit', (code: number) => {
        this.finish(code === 0, code);
      });
    }
  }

  private ensureSolution(solution: LocalSolution): SolutionEntry {
    const active = this.active!;
    let entry = active.solutions.get(solution.name);
    if (!entry) {
      entry = {
        name: solution.name,
        tag: solution.tag,
        matchesTag: null,
        reason: '',
        tests: [],
      };
      active.solutions.set(solution.name, entry);
    }
    return entry;
  }

  /** Replaces every registered secret in `text`. */
  private redact(text: string): string {
    let clean = text;
    for (const secret of this.secrets) {
      clean = clean.split(secret).join(REDACTED);
    }
    return clean;
  }

  private render(ok: boolean, exitCode: number): JsonReport {
    const active = this.active!;
    const base = {
      schemaVersion: 1 as const,
      polymanVersion: readPolymanVersion(),
      ok,
    };
    if (active.simple) {
      const common = {
        ...base,
        command: active.command,
        exitCode,
        durationMs: Math.max(0, Date.now() - active.simple.startedAt),
        errors: ok ? [] : active.errors.map(error => this.redact(error)),
      };
      if (active.simple.kind === 'generate') {
        const generateReport: GenerateReport = {
          ...common,
          command: 'generate',
          tests: active.simple.generated.map(t => ({ ...t })),
        };
        return generateReport;
      }
      if (active.simple.kind === 'validate') {
        const validateReport: ValidateReport = {
          ...common,
          command: 'validate',
          tests: active.simple.validated.map(t => ({ ...t })),
        };
        return validateReport;
      }
      if (active.simple.kind === 'selftest') {
        const selfTest: SelfTestReport = {
          ...common,
          target: active.simple.target,
          cases: active.simple.cases.map(c => ({ ...c })),
        };
        return selfTest;
      }
      if (active.simple.kind === 'solution-test') {
        const entry = active.solutions.get(active.requestedSolution);
        const tests = (entry?.tests ?? []).map(t => ({ ...t }));
        const solutionTest: SolutionTestReport = {
          ...common,
          command: 'test',
          solution: active.requestedSolution,
          tag: active.requestedTag,
          mainSolution: active.simple.mainSolution,
          matchesTag: entry?.matchesTag === true,
          reason:
            entry === undefined || entry.matchesTag === null
              ? 'Not evaluated: the test stopped before comparison'
              : entry.reason,
          tests,
          summary: summarize(tests),
        };
        return solutionTest;
      }
      if (active.simple.kind === 'remote') {
        const remoteReport: RemoteReport = {
          ...common,
          problemId: active.simple.problemId,
          actions: active.simple.actions.map(action =>
            action.error === undefined
              ? { ...action }
              : { ...action, error: this.redact(action.error) }
          ),
          warnings: active.warnings.map(warning => this.redact(warning)),
        };
        return remoteReport;
      }
      if (active.simple.kind === 'diff') {
        const components = active.simple.components.map(component => ({
          ...component,
        }));
        const diffReport: DiffReport = {
          ...common,
          problemId: active.simple.problemId,
          components,
          changes: components.filter(c => c.status !== 'same').length,
          warnings: active.warnings.map(warning => this.redact(warning)),
        };
        return diffReport;
      }
      if (active.simple.kind === 'path') {
        const pathReport: PathReport = {
          ...common,
          path: active.simple.path,
        };
        return pathReport;
      }
      const listReport: ListReport = {
        ...common,
        items: active.simple.items,
      };
      return listReport;
    }
    if (active.command === 'run') {
      const entries = Array.from(active.solutions.values());
      const multi = entries.length > 1;
      const tests: TestResult[] = [];
      for (const entry of entries) {
        for (const test of entry.tests) {
          tests.push(multi ? { ...test, solution: entry.name } : { ...test });
        }
      }
      const run: RunReport = {
        ...base,
        command: 'run',
        solution: active.requestedSolution,
        tag: active.requestedTag,
        tests,
        summary: summarize(tests),
        errors: ok ? [] : [...active.errors],
      };
      return run;
    }
    const solutions: SolutionResult[] = [];
    for (const entry of active.solutions.values()) {
      if (entry.matchesTag === null && entry.tests.length === 0) continue;
      solutions.push({
        name: entry.name,
        tag: entry.tag,
        matchesTag: entry.matchesTag === true,
        reason:
          entry.matchesTag === null
            ? 'Not evaluated: verification stopped before comparison'
            : entry.reason,
        tests: entry.tests.map(t => ({ ...t })),
      });
    }
    const verify: VerifyReport = {
      ...base,
      command: 'verify',
      failedStep: active.failedStep,
      steps: active.steps.map(step => ({
        name: step.name,
        ok: step.ok,
        errors: step.ok ? [] : [...step.errors],
      })),
      warnings: [...active.warnings],
      solutions,
    };
    return verify;
  }
}

/**
 * Adds a test to the list, or replaces the entry with the same testset and
 * index (a test generated or validated twice is listed once).
 */
function upsertTest<T extends { testset: string; index: number }>(
  tests: T[],
  entry: T
): void {
  const at = tests.findIndex(
    t => t.testset === entry.testset && t.index === entry.index
  );
  if (at === -1) {
    tests.push(entry);
  } else {
    tests[at] = entry;
  }
}

/**
 * Singleton report collector shared by actions, steps, and helpers.
 */
export const report = new ReportCollector();
