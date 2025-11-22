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
  stepReadCredentials,
  stepInitializeSDK,
  stepListProblems,
  stepDisplayProblems,
  stepGetProblemId,
  stepFetchProblemInfo,
  stepFetchStatements,
  stepFetchSolutions,
  stepFetchFiles,
  stepFetchPackages,
  stepFetchChecker,
  stepFetchValidator,
  stepFetchGenerators,
  stepFetchSampleTests,
  stepDisplayProblemView,
  stepCommitChanges,
  stepValidatePackageType,
  stepBuildPackage,
  stepCreatePulledProblemDirectory,
  stepDownloadProblemFilesAndSetUpConfig,
  stepDownloadTests,
  stepReadConfig,
  stepUpdateProblemInfo,
  stepUploadSolutions,
  stepUploadChecker,
  stepUploadValidator,
  stepUploadGenerators,
  stepUploadStatements,
  stepUploadMetadata,
  stepUploadTestsets,
  stepPromptCreateProblem,
  stepGetValidProblemName,
  stepCreateProblemOnPolygon,
  stepUpdateConfigWithProblemId,
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
 * // From CLI: polyman list checkers
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
 * // From CLI: polyman list testsets
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

/**
 * Lists all available solutions in the configuration.
 * Shows solution names, source files, and tags (MA/OK/WA/TLE/etc).
 *
 * @returns {void}
 *
 * @throws {Error} If Config.json is invalid or missing solutions
 *
 * @example
 * // From CLI: polyman list solutions
 * listSolutionsAction();
 * // Displays:
 * //   1. main       → ./solutions/acc.cpp        (MA - Main Accepted)
 * //   2. wa-sol     → ./solutions/wa.cpp         (WA - Wrong Answer)
 * //   3. tle-sol    → ./solutions/tle.py         (TL - Time Limit)
 */
export const listSolutionsAction = () => {
  fmt.section('📋 AVAILABLE SOLUTIONS');

  try {
    const config = readConfigFile();

    if (!config.solutions || config.solutions.length === 0) {
      fmt.warning(`${fmt.warningIcon()} No solutions found in Config.json`);
      console.log();
      return;
    }

    fmt.info(
      `  ${fmt.infoIcon()} Found ${fmt.highlight(config.solutions.length.toString())} solution(s)`
    );
    console.log();

    const tagDescriptions: Record<string, string> = {
      MA: 'Main Accepted',
      OK: 'Accepted',
      RJ: 'Rejected',
      WA: 'Wrong Answer',
      PE: 'Presentation Error',
      TL: 'Time Limit',
      ML: 'Memory Limit',
      RE: 'Runtime Error',
      CE: 'Compilation Error',
    };

    for (const [index, solution] of config.solutions.entries()) {
      const tagDesc = tagDescriptions[solution.tag] || solution.tag;
      const tagInfo = `(${solution.tag} - ${tagDesc})`;

      fmt.log(
        `  ${fmt.primary((index + 1).toString().padStart(2, ' ') + '.')} ${fmt.highlight(solution.name.padEnd(15))} ${fmt.dim('→')} ${solution.source.padEnd(30)} ${fmt.dim(tagInfo)}`
      );
    }

    console.log();

    // Listing complete
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fmt.errorBox('FAILED TO LIST SOLUTIONS!');
    fmt.error(`${message}`);
    console.log();
    process.exit(1);
  }
};

/**
 * Lists all available generators in the configuration.
 * Shows generator names and source files.
 *
 * @returns {void}
 *
 * @throws {Error} If Config.json is invalid or missing generators
 *
 * @example
 * // From CLI: polyman list generators
 * listGeneratorsAction();
 * // Displays:
 * //   1. gen-random    → ./generators/gen-random.cpp
 * //   2. gen-max       → ./generators/gen-max.cpp
 * //   3. gen-special   → ./generators/gen-special.py
 */
