#! /usr/bin/env node

/**
 * @fileoverview Command-line interface entry point for Polyman.
 * Defines all CLI commands using Commander.js and maps them to action functions.
 * This is the main entry point when running polyman from the terminal.
 */

import { Command } from 'commander';

import {
  createTemplate,
  downloadTestlib,
  listAvailableCheckers,
  generateTests,
  validateTests,
  solveTests,
  testWhat,
  fullVerification,
} from './actions';

const program = new Command();

/**
 * CLI Program Configuration
 * Sets up the polyman command-line tool with name, description, and version.
 */
program
  .name('polyman')
  .description(
    'CLI tool for Codeforces problem setters to manage problems via terminal'
  )
  .version('1.0.0');

/**
 * Command: new <directory>
 * Creates a new problem template in the specified directory.
 * Copies all template files including Config.json, validators, checkers, etc.
 *
 * @example
 * polyman new my-problem
 */
program
  .command('new <directory>')
  .description('Create a new problem in the specified directory')
  .action(createTemplate);

/**
 * Command: download-testlib
 * Downloads testlib.h from GitHub to the current directory.
 * Provides installation instructions for system-wide usage.
 *
 * @example
 * polyman download-testlib
 */
program
  .command('download-testlib')
  .description('download testlib.h in the current directory')
  .action(downloadTestlib);

/**
 * Command: list-checkers
 * Lists all available standard checkers from the testlib library.
 * Shows descriptions for each checker.
 *
 * @example
 * polyman list-checkers
 */
program
  .command('list-checkers')
  .description('List available checkers')
  .action(listAvailableCheckers);

/**
 * Command: run-generator <generator-name>
 * Runs test generators to create test files.
 * Use 'all' to run all generators, or specify a generator name.
 *
 * @example
 * polyman run-generator all
 * polyman run-generator gen-random
 */
program
  .command('run-generator <generator-name>')
  .description('Run the test generators for the problem')
  .action(generateTests);

/**
 * Command: run-validator <test>
 * Validates generated test files using the validator.
 * Use 'all' to validate all tests, or specify a test number.
 *
 * @example
 * polyman run-validator all
 * polyman run-validator 5
 */
program
  .command('run-validator <test>')
  .description(
    'Run the validator on the generated tests\n\tThe <test>:\n\t\t"all" - to validate all tests\n\t\ta test number - to validate a specific test'
  )
  .action(validateTests);

/**
 * Command: run-solution <solution-name> <test>
 * Runs a solution on test files and generates outputs.
 * Use 'all' for all tests, or specify a test number.
 *
 * @example
 * polyman run-solution main all
 * polyman run-solution wa-solution 3
 */
program
  .command('run-solution <solution-name> <test>')
  .description(
    'Run a solution with a given name on the generated tests.\n\tThe <test>:\n\t\t"all" - to run on all tests\n\t\ta test number - to run on a specific test'
  )
  .action(solveTests);

/**
 * Command: test <what>
 * Tests validators, checkers, or solutions.
 * - 'validator': Runs validator self-tests
 * - 'checker': Runs checker self-tests
 * - <solution-name>: Tests solution against main-correct
 *
 * @example
 * polyman test validator
 * polyman test checker
 * polyman test wa-solution
 */
program
  .command('test <what>')
  .description(
    'Test the Validator or the Checker against their tests or test a solution agains the main correct solution\n\tThe <what> can be "validator", "checker", or a solution name to run against the main correct solution and compare with the checker.'
  )
  .action(testWhat);

/**
 * Command: verify
 * Runs full verification of the problem.
 * Includes: test generation, validation, checker testing, solution execution, and comparison.
 * This is the comprehensive verification process.
 *
 * @example
 * polyman verify
 */
program
  .command('verify')
  .description(
    'Run full verification of the problem including test generation, validation, and solution testing'
  )
  .action(fullVerification);

program.parse(process.argv);
