/**
 * Small compile and run helpers for the checkpoints: compile one C++ file,
 * run it on one input, compare tokens. Everything goes through one FIFO
 * queue, so parallel workers never run many compiles at once.
 */

import { execFile, spawn } from 'child_process';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';

/** The result of {@link compileCpp}. */
export type CompileResult =
  { ok: true; binary: string } | { ok: false; error: string };

/** The result of {@link runOnInput}. */
export type RunOutput =
  | { ok: true; stdout: string; ms: number }
  | { ok: false; error: string; timedOut?: true };

const COMPILE_TIMEOUT_MS = 60_000;
const MAX_OUTPUT = 1024 * 1024;
/** Stdout of a run: big enough for a max test (a generator prints one). */
const MAX_STDOUT = 64 * 1024 * 1024;

let queue: Promise<unknown> = Promise.resolve();

/** Runs `fn` after every job queued before it. */
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => undefined);
  return run;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Compiles a C++ file with `g++ -std=c++17 -O2 -I <problemDir>` into a
 * temporary binary. `file` is relative to `problemDir` or absolute. The
 * `POLYMAN_CXX` environment variable picks another compiler, like the CLI.
 */
export function compileCpp(
  file: string,
  problemDir: string,
  signal: AbortSignal
): Promise<CompileResult> {
  return enqueue(async () => {
    if (signal.aborted) return { ok: false, error: 'cancelled' };
    const source = path.resolve(problemDir, file);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'polyman-agent-'));
    const binary = path.join(
      dir,
      process.platform === 'win32' ? 'prog.exe' : 'prog'
    );
    const cxx = process.env['POLYMAN_CXX'] || 'g++';
    const args = ['-std=c++17', '-O2', '-I', problemDir, '-o', binary, source];

    return new Promise<CompileResult>(resolve => {
      execFile(
        cxx,
        args,
        {
          cwd: problemDir,
          timeout: COMPILE_TIMEOUT_MS,
          signal,
          maxBuffer: MAX_OUTPUT,
          windowsHide: true,
        },
        (error, _stdout, stderr) => {
          if (!error) {
            resolve({ ok: true, binary });
            return;
          }
          void fs.rm(dir, { recursive: true, force: true });
          const text = String(stderr).trim();
          if (signal.aborted) resolve({ ok: false, error: 'cancelled' });
          else if (error.killed) {
            resolve({ ok: false, error: 'compile timed out after 60 s' });
          } else resolve({ ok: false, error: text || message(error) });
        }
      );
    });
  });
}

/** Removes a binary made by {@link compileCpp} and its folder. */
export async function removeBinary(binary: string): Promise<void> {
  await fs.rm(path.dirname(binary), { recursive: true, force: true });
}

/**
 * Runs a binary with `input` on stdin and `args` on the command line.
 * Returns its stdout and the time it took, or an error for a timeout, a
 * crash or a non-zero exit code.
 */
export function runOnInput(
  binary: string,
  input: string,
  timeoutMs = 5000,
  signal?: AbortSignal,
  args: string[] = []
): Promise<RunOutput> {
  return enqueue(
    () =>
      new Promise<RunOutput>(resolve => {
        if (signal?.aborted) {
          resolve({ ok: false, error: 'cancelled' });
          return;
        }
        const start = Date.now();
        const child = spawn(binary, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        let reason: 'timeout' | 'cancelled' | null = null;
        const kill = (why: 'timeout' | 'cancelled'): void => {
          reason = why;
          child.kill('SIGKILL');
        };
        const timer = setTimeout(() => kill('timeout'), timeoutMs);
        const onAbort = (): void => kill('cancelled');
        signal?.addEventListener('abort', onAbort, { once: true });

        child.stdout.on('data', (chunk: Buffer) => {
          if (stdout.length < MAX_STDOUT) stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk: Buffer) => {
          if (stderr.length < MAX_OUTPUT) stderr += chunk.toString();
        });
        child.stdin.on('error', () => undefined);
        child.on('error', error => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          resolve({ ok: false, error: `cannot run: ${error.message}` });
        });
        child.on('close', (code, sig) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          if (reason === 'timeout') {
            resolve({
              ok: false,
              error: `timed out after ${timeoutMs} ms`,
              timedOut: true,
            });
          } else if (reason === 'cancelled') {
            resolve({ ok: false, error: 'cancelled' });
          } else if (sig) {
            resolve({ ok: false, error: `crashed with signal ${sig}` });
          } else if (code !== 0) {
            const tail = stderr.trim().split('\n').slice(-3).join('\n');
            resolve({
              ok: false,
              error: `exit code ${code}${tail ? `: ${tail}` : ''}`,
            });
          } else {
            resolve({ ok: true, stdout, ms: Date.now() - start });
          }
        });
        child.stdin.end(input);
      })
  );
}

/** True when both texts have the same whitespace-separated tokens. */
export function sameTokens(a: string, b: string): boolean {
  const ta = a.split(/\s+/).filter(Boolean);
  const tb = b.split(/\s+/).filter(Boolean);
  return ta.length === tb.length && ta.every((t, i) => t === tb[i]);
}
