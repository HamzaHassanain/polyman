#! /usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';

import {
  createTemplate,
  generateTests,
  validateTests,
  runSolutionWithName,
} from './actions';

console.log();
console.log(chalk.cyan.bold('╔═══════════════════════════════════════╗'));
console.log(
  chalk.cyan.bold('║') +
    '                                       ' +
    chalk.cyan.bold('║')
);
console.log(
  chalk.cyan.bold('║') +
    '     ' +
    chalk.yellow.bold('POLYMAN') +
    ' - Problem Manager    ' +
    chalk.cyan.bold('║')
);
console.log(
  chalk.cyan.bold('║') +
    '                                       ' +
    chalk.cyan.bold('║')
);
console.log(chalk.cyan.bold('╚═══════════════════════════════════════╝'));
console.log();

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
  .command('generate-tests')
  .description('Run the test generators for the problem')
  .action(generateTests);

program
  .command('validate-tests')
  .description('Run the validator on the generated tests')
  .action(validateTests);

program
  .command('run <solution-name>')
  .description('Run a solution with a given name on the generated tests')
  .action(runSolutionWithName);

program.parse(process.argv);
