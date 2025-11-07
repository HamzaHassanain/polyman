/**
 * @fileoverview Input validator compilation, testing, and execution utilities.
 * Provides functions to run validators on test inputs, validate correctness,
 * and test validators against their own test suites.
 */

import { Validator, ValidatorTest, ValidatorVerdict } from '../types';
import { executor } from '../executor';
import path from 'path';
import fs from 'fs';
import {
  compileCPP,
  logError,
  logErrorAndThrow,
  readConfigFile,
  throwError,
  ensureDirectoryExists,
  removeDirectoryRecursively,
} from './utils';
import { DEFAULT_TIMEOUT, DEFAULT_MEMORY_LIMIT } from './utils';
import { fmt } from '../formatter';

/**
 * Validates a single test file using the validator.
 * Compiles validator and runs it on the specified test.
 * Fails fast - throws on validation failure.
 *
 * @param {Validator} validator - Validator configuration
 * @param {number} testNumber - Test number to validate
 *
 * @throws {Error} If validator compilation fails
 * @throws {Error} If test is invalid
 *
 * @example
 * // From actions.ts validateTests
 * const config = readConfigFile();
 * await validateSingleTest(config.validator, 5);
 */
export async function validateSingleTest(
  validator: Validator,
  testNumber: number
) {
  try {
    const compiledPath = await compileCPP(validator.source);
    const testsDir = path.resolve(process.cwd(), 'tests');
    const testFilePath = path.join(testsDir, `test${testNumber}.txt`);
    try {
      await runValidator(compiledPath, testFilePath, 'VALID');
    } catch (error) {
      const message = `Test ${testFilePath} failed validation:\n\t${error instanceof Error ? error.message : 'Unknown error'}`;
      logErrorAndThrow(new Error(message));
    }
  } catch (error) {
    throwError(error, 'Failed to compile validator');
  }
}

/**
 * Validates all generated test files.
 * Compiles validator and runs it on all test*.txt files.
 * Fails fast - throws on first invalid test.
 *
 * @param {Validator} validator - Validator configuration
 *
 * @throws {Error} If validator compilation fails
 * @throws {Error} If any test is invalid
 *
 * @example
 * // From actions.ts validateTests and fullVerification
 * const config = readConfigFile();
 * await validateAllTests(config.validator);
 */
export async function validateAllTests(validator: Validator) {
  let someFailed = false;
  try {
    const compiledPath = await compileCPP(validator.source);

    const testsDir = path.resolve(process.cwd(), 'tests');
    const testFiles = fs
      .readdirSync(testsDir)
      .filter(file => file.startsWith('test') && file.endsWith('.txt'));

    for (const testFile of testFiles) {
      const testFileDir = path.join(testsDir, testFile);
      try {
        await runValidator(compiledPath, testFileDir, 'VALID');
      } catch (error) {
        someFailed = true;
        const message = `Test ${testFile} failed validation:\n\t${error instanceof Error ? error.message : 'Unknown error'}`;
        logError(new Error(message));
      }
    }
  } catch (error) {
    throwError(error, 'Failed to compile validator');
  } finally {
    executor.cleanup();
  }

  if (someFailed) throw new Error('Some tests failed validation');
}

/**
 * Runs validator on a test file and checks the verdict.
 * Redirects test file to validator's stdin and validates exit code.
 *
 * @private
 * @param {string} execCommand - Path to compiled validator executable
 * @param {string} testFileDir - Path to test file
 * @param {ValidatorVerdict} expectedVerdict - Expected verdict (VALID or INVALID)
 *
 * @throws {Error} If validator verdict doesn't match expected
 * @throws {Error} If validator exceeds time or memory limits (exits process)
 *
 * @example
 * await runValidator('./validator', 'tests/test1.txt', 'VALID');
 */
async function runValidator(
  execCommand: string,
  testFileDir: string,
  expectedVerdict: ValidatorVerdict
) {
  let didCatchInvalid = false;
  await executor.executeWithRedirect(
    execCommand,
    {
      timeout: DEFAULT_TIMEOUT,
      memoryLimitMB: DEFAULT_MEMORY_LIMIT,
      silent: true,
      onError: result => {
        didCatchInvalid = true;
        if (
          expectedVerdict === 'VALID' ||
          expectedVerdict === 1 ||
          expectedVerdict === 'valid'
        )
          throw new Error(result.stderr || 'Validator execution failed');
      },
      onTimeout: () => {
        fmt.error(
          `${fmt.cross()} ${fmt.bold('Validator Unexpectedly Exceeded Time Limit!')} (${DEFAULT_TIMEOUT}ms)`
        );
        executor.cleanup();
        process.exit(1);
      },
      onMemoryExceeded: () => {
        fmt.error(
          `${fmt.cross()} ${fmt.bold('Validator Unexpectedly Exceeded Memory Limit!')} (${DEFAULT_MEMORY_LIMIT} MB)`
        );
        executor.cleanup();
        process.exit(1);
      },
    },
    testFileDir,
    undefined
  );

  if (
    (expectedVerdict === 'INVALID' ||
      expectedVerdict === 0 ||
      expectedVerdict === 'invalid') &&
    !didCatchInvalid
  ) {
    throw new Error('Validator did not detect invalid test');
  }
}

