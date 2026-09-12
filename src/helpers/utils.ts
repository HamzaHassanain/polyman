/**
 * @fileoverview Common utility functions for compilation, file operations, and error handling.
 * Provides cross-language compilation, test filtering, config reading, and directory management.
 */

import fs from 'fs';
import path from 'path';
import { executor } from '../executor';
import { fmt } from '../formatter';
import { quoteShellArgument } from './shell';
import ConfigFile, {
  CompilerConfig,
  LocalChecker,
  LocalGenerator,
  LocalSolution,
  LocalValidator,
} from '../types';

/** Default compilation timeout in milliseconds */
export const DEFAULT_TIMEOUT = 10000;

/** Default memory limit in megabytes */
export const DEFAULT_MEMORY_LIMIT = 1024;

// ENV is win or unix
export const ENV = process.platform === 'win32' ? 'win' : 'unix';

export const SECRET_KEY_LOCATION =
  ENV === 'win'
    ? '%USERPROFILE%\\.polyman\\secret_key'
    : '~/.polyman/secret_key';
export const API_KEY_LOCATION =
  ENV === 'win' ? '%USERPROFILE%\\.polyman\\api_key' : '~/.polyman/api_key';

/** Environment variable that overrides the C++ compiler executable. */
export const CXX_ENV_VAR = 'POLYMAN_CXX';

/** Environment variable that overrides the Java compiler executable. */
export const JAVAC_ENV_VAR = 'POLYMAN_JAVAC';

/** Default C++ compiler executable. */
export const DEFAULT_CXX = 'g++';

/** Default Java compiler executable. */
export const DEFAULT_JAVAC = 'javac';

/**
 * Reads the optional `compiler` block from `Config.json` in the current
 * working directory. Never throws: a missing or malformed config simply
 * yields an empty object so compilation falls back to the defaults.
 *
 * @returns {CompilerConfig} The `compiler` block, or `{}` when unavailable
 */
function readCompilerConfig(): CompilerConfig {
  try {
    const configFilePath = path.resolve(process.cwd(), 'Config.json');
    if (!fs.existsSync(configFilePath)) return {};
    const parsed = JSON.parse(
      fs.readFileSync(configFilePath, 'utf-8')
    ) as Partial<ConfigFile>;
    return parsed.compiler ?? {};
  } catch {
    return {};
  }
}

/**
 * Resolves the C++ compiler executable.
 * Precedence: `POLYMAN_CXX` env var, then `compiler.cpp` in `Config.json`,
 * then `g++`.
 *
 * @returns {string} Compiler executable name or path
 *
 * @example
 * // POLYMAN_CXX=g++-15
 * resolveCppCompiler(); // 'g++-15'
 */
export function resolveCppCompiler(): string {
  const fromEnv = process.env[CXX_ENV_VAR]?.trim();
  if (fromEnv) return fromEnv;
  const fromConfig = readCompilerConfig().cpp?.trim();
  if (fromConfig) return fromConfig;
  return DEFAULT_CXX;
}

/**
 * Resolves extra flags appended to every C++ compile command, from
 * `compiler.flags` in `Config.json`. Empty when unset.
 *
 * @returns {string[]} Extra compiler flags
 */
export function resolveCppFlags(): string[] {
  const flags = readCompilerConfig().flags;
  if (!Array.isArray(flags)) return [];
  return flags.filter(
    (flag): flag is string => typeof flag === 'string' && flag.length > 0
  );
}

/**
 * Resolves the Java compiler executable.
 * Precedence: `POLYMAN_JAVAC` env var, then `compiler.javac` in
 * `Config.json`, then `javac`.
 *
 * @returns {string} Compiler executable name or path
 */
export function resolveJavaCompiler(): string {
  const fromEnv = process.env[JAVAC_ENV_VAR]?.trim();
  if (fromEnv) return fromEnv;
  const fromConfig = readCompilerConfig().javac?.trim();
  if (fromConfig) return fromConfig;
  return DEFAULT_JAVAC;
}

/**
 * Compiles a C++ source file.
 * The compiler executable comes from {@link resolveCppCompiler} (defaults to
 * g++) and any `compiler.flags` from `Config.json` are appended.
 * The problem root (current working directory) is added as a quoted-include
 * search path so sources in subdirectories can `#include "testlib.h"`.
 *
 * @param {string} sourcePath - Path to the .cpp source file
 * @returns {Promise<void>} Resolves when compilation succeeds
 *
 * @throws {Error} If file is not .cpp or compilation fails
 *
 * @example
 * await compileCPP('solutions/main.cpp');
 * // Produces: '/path/to/solutions/main'
 */