export const listGeneratorsAction = () => {
  fmt.section('📋 AVAILABLE GENERATORS');

  try {
    const config = readConfigFile();

    if (!config.generators || config.generators.length === 0) {
      fmt.warning(`${fmt.warningIcon()} No generators found in Config.json`);
      console.log();
      return;
    }

    fmt.info(
      `  ${fmt.infoIcon()} Found ${fmt.highlight(config.generators.length.toString())} generator(s)`
    );
    console.log();

    for (const [index, generator] of config.generators.entries()) {
      fmt.log(
        `  ${fmt.primary((index + 1).toString().padStart(2, ' ') + '.')} ${fmt.highlight(generator.name.padEnd(20))} ${fmt.dim('→')} ${generator.source}`
      );
    }

    console.log();

    // Listing complete
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fmt.errorBox('FAILED TO LIST GENERATORS!');
    fmt.error(`${message}`);
    console.log();
    process.exit(1);
  }
};

/**
 * Registers Polygon API credentials locally for use in remote commands.
 * Stores the API key and secret in user's home directory (~/.polyman/).
 * This data is only stored locally and used for authenticated Polygon API requests.
 *
 * @param {string} apiKey - Polygon API key from user's Polygon settings
 * @param {string} secret - Polygon API secret
 * @returns {Promise<void>} Resolves when credentials are saved
 *
 * @throws {Error} If file system operations fail
 *
 * @example
 * // From CLI: polyman register <api-key> <secret>
 * await registerApiKeyAndSecretAction('991d9b...', 'a4c7c2f...');
 * // Saves credentials to ~/.polyman/api_key and ~/.polyman/secret_key
 */
export const registerApiKeyAndSecretAction = (
  apiKey: string,
  secret: string
) => {
  fmt.section('🔐 REGISTER POLYGON API CREDENTIALS');

  try {
    const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || '';
    const polymanDir = path.join(homeDir, '.polyman');

    // Create .polyman directory if it doesn't exist
    if (!fs.existsSync(polymanDir)) {
      fs.mkdirSync(polymanDir, { recursive: true });
      fmt.info(`  ${fmt.infoIcon()} Created directory: ${polymanDir}`);
    }

    // Save API key
    const apiKeyPath = path.join(polymanDir, 'api_key');
    fs.writeFileSync(apiKeyPath, apiKey, 'utf-8');
    fmt.success(`  ${fmt.checkmark()} API key saved to: ${apiKeyPath}`);

    // Save secret
    const secretPath = path.join(polymanDir, 'secret_key');
    fs.writeFileSync(secretPath, secret, 'utf-8');
    fmt.success(`  ${fmt.checkmark()} Secret saved to: ${secretPath}`);

    console.log();
    fmt.successBox('CREDENTIALS REGISTERED SUCCESSFULLY!');
    fmt.info(
      '  You can now use remote commands like: polyman remote-list, remote-pull, remote-push'
    );
    console.log();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fmt.errorBox('REGISTRATION FAILED!');
    fmt.error(`${message}`);
    console.log();
    process.exit(1);
  }
};

/**
 * Lists all problems accessible to the authenticated user on Polygon.
 * Displays problem ID, name, owner, and access level.
 * Requires registered API credentials.
 *
 * @returns {void} Resolves when listing completes
 *
 * @throws {Error} If credentials are not registered
 * @throws {Error} If Polygon API request fails
 *
 * @param {string} [owner] - Optional owner username to filter problems
 *
 * @example
 * // From CLI: polyman remote-list
 * await remoteListProblemsAction();
 * // Displays:
 * //   1. [123456] My Problem (owner: username, access: OWNER)
 * //   2. [789012] Another Problem (owner: other, access: READ)
 *
 * @example
 * // From CLI: polyman remote-list --owner tourist
 * await remoteListProblemsAction('tourist');
 * // Displays only problems owned by 'tourist'
 */
export const remoteListProblemsAction = async (
  owner?: string
): Promise<void> => {
  fmt.section('📋 LIST POLYGON PROBLEMS');

  try {
    let stepNum = 1;

    // step 1: Read API credentials
    const credentials = stepReadCredentials(stepNum++);

    // step 2: Initialize SDK
    const sdk = stepInitializeSDK(stepNum++, credentials);

    // step 3: List problems
    const problems = await stepListProblems(stepNum++, sdk);

    // step 4: Filter by owner if specified
    const filteredProblems = owner
      ? problems.filter(p => p.owner.toLowerCase() === owner.toLowerCase())
      : problems;

    if (owner && filteredProblems.length === 0) {
      fmt.warning(`  ⚠️  No problems found for owner: ${owner}`);
    }

    // step 5: Display problems
    stepDisplayProblems(stepNum++, filteredProblems);

    // Final success message
    fmt.successBox('PROBLEMS LISTED SUCCESSFULLY!');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fmt.errorBox('FAILED TO LIST PROBLEMS!');
    fmt.error(`${message}`);
    console.log();
    process.exit(1);
  }
};

