import ConfigFile, { Checker, Solution } from '../types';
import { executor } from '../executor';
import fs from 'fs';
import path from 'path';
import { throwError, DEFAULT_MEMORY_LIMIT, DEFAULT_TIMEOUT } from './utils';
import { compileCPP, compileJava, readConfigFile } from './utils';
import { logger } from '../logger';
import { ensureCheckerExists } from './checker';

export function validateSolutionsExist(
  solutions: Solution[] | undefined
): asserts solutions is Solution[] {
  if (!solutions || solutions.length === 0) {
    throw new Error('No solutions defined in the configuration file.');
  }
}
export function findMatchingSolutions(
  solutions: Solution[],
  solutionName: string
): Solution[] {
  const matching = solutions.filter(
    s => solutionName === 'all' || s.name === solutionName
  );

  if (matching.length === 0) {
    throw new Error(
      `Solution named "${solutionName}" not found or no solutions defined.`
    );
  }

  return matching;
}

export async function runMatchingSolutionsOnTests(
  solutions: Solution[],
  solutionName: string,
  config: ConfigFile,
  testNumber?: number
) {
  const matchingSolutions = findMatchingSolutions(solutions, solutionName);

  if (matchingSolutions.length === 0) {
    throw new Error(`No solutions matched the name "${solutionName}"`);
  }

  try {
    for (const solution of matchingSolutions) {
      logger.info(
        `Running solution: ${logger.highlight(solution.name)} ${logger.dim(`(${solution.type})`)}`
      );
      const compiledPath = await compileSolution(solution.source);
      ensureOutputDirectory(solution.name);

      const testsDir = path.resolve(process.cwd(), 'tests');
      const testFiles = getTestFilesToRun(testsDir, testNumber);

      for (const testFile of testFiles) {
        try {
          await runSolution(
            solution,
            compiledPath,
            config['time-limit'],
            config['memory-limit'],
            testFile
          );
        } catch (error) {
          throwError(error, `Failed on test file ${testFile}`);
        }
      }

      logger.log(
        `  ${logger.bold('→')} Completed running solution ${logger.highlight(solution.name)}`
      );
      console.log();
    }
  } catch (error) {
    throwError(error, 'Failed to run solutions on tests');
  }
}

function getTestFilesToRun(testsDir: string, testNumber?: number): string[] {
  if (testNumber !== undefined) {
    return [`test${testNumber}.txt`];
  }

  return fs
    .readdirSync(testsDir)
    .filter(file => file.startsWith('test') && file.endsWith('.txt'));
}

