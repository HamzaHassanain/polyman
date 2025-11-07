import ConfigFile, {
  Checker,
  Solution,
  SolutionType,
  VerdictTracker,
} from '../types';
import { executor } from '../executor';
import fs from 'fs';
import path from 'path';
import { throwError } from './utils';
import {
  compileCPP,
  compileJava,
  readConfigFile,
  readFirstLine,
} from './utils';
import { fmt } from '../formatter';
import {
  ensureCheckerExists,
  runChecker,
  getExpectedCheckerVerdict,
  compileChecker,
} from './checker';

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
      fmt.info(
        `  ${fmt.infoIcon()} Running solution: ${fmt.highlight(solution.name)} ${fmt.dim(`(${solution.type})`)}`
      );
      const compiledPath = await compileSolution(solution.source);
      ensureOutputDirectory(solution.name);

      const testsDir = path.resolve(process.cwd(), 'tests');
      const testFiles = getTestFilesToRun(testsDir, testNumber);
      const throwenErrors = new Set<string>();
      for (const testFile of testFiles) {
        if (throwenErrors.size > 0) {
          break;
        }
        try {
          await runSolution(
            solution,
            compiledPath,
            config['time-limit'],
            config['memory-limit'],
            testFile
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message + ` (test: ${testFile})`
              : String(error);
          throwenErrors.add(message);
        }
      }
      if (throwenErrors.size > 0) {
        fmt.log(
          `    ${fmt.dim('→')} Completed running solution ${fmt.highlight(solution.name)} ${fmt.bold('With Failures:')}`
        );
        for (const errMsg of throwenErrors) {
          fmt.error(`      ${fmt.cross()} ${errMsg}`);
        }
        console.log();
      } else {
        fmt.log(
          `    ${fmt.dim('→')} Completed running solution ${fmt.highlight(solution.name)}`
        );
      }
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
    `output_${inputFile}`
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

    fmt.info(
      `  ${fmt.infoIcon()} Main solution: ${fmt.primary(mainSolution.name)} ${fmt.dim(`(${mainSolution.type})`)}`
    );
    fmt.info(
      `  ${fmt.infoIcon()} Target solution: ${fmt.highlight(solutionName)} ${fmt.dim(`(${solution.type})`)}`
    );
    console.log();

    fmt.log(
      `  ${fmt.dim('→')} Running main solution ${fmt.dim('(generating outputs...)')}`
    );
    try {
      await runMatchingSolutionsOnTests([mainSolution], 'all', config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const newErrorMessage = `Failed to run ${fmt.bold('Main Solution')}: \n\t${message}`;
      throwError(new Error(newErrorMessage));
    }

    fmt.log(
      `  ${fmt.dim('→')} Running target solution ${fmt.dim('(generating outputs...)')}`
    );
    try {
      await runMatchingSolutionsOnTests([solution], 'all', config);
    } catch {
      // @ts-nocheck
    }

    fmt.log(
      `  ${fmt.dim('→')} Comparing with checker ${fmt.dim('(validating verdicts...)')}`
    );
    try {
      await startTheComparisonProcess(checker, mainSolution, solution);
    } catch (error) {
      throwError(error, 'Comparison with checker failed');
    }

    console.log();
    fmt.successBox(`"${solutionName}" BEHAVES AS EXPECTED!`);
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
export async function startTheComparisonProcess(
  checker: Checker,
  mainSolution: Solution,
  targetSolution: Solution
) {
  try {
    const compiledCheckerPath = await compileChecker(checker);
    const mainOutputDir = ensureOutputDirectory(mainSolution.name);
    const targetOutputDir = ensureOutputDirectory(targetSolution.name);
    const testsDir = path.resolve(process.cwd(), 'tests');
    const testFiles = getTestFiles(testsDir);

    const verdictTracker = createVerdictTracker();

    for (const testFile of testFiles) {
      if (
        await checkIfShouldSkip(
          testFile,
          mainOutputDir,
          targetOutputDir,
          targetSolution,
          verdictTracker
        )
      ) {
        continue;
      }
      const inputFilePath = path.join(testsDir, testFile);
      const outputFilePath = path.join(targetOutputDir, `output_${testFile}`);
      const answerFilePath = path.join(mainOutputDir, `output_${testFile}`);
      const expectedVerdict = getExpectedCheckerVerdict(targetSolution.type);
      try {
        await runChecker(
          compiledCheckerPath,
          inputFilePath,
          outputFilePath,
          answerFilePath,
          expectedVerdict
        );
        // expected verdict is correct and the checker did not throw
        if (expectedVerdict !== 'OK') {
          verdictTracker.didWA = true;
        }
      } catch {
        if (expectedVerdict === 'OK') {
          verdictTracker.didWA = true;
        }
      }
    }

    validateExpectedVerdicts(targetSolution, verdictTracker);
  } catch (error) {
    throwError(error, 'Error during solution comparison process');
  } finally {
    executor.cleanup();
  }
}
function createVerdictTracker(): VerdictTracker {
  return {
    didTLE: false,
    didMLE: false,
    didRTE: false,
    didPE: false,
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

async function checkIfShouldSkip(
  testFile: string,
  mainOutputDir: string,
  targetOutputDir: string,
  targetSolution: Solution,
  verdictTracker: VerdictTracker
) {
  const mainOutputPath = path.join(mainOutputDir, `output_${testFile}`);
  const targetOutputPath = path.join(targetOutputDir, `output_${testFile}`);

  // if target ouput file does not exist, it means the solution failed to run on this test, either TLE, MLE, RTE
  // So, the verdictTracker must have caught that already
  if (!fs.existsSync(targetOutputPath)) {
    return true;
  }

  const mainFirstLine = await readFirstLine(mainOutputPath);
  const targetFirstLine = await readFirstLine(targetOutputPath);

  validateMainSolutionOutput(mainFirstLine, testFile);
  validateTargetSolutionOutput(
    targetFirstLine,
    testFile,
    targetSolution,
    verdictTracker
  );

  return shouldSkipCheckerComparison(targetFirstLine);
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
  verdictTracker: VerdictTracker
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

function validateExpectedVerdicts(
  targetSolution: Solution,
  verdictTracker: VerdictTracker
) {
  if (verdictTracker.didTLE) {
    if (!isTLEValue(targetSolution.type)) {
      throw new Error(
        `Solution ${fmt.highlight(targetSolution.name)} marked as ${targetSolution.type} but had Time Limit Exceeded on some tests`
      );
    }
  }
  if (verdictTracker.didMLE) {
    if (!isValidMLEValue(targetSolution.type)) {
      throw new Error(
        `Solution ${fmt.highlight(targetSolution.name)} marked as ${targetSolution.type} but got Memory Limit Exceeded on some tests`
      );
    }
  }

  if (verdictTracker.didRTE) {
    if (!isValidRTEValue(targetSolution.type)) {
      throw new Error(
        `Solution ${fmt.highlight(targetSolution.name)} marked as ${fmt.highlight(targetSolution.type)} but got Runtime Error on some tests`
      );
    }
  }

  if (verdictTracker.didWA) {
    if (!isValidWAValue(targetSolution.type)) {
      throw new Error(
        `Solution ${fmt.highlight(targetSolution.name)} marked as ${fmt.highlight(targetSolution.type)} but got Wrong Answer on some tests`
      );
    }
  }
  // For solutions specifically marked as TLE (not tle-or-*)
  if (targetSolution.type === 'tle' && !verdictTracker.didTLE) {
    throw new Error(
      `Target Solution ${fmt.highlight(targetSolution.name)} is marked as ${fmt.highlight(targetSolution.type)} but did not time out on any test`
    );
  }

  // For solutions specifically marked as MLE
  if (targetSolution.type === 'mle' && !verdictTracker.didMLE) {
    throw new Error(
      `Target Solution ${fmt.highlight(targetSolution.name)} is marked as ${fmt.highlight(targetSolution.type)} but did not exceed memory limit on any test`
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
      `Target Solution ${fmt.highlight(targetSolution.name)} is marked as ${targetSolution.type} but passed all tests correctly`
    );
  }
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

function isTLEValue(solutionType: SolutionType): boolean {
  const validTypes = [
    'tle',
    'tle-or-correct',
    'tle-or-mle',
    'incorrect',
    'failed',
  ];
  return validTypes.includes(solutionType);
}

function isValidMLEValue(solutionType: SolutionType): boolean {
  const validTypes = ['mle', 'tle-or-mle', 'incorrect', 'failed'];
  return validTypes.includes(solutionType);
}

function isValidRTEValue(solutionType: SolutionType): boolean {
  const validTypes = ['incorrect', 'failed'];
  return validTypes.includes(solutionType);
}

function isValidWAValue(solutionType: SolutionType): boolean {
  const validTypes = ['incorrect', 'failed', 'wa'];
  return validTypes.includes(solutionType);
}