/**
 * Pulls a problem from Polygon and saves it in Polyman's template structure.
 * Downloads all problem files including solutions, tests, checker, validator, etc.
 * If local problem exists with same ID, prompts user to merge or overwrite.
 *
 * @param {string} problemIdOrPath - Problem ID or path to directory with Config.json
 * @param {string} savePath - Directory path where problem should be saved
 * @param {object} options - Pull options for selective download
 * @returns {void} Resolves when pull completes
 *
 * @throws {Error} If credentials are not registered
 * @throws {Error} If problem not found on Polygon
 * @throws {Error} If file operations fail
 *
 * @example
 * // From CLI: polyman remote-pull 123456 ./my-problem
 * await remotePullProblemAction('123456', './my-problem');
 * // Downloads problem 123456 to ./my-problem/
 *
 * @example
 * // Pull to current directory
 * await remotePullProblemAction('.', '.');
 * // Uses problem ID from Config.json in current directory
 */
export const remotePullProblemAction = async (
  problemIdOrPath: string,
  savePath: string,
  options?: {
    all?: boolean;
    solutions?: boolean;
    checker?: boolean;
    validator?: boolean;
    generators?: boolean;
    statements?: boolean;
    tests?: string;
    metadata?: boolean;
    info?: boolean;
  }
): Promise<void> => {
  fmt.section('⬇️  PULL PROBLEM FROM POLYGON');

  try {
    let stepNum = 1;

    // Determine what to pull
    const hasSpecificOptions =
      options &&
      (options.solutions ||
        options.checker ||
        options.validator ||
        options.generators ||
        options.statements ||
        options.tests ||
        options.metadata ||
        options.info);

    const pullAll = !hasSpecificOptions || options?.all;
    const pullTests = pullAll || options?.tests;
    const pullInfo = pullAll || options?.info;

    // step 1: Read API credentials
    const credentials = stepReadCredentials(stepNum++);

    // step 2: Initialize SDK
    const sdk = stepInitializeSDK(stepNum++, credentials);

    // step 3: Get problem ID
    const problemId = stepGetProblemId(stepNum++, problemIdOrPath);

    // step 4: Fetch problem info
    if (pullInfo) {
      await stepFetchProblemInfo(stepNum++, sdk, problemId);
    }

    // step 5: Create directory structure
    stepCreatePulledProblemDirectory(stepNum++, savePath);

    // step 6: Download problem files and create Config.json
    // Note: Currently pulls all files - selective pull will be implemented in future
    await stepDownloadProblemFilesAndSetUpConfig(
      stepNum++,
      sdk,
      problemId,
      savePath
    );

    // step 7: Download test files
    if (pullTests) {
      const testsets = options!.tests;
      if (!testsets) {
        await stepDownloadTests(stepNum++, sdk, problemId, 'tests', savePath);
      } else {
        const testsetsArr = testsets.split(',');
        for (const testset of testsetsArr) {
          await stepDownloadTests(stepNum++, sdk, problemId, testset, savePath);
        }
      }
    }

    console.log();
    fmt.successBox('PROBLEM PULLED SUCCESSFULLY!');
    fmt.info(
      `  ${fmt.infoIcon()} Problem saved to: ${fmt.highlight(savePath)}`
    );
    fmt.info(
      `  ${fmt.infoIcon()} Review Config.json and update solution tags as needed`
    );
    console.log();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fmt.errorBox('FAILED TO PULL PROBLEM!');
    fmt.error(`${message}`);
    console.log();
    process.exit(1);
  }
};

/**
 * Pushes local problem to Polygon.
 * Creates new problem if Config.json doesn't contain problem ID.
 * Updates existing problem if ID is present.
 * Uploads all files including solutions, tests, checker, validator, statements.
 *
 * @param {string} problemPath - Path to problem directory with Config.json
 * @returns {void} Resolves when push completes
 *
 * @throws {Error} If credentials are not registered
 * @throws {Error} If Config.json is invalid or missing
 * @throws {Error} If Polygon API request fails
 *
 * @example
 * // From CLI: polyman remote-push ./my-problem
 * await remotePushProblemAction('./my-problem');
 * // Creates new problem or updates existing one
 */
