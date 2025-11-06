import ConfigFile, { Validator, ValidatorTest, Generator } from '../types';
import { executor } from '../executor';
import path from 'path';
import fs from 'fs';
import { compileCPP, readConfigFile } from './utils';
import { DEFAULT_TIMEOUT, DEFAULT_MEMORY_LIMIT } from './utils';
import { logger } from '../logger';

export async function validateSingleTest(
  validator: Validator,
  testNumber: number
) {
  await runValidator(validator, testNumber, testNumber);
}
export async function validateAllTests(
  validator: Validator,
  generators: Generator[]
) {
  logger.info('Validating all tests...');
  let someFailed = false;
  for (const generator of generators) {
    try {
      const [start, end] = generator['tests-range'];
      await runValidator(validator, start, end);
    } catch (error) {
      logger.error(
        `Validating tests for generator ${logger.highlight(generator.name)} failed:`
      );
      handleValidationError(error);
      console.log();
      someFailed = true;
    }
  }
  if (!someFailed) logger.success('All tests passed validation');
  else throw new Error('Some tests failed validation');
}
export async function validateGeneratorTests(
  config: ConfigFile,
  generatorName: string
) {
  const generator = config.generators?.find(g => g.name === generatorName);

  if (!generator) {
    throw new Error(
      `No generator named "${logger.highlight(generatorName)}" found in the configuration file.`
    );
  }

  const [start, end] = generator['tests-range'];
  await runValidator(config.validator, start, end);
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

    logger.info('Running validator self-tests...');
    await runValidatorTests(config.validator);
    logger.success('All validator tests passed');
  } catch (error) {
    handleValidationError(error);
  }
}
export function handleValidationError(
  error: unknown,
  isCancelationPoint = false
) {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`${message}`);
  if (isCancelationPoint) process.exit(1);
}

export async function runValidatorTests(validator: Validator) {
  try {
    const validatorTests = await parseValidatorTests();
    const compiledPath = await compileCPP(validator.source);

    for (const [index, test] of validatorTests.entries()) {
      await executeValidatorTest(compiledPath, test, index + 1);
    }
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error(
          ` ${logger.bold('Failed to run validator tests')}: ${String(error)}`
        );
  } finally {
    executor.cleanup();
  }
}

async function executeValidatorTest(
  compiledPath: string,
  test: ValidatorTest,
  testNumber: number
) {
  const tempFilePath = createTempTestFile(test.stdin);

  try {
    const result = await executor.executeWithRedirect(
      compiledPath,
      {
        timeout: DEFAULT_TIMEOUT,
        memoryLimitMB: DEFAULT_MEMORY_LIMIT,
        silent: true,
      },
      tempFilePath,
      undefined
    );

    const expectedVerdict = normalizeValidatorVerdict(test.expectedVerdict);
    logValidatorTestResult(result.exitCode, expectedVerdict, testNumber);
  } finally {
    fs.unlinkSync(tempFilePath);
  }
}

async function runValidator(
  validator: Validator,
  testBegin?: number,
  testEnd?: number
) {
  try {
    const compiledPath = await compileCPP(validator.source);
    const testsDir = path.resolve(process.cwd(), 'tests');

    const results = await validateTestFiles(
      compiledPath,
      testsDir,
      testBegin,
      testEnd
    );
    if (results.failed > 0)
      throw new Error(
        `Validation failed: ${logger.highlight(String(results.failed))} tests failed.`
      );
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error(`Failed to run validator: ${String(error)}`);
  } finally {
    executor.cleanup();
  }
}

async function validateTestFiles(
  compiledPath: string,
  testsDir: string,
  testBegin?: number,
  testEnd?: number
): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  for (
    let testFileIndex = testBegin ?? 1;
    testFileIndex <= (testEnd ?? Infinity);
    testFileIndex++
  ) {
    const testFilePath = path.join(testsDir, `test${testFileIndex}.txt`);

    await executor.executeWithRedirect(
      compiledPath,
      {
        timeout: DEFAULT_TIMEOUT,
        memoryLimitMB: DEFAULT_MEMORY_LIMIT,
        silent: true,
        onSuccess: () => {
          passed++;
        },
        onError: result => {
          failed++;
          // throw new Error(`Test ${testFile} failed: ${result.stderr}`);
          logger.error(`Test ${testFileIndex} failed: ${result.stderr}`);
        },
      },
      testFilePath,
      undefined
    );
  }

  return { passed, failed };
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

function normalizeValidatorVerdict(verdict: string | number): string {
  return verdict === 'VALID' || verdict === 1 || verdict === 'valid'
    ? 'VALID'
    : 'INVALID';
}

function logValidatorTestResult(
  exitCode: number,
  expectedVerdict: string,
  testNumber: number
) {
  const passed = (exitCode === 0) === (expectedVerdict === 'VALID');

  if (!passed) {
    throw new Error(
      `Validator Test ${testNumber} failed: expected ${expectedVerdict} but got ${exitCode === 0 ? 'VALID' : 'INVALID'}`
    );
  }
}
function createTempTestFile(content: string): string {
  const tempFilePath = path.resolve(process.cwd(), 'temp_validator_test.txt');
  fs.writeFileSync(tempFilePath, content);
  return tempFilePath;
}
