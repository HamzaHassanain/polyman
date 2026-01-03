/**
 * @fileoverview Command execution engine with timeout, memory limits, and process management.
 * Provides safe execution of external programs (C++, Python, Java) with resource constraints.
 * Handles process lifecycle, cleanup, and cross-platform compatibility.
 */

import { spawn, ChildProcess } from 'child_process';
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
 *
 * @example
 * const result = await executor.execute('./solution', { timeout: 1000 });
 * if (result.success) {
 *   console.log(result.stdout);
 * }
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
 *
 * @example
 * const options = {
 *   timeout: 2000,
 *   memoryLimitMB: 256,
 *   onTimeout: (result) => console.log('Process timed out'),
 *   silent: false
 * };
 */
export interface ExecutionOptions {
  timeout: number;
  memoryLimitMB?: number;
  cwd?: string;
  onSuccess?: (result: ExecutionResult) => void;
  onError?: (result: ExecutionResult) => void;
  onTimeout?: (result: ExecutionResult) => Promise<void>;
  onMemoryExceeded?: (result: ExecutionResult) => Promise<void>;
  silent?: boolean;
}

const TIMEOUT_EXIT_CODE = 124;
const OOM_KILL_EXIT_CODE = 137;
const KILL_GRACE_PERIOD_MS = 100;

