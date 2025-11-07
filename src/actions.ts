/**
 * @fileoverview Action functions for CLI commands.
 * Implements high-level workflows for problem template creation, test generation,
 * validation, solution execution, and full problem verification.
 * Each action corresponds to a CLI command and orchestrates multiple helper functions.
 */

import {
  ensureValidatorExists,
  validateAllTests,
  validateSingleTest,
  testValidatorItself,
} from './helpers/validator';

import {
  logTemplateCreationSuccess,
  copyTemplate,
} from './helpers/create-template';

import {
  ensureGeneratorsExist,
  runMatchingGenerators,
} from './helpers/generator';

import {
  validateSolutionsExist,
  testSolutionAgainstMainCorrect,
  ensureMainSolutionExists,
  getMainSolution,
  startTheComparisonProcess,
  runMatchingSolutionsOnTests,
  runSingleSolutionOnTests,
} from './helpers/solution';

import { testCheckerItself } from './helpers/checker';

import { readConfigFile, isNumeric } from './helpers/utils';

import { downloadFile } from './helpers/testlib-download';

import { fmt } from './formatter';

import path from 'path';
import fs from 'fs';

/**
 * Creates a new problem template directory with all necessary files.
 * Copies template files including Config.json, Solution.cpp, Checker.cpp,
 * Generator.cpp, Validator.cpp, and directory structure.
 *
 * @param {string} directory - Name of directory to create
 *
 * @throws {Error} If directory creation fails
 * @throws {Error} If template copying fails
 *
 * @example
 * // From CLI: polyman new my-problem
 * createTemplate('my-problem');
 * // Creates: my-problem/ with full template structure
 */
export const createTemplate = (directory: string) => {
  fmt.section('📁 CREATE NEW PROBLEM TEMPLATE');

  try {
    let stepNum = 1;

    // Create directory structure
    fmt.step(stepNum++, 'Creating Directory Structure');
    const problemDir = path.resolve(process.cwd(), directory);
    const templateDir = path.resolve(__dirname, '../template');
    fmt.info(
      `  ${fmt.infoIcon()} Target directory: ${fmt.highlight(directory)}`
    );
    fs.mkdirSync(problemDir, { recursive: true });
    fmt.stepComplete('Directory created');

    // Copy template files
    fmt.step(stepNum++, 'Copying Template Files');
    copyTemplate(templateDir, problemDir);
    fmt.stepComplete('Template files copied');

    fmt.successBox('TEMPLATE CREATED SUCCESSFULLY!');
    logTemplateCreationSuccess(directory);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fmt.errorBox('TEMPLATE CREATION FAILED!');
    fmt.error(`${message}`);
    console.log();
    process.exit(1);
  }
};

/**
 * Lists all available standard checker programs from assets/checkers directory.
 * Displays checker names and descriptions extracted from file comments.
 * Helps users choose appropriate checkers for their Config.json.
 *
 * @throws {Error} If checkers directory doesn't exist
 * @throws {Error} If reading checker files fails
 *
 * @example
 * // From CLI: polyman list-checkers
 * listAvailableCheckers();
 * // Displays:
 * //   1. acmp.cpp       → Almost-correct mode checker
 * //   2. fcmp.cpp       → Floating-point comparison
 * //   3. ncmp.cpp       → Number comparison
 * //   ... etc
 */
export const listAvailableCheckers = () => {
  fmt.section('📋 AVAILABLE CHECKERS');

  try {
    const checkersDir = path.resolve(__dirname, '../assets/checkers');

    if (!fs.existsSync(checkersDir)) {
      throw new Error('Checkers directory not found');
    }

    const files = fs.readdirSync(checkersDir);
    const checkerFiles = files.filter(
      file => file.endsWith('.cpp') && file !== 'testlib.h'
    );

    if (checkerFiles.length === 0) {
      fmt.warning(`${fmt.warningIcon()} No checker files found`);
      return;
    }

    fmt.info(
      `  ${fmt.infoIcon()} Found ${fmt.highlight(checkerFiles.length.toString())} checker(s) in ${fmt.dim('assets/checkers')}`
    );
    console.log();

    for (const [index, file] of checkerFiles.entries()) {
      const filePath = path.join(checkersDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');

      const lines = content.split('\n');
      let description = 'No description available';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('// Description:')) {
          description = trimmed.replace('// Description:', '').trim();
          break;
        }
        if (trimmed && !trimmed.startsWith('//')) {
          break;
        }
      }

      const checkerName = file;
      fmt.log(
        `  ${fmt.primary((index + 1).toString().padStart(2, ' ') + '.')} ${fmt.highlight(checkerName.padEnd(15))} ${fmt.dim('→')} ${description}`
      );
    }

    console.log();
    fmt.info(
      `  ${fmt.infoIcon()} ${fmt.dim(`Use these checkers in your Config.json file under the "checker" section, with ${fmt.highlight('custom: false')}.`)}`
    );
    console.log();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fmt.errorBox('FAILED TO LIST CHECKERS!');
    fmt.error(`${message}`);
    console.log();
    process.exit(1);
  }
};

