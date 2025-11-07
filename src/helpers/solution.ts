/**
 * @fileoverview Solution compilation, execution, and verification utilities.
 * Provides functions to run solutions on test inputs, compare outputs with checkers,
 * and validate solution behavior against expected verdicts (TLE, MLE, WA, etc.).
 */

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

/**
 * Ensures solutions are defined in configuration.
 * Type assertion function that throws if no solutions exist.
 *
 * @param {Solution[] | undefined} solutions - Solutions array to validate
 *
 * @throws {Error} If no solutions are defined
 *
 * @example
 * const config = readConfigFile();
 * validateSolutionsExist(config.solutions);
 * // Now TypeScript knows solutions is defined and non-empty
 */
export function validateSolutionsExist(
  solutions: Solution[] | undefined
): asserts solutions is Solution[] {
  if (!solutions || solutions.length === 0) {
    throw new Error('No solutions defined in the configuration file.');
  }
}

/**
 * Finds solutions matching a given name or returns all solutions.
 *
 * @param {Solution[]} solutions - Array of solution configurations
 * @param {string} solutionName - Name of solution to find, or 'all' for all solutions
 * @returns {Solution[]} Array of matching solutions
 *
 * @throws {Error} If no solutions match the name
 *
 * @example
 * const matching = findMatchingSolutions(config.solutions, 'main');
 * // Returns: [{ name: 'main', source: 'Solution.cpp', type: 'main-correct' }]
 */
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

/**
 * Runs a single solution on test files.
 * Compiles the solution and executes it on all tests or a specific test.
 * Creates output files in solutions-outputs/<solution-name>/ directory.
 *
 * @param {Solution} solution - Solution configuration
 * @param {ConfigFile} config - Configuration containing time/memory limits
 * @param {number} [testNumber] - Optional specific test number to run on
 *
 * @throws {Error} If solution compilation fails
 * @throws {Error} If solution fails on any test with TLE, MLE, or RTE
 *
 * @example
 * const solution = config.solutions.find(s => s.name === 'main')!;
 * await runSingleSolutionOnTests(solution, config);
 *
 * @example
 * // Run on specific test
 * await runSingleSolutionOnTests(solution, config, 5);
 */
