/**
 * @fileoverview Input validator compilation, testing, and execution utilities.
 * Provides functions to run validators on test inputs with testset support.
 */

import type {
  LocalValidator,
  LocalTestset,
  ValidatorTest,
  ValidatorVerdict,
} from '../types';
import { executor } from '../executor';
import path from 'path';
import fs from 'fs';
import {
  compileCPP,
  logError,
  readConfigFile,
  throwError,
  ensureDirectoryExists,
  removeDirectoryRecursively,
  getTestFiles,
  getCompiledCommandToRun,
} from './utils';
import { DEFAULT_TIMEOUT, DEFAULT_MEMORY_LIMIT } from './utils';
import { fmt } from '../formatter';
import { getGeneratorCommands } from './testset';

/**
 * Compiles the validator program.
 * Wrapper around compileCPP with consistent error handling.
 *
 * @param {LocalValidator} validator - Validator configuration
 * @returns {Promise<void>} Does not return anything on success
 *
 * @throws {Error} If compilation fails
 *
 * @example
 * await compileValidator({ name: 'val', source: 'validator/val.cpp' });
 */
export async function compileValidator(
  validator: LocalValidator
): Promise<void> {
  try {
    if (!validator.source) {
      throw new Error('Validator has no source file specified');
    }
    await compileCPP(validator.source);
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error('Failed to compile validator');
  }
}

/**
 * Runs validator on a test file and checks the verdict.
 * Redirects test file to validator's stdin and validates exit code.
 *
 * @private
 * @param {string} execCommand - Path to compiled validator executable
 * @param {string} testFilePath - Path to test file
 * @param {ValidatorVerdict} expectedVerdict - Expected verdict (VALID or INVALID)
 *
 * @throws {Error} If validator verdict doesn't match expected
 * @throws {Error} If validator exceeds time or memory limits (exits process)
 *
 * @example
 * await runValidator('./validator', 'tests/tests/test1.txt', 'VALID');
 */
async function runValidator(
  execCommand: string,
  testFilePath: string,
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
        if (expectedVerdict === 'VALID')
          throw new Error(result.stderr || 'Validator execution failed');
      },
      onTimeout: async () => {
        fmt.error(
          `${fmt.cross()} ${fmt.bold('Validator Unexpectedly Exceeded Time Limit!')} (${DEFAULT_TIMEOUT}ms)`
        );
        await executor.cleanup();
        process.exit(1);
      },
      onMemoryExceeded: async () => {
        fmt.error(
          `${fmt.cross()} ${fmt.bold('Validator Unexpectedly Exceeded Memory Limit!')} (${DEFAULT_MEMORY_LIMIT} MB)`
        );
        await executor.cleanup();
        process.exit(1);
      },
    },
    testFilePath,
    undefined
  );

  if (expectedVerdict === 'INVALID' && !didCatchInvalid) {
    throw new Error('Validator did not detect invalid test');
  }
}

/**
 * Validates a single test in a testset.
 *
 * @param {LocalValidator} validator - Validator configuration
 * @param {string} testsetName - Testset name
 * @param {number} testIndex - 1-based test index
 *
 * @throws {Error} If validator compilation fails
 * @throws {Error} If test is invalid
 *
 * @example
 * await validateSingleTest(validator, 'testsets', 5);
 */
