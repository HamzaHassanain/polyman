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

export async function runChecker(
  execCommand: string,
  inputFilePath: string,
  outputFilePath: string,
  answerFilePath: string,
  expectedVerdict: CheckerVerdict
) {
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
    expectedVerdict.toUpperCase() === 'WA' ||
    expectedVerdict.toUpperCase() === 'PE'
  ) {
    throw new Error(`Expected ${expectedVerdict} but got OK`);
  }
}

export function ensureCheckerExists(
  checker: Checker | undefined
): asserts checker is Checker {
  if (!checker) {
    throw new Error('No checker defined in the configuration file.');
  }
}

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

export async function compileChecker(checker: Checker) {
  try {
    const checkerSource = checker.custom
      ? checker.source
      : path.resolve(
          __dirname,
          '..',
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
