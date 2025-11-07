/**
 * @fileoverview Common utility functions for compilation, file operations, and error handling.
 * Provides cross-language compilation, test filtering, config reading, and directory management.
 */

import path from 'path';
import { executor } from '../executor';
import fs from 'fs';
import { fmt } from '../formatter';
import ConfigFile from '../types';

/** Default compilation timeout in milliseconds */
export const DEFAULT_TIMEOUT = 10000;

/** Default memory limit in megabytes */
export const DEFAULT_MEMORY_LIMIT = 1024;

/**
 * Compiles a C++ source file using g++.
 * Uses -O2 optimization and C++23 standard.
 *
 * @param {string} sourcePath - Path to the .cpp source file
 * @returns {Promise<string>} Path to the compiled executable
 *
 * @throws {Error} If file is not .cpp or compilation fails
 *
 * @example
 * const executablePath = await compileCPP('solutions/main.cpp');
 * // Returns: '/path/to/solutions/main'
 */
export async function compileCPP(sourcePath: string): Promise<string> {
  const absolutePath = path.resolve(process.cwd(), sourcePath);

  if (path.extname(absolutePath) !== '.cpp') {
    throw new Error(`Expected .cpp file, got: ${absolutePath}`);
  }

  const outputPath = absolutePath.replace('.cpp', '');
  const compileCommand = `g++ -o ${outputPath} ${absolutePath} -O2 -std=c++23`;

  await executor.execute(compileCommand, {
    timeout: DEFAULT_TIMEOUT,
    silent: true,
  });

  return outputPath;
}

/**
 * Compiles a Java source file using javac.
 *
 * @param {string} sourcePath - Path to the .java source file
 * @returns {Promise<string>} Java execution command (e.g., "java -cp /path ClassName")
 *
 * @throws {Error} If compilation fails
 *
 * @example
 * const javaCommand = await compileJava('solutions/Solution.java');
 * // Returns: 'java -cp /path/to/solutions Solution'
 */
export async function compileJava(sourcePath: string): Promise<string> {
  const absolutePath = path.resolve(sourcePath);
  const directory = path.dirname(absolutePath);
  const fileName = path.basename(absolutePath);
  const className = fileName.replace('.java', '');

  await executor.execute(`javac ${absolutePath}`, {
    timeout: DEFAULT_TIMEOUT,
    silent: true,
  });

  return `java -cp ${directory} ${className}`;
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
export function logError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  fmt.error(`  ${fmt.cross()} ${message}`);
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
 * ensureDirectoryExists('tests');
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
