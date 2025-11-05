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
const SEGFAULT_EXIT_CODE = 139;
const ABORT_EXIT_CODE = 134;
const KILL_GRACE_PERIOD_MS = 100;

export class CommandExecutor {
  private tempFiles: string[] = [];
  private activeProcesses: Set<ChildProcess> = new Set();

  async execute(
    command: string,
    options: ExecutionOptions
  ): Promise<ExecutionResult> {
    const wrappedCommand = this.applyMemoryLimit(
      command,
      options.memoryLimitMB
    );

    return new Promise<ExecutionResult>(resolve => {
      const { process: child, result } = this.spawnProcess(
        wrappedCommand,
        options
      );
      const collectors = this.createOutputCollectors(child);
      const timeoutHandler = this.createTimeoutHandler(
        child,
        options,
        result,
        collectors,
        resolve
      );

      this.attachEventHandlers(
        child,
        options,
        result,
        collectors,
        timeoutHandler,
        resolve
      );
    });
  }

  private applyMemoryLimit(command: string, memoryLimitMB?: number): string {
    if (!memoryLimitMB) return command;

    const isJava = command.trim().startsWith('java ');

    if (process.platform === 'win32') {
      logger.warning('Memory limits on Windows are not fully supported.');
      return command;
    }

    if (isJava) {
      return command.replace(/^java\s+/, `java -Xmx${memoryLimitMB}m `);
    }

    const memoryLimitKB = memoryLimitMB * 1024;
    return `(ulimit -v ${memoryLimitKB}; ${command})`;
  }

  private spawnProcess(command: string, options: ExecutionOptions) {
    const child = spawn(command, {
      shell: true,
      cwd: options.cwd,
      detached: true,
    });

    this.activeProcesses.add(child);

    return {
      process: child,
      result: this.createEmptyResult(),
    };
  }

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

  private createTimeoutHandler(
    child: ChildProcess,
    options: ExecutionOptions,
    result: ExecutionResult,
    collectors: { stdout: string; stderr: string; isResolved: boolean },
    resolve: (value: ExecutionResult) => void
  ) {
    return setTimeout(() => {
      if (collectors.isResolved || !child.pid || child.killed) return;

      this.handleTimeout(child, options, result, collectors, resolve);
    }, options.timeout);
  }

  private handleTimeout(
    child: ChildProcess,
    options: ExecutionOptions,
    result: ExecutionResult,
    collectors: { stdout: string; stderr: string; isResolved: boolean },
    resolve: (value: ExecutionResult) => void
  ) {
    collectors.isResolved = true;
    result.timedOut = true;

    this.killProcessTree(child.pid!);
    setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_PERIOD_MS);

    this.activeProcesses.delete(child);

    Object.assign(result, {
      stdout: collectors.stdout,
      stderr: `Command timed out after ${options.timeout}ms`,
      exitCode: TIMEOUT_EXIT_CODE,
      success: false,
    });

    if (!options.silent) {
      logger.warning(`Process killed after ${options.timeout}ms timeout`);
    }

    options.onTimeout?.(result);
    resolve(result);
  }

  private attachEventHandlers(
    child: ChildProcess,
    options: ExecutionOptions,
    result: ExecutionResult,
    collectors: { stdout: string; stderr: string; isResolved: boolean },
    timeoutId: NodeJS.Timeout,
    resolve: (value: ExecutionResult) => void
  ) {
    child.on('close', (code, signal) => {
      if (collectors.isResolved) return;

      clearTimeout(timeoutId);
      this.activeProcesses.delete(child);
      collectors.isResolved = true;

      this.handleProcessClose(
        code,
        signal,
        options,
        result,
        collectors,
        resolve
      );
    });

    child.on('error', err => {
      if (collectors.isResolved) return;

      clearTimeout(timeoutId);
      this.activeProcesses.delete(child);
      collectors.isResolved = true;

      this.handleProcessError(err, options, result, resolve);
    });
  }

  private handleProcessClose(
    code: number | null,
    signal: NodeJS.Signals | null,
    options: ExecutionOptions,
    result: ExecutionResult,
    collectors: { stdout: string; stderr: string },
    resolve: (value: ExecutionResult) => void
  ) {
    Object.assign(result, {
      stdout: collectors.stdout,
      stderr: collectors.stderr,
      exitCode: code ?? 1,
    });

    if (this.isMemoryError(code, signal, collectors.stderr)) {
      this.handleMemoryError(code, signal, options, result, resolve);
      return;
    }

    if (code === 0) {
      this.handleSuccess(options, result, resolve);
    } else {
      this.handleError(options, result, resolve);
    }
  }

  private isMemoryError(
    code: number | null,
    signal: NodeJS.Signals | null,
    stderr: string
  ): boolean {
    const hasMemoryExitCode =
      code === OOM_KILL_EXIT_CODE ||
      code === SEGFAULT_EXIT_CODE ||
      code === ABORT_EXIT_CODE ||
      signal === 'SIGABRT';

    const hasMemoryErrorMessage =
      stderr.includes('OutOfMemory') ||
      stderr.includes('bad_alloc') ||
      stderr.includes('OOM') ||
      stderr.includes('MemoryError');

    return hasMemoryExitCode || hasMemoryErrorMessage;
  }

  private handleMemoryError(
    code: number | null,
    signal: NodeJS.Signals | null,
    options: ExecutionOptions,
    result: ExecutionResult,
    resolve: (value: ExecutionResult) => void
  ) {
    result.memoryExceeded = true;
    result.success = false;

    if (!options.silent) {
      logger.warning(
        `Process terminated: memory limit exceeded - Exit code: ${code}, Signal: ${signal}`
      );
    }

    options.onMemoryExceeded?.(result);
    resolve(result);
  }

  private handleSuccess(
    options: ExecutionOptions,
    result: ExecutionResult,
    resolve: (value: ExecutionResult) => void
  ) {
    result.success = true;

    if (!options.silent && result.stdout) {
      logger.dim(result.stdout.trim());
    }

    options.onSuccess?.(result);
    resolve(result);
  }

  private handleError(
    options: ExecutionOptions,
    result: ExecutionResult,
    resolve: (value: ExecutionResult) => void
  ) {
    result.success = false;

    if (!options.silent && result.stderr) {
      logger.error(result.stderr.trim());
    }

    options.onError?.(result);
    resolve(result);
  }

  private handleProcessError(
    err: Error,
    options: ExecutionOptions,
    result: ExecutionResult,
    resolve: (value: ExecutionResult) => void
  ) {
    result.success = false;
    result.stderr = err.message;
    result.exitCode = 1;

    if (!options.silent) {
      logger.error(err.message);
    }

    options.onError?.(result);
    resolve(result);
  }

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
    } catch {
      // Process already terminated
    }
  }

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

  private buildRedirectedCommand(
    command: string,
    inputFile?: string,
    outputFile?: string
  ): string {
    let result = command;
    if (inputFile) result = `${result} < ${inputFile}`;
    if (outputFile) result = `${result} > ${outputFile}`;
    return result;
  }

  registerTempFile(filePath: string) {
    this.tempFiles.push(filePath);
  }

  cleanup() {
    this.killAllActiveProcesses();
    this.activeProcesses.clear();
    this.tempFiles = [];
  }

  private killAllActiveProcesses() {
    for (const process of this.activeProcesses) {
      if (process.pid && !process.killed) {
        try {
          this.killProcessTree(process.pid);
          process.kill('SIGKILL');
        } catch {
          // Process already dead
        }
      }
    }
  }

  getTempFiles(): string[] {
    return [...this.tempFiles];
  }
}

export const executor = new CommandExecutor();
