/**
 * Runs our own `dist/cli.js` as a child process for the agent.
 *
 * - Never a shell: `spawn(process.execPath, [cliPath, ...args])`.
 * - One run at a time, through {@link cliLock}.
 * - On POSIX the child leads its own process group, so a timeout or a cancel
 *   kills the compilers and solutions it started too ({@link killTree}).
 * - The full output goes to `<cwd>/.polyman/agent/logs/`, the result keeps
 *   only the start and the end of it.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PRESETS } from '../providers/presets';
import { killTree } from './kill-tree';
import { cliLock } from './lock';
import type { CliRunner, RunOptions, RunResult } from './types';

/** Most output kept in memory for the log file, per run. */
export const MAX_LOG_CHARS = 2 * 1024 * 1024;
/** Most stdout kept for `JSON.parse` when the run uses `--json`. */
const MAX_JSON_CHARS = 32 * 1024 * 1024;
/** Start of a stream kept in the tail. */
export const TAIL_HEAD_CHARS = 4 * 1024;
/** End of a stream kept in the tail. */
export const TAIL_END_CHARS = 12 * 1024;
/** A line longer than this is passed on before it ends. */
const MAX_LINE_CHARS = 64 * 1024;
/** Time the streams get to close after the tree was killed. */
const CLOSE_GRACE_MS = 1000;

const ANSI_PATTERN = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  'g'
);

/** Removes ANSI escape codes. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '');
}

/**
 * Keeps the first {@link TAIL_HEAD_CHARS} and the last
 * {@link TAIL_END_CHARS} of a stream, however long it gets.
 */
class TailKeeper {
  private head = '';
  private end = '';
  private total = 0;

  add(text: string): void {
    this.total += text.length;
    if (this.head.length < TAIL_HEAD_CHARS) {
      this.head += text.slice(0, TAIL_HEAD_CHARS - this.head.length);
    }
    this.end = (this.end + text).slice(-TAIL_END_CHARS);
  }

  /** The kept text, with a cut marker when the middle was dropped. */
  text(): string {
    if (this.total <= TAIL_HEAD_CHARS + TAIL_END_CHARS) {
      // Nothing was dropped: head and end overlap, rebuild the whole text.
      const rest = this.total - this.head.length;
      return stripAnsi(this.head + this.end.slice(this.end.length - rest));
    }
    const cut = this.total - TAIL_HEAD_CHARS - TAIL_END_CHARS;
    return stripAnsi(
      `${this.head}\n... [${cut} characters cut, see the full log] ...\n${this.end}`
    );
  }
}

/** Splits a stream into lines, keeping the unfinished last line. */
class LineSplitter {
  private rest = '';

  constructor(private readonly onLine: (line: string) => void) {}

  add(text: string): void {
    const parts = (this.rest + text).split(/\r?\n/);
    this.rest = parts.pop() ?? '';
    for (const part of parts) this.onLine(part);
    if (this.rest.length > MAX_LINE_CHARS) this.flush();
  }

  flush(): void {
    if (this.rest !== '') this.onLine(this.rest);
    this.rest = '';
  }
}

/** Options of {@link NodeCliRunner}. */
export interface NodeCliRunnerOptions {
  /** Path of the CLI entry. Defaults to our own `dist/cli.js`. */
  cliPath?: string;
  /** Folder of the log files. Defaults to `<cwd>/.polyman/agent/logs`. */
  logDir?: (cwd: string) => string;
}

/** Default log folder of a run in `cwd`. */
export function defaultLogDir(cwd: string): string {
  return path.join(cwd, '.polyman', 'agent', 'logs');
}

/** A file name like `2026-10-26T15-30-12-345Z-verify.log`. */
function logFileName(args: string[]): string {
  const time = new Date().toISOString().replace(/[:.]/g, '-');
  const command = (args[0] ?? 'polyman').replace(/[^A-Za-z0-9_-]/g, '_');
  return `${time}-${command}.log`;
}

/**
 * Writes the log. When the run folder cannot hold it, the log goes to the
 * temp folder; when that fails too, the path is empty.
 */
function writeLog(dirs: string[], name: string, content: string): string {
  for (const dir of dirs) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, name);
      fs.writeFileSync(file, content);
      return file;
    } catch {
      // try the next folder
    }
  }
  return '';
}

/** Runs `node dist/cli.js ...` with time limits and a clean kill. */
export class NodeCliRunner implements CliRunner {
  private readonly cliPath: string;
  private readonly logDir: (cwd: string) => string;

