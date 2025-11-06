#! /usr/bin/env node
import { Command } from 'commander';

import {
  createTemplate,
  generateTests,
  validateTests,
  solveTests,
  testWhat,
  fullVerification,
} from './actions';

const program = new Command();

program
  .name('polyman')
  .description(
    'CLI tool for Codeforces problem setters to manage problems via terminal'
  )
  .version('1.0.0');

program
  .command('new <directory>')
  .description('Create a new problem in the specified directory')
  .action(createTemplate);

program
  .command('run-generator <generator-name>')
  .description('Run the test generators for the problem')
  .action(generateTests);

program
  .command('run-validator <test>')
  .description(
    'Run the validator on the generated tests\n\tThe <test>:\n\t\t"all" - to validate all tests\n\t\ta test number - to validate a specific test'
  )
  .action(validateTests);

program
  .command('run-solution <solution-name> <test>')
  .description(
    'Run a solution with a given name on the generated tests.\n\tThe <test>:\n\t\t"all" - to run on all tests\n\t\ta test number - to run on a specific test'
  )
  .action(solveTests);

program
  .command('test <what>')
  .description(
    'Test the Validator or the Checker against their tests or test a solution agains the main correct solution\n\tThe <what> can be "validator", "checker", or a solution name to run against the main correct solution and compare with the checker.'
  )
  .action(testWhat);

program
  .command('verify')
  .description(
    'Run full verification of the problem including test generation, validation, and solution testing'
  )
  .action(fullVerification);

program.parse(process.argv);
