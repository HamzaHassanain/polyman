/**
 * @fileoverview Solution compilation, execution, and verification utilities.
 * Provides functions to run solutions on test inputs, compare outputs with checkers,
 * and validate solution behavior against expected verdicts (TLE, MLE, WA, etc.).
 */

import ConfigFile, {
  LocalSolution,
  VerdictTracker,
  LocalTestset,
} from '../types';
import { executor } from '../executor';
import fs from 'fs';
import path from 'path';
import { logError, throwError } from './utils';
import {
  compileCPP,
  compileJava,
  readConfigFile,
  readFirstLine,
  getTestFiles,
  getCompiledCommandToRun,
} from './utils';
import { fmt } from '../formatter';
import { ensureCheckerExists, runChecker } from './checker';
import type { LocalChecker } from '../types';
import { getGeneratorCommands } from './testset';

/**
 * Ensures solutions are defined in configuration.
 * Type assertion function that throws if no solutions exist.
 *
 * @param {LocalSolution[] | undefined} solutions - Solutions array to validate
 *
 * @throws {Error} If no solutions are defined
 *
 * @example
 * const config = readConfigFile();
 * validateSolutionsExist(config.solutions);
 * // Now TypeScript knows solutions is defined and non-empty
 */
export function validateSolutionsExist(
  solutions: LocalSolution[] | undefined
): asserts solutions is LocalSolution[] {
  if (!solutions || solutions.length === 0) {
    throw new Error('No solutions defined in the configuration file.');
  }
}

/**
 * Finds solutions matching a given name or returns all solutions.
 *
 * @param {LocalSolution[]} solutions - Array of solution configurations
 * @param {string} solutionName - Name of solution to find, or 'all' for all solutions
 * @returns {LocalSolution[]} Array of matching solutions
 *
 * @throws {Error} If no solutions match the name
 *
 * @example
 * const matching = findMatchingSolutions(config.solutions, 'main');
 * // Returns: [{ name: 'main', source: 'Solution.cpp', type: 'main-correct' }]
 */