export async function runSingleSolutionOnTests(
  solution: Solution,
  config: ConfigFile,
  testNumber?: number
) {
  fmt.info(
    `  ${fmt.infoIcon()} Running solution: ${fmt.highlight(solution.name)} ${fmt.dim(`(${solution.type})`)}`
  );
  const thrownErrors = new Set<string>();

  try {
    const compiledPath = await compileSolution(solution.source);
    ensureOutputDirectory(solution.name);

    const testsDir = path.resolve(process.cwd(), 'tests');
    const testFiles = getTestFilesToRun(testsDir, testNumber);

    for (const testFile of testFiles) {
      if (thrownErrors.size > 0) {
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
        thrownErrors.add(message);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    thrownErrors.add(
      `Failed to compile solution ${solution.name}:\n\t${message}`
    );
  }

  if (thrownErrors.size > 0) {
    fmt.log(
      `    ${fmt.dim('→')} Completed running solution ${fmt.highlight(solution.name)} ${fmt.bold('With Failures:')}`
    );
    for (const errMsg of thrownErrors) {
      fmt.error(`      ${fmt.cross()} ${errMsg}`);
    }
    console.log();
    throw new Error(
      `Solution ${fmt.highlight(solution.name)} failed on tests: \t\n${Array.from(thrownErrors).join('\n')}`
    );
  } else {
    fmt.log(
      `    ${fmt.dim('→')} Completed running solution ${fmt.highlight(solution.name)}`
    );
  }
  console.log();
}

/**
 * Runs matching solutions on test files.
 * Finds solutions by name and executes each one on all tests or a specific test.
 * Creates output files in solutions-outputs/<solution-name>/ directory.
 *
 * @param {Solution[]} solutions - Array of solution configurations
 * @param {string} solutionName - Name of solution to run, or 'all' for all solutions
 * @param {ConfigFile} config - Configuration containing time/memory limits
 * @param {number} [testNumber] - Optional specific test number to run on
 *
 * @throws {Error} If no solutions match the name
 * @throws {Error} If solution compilation fails
 * @throws {Error} If solution execution fails unexpectedly
 * @throws {Error} If solution fails on any test with TLE, MLE, or RTE
 *
 * @example
 * // From actions.ts solveTests - run on all tests
 * await runMatchingSolutionsOnTests(config.solutions, 'main', config);
 *
 * @example
 * // Run on specific test
 * await runMatchingSolutionsOnTests(config.solutions, 'wa-solution', config, 5);
 *
 * @example
 * // Run all solutions
 * await runMatchingSolutionsOnTests(config.solutions, 'all', config);
 */
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

  const failedSolutionsErrorMessages = new Set<string>();

  for (const solution of matchingSolutions) {
    try {
      await runSingleSolutionOnTests(solution, config, testNumber);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failedSolutionsErrorMessages.add(message);
    }
  }

  if (failedSolutionsErrorMessages.size > 0) {
    throw new Error(
      `${fmt.bold('Some solutions failed:')}\n\n${Array.from(
        failedSolutionsErrorMessages
      ).join('\n\n')}`
    );
  }
}

/**
 * Gets array of test files to run based on test number.
 * If testNumber is provided, returns single test file.
 * Otherwise returns all test*.txt files from tests directory.
 *
 * @private
 * @param {string} testsDir - Path to tests directory
 * @param {number} [testNumber] - Optional specific test number
 * @returns {string[]} Array of test filenames
 *
 * @example
 * getTestFilesToRun('/path/to/tests', 5)
 * // Returns: ['test5.txt']
 *
 * @example
 * getTestFilesToRun('/path/to/tests')
 * // Returns: ['test1.txt', 'test2.txt', ...]
 */
function getTestFilesToRun(testsDir: string, testNumber?: number): string[] {
  if (testNumber !== undefined) {
    return [`test${testNumber}.txt`];
  }

  return getTestFiles(testsDir);
}

/**
 * Runs a compiled solution on a test input file.
 * Executes solution with time/memory limits, handles output files, and error scenarios.
 * Creates output file with either solution output or error message (TLE, MLE, RTE).
 *
 * @private
 * @param {Solution} solution - Solution configuration
 * @param {string} compiledPath - Path to compiled executable or interpreter command
 * @param {number} timeout - Time limit in milliseconds
 * @param {number} memoryLimitMB - Memory limit in megabytes
 * @param {string} inputFile - Name of test input file
 *
 * @throws {Error} If runtime error occurs
 * @throws {Error} If time limit exceeded
 * @throws {Error} If memory limit exceeded
 *
 * @example
 * await runSolution(
 *   { name: 'main', source: 'Solution.cpp', type: 'main-correct' },
 *   './Solution',
 *   2000,
 *   256,
 *   'test1.txt'
 * );
 */
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
/**
 * Creates output directory for solution if it doesn't exist.
 * Directory structure: solutions-outputs/<solution-name>/
 *
 * @private
 * @param {string} solutionName - Name of solution
 * @returns {string} Absolute path to created output directory
 *
 * @example
 * const dir = ensureOutputDirectory('main');
 * // Returns: '/path/to/project/solutions-outputs/main'
 * // Creates directory if needed
 */
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

/**
 * Compiles a solution based on file extension.
 * Supports C++ (.cpp), Python (.py), and Java (.java).
 *
 * @private
 * @param {string} sourcePath - Path to solution source file
 * @returns {Promise<string>} Command to execute the solution
 *
 * @throws {Error} If file extension is not supported
 *
 * @example
 * await compileSolution('Solution.cpp')
 * // Returns: '/path/to/Solution' (compiled executable)
 *
 * @example
 * await compileSolution('Solution.py')
 * // Returns: 'python3 Solution.py' (interpreter command)
 */
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

/**
 * Tests a solution against the main correct solution using the checker.
 * Runs both solutions on all tests, then compares outputs with the checker.
 * Validates that the solution behaves according to its expected type (TLE, WA, etc.).
 *
 * @param {string} solutionName - Name of solution to test
 *
 * @throws {Error} If main solution doesn't exist
 * @throws {Error} If target solution doesn't exist
 * @throws {Error} If main solution fails
 * @throws {Error} If comparison fails
 *
 * @example
 * // From actions.ts testWhat command
 * await testSolutionAgainstMainCorrect('wa-solution');
 * // Validates that wa-solution gets WA on at least one test
 */
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
      await runSingleSolutionOnTests(mainSolution, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const newErrorMessage = `Failed to run ${fmt.bold('Main Solution')}: \n\t${message}`;
      throwError(new Error(newErrorMessage));
    }

    fmt.log(
      `  ${fmt.dim('→')} Running target solution ${fmt.dim('(generating outputs...)')}`
    );
    try {
      await runSingleSolutionOnTests(solution, config);
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
  } catch (error) {
    throwError(error, `Failed to test solution "${solutionName}"`);
  }
}