export async function validateSingleTest(
  validator: LocalValidator,
  testsetName: string,
  testIndex: number
) {
  try {
    const compiledPath = getCompiledCommandToRun(validator);
    const testsDir = path.resolve(process.cwd(), 'testsets', testsetName);
    const testFilePath = path.join(testsDir, `test${testIndex}.txt`);

    if (!fs.existsSync(testFilePath)) {
      throw new Error(`Test file not found: ${testFilePath}`);
    }

    try {
      await runValidator(compiledPath, testFilePath, 'VALID');
    } catch (error) {
      throw new Error(
        `Test ${testIndex} failed validation:\n\t${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  } catch (error) {
    throwError(error, 'Failed to validate test');
  }
}

/**
 * Validates all tests in a testset.
 *
 * @param {LocalValidator} validator - Validator configuration
 * @param {string} testsetName - Testset name
 *
 * @throws {Error} If validator compilation fails
 * @throws {Error} If any test is invalid
 *
 * @example
 * await validateTestset(validator, 'testsets');
 */
export async function validateTestset(
  validator: LocalValidator,
  testsetName: string
) {
  let someFailed = false;
  try {
    const compiledPath = getCompiledCommandToRun(validator);
    const testsDir = path.resolve(process.cwd(), 'testsets', testsetName);

    if (!fs.existsSync(testsDir)) {
      throw new Error(`Testset directory not found: ${testsDir}`);
    }

    const testFiles = getTestFiles(testsDir);

    if (testFiles.length === 0) {
      throw new Error(`No test files found in testset: ${testsetName}`);
    }

    for (const testFile of testFiles) {
      const testFilePath = path.join(testsDir, testFile);
      try {
        await runValidator(compiledPath, testFilePath, 'VALID');
      } catch (error) {
        someFailed = true;
        logError(
          new Error(
            `Test ${fmt.bold(`${testsetName}/${testFile}`)} failed validation:\n\t${error instanceof Error ? error.message : 'Unknown error'}`
          )
        );
      }
    }
  } catch (error) {
    throwError(error, `Failed to validate testset ${testsetName}`);
  } finally {
    await executor.cleanup();
  }

  if (someFailed) throw new Error('Some tests failed validation');
}

/**
 * Validates tests in a specific group within a testset.
 *
 * @param {LocalValidator} validator - Validator configuration
 * @param {LocalTestset} testset - Testset configuration
 * @param {string} groupName - Group name
 *
 * @throws {Error} If validator compilation fails
 * @throws {Error} If any test in group is invalid
 *
 * @example
 * await validateGroup(validator, testset, 'samples');
 */
export async function validateGroup(
  validator: LocalValidator,
  testset: LocalTestset,
  groupName: string
) {
  let someFailed = false;
  try {
    const compiledPath = getCompiledCommandToRun(validator);
    const testsDir = path.resolve(process.cwd(), 'testsets', testset.name);

    if (!fs.existsSync(testsDir)) {
      throw new Error(`Testset directory not found: ${testsDir}`);
    }

    // Get commands for this testset
    const commands = getGeneratorCommands(testset);

    // Filter commands by group and get their indices
    const groupCommands: number[] = [];
    let currentIndex = 1;

    for (const command of commands) {
      if (command.group === groupName) {
        if (command.type === 'generator' && command.range) {
          const [start, end] = command.range;
          for (let i = start; i <= end; i++) {
            groupCommands.push(currentIndex);
            currentIndex++;
          }
        } else {
          groupCommands.push(currentIndex);
          currentIndex++;
        }
      } else {
        // Count tests not in this group
        if (command.type === 'generator' && command.range) {
          const [start, end] = command.range;
          currentIndex += end - start + 1;
        } else {
          currentIndex++;
        }
      }
    }

    if (groupCommands.length === 0) {
      throw new Error(`No tests found in group "${groupName}"`);
    }

    for (const testIndex of groupCommands) {
      const testFilePath = path.join(testsDir, `test${testIndex}.txt`);
      try {
        await runValidator(compiledPath, testFilePath, 'VALID');
      } catch (error) {
        someFailed = true;
        logError(
          new Error(
            `Test ${testIndex} in group ${groupName} failed validation:\n\t${error instanceof Error ? error.message : 'Unknown error'}`
          )
        );
      }
    }
  } catch (error) {
    throwError(error, `Failed to validate group ${groupName}`);
  } finally {
    await executor.cleanup();
  }

  if (someFailed)
    throw new Error(`Some tests in group ${groupName} failed validation`);
}

/**
 * Validates all testsets.
 *
 * @param {LocalValidator} validator - Validator configuration
 * @param {LocalTestset[]} testsets - All testsets
 *
 * @throws {Error} If validator compilation fails
 * @throws {Error} If any test is invalid
 *
 * @example
 * await validateAllTestsets(validator, testsets);
 */
export async function validateAllTestsets(
  validator: LocalValidator,
  testsets: LocalTestset[]
) {
  let someFailed = false;
  for (const testset of testsets) {
    try {
      await validateTestset(validator, testset.name);
    } catch (error) {
      logError(error);
      someFailed = true;
    }
  }

  if (someFailed) {
    throw new Error('Some testsets failed validation');
  }
}

/**
 * Ensures a validator is defined in the configuration.
 * Type assertion function that throws if validator is undefined.
 *
 * @param {LocalValidator | undefined} validator - Validator configuration to validate
 *
 * @throws {Error} If no validator is defined in configuration
 *
 * @example
 * const config = readConfigFile();
 * ensureValidatorExists(config.validator);
 * // Now TypeScript knows validator is defined
 */
export function ensureValidatorExists(
  validator: LocalValidator | undefined
): asserts validator is LocalValidator {
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

    if (!config.validator.testsFilePath) {
      fmt.warning(
        'No validator tests file path specified in configuration. Skipping validator self-tests.'
      );
      return;
    }

    await makeValidatorTests(config.validator.testsFilePath);
    await runValidatorTests(config.validator);
  } catch (error) {
    throwError(error, 'Failed to test validator');
  } finally {
    await executor.cleanup();
    removeDirectoryRecursively('validator_tests');
  }
}

/**
 * Creates test files for validator self-testing.
 * Reads validator_tests.json and creates input files.
 *
 * @private
 *
 * @param {string} testsFilePath - Directory to create test files in
 * @throws {Error} If test file parsing fails
 *
 * @example
 * // Creates files like:
 * // validator_tests/test1.txt
 * // validator_tests/test2.txt
 */
async function makeValidatorTests(testsFilePath: string) {
  const validatorTests = await parseValidatorTests(testsFilePath);

  ensureDirectoryExists('validator_tests');
  for (const [index, test] of validatorTests.entries()) {
    const testFilePath = path.resolve(
      process.cwd(),
      'validator_tests',
      `test${index + 1}.txt`
    );
    fs.writeFileSync(testFilePath, test.input);
  }
}

/**
 * Runs all validator self-tests and validates results.
 * Compiles the validator and runs it against all test cases.
 * Fails fast - throws on first test failure.
 *
 * @param {LocalValidator} validator - Validator configuration
 *
 * @throws {Error} If validator compilation fails
 * @throws {Error} If any test fails
 *
 * @example
 * const config = readConfigFile();
 * await runValidatorTests(config.validator);
 */
export async function runValidatorTests(validator: LocalValidator) {
  let someFailed = false;
  try {
    const validatorTests = await parseValidatorTests(validator.testsFilePath!);
    const testsDir = path.resolve(process.cwd(), 'validator_tests');

    for (const [index, { expectedVerdict }] of validatorTests.entries()) {
      const testFileDir = path.join(testsDir, `test${index + 1}.txt`);
      try {
        await runValidator(
          getCompiledCommandToRun(validator),
          testFileDir,
          expectedVerdict
        );
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
    await executor.cleanup();
  }

  if (someFailed) throw new Error('Some validator tests failed');
}

/**
 * Parses validator_tests.json file.
 * Reads the JSON file containing validator test cases.
 *
 * @private
 * @param {string} testsFilePath The path to the tests JSON file
 * @returns {Promise<ValidatorTest[]>} Array of validator test cases
 *
 * @throws {Error} If file doesn't exist or has invalid JSON
 *
 * @example
 * // Expects file structure:
 * // {
 * //   "tests": [
 * //     { "index": 1, "input": "1 2 3", "expectedVerdict": "VALID" }
 * //   ]
 * // }
 */
function parseValidatorTests(testsFilePath: string): Promise<ValidatorTest[]> {
  return new Promise((resolve, reject) => {
    const absouluteTestsFilePath = path.resolve(process.cwd(), testsFilePath);
    fs.readFile(absouluteTestsFilePath, 'utf-8', (err, data) => {
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