/**
 * Downloads testlib.h from the official GitHub repository.
 * Saves the file to the current working directory and provides
 * platform-specific installation instructions for system-wide usage.
 *
 * @returns {Promise<void>} Resolves when download and save complete
 *
 * @throws {Error} If download from GitHub fails
 * @throws {Error} If file write fails
 *
 * @example
 * // From CLI: polyman download-testlib
 * await downloadTestlib();
 * // Downloads testlib.h to current directory
 * // Shows installation instructions for /usr/include or /usr/local/include
 */
export const downloadTestlib = async () => {
  fmt.section('📥 DOWNLOAD TESTLIB.H');

  try {
    let stepNum = 1;

    fmt.step(stepNum++, 'Downloading testlib.h');
    const testlibUrl =
      'https://raw.githubusercontent.com/MikeMirzayanov/testlib/master/testlib.h';
    fmt.info(
      `  ${fmt.infoIcon()} Source: ${fmt.dim('github.com/MikeMirzayanov/testlib')}`
    );

    const testlibContent = await downloadFile(testlibUrl);
    fmt.stepComplete('Downloaded successfully');

    fmt.step(stepNum++, 'Saving to Current Directory');
    const targetPath = path.join(process.cwd(), 'testlib.h');
    fs.writeFileSync(targetPath, testlibContent, 'utf-8');
    fmt.stepComplete('File saved');

    fmt.successBox('TESTLIB.H DOWNLOADED SUCCESSFULLY!');
    console.log();
    fmt.info(
      `  ${fmt.infoIcon()} ${fmt.dim('File saved to:')} ${fmt.highlight(targetPath)}`
    );
    console.log();

    // Provide installation instructions
    fmt.section('📝 INSTALLATION INSTRUCTIONS');
    console.log();
    fmt.info(
      `  ${fmt.infoIcon()} To use testlib.h system-wide, copy it to your C++ include directory:`
    );
    console.log();

    if (process.platform === 'win32') {
      fmt.log(`  ${fmt.dim('Windows (MinGW):')}
      ${fmt.primary('1.')} Find your MinGW installation directory
      ${fmt.primary('2.')} Copy testlib.h to: ${fmt.highlight('C:\\MinGW\\include\\')}
      `);
    } else {
      fmt.log(`  ${fmt.dim('Linux/Mac:')}
      ${fmt.primary('1.')} Copy to system include directory:
         ${fmt.highlight('sudo cp testlib.h /usr/include/')}
      ${fmt.primary('2.')} Or copy to local include:
         ${fmt.highlight('sudo cp testlib.h /usr/local/include/')}
      `);
    }

    console.log();
    fmt.info(
      `  ${fmt.infoIcon()} ${fmt.dim('After installation, you can use')} #include <testlib.h> ${fmt.dim('in your C++ files')}`
    );
    console.log();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fmt.errorBox('TESTLIB DOWNLOAD FAILED!');
    fmt.error(`${message}`);
    console.log();
    process.exit(1);
  }
};

/**
 * Generates test cases using specified generator or all generators.
 * Compiles generator programs and executes them to create test files.
 * Test files are saved to tests/ directory with names from generator configuration.
 *
 * @param {string} generatorName - Name of generator to run, or 'all' for all generators
 * @returns {Promise<void>} Resolves when all tests are generated
 *
 * @throws {Error} If Config.json is invalid or missing generators
 * @throws {Error} If generator compilation fails
 * @throws {Error} If generator execution fails
 * @throws {Error} If no generator matches the name
 *
 * @example
 * // From CLI: polyman run-generator gen-random
 * await generateTests('gen-random');
 * // Runs single generator
 *
 * @example
 * // From CLI: polyman run-generator all
 * await generateTests('all');
 * // Runs all generators in Config.json
 */
