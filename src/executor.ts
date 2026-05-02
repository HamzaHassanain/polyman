/**
 * @fileoverview Command execution engine with timeout, memory limits, and process management.
 * Thin wrapper over `execa` that adds the bits execa does not handle for a competitive-programming judge:
 *   - Memory limits via `ulimit -v` (Unix) and `-Xmx` (Java).
 *   - Cross-platform process-tree kill on TLE (`taskkill /T /F` on Windows, process groups on Unix).
 *   - MLE detection from exit codes (137, SIGABRT) and stderr patterns (`bad_alloc`, `OutOfMemory`, ...).
 *   - Callback-style completion (`onSuccess` / `onError` / `onTimeout` / `onMemoryExceeded`).
 */

import { spawn } from 'child_process';
import execa from 'execa';
import { fmt } from './formatter';

/**
 * Result of a command execution containing output and status information.
 *
 * @interface ExecutionResult
 * @property {string} stdout - Standard output from the process
 * @property {string} stderr - Standard error from the process
 * @property {number} exitCode - Process exit code (0 = success)
 * @property {boolean} success - Whether execution was successful
 * @property {boolean} [timedOut] - Whether process exceeded time limit
 * @property {boolean} [memoryExceeded] - Whether process exceeded memory limit
 */
export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
  timedOut?: boolean;
  memoryExceeded?: boolean;
}

/**
 * Options for configuring command execution behavior.
 *
 * @interface ExecutionOptions
 * @property {number} timeout - Maximum execution time in milliseconds
 * @property {number} [memoryLimitMB] - Memory limit in megabytes (optional)
 * @property {string} [cwd] - Working directory for execution (optional)
 * @property {Function} [onSuccess] - Callback on successful execution
 * @property {Function} [onError] - Callback on execution error
 * @property {Function} [onTimeout] - Callback on timeout
 * @property {Function} [onMemoryExceeded] - Callback on memory limit exceeded
 * @property {boolean} [silent] - Suppress console output if true
 */
export interface ExecutionOptions {
  timeout: number;
  memoryLimitMB?: number;
  cwd?: string;
  onSuccess?: (result: ExecutionResult) => void;
  onError?: (result: ExecutionResult) => void;
  onTimeout?: (result: ExecutionResult) => void;
  onMemoryExceeded?: (result: ExecutionResult) => void;
  silent?: boolean;
}

const TIMEOUT_EXIT_CODE = 124;
const OOM_KILL_EXIT_CODE = 137;
const KILL_GRACE_PERIOD_MS = 100;
const WINDOWS_HANDLE_RELEASE_DELAY_MS = 150;

/**
 * Command executor for running external programs with resource constraints.
 * Manages process lifecycle, timeout enforcement, memory limits, and cleanup.
 * Supports cross-platform execution (Unix/Windows) with platform-specific tree-kill.
 *
 * @class CommandExecutor
 * @example
 * import { executor } from './executor';
 *
 * const result = await executor.execute('./solution', {
 *   timeout: 2000,
 *   memoryLimitMB: 256,
 *   silent: false
 * });
 */
export class CommandExecutor {
  private tempFiles: string[] = [];
  private activeProcesses: Set<execa.ExecaChildProcess> = new Set();