/**
 * Ensures a main-correct solution exists in the configuration.
 * Type assertion function that throws if no main-correct solution found.
 *
 * @param {Solution[] | undefined} solutions - Solutions array to validate
 *
 * @throws {Error} If no solutions are defined
 * @throws {Error} If no main-correct solution exists
 *
 * @example
 * const config = readConfigFile();
 * ensureMainSolutionExists(config.solutions);
 */
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

/**
 * Ensures a specific solution exists in the configuration.
 * Type assertion function that throws if solution not found.
 *
 * @param {Solution[] | undefined} solutions - Solutions array to validate
 * @param {string} solutionName - Name of solution to find
 *
 * @throws {Error} If no solutions are defined
 * @throws {Error} If solution with given name doesn't exist
 *
 * @example
 * ensureSolutionExists(config.solutions, 'wa-solution');
 */
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

/**
 * Gets the main-correct solution from solutions array.
 *
 * @param {Solution[]} solutions - Array of solution configurations
 * @returns {Solution} The main-correct solution
 *
 * @throws {Error} If no main-correct solution found (should never happen if ensureMainSolutionExists called first)
 *
 * @example
 * const mainSolution = getMainSolution(config.solutions);
 * // Returns: { name: 'main', source: 'Solution.cpp', type: 'main-correct' }
 */
export function getMainSolution(solutions: Solution[]): Solution {
  for (const solution of solutions) {
    if (solution.type === 'main-correct') {
      return solution;
    }
  }
  // tell ts that this line is never reached
  throw new Error('Main correct solution not found.');
}