/**
 * Ensures a validator is defined in the configuration.
 * Type assertion function that throws if validator is undefined.
 *
 * @param {Validator | undefined} validator - Validator configuration to validate
 *
 * @throws {Error} If no validator is defined in configuration
 *
 * @example
 * const config = readConfigFile();
 * ensureValidatorExists(config.validator);
 * // Now TypeScript knows validator is defined
 */
export function ensureValidatorExists(
  validator: Validator | undefined
): asserts validator is Validator {
  if (!validator) {
    throw new Error('No validator defined in the configuration file.');
  }
}

/**
 * Tests the validator against its own test suite.
 * Compiles the validator, creates test files, runs all tests, and cleans up.
 * This is a cancellation point - fails fast on first error.
 *
 * @throws {Error} If validator tests fail
 * @throws {Error} If validator compilation fails
 * @throws {Error} If test file parsing fails
 *
 * @example
 * // From actions.ts testWhat and fullVerification
 * await testValidatorItself();
 */
export async function testValidatorItself() {
  try {
    const config = readConfigFile();
    ensureValidatorExists(config.validator);

    await makeValidatorTests();
    await runValidatorTests(config.validator);
  } catch (error) {
    throwError(error, 'Failed to test validator');
  } finally {
    executor.cleanup();
    removeDirectoryRecursively('validator_tests');
  }
}

/**
 * Creates test files for validator self-testing.
 * Reads validator_tests.json and creates input files.
 *
 * @private
 * @throws {Error} If test file parsing fails
 *
 * @example
 * // Creates files like:
 * // validator_tests/test1.txt
 * // validator_tests/test2.txt
 */
async function makeValidatorTests() {
  const validatorTests = await parseValidatorTests();

  ensureDirectoryExists('validator_tests');
  for (const [index, test] of validatorTests.entries()) {
    const testFilePath = path.resolve(
      process.cwd(),
      'validator_tests',
      `test${index + 1}.txt`
    );
    fs.writeFileSync(testFilePath, test.stdin);
  }
}

/**
 * Runs all validator self-tests and validates results.
 * Compiles the validator and runs it against all test cases.
 * Fails fast - throws on first test failure.
 *
 * @param {Validator} validator - Validator configuration
 *
 * @throws {Error} If validator compilation fails
 * @throws {Error} If any test fails
 *
 * @example
 * const config = readConfigFile();
 * await runValidatorTests(config.validator);
 */
export async function runValidatorTests(validator: Validator) {
  let someFailed = false;
  try {
    const validatorTests = await parseValidatorTests();
    const compiledPath = await compileCPP(validator.source);

    const testsDir = path.resolve(process.cwd(), 'validator_tests');

    for (const [index, { expectedVerdict }] of validatorTests.entries()) {
      const testFileDir = path.join(testsDir, `test${index + 1}.txt`);
      try {
        await runValidator(compiledPath, testFileDir, expectedVerdict);
      } catch (error) {
        someFailed = true;
        fmt.error(
          `  ${fmt.cross()} Validator Test ${index + 1} failed:\n\t${(error as Error).message} expected to be ${expectedVerdict}`
        );
      }
    }
  } catch (error) {
    throwError(error, 'Failed to compile validator');
  } finally {
    executor.cleanup();
  }

  if (someFailed) throw new Error('Some validator tests failed');
}

/**
 * Parses validator_tests.json file.
 * Reads the JSON file containing validator test cases.
 *
 * @private
 * @returns {Promise<ValidatorTest[]>} Array of validator test cases
 *
 * @throws {Error} If file doesn't exist or has invalid JSON
 *
 * @example
 * // Expects file structure:
 * // {
 * //   "tests": [
 * //     { "stdin": "1 2 3", "expectedVerdict": "VALID" }
 * //   ]
 * // }
 */
function parseValidatorTests(): Promise<ValidatorTest[]> {
  return new Promise((resolve, reject) => {
    const testsFilePath = path.resolve(
      process.cwd(),
      'validator',
      'validator_tests.json'
    );
    fs.readFile(testsFilePath, 'utf-8', (err, data) => {
      if (err) {
        return reject(new Error('Failed to read validator tests file.'));
      }
      try {
        const tests = JSON.parse(data) as { tests: ValidatorTest[] };
        if (tests.tests) {
          return resolve(tests.tests);
        } else {
          return reject(new Error('Invalid validator tests JSON structure.'));
        }
      } catch {
        reject(new Error('Failed to parse validator tests JSON.'));
      }
    });
  });
}