export async function compileCPP(sourcePath: string): Promise<void> {
  const absolutePath = path.resolve(process.cwd(), sourcePath);

  if (path.extname(absolutePath) !== '.cpp') {
    throw new Error(`Expected .cpp file, got: ${absolutePath}`);
  }

  const outputPath = absolutePath.replace(/\.cpp$/, '');

  const compileCommand = [
    quoteShellArgument(resolveCppCompiler()),
    ...resolveCppFlags().map(quoteShellArgument),
    '-iquote',
    quoteShellArgument(process.cwd()),
    '-o',
    quoteShellArgument(outputPath),
    quoteShellArgument(absolutePath),
  ].join(' ');

  await executor.execute(compileCommand, {
    timeout: DEFAULT_TIMEOUT,
    silent: true,
  });
}

/**
 * Compiles a Java source file.
 * The compiler executable comes from {@link resolveJavaCompiler} (defaults
 * to javac).
 *
 * @param {string} sourcePath - Path to the .java source file
 * @returns {Promise<void>} Resolves when compilation succeeds
 *
 * @throws {Error} If compilation fails
 *
 * @example
 * await compileJava('solutions/Solution.java');
 * // Produces: '/path/to/solutions/Solution.class'
 */
export async function compileJava(sourcePath: string): Promise<void> {
  const absolutePath = path.resolve(sourcePath);

  const compileCommand = [
    quoteShellArgument(resolveJavaCompiler()),
    quoteShellArgument(absolutePath),
  ].join(' ');

  await executor.execute(compileCommand, {
    timeout: DEFAULT_TIMEOUT,
    silent: true,
  });
}

/**
 * Filters test files by a numerical range.
 * Looks for files named like "test1.txt", "test2.txt", etc.
 *
 * @param {string[]} testFiles - Array of test file names
 * @param {number} [testBegin] - Start of range (inclusive), optional
 * @param {number} [testEnd] - End of range (inclusive), optional
 * @returns {string[]} Filtered array of test files
 *
 * @example
 * const allTests = ['test1.txt', 'test2.txt', 'test3.txt'];
 * const filtered = filterTestsByRange(allTests, 1, 2);
 * // Returns: ['test1.txt', 'test2.txt']
 */
export function filterTestsByRange(
  testFiles: string[],
  testBegin?: number,
  testEnd?: number
): string[] {
  if (testBegin === undefined || testEnd === undefined) {
    return testFiles;
  }

  return testFiles.filter(file => {
    if (!file.startsWith('test')) return false;

    const numberPart = file.slice(4, file.lastIndexOf('.'));
    const testNumber = parseInt(numberPart, 10);

    return (
      !isNaN(testNumber) && testNumber >= testBegin && testNumber <= testEnd
    );
  });
}

/**
 * Gets all test files from tests directory.
 * Returns only files starting with 'test' prefix in sorted order by test number.
 *
 * @private
 * @param {string} testsDir - Path to tests directory
 * @returns {string[]} Array of test filenames
 *
 * @example
 * getTestFiles('/path/to/tests')
 * // Returns: ['test1.txt', 'test2.txt', 'test3.txt', ...]
 */
export function getTestFiles(testsDir: string): string[] {
  return fs
    .readdirSync(testsDir)
    .filter(file => file.startsWith('test'))
    .sort((a, b) => {
      const numA = parseInt(a.replace('test', '').replace('.txt', ''));
      const numB = parseInt(b.replace('test', '').replace('.txt', ''));
      return numA - numB;
    });
}

/**
 * Reads and parses the Config.json file from the current working directory.
 *
 * @returns {ConfigFile} Parsed configuration object
 *
 * @throws {Error} If Config.json doesn't exist or is invalid JSON
 *
 * @example
 * const config = readConfigFile();
 * console.log(config.solutions); // Array of solutions
 */
export function readConfigFile(): ConfigFile {
  try {
    const configFilePath = path.resolve(process.cwd(), 'Config.json');
    const configData = fs.readFileSync(configFilePath, 'utf-8');
    return JSON.parse(configData) as ConfigFile;
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error('Failed to read or parse Config.json file.');
  }
}

/**
 * Checks if a string represents a numeric value.
 *
 * @param {string} value - String to check
 * @returns {boolean} True if value is numeric
 *
 * @example
 * isNumeric('42');  // true
 * isNumeric('all'); // false
 */
export function isNumeric(value: string): boolean {
  return !isNaN(parseInt(value, 10));
}