  /**
   * Execute a shell command with timeout and memory limits.
   * Automatically kills the process tree if it exceeds time or memory constraints.
   *
   * @param {string} command - Shell command to execute
   * @param {ExecutionOptions} options - Execution configuration
   * @returns {Promise<ExecutionResult>} Execution result with stdout, stderr, and status
   *
   * @throws {Error} If command fails and no `onError` callback is provided
   * @throws {Error} If timeout occurs and no `onTimeout` callback is provided
   * @throws {Error} If memory limit exceeded and no `onMemoryExceeded` callback is provided
   */
  async execute(
    command: string,
    options: ExecutionOptions
  ): Promise<ExecutionResult> {
    const wrappedCommand = this.applyMemoryLimit(
      command,
      options.memoryLimitMB
    );
    const platformCommand = this.normalizeCommandForPlatform(wrappedCommand);

    const execaOptions: execa.Options = {
      shell: true,
      detached: process.platform !== 'win32',
      reject: false,
      stripFinalNewline: false,
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
    };
    const subprocess = execa(platformCommand, execaOptions);
    this.activeProcesses.add(subprocess);

    let didTimeout = false;
    const timeoutId = setTimeout(() => {
      didTimeout = true;
      if (subprocess.pid !== undefined) {
        this.killProcessTree(subprocess.pid);
      }
      // Backup: ensure the direct child dies even if the tree-kill path missed it.
      try {
        subprocess.kill('SIGKILL', {
          forceKillAfterTimeout: KILL_GRACE_PERIOD_MS,
        });
      } catch {
        // Already terminated.
      }
    }, options.timeout);

    let raw: execa.ExecaReturnValue | execa.ExecaError;
    try {
      raw = await subprocess;
    } catch (err) {
      // With `reject: false` execa should not throw for runtime failures, but
      // defensive: surface anything that slips through as a spawn-style error.
      clearTimeout(timeoutId);
      this.activeProcesses.delete(subprocess);
      return this.finalizeSpawnError(
        err instanceof Error ? err : new Error(String(err)),
        options
      );
    }

    clearTimeout(timeoutId);
    this.activeProcesses.delete(subprocess);

    if (process.platform === 'win32') {
      // Give Windows a moment to release file handles before callers (e.g. checker)
      // try to read redirected output files.
      await delay(WINDOWS_HANDLE_RELEASE_DELAY_MS);
    }

    const stdout = typeof raw.stdout === 'string' ? raw.stdout : '';
    const stderr = typeof raw.stderr === 'string' ? raw.stderr : '';
    const exitCode = raw.exitCode ?? 1;
    const signal = (raw.signal ?? null) as NodeJS.Signals | null;

    if (didTimeout) {
      return this.finalizeTimeout(stdout, options);
    }

    // Spawn failure (ENOENT, EACCES, ...). execa marks `failed: true` and leaves
    // `exitCode` undefined; the human-readable reason lives on `shortMessage`.
    if (raw.failed && raw.exitCode === undefined) {
      const errLike = raw as execa.ExecaError;
      return this.finalizeSpawnError(
        new Error(errLike.shortMessage || errLike.message || stderr),
        options
      );
    }

    const result: ExecutionResult = {
      stdout,
      stderr,
      exitCode,
      success: false,
      timedOut: false,
      memoryExceeded: false,
    };

    if (this.isMemoryError(exitCode, signal, stderr)) {
      return this.finalizeMemoryError(result, exitCode, signal, options);
    }

    if (exitCode === 0 && !raw.failed) {
      return this.finalizeSuccess(result, options);
    }
    return this.finalizeError(result, options);
  }

  /**
   * Applies memory limit to a command using platform-specific methods.
   * For Java programs, uses `-Xmx` flag. For Unix, wraps in a `ulimit -v` subshell.
   * Windows memory limits are not enforced.
   */
  private applyMemoryLimit(command: string, memoryLimitMB?: number): string {
    if (!memoryLimitMB) return command;

    const isJava = command.trim().startsWith('java ');

    if (process.platform === 'win32') {
      // @Todo: Windows memory limit enforcement can be added here
      return command;
    }

    if (isJava) {
      return command.replace(/^java\s+/, `java -Xmx${memoryLimitMB}m `);
    }

    const memoryLimitKB = memoryLimitMB * 1024;
    return `(ulimit -v ${memoryLimitKB}; ${command})`;
  }

