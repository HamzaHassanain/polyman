/**
 * @fileoverview Action functions for CLI commands.
 * Implements high-level workflows for problem template creation, test generation,
 * validation, solution execution, and full problem verification.
 * Each action corresponds to a CLI command and orchestrates multiple helper functions.
 */

import {
  ensureValidatorExists,
  validateSingleTest,
  validateTestset,
  validateGroup,
  validateAllTestsets,
  testValidatorItself,
} from './helpers/validator';

import {
  logTemplateCreationSuccess,
  copyTemplate,
} from './helpers/create-template';

import { ensureGeneratorsExist } from './helpers/generator';
import {
  ensureTestsetsExist,
  findTestset,
  generateTestsForTestset,
  generateSingleTest,
  generateTestsForGroup,
  generateAllTestsets,
  listTestsets,
} from './helpers/testset';

import {
  validateSolutionsExist,
  testSolutionAgainstMainCorrect,
  ensureMainSolutionExists,
  getMainSolution,
  startTheComparisonProcess,
  runSolutionOnSingleTest,
  runSolutionOnTestset,
  runSolutionOnGroup,
  runSolutionOnAllTestsets,
  findMatchingSolutions,
} from './helpers/solution';

import { testCheckerItself } from './helpers/checker';

import {
  readConfigFile,
  isNumeric,
  // logErrorAndExit,
  // API_KEY_LOCATION,
  // SECRET_KEY_LOCATION,
} from './helpers/utils';

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
 * Validates test input files using the validator program.
 * Supports validation by testset, group, or single test.
 *
 * @param {string} target - Target specification (testset name or 'all')
 * @param {string} [modifier] - Optional modifier (group name or test index)
 *
 * @throws {Error} If Config.json is invalid or missing validator
 * @throws {Error} If validator compilation fails
 * @throws {Error} If validator rejects any test
 *
 * @example
 * // From CLI: polyman validate all
 * await validateTestsAction('all');
 * // Validates all testsets
 *
 * @example
 * // From CLI: polyman validate tests
 * await validateTestsAction('tests');
 * // Validates testset named 'tests'
 *
 * @example
 * // From CLI: polyman validate tests samples
 * await validateTestsAction('tests', 'samples');
 * // Validates group 'samples' in testset 'tests'
 *
 * @example
 * // From CLI: polyman validate tests 5
 * await validateTestsAction('tests', '5');
 * // Validates test 5 in testset 'tests'
 */
