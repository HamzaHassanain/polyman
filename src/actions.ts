import {
  copyTemplate,
  readConfigFile,
  runGenerator,
  runValidator,
  runSolution,
  runValidatorTests,
  runCheckerTests,
  compareResultsWithChecker,
} from './helpers';
import { logger } from './logger';
import type ConfigFile from './types';
import type { Generator, Validator, Solution, Checker } from './types';
import path from 'path';
import fs from 'fs';

export const createTemplate = (directory: string) => {
  logger.section('Creating problem template...');

  try {
    const problemDir = path.resolve(process.cwd(), directory);
    const templateDir = path.resolve(__dirname, '../template');

    fs.mkdirSync(problemDir, { recursive: true });
    copyTemplate(templateDir, problemDir);

    logTemplateCreationSuccess(directory);
  } catch (error) {
    handleTemplateCreationError(error);
  }
};
export const generateTests = async (generatorName: string) => {
  logger.section('Test Generation');

  try {
    const { generators } = readConfigFile();
    validateGeneratorsExist(generators);

    logger.info(`Found ${generators.length} generator(s)`);

    await runMatchingGenerators(generators, generatorName);
  } catch (error) {
    handleGenerationError(error);
  }
};
export const validateTests = async (arg: string) => {
  logger.section('Test Validation');

  try {
    const config = readConfigFile();
    ensureValidatorExists(config.validator);

    if (arg === 'all') {
      await validateAllTests(config.validator);
    } else if (isNumeric(arg)) {
      await validateSingleTest(config.validator, parseInt(arg, 10));
    } else {
      await validateGeneratorTests(config, arg);
    }
  } catch (error) {
    handleValidationError(error);
  }
};
export const solveTests = async (solutionName: string, arg: string) => {
  logger.section(`Running Solution: ${solutionName}`);

  try {
    const config = readConfigFile();
    validateSolutionsExist(config.solutions);

    const matchingSolutions = findMatchingSolutions(
      config.solutions,
      solutionName
    );

    if (arg === 'all') {
      await runSolutionsOnAllTests(matchingSolutions, config);
    } else if (isNumeric(arg)) {
      await runSolutionsOnSingleTest(
        matchingSolutions,
        config,
        parseInt(arg, 10)
      );
    } else {
      await runSolutionsOnGeneratorTests(matchingSolutions, config, arg);
    }
  } catch (error) {
    handleSolutionError(error);
  }
};
export const testWhat = async (what: string) => {
  switch (what) {
    case 'validator':
      await testValidatorItself();
      break;
    case 'checker':
      await testCheckerItself();
      break;
    default:
      await testSolutionAgainstMainCorrect(what);
      break;
  }
};
export const fullVerification = async () => {
  logger.section('Full Verification');

  try {
    const config = readConfigFile();

    // Generate Tests
    validateGeneratorsExist(config.generators);
    logger.info(`Found ${config.generators.length} generator(s)`);
    await runMatchingGenerators(config.generators, 'all');

    // Validate Tests
    ensureValidatorExists(config.validator);
    logger.info('Found validator');
    // validate the validator itself
    await runValidatorTests(config.validator);
    // validate all generated tests
    await validateAllTests(config.validator);

    // Checker Self
    ensureCheckerExists(config.checker);
    logger.info('Found checker');
    await runCheckerTests(config.checker);

    // Run Solutions
    validateSolutionsExist(config.solutions);
    ensureMainSolutionExists(config.solutions);
    logger.info(`Found ${config.solutions.length} solution(s)`);
    // run all solutions on all tests
    await runSolutionsOnAllTests(config.solutions, config);
    const mainSolution = getMainSolution(config.solutions);

    // validate all solutions against main correct solution
    for (const solution of config.solutions) {
      if (solution.name !== mainSolution.name) {
        await compareResultsWithChecker(config.checker, mainSolution, solution);
      }
    }

    logger.success('Full verification completed successfully!');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Full verification failed: ${message}`);
    process.exit(1);
  }
};
/*
Utility functions to help with action implementations
*/

function logTemplateCreationSuccess(directory: string) {
  logger.info('Next steps:');
  logger.log(`  1. cd ${directory}`);
  logger.log(
    `  2. Do your thing, add your solutions, generators, and validator`
  );
  logger.log(`  3. Edit config.json to configure your problem`);
  logger.log(
    `  4. Run ${logger.highlight('polyman generate-tests all')} to generate all tests`
  );
  logger.log(
    `  5. Run ${logger.highlight('polyman validate-tests all')} to validate all tests`
  );
  logger.log(
    `  6. Run ${logger.highlight(
      'polyman solve-tests <solution-name> all'
    )} to run a solution on all tests`
  );
}

function handleTemplateCreationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(message);
  process.exit(1);
}

function validateGeneratorsExist(
  generators: Generator[] | undefined
): asserts generators is Generator[] {
  if (!generators || generators.length === 0) {
    logger.warning('No test generators defined in the configuration file.');
    process.exit(0);
  }
}

async function runMatchingGenerators(
  generators: Generator[],
  generatorName: string
) {
  for (const generator of generators) {
    if (generatorName === 'all' || generator.name === generatorName) {
      await runGenerator(generator);
    }
  }
}

function handleGenerationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`Failed to generate tests: ${message}`);
  process.exit(1);
}

function ensureValidatorExists(
  validator: Validator | undefined
): asserts validator is Validator {
  if (!validator) {
    throw new Error('No validator defined in the configuration file.');
  }
}

function ensureCheckerExists(
  checker: Checker | undefined
): asserts checker is Checker {
  if (!checker) {
    throw new Error('No checker defined in the configuration file.');
  }
}
function ensureMainSolutionExists(
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

function ensureSolutionExists(
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

function isNumeric(value: string): boolean {
  return !isNaN(parseInt(value, 10));
}

async function validateAllTests(validator: Validator) {
  await runValidator(validator);
}

async function validateSingleTest(validator: Validator, testNumber: number) {
  await runValidator(validator, testNumber, testNumber);
}

async function validateGeneratorTests(
  config: ConfigFile,
  generatorName: string
) {
  const generator = config.generators?.find(g => g.name === generatorName);

  if (!generator) {
    throw new Error(
      `No generator named "${generatorName}" found in the configuration file.`
    );
  }

  const [start, end] = generator['tests-range'];
  await runValidator(config.validator, start, end);
}

function handleValidationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`Failed to validate tests: ${message}`);
  process.exit(1);
}

function handleCheckerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`Failed to test checker: ${message}`);
  process.exit(1);
}

function validateSolutionsExist(
  solutions: Solution[] | undefined
): asserts solutions is Solution[] {
  if (!solutions || solutions.length === 0) {
    throw new Error('No solutions defined in the configuration file.');
  }
}

function findMatchingSolutions(
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

async function runSolutionsOnAllTests(
  solutions: Solution[],
  config: ConfigFile
) {
  for (const solution of solutions) {
    await runSolution(solution, config['time-limit'], config['memory-limit']);
  }
}

async function runSolutionsOnSingleTest(
  solutions: Solution[],
  config: ConfigFile,
  testNumber: number
) {
  for (const solution of solutions) {
    await runSolution(
      solution,
      config['time-limit'],
      config['memory-limit'],
      testNumber,
      testNumber
    );
  }
}

async function runSolutionsOnGeneratorTests(
  solutions: Solution[],
  config: ConfigFile,
  generatorName: string
) {
  const generator = config.generators?.find(g => g.name === generatorName);

  if (!generator) {
    throw new Error(
      `No generator named "${generatorName}" found in the configuration file.`
    );
  }

  const [start, end] = generator['tests-range'];

  for (const solution of solutions) {
    await runSolution(
      solution,
      config['time-limit'],
      config['memory-limit'],
      start,
      end
    );
  }
}

function handleSolutionError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`Failed to run solution: ${message}`);
  process.exit(1);
}

async function testValidatorItself() {
  try {
    const config = readConfigFile();
    ensureValidatorExists(config.validator);

    await runValidatorTests(config.validator);
  } catch (error) {
    handleValidationError(error);
  }
}

async function testCheckerItself() {
  try {
    const config = readConfigFile();
    const checker = config.checker;

    ensureCheckerExists(checker);

    await runCheckerTests(checker);
  } catch (error) {
    handleCheckerError(error);
  }
}

async function testSolutionAgainstMainCorrect(solutionName: string) {
  try {
    const config = readConfigFile();
    const solutions = config.solutions;
    const checker = config.checker;

    ensureMainSolutionExists(solutions);
    ensureSolutionExists(solutions, solutionName);
    ensureCheckerExists(checker);

    const mainSolution = getMainSolution(solutions);
    const solution = solutions.find(s => s.name === solutionName)!;
    // run main solution
    await solveTests(mainSolution.name, 'all');
    // run target solution
    await solveTests(solutionName, 'all');
    // compare the results using the checker
    await compareResultsWithChecker(checker, mainSolution, solution);
  } catch (error) {
    handleSolutionError(error);
  }
}

function getMainSolution(solutions: Solution[]): Solution {
  for (const solution of solutions) {
    if (solution.type === 'main-correct') {
      return solution;
    }
  }
  // tell ts that this line is never reached
  throw new Error('Main correct solution not found.');
}