export const remotePushProblemAction = async (
  problemPath: string,
  options?: {
    all?: boolean;
    solutions?: boolean;
    checker?: boolean;
    validator?: boolean;
    generators?: boolean;
    statements?: boolean;
    tests?: boolean;
    metadata?: boolean;
    info?: boolean;
  }
): Promise<void> => {
  fmt.section('⬆️  PUSH PROBLEM TO POLYGON');

  try {
    let stepNum = 1;

    // Determine what to push
    const hasSpecificOptions =
      options &&
      (options.solutions ||
        options.checker ||
        options.validator ||
        options.generators ||
        options.statements ||
        options.tests ||
        options.metadata ||
        options.info);

    const pushAll = !hasSpecificOptions || options?.all;
    const pushSolutions = pushAll || options?.solutions;
    const pushChecker = pushAll || options?.checker;
    const pushValidator = pushAll || options?.validator;
    const pushGenerators = pushAll || options?.generators;
    const pushStatements = pushAll || options?.statements;
    const pushTests = pushAll || options?.tests;
    const pushMetadata = pushAll || options?.metadata;
    const pushInfo = pushAll || options?.info;

    // step 1: Read API credentials
    const credentials = stepReadCredentials(stepNum++);

    // step 2: Initialize SDK
    const sdk = stepInitializeSDK(stepNum++, credentials);

    // step 3: Read Config.json
    const problemDir = path.resolve(process.cwd(), problemPath);
    const config = stepReadConfig(stepNum++, problemDir);

    // step 4: Get problem ID (or create new problem)
    let problemId = config.problemId;

    if (!problemId) {
      // Prompt user to create new problem
      const shouldProceed = await stepPromptCreateProblem(stepNum++);

      if (!shouldProceed) {
        console.log();
        fmt.info('  Push cancelled.');
        console.log();
        return;
      }

      // Validate and get problem name
      const problemName = await stepGetValidProblemName(
        stepNum++,
        sdk,
        config.name
      );

      // Create the problem on Polygon
      problemId = await stepCreateProblemOnPolygon(stepNum++, sdk, problemName);

      // Update Config.json with new problem ID and name
      stepUpdateConfigWithProblemId(
        stepNum++,
        problemDir,
        config,
        problemId,
        problemName
      );
      console.log();
    }

    // step 5: Update problem information
    if (pushInfo) {
      await stepUpdateProblemInfo(stepNum++, sdk, problemId, config);
    }

    // step 6: Upload solutions
    if (pushSolutions) {
      if (config.solutions && config.solutions.length > 0) {
        await stepUploadSolutions(
          stepNum++,
          sdk,
          problemId,
          problemDir,
          config
        );
      } else if (!pushAll) {
        fmt.error(`   ${fmt.cross()} Solutions not found in Config.json`);
      } else {
        fmt.warning(`   ${fmt.warningIcon()} No solutions to upload`);
      }
    }

    // step 7: Upload checker
    if (pushChecker) {
      if (config.checker) {
        await stepUploadChecker(stepNum++, sdk, problemId, problemDir, config);
      } else if (!pushAll) {
        fmt.error(`   ${fmt.cross()} Checker not found in Config.json`);
      } else {
        fmt.warning(`   ${fmt.warningIcon()} No checker to upload`);
      }
    }

    // step 8: Upload validator
    if (pushValidator) {
      if (config.validator) {
        await stepUploadValidator(
          stepNum++,
          sdk,
          problemId,
          problemDir,
          config
        );
      } else if (!pushAll) {
        fmt.error(`   ${fmt.cross()} Validator not found in Config.json`);
      } else {
        fmt.warning(`   ${fmt.warningIcon()} No validator to upload`);
      }
    }

    // step 9: Upload generators
    if (pushGenerators) {
      if (config.generators && config.generators.length > 0) {
        await stepUploadGenerators(
          stepNum++,
          sdk,
          problemId,
          problemDir,
          config
        );
      } else if (!pushAll) {
        fmt.error(`   ${fmt.cross()}  Generators not found in Config.json`);
      } else {
        fmt.warning(`   ${fmt.warningIcon()} No generators to upload`);
      }
    }

    // step 10: Upload statements
    if (pushStatements) {
      if (config.statements) {
        await stepUploadStatements(
          stepNum++,
          sdk,
          problemId,
          problemDir,
          config
        );
      } else if (!pushAll) {
        fmt.error(`   ${fmt.cross()}  Statements not found in Config.json`);
      } else {
        fmt.warning(`   ${fmt.warningIcon()} No statements to upload`);
      }
    }

    // step 11: Upload metadata
    if (pushMetadata) {
      await stepUploadMetadata(stepNum++, sdk, problemId, config);
    }

    // step 12: Upload testsets and tests
    if (pushTests) {
      if (config.testsets && config.testsets.length > 0) {
        await stepUploadTestsets(stepNum++, sdk, problemId, problemDir, config);
      } else if (!pushAll) {
        fmt.error(`${fmt.cross()}  Testsets not found in Config.json`);
      } else {
        fmt.warning(`${fmt.warningIcon()} No testsets to upload`);
      }
    }

    console.log();
    fmt.successBox('PROBLEM PUSHED SUCCESSFULLY!');
    fmt.info(
      `  ${fmt.infoIcon()} Problem ID: ${fmt.highlight(problemId.toString())}`
    );
    fmt.info(
      `  ${fmt.infoIcon()} Don't forget to commit your changes on Polygon using: ${fmt.highlight('polyman remote commit')}`
    );
    console.log();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fmt.errorBox('FAILED TO PUSH PROBLEM!');
    fmt.error(`${message}`);
    console.log();
    process.exit(1);
  }
};

