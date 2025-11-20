/**
 * @fileoverview Action functions for CLI commands.
 * Implements high-level workflows for problem template creation, test generation,
 * validation, solution execution, and full problem verification.
 * Each action corresponds to a CLI command and orchestrates multiple helper functions.
 */

import {
  stepCreateDirectoryStructure,
  stepCopyTemplateFiles,
  stepDownloadTestlib,
  stepSaveTestlibToDirectory,
  stepValidateConfigForValidator,
  stepCompileValidator,
  stepValidateAllTestsets,
  stepValidateSingleTest,
  stepValidateGroup,
  stepValidateTestset,
  stepValidateConfigForGeneration,
  stepCompileGeneratorsForTestsets,
  stepGenerateAllTestsets,
  stepCompileGeneratorsForSingleTest,
  stepGenerateSingleTest,
  stepCompileGeneratorsForGroup,
  stepGenerateTestsForGroup,
  stepCompileGeneratorsForTestset,
  stepGenerateTestsForTestset,
  stepValidateConfigForSolutions,
  stepCompileSolutions,
  stepRunSolutionsOnAllTestsets,
  stepRunSolutionsOnTestset,
  stepRunSolutionsOnTest,
  stepRunSolutionsOnGroup,
  stepValidateConfigForChecker,
  stepCompileChecker,
  stepTestChecker,
  stepValidateConfigForSolutionTest,
  stepTestSolutionBehavior,
  stepGenerateTestsForVerification,
  stepTestValidator,
  stepValidateGeneratedTests,
  stepCompileSolutionsForVerification,
  stepRunSolutionsForVerification,
  stepVerifySolutionsAgainstMainCorrect,
} from './steps';

import { logTemplateCreationSuccess } from './helpers/create-template';
import { findTestset, listTestsets } from './helpers/testset';
import { findMatchingSolutions } from './helpers/solution';
import { readConfigFile, isNumeric } from './helpers/utils';

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
 * createTemplateAction('my-problem');
 * // Creates: my-problem/ with full template structure
 */
