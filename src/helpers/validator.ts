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
import { logger } from '../logger';

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
      logErrorAndThrow(error);
    }
  } catch (error) {
    throwError(error, 'Failed to compile validator');
  }
}
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
        logError(error);
      }
    }
  } catch (error) {
    throwError(error, 'Failed to compile validator');
  } finally {
    executor.cleanup();
  }

  if (someFailed) throw new Error('Some tests failed validation');
}

async function runValidator(
  execCommand: string,
  testFileDir: string,
  expectedVerdict: ValidatorVerdict
) {
  await executor.executeWithRedirect(
    execCommand,
    {
      timeout: DEFAULT_TIMEOUT,
      memoryLimitMB: DEFAULT_MEMORY_LIMIT,
      silent: true,
      onError: result => {
        if (expectedVerdict === 'VALID')
          throw new Error(result.stderr || 'Validator execution failed');
      },
      onTimeout: () => {
        logger.error(
          `${logger.bold(
            'Validator Unexpectedly Exceeded Time Limit!'
          )} (${DEFAULT_TIMEOUT}ms)`
        );
        executor.cleanup();
        process.exit(1);
      },
      onMemoryExceeded: () => {
        logger.error(
          ` ${logger.bold(
            'Validator Unexpectedly Exceeded Memory Limit!'
          )} (${DEFAULT_MEMORY_LIMIT} MB)`
        );
        executor.cleanup();
        process.exit(1);
      },
    },
    testFileDir,
    undefined
  );

  if (expectedVerdict === 'INVALID') {
    throw new Error('Validator did not detect invalid test');
  }
}

export function ensureValidatorExists(
  validator: Validator | undefined
): asserts validator is Validator {
  if (!validator) {
    throw new Error('No validator defined in the configuration file.');
  }
}
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
        logger.error(
          `Validator Test ${index + 1} failed:\n\t${(error as Error).message}, expected to be ${expectedVerdict}`
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

function parseValidatorTests(): Promise<ValidatorTest[]> {
  return new Promise((resolve, reject) => {
    const testsFilePath = path.resolve(process.cwd(), 'validator_tests.json');
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