/**
 * Displays detailed information about a Polygon problem.
 * Shows problem metadata, files, solutions, tests, and current status.
 * Can read problem ID from Config.json or accept it as argument.
 *
 * @param {string} problemIdOrPath - Problem ID or path to directory with Config.json
 * @returns {void} Resolves when view completes
 *
 * @throws {Error} If credentials are not registered
 * @throws {Error} If problem not found on Polygon
 *
 * @example
 * // From CLI: polyman remote-view 123456
 * await remoteViewProblemAction('123456');
 * // Displays problem details in formatted UI
 *
 * @example
 * // View problem in current directory
 * await remoteViewProblemAction('.');
 * // Uses problem ID from Config.json
 */
export const remoteViewProblemAction = async (
  problemIdOrPath: string
): Promise<void> => {
  fmt.section('👁️  VIEW PROBLEM ON POLYGON');

  try {
    let stepNum = 1;

    // step 1: Read API credentials
    const credentials = stepReadCredentials(stepNum++);

    // step 2: Initialize SDK
    const sdk = stepInitializeSDK(stepNum++, credentials);

    // step 3: Get problem ID
    const problemId = stepGetProblemId(stepNum++, problemIdOrPath);

    // step 4: Fetch problem info
    const info = await stepFetchProblemInfo(stepNum++, sdk, problemId);

    // step 5: Fetch statements
    const statements = await stepFetchStatements(stepNum++, sdk, problemId);

    // step 6: Fetch solutions
    const solutions = await stepFetchSolutions(stepNum++, sdk, problemId);

    // step 7: Fetch files
    const files = await stepFetchFiles(stepNum++, sdk, problemId);

    // step 8: Fetch packages
    const packages = await stepFetchPackages(stepNum++, sdk, problemId);

    // step 9: Fetch checker
    const checker = await stepFetchChecker(stepNum++, sdk, problemId);

    // step 10: Fetch validator
    const validator = await stepFetchValidator(stepNum++, sdk, problemId);

    // step 11: Identify generators from source files
    const generators = stepFetchGenerators(
      stepNum++,
      files,
      checker,
      validator
    );

    // step 12: Fetch sample tests
    const samples = await stepFetchSampleTests(stepNum++, sdk, problemId);

    // step 13: Display comprehensive view
    stepDisplayProblemView(
      stepNum++,
      info,
      statements,
      solutions,
      files,
      packages,
      checker,
      validator,
      generators,
      samples
    );

    // Final success message
    fmt.successBox('PROBLEM DETAILS RETRIEVED!');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fmt.errorBox('FAILED TO VIEW PROBLEM!');
    fmt.error(`${message}`);
    console.log();
    process.exit(1);
  }
};