async function runSolution(
  solution: Solution,
  compiledPath: string,
  timeout: number,
  memoryLimitMB: number,
  inputFile: string
) {
  const outputFilePath = path.resolve(
    process.cwd(),
    'solutions-outputs',
    solution.name,
    path.basename(inputFile).replace('test', 'output_')
  );
  const inputFilePath = path.resolve(process.cwd(), 'tests', inputFile);
  await executor.executeWithRedirect(
    compiledPath,
    {
      timeout,
      memoryLimitMB,
      silent: true,
      onError: result => {
        writeErrorOutputAndThrow(outputFilePath, result.stderr);
      },
      onTimeout: () => {
        writeTimeoutOutputAndThrow(outputFilePath, timeout);
      },
      onMemoryExceeded: () => {
        writeMemoryOutputAndThrow(outputFilePath, memoryLimitMB);
      },
    },
    inputFilePath,
    outputFilePath
  );
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
// export async function runSolutionsOnSingleTest(
//   solutions: Solution[],
//   config: ConfigFile,
//   testNumber: number
// ) {
//   for (const solution of solutions) {
//     await runSolution(
//       solution,
//       config['time-limit'],
//       config['memory-limit'],
//       testNumber,
//       testNumber
//     );
//   }
// }
// export async function runSolutionsOnGeneratorTests(
//   solutions: Solution[],
//   config: ConfigFile,
//   generatorName: string
// ) {
//   const generator = config.generators?.find(g => g.name === generatorName);

//   if (!generator) {
//     throw new Error(
//       `No generator named "${generatorName}" found in the configuration file.`
//     );
//   }

//   const [start, end] = generator['tests-range'];

//   for (const solution of solutions) {
//     await runSolution(
//       solution,
//       config['time-limit'],
//       config['memory-limit'],
//       start,
//       end
//     );
//   }
// }
// export function handleSolutionError(
//   error: unknown,
//   isCancelationPoint = false
// ) {
//   const message = error instanceof Error ? error.message : String(error);
//   logger.error(`${message}`);
//   if (isCancelationPoint) process.exit(1);
// }
export async function testSolutionAgainstMainCorrect(solutionName: string) {
  try {
    const config = readConfigFile();
    const solutions = config.solutions;
    const checker = config.checker;

    ensureMainSolutionExists(solutions);
    ensureSolutionExists(solutions, solutionName);
    ensureCheckerExists(checker);

    const mainSolution = getMainSolution(solutions);
    const solution = solutions.find(s => s.name === solutionName)!;

    logger.info(
      `Main solution: ${logger.primary(mainSolution.name)} ${logger.dim(`(${mainSolution.type})`)}`
    );
    logger.info(
      `Target solution: ${logger.highlight(solutionName)} ${logger.dim(`(${solution.type})`)}`
    );
    console.log();

    logger.log(
      `  ${logger.dim('→')} Running main solution ${logger.dim('(generating outputs...)')}`
    );
    try {
      await runMatchingSolutionsOnTests([mainSolution], 'all', config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const newErrorMessage = `Failed to run ${logger.bold('Main Solution')}: \n\t${message}`;
      throwError(new Error(newErrorMessage));
    }

    logger.log(
      `  ${logger.dim('→')} Running target solution ${logger.dim('(generating outputs...)')}`
    );
    try {
      await runMatchingSolutionsOnTests([solution], 'all', config);
    } catch {
      // @ts-nocheck
    }

    logger.log(
      `  ${logger.dim('→')} Comparing with checker ${logger.dim('(validating verdicts...)')}`
    );
    try {
      await compareResultsWithChecker(checker, mainSolution, solution);
    } catch (error) {
      throwError(error, 'Comparison with checker failed');
    }

    console.log();
    logger.successBox(`"${solutionName}" BEHAVES AS EXPECTED!`);
  } catch (error) {
    throwError(error, `Failed to test solution "${solutionName}"`);
  }
}
export function ensureMainSolutionExists(
  solutions: Solution[] | undefined
): asserts solutions is Solution[] {
  if (!solutions || solutions.length === 0) {
    throw new Error('No solutions defined in the configuration file.');
  }

  for (const solution of solutions) {
    if (solution.type === 'main-correct') {
      return;
    }
  }

  throw new Error(
    'No solution with type "main-correct" found in the configuration file.'
  );
}

export function ensureSolutionExists(
  solutions: Solution[] | undefined,
  solutionName: string
): asserts solutions is Solution[] {
  if (!solutions || solutions.length === 0) {
    throw new Error('No solutions defined in the configuration file.');
  }

  for (const solution of solutions) {
    if (solution.name === solutionName) {
      return;
    }
  }

  throw new Error(`No solution named "${solutionName}" found.`);
}

export function getMainSolution(solutions: Solution[]): Solution {
  for (const solution of solutions) {
    if (solution.type === 'main-correct') {
      return solution;
    }
  }
  // tell ts that this line is never reached
  throw new Error('Main correct solution not found.');
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
function createVerdictTracker() {
  return {
    didTLE: false,
    didMLE: false,
    didRTE: false,
    didWA: false,
  };
}

function writeErrorOutputAndThrow(outputPath: string, stderr: string) {
  fs.writeFileSync(outputPath, `Runtime Error: ${stderr}`);
  throw new Error(`Runtime Error: ${stderr}`);
}

function writeTimeoutOutputAndThrow(outputPath: string, timeout: number) {
  fs.writeFileSync(outputPath, `Time Limit Exceeded after ${timeout}ms`);
  throw new Error(`Time Limit Exceeded after ${timeout}ms`);
}

function writeMemoryOutputAndThrow(outputPath: string, memoryLimit: number) {
  fs.writeFileSync(outputPath, `Memory Limit Exceeded (${memoryLimit} MB)`);
  throw new Error(`Memory Limit Exceeded (${memoryLimit} MB)`);
}

function getTestFiles(testsDir: string): string[] {
  return fs.readdirSync(testsDir).filter(file => file.startsWith('test'));
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
    throw new Error(`Main Solution timed out on test ${testFile}`);
  }
  if (isMLE(firstLine)) {
    throw new Error(`Main Solution exceeded memory limit on test ${testFile}`);
  }
  if (isRTE(firstLine)) {
    throw new Error(`Main Solution had runtime error on test ${testFile}`);
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
      throw new Error(
        `Target Solution timed out on test ${testFile} but marked as ${targetSolution.type}`
      );
    }
  }

  if (isMLE(firstLine)) {
    verdictTracker.didMLE = true;
    if (!isValidMLEValue(targetSolution.type)) {
      throw new Error(
        `Target Solution exceeded memory limit on test ${testFile} but marked as ${targetSolution.type}`
      );
    }
  }

  if (isRTE(firstLine)) {
    verdictTracker.didRTE = true;
    if (!isValidRTEValue(targetSolution.type)) {
      throw new Error(
        `Target Solution had runtime error on test ${testFile} but marked as ${targetSolution.type}`
      );
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
  _testNumber: number
) {
  const inputPath = path.join(testsDir, testFile);
  const result = await executor.execute(
    `${compiledCheckerPath} ${inputPath} ${targetOutputPath} ${mainOutputPath}`,
    {
      timeout: DEFAULT_TIMEOUT,
      memoryLimitMB: DEFAULT_MEMORY_LIMIT,
      silent: true,
      onError: () => {},
      onTimeout: () => {
        logger.error(
          `${logger.bold('Checker Unexpectedly Exceeded Time Limit!')} (${DEFAULT_TIMEOUT}ms), on test ${testFile}`
        );
        executor.cleanup();
        process.exit(1);
      },
      onMemoryExceeded: () => {
        logger.error(
          `${logger.bold('Checker Unexpectedly Exceeded Memory Limit!')} (${DEFAULT_MEMORY_LIMIT} MB), on test ${testFile}`
        );
        executor.cleanup();
        process.exit(1);
      },
    }
  );

  const expectedVerdict = getExpectedCheckerVerdict(targetSolution.type);
  if (result.exitCode !== 0 && expectedVerdict !== 'OK') {
    verdictTracker.didWA = true;
    if (!isValidWAValue(targetSolution.type)) {
      throw new Error(
        `Target Solution got wrong answer on test ${testFile} but marked as ${targetSolution.type}\n\t${logger.bold(
          result.stderr ? result.stderr : ''
        )}`
      );
    }
    return;
  }
}

function validateExpectedVerdicts(
  targetSolution: Solution,
  verdictTracker: ReturnType<typeof createVerdictTracker>
) {
  // For solutions specifically marked as TLE (not tle-or-*)
  if (targetSolution.type === 'tle' && !verdictTracker.didTLE) {
    throw new Error(
      'Target Solution is marked as TLE but did not time out on any test'
    );
  }

  // For solutions specifically marked as MLE
  if (targetSolution.type === 'mle' && !verdictTracker.didMLE) {
    throw new Error(
      'Target Solution is marked as MLE but did not exceed memory limit on any test'
    );
  }

  // For solutions marked as incorrect or failed, they should have gotten at least one error
  if (
    (targetSolution.type === 'incorrect' || targetSolution.type === 'failed') &&
    !verdictTracker.didTLE &&
    !verdictTracker.didMLE &&
    !verdictTracker.didRTE &&
    !verdictTracker.didWA
  ) {
    throw new Error(
      `Target Solution is marked as ${targetSolution.type} but passed all tests correctly`
    );
  }
}

function handleComparisonError(error: unknown) {
  throw error instanceof Error ? error : new Error(String(error));
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
