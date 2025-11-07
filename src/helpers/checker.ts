/**
 * @fileoverview Checker (output validator) compilation, testing, and execution utilities.
 * Provides functions to run checkers on solution outputs, validate checker behavior,
 * and test checkers against their own test suites.
 */

import { Checker, CheckerTest, CheckerVerdict, SolutionType } from '../types';
import { executor } from '../executor';
import path from 'path';
import fs from 'fs';
import {
  logErrorAndExit,
  compileCPP,
  readConfigFile,
  throwError,
  ensureDirectoryExists,
  removeDirectoryRecursively,
} from './utils';
import { DEFAULT_TIMEOUT, DEFAULT_MEMORY_LIMIT } from './utils';
import { fmt } from '../formatter';

/**
 * Runs a checker program to validate solution output against expected answer.
 * The checker receives three files: input, output (participant's answer), and answer (jury's answer).
 *
 * @param {string} execCommand - Path to compiled checker executable
 * @param {string} inputFilePath - Path to test input file
 * @param {string} outputFilePath - Path to participant's output file
 * @param {string} answerFilePath - Path to jury's answer file
 * @param {CheckerVerdict} expectedVerdict - Expected verdict (OK, WA, PE)
 *
 * @throws {Error} If checker verdict doesn't match expected verdict
 * @throws {Error} If checker exceeds time or memory limits (exits process)
 *
 * @example
 * await runChecker(
 *   './checker',
 *   'tests/test1.txt',
 *   'output.txt',
 *   'answer.txt',
 *   'OK'
 * );
 */
export async function runChecker(
  execCommand: string,
  inputFilePath: string,
  outputFilePath: string,
  answerFilePath: string,
  expectedVerdict: CheckerVerdict
) {
  let didCatchInvalid = false;
  await executor.execute(
    `${execCommand} ${inputFilePath} ${outputFilePath} ${answerFilePath}`,
    {
      timeout: DEFAULT_TIMEOUT,
      memoryLimitMB: DEFAULT_MEMORY_LIMIT,
      silent: true,
      onError: () => {
        if (expectedVerdict.toUpperCase() === 'OK') {
          throw new Error(`Expected OK but got WA`);
        }
        didCatchInvalid = true;
      },
      onTimeout: () => {
        fmt.error(
          `${fmt.cross()} ${fmt.bold('Checker Unexpectedly Exceeded Time Limit!')} (${DEFAULT_TIMEOUT}ms)`
        );
        executor.cleanup();
        process.exit(1);
      },
      onMemoryExceeded: () => {
        fmt.error(
          `${fmt.cross()} ${fmt.bold('Checker Unexpectedly Exceeded Memory Limit!')} (${DEFAULT_MEMORY_LIMIT} MB)`
        );
        executor.cleanup();
        process.exit(1);
      },
    }
  );

  if (
    (expectedVerdict.toUpperCase() === 'WA' ||
      expectedVerdict.toUpperCase() === 'PE') &&
    !didCatchInvalid
  ) {
    throw new Error(`Expected ${expectedVerdict} but got OK`);
  }
}

/**
 * Ensures a checker is defined in the configuration.
 * Type assertion function that throws if checker is undefined.
 *
 * @param {Checker | undefined} checker - Checker configuration to validate
 *
 * @throws {Error} If no checker is defined in configuration
 *
 * @example
 * const config = readConfigFile();
 * ensureCheckerExists(config.checker);
 * // Now TypeScript knows checker is defined
 */
export function ensureCheckerExists(
  checker: Checker | undefined
): asserts checker is Checker {
  if (!checker) {
    throw new Error('No checker defined in the configuration file.');
  }
}

/**
 * Tests the checker against its own test suite.
 * Compiles the checker, creates test files, runs all tests, and cleans up.
 * This is a cancellation point - fails fast on first error.
 *
 * @throws {Error} If checker tests fail
 * @throws {Error} If checker compilation fails
 * @throws {Error} If test file parsing fails
 *
 * @example
 * // From actions.ts testWhat command
 * await testCheckerItself();
 */
export async function testCheckerItself() {
  try {
    const config = readConfigFile();
    ensureCheckerExists(config.checker);

    await makeCheckerTests();
    await runCheckerTests(config.checker);
  } catch (error) {
    throwError(error, 'Failed to test checker');
  } finally {
    executor.cleanup();
    removeDirectoryRecursively('checker_tests');
  }
}

/**
 * Creates test files for checker self-testing.
 * Reads checker_tests.json and creates input, output, and answer files.
 *
 * @private
 * @throws {Error} If test file parsing fails
 *
 * @example
 * // Creates files like:
 * // checker_tests/test1_input.txt
 * // checker_tests/test1_output.txt
 * // checker_tests/test1_answer.txt
 */
