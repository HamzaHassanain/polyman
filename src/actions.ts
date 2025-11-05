import {
  copyTemplate,
  readConfigFile,
  runGenerator,
  runValidator,
  runSolution,
} from './helpers';
import { logger } from './logger';
import path from 'path';
import fs from 'fs';

export const createTemplate = (directory: string) => {
  // const spinner = logger.startSpinner('Creating problem template...');
  logger.info('Creating problem template...');
  try {
    const pwd = process.cwd();
    const problemDir = path.resolve(pwd, directory);
    const templateDir = path.resolve(__dirname, '../template');

    fs.mkdirSync(problemDir, { recursive: true });
    copyTemplate(templateDir, problemDir);

    // spinner.succeed(
    //   `Template created successfully at ${logger.highlight(directory)}`
    // );
    logger.info(`Next steps:`);
    logger.log(`  1. cd ${directory}`);
    logger.log(`  2. Edit config.json to configure your problem`);
    logger.log(`  3. Run ${logger.highlight('polyman generate-tests')}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // spinner.fail('Failed to create template');
    logger.error(message);
    process.exit(1);
  }
};

export const generateTests = async () => {
  logger.section('Test Generation');

  try {
    const { generators } = readConfigFile();
    if (!generators || generators.length === 0) {
      logger.warning('No test generators defined in the configuration file.');
      return;
    }

    logger.info(`Found ${generators.length} generator(s)`);

    for (const generator of generators) {
      await runGenerator(generator);
    }

    logger.success('All test cases generated successfully!');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to generate tests: ${message}`);
    process.exit(1);
  }
};

export const validateTests = async () => {
  logger.section('Test Validation');

  try {
    const config = readConfigFile();
    if (!config.validator) {
      throw new Error('No validator defined in the configuration file.');
    }
    await runValidator(config.validator);

    logger.success('All tests validated successfully!');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to validate tests: ${message}`);
    process.exit(1);
  }
};

export const runSolutionWithName = async (solutionName: string) => {
  logger.section(`Running Solution: ${solutionName}`);

  try {
    const config = readConfigFile();
    if (!config.solutions || config.solutions.length === 0) {
      throw new Error('No solutions defined in the configuration file.');
    }

    const solution = config.solutions.find(sol => sol.name === solutionName);

    if (!solution) {
      throw new Error(
        `Solution with name "${solutionName}" not found in the configuration file.`
      );
    }

    await runSolution(solution, config['time-limit'], config['memory-limit']);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to run solution: ${message}`);
    process.exit(1);
  }
};