  constructor(options: NodeCliRunnerOptions = {}) {
    this.cliPath =
      options.cliPath ?? path.join(__dirname, '..', '..', 'cli.js');
    this.logDir = options.logDir ?? defaultLogDir;
  }

  run(args: string[], opts: RunOptions): Promise<RunResult> {
    return cliLock.run(() => this.runNow(args, opts), opts.signal);
  }

  private runNow(args: string[], opts: RunOptions): Promise<RunResult> {
    const json = args.includes('--json');
    const started = Date.now();

    return new Promise<RunResult>((resolve, reject) => {
      const child = spawn(process.execPath, [this.cliPath, ...args], {
        cwd: opts.cwd,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...childEnv(process.env),
          NO_COLOR: '1',
          FORCE_COLOR: '0',
          POLYMAN_AGENT: '1',
        },
        windowsHide: true,
      });

      let reason: RunResult['reason'] = 'exited';
      let stopping = false;
      let log = '';
      let logCut = false;
      let stdout = '';
      const stdoutTail = new TailKeeper();
      const stderrTail = new TailKeeper();

      const addLog = (text: string): void => {
        if (log.length >= MAX_LOG_CHARS) {
          logCut = true;
          return;
        }
        log += text.slice(0, MAX_LOG_CHARS - log.length);
        if (log.length >= MAX_LOG_CHARS) logCut = true;
      };
      const emit = (line: string): void => {
        if (!opts.onLine) return;
        try {
          opts.onLine(stripAnsi(line));
        } catch {
          // A broken listener must not break the run.
        }
      };
      const stdoutLines = new LineSplitter(emit);
      const stderrLines = new LineSplitter(emit);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', (text: string) => {
        addLog(text);
        stdoutTail.add(text);
        if (json) {
          if (stdout.length < MAX_JSON_CHARS) stdout += text;
        } else {
          stdoutLines.add(text);
        }
      });
      child.stderr.on('data', (text: string) => {
        addLog(text);
        stderrTail.add(text);
        stderrLines.add(text);
      });

      const stop = (why: 'timeout' | 'cancelled'): void => {
        if (stopping) return;
        stopping = true;
        reason = why;
        const pid = child.pid;
        if (pid === undefined) return;
        void killTree(pid)
          .catch(() => {
            child.kill('SIGKILL');
          })
          .then(() => {
            // A grandchild that left the group may still hold the pipes open.
            setTimeout(() => {
              child.stdout.destroy();
              child.stderr.destroy();
            }, CLOSE_GRACE_MS).unref();
          });
      };

      const timer = setTimeout(() => stop('timeout'), opts.timeoutMs);
      const onAbort = (): void => stop('cancelled');
      if (opts.signal.aborted) {
        stop('cancelled');
      } else {
        opts.signal.addEventListener('abort', onAbort, { once: true });
      }
      const cleanup = (): void => {
        clearTimeout(timer);
        opts.signal.removeEventListener('abort', onAbort);
      };

      child.on('error', error => {
        cleanup();
        reject(error);
      });

      child.on('close', (code: number | null) => {
        cleanup();
        stdoutLines.flush();
        stderrLines.flush();
        const durationMs = Date.now() - started;

        let parsed: unknown;
        if (json) {
          try {
            parsed = JSON.parse(stdout);
          } catch {
            parsed = undefined;
          }
        }

        const footer =
          `${logCut ? '\n... [log cut at 2 MB] ...' : ''}\n` +
          `--- exit ${code ?? 'null'}, ${reason}, ${durationMs} ms ---\n`;
        const logPath = writeLog(
          [this.logDir(opts.cwd), path.join(os.tmpdir(), 'polyman-agent-logs')],
          logFileName(args),
          `$ polyman ${args.join(' ')}\n$ cwd ${opts.cwd}\n${log}${footer}`
        );

        const result: RunResult = {
          exitCode: code,
          reason,
          stdoutTail: stdoutTail.text(),
          stderrTail: stderrTail.text(),
          logPath,
          durationMs,
        };
        if (parsed !== undefined) result.json = parsed;
        resolve(result);
      });
    });
  }
}

/** Env vars of provider keys, from the presets. */
const KEY_VARS = new Set(
  PRESETS.map(p => p.envVar.toUpperCase()).filter(v => v !== '')
);

/**
 * The env of the CLI child: `env` without API keys. The child compiles and
 * runs code the model wrote, so it must not see the provider keys. Polygon
 * commands read `~/.polyman/credentials.json`, not env.
 */
export function childEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) {
    const upper = name.toUpperCase();
    if (upper.endsWith('_API_KEY') || KEY_VARS.has(upper)) continue;
    out[name] = value;
  }
  return out;
}