export const createTemplateAction = (directory: string) => {
  fmt.section('📁 CREATE NEW PROBLEM TEMPLATE');

  try {
    let stepNum = 1;

    // step 1: Create directory structure
    stepCreateDirectoryStructure(stepNum++, directory);

    // step 2: Copy template files
    stepCopyTemplateFiles(stepNum++, directory);

    // Final success message
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
 * listAvailableCheckersAction();
 * // Displays:
 * //   1. acmp.cpp       → Almost-correct mode checker
 * //   2. fcmp.cpp       → Floating-point comparison
 * //   3. ncmp.cpp       → Number comparison
 * //   ... etc
 */
export const listAvailableCheckersAction = () => {
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
      `  ${fmt.infoIcon()} ${fmt.dim(`Use these checkers in your Config.json file under the "checker" section, with ${fmt.highlight('isStandard: false')}.`)}`
    );
    console.log();

    // Listing complete
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
 * await downloadTestlibAction();
 * // Downloads testlib.h to current directory
 * // Shows installation instructions for /usr/include or /usr/local/include
 */
export const downloadTestlibAction = async () => {
  fmt.section('📥 DOWNLOAD TESTLIB.H');

  try {
    let stepNum = 1;

    // step 1: Download testlib.h
    const testlibContent = await stepDownloadTestlib(stepNum++);

    // step 2: Save to current directory
    stepSaveTestlibToDirectory(stepNum++, testlibContent);

    // Final success message
    fmt.successBox('TESTLIB.H DOWNLOADED SUCCESSFULLY!');
    console.log();
    fmt.info(
      `  ${fmt.infoIcon()} ${fmt.dim('File saved to:')} ${fmt.highlight(path.join(process.cwd(), 'testlib.h'))}`
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
 * await generateTestsAction('testsets');
 * // Generates testset named 'testsets'
 *
 * @example
 * // From CLI: polyman generate tests samples
 * await generateTestsAction('testsets', 'samples');
 * // Generates group 'samples' in testset 'testsets'
 *
 * @example
 * // From CLI: polyman generate tests 5
 * await generateTestsAction('testsets', '5');
 * // Generates test 5 in testset 'testsets'
 */
export const generateTestsAction = async (
  target: string,
  modifier?: string
) => {
  try {
    const config = readConfigFile();
    let stepNum = 1;

    if (target === 'all') {
      // Generate all testsets
      fmt.section('⚙️  GENERATING ALL TESTSETS');

      // step 1: Validate configuration
      stepValidateConfigForGeneration(stepNum++, config);

      // step 2: Compile generators
      await stepCompileGeneratorsForTestsets(stepNum++, config);

      // step 3: Generate tests for all testsets
      await stepGenerateAllTestsets(stepNum++, config);

      // Final success message
      fmt.successBox('ALL TESTSETS GENERATED!');
    } else {
      // Find the testset
      const testset = findTestset(config.testsets!, target);

      if (modifier && isNumeric(modifier)) {
        // Generate single test
        const testIndex = parseInt(modifier, 10);
        fmt.section(
          `⚙️  GENERATING TEST ${testIndex} IN TESTSET: ${target.toUpperCase()}`
        );

        // step 1: Validate configuration
        stepValidateConfigForGeneration(stepNum++, config);

        // step 2: Compile generators
        await stepCompileGeneratorsForSingleTest(
          stepNum++,
          config,
          testset,
          testIndex
        );

        // step 3: Generate test
        await stepGenerateSingleTest(stepNum++, config, testset, testIndex);

        // Final success message
        fmt.successBox(
          `TEST ${testIndex} GENERATED IN ${target.toUpperCase()}!`
        );
      } else if (modifier) {
        // Generate group
        fmt.section(
          `⚙️  GENERATING GROUP '${modifier}' IN TESTSET: ${target.toUpperCase()}`
        );

        // step 1: Validate configuration
        stepValidateConfigForGeneration(stepNum++, config);

        // step 2: Compile generators
        await stepCompileGeneratorsForGroup(
          stepNum++,
          config,
          testset,
          modifier
        );

        // step 3: Generate group
        await stepGenerateTestsForGroup(stepNum++, config, testset, modifier);

        // Final success message
        fmt.successBox(
          `GROUP '${modifier}' GENERATED IN ${target.toUpperCase()}!`
        );
      } else {
        // Generate entire testset
        fmt.section(`⚙️  GENERATING TESTSET: ${target.toUpperCase()}`);

        // step 1: Validate configuration
        stepValidateConfigForGeneration(stepNum++, config);

        // step 2: Compile generators
        await stepCompileGeneratorsForTestset(stepNum++, config, testset);

        // step 3: Generate tests
        await stepGenerateTestsForTestset(stepNum++, config, testset);

        // Final success message
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
 * await validateTestsAction('testsets');
 * // Validates testset named 'testsets'
 *
 * @example
 * // From CLI: polyman validate tests samples
 * await validateTestsAction('testsets', 'samples');
 * // Validates group 'samples' in testset 'testsets'
 *
 * @example
 * // From CLI: polyman validate tests 5
 * await validateTestsAction('testsets', '5');
 * // Validates test 5 in testset 'testsets'
 */
export const validateTestsAction = async (
  target: string,
  modifier?: string
) => {
  try {
    const config = readConfigFile();
    let stepNum = 1;

    if (target === 'all') {
      // Validate all testsets
      fmt.section('✅ VALIDATING ALL TESTSETS');

      // step 1: Validate configuration
      stepValidateConfigForValidator(stepNum++, config);

      // step 2: Compile validator
      await stepCompileValidator(stepNum++, config);

      // step 3: Validate all testsets
      await stepValidateAllTestsets(stepNum++, config);

      // Final success message
      fmt.successBox('ALL TESTSETS PASSED VALIDATION!');
    } else {
      // Find the testset
      const testset = findTestset(config.testsets!, target);

      if (modifier && isNumeric(modifier)) {
        // Validate single test
        const testIndex = parseInt(modifier, 10);
        fmt.section(
          `✅ VALIDATING TEST ${testIndex} IN TESTSET: ${target.toUpperCase()}`
        );

        // step 1: Validate configuration
        stepValidateConfigForValidator(stepNum++, config);

        // step 2: compile validator
        await stepCompileValidator(stepNum++, config);

        // step 3: Validate single test
        await stepValidateSingleTest(
          stepNum++,
          config,
          testset.name,
          testIndex
        );

        fmt.successBox(
          `TEST ${testIndex} IN ${target.toUpperCase()} PASSED VALIDATION!`
        );
      } else if (modifier) {
        // Validate group
        fmt.section(
          `✅ VALIDATING GROUP '${modifier}' IN TESTSET: ${target.toUpperCase()}`
        );
        // step 1: Validate configuration
        stepValidateConfigForValidator(stepNum++, config);

        // step 2: compile validator
        await stepCompileValidator(stepNum++, config);

        // step 3: Validate group
        await stepValidateGroup(stepNum++, config, testset, modifier);

        fmt.successBox(
          `GROUP '${modifier}' IN ${target.toUpperCase()} PASSED VALIDATION!`
        );
      } else {
        // Validate entire testset
        fmt.section(`✅ VALIDATING TESTSET: ${target.toUpperCase()}`);

        // step 1: Validate configuration
        stepValidateConfigForValidator(stepNum++, config);

        // step 2: compile validator
        await stepCompileValidator(stepNum++, config);

        // step 3: Validate testset
        await stepValidateTestset(stepNum++, config, testset.name);

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
 * await runSolutionAction('main', 'testsets');
 * // Runs main solution on testset 'testsets'
 *
 * @example
 * // From CLI: polyman run-solution main tests samples
 * await runSolutionAction('main', 'testsets', 'samples');
 * // Runs main solution on group 'samples' in testset 'testsets'
 *
 * @example
 * // From CLI: polyman run-solution main tests 5
 * await runSolutionAction('main', 'testsets', '5');
 * // Runs main solution on test 5 in testset 'testsets'
 */
export const runSolutionAction = async (
  solutionName: string,
  target: string,
  modifier?: string
) => {
  try {
    const config = readConfigFile();
    const matchingSolutions = findMatchingSolutions(
      config.solutions,
      solutionName
    );

    let stepNum = 1;

    if (target === 'all') {
      // Run on all testsets
      fmt.section(`🚀 RUNNING ${solutionName.toUpperCase()} ON ALL TESTSETS`);

      // step 1: Validate configuration
      stepValidateConfigForSolutions(stepNum++, config, matchingSolutions);

      // step 2: Compile solutions
      await stepCompileSolutions(stepNum++, matchingSolutions);

      // step 3: Run solutions on all testsets
      await stepRunSolutionsOnAllTestsets(stepNum++, config, matchingSolutions);

      // Final success message
      fmt.successBox(`${solutionName.toUpperCase()} RAN ON ALL TESTSETS!`);
    } else {
      // Find the testset
      const testset = findTestset(config.testsets!, target);

      if (!modifier) {
        // Run on entire testset
        fmt.section(
          `🚀 RUNNING ${solutionName.toUpperCase()} ON TESTSET: ${testset.name.toUpperCase()}`
        );

        // step 1: Validate configuration
        stepValidateConfigForSolutions(stepNum++, config, matchingSolutions);

        // step 2: Compile solutions
        await stepCompileSolutions(stepNum++, matchingSolutions);

        // step 3: Run solutions on testset
        await stepRunSolutionsOnTestset(
          stepNum++,
          config,
          matchingSolutions,
          testset.name
        );

        // Final success message
        fmt.successBox(
          `${solutionName.toUpperCase()} RAN ON TESTSET ${testset.name.toUpperCase()}!`
        );
      } else if (isNumeric(modifier)) {
        // Run on specific test
        const testIndex = parseInt(modifier, 10);
        fmt.section(
          `🚀 RUNNING ${solutionName.toUpperCase()} ON TEST ${testIndex} IN ${testset.name.toUpperCase()}`
        );

        // step 1: Validate configuration
        stepValidateConfigForSolutions(stepNum++, config, matchingSolutions);

        // step 2: Compile solutions
        await stepCompileSolutions(stepNum++, matchingSolutions);

        // step 3: Run solutions on test
        await stepRunSolutionsOnTest(
          stepNum++,
          config,
          matchingSolutions,
          testset.name,
          testIndex
        );

        // Final success message
        fmt.successBox(
          `${solutionName.toUpperCase()} RAN ON TEST ${testIndex}!`
        );
      } else {
        // Run on specific group
        const groupName = modifier;
        fmt.section(
          `🚀 RUNNING ${solutionName.toUpperCase()} ON GROUP: ${groupName.toUpperCase()} IN ${testset.name.toUpperCase()}`
        );

        // step 1: Validate configuration
        stepValidateConfigForSolutions(stepNum++, config, matchingSolutions);

        // step 2: Compile solutions
        await stepCompileSolutions(stepNum++, matchingSolutions);

        // step 3: Run solutions on group
        await stepRunSolutionsOnGroup(
          stepNum++,
          config,
          matchingSolutions,
          testset,
          groupName
        );

        // Final success message
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
 * await testWhatAction('validator');
 * // Runs validator self-tests from validator_tests.json
 *
 * @example
 * // From CLI: polyman test checker
 * await testWhatAction('checker');
 * // Runs checker self-tests from checker_tests.json
 *
 * @example
 * // From CLI: polyman test wa-solution
 * await testWhatAction('wa-solution');
 * // Runs wa-solution and main solution, compares with checker
 * // Validates that wa-solution gets WA on at least one test
 */
export const testWhatAction = async (what: string) => {
  fmt.section(`🔍 TESTING: ${what.toUpperCase()}`);

  try {
    let stepNum = 1;

    switch (what) {
      case 'validator':
        {
          const config = readConfigFile();

          // step 1: Validate configuration
          stepValidateConfigForValidator(stepNum++, config);

          // step 2: Compile validator
          await stepCompileValidator(stepNum++, config);

          // step 3: Run validator self-tests
          await stepTestValidator(stepNum++);
        }

        fmt.successBox('VALIDATOR TESTS PASSED!');
        break;

      case 'checker':
        {
          const config = readConfigFile();

          // step 1: Validate configuration
          stepValidateConfigForChecker(stepNum++, config);

          // step 2: Compile checker
          await stepCompileChecker(stepNum++, config);

          // step 3: Run checker self-tests
          await stepTestChecker(stepNum++);
        }

        fmt.successBox('CHECKER TESTS PASSED!');
        break;
      default: {
        // Testing a solution against main-correct

        // step 1: Validate configuration
        const { mainSolution, targetSolution } =
          stepValidateConfigForSolutionTest(stepNum++, what);

        // step 2: Compile solutions
        await stepCompileSolutions(stepNum++, [mainSolution, targetSolution]);

        // step 3: Compile checker
        {
          const config = readConfigFile();
          await stepCompileChecker(stepNum++, config);
        }

        // step 4: Test solution behavior
        await stepTestSolutionBehavior(stepNum++, what);

        // Final success message
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
 * await fullVerificationAction();
 * // Runs complete verification workflow:
 * // - Generates tests
 * // - Validates tests
 * // - Tests checker
 * // - Runs all solutions
 * // - Verifies all solutions against main-correct
 */
export const fullVerificationAction = async () => {
  fmt.section('🏆 POLYGON PROBLEM VERIFICATION');

  try {
    const config = readConfigFile();
    let stepNum = 1;

    // step 1: Compile generators
    await stepCompileGeneratorsForTestsets(stepNum++, config);

    // step 2: Generate tests
    await stepGenerateTestsForVerification(stepNum++, config);

    // step 3: Compile validator
    await stepCompileValidator(stepNum++, config);

    // step 4: Test validator
    await stepTestValidator(stepNum++);

    // step 5: Validate generated tests
    await stepValidateGeneratedTests(stepNum++, config);

    // step 6: Compile checker
    await stepCompileChecker(stepNum++, config);

    // step 7: Test checker
    await stepTestChecker(stepNum++);

    // step 8: Compile solutions
    await stepCompileSolutionsForVerification(stepNum++, config);

    // step 9: Run solutions
    await stepRunSolutionsForVerification(stepNum++, config);

    // step 10: Verify solutions against main correct
    await stepVerifySolutionsAgainstMainCorrect(stepNum++, config);

    // Final success message
    fmt.successBox('🎉 FULL VERIFICATION COMPLETE!');
    console.log();
    fmt.success(
      `  ${fmt.checkmark()} All components tested and verified successfully`
    );
    console.log();
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
    const descriptions = listTestsets(config.testsets!);

    fmt.info(
      `  ${fmt.infoIcon()} Found ${fmt.highlight(config.testsets!.length.toString())} testset(s)`
    );
    console.log();

    for (const [index, description] of descriptions.entries()) {
      fmt.log(
        `  ${fmt.primary((index + 1).toString().padStart(2, ' ') + '.')} ${description}`
      );
    }

    console.log();

    // Listing complete
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fmt.errorBox('FAILED TO LIST TESTSETS!');
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