  /**
   * Normalizes command syntax for the current platform.
   * On Windows, converts `./foo` to `.\foo` and forward slashes in the executable
   * path to backslashes to avoid `ERROR_PATH_NOT_FOUND (3)` from cmd.exe.
   * Leaves arguments and redirections intact.
   */
  private normalizeCommandForPlatform(command: string): string {
    if (process.platform !== 'win32') return command;

    const match = command.match(/^(?:"([^"]+)"|([^\s<>|]+))(.*)$/);
    if (!match) return command;

    const executable = (match[1] ?? match[2] ?? '').trim();
    const rest = match[3] ?? '';

    let normalizedExec = executable;
    if (executable.startsWith('./')) {
      normalizedExec = '.\\' + executable.slice(2);
    }
    if (/\//.test(normalizedExec)) {
      normalizedExec = normalizedExec.replace(/\//g, '\\');
    }

    const wasQuoted = !!match[1];
    const finalExec = wasQuoted ? `"${normalizedExec}"` : normalizedExec;
    return `${finalExec}${rest}`;
  }

  /**
   * Finalizes a timed-out execution: emits the warning, populates the result,
   * and routes to the onTimeout callback or throws.
   */
  private async finalizeTimeout(
    stdout: string,
    options: ExecutionOptions
  ): Promise<ExecutionResult> {
    const result: ExecutionResult = {
      stdout,
      stderr: `Command timed out after ${options.timeout}ms`,
      exitCode: TIMEOUT_EXIT_CODE,
      success: false,
      timedOut: true,
      memoryExceeded: false,
    };

    if (!options.silent) {
      fmt.warning(
        `${fmt.warningIcon()} Process killed after ${options.timeout}ms timeout`
      );
    }

    if (process.platform === 'win32') {
      // Same Windows file-handle race as the success path.
      await delay(WINDOWS_HANDLE_RELEASE_DELAY_MS);
    }

    if (options.onTimeout) {
      await this.cleanup();
      options.onTimeout(result);
      return result;
    }
    throw new Error(`Process killed after ${options.timeout}ms timeout`);
  }

  /**
   * Detects if a process failed due to memory issues.
   * Checks both exit codes (137, SIGABRT) and error messages in stderr.
   */
  private isMemoryError(
    code: number | null,
    signal: NodeJS.Signals | null,
    stderr: string
  ): boolean {
    const hasMemoryExitCode =
      code === OOM_KILL_EXIT_CODE || signal === 'SIGABRT';

    const hasMemoryErrorMessage =
      stderr.includes('OutOfMemory') ||
      stderr.includes('bad_alloc') ||
      stderr.includes('OOM') ||
      stderr.includes('MemoryError');

    return hasMemoryExitCode || hasMemoryErrorMessage;
  }

  /**
   * Finalizes a memory-limit-exceeded execution.
   */
  private finalizeMemoryError(
    result: ExecutionResult,
    code: number,
    signal: NodeJS.Signals | null,
    options: ExecutionOptions
  ): ExecutionResult {
    result.memoryExceeded = true;
    result.success = false;

    if (!options.silent) {
      fmt.warning(
        `${fmt.warningIcon()} Process terminated: memory limit exceeded - Exit code: ${code}, Signal: ${signal}`
      );
    }

    if (options.onMemoryExceeded) {
      options.onMemoryExceeded(result);
      return result;
    }
    throw new Error('Memory limit exceeded');
  }

  /**
   * Finalizes a successful execution (exit code 0).
   */
  private finalizeSuccess(
    result: ExecutionResult,
    options: ExecutionOptions
  ): ExecutionResult {
    result.success = true;

    if (!options.silent && result.stdout) {
      fmt.dim(result.stdout.trim());
    }

    if (options.onSuccess) {
      options.onSuccess(result);
    }
    return result;
  }

  /**
   * Finalizes a failed execution (non-zero exit code).
   */
  private finalizeError(
    result: ExecutionResult,
    options: ExecutionOptions
  ): ExecutionResult {
    result.success = false;

    if (!options.silent && result.stderr) {
      fmt.error(`${fmt.cross()} ${result.stderr.trim()}`);
    }

    if (options.onError) {
      options.onError(result);
      return result;
    }
    throw new Error(
      `Command failed with exit code ${result.exitCode}\n${result.stderr}`
    );
  }

  /**
   * Finalizes a spawn-time failure (ENOENT, EACCES, ...).
   */
  private finalizeSpawnError(
    err: Error,
    options: ExecutionOptions
  ): ExecutionResult {
    const result: ExecutionResult = {
      stdout: '',
      stderr: err.message,
      exitCode: 1,
      success: false,
      timedOut: false,
      memoryExceeded: false,
    };

    if (!options.silent) {
      fmt.error(`${fmt.cross()} ${err.message}`);
    }

    if (options.onError) {
      options.onError(result);
      return result;
    }
    throw err;
  }

  /**
   * Kills a process and its entire child process tree.
   * Uses `taskkill /T /F` on Windows, process-group SIGKILL on Unix.
   * Falls back to single-process kill if the group call fails.
   */
  private killProcessTree(pid: number) {
    try {
      if (process.platform === 'win32') {
        spawn('taskkill', ['/pid', pid.toString(), '/T', '/F'], {
          shell: true,
          stdio: 'ignore',
        });
      } else {
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          process.kill(pid, 'SIGKILL');
        }
      }
    } catch (error: unknown) {
      if ((error as { code?: string }).code !== 'ESRCH') {
        console.log(error);
      }
      // Process already terminated
    }
  }