export const validateTestsAction = async (
  target: string,
  modifier?: string
) => {
  try {
    const config = readConfigFile();
    ensureValidatorExists(config.validator);
    ensureTestsetsExist(config.testsets);

    let stepNum = 1;

    if (target === 'all') {
      // Validate all testsets
      fmt.section('✅ VALIDATING ALL TESTSETS');

      fmt.step(stepNum++, 'Validating Configuration');
      fmt.info(
        `  ${fmt.infoIcon()} Validator: ${fmt.highlight(config.validator.source)} ${fmt.dim('(C++)')}`
      );
      fmt.info(
        `  ${fmt.infoIcon()} Testsets: ${fmt.highlight(config.testsets.length.toString())}`
      );
      fmt.stepComplete('Configuration validated');

      fmt.step(stepNum++, 'Validating All Testsets');
      await validateAllTestsets(config.validator, config.testsets);
      fmt.stepComplete('All testsets validated');

      fmt.successBox('ALL TESTSETS PASSED VALIDATION!');
    } else {
      // Find the testset
      const testset = findTestset(config.testsets, target);

      if (modifier && isNumeric(modifier)) {
        // Validate single test
        const testIndex = parseInt(modifier, 10);
        fmt.section(
          `✅ VALIDATING TEST ${testIndex} IN TESTSET: ${target.toUpperCase()}`
        );

        fmt.step(stepNum++, 'Validating Configuration');
        fmt.info(`  ${fmt.infoIcon()} Testset: ${fmt.highlight(testset.name)}`);
        fmt.info(`  ${fmt.infoIcon()} Test index: ${fmt.highlight(modifier)}`);
        fmt.stepComplete('Configuration validated');

        fmt.step(stepNum++, `Validating Test ${testIndex}`);
        await validateSingleTest(config.validator, testset.name, testIndex);
        fmt.stepComplete(`Test ${testIndex} validated`);

        fmt.successBox(
          `TEST ${testIndex} IN ${target.toUpperCase()} PASSED VALIDATION!`
        );
      } else if (modifier) {
        // Validate group
        fmt.section(
          `✅ VALIDATING GROUP '${modifier}' IN TESTSET: ${target.toUpperCase()}`
        );

        fmt.step(stepNum++, 'Validating Configuration');
        fmt.info(`  ${fmt.infoIcon()} Testset: ${fmt.highlight(testset.name)}`);
        fmt.info(`  ${fmt.infoIcon()} Group: ${fmt.highlight(modifier)}`);
        fmt.stepComplete('Configuration validated');

        fmt.step(stepNum++, `Validating Group '${modifier}'`);
        await validateGroup(config.validator, testset, modifier);
        fmt.stepComplete(`Group '${modifier}' validated`);

        fmt.successBox(
          `GROUP '${modifier}' IN ${target.toUpperCase()} PASSED VALIDATION!`
        );
      } else {
        // Validate entire testset
        fmt.section(`✅ VALIDATING TESTSET: ${target.toUpperCase()}`);

        fmt.step(stepNum++, 'Validating Configuration');
        fmt.info(`  ${fmt.infoIcon()} Testset: ${fmt.highlight(testset.name)}`);
        fmt.stepComplete('Configuration validated');

        fmt.step(stepNum++, 'Validating Tests');
        await validateTestset(config.validator, testset.name);
        fmt.stepComplete('Tests validated');

        fmt.successBox(`TESTSET ${target.toUpperCase()} PASSED VALIDATION!`);
      }
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
 * Runs solution programs on test inputs based on testset/group/test specification.
 * Executes solution with time and memory limits from Config.json.
 * Saves outputs to solutions-outputs/<solution-name>/<testset>/ directory.
 *
 * @param {string} solutionName - Name of solution to run, or 'all' for all solutions
 * @param {string} target - Target specification (testset name or 'all')
 * @param {string} [modifier] - Optional modifier (group name or test index)
 *
 * @throws {Error} If Config.json is invalid or missing solutions
 * @throws {Error} If no solution matches the name
 * @throws {Error} If solution compilation fails
 * @throws {Error} If solution execution fails
 *
 * @example
 * // From CLI: polyman run-solution main all
 * await runSolutionAction('main', 'all');
 * // Runs main solution on all testsets
 *
 * @example
 * // From CLI: polyman run-solution main tests
 * await runSolutionAction('main', 'tests');
 * // Runs main solution on testset 'tests'
 *
 * @example
 * // From CLI: polyman run-solution main tests samples
 * await runSolutionAction('main', 'tests', 'samples');
 * // Runs main solution on group 'samples' in testset 'tests'
 *
 * @example
 * // From CLI: polyman run-solution main tests 5
 * await runSolutionAction('main', 'tests', '5');
 * // Runs main solution on test 5 in testset 'tests'
 */
export const runSolutionAction = async (
  solutionName: string,
  target: string,
  modifier?: string
) => {
  try {
    const config = readConfigFile();
    validateSolutionsExist(config.solutions);
    ensureTestsetsExist(config.testsets);

    const matchingSolutions = findMatchingSolutions(
      config.solutions,
      solutionName
    );

    let stepNum = 1;

    if (target === 'all') {
      // Run on all testsets
      fmt.section(`🚀 RUNNING ${solutionName.toUpperCase()} ON ALL TESTSETS`);

      fmt.step(stepNum++, 'Validating Configuration');
      fmt.info(
        `  ${fmt.infoIcon()} Solutions: ${fmt.highlight(matchingSolutions.length.toString())}`
      );
      fmt.info(
        `  ${fmt.infoIcon()} Testsets: ${fmt.highlight(config.testsets.length.toString())}`
      );
      fmt.stepComplete('Configuration validated');

      fmt.step(stepNum++, 'Running Solutions on All Testsets');
      for (const solution of matchingSolutions) {
        await runSolutionOnAllTestsets(solution, config, config.testsets);
      }
      fmt.stepComplete('All solutions completed');

      fmt.successBox(`${solutionName.toUpperCase()} RAN ON ALL TESTSETS!`);
    } else {
      // Find the testset
      const testset = findTestset(config.testsets, target);

      if (!modifier) {
        // Run on entire testset
        fmt.section(
          `🚀 RUNNING ${solutionName.toUpperCase()} ON TESTSET: ${testset.name.toUpperCase()}`
        );

        fmt.step(stepNum++, 'Validating Configuration');
        fmt.info(
          `  ${fmt.infoIcon()} Solutions: ${fmt.highlight(matchingSolutions.length.toString())}`
        );
        fmt.info(`  ${fmt.infoIcon()} Testset: ${fmt.highlight(testset.name)}`);
        fmt.stepComplete('Configuration validated');

        fmt.step(stepNum++, `Running Solutions on Testset ${testset.name}`);
        for (const solution of matchingSolutions) {
          await runSolutionOnTestset(solution, config, testset.name);
        }
        fmt.stepComplete('Solutions completed');

        fmt.successBox(
          `${solutionName.toUpperCase()} RAN ON TESTSET ${testset.name.toUpperCase()}!`
        );
      } else if (isNumeric(modifier)) {
        // Run on specific test
        const testIndex = parseInt(modifier, 10);
        fmt.section(
          `🚀 RUNNING ${solutionName.toUpperCase()} ON TEST ${testIndex} IN ${testset.name.toUpperCase()}`
        );

        fmt.step(stepNum++, 'Validating Configuration');
        fmt.info(
          `  ${fmt.infoIcon()} Solutions: ${fmt.highlight(matchingSolutions.length.toString())}`
        );
        fmt.info(`  ${fmt.infoIcon()} Testset: ${fmt.highlight(testset.name)}`);
        fmt.info(
          `  ${fmt.infoIcon()} Test: ${fmt.highlight(testIndex.toString())}`
        );
        fmt.stepComplete('Configuration validated');

        fmt.step(stepNum++, `Running Solutions on Test ${testIndex}`);
        for (const solution of matchingSolutions) {
          await runSolutionOnSingleTest(
            solution,
            config,
            testset.name,
            testIndex
          );
        }
        fmt.stepComplete('Solutions completed');

        fmt.successBox(
          `${solutionName.toUpperCase()} RAN ON TEST ${testIndex}!`
        );
      } else {
        // Run on specific group
        const groupName = modifier;
        fmt.section(
          `🚀 RUNNING ${solutionName.toUpperCase()} ON GROUP: ${groupName.toUpperCase()} IN ${testset.name.toUpperCase()}`
        );

        fmt.step(stepNum++, 'Validating Configuration');
        fmt.info(
          `  ${fmt.infoIcon()} Solutions: ${fmt.highlight(matchingSolutions.length.toString())}`
        );
        fmt.info(`  ${fmt.infoIcon()} Testset: ${fmt.highlight(testset.name)}`);
        fmt.info(`  ${fmt.infoIcon()} Group: ${fmt.highlight(groupName)}`);
        fmt.stepComplete('Configuration validated');

        fmt.step(stepNum++, `Running Solutions on Group ${groupName}`);
        for (const solution of matchingSolutions) {
          await runSolutionOnGroup(solution, config, testset, groupName);
        }
        fmt.stepComplete('Solutions completed');

        fmt.successBox(
          `${solutionName.toUpperCase()} RAN ON GROUP ${groupName.toUpperCase()}!`
        );
      }
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
          `  ${fmt.infoIcon()} Main solution: ${fmt.primary(mainSolution.name)} ${fmt.dim(`(${mainSolution.tag})`)}`
        );
        fmt.info(
          `  ${fmt.infoIcon()} Target solution: ${fmt.highlight(targetSolution.name)} ${fmt.dim(`(${targetSolution.tag})`)}`
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
    ensureTestsetsExist(config.testsets);
    fmt.info(
      `  ${fmt.infoIcon()} Found ${fmt.highlight(config.generators.length.toString())} generator(s)`
    );
    fmt.info(
      `  ${fmt.infoIcon()} Found ${fmt.highlight(config.testsets.length.toString())} testset(s)`
    );
    await generateAllTestsets(config.testsets, config.generators);
    fmt.stepComplete('All tests generated successfully');

    // Validate Tests - Validator Self-Test
    fmt.step(stepNum++, 'Testing Validator');
    await testValidatorItself();
    fmt.stepComplete('Validator tests passed');

    // Validate Generated Tests
    fmt.step(stepNum++, 'Validating Generated Tests');
    await validateAllTestsets(config.validator, config.testsets);
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
      `  ${fmt.infoIcon()} Main solution: ${fmt.primary(mainSolution.name)} ${fmt.dim(`(${mainSolution.tag})`)}`
    );
    await runSolutionOnAllTestsets(mainSolution, config, config.testsets);

    try {
      for (const solution of otherSolutions) {
        await runSolutionOnAllTestsets(solution, config, config.testsets);
      }
      fmt.stepComplete('All solutions ran on all testsets');
    } catch {
      fmt.stepComplete('Some solutions failed on tests (may be expected)');
    }

    // Validate Solutions Against Main Correct
    fmt.step(stepNum++, 'Verifying Solutions Against Main Correct');

    for (const solution of otherSolutions) {
      fmt.log(
        `    ${fmt.dim('→')} Checking ${fmt.highlight(solution.name)} ${fmt.dim(`(${solution.tag})`)}`
      );
      await startTheComparisonProcess(
        config.checker,
        mainSolution,
        solution,
        config.testsets
      );
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

/**
 * Lists all available testsets in the configuration.
 * Shows testset names, number of tests, and groups.
 *
 * @returns {Promise<void>} Resolves when listing completes
 *
 * @throws {Error} If Config.json is invalid or missing testsets
 *
 * @example
 * // From CLI: polyman list-testsets
 * await listTestsetsAction();
 * // Displays:
 * //   1. tests: 15 tests, groups: samples, main
 * //   2. stress: 100 tests, groups: none
 */
export const listTestsetsAction = () => {
  fmt.section('📋 AVAILABLE TESTSETS');

  try {
    const config = readConfigFile();
    ensureTestsetsExist(config.testsets);

    const descriptions = listTestsets(config.testsets);

    fmt.info(
      `  ${fmt.infoIcon()} Found ${fmt.highlight(config.testsets.length.toString())} testset(s)`
    );
    console.log();

    for (const [index, description] of descriptions.entries()) {
      fmt.log(
        `  ${fmt.primary((index + 1).toString().padStart(2, ' ') + '.')} ${description}`
      );
    }

    console.log();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fmt.errorBox('FAILED TO LIST TESTSETS!');
    fmt.error(`${message}`);
    console.log();
    process.exit(1);
  }
};

/**
 * Generates tests based on testset/group/test specification.
 * Supports: all testsets, single testset, single group, or single test.
 *
 * @param {string} target - Target specification (testset name, group, or test index)
 * @param {string} [modifier] - Optional modifier (group name or test index)
 *
 * @throws {Error} If Config.json is invalid
 * @throws {Error} If testset/group/test not found
 * @throws {Error} If test generation fails
 *
 * @example
 * // From CLI: polyman generate all
 * await generateTestsAction('all');
 * // Generates all testsets
 *
 * @example
 * // From CLI: polyman generate tests
 * await generateTestsAction('tests');
 * // Generates testset named 'tests'
 *
 * @example
 * // From CLI: polyman generate tests samples
 * await generateTestsAction('tests', 'samples');
 * // Generates group 'samples' in testset 'tests'
 *
 * @example
 * // From CLI: polyman generate tests 5
 * await generateTestsAction('tests', '5');
 * // Generates test 5 in testset 'tests'
 */
export const generateTestsAction = async (
  target: string,
  modifier?: string
) => {
  try {
    const config = readConfigFile();
    ensureTestsetsExist(config.testsets);
    ensureGeneratorsExist(config.generators);

    let stepNum = 1;

    if (target === 'all') {
      // Generate all testsets
      fmt.section('⚙️  GENERATING ALL TESTSETS');

      fmt.step(stepNum++, 'Validating Configuration');
      fmt.info(
        `  ${fmt.infoIcon()} Testsets: ${fmt.highlight(config.testsets.length.toString())}`
      );
      fmt.info(
        `  ${fmt.infoIcon()} Generators: ${fmt.highlight(config.generators.length.toString())}`
      );
      fmt.stepComplete('Configuration validated');

      fmt.step(stepNum++, 'Generating Tests for All Testsets');
      await generateAllTestsets(config.testsets, config.generators);
      fmt.stepComplete('All testsets generated');

      fmt.successBox('ALL TESTSETS GENERATED!');
    } else {
      // Find the testset
      const testset = findTestset(config.testsets, target);

      if (modifier && isNumeric(modifier)) {
        // Generate single test
        const testIndex = parseInt(modifier, 10);
        fmt.section(
          `⚙️  GENERATING TEST ${testIndex} IN TESTSET: ${target.toUpperCase()}`
        );

        fmt.step(stepNum++, 'Validating Configuration');
        fmt.info(`  ${fmt.infoIcon()} Testset: ${fmt.highlight(testset.name)}`);
        fmt.info(`  ${fmt.infoIcon()} Test index: ${fmt.highlight(modifier)}`);
        fmt.stepComplete('Configuration validated');

        fmt.step(stepNum++, `Generating Test ${testIndex}`);
        await generateSingleTest(testset, testIndex, config.generators);
        fmt.stepComplete(`Test ${testIndex} generated`);

        fmt.successBox(
          `TEST ${testIndex} GENERATED IN ${target.toUpperCase()}!`
        );
      } else if (modifier) {
        // Generate group
        fmt.section(
          `⚙️  GENERATING GROUP '${modifier}' IN TESTSET: ${target.toUpperCase()}`
        );

        fmt.step(stepNum++, 'Validating Configuration');
        fmt.info(`  ${fmt.infoIcon()} Testset: ${fmt.highlight(testset.name)}`);
        fmt.info(`  ${fmt.infoIcon()} Group: ${fmt.highlight(modifier)}`);
        fmt.stepComplete('Configuration validated');

        fmt.step(stepNum++, `Generating Group '${modifier}'`);
        await generateTestsForGroup(testset, modifier, config.generators);
        fmt.stepComplete(`Group '${modifier}' generated`);

        fmt.successBox(
          `GROUP '${modifier}' GENERATED IN ${target.toUpperCase()}!`
        );
      } else {
        // Generate entire testset
        fmt.section(`⚙️  GENERATING TESTSET: ${target.toUpperCase()}`);

        fmt.step(stepNum++, 'Validating Configuration');
        fmt.info(`  ${fmt.infoIcon()} Testset: ${fmt.highlight(testset.name)}`);
        fmt.stepComplete('Configuration validated');

        fmt.step(stepNum++, 'Generating Tests');
        await generateTestsForTestset(testset, config.generators);
        fmt.stepComplete('Tests generated');

        fmt.successBox(`TESTSET ${target.toUpperCase()} GENERATED!`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fmt.errorBox('TEST GENERATION FAILED!');
    fmt.error(`${message}`);
    console.log();
    process.exit(1);
  }
};

// export const registerApiKeyAndSecret = async (
//   apiKey: string,
//   secret: string
// ) => {
//   try {
//   } catch (error) {
//     logErrorAndExit(error);
//   }
// };
