import {
  ensureValidatorExists,
  validateAllTests,
  validateSingleTest,
  testValidatorItself,
  runValidatorTests,
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
  // runSolutionsOnAllTests,
  ensureMainSolutionExists,
  getMainSolution,
  compareResultsWithChecker,
  runMatchingSolutionsOnTests,
} from './helpers/solution';

import {
  testCheckerItself,
  ensureCheckerExists,
  runCheckerTests,
} from './helpers/checker';

import { readConfigFile, isNumeric, logErrorAndExit } from './helpers/utils';

import { logger } from './logger';

import path from 'path';
import fs from 'fs';

export const createTemplate = (directory: string) => {
  logger.section('📁 CREATE NEW PROBLEM TEMPLATE');

  try {
    const problemDir = path.resolve(process.cwd(), directory);
    const templateDir = path.resolve(__dirname, '../template');

    logger.info(`Creating problem directory: ${logger.highlight(directory)}`);
    fs.mkdirSync(problemDir, { recursive: true });
    copyTemplate(templateDir, problemDir);

    logger.success('Template created successfully!');
    logTemplateCreationSuccess(directory);
  } catch (error) {
    logErrorAndExit(error);
  }
};
export const generateTests = async (generatorName: string) => {
  logger.section('⚙️  TEST GENERATION');

  try {
    const { generators } = readConfigFile();
    ensureGeneratorsExist(generators);

    await runMatchingGenerators(generators, generatorName);

    console.log();
    logger.success(
      `All tests generated successfully for: ${logger.highlight(generatorName)}`
    );
  } catch (error) {
    logErrorAndExit(error);
  }
};

export const validateTests = async (arg: string) => {
  logger.section('✅ TEST VALIDATION');

  try {
    const config = readConfigFile();
    ensureValidatorExists(config.validator);

    if (arg === 'all') {
      logger.info('Validating all tests...');
      await validateAllTests(config.validator);
      logger.success('All tests passed validation');
    } else if (isNumeric(arg)) {
      logger.info(`Validating test ${logger.highlight(arg)}...`);
      await validateSingleTest(config.validator, parseInt(arg, 10));
      logger.success(`Test ${arg} passed validation`);
    } else {
      throw new Error(
        `Invalid argument "${arg}" for validator. Please use "all" or a test number.`
      );
    }
  } catch (error) {
    logErrorAndExit(error);
  }
};
export const solveTests = async (solutionName: string, arg: string) => {
  logger.section(`🚀 RUNNING SOLUTION: ${solutionName.toUpperCase()}`);

  try {
    const config = readConfigFile();
    validateSolutionsExist(config.solutions);

    if (arg === 'all') {
      logger.info('Running on all tests...');
      await runMatchingSolutionsOnTests(config.solutions, solutionName, config);
    } else if (isNumeric(arg)) {
      logger.info(
        `Running on test ${logger.highlight(arg)} ${logger.dim(`(timeout: ${config['time-limit']}ms, memory: ${config['memory-limit']}MB)`)}`
      );
      await runMatchingSolutionsOnTests(
        config.solutions,
        solutionName,
        config,
        parseInt(arg, 10)
      );
      logger.success(`Completed test ${arg}`);
    } else {
      throw new Error(
        `Invalid argument "${arg}" for solution runner. Please use "all" or a test number.`
      );
    }
  } catch (error) {
    logErrorAndExit(error);
  }
};
export const testWhat = async (what: string) => {
  logger.section(`🔍 TESTING: ${what.toUpperCase()}`);
  try {
    switch (what) {
      case 'validator':
        logger.info('Testing validator self-tests...');
        await testValidatorItself();
        logger.success('Validator self-tests passed');
        break;
      case 'checker':
        await testCheckerItself();
        break;
      default:
        await testSolutionAgainstMainCorrect(what);
        break;
    }
  } catch (error) {
    logErrorAndExit(error);
  }
};
export const fullVerification = async () => {
  logger.section('🏆 POLYGON PROBLEM VERIFICATION');

  try {
    const config = readConfigFile();
    let stepNum = 1;

    // Generate Tests
    logger.step(stepNum++, 'Generating Tests');
    ensureGeneratorsExist(config.generators);
    logger.info(
      `Found ${logger.highlight(config.generators.length.toString())} generator(s)`
    );
    await runMatchingGenerators(config.generators, 'all');
    logger.stepComplete('All tests generated successfully');

    // Validate Tests - Validator Self-Test
    logger.step(stepNum++, 'Testing Validator');
    ensureValidatorExists(config.validator);
    await runValidatorTests(config.validator);
    logger.stepComplete('Validator tests passed');

    // Validate Generated Tests
    logger.step(stepNum++, 'Validating Generated Tests');
    await validateAllTests(config.validator);
    logger.stepComplete('All generated tests are valid');

    // Checker Self-Test
    logger.step(stepNum++, 'Testing Checker');
    ensureCheckerExists(config.checker);
    await runCheckerTests(config.checker);
    logger.stepComplete('Checker tests passed');

    // Run Solutions
    logger.step(stepNum++, 'Running Solutions');
    validateSolutionsExist(config.solutions);
    ensureMainSolutionExists(config.solutions);
    logger.info(
      `Found ${logger.highlight(config.solutions.length.toString())} solution(s)`
    );
    await runMatchingSolutionsOnTests(config.solutions, 'all', config);
    logger.stepComplete('All solutions ran successfully');

    // Validate Solutions Against Main Correct
    logger.step(stepNum++, 'Verifying Solutions Against Main Correct');
    const mainSolution = getMainSolution(config.solutions);
    const otherSolutions = config.solutions.filter(
      s => s.name !== mainSolution.name
    );
    logger.info(
      `Main solution: ${logger.primary(mainSolution.name)} ${logger.dim(`(${mainSolution.type})`)}`
    );

    for (const solution of otherSolutions) {
      logger.log(
        `  ${logger.dim('→')} Checking ${logger.highlight(solution.name)} ${logger.dim(`(${solution.type})`)}`
      );
      await compareResultsWithChecker(config.checker, mainSolution, solution);
      logger.success(`    ✓ Behaves as expected`);
    }
    logger.stepComplete('All solutions verified');

    logger.successBox('VERIFICATION COMPLETED SUCCESSFULLY!');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.errorBox('VERIFICATION FAILED!');
    logger.error(`${message}`);
    console.log();
    process.exit(1);
  }
};
