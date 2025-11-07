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
} from './helpers/solution';

import { testCheckerItself } from './helpers/checker';

import { readConfigFile, isNumeric } from './helpers/utils';

import { downloadFile } from './helpers/testlib-download';

import { fmt } from './formatter';

import path from 'path';
import fs from 'fs';

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
    await runMatchingSolutionsOnTests(config.solutions, 'all', config);
    fmt.stepComplete('All solutions ran successfully');

    // Validate Solutions Against Main Correct
    fmt.step(stepNum++, 'Verifying Solutions Against Main Correct');
    const mainSolution = getMainSolution(config.solutions);
    const otherSolutions = config.solutions.filter(
      s => s.name !== mainSolution.name
    );
    fmt.info(
      `  ${fmt.infoIcon()} Main solution: ${fmt.primary(mainSolution.name)} ${fmt.dim(`(${mainSolution.type})`)}`
    );

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