export function findMatchingSolutions(
  solutions: LocalSolution[],
  solutionName: string
): LocalSolution[] {
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
 * Runs a compiled solution on a test input file.
 * Executes solution with time/memory limits, handles output files, and error scenarios.
 * Creates output file with either solution output or error message (TLE, MLE, RTE).
 *
 * @private
 * @param {LocalSolution} solution - Solution configuration
 * @param {string} compiledPath - Path to compiled executable or interpreter command
 * @param {number} timeout - Time limit in milliseconds
 * @param {number} memoryLimitMB - Memory limit in megabytes
 * @param {string} inputFile - Name of test input file
 * @param {string} testsetName - Name of testset containing the test
 *
 * @throws {Error} If runtime error occurs
 * @throws {Error} If time limit exceeded
 * @throws {Error} If memory limit exceeded
 *
 * @example
 * await runSolution(
 *   { name: 'main', source: 'Solution.cpp', tag: 'MA' },
 *   './Solution',
 *   2000,
 *   256,
 *   'test1.txt',
 *   'testsets'
 * );
 */
async function runSolution(
  solution: LocalSolution,
  compiledPath: string,
  timeout: number,
  memoryLimitMB: number,
  inputFile: string,
  testsetName: string
) {
  const outputFilePath = path.resolve(
    process.cwd(),
    'solutions-outputs',
    solution.name,
    testsetName,
    `output_${inputFile}`
  );
  const inputFilePath = path.resolve(
    process.cwd(),
    'testsets',
    testsetName,
    inputFile
  );

  // if ouputFilePath exists from previous runs, delete it first
  if (fs.existsSync(outputFilePath)) {
    fs.unlinkSync(outputFilePath);
  }
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
 * Directory structure: solutions-outputs/<solution-name>/[testset-name/]
 *
 * @private
 * @param {string} solutionName - Name of solution
 * @param {string} [testsetName] - Optional testset name for subdirectory
 * @returns {string} Absolute path to created output directory
 *
 * @example
 * const dir = ensureOutputDirectory('main');
 * // Returns: '/path/to/project/solutions-outputs/main'
 *
 * @example
 * const dir = ensureOutputDirectory('main', 'testsets');
 * // Returns: '/path/to/project/solutions-outputs/main/tests'
 */
function ensureOutputDirectory(
  solutionName: string,
  testsetName?: string
): string {
  const outputDir = testsetName
    ? path.resolve(
        process.cwd(),
        'solutions-outputs',
        solutionName,
        testsetName
      )
    : path.resolve(process.cwd(), 'solutions-outputs', solutionName);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  return outputDir;
}

/**
 * Compiles a solution based on file extension.
 * Supports C++ (.cpp), Python (.py), and Java (.java).
 * For interpreted languages, returns the interpreter command.
 *
 * @param {string} sourcePath - Path to solution source file
 * @returns {Promise<void>} Resolves when compilation completes
 *
 * @throws {Error} If compilation fails
 * @throws {Error} If file extension is not supported
 *
 * @example
 * await compileSolution('Solution.cpp')
 * // Compiles to ./Solution executable
 *
 * @example
 * await compileSolution('Solution.py')
 * // No compilation needed (interpreted)
 */
export async function compileSolution(sourcePath: string): Promise<void> {
  const ext = path.extname(sourcePath);

  switch (ext) {
    case '.cpp':
      await compileCPP(sourcePath);
      break;
    case '.py':
      // No compilation needed for Python
      break;
    case '.java':
      await compileJava(sourcePath);
      break;
    default:
      throw new Error(`Unsupported solution file extension: ${ext}`);
  }
}

/**
 * Compiles all matching solutions.
 * Compiles each solution based on file extension.
 *
 * @param {LocalSolution[]} solutions - Array of solutions to compile
 * @returns {Promise<void>} Resolves when all compilations complete
 *
 * @throws {Error} If any compilation fails
 *
 * @example
 * await compileAllSolutions(config.solutions);
 * // Compiles all solutions in parallel
 */
export async function compileAllSolutions(
  solutions: LocalSolution[]
): Promise<void> {
  await Promise.all(solutions.map(s => compileSolution(s.source)));
}

/**
 * Runs a single solution on a single test within a testset.
 * Executes it on the specified test using pre-compiled executable.
 * Note: Solution must be compiled before calling this function.
 *
 * @param {LocalSolution} solution - Solution configuration
 * @param {ConfigFile} config - Configuration containing time/memory limits
 * @param {string} testsetName - Name of testset containing the test
 * @param {number} testIndex - Test index (1-based)
 *
 * @throws {Error} If solution execution fails
 *
 * @example
 * await runSolutionOnSingleTest(solution, config, 'testsets', 5);
 */
export async function runSolutionOnSingleTest(
  solution: LocalSolution,
  config: ConfigFile,
  testsetName: string,
  testIndex: number
) {
  fmt.info(
    `  ${fmt.infoIcon()} Running solution: ${fmt.highlight(solution.name)} on test ${testIndex} in ${fmt.highlight(testsetName)}`
  );

  try {
    const compiledPath = getCompiledCommandToRun(solution);
    ensureOutputDirectory(solution.name, testsetName);

    const testFile = `test${testIndex}.txt`;

    await runSolution(
      solution,
      compiledPath,
      config.timeLimit,
      config.memoryLimit,
      testFile,
      testsetName
    );

    fmt.log(`    ${fmt.dim('→')} Test ${testIndex} completed successfully`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Solution ${fmt.highlight(solution.name)} failed on test ${testIndex}: ${message}`
    );
  }
}

/**
 * Runs a single solution on an entire testset.
 * Executes it on all tests in the testset using pre-compiled executable.
 * Note: Solution must be compiled before calling this function.
 *
 * @param {LocalSolution} solution - Solution configuration
 * @param {ConfigFile} config - Configuration containing time/memory limits
 * @param {string} testsetName - Name of testset to run on
 *
 * @throws {Error} If solution fails on any test
 *
 * @example
 * await runSolutionOnTestset(solution, config, 'testsets');
 */
export async function runSolutionOnTestset(
  solution: LocalSolution,
  config: ConfigFile,
  testsetName: string
) {
  fmt.info(
    `  ${fmt.infoIcon()} Running solution: ${fmt.highlight(solution.name)} on testset ${fmt.highlight(testsetName)}`
  );
  const thrownErrors = new Set<string>();

  try {
    const compiledPath = getCompiledCommandToRun(solution);
    ensureOutputDirectory(solution.name, testsetName);

    const testsDir = path.resolve(process.cwd(), 'testsets', testsetName);
    const testFiles = getTestFiles(testsDir);

    for (const testFile of testFiles) {
      if (thrownErrors.size > 0) {
        break;
      }
      try {
        await runSolution(
          solution,
          compiledPath,
          config.timeLimit,
          config.memoryLimit,
          testFile,
          testsetName
        );
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message + ` (${testsetName}/${testFile})`
            : String(error);
        thrownErrors.add(message);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    thrownErrors.add(
      `Failed to get compiled solution ${solution.name}:\n\t${message}`
    );
  }

  if (thrownErrors.size > 0) {
    fmt.log(
      `    ${fmt.dim('→')} Completed testset ${fmt.highlight(testsetName)} ${fmt.bold('With Failures:')}`
    );
    for (const errMsg of thrownErrors) {
      fmt.error(`      ${fmt.cross()} ${errMsg}`);
    }
    console.log();
    throw new Error(
      `Solution ${fmt.highlight(solution.name)} failed on testset ${testsetName}:\n${Array.from(thrownErrors).join('\n')}`
    );
  } else {
    fmt.log(
      `    ${fmt.dim('→')} Completed testset ${fmt.highlight(testsetName)}`
    );
  }
  console.log();
}

/**
 * Runs a single solution on a specific group within a testset.
 * Executes it on all tests in the group using pre-compiled executable.
 * Note: Solution must be compiled before calling this function.
 *
 * @param {LocalSolution} solution - Solution configuration
 * @param {ConfigFile} config - Configuration containing time/memory limits
 * @param {LocalTestset} testset - Testset configuration
 * @param {string} groupName - Name of group to run on
 *
 * @throws {Error} If solution fails on any test in the group
 *
 * @example
 * await runSolutionOnGroup(solution, config, testset, 'samples');
 */
export async function runSolutionOnGroup(
  solution: LocalSolution,
  config: ConfigFile,
  testset: LocalTestset,
  groupName: string
) {
  fmt.info(
    `  ${fmt.infoIcon()} Running solution: ${fmt.highlight(solution.name)} on group ${fmt.highlight(groupName)} in ${fmt.highlight(testset.name)}`
  );
  const thrownErrors = new Set<string>();

  try {
    const compiledPath = getCompiledCommandToRun(solution);
    ensureOutputDirectory(solution.name, testset.name);

    const commands = getGeneratorCommands(testset);
    const groupCommands = commands.filter(cmd => cmd.group === groupName);

    if (groupCommands.length === 0) {
      throw new Error(
        `No tests found for group "${groupName}" in testset "${testset.name}"`
      );
    }

    let testIndex = 1;
    for (const cmd of commands) {
      if (cmd.group === groupName) {
        const testFile = `test${testIndex}.txt`;
        try {
          await runSolution(
            solution,
            compiledPath,
            config.timeLimit,
            config.memoryLimit,
            testFile,
            testset.name
          );
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message + ` (test: ${testFile})`
              : String(error);
          thrownErrors.add(message);
        }
      }
      testIndex++;
      if (thrownErrors.size > 0) {
        break;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    thrownErrors.add(
      `Failed to get compiled solution ${solution.name}:\n\t${message}`
    );
  }

  if (thrownErrors.size > 0) {
    fmt.log(
      `    ${fmt.dim('→')} Completed group ${fmt.highlight(groupName)} ${fmt.bold('With Failures:')}`
    );
    for (const errMsg of thrownErrors) {
      fmt.error(`      ${fmt.cross()} ${errMsg}`);
    }
    console.log();
    throw new Error(
      `Solution ${fmt.highlight(solution.name)} failed on group ${groupName}:\n${Array.from(thrownErrors).join('\n')}`
    );
  } else {
    fmt.log(`    ${fmt.dim('→')} Completed group ${fmt.highlight(groupName)}`);
  }
  console.log();
}

/**
 * Runs a single solution on all testsets.
 * Compiles the solution and executes it on every test in every testset.
 *
 * @param {LocalSolution} solution - Solution configuration
 * @param {ConfigFile} config - Configuration containing time/memory limits
 * @param {LocalTestset[]} testsets - Array of testset configurations
 *
 * @throws {Error} If solution compilation fails
 * @throws {Error} If solution fails on any test
 *
 * @example
 * await runSolutionOnAllTestsets(solution, config, config.testsets);
 */
export async function runSolutionOnAllTestsets(
  solution: LocalSolution,
  config: ConfigFile,
  testsets: LocalTestset[]
) {
  const failedTestsets = new Set<string>();

  for (const testset of testsets) {
    try {
      await runSolutionOnTestset(solution, config, testset.name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failedTestsets.add(message);
    }
  }

  if (failedTestsets.size > 0) {
    throw new Error(
      `Solution ${fmt.highlight(solution.name)} failed on some testsets:\n${Array.from(failedTestsets).join('\n\n')}`
    );
  }
}

/**
 * Tests a solution against the main correct solution using the checker.
 * Runs both solutions on all testsets, then compares outputs with the checker.
 * Validates that the solution behaves according to its expected type (TLE, WA, etc.).
 * Note: Solutions and checker must be compiled before calling this function.
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
    const testsets = config.testsets || [];

    if (testsets.length === 0) {
      throw new Error('No testsets defined in configuration');
    }

    ensureMainSolutionExists(solutions);
    ensureSolutionExists(solutions, solutionName);
    ensureCheckerExists(checker);

    const mainSolution = getMainSolution(solutions);
    const solution = solutions.find(s => s.name === solutionName)!;

    fmt.info(
      `  ${fmt.infoIcon()} Main solution: ${fmt.primary(mainSolution.name)} ${fmt.dim(`(${mainSolution.tag})`)}`
    );
    fmt.info(
      `  ${fmt.infoIcon()} Target solution: ${fmt.highlight(solutionName)} ${fmt.dim(`(${solution.tag})`)}`
    );
    console.log();

    fmt.log(
      `  ${fmt.dim('→')} Running main solution ${fmt.dim('(generating outputs...)')}`
    );
    try {
      await runSolutionOnAllTestsets(mainSolution, config, testsets);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const newErrorMessage = `Failed to run ${fmt.bold('Main Solution')}: \n\t${message}`;
      throwError(new Error(newErrorMessage));
    }

    fmt.log(
      `  ${fmt.dim('→')} Running target solution ${fmt.dim('(generating outputs...)')}`
    );
    try {
      await runSolutionOnAllTestsets(solution, config, testsets);
    } catch {
      // @ts-nocheck
    }

    fmt.log(
      `  ${fmt.dim('→')} Comparing with checker ${fmt.dim('(validating verdicts...)')}`
    );
    try {
      await startTheComparisonProcess(
        checker,
        mainSolution,
        solution,
        testsets
      );
    } catch (error) {
      throwError(error, 'Comparison with checker failed');
    }
  } catch (error) {
    throwError(error, `Failed to test solution "${solutionName}"`);
  }
}

/**
 * Ensures a main-correct solution exists in the configuration.
 * Type assertion function that throws if no MA (main correct) solution found.
 *
 * @param {LocalSolution[] | undefined} solutions - Solutions array to validate
 *
 * @throws {Error} If no solutions are defined
 * @throws {Error} If no MA (main correct) solution exists
 *
 * @example
 * const config = readConfigFile();
 * ensureMainSolutionExists(config.solutions);
 */
export function ensureMainSolutionExists(
  solutions: LocalSolution[] | undefined
): asserts solutions is LocalSolution[] {
  if (!solutions || solutions.length === 0) {
    throw new Error('No solutions defined in the configuration file.');
  }

  for (const solution of solutions) {
    if (solution.tag === 'MA') {
      return;
    }
  }

  throw new Error(
    'No solution with tag "MA" (main correct) found in the configuration file.'
  );
}

/**
 * Ensures a specific solution exists in the configuration.
 * Type assertion function that throws if solution not found.
 *
 * @param {LocalSolution[] | undefined} solutions - Solutions array to validate
 * @param {string} solutionName - Name of solution to find
 *
 * @throws {Error} If no solutions are defined
 * @throws {Error} If solution with given name doesn't exist
 *
 * @example
 * ensureSolutionExists(config.solutions, 'wa-solution');
 */
export function ensureSolutionExists(
  solutions: LocalSolution[] | undefined,
  solutionName: string
): asserts solutions is LocalSolution[] {
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
 * Gets the MA (main correct) solution from solutions array.
 *
 * @param {LocalSolution[]} solutions - Array of solution configurations
 * @returns {LocalSolution} The MA (main correct) solution
 *
 * @throws {Error} If no MA solution found (should never happen if ensureMainSolutionExists called first)
 *
 * @example
 * const mainSolution = getMainSolution(config.solutions);
 * // Returns: { name: 'main', source: 'Solution.cpp', tag: 'MA' }
 */
export function getMainSolution(solutions: LocalSolution[]): LocalSolution {
  for (const solution of solutions) {
    if (solution.tag === 'MA') {
      return solution;
    }
  }
  // tell ts that this line is never reached
  throw new Error('Main correct solution (tag "MA") not found.');
}

/**
 * Compares target solution outputs against main solution using checker.
 * Runs checker on all test cases in all testsets and tracks verdicts (WA, TLE, MLE, RTE).
 * Validates that verdicts match the target solution's expected tag.
 * Note: Checker must be compiled before calling this function.
 *
 * @param {LocalChecker} checker - Checker configuration
 * @param {LocalSolution} mainSolution - Main correct solution
 * @param {LocalSolution} targetSolution - Solution to validate
 * @param {LocalTestset[]} testsets - Array of testsets to check
 *
 * @throws {Error} If verdict validation fails
 * @throws {Error} If main solution has unexpected errors
 *
 * @example
 * // From fullVerification and testSolutionAgainstMainCorrect
 * await startTheComparisonProcess(
 *   config.checker,
 *   mainSolution,
 *   waSolution,
 *   config.testsets
 * );
 */
export async function startTheComparisonProcess(
  checker: LocalChecker,
  mainSolution: LocalSolution,
  targetSolution: LocalSolution,
  testsets: LocalTestset[]
) {
  try {
    const compiledCheckerPath = getCompiledCommandToRun(checker);
    const verdictTracker = createVerdictTracker();

    for (const testset of testsets) {
      const mainOutputDir = ensureOutputDirectory(
        mainSolution.name,
        testset.name
      );
      const targetOutputDir = ensureOutputDirectory(
        targetSolution.name,
        testset.name
      );
      const testsDir = path.resolve(process.cwd(), 'testsets', testset.name);
      const testFiles = getTestFiles(testsDir);

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
        const expectedVerdict = 'OK';

        try {
          await runChecker(
            compiledCheckerPath,
            inputFilePath,
            outputFilePath,
            answerFilePath,
            expectedVerdict
          );
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          logError(`${testFile} in testset ${testset.name}: ${msg}`, 4);
          verdictTracker.didWA = true;
          break;
        }
      }
    }

    validateExpectedVerdicts(targetSolution, verdictTracker);
  } catch (error) {
    throwError(error, 'Error during solution comparison process');
  } finally {
    await executor.cleanup();
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
 * Validates target solution output against expected solution tag.
 * Updates verdict tracker and throws if behavior doesn't match tag.
 *
 * @private
 * @param {string} firstLine - First line of output file
 * @param {VerdictTracker} verdictTracker - Verdict tracking object
 *
 * @example
 * // For TL solution
 * validateTargetSolutionOutput('Time Limit Exceeded', tracker);
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
 * Validates that observed verdicts match expected solution tag.
 * Ensures solutions behave according to their declared tag (TL, ML, WA, RJ, etc.).
 *
 * @private
 * @param {LocalSolution} targetSolution - Target solution configuration
 * @param {VerdictTracker} verdictTracker - Verdict tracking object
 *
 * @throws {Error} If TLE observed but solution not marked with TL/TO tag
 * @throws {Error} If MLE observed but solution not marked with ML tag
 * @throws {Error} If RTE observed but solution not marked with RE/RJ tag
 * @throws {Error} If WA observed but solution not marked with WA/RJ tag
 * @throws {Error} If no errors but solution marked as RJ
 * @throws {Error} If TL solution didn't timeout on any test
 * @throws {Error} If ML solution didn't exceed memory on any test
 *
 * @example
 * // For TL solution that timed out
 * validateExpectedVerdicts(tlSolution, { didTLE: true, ... }); // OK
 *
 * @example
 * // For TL solution that didn't timeout
 * validateExpectedVerdicts(tlSolution, { didTLE: false, ... }); // Throws
 */
function validateExpectedVerdicts(
  targetSolution: LocalSolution,
  verdictTracker: VerdictTracker
) {
  if (verdictTracker.didTLE) {
    if (!isTLTag(targetSolution.tag)) {
      throw new Error(
        `Solution ${fmt.highlight(targetSolution.name)} marked as ${fmt.highlight(targetSolution.tag)} but got ${fmt.bold('Time Limit Exceeded')} on some tests`
      );
    }
  }
  if (verdictTracker.didMLE) {
    if (!isMLTag(targetSolution.tag)) {
      throw new Error(
        `Solution ${fmt.highlight(targetSolution.name)} marked as ${fmt.highlight(targetSolution.tag)} but got ${fmt.bold('Memory Limit Exceeded')} on some tests`
      );
    }
  }

  if (verdictTracker.didRTE) {
    if (!isRTETag(targetSolution.tag)) {
      throw new Error(
        `Solution ${fmt.highlight(targetSolution.name)} marked as ${fmt.highlight(targetSolution.tag)} but got ${fmt.bold('Runtime Error')} on some tests`
      );
    }
  }

  if (verdictTracker.didWA) {
    if (!isWATag(targetSolution.tag)) {
      throw new Error(
        `Solution ${fmt.highlight(targetSolution.name)} marked as ${fmt.highlight(targetSolution.tag)} but got ${fmt.bold('Wrong Answer')} on some tests`
      );
    }
  }
  if (targetSolution.tag === 'TL' && !verdictTracker.didTLE) {
    throw new Error(
      `Solution ${fmt.highlight(targetSolution.name)} marked as ${fmt.highlight(targetSolution.tag)} but did not get ${fmt.bold('Time Limit Exceeded')} on any test`
    );
  }

  if (targetSolution.tag === 'ML' && !verdictTracker.didMLE) {
    throw new Error(
      `Solution ${fmt.highlight(targetSolution.name)} marked as ${fmt.highlight(targetSolution.tag)} but did not get ${fmt.bold('Memory Limit Exceeded')} on any test`
    );
  }

  if (targetSolution.tag === 'WA' && !verdictTracker.didWA) {
    throw new Error(
      `Solution ${fmt.highlight(targetSolution.name)} marked as ${fmt.highlight(targetSolution.tag)} but did not get ${fmt.bold('Wrong Answer')} on any test`
    );
  }
  if (
    targetSolution.tag === 'RJ' &&
    !verdictTracker.didTLE &&
    !verdictTracker.didMLE &&
    !verdictTracker.didRTE &&
    !verdictTracker.didWA
  ) {
    throw new Error(
      `Solution ${fmt.highlight(targetSolution.name)} marked as ${fmt.highlight(targetSolution.tag)} but passed all tests correctly`
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
 * Checks if solution tag allows TLE verdict.
 *
 * @private
 * @param {import('../types').SolutionTag} tag - Solution tag to check
 * @returns {boolean} True if TLE is valid for this tag
 *
 * @example
 * isTLTag('TL') // returns true
 * isTLTag('TO') // returns true (TLE or OK)
 * isTLTag('MA') // returns false
 */
function isTLTag(tag: import('../types').SolutionTag): boolean {
  // TL: Time Limit Exceeded
  // TO: Time Limit or Accepted (may TLE but correct)
  // RJ: Rejected (any error including TLE)
  return tag === 'TL' || tag === 'TO' || tag === 'RJ';
}

/**
 * Checks if solution tag allows MLE verdict.
 *
 * @private
 * @param {import('../types').SolutionTag} tag - Solution tag to check
 * @returns {boolean} True if MLE is valid for this tag
 *
 * @example
 * isMLTag('ML') // returns true
 * isMLTag('RJ') // returns true (any rejection)
 * isMLTag('WA') // returns false
 */
function isMLTag(tag: import('../types').SolutionTag): boolean {
  // ML: Memory Limit Exceeded
  // RJ: Rejected (any error including MLE)
  return tag === 'ML' || tag === 'RJ';
}

/**
 * Checks if solution tag allows RTE verdict.
 *
 * @private
 * @param {import('../types').SolutionTag} tag - Solution tag to check
 * @returns {boolean} True if RTE is valid for this tag
 *
 * @example
 * isRTETag('RE') // returns true
 * isRTETag('RJ') // returns true (any rejection)
 * isRTETag('MA') // returns false
 */
function isRTETag(tag: import('../types').SolutionTag): boolean {
  // RE: Runtime Error
  // RJ: Rejected (any error including RTE)
  return tag === 'RE' || tag === 'RJ';
}

/**
 * Checks if solution tag allows WA verdict.
 *
 * @private
 * @param {import('../types').SolutionTag} tag - Solution tag to check
 * @returns {boolean} True if WA is valid for this tag
 *
 * @example
 * isWATag('WA') // returns true
 * isWATag('RJ') // returns true (any rejection)
 * isWATag('MA') // returns false
 */
function isWATag(tag: import('../types').SolutionTag): boolean {
  // WA: Wrong Answer
  // PE: Presentation Error (also wrong)
  // RJ: Rejected (any error including WA)
  return tag === 'WA' || tag === 'PE' || tag === 'RJ';
}
