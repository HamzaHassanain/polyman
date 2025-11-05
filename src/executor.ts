import { spawn, ChildProcess } from 'child_process';
import { logger } from './logger';

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
  timedOut?: boolean;
  memoryExceeded?: boolean;
}

export interface ExecutionOptions {
  timeout: number;
  memoryLimitMB?: number; // Memory limit in megabytes
  cwd?: string;
  onSuccess?: (result: ExecutionResult) => void;
  onError?: (result: ExecutionResult) => void;
  onTimeout?: (result: ExecutionResult) => void;
  onMemoryExceeded?: (result: ExecutionResult) => void;
  silent?: boolean;
}

export class CommandExecutor {
  private tempFiles: string[] = [];
  private activeProcesses: Set<ChildProcess> = new Set();

  async execute(
    command: string,
    options: ExecutionOptions
  ): Promise<ExecutionResult> {
    const {
      timeout,
      memoryLimitMB,
      cwd,
      onSuccess,
      onError,
      onTimeout,
      onMemoryExceeded,
      silent = false,
    } = options;

    const result: ExecutionResult = {
      stdout: '',
      stderr: '',
      exitCode: 0,
      success: false,
      timedOut: false,
      memoryExceeded: false,
    };

    return new Promise<ExecutionResult>(resolve => {
      // Wrap command with memory limit if specified
      let wrappedCommand = command;
      if (memoryLimitMB) {
        wrappedCommand = this.wrapCommandWithMemoryLimit(
          command,
          memoryLimitMB
        );
      }

      // Use shell to execute the command
      const child = spawn(wrappedCommand, {
        shell: true,
        cwd,
        detached: true, // Create a new process group
      });

      this.activeProcesses.add(child);

      let stdoutData = '';
      let stderrData = '';
      let isResolved = false;

      child.stdout?.on('data', (data: Buffer) => {
        stdoutData += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderrData += data.toString();
      });

      const timeoutId = setTimeout(() => {
        if (!isResolved && child.pid && !child.killed) {
          result.timedOut = true;
          isResolved = true;

          this.killProcessTree(child.pid);

          setTimeout(() => {
            if (!child.killed) {
              child.kill('SIGKILL');
            }
          }, 100);

          clearTimeout(timeoutId);
          this.activeProcesses.delete(child);

          result.stdout = stdoutData;
          result.stderr = `Command timed out after ${timeout}ms`;
          result.exitCode = 124; // Timeout exit code
          result.success = false;

          if (!silent) {
            logger.warning(`Process killed after ${timeout}ms timeout`);
          }

          if (onTimeout) {
            onTimeout(result);
          }
          resolve(result);
        }
      }, timeout);

      child.on('close', (code, signal) => {
        if (isResolved) return; // Already handled by timeout

        clearTimeout(timeoutId);
        this.activeProcesses.delete(child);
        isResolved = true;

        result.stdout = stdoutData;
        result.stderr = stderrData;
        result.exitCode = code ?? (signal ? 1 : 0);

        const possibleMemoryError =
          code === 137 || // Exit code 137 = 128 + 9 (SIGKILL, often from OOM killer)
          code === 139 || // Exit code 139 = 128 + 11 (SIGSEGV, segfault from bad allocation)
          code === 134 || // SIGABRT - often from failed allocation
          signal === 'SIGABRT';

        const hasMemoryErrorMessage =
          stderrData.includes('OutOfMemory') ||
          stderrData.includes('bad_alloc') ||
          stderrData.includes('OOM') ||
          stderrData.includes('MemoryError');

        if (possibleMemoryError || hasMemoryErrorMessage) {
          result.memoryExceeded = true;
          result.success = false;

          if (!silent) {
            logger.warning(
              `Process terminated: possible memory limit exceeded (${memoryLimitMB}MB) - Exit code: ${code}, Signal: ${signal}`
            );
          }

          if (onMemoryExceeded) {
            onMemoryExceeded(result);
          }

          resolve(result);
          return;
        }

        if (code === 0) {
          result.success = true;

          if (!silent && result.stdout) {
            logger.dim(result.stdout.trim());
          }

          if (onSuccess) {
            onSuccess(result);
          }
        } else {
          result.success = false;

          if (!silent && result.stderr) {
            logger.error(result.stderr.trim());
          }

          if (onError) {
            onError(result);
          }
        }

        resolve(result);
      });

      child.on('error', err => {
        if (isResolved) return;

        clearTimeout(timeoutId);
        this.activeProcesses.delete(child);
        isResolved = true;

        result.success = false;
        result.stderr = err.message;
        result.exitCode = 1;

        if (!silent) {
          logger.error(err.message);
        }

        if (onError) {
          onError(result);
        }

        resolve(result);
      });
    });
  }

  private killProcessTree(pid: number) {
    try {
      if (process.platform === 'win32') {
        // On Windows, use taskkill to kill the process tree
        spawn('taskkill', ['/pid', pid.toString(), '/T', '/F'], {
          shell: true,
          stdio: 'ignore',
        });
      } else {
        // On Unix-like systems, kill the entire process group
        // The negative PID kills the process group
        try {
          process.kill(-pid, 'SIGKILL');
        } catch {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Process might already be dead
          }
        }
      }
    } catch {
      // Ignore errors - process might already be terminated
    }
  }

  private wrapCommandWithMemoryLimit(
    command: string,
    memoryLimitMB: number
  ): string {
    // On Unix-like systems, use ulimit to set memory limit

    const isJava = command.trim().startsWith('java ');

    if (process.platform !== 'win32' && !isJava) {
      const memoryLimitKB = memoryLimitMB * 1024;

      return `(ulimit -v ${memoryLimitKB} ; ${command})`;
    }
    if (isJava) {
      const memoryLimitKB = memoryLimitMB * 1024;
      const newCommand = command.replace(
        /^java\s+/,
        `java -Xmx${memoryLimitKB}k `
      );

      return newCommand;
    }

    logger.warning(
      'Memory limits on Windows are not fully supported. Process will run without memory restrictions.'
    );
    return command;
  }

  async executeWithRedirect(
    command: string,
    options: ExecutionOptions,
    inputFile?: string,
    outputFile?: string
  ): Promise<ExecutionResult> {
    let fullCommand = command;

    if (inputFile) {
      fullCommand = `${fullCommand} < ${inputFile}`;
    }

    if (outputFile) {
      fullCommand = `${fullCommand} > ${outputFile}`;
    }

    return this.execute(fullCommand, {
      ...options,
    });
  }

  registerTempFile(filePath: string) {
    this.tempFiles.push(filePath);
  }

  cleanup() {
    for (const process of this.activeProcesses) {
      if (process.pid && !process.killed) {
        try {
          this.killProcessTree(process.pid);
          process.kill('SIGKILL');
        } catch {
          // Process might already be dead
        }
      }
    }
    this.activeProcesses.clear();

    // Note: We don't automatically delete temp files as they might be test outputs
    // that need to be preserved. This is just for tracking.
    this.tempFiles = [];
  }

  getTempFiles(): string[] {
    return [...this.tempFiles];
  }
}

// Singleton instance
export const executor = new CommandExecutor();