/**
 * Logs an error message with a cross icon.
 * Formats the error using the formatter.
 *
 * @param {unknown} error - Error to log
 *
 * @example
 * try {
 *   await compileCPP('invalid.cpp');
 * } catch (error) {
 *   logError(error);
 * }
 */
export function logError(error: unknown, indent: number = 1) {
  const message = error instanceof Error ? error.message : String(error);
  fmt.error(`${' '.repeat(indent)} ${fmt.cross()} ${message}`);
}

/**
 * Logs an error and exits the process with code 1.
 *
 * @param {unknown} error - Error to log
 *
 * @example
 * if (!fs.existsSync('Config.json')) {
 *   logErrorAndExit(new Error('Config.json not found'));
 * }
 */
export function logErrorAndExit(error: unknown) {
  logError(error);
  process.exit(1);
}

/**
 * Logs an error and re-throws it.
 *
 * @param {unknown} error - Error to log and throw
 * @param {string} [message=''] - Additional context message
 *
 * @throws {Error} Always throws after logging
 *
 * @example
 * try {
 *   dangerousOperation();
 * } catch (error) {
 *   logErrorAndThrow(error, 'Operation failed');
 * }
 */
export function logErrorAndThrow(error: unknown, message = '') {
  logError(error);
  throwError(error, message);
}

/**
 * Throws an error, ensuring it's an Error instance.
 * If the input is not an Error, wraps it in one.
 *
 * @param {unknown} error - Error to throw
 * @param {string} [message=''] - Additional context message
 *
 * @throws {Error} Always throws
 *
 * @example
 * throwError(new Error('Something went wrong'));
 */
export function throwError(error: unknown, message = ''): never {
  throw error instanceof Error
    ? error
    : new Error(`${message}: ${String(error)}`);
}

/**
 * Ensures a directory exists, creating it if necessary.
 * Creates parent directories recursively.
 *
 * @param {string} dirName - Directory name/path relative to current working directory
 *
 * @example
 * ensureDirectoryExists('testsets');
 * ensureDirectoryExists('nested/path/to/dir');
 */
export function ensureDirectoryExists(dirName: string) {
  const dirPath = path.resolve(process.cwd(), dirName);
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Removes a directory and all its contents.
 * Does nothing if directory doesn't exist.
 *
 * @param {string} dirName - Directory name/path relative to current working directory
 *
 * @example
 * removeDirectoryRecursively('temp');
 */
export function removeDirectoryRecursively(dirName: string) {
  const dirPath = path.resolve(process.cwd(), dirName);
  if (fs.existsSync(dirPath)) {
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}

/**
 * Reads the first line of a file efficiently using streaming.
 * Useful for reading verdict from validator/checker output.
 *
 * @param {string} filePath - Path to the file
 * @returns {Promise<string>} First line of the file
 *
 * @throws {Error} If file cannot be read
 *
 * @example
 * const verdict = await readFirstLine('/tmp/validator_output.txt');
 * // Returns: 'VALID' or 'INVALID'
 */
export function readFirstLine(filePath: string): Promise<string> {
  // use file stream

  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  return new Promise<string>((resolve, reject) => {
    let data = '';
    fileStream.on('data', chunk => {
      data += String(chunk);
      const lines = data.split(/\r?\n/);
      if (lines.length > 1) {
        fileStream.close();
        resolve(lines[0]);
      }
    });
    fileStream.on('end', () => {
      const lines = data.split(/\r?\n/);
      resolve(lines[0] || '');
    });
    fileStream.on('error', err => {
      reject(err);
    });
  });
}

export function getCompiledCommandToRun(
  object: LocalChecker | LocalValidator | LocalSolution | LocalGenerator
): string {
  if ('isStandard' in object && object.isStandard) {
    const checkerName = object.source.replace(/\.cpp$/, '');
    return quoteShellArgument(
      path.resolve(__dirname, '../..', 'assets', 'checkers', checkerName)
    );
  }

  const source = path.resolve(process.cwd(), object.source);
  const extention = path.extname(source);

  switch (extention) {
    case '.cpp':
      return quoteShellArgument(source.replace(/\.cpp$/, ''));
    case '.java': {
      const dir = path.dirname(source);
      const fileName = path.basename(source);
      const className = fileName.replace(/\.java$/, '');
      return `java -cp ${quoteShellArgument(dir)} ${quoteShellArgument(className)}`;
    }
    case '.py':
      return `python ${quoteShellArgument(source)}`;
    case '.js':
      return `node ${quoteShellArgument(source)}`;
    default:
      throw new Error(`Unsupported source file extension: ${extention}`);
  }
}
