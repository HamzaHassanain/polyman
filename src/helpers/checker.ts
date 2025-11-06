import fs from 'fs';
import path from 'path';
import { executor } from '../executor';
import { compileCPP } from './utils';
import { DEFAULT_TIMEOUT, DEFAULT_MEMORY_LIMIT } from './utils';
import { logger } from '../logger';
import { Checker, CheckerTest } from '../types';
import { readConfigFile } from './utils';

export function ensureCheckerExists(
  checker: Checker | undefined
): asserts checker is Checker {
  if (!checker) {
    throw new Error('No checker defined in the configuration file.');
  }
}

export async function runCheckerTests(checker: Checker) {
  try {
    const checkerTests = await parseCheckerTests();
    const compiledPath = await compileCPP(checker.source);

    for (const [index, test] of checkerTests.entries()) {
      await executeCheckerTest(compiledPath, test, index + 1);
    }
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error(`Failed to run checker tests: ${String(error)}`);
  } finally {
    executor.cleanup();
  }
}

export async function testCheckerItself() {
  try {
    const config = readConfigFile();
    const checker = config.checker;

    ensureCheckerExists(checker);

    logger.info('Running checker self-tests...');
    await runCheckerTests(checker);
    logger.success('All checker tests passed');
  } catch (error) {
    handleCheckerError(error);
  }
}

function parseCheckerTests(): Promise<CheckerTest[]> {
  return new Promise((resolve, reject) => {
    const testsFilePath = path.resolve(process.cwd(), 'checker_tests.json');
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

async function executeCheckerTest(
  compiledPath: string,
  test: CheckerTest,
  testNumber: number
) {
  const tempFiles = createCheckerTempFiles(test);

  try {
    const result = await executor.execute(
      `${compiledPath} ${tempFiles.input} ${tempFiles.output} ${tempFiles.answer}`,
      {
        timeout: DEFAULT_TIMEOUT,
        memoryLimitMB: DEFAULT_MEMORY_LIMIT,
        silent: true,
      }
    );

    logCheckerTestResult(result, test.verdict, testNumber);
  } finally {
    cleanupTempFiles([tempFiles.input, tempFiles.output, tempFiles.answer]);
  }
}

function createCheckerTempFiles(test: CheckerTest) {
  const inputPath = path.resolve(process.cwd(), 'temp_checker_input.txt');
  const outputPath = path.resolve(process.cwd(), 'temp_checker_output.txt');
  const answerPath = path.resolve(process.cwd(), 'temp_checker_answer.txt');

  fs.writeFileSync(inputPath, test.stdin);
  fs.writeFileSync(outputPath, test.stdout);
  fs.writeFileSync(answerPath, test.answer);

  return { input: inputPath, output: outputPath, answer: answerPath };
}

function cleanupTempFiles(filePaths: string[]) {
  filePaths.forEach(filePath => fs.unlinkSync(filePath));
}

function logCheckerTestResult(
  result: { exitCode: number; stdout: string; stderr: string },
  expectedVerdict: string,
  testNumber: number
): boolean {
  const success = result.exitCode === 0;
  const expectedSuccess = expectedVerdict.toUpperCase() === 'OK';
  const passed = success === expectedSuccess;

  if (!passed) {
    throw new Error(
      `Checker Test ${testNumber} failed: expected ${expectedVerdict} but got ${success ? 'OK' : 'WA/PE'}`
    );
  }

  return true;
}

function handleCheckerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`${message}`);
  process.exit(1);
}
