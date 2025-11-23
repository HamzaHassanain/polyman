/**
 * @fileoverview Checker (output validator) compilation, testing, and execution utilities.
 * Provides functions to run checkers on solution outputs, validate checker behavior,
 * and test checkers against their own test suites.
 */

import type {
  LocalChecker,
  CheckerTest,
  CheckerVerdict,
  SolutionTag,
} from '../types';
import { executor } from '../executor';
import path from 'path';
import fs from 'fs';
import {
  compileCPP,
  readConfigFile,
  throwError,
  ensureDirectoryExists,
  removeDirectoryRecursively,
  getCompiledCommandToRun,
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
      onError: result => {
        if (expectedVerdict.toUpperCase() === 'OK') {
          throw new Error(result.stderr || 'Expected OK but got WA');
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
 * @param {LocalChecker | undefined} checker - Checker configuration to validate
 *
 * @throws {Error} If no checker is defined in configuration
 *
 * @example
 * const config = readConfigFile();
 * ensureCheckerExists(config.checker);
 * // Now TypeScript knows checker is defined
 */
export function ensureCheckerExists(
  checker: LocalChecker | undefined
): asserts checker is LocalChecker {
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

    if (config.checker.isStandard) {
      fmt.warning(
        `   ⚠️  Using standard checker: ${fmt.highlight(config.checker.source)}`
      );
      fmt.info(
        `   ${fmt.bold('Note:')} Standard checkers are assumed to be correct and are not tested against custom test suites.`
      );
      return;
    }

    if (!config.checker.testsFilePath) {
      throw new Error(
        'Checker tests file path is not specified in the configuration.'
      );
    }

    await makeCheckerTests(config.checker.testsFilePath);
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
async function makeCheckerTests(testsFilePath: string) {
  const checkerTests = await parseCheckerTests(testsFilePath);

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

    fs.writeFileSync(inputPath, test.input);
    fs.writeFileSync(outputPath, test.output);
    fs.writeFileSync(answerPath, test.answer);
  }
}

/**
 * Runs all checker self-tests and validates results.
 * Uses pre-compiled checker via getCompiledCommandToRun.
 * Fails fast - throws on first test failure.
 *
 * @param {LocalChecker} checker - Checker configuration
 *
 * @throws {Error} If checker compilation fails
 * @throws {Error} If any test fails
 *
 * @example
 * const config = readConfigFile();
 * await runCheckerTests(config.checker);
 */
export async function runCheckerTests(checker: LocalChecker) {
  let someFailed = false;
  try {
    const checkerTests = await parseCheckerTests(checker.testsFilePath!);
    const compiledPath = getCompiledCommandToRun(checker);

    const testsDir = path.resolve(process.cwd(), 'checker_tests');

    for (const [index, test] of checkerTests.entries()) {
      const inputFilePath = path.join(testsDir, `test${index + 1}_input.txt`);
      const outputFilePath = path.join(testsDir, `test${index + 1}_output.txt`);
      const answerFilePath = path.join(testsDir, `test${index + 1}_answer.txt`);

      try {
        await runChecker(
          compiledPath,
          inputFilePath,
          outputFilePath,
          answerFilePath,
          test.expectedVerdict
        );
      } catch (error) {
        someFailed = true;
        fmt.error(
          `  ${fmt.cross()} Checker Test ${index + 1} failed:\n\t${(error as Error).message}, expected to be ${test.expectedVerdict}`
        );
      }
    }
  } catch (error) {
    throwError(error, 'Failed to run checker tests');
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
 * @param {string} testsFilePath The path to the tests JSON file
 * @throws {Error} If file doesn't exist or has invalid JSON
 *
 * @example
 * // Expects file structure (Polygon format):
 * // {
 * //   "tests": [
 * //     {
 * //       "index": 1,
 * //       "input": "5",
 * //       "output": "25",
 * //       "answer": "25",
 * //       "expectedVerdict": "OK"
 * //     }
 * //   ]
 * // }
 */
function parseCheckerTests(testsFilePath: string): Promise<CheckerTest[]> {
  return new Promise((resolve, reject) => {
    const absouluteTestsFilePath = path.resolve(process.cwd(), testsFilePath);
    fs.readFile(absouluteTestsFilePath, 'utf-8', (err, data) => {
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
 * Wrapper around compileCPP with consistent error handling.
 *
 * @param {LocalChecker} checker - Checker configuration
 * @returns {Promise<string>} Path to compiled checker executable
 *
 * @throws {Error} If compilation fails
 *
 * @example
 * // Custom checker
 * const path = await compileChecker({ name: 'checker', source: 'checker/Checker.cpp', isStandard: false });
 *
 * @example
 * // Standard checker
 * const path = await compileChecker({ name: 'wcmp', source: 'wcmp.cpp', isStandard: true });
 */
export async function compileChecker(checker: LocalChecker): Promise<void> {
  try {
    const checkerSource = checker.isStandard
      ? path.resolve(
          __dirname,
          '../..',
          'assets',
          'checkers',
          `${checker.source}`
        )
      : checker.source;
    await compileCPP(checkerSource);
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error('Failed to compile checker');
  }
}

/**
 * Determines expected checker verdict based on solution tag (Polygon format).
 * Maps Polygon solution tags to their expected checker verdicts.
 *
 * @param {SolutionTag} tag - Polygon solution tag
 * @returns {CheckerVerdict} Expected verdict for this solution tag
 *
 * @example
 * getExpectedCheckerVerdict('MA');  // Returns: 'OK' (Main Accepted)
 * getExpectedCheckerVerdict('OK');  // Returns: 'OK' (Alternative correct)
 * getExpectedCheckerVerdict('WA');  // Returns: 'WRONG_ANSWER'
 * getExpectedCheckerVerdict('PE');  // Returns: 'PRESENTATION_ERROR'
 * getExpectedCheckerVerdict('TL');  // Returns: 'OK' (TLE handled elsewhere)
 * getExpectedCheckerVerdict('RJ');  // Returns: 'WRONG_ANSWER' (Rejected)
 */
export function getExpectedCheckerVerdict(tag: SolutionTag): CheckerVerdict {
  switch (tag) {
    case 'MA': // Main Accepted
    case 'OK': // Alternative correct solution
    case 'TL': // Time Limit (checker doesn't validate this)
    case 'TO': // Time Limit or OK (checker validates OK part)
    case 'ML': // Memory Limit (checker doesn't validate this)
    case 'RE': // Runtime Error (checker doesn't validate this)
      return 'OK';
    case 'WA': // Wrong Answer
    case 'RJ': // Rejected (any error)
      return 'WRONG_ANSWER';
    case 'PE': // Presentation Error
      return 'PRESENTATION_ERROR';
    default:
      return 'OK';
  }
}