async function makeCheckerTests() {
  const checkerTests = await parseCheckerTests();

  ensureDirectoryExists('checker_tests');

  for (const [index, test] of checkerTests.entries()) {
    const inputPath = path.resolve(
      process.cwd(),
      'checker_tests',
      `test${index + 1}_input.txt`
    );
    const outputPath = path.resolve(
      process.cwd(),
      'checker_tests',
      `test${index + 1}_output.txt`
    );
    const answerPath = path.resolve(
      process.cwd(),
      'checker_tests',
      `test${index + 1}_answer.txt`
    );

    fs.writeFileSync(inputPath, test.stdin);
    fs.writeFileSync(outputPath, test.stdout);
    fs.writeFileSync(answerPath, test.answer);
  }
}

/**
 * Runs all checker self-tests and validates results.
 * Compiles the checker and runs it against all test cases.
 * Fails fast - throws on first test failure.
 *
 * @param {Checker} checker - Checker configuration
 *
 * @throws {Error} If checker compilation fails
 * @throws {Error} If any test fails
 *
 * @example
 * const config = readConfigFile();
 * await runCheckerTests(config.checker);
 */
export async function runCheckerTests(checker: Checker) {
  let someFailed = false;
  try {
    const checkerTests = await parseCheckerTests();
    const compiledPath = await compileChecker(checker);

    const testsDir = path.resolve(process.cwd(), 'checker_tests');

    for (const [index, { verdict }] of checkerTests.entries()) {
      const inputFilePath = path.join(testsDir, `test${index + 1}_input.txt`);
      const outputFilePath = path.join(testsDir, `test${index + 1}_output.txt`);
      const answerFilePath = path.join(testsDir, `test${index + 1}_answer.txt`);

      try {
        await runChecker(
          compiledPath,
          inputFilePath,
          outputFilePath,
          answerFilePath,
          verdict
        );
      } catch (error) {
        someFailed = true;
        fmt.error(
          `  ${fmt.cross()} Checker Test ${index + 1} failed:\n\t${(error as Error).message}, expected to be ${verdict}`
        );
      }
    }
  } catch (error) {
    throwError(error, 'Failed to compile checker');
  } finally {
    executor.cleanup();
  }

  if (someFailed) throw new Error('Some checker tests failed');
}

/**
 * Parses checker_tests.json file.
 * Reads the JSON file containing checker test cases.
 *
 * @private
 * @returns {Promise<CheckerTest[]>} Array of checker test cases
 *
 * @throws {Error} If file doesn't exist or has invalid JSON
 *
 * @example
 * // Expects file structure:
 * // {
 * //   "tests": [
 * //     { "stdin": "5", "stdout": "25", "answer": "25", "verdict": "OK" }
 * //   ]
 * // }
 */
function parseCheckerTests(): Promise<CheckerTest[]> {
  return new Promise((resolve, reject) => {
    const testsFilePath = path.resolve(
      process.cwd(),
      'checker',
      'checker_tests.json'
    );
    fs.readFile(testsFilePath, 'utf-8', (err, data) => {
      if (err) {
        return reject(new Error('Failed to read checker tests file.'));
      }
      try {
        const tests = JSON.parse(data) as { tests: CheckerTest[] };
        if (tests.tests) {
          return resolve(tests.tests);
        } else {
          return reject(new Error('Invalid checker tests JSON structure.'));
        }
      } catch {
        reject(new Error('Failed to parse checker tests JSON.'));
      }
    });
  });
}

/**
 * Compiles a checker program.
 * Handles both custom checkers and standard testlib checkers.
 *
 * @param {Checker} checker - Checker configuration
 * @returns {Promise<string>} Path to compiled checker executable
 *
 * @throws {Error} If compilation fails (exits process)
 *
 * @example
 * // Custom checker
 * const path = await compileChecker({ custom: true, source: 'Checker.cpp' });
 *
 * @example
 * // Standard checker
 * const path = await compileChecker({ custom: false, source: 'wcmp.cpp' });
 */
export async function compileChecker(checker: Checker) {
  try {
    const checkerSource = checker.custom
      ? checker.source
      : path.resolve(
          __dirname,
          '../..',
          'assets',
          'checkers',
          `${checker.source}`
        );
    const compiledPath = await compileCPP(checkerSource);
    return compiledPath;
  } catch (error) {
    logErrorAndExit(error);
    return ''; // to satisfy TypeScript
  }
}

/**
 * Determines expected checker verdict based on solution type.
 * Maps solution types to their expected checker verdicts.
 *
 * @param {SolutionType} solutionType - Type of solution being tested
 * @returns {CheckerVerdict} Expected verdict for this solution type
 *
 * @example
 * getExpectedCheckerVerdict('main-correct');  // Returns: 'OK'
 * getExpectedCheckerVerdict('wa');            // Returns: 'WA'
 * getExpectedCheckerVerdict('pe');            // Returns: 'PE'
 * getExpectedCheckerVerdict('tle');           // Returns: 'OK' (TLE handled elsewhere)
 */
export function getExpectedCheckerVerdict(
  solutionType: SolutionType
): CheckerVerdict {
  switch (solutionType) {
    case 'main-correct':
    case 'correct':
      return 'OK';
    case 'incorrect':
    case 'failed':
    case 'wa':
      return 'WA';
    case 'pe':
      return 'PE';
    default:
      return 'OK';
  }
}