export const generateTests = async (generatorName: string) => {
  fmt.section('⚙️  TEST GENERATION');

  try {
    const { generators } = readConfigFile();
    let stepNum = 1;

    // Validate generators exist
    fmt.step(stepNum++, 'Validating Configuration');
    ensureGeneratorsExist(generators);
    const targetGenerators =
      generatorName === 'all'
        ? generators
        : generators.filter(g => g.name === generatorName);
    fmt.info(
      `  ${fmt.infoIcon()} Target: ${fmt.highlight(generatorName)} ${fmt.dim(`(${targetGenerators.length} generator${targetGenerators.length > 1 ? 's' : ''})`)}`
    );
    fmt.stepComplete('Configuration validated');

    // Generate tests
    fmt.step(stepNum++, 'Generating Tests');
    await runMatchingGenerators(generators, generatorName);
    fmt.stepComplete('Tests generated successfully');

    fmt.successBox(`TESTS GENERATED FOR: ${generatorName.toUpperCase()}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fmt.errorBox('TEST GENERATION FAILED!');
    fmt.error(`${message}`);
    console.log();
    process.exit(1);
  }
};

/**
 * Validates test input files using the validator program.
 * Can validate a single test by number or all tests.
 * Ensures test inputs conform to problem constraints.
 *
 * @param {string} arg - Test number or 'all' to validate all tests
 * @returns {Promise<void>} Resolves when validation completes
 *
 * @throws {Error} If Config.json is invalid or missing validator
 * @throws {Error} If validator compilation fails
 * @throws {Error} If validator rejects any test
 * @throws {Error} If arg is neither 'all' nor a valid number
 *
 * @example
 * // From CLI: polyman run-validator 5
 * await validateTests('5');
 * // Validates only test5.txt
 *
 * @example
 * // From CLI: polyman run-validator all
 * await validateTests('all');
 * // Validates all tests in tests/ directory
 */
export const validateTests = async (arg: string) => {
  fmt.section('✅ TEST VALIDATION');

  try {
    const config = readConfigFile();
    let stepNum = 1;

    // Validate configuration
    fmt.step(stepNum++, 'Validating Configuration');
    ensureValidatorExists(config.validator);
    fmt.info(
      `  ${fmt.infoIcon()} Validator: ${fmt.highlight(config.validator.source)} ${fmt.dim('(C++)')}`
    );
    fmt.stepComplete('Configuration validated');

    // Run validation
    if (arg === 'all') {
      fmt.step(stepNum++, 'Validating All Tests');
      await validateAllTests(config.validator);
      fmt.stepComplete('All tests validated');

      fmt.successBox('ALL TESTS PASSED VALIDATION!');
    } else if (isNumeric(arg)) {
      fmt.step(stepNum++, `Validating Test ${arg}`);
      await validateSingleTest(config.validator, parseInt(arg, 10));
      fmt.stepComplete(`Test ${arg} validated`);

      fmt.successBox(`TEST ${arg} PASSED VALIDATION!`);
    } else {
      throw new Error(
        `Invalid argument "${arg}" for validator. Please use "all" or a test number.`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fmt.errorBox('VALIDATION FAILED!');
    fmt.error(`${message}`);
    console.log();
    process.exit(1);
  }
};

/**
 * Runs solution programs on test inputs to generate outputs.
 * Executes solution with time and memory limits from Config.json.
 * Saves outputs to solutions-outputs/<solution-name>/ directory.
 *
 * @param {string} solutionName - Name of solution to run, or 'all' for all solutions
 * @param {string} arg - Test number or 'all' to run on all tests
 * @returns {Promise<void>} Resolves when execution completes
 *
 * @throws {Error} If Config.json is invalid or missing solutions
 * @throws {Error} If no solution matches the name
 * @throws {Error} If solution compilation fails
 * @throws {Error} If arg is neither 'all' nor a valid number
 * @throws {Error} If solution execution fails unexpectedly
 *
 * @example
 * // From CLI: polyman run-solution main all
 * await solveTests('main', 'all');
 * // Runs main solution on all tests
 *
 * @example
 * // From CLI: polyman run-solution wa-solution 3
 * await solveTests('wa-solution', '3');
 * // Runs wa-solution on test3.txt only
 */
export const solveTests = async (solutionName: string, arg: string) => {
  fmt.section(`🚀 RUNNING SOLUTION: ${solutionName.toUpperCase()}`);

  try {
    const config = readConfigFile();
    let stepNum = 1;

    // Validate configuration
    fmt.step(stepNum++, 'Validating Configuration');
    validateSolutionsExist(config.solutions);
    const matchingSolutions =
      solutionName === 'all'
        ? config.solutions
        : config.solutions.filter(s => s.name === solutionName);

    if (matchingSolutions.length === 0) {
      throw new Error(`No solution named "${solutionName}" found.`);
    }

    fmt.info(
      `  ${fmt.infoIcon()} Target: ${fmt.highlight(solutionName)} ${fmt.dim(`(${matchingSolutions.length} solution${matchingSolutions.length > 1 ? 's' : ''})`)}`
    );
    fmt.info(
      `  ${fmt.infoIcon()} Limits: ${fmt.dim(`timeout: ${config['time-limit']}ms, memory: ${config['memory-limit']}MB`)}`
    );
    fmt.stepComplete('Configuration validated');

    // Run solutions
    if (arg === 'all') {
      fmt.step(stepNum++, 'Running on All Tests');
      await runMatchingSolutionsOnTests(config.solutions, solutionName, config);
      fmt.stepComplete('All tests completed');

      fmt.successBox(`${solutionName.toUpperCase()} RAN ON ALL TESTS!`);
    } else if (isNumeric(arg)) {
      fmt.step(stepNum++, `Running on Test ${arg}`);
      await runMatchingSolutionsOnTests(
        config.solutions,
        solutionName,
        config,
        parseInt(arg, 10)
      );
      fmt.stepComplete(`Test ${arg} completed`);

      fmt.successBox(`${solutionName.toUpperCase()} RAN ON TEST ${arg}!`);
    } else {
      throw new Error(
        `Invalid argument "${arg}" for solution runner. Please use "all" or a test number.`
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fmt.errorBox('SOLUTION EXECUTION FAILED!');
    fmt.error(`${message}`);
    console.log();
    process.exit(1);
  }
};

/**
 * Tests validator, checker, or solution programs.
 * For validator/checker: Runs self-tests from their test configuration.
 * For solutions: Tests against main-correct solution using checker.
 *
 * @param {string} what - 'validator', 'checker', or solution name to test
 * @returns {Promise<void>} Resolves when testing completes
 *
 * @throws {Error} If Config.json is invalid
 * @throws {Error} If validator/checker tests fail
 * @throws {Error} If solution doesn't exist
 * @throws {Error} If main-correct solution doesn't exist
 * @throws {Error} If solution behavior doesn't match expected type
 *
 * @example
 * // From CLI: polyman test validator
 * await testWhat('validator');
 * // Runs validator self-tests from validator_tests.json
 *
 * @example
 * // From CLI: polyman test checker
 * await testWhat('checker');
 * // Runs checker self-tests from checker_tests.json
 *
 * @example
 * // From CLI: polyman test wa-solution
 * await testWhat('wa-solution');
 * // Runs wa-solution and main solution, compares with checker
 * // Validates that wa-solution gets WA on at least one test
 */
export const testWhat = async (what: string) => {
  fmt.section(`🔍 TESTING: ${what.toUpperCase()}`);

  try {
    let stepNum = 1;

    switch (what) {
      case 'validator':
        fmt.step(stepNum++, 'Running Validator Self-Tests');
        await testValidatorItself();
        fmt.stepComplete('Validator tests passed');

        fmt.successBox('VALIDATOR TESTS PASSED!');
        break;

      case 'checker':
        fmt.step(stepNum++, 'Running Checker Self-Tests');
        await testCheckerItself();
        fmt.stepComplete('Checker tests passed');

        fmt.successBox('CHECKER TESTS PASSED!');
        break;
      default: {
        // Testing a solution against main-correct
        fmt.step(stepNum++, 'Validating Configuration');
        const config = readConfigFile();
        validateSolutionsExist(config.solutions);
        ensureMainSolutionExists(config.solutions);

        const mainSolution = getMainSolution(config.solutions);
        const targetSolution = config.solutions.find(s => s.name === what);

        if (!targetSolution) {
          throw new Error(`No solution named "${what}" found.`);
        }

        fmt.info(
          `  ${fmt.infoIcon()} Main solution: ${fmt.primary(mainSolution.name)} ${fmt.dim(`(${mainSolution.type})`)}`
        );
        fmt.info(
          `  ${fmt.infoIcon()} Target solution: ${fmt.highlight(targetSolution.name)} ${fmt.dim(`(${targetSolution.type})`)}`
        );
        fmt.stepComplete('Configuration validated');

        fmt.step(stepNum++, 'Testing Solution Behavior');
        await testSolutionAgainstMainCorrect(what);
        fmt.stepComplete('Solution verified');

        fmt.successBox(`${what.toUpperCase()} BEHAVES AS EXPECTED!`);
        break;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fmt.errorBox('TESTING FAILED!');
    fmt.error(`${message}`);
    console.log();
    process.exit(1);
  }
};

/**
 * Performs complete problem verification workflow.
 * Executes all steps: test generation, validator testing, test validation,
 * checker testing, solution execution, and solution verification.
 * This is the main command for validating a complete Polygon problem package.
 *
 * Verification steps:
 * 1. Generate all tests using generators
 * 2. Run validator self-tests
 * 3. Validate all generated tests
 * 4. Run checker self-tests
 * 5. Execute all solutions on all tests
 * 6. Verify each solution behaves according to its type (TLE, WA, etc.)
 *
 * @returns {Promise<void>} Resolves when full verification completes
 *
 * @throws {Error} If Config.json is invalid
 * @throws {Error} If any verification step fails
 * @throws {Error} If generators, validator, checker, or solutions are missing
 * @throws {Error} If main-correct solution doesn't exist
 * @throws {Error} If any solution behaves unexpectedly
 *
 * @example
 * // From CLI: polyman verify
 * await fullVerification();
 * // Runs complete verification workflow:
 * // - Generates tests
 * // - Validates tests
 * // - Tests checker
 * // - Runs all solutions
 * // - Verifies all solutions against main-correct
 */
export const fullVerification = async () => {
  fmt.section('🏆 POLYGON PROBLEM VERIFICATION');

  try {
    const config = readConfigFile();
    let stepNum = 1;

    // Generate Tests
    fmt.step(stepNum++, 'Generating Tests');
    ensureGeneratorsExist(config.generators);
    fmt.info(
      `  ${fmt.infoIcon()} Found ${fmt.highlight(config.generators.length.toString())} generator(s)`
    );
    await runMatchingGenerators(config.generators, 'all');
    fmt.stepComplete('All tests generated successfully');

    // Validate Tests - Validator Self-Test
    fmt.step(stepNum++, 'Testing Validator');
    await testValidatorItself();
    fmt.stepComplete('Validator tests passed');

    // Validate Generated Tests
    fmt.step(stepNum++, 'Validating Generated Tests');
    await validateAllTests(config.validator);
    fmt.stepComplete('All generated tests are valid');

    // Checker Self-Test
    fmt.step(stepNum++, 'Testing Checker');
    await testCheckerItself();
    fmt.stepComplete('Checker tests passed');

    // Run Solutions
    fmt.step(stepNum++, 'Running Solutions');
    validateSolutionsExist(config.solutions);
    ensureMainSolutionExists(config.solutions);
    fmt.info(
      `  ${fmt.infoIcon()} Found ${fmt.highlight(config.solutions.length.toString())} solution(s)`
    );

    const mainSolution = getMainSolution(config.solutions);
    const otherSolutions = config.solutions.filter(
      s => s.name !== mainSolution.name
    );
    fmt.info(
      `  ${fmt.infoIcon()} Main solution: ${fmt.primary(mainSolution.name)} ${fmt.dim(`(${mainSolution.type})`)}`
    );
    console.log();
    await runSingleSolutionOnTests(mainSolution, config);

    try {
      await runMatchingSolutionsOnTests(otherSolutions, 'all', config);
      fmt.stepComplete('All solutions ran on all tests');
    } catch {
      fmt.stepComplete('Some solutions failed on tests (may be expected)');
    }

    // Validate Solutions Against Main Correct
    fmt.step(stepNum++, 'Verifying Solutions Against Main Correct');

    for (const solution of otherSolutions) {
      fmt.log(
        `    ${fmt.dim('→')} Checking ${fmt.highlight(solution.name)} ${fmt.dim(`(${solution.type})`)}`
      );
      await startTheComparisonProcess(config.checker, mainSolution, solution);
      fmt.success(`      ${fmt.checkmark()} Behaves as expected`);
    }
    fmt.stepComplete('All solutions verified');

    fmt.successBox('VERIFICATION COMPLETED SUCCESSFULLY!');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fmt.errorBox('VERIFICATION FAILED!');
    fmt.error(`${message}`);
    console.log();
    process.exit(1);
  }
};