/**
 * Commits local changes to Polygon problem.
 * Similar to git commit - creates new revision on Polygon.
 * Requires problem ID in Config.json or as argument.
 *
 * @param {string} problemIdOrPath - Problem ID or path to directory with Config.json
 * @param {string} commitMessage - Commit message describing changes
 * @returns {void} Resolves when commit completes
 *
 * @throws {Error} If credentials are not registered
 * @throws {Error} If problem not found or no uncommitted changes
 * @throws {Error} If Polygon API request fails
 *
 * @example
 * // From CLI: polyman remote-commit ./my-problem "Updated time limits"
 * await remoteCommitProblemAction('./my-problem', 'Updated time limits');
 * // Commits changes with message
 */
export const remoteCommitProblemAction = async (
  problemIdOrPath: string,
  commitMessage: string
): Promise<void> => {
  fmt.section('💾 COMMIT CHANGES TO POLYGON');

  try {
    let stepNum = 1;

    // step 1: Read API credentials
    const credentials = stepReadCredentials(stepNum++);

    // step 2: Initialize SDK
    const sdk = stepInitializeSDK(stepNum++, credentials);

    // step 3: Get problem ID
    const problemId = stepGetProblemId(stepNum++, problemIdOrPath);

    // step 4: Commit changes
    await stepCommitChanges(stepNum++, sdk, problemId, commitMessage);

    // Final success message
    fmt.successBox('CHANGES COMMITTED SUCCESSFULLY!');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fmt.errorBox('FAILED TO COMMIT CHANGES!');
    fmt.error(`${message}`);
    console.log();
    process.exit(1);
  }
};

/**
 * Builds and downloads problem package from Polygon.
 * Package types: 'standard' (for contests) or 'full' (complete problem data).
 * Downloaded package is saved to current directory.
 *
 * @param {string} problemIdOrPath - Problem ID or path to directory with Config.json
 * @param {string} packageType - Package type: 'standard', 'full', 'linux', 'windows'
 * @returns {void} Resolves when package is downloaded
 *
 * @throws {Error} If credentials are not registered
 * @throws {Error} If problem not found on Polygon
 * @throws {Error} If package build fails
 *
 * @example
 * // From CLI: polyman remote-package ./my-problem standard
 * await remotePackageProblemAction('./my-problem', 'standard');
 * // Builds and downloads standard package
 *
 * @example
 * // Full package with all data
 * await remotePackageProblemAction('123456', 'full');
 */
export const remotePackageProblemAction = async (
  problemIdOrPath: string,
  packageType: string
): Promise<void> => {
  fmt.section('📦 BUILD AND DOWNLOAD PACKAGE');

  try {
    let stepNum = 1;

    // step 1: Read API credentials
    const credentials = stepReadCredentials(stepNum++);

    // step 2: Initialize SDK
    const sdk = stepInitializeSDK(stepNum++, credentials);

    // step 3: Get problem ID
    const problemId = stepGetProblemId(stepNum++, problemIdOrPath);

    // step 4: Validate package type
    stepValidatePackageType(stepNum++, packageType);

    // step 5: Build package and wait for completion
    const packageInfo = await stepBuildPackage(
      stepNum++,
      sdk,
      problemId,
      packageType
    );

    console.log();
    // Final success message

    if (packageInfo.state === 'FAILED') {
      fmt.errorBox('PACKAGE BUILD FAILED!');
    } else {
      fmt.successBox('PACKAGE BUILT SUCCESSFULLY!');
    }
    fmt.info(
      `  ${fmt.infoIcon()} Package ID: ${fmt.highlight(packageInfo.id.toString())}`
    );
    fmt.info(`  ${fmt.infoIcon()} State: ${fmt.highlight(packageInfo.state)}`);
    if (packageInfo.comment) {
      fmt.info(`  ${fmt.infoIcon()} Message: ${packageInfo.comment}`);
    }
    // fmt.info(`  ${fmt.infoIcon()} You can download the package from Polygon`);
    console.log();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fmt.errorBox('PACKAGE OPERATION FAILED!');
    fmt.error(`${message}`);
    console.log();
    process.exit(1);
  }
};