/**
 * Compares target solution outputs against main solution using checker.
 * Runs checker on all test cases and tracks verdicts (WA, TLE, MLE, RTE).
 * Validates that verdicts match the target solution's expected type.
 *
 * @param {Checker} checker - Checker configuration
 * @param {Solution} mainSolution - Main correct solution
 * @param {Solution} targetSolution - Solution to validate
 *
 * @throws {Error} If checker compilation fails
 * @throws {Error} If verdict validation fails
 * @throws {Error} If main solution has unexpected errors
 *
 * @example
 * // From fullVerification and testSolutionAgainstMainCorrect
 * await startTheComparisonProcess(
 *   config.checker,
 *   mainSolution,
 *   waSolution
 * );
 */
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
        await checkIfShouldSkipRest(
          testFile,
          mainOutputDir,
          targetOutputDir,
          verdictTracker
        )
      ) {
        break;
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
        if (expectedVerdict.toUpperCase() !== 'OK') {
          verdictTracker.didWA = true;
        }
      } catch {
        if (expectedVerdict.toUpperCase() === 'OK') {
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
/**
 * Creates a verdict tracker object to monitor solution outcomes.
 * Tracks TLE, MLE, RTE, PE, and WA verdicts during comparison.
 *
 * @private
 * @returns {VerdictTracker} Tracker object with all flags set to false
 *
 * @example
 * const tracker = createVerdictTracker();
 * // Returns: { didTLE: false, didMLE: false, didRTE: false, didPE: false, didWA: false }
 */
function createVerdictTracker(): VerdictTracker {
  return {
    didTLE: false,
    didMLE: false,
    didRTE: false,
    didPE: false,
    didWA: false,
  };
}

/**
 * Writes runtime error message to output file and throws error.
 * Used when solution crashes or has runtime errors.
 *
 * @private
 * @param {string} outputPath - Path to output file
 * @param {string} stderr - Error message from stderr
 *
 * @throws {Error} Always throws with runtime error message
 *
 * @example
 * writeErrorOutputAndThrow('/path/to/output.txt', 'segmentation fault');
 * // Creates file with: "Runtime Error: segmentation fault"
 * // Then throws error
 */
function writeErrorOutputAndThrow(outputPath: string, stderr: string) {
  fs.writeFileSync(outputPath, `Runtime Error: ${stderr}`);
  throw new Error(`Runtime Error: ${stderr}`);
}

/**
 * Writes timeout message to output file and throws error.
 * Used when solution exceeds time limit.
 *
 * @private
 * @param {string} outputPath - Path to output file
 * @param {number} timeout - Time limit that was exceeded (in ms)
 *
 * @throws {Error} Always throws with TLE message
 *
 * @example
 * writeTimeoutOutputAndThrow('/path/to/output.txt', 2000);
 * // Creates file with: "Time Limit Exceeded after 2000ms"
 * // Then throws error
 */
function writeTimeoutOutputAndThrow(outputPath: string, timeout: number) {
  fs.writeFileSync(outputPath, `Time Limit Exceeded after ${timeout}ms`);
  throw new Error(`Time Limit Exceeded after ${timeout}ms`);
}

/**
 * Writes memory limit exceeded message to output file and throws error.
 * Used when solution exceeds memory limit.
 *
 * @private
 * @param {string} outputPath - Path to output file
 * @param {number} memoryLimit - Memory limit that was exceeded (in MB)
 *
 * @throws {Error} Always throws with MLE message
 *
 * @example
 * writeMemoryOutputAndThrow('/path/to/output.txt', 256);
 * // Creates file with: "Memory Limit Exceeded (256 MB)"
 * // Then throws error
 */
function writeMemoryOutputAndThrow(outputPath: string, memoryLimit: number) {
  fs.writeFileSync(outputPath, `Memory Limit Exceeded (${memoryLimit} MB)`);
  throw new Error(`Memory Limit Exceeded (${memoryLimit} MB)`);
}

/**
 * Gets all test files from tests directory.
 * Returns only files starting with 'test' prefix in sorted order by test number.
 *
 * @private
 * @param {string} testsDir - Path to tests directory
 * @returns {string[]} Array of test filenames
 *
 * @example
 * getTestFiles('/path/to/tests')
 * // Returns: ['test1.txt', 'test2.txt', 'test3.txt', ...]
 */
function getTestFiles(testsDir: string): string[] {
  return fs
    .readdirSync(testsDir)
    .filter(file => file.startsWith('test'))
    .sort((a, b) => {
      const numA = parseInt(a.replace('test', '').replace('.txt', ''));
      const numB = parseInt(b.replace('test', '').replace('.txt', ''));
      return numA - numB;
    });
}

/**
 * Checks if tests should be skipped during checker comparison.
 * Skips if output file doesn't exist or if output indicates TLE/MLE/RTE.
 * Validates both main and target solution outputs for errors.
 * Skipping Tests mean no checker comparison is needed.
 *
 * @private
 * @param {string} testFile - Test filename
 * @param {string} mainOutputDir - Main solution output directory
 * @param {string} targetOutputDir - Target solution output directory
 * @param {VerdictTracker} verdictTracker - Verdict tracking object
 * @returns {Promise<boolean>} True if test should be skipped
 *
 * @throws {Error} If main solution has errors on test
 * @throws {Error} If target solution has unexpected errors
 *
 * @example
 * const shouldSkip = await checkIfShouldSkipRest(
 *   'test1.txt',
 *   '/path/to/main',
 *   '/path/to/wa-solution',
 *   waSolution,
 *   tracker
 * );
 */
async function checkIfShouldSkipRest(
  testFile: string,
  mainOutputDir: string,
  targetOutputDir: string,
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
  validateTargetSolutionOutput(targetFirstLine, verdictTracker);

  return shouldSkipCheckerComparison(targetFirstLine);
}

/**
 * Validates main solution output for errors.
 * Main solution should never have TLE, MLE, or RTE.
 *
 * @private
 * @param {string} firstLine - First line of output file
 * @param {string} testFile - Test filename
 *
 * @throws {Error} If main solution timed out
 * @throws {Error} If main solution exceeded memory
 * @throws {Error} If main solution had runtime error
 *
 * @example
 * validateMainSolutionOutput('42', 'test1.txt'); // OK
 * validateMainSolutionOutput('Time Limit Exceeded', 'test1.txt'); // Throws
 */
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

/**
 * Validates target solution output against expected solution type.
 * Updates verdict tracker and throws if behavior doesn't match type.
 *
 * @private
 * @param {string} firstLine - First line of output file
 * @param {VerdictTracker} verdictTracker - Verdict tracking object
 *
 * @example
 * // For TLE solution
 * validateTargetSolutionOutput('Time Limit Exceeded', 'test1.txt', tleSolution, tracker);
 * // Updates tracker.didTLE = true
 */
function validateTargetSolutionOutput(
  firstLine: string,
  verdictTracker: VerdictTracker
) {
  if (isTLE(firstLine)) {
    verdictTracker.didTLE = true;
  }

  if (isMLE(firstLine)) {
    verdictTracker.didMLE = true;
  }

  if (isRTE(firstLine)) {
    verdictTracker.didRTE = true;
  }
}

/**
 * Determines if checker comparison should be skipped for this output.
 * Skip if output indicates TLE, MLE, or RTE (already handled).
 *
 * @private
 * @param {string} firstLine - First line of output file
 * @returns {boolean} True if should skip checker comparison
 *
 * @example
 * shouldSkipCheckerComparison('Time Limit Exceeded') // returns true
 * shouldSkipCheckerComparison('42') // returns false
 */
function shouldSkipCheckerComparison(firstLine: string): boolean {
  if (isTLE(firstLine)) return true;
  if (isMLE(firstLine)) return true;
  if (isRTE(firstLine)) return true;
  return false;
}

/**
 * Validates that observed verdicts match expected solution type.
 * Ensures solutions behave according to their declared type (TLE, MLE, WA, etc.).
 *
 * @private
 * @param {Solution} targetSolution - Target solution configuration
 * @param {VerdictTracker} verdictTracker - Verdict tracking object
 *
 * @throws {Error} If TLE observed but solution not marked as TLE type
 * @throws {Error} If MLE observed but solution not marked as MLE type
 * @throws {Error} If RTE observed but solution not marked as failed/incorrect
 * @throws {Error} If WA observed but solution not marked as incorrect/wa
 * @throws {Error} If no errors but solution marked as incorrect/failed
 * @throws {Error} If TLE solution didn't timeout on any test
 * @throws {Error} If MLE solution didn't exceed memory on any test
 *
 * @example
 * // For TLE solution that timed out
 * validateExpectedVerdicts(tleSolution, { didTLE: true, ... }); // OK
 *
 * @example
 * // For TLE solution that didn't timeout
 * validateExpectedVerdicts(tleSolution, { didTLE: false, ... }); // Throws
 */
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
  if (targetSolution.type === 'tle' && !verdictTracker.didTLE) {
    throw new Error(
      `Target Solution ${fmt.highlight(targetSolution.name)} is marked as ${fmt.highlight(targetSolution.type)} but did not time out on any test`
    );
  }

  if (targetSolution.type === 'mle' && !verdictTracker.didMLE) {
    throw new Error(
      `Target Solution ${fmt.highlight(targetSolution.name)} is marked as ${fmt.highlight(targetSolution.type)} but did not exceed memory limit on any test`
    );
  }

  if (targetSolution.type === 'wa' && !verdictTracker.didWA) {
    throw new Error(
      `Target Solution ${fmt.highlight(targetSolution.name)} is marked as ${fmt.highlight(targetSolution.type)} but passed all tests correctly`
    );
  }
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

/**
 * Checks if first line indicates Time Limit Exceeded.
 *
 * @private
 * @param {string} firstLine - First line of output file
 * @returns {boolean} True if TLE detected
 *
 * @example
 * isTLE('Time Limit Exceeded after 2000ms') // returns true
 * isTLE('42') // returns false
 */
function isTLE(firstLine: string): boolean {
  return firstLine.startsWith('Time Limit Exceeded');
}

/**
 * Checks if first line indicates Memory Limit Exceeded.
 *
 * @private
 * @param {string} firstLine - First line of output file
 * @returns {boolean} True if MLE detected
 *
 * @example
 * isMLE('Memory Limit Exceeded (256 MB)') // returns true
 * isMLE('42') // returns false
 */
function isMLE(firstLine: string): boolean {
  return firstLine.startsWith('Memory Limit Exceeded');
}

/**
 * Checks if first line indicates Runtime Error.
 *
 * @private
 * @param {string} firstLine - First line of output file
 * @returns {boolean} True if RTE detected
 *
 * @example
 * isRTE('Runtime Error: segmentation fault') // returns true
 * isRTE('42') // returns false
 */
function isRTE(firstLine: string): boolean {
  return firstLine.startsWith('Runtime Error');
}

/**
 * Checks if solution type allows TLE verdict.
 *
 * @private
 * @param {SolutionType} solutionType - Solution type to check
 * @returns {boolean} True if TLE is valid for this type
 *
 * @example
 * isTLEValue('tle') // returns true
 * isTLEValue('tle-or-correct') // returns true
 * isTLEValue('main-correct') // returns false
 */
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

/**
 * Checks if solution type allows MLE verdict.
 *
 * @private
 * @param {SolutionType} solutionType - Solution type to check
 * @returns {boolean} True if MLE is valid for this type
 *
 * @example
 * isValidMLEValue('mle') // returns true
 * isValidMLEValue('tle-or-mle') // returns true
 * isValidMLEValue('wa') // returns false
 */
function isValidMLEValue(solutionType: SolutionType): boolean {
  const validTypes = ['mle', 'tle-or-mle', 'incorrect', 'failed'];
  return validTypes.includes(solutionType);
}

/**
 * Checks if solution type allows RTE verdict.
 *
 * @private
 * @param {SolutionType} solutionType - Solution type to check
 * @returns {boolean} True if RTE is valid for this type
 *
 * @example
 * isValidRTEValue('incorrect') // returns true
 * isValidRTEValue('failed') // returns true
 * isValidRTEValue('main-correct') // returns false
 */
function isValidRTEValue(solutionType: SolutionType): boolean {
  const validTypes = ['incorrect', 'failed'];
  return validTypes.includes(solutionType);
}

/**
 * Checks if solution type allows WA verdict.
 *
 * @private
 * @param {SolutionType} solutionType - Solution type to check
 * @returns {boolean} True if WA is valid for this type
 *
 * @example
 * isValidWAValue('wa') // returns true
 * isValidWAValue('incorrect') // returns true
 * isValidWAValue('main-correct') // returns false
 */
function isValidWAValue(solutionType: SolutionType): boolean {
  const validTypes = ['incorrect', 'failed', 'wa'];
  return validTypes.includes(solutionType);
}