  /**
   * Execute a command with input/output file redirection.
   * Wraps the execute method with shell `<` / `>` redirections.
   */
  async executeWithRedirect(
    command: string,
    options: ExecutionOptions,
    inputFile?: string,
    outputFile?: string
  ): Promise<ExecutionResult> {
    const redirectedCommand = this.buildRedirectedCommand(
      command,
      inputFile,
      outputFile
    );
    return this.execute(redirectedCommand, options);
  }

  /**
   * Builds a shell command with input/output redirection.
   * Quotes paths to survive spaces and normalizes them for the current platform.
   */
  private buildRedirectedCommand(
    command: string,
    inputFile?: string,
    outputFile?: string
  ): string {
    let result = command;
    const normalizePathForPlatform = (p: string) => {
      if (process.platform !== 'win32') return p;
      let q = p;
      if (q.startsWith('./')) q = '.\\' + q.slice(2);
      if (q.startsWith('../')) q = '..\\' + q.slice(3);
      q = q.replace(/\//g, '\\');
      return q;
    };

    if (inputFile) {
      const inPath = normalizePathForPlatform(inputFile);
      result = `${result} < "${inPath}"`;
    }
    if (outputFile) {
      const outPath = normalizePathForPlatform(outputFile);
      result = `${result} > "${outPath}"`;
    }
    return result;
  }

  /**
   * Register a temporary file for tracking.
   */
  registerTempFile(filePath: string) {
    this.tempFiles.push(filePath);
  }

  /**
   * Clean up all active processes and clear temp file registry.
   * On Windows, waits briefly for file handles to be released.
   */
  async cleanup(): Promise<void> {
    if (process.platform === 'win32' && this.activeProcesses.size > 0) {
      await delay(WINDOWS_HANDLE_RELEASE_DELAY_MS);
    }

    this.killAllActiveProcesses();
    this.activeProcesses.clear();
    this.tempFiles = [];
  }

  private killAllActiveProcesses() {
    for (const child of this.activeProcesses) {
      if (child.pid !== undefined) {
        try {
          this.killProcessTree(child.pid);
          child.kill('SIGKILL');
        } catch {
          // Process already dead
        }
      }
    }
  }

  /**
   * Get a copy of the registered temporary files list.
   */
  getTempFiles(): string[] {
    return [...this.tempFiles];
  }
}

const delay = (ms: number) =>
  new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Singleton instance of CommandExecutor.
 * @constant
 * @type {CommandExecutor}
 */
export const executor = new CommandExecutor();

/**
 * Register signal handlers to ensure child processes are cleaned up
 * when the parent process is terminated (e.g., via Ctrl+C).
 */
const setupProcessCleanup = () => {
  let isCleaningUp = false;

  const cleanupAndExit = async (signal: string) => {
    if (isCleaningUp) return;
    isCleaningUp = true;

    try {
      await executor.cleanup();
    } catch {
      // Ignore cleanup errors during exit
    }

    process.exit(signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
  };

  process.on('SIGINT', () => {
    void cleanupAndExit('SIGINT');
  });

  process.on('SIGTERM', () => {
    void cleanupAndExit('SIGTERM');
  });

  process.on('uncaughtException', err => {
    console.error('Uncaught exception:', err);
    void cleanupAndExit('uncaughtException');
  });

  process.on('unhandledRejection', reason => {
    console.error('Unhandled rejection:', reason);
    void cleanupAndExit('unhandledRejection');
  });
};

setupProcessCleanup();
