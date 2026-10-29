/**
 * The contract for running polyman commands from the agent. Every CLI run
 * goes through one runner, one run at a time.
 */

/** Options of one CLI run. */
export interface RunOptions {
  /** Folder the command runs in. */
  cwd: string;
  /** The run is killed after this time. */
  timeoutMs: number;
  /** Aborting it kills the whole process tree. */
  signal: AbortSignal;
  /** Gets each stderr line, for `tool_progress` events. */
  onLine?(line: string): void;
}

/** The outcome of one CLI run. */
export interface RunResult {
  /** Exit code, or null when the process was killed. */
  exitCode: number | null;
  /** Why the run ended. */
  reason: 'exited' | 'timeout' | 'cancelled';
  /** Parsed stdout, when the command ran with `--json`. */
  json?: unknown;
  /** The end of stdout. */
  stdoutTail: string;
  /** The end of stderr. */
  stderrTail: string;
  /** Path of the full output on disk. */
  logPath: string;
  /** How long the run took. */
  durationMs: number;
}

/** Runs our own `dist/cli.js` as a child process. */
export interface CliRunner {
  run(args: string[], opts: RunOptions): Promise<RunResult>;
}
