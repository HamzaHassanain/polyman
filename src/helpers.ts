import ConfigFile, {
  Checker,
  Generator,
  Solution,
  Validator,
  ValidatorTest,
  CheckerTest,
} from './types';
import { logger } from './logger';
import { executor } from './executor';
import path from 'path';
import fs from 'fs';

const DEFAULT_TIMEOUT = 10000;
const DEFAULT_MEMORY_LIMIT = 1024;

export function copyTemplate(srcDir: string, destDir: string) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyTemplate(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

export function readConfigFile(): ConfigFile {
  const configFilePath = path.resolve(process.cwd(), 'Config.json');
  const configData = fs.readFileSync(configFilePath, 'utf-8');
  return JSON.parse(configData) as ConfigFile;
}

export async function runGenerator(generator: Generator) {
  if (!generator.source) {
    logGeneratorWarningNoSource(generator.name);
    return;
  }

  logger.info(`Running Generator: ${generator.name}`);

  try {
    const testsDir = ensureTestsDirectory();
    const compiledPath = await compileCPP(generator.source);
    await generateTestFiles(compiledPath, generator, testsDir);

    logGeneratorSuccess(generator);
  } catch (error) {
    handleGeneratorError(generator.name, error);
  } finally {
    executor.cleanup();
  }
}
export async function runValidator(
  validator: Validator,
  testBegin?: number,
  testEnd?: number
) {
  logger.info('Running Validator...');

  try {
    const compiledPath = await compileCPP(validator.source);
    const testsDir = path.resolve(process.cwd(), 'tests');
    const testFiles = fs.readdirSync(testsDir);
    const filteredTests = filterTestsByRange(testFiles, testBegin, testEnd);

    const results = await validateTestFiles(
      compiledPath,
      testsDir,
      filteredTests
    );
    logValidationResults(results);

    if (results.failed > 0) {
      throw new Error(`${results.failed} test(s) failed validation`);
    }
  } finally {
    executor.cleanup();
  }
}
export async function runSolution(
  solution: Solution,
  timeout: number,
  memoryLimitMB: number,
  testBegin?: number,
  testEnd?: number
) {
  logger.info(`Running Solution: ${solution.name}`);

  try {
    const cmdToRun = await compileSolution(solution.source);
    const testsDir = path.resolve(process.cwd(), 'tests');
    const outputDir = ensureOutputDirectory(solution.name);
    const testFiles = fs.readdirSync(testsDir);
    const filteredTests = filterTestsByRange(testFiles, testBegin, testEnd);

    await runSolutionOnTests(
      cmdToRun,
      testsDir,
      outputDir,
      filteredTests,
      solution,
      timeout,
      memoryLimitMB
    );

    logger.success(
      `Solution ${logger.highlight(solution.name)} ran on all tests`
    );
  } catch (error) {
    logger.error(`Failed to run solution: ${solution.name}`);
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    executor.cleanup();
  }
}

export async function runValidatorTests(validator: Validator) {
  logger.info('Running Validator Tests...');
  try {
    const validatorTests: ValidatorTest[] = await parseValidatorTests();
    const compiledPath = await compileCPP(validator.source);

    for (const [index, test] of validatorTests.entries()) {
      const testFileTempFilePath = path.resolve(
        process.cwd(),
        `temp_validator_test.txt`
      );
      fs.writeFileSync(testFileTempFilePath, test.stdin);

      const result = await executor.executeWithRedirect(
        compiledPath,
        {
          timeout: DEFAULT_TIMEOUT,
          memoryLimitMB: DEFAULT_MEMORY_LIMIT,
          silent: true,
        },
        testFileTempFilePath,
        undefined
      );

      fs.unlinkSync(testFileTempFilePath);

      const expectedVerdict =
        test.expectedVerdict === 'VALID' ||
        test.expectedVerdict === 1 ||
        test.expectedVerdict === 'valid'
          ? 'VALID'
          : 'INVALID';

      if (result.exitCode === 0 && expectedVerdict === 'VALID') {
        logger.success(
          `Validator Test ${logger.highlight((index + 1).toString())} passed (expected VALID)`
        );
      } else if (result.exitCode !== 0 && expectedVerdict !== 'VALID') {
        logger.success(
          `Validator Test ${logger.highlight((index + 1).toString())} passed (expected INVALID)`
        );
      } else {
        logger.error(
          `Validator Test ${logger.highlight((index + 1).toString())} failed (expected ${expectedVerdict})`
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to run validator tests: ${message}`);
    process.exit(1);
  } finally {
    executor.cleanup();
  }
}

export async function runCheckerTests(checker: Checker) {
  logger.info('Running Checker Tests...');

  try {
    const checkerTests: CheckerTest[] = await parseCheckerTests();
    const compiledPath = await compileCPP(checker.source);

    for (const [index, test] of checkerTests.entries()) {
      const inputTempFilePath = path.resolve(
        process.cwd(),
        `temp_checker_input.txt`
      );
      const ouputFileTempFilePath = path.resolve(
        process.cwd(),
        `temp_checker_output.txt`
      );
      const answerFileTempFilePath = path.resolve(
        process.cwd(),
        `temp_checker_answer.txt`
      );

      fs.writeFileSync(inputTempFilePath, test.stdin);
      fs.writeFileSync(ouputFileTempFilePath, test.stdout);
      fs.writeFileSync(answerFileTempFilePath, test.answer);

      const result = await executor.execute(
        makeCheckerCommand(
          compiledPath,
          inputTempFilePath,
          ouputFileTempFilePath,
          answerFileTempFilePath
        ),
        {
          timeout: DEFAULT_TIMEOUT,
          memoryLimitMB: DEFAULT_MEMORY_LIMIT,
          silent: true,
        }
      );

      fs.unlinkSync(inputTempFilePath);
      fs.unlinkSync(ouputFileTempFilePath);
      fs.unlinkSync(answerFileTempFilePath);

      if (result.exitCode === 0 && test.verdict.toUpperCase() === 'OK') {
        logger.success(
          `Checker Test ${logger.highlight((index + 1).toString())} passed`
        );
        logger.log(`\t ${result.stdout.trim()}`);
      } else if (result.exitCode !== 0 && test.verdict.toUpperCase() !== 'OK') {
        logger.success(
          `Checker Test ${logger.highlight((index + 1).toString())} passed`
        );
        logger.log(`\t ${result.stderr.trim()}`);
      } else {
        logger.error(
          `Checker Test ${logger.highlight((index + 1).toString())} failed`
        );
        logger.log(
          `\t ${result.exitCode === 0 ? result.stdout.trim() : result.stderr.trim()}`
        );
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to run checker tests: ${message}`);
    process.exit(1);
  } finally {
    executor.cleanup();
  }
}

// export async function runSolutionAgainstMainCorrect(
//   solutions: Solution[],
//   solutionName: string,
//   checker: Checker,
//   timeLimit: number,
//   memoryLimit: number
// ) {}

function ensureTestsDirectory(): string {
  const testsDir = path.resolve(process.cwd(), 'tests');
  if (!fs.existsSync(testsDir)) {
    fs.mkdirSync(testsDir);
  }
  return testsDir;
}

async function generateTestFiles(
  compiledPath: string,
  generator: Generator,
  testsDir: string
) {
  const [start, end] = generator['tests-range'];

  for (let i = start; i <= end; i++) {
    const outputFilePath = path.join(testsDir, `test${i}.txt`);

    await executor.executeWithRedirect(
      `${compiledPath} ${i}`,
      {
        timeout: DEFAULT_TIMEOUT,
        memoryLimitMB: DEFAULT_MEMORY_LIMIT,
        silent: true,
        onError: result => {
          throw new Error(`Failed to generate test ${i}: ${result.stderr}`);
        },
      },
      undefined,
      outputFilePath
    );
  }
}
function logGeneratorWarningNoSource(generatorName: string) {
  logger.warning(
    `Generator ${logger.highlight(generatorName)} has no source file specified. Skipping generation.`
  );
}
function logGeneratorSuccess(generator: Generator) {
  const [start, end] = generator['tests-range'];
  const totalTests = end - start + 1;

  logger.success(
    `Generator ${logger.highlight(generator.name)} created tests ${start}-${end} ${logger.dim(`(${totalTests} tests)`)}`
  );
}

function handleGeneratorError(generatorName: string, error: unknown) {
  logger.error(`Failed to run generator: ${generatorName}`);
  throw error instanceof Error ? error : new Error(String(error));
}

function filterTestsByRange(
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

async function validateTestFiles(
  compiledPath: string,
  testsDir: string,
  testFiles: string[]
): Promise<{ passed: number; failed: number }> {
  let passed = 0;
  let failed = 0;

  for (const testFile of testFiles) {
    const testFilePath = path.join(testsDir, testFile);

    await executor.executeWithRedirect(
      compiledPath,
      {
        timeout: DEFAULT_TIMEOUT,
        memoryLimitMB: DEFAULT_MEMORY_LIMIT,
        silent: true,
        onSuccess: () => {
          passed++;
          logger.success(
            `Test ${logger.highlight(testFile)} passed validation`
          );
        },
        onError: result => {
          failed++;
          logger.error(`Test ${logger.highlight(testFile)} failed validation`);
          logger.log(`\t ${result.stderr}`);
        },
      },
      testFilePath,
      undefined
    );
  }

  return { passed, failed };
}

function logValidationResults(results: { passed: number; failed: number }) {
  if (results.failed > 0) {
    logger.warning(
      `Validation complete: ${logger.highlight(results.passed.toString())} passed, ${logger.highlight(results.failed.toString())} failed`
    );
  } else {
    logger.success(
      `All ${logger.highlight(results.passed.toString())} test(s) passed validation!`
    );
  }
}

function ensureOutputDirectory(solutionName: string): string {
  const outputDir = path.resolve(
    process.cwd(),
    'solutions-outputs',
    solutionName
  );
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  return outputDir;
}

async function runSolutionOnTests(
  cmdToRun: string,
  testsDir: string,
  outputDir: string,
  testFiles: string[],
  solution: Solution,
  timeout: number,
  memoryLimitMB: number
) {
  for (const testFile of testFiles) {
    const testFilePath = path.join(testsDir, testFile);
    const testOutputPath = path.resolve(outputDir, `output_${testFile}`);

    await executor.executeWithRedirect(
      cmdToRun,
      {
        timeout,
        memoryLimitMB,
        silent: true,
        onError: result =>
          writeErrorOutput(
            solution.name,
            testFile,
            testOutputPath,
            result.stderr
          ),
        onTimeout: () =>
          writeTimeoutOutput(solution.name, testFile, testOutputPath, timeout),
        onMemoryExceeded: () =>
          writeMemoryOutput(
            solution.name,
            testFile,
            testOutputPath,
            memoryLimitMB
          ),
      },
      testFilePath,
      testOutputPath
    );
  }
}

function writeErrorOutput(
  solutionName: string,
  testFile: string,
  outputPath: string,
  stderr: string
) {
  logger.error(
    `Solution ${logger.highlight(solutionName)} failed on test ${logger.highlight(testFile)}`
  );
  logger.error(`\t ${stderr}`);
  fs.writeFileSync(outputPath, stderr);
}

function writeTimeoutOutput(
  solutionName: string,
  testFile: string,
  outputPath: string,
  timeout: number
) {
  logger.error(
    `Solution ${logger.highlight(solutionName)} timed out on test ${logger.highlight(testFile)}`
  );
  fs.writeFileSync(outputPath, `Time Limit Exceeded after ${timeout}ms`);
}

function writeMemoryOutput(
  solutionName: string,
  testFile: string,
  outputPath: string,
  memoryLimit: number
) {
  logger.error(
    `Solution ${logger.highlight(solutionName)} exceeded memory limit on test ${logger.highlight(testFile)}`
  );
  fs.writeFileSync(outputPath, `Memory Limit Exceeded (${memoryLimit} MB)`);
}

async function compileSolution(sourcePath: string): Promise<string> {
  const ext = path.extname(sourcePath);

  switch (ext) {
    case '.cpp':
      return await compileCPP(sourcePath);
    case '.py':
      return `python3 ${sourcePath}`;
    case '.java':
      return await compileJava(sourcePath);
    default:
      throw new Error(`Unsupported solution file extension: ${ext}`);
  }
}

async function compileCPP(sourcePath: string): Promise<string> {
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

async function compileJava(sourcePath: string): Promise<string> {
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

function makeCheckerCommand(
  checkerPath: string,
  inputPath: string,
  outputPath: string,
  answerPath: string
): string {
  return `${checkerPath} ${inputPath} ${outputPath} ${answerPath}`;
}