/**
 * Command executor for running external programs with resource constraints.
 * Manages process lifecycle, timeout enforcement, memory limits, and cleanup.
 * Supports cross-platform execution (Unix/Windows) with platform-specific optimizations.
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
  private activeProcesses: Set<ChildProcess> = new Set();

  /**
   * Execute a shell command with timeout and memory limits.
   * Automatically kills the process if it exceeds time or memory constraints.
   *
   * @param {string} command - Shell command to execute
   * @param {ExecutionOptions} options - Execution configuration
   * @returns {Promise<ExecutionResult>} Execution result with stdout, stderr, and status
   *
   * @throws {Error} If command fails and no onError callback is provided
   * @throws {Error} If timeout occurs and no onTimeout callback is provided
   * @throws {Error} If memory limit exceeded and no onMemoryExceeded callback is provided
   *
   * @example
   * // Run a C++ solution
   * const result = await executor.execute('./solution', {
   *   timeout: 1000,
   *   memoryLimitMB: 256
   * });
   *
   * @example
   * // With error handling
   * const result = await executor.execute('./buggy_solution', {
   *   timeout: 2000,
   *   onError: (result) => console.log('Solution failed:', result.stderr),
   *   onTimeout: (result) => console.log('TLE')
   * });
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

    return new Promise<ExecutionResult>((resolve, reject) => {
      const { process: child, result } = this.spawnProcess(
        platformCommand,
        options
      );
      const collectors = this.createOutputCollectors(child);

      // This ensures that we can cancel the timeout if the process ends early
      const [timeoutPromise, cancelTimeout] = this.cancellableDelay(
        options.timeout
      );
      timeoutPromise
        .then(() => {
          this.handleTimeout(
            child,
            options,
            result,
            collectors,
            resolve,
            reject
          );
        })
        .catch(err => {
          reject(err instanceof Error ? err : new Error(String(err)));
        });

      this.attachEventHandlers(
        child,
        options,
        result,
        collectors,
        cancelTimeout,
        resolve,
        reject
      );
    });
  }

  /**
   * Applies memory limit to a command using platform-specific methods.
   * For Java programs, uses -Xmx flag. For Unix, uses ulimit.
   * Windows memory limits are not fully supported.
   *
   * @private
   * @param {string} command - Command to wrap with memory limit
   * @param {number} [memoryLimitMB] - Memory limit in megabytes
   * @returns {string} Command wrapped with memory limit enforcement
   *
   * @example
   * // Java command
   * applyMemoryLimit('java Solution', 256)
   * // Returns: 'java -Xmx256m Solution'
   *
   * @example
   * // C++ command on Unix
   * applyMemoryLimit('./solution', 256)
   * // Returns: '(ulimit -v 262144; ./solution)'
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
   * - On Windows, converts './foo' to '.\\foo' and forward slashes in the
   *   executable path to backslashes to avoid ERROR_PATH_NOT_FOUND (3).
   * - Leaves arguments and redirections intact.
   *
   * @private
   * @param {string} command - Command line string to normalize
   * @returns {string} Normalized command string appropriate for the platform
   */
  private normalizeCommandForPlatform(command: string): string {
    if (process.platform !== 'win32') return command;

    // Split out the first token (executable) from the rest while preserving redirections
    const match = command.match(/^(?:"([^"]+)"|([^\s<>|]+))(.*)$/);
    if (!match) return command;

    const executable = (match[1] ?? match[2] ?? '').trim();
    const rest = match[3] ?? '';

    // Only adjust if the executable looks like a path (contains a slash or starts with ./)
    let normalizedExec = executable;
    if (executable.startsWith('./')) {
      normalizedExec = '.\\' + executable.slice(2);
    }
    if (/\//.test(normalizedExec)) {
      // Replace forward slashes with backslashes in the executable part only
      normalizedExec = normalizedExec.replace(/\//g, '\\');
    }

    // Re-wrap in quotes if the original was quoted
    const wasQuoted = !!match[1];
    const finalExec = wasQuoted ? `"${normalizedExec}"` : normalizedExec;
    return `${finalExec}${rest}`;
  }

  /**
   * Spawns a child process for command execution.
   * Creates a detached process in shell mode to allow process tree management.
   * Registers process in active processes set for cleanup tracking.
   *
   * @private
   * @param {string} command - Shell command to spawn
   * @param {ExecutionOptions} options - Execution options including cwd
   * @returns {{process: ChildProcess, result: ExecutionResult}} Spawned process and empty result object
   *
   * @example
   * const { process, result } = this.spawnProcess('./solution', { timeout: 1000 });
   */
  private spawnProcess(command: string, options: ExecutionOptions) {
    const child = spawn(command, {
      shell: true,
      cwd: options.cwd,
      // if on window, we cannot use detached processes properly
      detached: process.platform !== 'win32',
    });

    this.activeProcesses.add(child);

    return {
      process: child,
      result: this.createEmptyResult(),
    };
  }

  /**
   * Creates an empty execution result object with default values.
   * Used as initial state before process execution completes.
   *
   * @private
   * @returns {ExecutionResult} Empty result with default values
   *
   * @example
   * const result = this.createEmptyResult();
   * // Returns: { stdout: '', stderr: '', exitCode: 0, success: false, ... }
   */
  private createEmptyResult(): ExecutionResult {
    return {
      stdout: '',
      stderr: '',
      exitCode: 0,
      success: false,
      timedOut: false,
      memoryExceeded: false,
    };
  }

  /**
   * Creates output collectors for stdout and stderr streams.
   * Attaches data event handlers to accumulate process output.
   * Tracks whether the result has been resolved to prevent race conditions.
   *
   * @private
   * @param {ChildProcess} child - Child process to collect output from
   * @returns {{stdout: string, stderr: string, isResolved: boolean}} Output collectors object
   *
   * @example
   * const collectors = this.createOutputCollectors(child);
   * // collectors.stdout and collectors.stderr accumulate as process runs
   */
  private createOutputCollectors(child: ChildProcess) {
    const collectors = { stdout: '', stderr: '', isResolved: false };

    child.stdout?.on('data', (data: Buffer) => {
      collectors.stdout += data.toString();
    });

    child.stderr?.on('data', (data: Buffer) => {
      collectors.stderr += data.toString();
    });

    return collectors;
  }
  /**
   * Creates a cancellable delay promise for timeout implementation.
   * Returns both the timeout promise and a cancel function.
   * Cancel function clears the timeout to prevent unnecessary process kills.
   *
   * @private
   * @param {number} ms - Delay duration in milliseconds
   * @returns {[Promise<void>, () => void]} Tuple of [timeout promise, cancel function]
   *
   * @example
   * const [timeoutPromise, cancelTimeout] = this.cancellableDelay(1000);
   * timeoutPromise.then(() => console.log('Timed out'));
   * // Later, if process finishes early:
   * cancelTimeout();
   */
  private cancellableDelay(ms: number): [Promise<void>, () => void] {
    let timeoutId: NodeJS.Timeout;

    const promise = new Promise<void>(resolve => {
      timeoutId = setTimeout(resolve, ms);
    });

    const cancel = () => {
      clearTimeout(timeoutId);
    };

    return [promise, cancel];
  }

  /**
   * Handles timeout scenario when process exceeds time limit.
   * Kills the process tree, updates result with timeout status, and invokes callbacks.
   * Uses SIGKILL after grace period to ensure process termination.
   *
   * @private
   * @param {ChildProcess} child - Process that timed out
   * @param {ExecutionOptions} options - Execution options with timeout callback
   * @param {ExecutionResult} result - Result object to update
   * @param {{stdout: string, stderr: string, isResolved: boolean}} collectors - Output collectors
   * @param {(value: ExecutionResult) => void} resolve - Promise resolve function
   * @param {(reason?: unknown) => void} reject - Promise reject function
   *
   * @example
   * // Called internally when timeout occurs
   * this.handleTimeout(child, options, result, collectors, resolve, reject);
   */
  private handleTimeout(
    child: ChildProcess,
    options: ExecutionOptions,
    result: ExecutionResult,
    collectors: { stdout: string; stderr: string; isResolved: boolean },
    resolve: (value: ExecutionResult) => void,
    reject: (reason?: unknown) => void
  ) {
    if (collectors.isResolved || child.killed) return;

    collectors.isResolved = true;
    result.timedOut = true;

    Object.assign(result, {
      stdout: collectors.stdout,
      stderr: `Command timed out after ${options.timeout}ms`,
      exitCode: TIMEOUT_EXIT_CODE,
      success: false,
    });

    if (!options.silent) {
      fmt.warning(
        `${fmt.warningIcon()} Process killed after ${options.timeout}ms timeout`
      );
    }

    // Kill process and wait for cleanup before resolving
    this.killProcessTree(child.pid!);

    const finalizeTimeout = () => {
      child.kill('SIGSEGV');

      // On Windows, wait for file handles to be released before resolving
      const cleanupDelay = process.platform === 'win32' ? 1000 : 0;

      setTimeout(() => {
        this.activeProcesses.delete(child);

        if (options.onTimeout) {
          this.cleanup()
            .then(() => {
              options.onTimeout!(result)
                .then(() => {
                  resolve(result);
                })
                .catch(error => {
                  reject(
                    error instanceof Error ? error : new Error(String(error))
                  );
                });
            })
            .catch(error =>
              reject(error instanceof Error ? error : new Error(String(error)))
            );
        } else {
          reject(
            new Error(`Process killed after ${options.timeout}ms timeout`)
          );
        }
      }, cleanupDelay);
    };

    setTimeout(finalizeTimeout, KILL_GRACE_PERIOD_MS);
  }

  /**
   * Attaches event handlers for process lifecycle events (close, error).
   * Handles process completion, cleanup, and error scenarios.
   * Ensures timeout is cancelled when process ends naturally.
   *
   * @private
   * @param {ChildProcess} child - Child process to attach handlers to
   * @param {ExecutionOptions} options - Execution options
   * @param {ExecutionResult} result - Result object to populate
   * @param {{stdout: string, stderr: string, isResolved: boolean}} collectors - Output collectors
   * @param {() => void} cancelTimeout - Function to cancel timeout
   * @param {(value: ExecutionResult) => void} resolve - Promise resolve function
   * @param {(reason?: unknown) => void} reject - Promise reject function
   *
   * @example
   * // Called internally during execute()
   * this.attachEventHandlers(child, options, result, collectors, cancelTimeout, resolve, reject);
   */
  private attachEventHandlers(
    child: ChildProcess,
    options: ExecutionOptions,
    result: ExecutionResult,
    collectors: { stdout: string; stderr: string; isResolved: boolean },
    cancelTimeout: () => void,
    resolve: (value: ExecutionResult) => void,
    reject: (reason?: unknown) => void
  ) {
    child.on('close', (code, signal) => {
      if (collectors.isResolved) return;
      collectors.isResolved = true;
      cancelTimeout();

      // On Windows, add a small delay to ensure file handles are released

      const cleanup = () => {
        this.activeProcesses.delete(child);
        try {
          this.handleProcessClose(
            code,
            signal,
            options,
            result,
            collectors,
            resolve,
            reject
          );
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      };

      if (process.platform === 'win32') {
        setTimeout(cleanup, 50);
      } else {
        this.activeProcesses.delete(child);
        cleanup();
      }
    });

    child.on('error', err => {
      if (collectors.isResolved) return;
      cancelTimeout();
      this.activeProcesses.delete(child);
      collectors.isResolved = true;
      try {
        this.handleProcessError(err, options, result, resolve, reject);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /**
   * Handles process close event and determines outcome.
   * Routes to appropriate handler based on exit code and signals.
   * Checks for memory errors, success (code 0), or general errors.
   *
   * @private
   * @param {number | null} code - Process exit code
   * @param {NodeJS.Signals | null} signal - Process termination signal
   * @param {ExecutionOptions} options - Execution options
   * @param {ExecutionResult} result - Result object to populate
   * @param {{stdout: string, stderr: string}} collectors - Output collectors
   * @param {(value: ExecutionResult) => void} resolve - Promise resolve function
   * @param {(reason?: unknown) => void} reject - Promise reject function
   *
   * @example
   * // Called internally by close event handler
   * this.handleProcessClose(0, null, options, result, collectors, resolve, reject);
   */
  private handleProcessClose(
    code: number | null,
    signal: NodeJS.Signals | null,
    options: ExecutionOptions,
    result: ExecutionResult,
    collectors: { stdout: string; stderr: string },
    resolve: (value: ExecutionResult) => void,
    reject: (reason?: unknown) => void
  ) {
    Object.assign(result, {
      stdout: collectors.stdout,
      stderr: collectors.stderr,
      exitCode: code ?? 1,
    });

    if (this.isMemoryError(code, signal, collectors.stderr)) {
      this.handleMemoryError(code, signal, options, result, resolve, reject);
      return;
    }

    if (code === 0) {
      this.handleSuccess(options, result, resolve);
    } else {
      this.handleError(options, result, resolve, reject);
    }
  }

  /**
   * Detects if process failed due to memory issues.
   * Checks both exit codes (137, SIGABRT) and error messages in stderr.
   * Recognizes common memory error patterns across languages.
   *
   * @private
   * @param {number | null} code - Process exit code
   * @param {NodeJS.Signals | null} signal - Process termination signal
   * @param {string} stderr - Standard error output
   * @returns {boolean} True if memory error detected
   *
   * @example
   * // Exit code 137 indicates OOM kill
   * this.isMemoryError(137, null, '') // returns true
   *
   * @example
   * // C++ bad_alloc exception
   * this.isMemoryError(1, null, 'terminate called after throwing bad_alloc') // returns true
   */
  private isMemoryError(
    code: number | null,
    signal: NodeJS.Signals | null,
    stderr: string
  ): boolean {
    const hasMemoryExitCode =
      code === OOM_KILL_EXIT_CODE ||
      // code === ABORT_EXIT_CODE ||
      signal === 'SIGABRT';

    const hasMemoryErrorMessage =
      stderr.includes('OutOfMemory') ||
      stderr.includes('bad_alloc') ||
      stderr.includes('OOM') ||
      stderr.includes('MemoryError');

    return hasMemoryExitCode || hasMemoryErrorMessage;
  }

  /**
   * Handles memory limit exceeded scenario.
   * Updates result with MLE status and invokes appropriate callback.
   * Displays warning unless silent mode is enabled.
   *
   * @private
   * @param {number | null} code - Process exit code
   * @param {NodeJS.Signals | null} signal - Process termination signal
   * @param {ExecutionOptions} options - Execution options with MLE callback
   * @param {ExecutionResult} result - Result object to update
   * @param {(value: ExecutionResult) => void} resolve - Promise resolve function
   * @param {(reason?: unknown) => void} reject - Promise reject function
   *
   * @example
   * // Called when OOM detected
   * this.handleMemoryError(137, null, options, result, resolve, reject);
   */
  private handleMemoryError(
    code: number | null,
    signal: NodeJS.Signals | null,
    options: ExecutionOptions,
    result: ExecutionResult,
    resolve: (value: ExecutionResult) => void,
    reject: (reason?: unknown) => void
  ) {
    result.memoryExceeded = true;
    result.success = false;

    if (!options.silent) {
      fmt.warning(
        `${fmt.warningIcon()} Process terminated: memory limit exceeded - Exit code: ${code}, Signal: ${signal}`
      );
    }

    if (options.onMemoryExceeded) {
      options
        .onMemoryExceeded(result)
        .then(() => {
          resolve(result);
        })
        .catch(error => {
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    } else {
      reject(new Error('Memory limit exceeded'));
    }
  }

  /**
   * Handles successful process execution (exit code 0).
   * Updates result status, displays output unless silent, and invokes success callback.
   *
   * @private
   * @param {ExecutionOptions} options - Execution options with success callback
   * @param {ExecutionResult} result - Result object to update
   * @param {(value: ExecutionResult) => void} resolve - Promise resolve function
   *
   * @example
   * // Called when process exits with code 0
   * this.handleSuccess(options, result, resolve);
   */
  private handleSuccess(
    options: ExecutionOptions,
    result: ExecutionResult,
    resolve: (value: ExecutionResult) => void
  ) {
    result.success = true;

    if (!options.silent && result.stdout) {
      fmt.dim(result.stdout.trim());
    }

    options.onSuccess?.(result);
    resolve(result);
  }

  /**
   * Handles failed process execution (non-zero exit code).
   * Updates result status, displays error unless silent, and invokes error callback or rejects.
   *
   * @private
   * @param {ExecutionOptions} options - Execution options with error callback
   * @param {ExecutionResult} result - Result object to update
   * @param {(value: ExecutionResult) => void} resolve - Promise resolve function
   * @param {(reason?: unknown) => void} reject - Promise reject function
   *
   * @example
   * // Called when process exits with non-zero code
   * this.handleError(options, result, resolve, reject);
   */
  private handleError(
    options: ExecutionOptions,
    result: ExecutionResult,
    resolve: (value: ExecutionResult) => void,
    reject: (reason?: unknown) => void
  ) {
    result.success = false;

    if (!options.silent && result.stderr) {
      fmt.error(`${fmt.cross()} ${result.stderr.trim()}`);
    }

    if (options.onError) {
      options.onError(result);
      resolve(result);
    } else {
      reject(
        new Error(
          `Command failed with exit code ${result.exitCode}\n${result.stderr}`
        )
      );
    }
  }

  /**
   * Handles process spawn errors (e.g., command not found, permission denied).
   * Updates result with error information and invokes error callback or rejects.
   *
   * @private
   * @param {Error} err - Error from process spawn
   * @param {ExecutionOptions} options - Execution options with error callback
   * @param {ExecutionResult} result - Result object to update
   * @param {(value: ExecutionResult) => void} resolve - Promise resolve function
   * @param {(reason?: unknown) => void} reject - Promise reject function
   *
   * @example
   * // Called when spawn() throws error
   * this.handleProcessError(new Error('ENOENT'), options, result, resolve, reject);
   */
  private handleProcessError(
    err: Error,
    options: ExecutionOptions,
    result: ExecutionResult,
    resolve: (value: ExecutionResult) => void,
    reject: (reason?: unknown) => void
  ) {
    result.success = false;
    result.stderr = err.message;
    result.exitCode = 1;

    if (!options.silent) {
      fmt.error(`${fmt.cross()} ${err.message}`);
    }

    if (options.onError) {
      options.onError(result);
      resolve(result);
    } else {
      reject(err);
    }
  }

  /**
   * Kills a process and its entire child process tree.
   * Uses platform-specific methods: taskkill on Windows, process groups on Unix.
   * Attempts to kill process group first, falls back to single process.
   *
   * @private
   * @param {number} pid - Process ID to kill
   *
   * @example
   * // Kill process tree on Unix
   * this.killProcessTree(12345);
   * // Sends SIGKILL to -12345 (process group)
   *
   * @example
   * // Kill process tree on Windows
   * this.killProcessTree(12345);
   * // Runs: taskkill /pid 12345 /T /F
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
          process.kill(-pid, 'SIGSEGV');
        } catch {
          process.kill(pid, 'SIGSEGV');
        }
      }
    } catch (error) {
      console.log(error);

      // Process already terminated
    }
  }

  /**
   * Execute a command with input/output file redirection.
   * Wraps the execute method with automatic stdin/stdout redirection.
   *
   * @param {string} command - Shell command to execute
   * @param {ExecutionOptions} options - Execution configuration
   * @param {string} [inputFile] - Path to file for stdin redirection (optional)
   * @param {string} [outputFile] - Path to file for stdout redirection (optional)
   * @returns {Promise<ExecutionResult>} Execution result
   *
   * @example
   * // Run solution with test input and capture output
   * await executor.executeWithRedirect(
   *   './solution',
   *   { timeout: 1000 },
   *   'tests/test1.txt',
   *   'output.txt'
   * );
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
   * Appends stdin (<) and stdout (>) redirections as needed.
   *
   * @private
   * @param {string} command - Base command to execute
   * @param {string} [inputFile] - Optional input file path for stdin
   * @param {string} [outputFile] - Optional output file path for stdout
   * @returns {string} Command with redirection operators
   *
   * @example
   * buildRedirectedCommand('./solution', 'input.txt', 'output.txt')
   * // Returns: './solution < input.txt > output.txt'
   *
   * @example
   * buildRedirectedCommand('./solution', 'input.txt')
   * // Returns: './solution < input.txt'
   */
  private buildRedirectedCommand(
    command: string,
    inputFile?: string,
    outputFile?: string
  ): string {
    let result = command;
    // Normalize file paths for the current platform and quote for spaces
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
   * Useful for cleanup operations after execution completes.
   *
   * @param {string} filePath - Path to the temporary file
   *
   * @example
   * executor.registerTempFile('/tmp/test_output.txt');
   */
  registerTempFile(filePath: string) {
    this.tempFiles.push(filePath);
  }

  /**
   * Clean up all active processes and clear temp file registry.
   * Kills any running processes and resets internal state.
   * Should be called when shutting down or after batch operations.
   * On Windows, waits for file handles to be released.
   *
   * @returns {Promise<void>} Resolves when cleanup is complete
   *
   * @example
   * try {
   *   await runAllTests();
   * } finally {
   *   await executor.cleanup();
   * }
   */
  async cleanup(): Promise<void> {
    // On Windows, wait for file handles to be released
    if (process.platform === 'win32' && this.activeProcesses.size > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    this.killAllActiveProcesses();
    this.activeProcesses.clear();
    this.tempFiles = [];
  }

  /**
   * Kills all currently active processes tracked by the executor.
   * Iterates through active processes set and kills each process tree.
   * Used during cleanup or shutdown operations.
   *
   * @private
   *
   * @example
   * // Called by cleanup() method
   * this.killAllActiveProcesses();
   */
  private killAllActiveProcesses() {
    for (const process of this.activeProcesses) {
      if (process.pid) {
        try {
          this.killProcessTree(process.pid);
          process.kill('SIGKILL');
        } catch {
          // Process already dead
        }
      }
    }
  }

  /**
   * Get a copy of the registered temporary files list.
   *
   * @returns {string[]} Array of temporary file paths
   *
   * @example
   * const tempFiles = executor.getTempFiles();
   * tempFiles.forEach(file => fs.unlinkSync(file));
   */
  getTempFiles(): string[] {
    return [...this.tempFiles];
  }
}

/**
 * Singleton instance of CommandExecutor.
 * Import and use this instance throughout the application.
 *
 * @constant
 * @type {CommandExecutor}
 * @example
 * import { executor } from './executor';
 *
 * const result = await executor.execute('./solution', {
 *   timeout: 2000,
 *   memoryLimitMB: 256
 * });
 */
export const executor = new CommandExecutor();
