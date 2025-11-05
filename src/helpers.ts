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
  try {
    const validatorTests = await parseValidatorTests();
    const compiledPath = await compileCPP(validator.source);

    for (const [index, test] of validatorTests.entries()) {
      await executeValidatorTest(compiledPath, test, index + 1);
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
  try {
    const checkerTests = await parseCheckerTests();
    const compiledPath = await compileCPP(checker.source);

    for (const [index, test] of checkerTests.entries()) {
      await executeCheckerTest(compiledPath, test, index + 1);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to run checker tests: ${message}`);
    process.exit(1);
  } finally {
    executor.cleanup();
  }
}

export async function compareResultsWithChecker(
  checker: Checker,
  mainSolution: Solution,
  targetSolution: Solution
) {
  try {
    const compiledCheckerPath = await compileCPP(checker.source);
    const mainOutputDir = ensureOutputDirectory(mainSolution.name);
    const targetOutputDir = ensureOutputDirectory(targetSolution.name);
    const testsDir = path.resolve(process.cwd(), 'tests');
    const testFiles = getTestFiles(testsDir);

    const verdictTracker = createVerdictTracker();

    for (const [index, testFile] of testFiles.entries()) {
      await compareTestOutputs(
        testFile,
        index + 1,
        compiledCheckerPath,
        testsDir,
        mainOutputDir,
        targetOutputDir,
        targetSolution,
        verdictTracker
      );
    }

    validateExpectedVerdicts(targetSolution, verdictTracker);
  } catch (error) {
    handleComparisonError(error);
  } finally {
    executor.cleanup();
  }
}
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
  fs.writeFileSync(outputPath, `Runtime Error: ${stderr}`);
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

function createTempTestFile(content: string): string {
  const tempFilePath = path.resolve(process.cwd(), 'temp_validator_test.txt');
  fs.writeFileSync(tempFilePath, content);
  return tempFilePath;
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

  if (passed) {
    logger.success(
      `Validator Test ${logger.highlight(testNumber.toString())} passed (expected ${expectedVerdict})`
    );
  } else {
    logger.error(
      `Validator Test ${logger.highlight(testNumber.toString())} failed (expected ${expectedVerdict})`
    );
  }
}

function logCheckerTestResult(
  result: { exitCode: number; stdout: string; stderr: string },
  expectedVerdict: string,
  testNumber: number
): boolean {
  const success = result.exitCode === 0;
  const expectedSuccess = expectedVerdict.toUpperCase() === 'OK';
  const passed = success === expectedSuccess;

  if (passed) {
    logger.success(
      `Checker Test ${logger.highlight(testNumber.toString())} passed`
    );
    logger.log(`\t ${success ? result.stdout.trim() : result.stderr.trim()}`);
    return true;
  } else {
    logger.error(
      `Checker Test ${logger.highlight(testNumber.toString())} failed`
    );
    logger.log(`\t ${success ? result.stdout.trim() : result.stderr.trim()}`);
    return false;
  }
}

function readFirstLine(filePath: string): Promise<string> {
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

function isTLE(firstLine: string): boolean {
  return firstLine.startsWith('Time Limit Exceeded');
}

function isMLE(firstLine: string): boolean {
  return firstLine.startsWith('Memory Limit Exceeded');
}

function isRTE(firstLine: string): boolean {
  return firstLine.startsWith('Runtime Error');
}

function isTLEValue(solutionType: string): boolean {
  const validTypes = [
    'tle',
    'tle-or-correct',
    'tle-or-mle',
    'incorrect',
    'failed',
  ];
  return validTypes.includes(solutionType);
}

function isValidMLEValue(solutionType: string): boolean {
  const validTypes = ['mle', 'tle-or-mle', 'incorrect', 'failed'];
  return validTypes.includes(solutionType);
}

function isValidRTEValue(solutionType: string): boolean {
  const validTypes = ['incorrect', 'failed'];
  return validTypes.includes(solutionType);
}
function isValidWAValue(solutionType: string): boolean {
  const validTypes = ['incorrect', 'wa', 'failed'];
  return validTypes.includes(solutionType);
}

function getTestFiles(testsDir: string): string[] {
  return fs.readdirSync(testsDir).filter(file => file.startsWith('test'));
}

function createVerdictTracker() {
  return {
    didTLE: false,
    didMLE: false,
    didRTE: false,
    didWA: false,
    asExpected: true,
  };
}

async function compareTestOutputs(
  testFile: string,
  testNumber: number,
  compiledCheckerPath: string,
  testsDir: string,
  mainOutputDir: string,
  targetOutputDir: string,
  targetSolution: Solution,
  verdictTracker: ReturnType<typeof createVerdictTracker>
) {
  const mainOutputPath = path.join(mainOutputDir, `output_${testFile}`);
  const targetOutputPath = path.join(targetOutputDir, `output_${testFile}`);

  const mainFirstLine = await readFirstLine(mainOutputPath);
  const targetFirstLine = await readFirstLine(targetOutputPath);

  validateMainSolutionOutput(mainFirstLine, testFile);
  validateTargetSolutionOutput(
    targetFirstLine,
    testFile,
    targetSolution,
    verdictTracker
  );

  if (shouldSkipCheckerComparison(targetFirstLine)) {
    return;
  }

  await runCheckerComparison(
    compiledCheckerPath,
    testsDir,
    testFile,
    targetOutputPath,
    mainOutputPath,
    targetSolution,
    verdictTracker,
    testNumber
  );
}

function validateMainSolutionOutput(firstLine: string, testFile: string) {
  if (isTLE(firstLine)) {
    logger.error(`Main Solution timed out on test ${testFile}`);
    process.exit(1);
  }
  if (isMLE(firstLine)) {
    logger.error(`Main Solution exceeded memory limit on test ${testFile}`);
    process.exit(1);
  }
  if (isRTE(firstLine)) {
    logger.error(`Main Solution had runtime error on test ${testFile}`);
    process.exit(1);
  }
}

function validateTargetSolutionOutput(
  firstLine: string,
  testFile: string,
  targetSolution: Solution,
  verdictTracker: ReturnType<typeof createVerdictTracker>
) {
  if (isTLE(firstLine)) {
    verdictTracker.didTLE = true;
    if (!isTLEValue(targetSolution.type)) {
      logger.error(
        `Target Solution timed out on test ${testFile} but marked as ${targetSolution.type}`
      );
      verdictTracker.asExpected = false;
    }
  }

  if (isMLE(firstLine)) {
    verdictTracker.didMLE = true;
    if (!isValidMLEValue(targetSolution.type)) {
      logger.error(
        `Target Solution exceeded memory limit on test ${testFile} but marked as ${targetSolution.type}`
      );
      verdictTracker.asExpected = false;
    }
  }

  if (isRTE(firstLine)) {
    verdictTracker.didRTE = true;
    if (!isValidRTEValue(targetSolution.type)) {
      logger.error(
        `Target Solution had runtime error on test ${testFile} but marked as ${targetSolution.type}`
      );
      verdictTracker.asExpected = false;
    }
  }
}

function shouldSkipCheckerComparison(firstLine: string): boolean {
  if (isTLE(firstLine)) return true;
  if (isMLE(firstLine)) return true;
  if (isRTE(firstLine)) return true;
  return false;
}

async function runCheckerComparison(
  compiledCheckerPath: string,
  testsDir: string,
  testFile: string,
  targetOutputPath: string,
  mainOutputPath: string,
  targetSolution: Solution,
  verdictTracker: ReturnType<typeof createVerdictTracker>,
  testNumber: number
) {
  const inputPath = path.join(testsDir, testFile);
  const result = await executor.execute(
    `${compiledCheckerPath} ${inputPath} ${targetOutputPath} ${mainOutputPath}`,
    {
      timeout: DEFAULT_TIMEOUT,
      memoryLimitMB: DEFAULT_MEMORY_LIMIT,
      silent: true,
    }
  );

  const expectedVerdict = getExpectedCheckerVerdict(targetSolution.type);
  if (result.exitCode !== 0 && expectedVerdict !== 'OK') {
    verdictTracker.didWA = true;
    if (!isValidWAValue(targetSolution.type)) {
      logger.error(
        `Target Solution got wrong answer on test ${testFile} but marked as ${targetSolution.type}`
      );
      verdictTracker.asExpected = false;
    }
    return;
  }

  logger.success(
    `Checker compared outputs for test ${testNumber} successfully.`
  );
}

function validateExpectedVerdicts(
  targetSolution: Solution,
  verdictTracker: ReturnType<typeof createVerdictTracker>
) {
  if (isTLEValue(targetSolution.type) && !verdictTracker.didTLE) {
    logger.error(
      'Target Solution is marked as TLE but did not time out on any test'
    );
    return;
  }

  if (isValidMLEValue(targetSolution.type) && !verdictTracker.didMLE) {
    logger.error(
      'Target Solution is marked as MLE but did not exceed memory limit on any test'
    );
    return;
  }

  if (isValidRTEValue(targetSolution.type) && !verdictTracker.didRTE) {
    logger.error(
      'Target Solution is marked as RTE but did not have runtime error on any test'
    );
    return;
  }

  if (isValidWAValue(targetSolution.type) && !verdictTracker.didWA) {
    logger.error(
      'Target Solution is marked as WA but did not have wrong answer on any test'
    );
    return;
  }
  if (verdictTracker.asExpected) {
    logger.success('All results match the expected verdicts!');
  } else {
    logger.error('Some results did not match the expected verdicts.');
  }
}

function handleComparisonError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`Failed to compare results with checker: ${message}`);
  process.exit(1);
}

function getExpectedCheckerVerdict(solutionType: string): string {
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
      return 'NA';
  }
}
