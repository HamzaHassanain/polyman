#! /usr/bin/env node

/**
 * @fileoverview Command-line interface entry point for Polyman.
 * Defines all CLI commands using Commander.js and maps them to action functions.
 * This is the main entry point when running polyman from the terminal.
 */

import { Command } from 'commander';

import {
  createTemplateAction,
  downloadTestlibAction,
  listAvailableCheckersAction,
  listTestsetsAction,
  listSolutionsAction,
  listGeneratorsAction,
  generateTestsAction,
  validateTestsAction,
  runSolutionAction,
  testWhatAction,
  fullVerificationAction,
  registerApiKeyAndSecretAction,
  remoteListProblemsAction,
  remotePullProblemAction,
  remotePushProblemAction,
  remoteViewProblemAction,
  remoteCommitProblemAction,
  remotePackageProblemAction,
} from './actions';
import { printComprehensiveHelp } from './help';

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
  .version('2.2.2')
  .helpOption(false)
  .option('-h, --help', 'display help for command', () => {
    printComprehensiveHelp(program);
  });

// ============================================================================
// LOCAL COMMANDS
// ============================================================================

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
  .description('Create a new problem template in the specified directory')
  .action(createTemplateAction);

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
  .description('Download testlib.h to the current directory')
  .action(downloadTestlibAction);

// ============================================================================
// LIST COMMANDS
// ============================================================================

const list = program.command('list').description('List local resources');

/**
 * Command: list checkers
 * Lists all available standard checkers from the testlib library.
 * Shows descriptions for each checker.
 *
 * @example
 * polyman list checkers
 */
list
  .command('checkers')
  .description('List all available standard checkers')
  .action(listAvailableCheckersAction);

/**
 * Command: list testsets
 * Lists all available testsets in the configuration.
 * Shows testset names, number of tests, and groups.
 *
 * @example
 * polyman list testsets
 */
list
  .command('testsets')
  .description('List all testsets in the configuration')
  .action(listTestsetsAction);

/**
 * Command: list solutions
 * Lists all available solutions in the configuration.
 * Shows solution names, source files, and tags (MA/OK/WA/TLE/etc).
 *
 * @example
 * polyman list solutions
 */
list
  .command('solutions')
  .description('List all solutions in the configuration')
  .action(listSolutionsAction);

/**
 * Command: list generators
 * Lists all available generators in the configuration.
 * Shows generator names and source files.
 *
 * @example
 * polyman list generators
 */
list
  .command('generators')
  .description('List all generators in the configuration')
  .action(listGeneratorsAction);

// ============================================================================
// GENERATE COMMAND
// ============================================================================

/**
 * Command: generate
 * Generates tests based on testset/group/test specification.
 *
 * Usage:
 * - polyman generate --all                           → Generate all testsets
 * - polyman generate --testset <name>                → Generate entire testset
 * - polyman generate --testset <name> --group <name> → Generate specific group
 * - polyman generate --testset <name> --index <num>  → Generate specific test
 *
 * @example
 * polyman generate --all
 * polyman generate --testset tests
 * polyman generate --testset tests --group samples
 * polyman generate --testset tests --index 5
 */
program
  .command('generate')
  .description('Generate tests for testsets')
  .option('-a, --all', 'Generate all testsets')
  .option('-t, --testset <name>', 'Generate specific testset')
  .option('-g, --group <name>', 'Generate specific group within testset')
  .option('-i, --index <number>', 'Generate specific test by index')
  .action(
    async (options: {
      all?: boolean;
      testset?: string;
      group?: string;
      index?: string;
    }) => {
      let target = 'all';
      let modifier: string | undefined;

      if (options.all) {
        target = 'all';
      } else if (options.testset) {
        target = options.testset;
        if (options.group) {
          modifier = options.group;
        } else if (options.index) {
          modifier = options.index;
        }
      }

      await generateTestsAction(target, modifier);
    }
  );

// ============================================================================
// VALIDATE COMMAND
// ============================================================================

/**
 * Command: validate
 * Validates test input files using the validator program.
 *
 * Usage:
 * - polyman validate --all                           → Validate all testsets
 * - polyman validate --testset <name>                → Validate entire testset
 * - polyman validate --testset <name> --group <name> → Validate specific group
 * - polyman validate --testset <name> --index <num>  → Validate specific test
 *
 * @example
 * polyman validate --all
 * polyman validate --testset tests
 * polyman validate --testset tests --group samples
 * polyman validate --testset tests --index 5
 */
program
  .command('validate')
  .description('Validate tests using the validator')
  .option('-a, --all', 'Validate all testsets')
  .option('-t, --testset <name>', 'Validate specific testset')
  .option('-g, --group <name>', 'Validate specific group within testset')
  .option('-i, --index <number>', 'Validate specific test by index')
  .action(
    async (options: {
      all?: boolean;
      testset?: string;
      group?: string;
      index?: string;
    }) => {
      let target = 'all';
      let modifier: string | undefined;

      if (options.all) {
        target = 'all';
      } else if (options.testset) {
        target = options.testset;
        if (options.group) {
          modifier = options.group;
        } else if (options.index) {
          modifier = options.index;
        }
      }

      await validateTestsAction(target, modifier);
    }
  );

// ============================================================================
// RUN COMMAND
// ============================================================================

/**
 * Command: run <solution-name>
 * Runs a solution on test files based on testset/group/test specification.
 *
 * Usage:
 * - polyman run <solution> --all                           → Run on all testsets
 * - polyman run <solution> --testset <name>                → Run on entire testset
 * - polyman run <solution> --testset <name> --group <name> → Run on specific group
 * - polyman run <solution> --testset <name> --index <num>  → Run on specific test
 *
 * @example
 * polyman run main --all
 * polyman run main --testset tests
 * polyman run main --testset tests --group samples
 * polyman run main --testset tests --index 5
 */
program
  .command('run <solution-name>')
  .description('Run solution on tests')
  .option('-a, --all', 'Run on all testsets')
  .option('-t, --testset <name>', 'Run on specific testset')
  .option('-g, --group <name>', 'Run on specific group within testset')
  .option('-i, --index <number>', 'Run on specific test by index')
  .action(
    async (
      solutionName: string,
      options: {
        all?: boolean;
        testset?: string;
        group?: string;
        index?: string;
      }
    ) => {
      let target = 'all';
      let modifier: string | undefined;

      if (options.all) {
        target = 'all';
      } else if (options.testset) {
        target = options.testset;
        if (options.group) {
          modifier = options.group;
        } else if (options.index) {
          modifier = options.index;
        }
      }

      await runSolutionAction(solutionName, target, modifier);
    }
  );

// ============================================================================
// TEST COMMAND
// ============================================================================

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
  .description('Test validator, checker, or a solution against main correct')
  .action(testWhatAction);

// ============================================================================
// VERIFY COMMAND
// ============================================================================

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
  .description('Run full problem verification (generate, validate, test all)')
  .action(fullVerificationAction);

// ============================================================================
// REMOTE COMMANDS
// ============================================================================

const remote = program
  .command('remote')
  .description('Polygon remote operations');

/**
 * Command: remote register <api-key> <secret>
 * Registers users Polygon api key locally, then to be used in future commands
 * @example
 * polyman remote register 991d9b535452b525afe5e102dc04ac0ada65044v a5c7c2fc8f4087660edd1139f46c017376af839g
 * */
remote
  .command('register <api-key> <secret>')
  .description('Register Polygon API credentials locally')
  .action(registerApiKeyAndSecretAction);

/**
 * Command: remote list
 * Lists the user's problems on Polygon associated with the registered API key
 * @example
 * polyman remote list
 * polyman remote list --owner tourist
 * */
remote
  .command('list')
  .description('List problems from Polygon')
  .option('-o, --owner <username>', 'Filter problems by owner username')
  .action(async (options: { owner?: string }) => {
    await remoteListProblemsAction(options.owner);
  });

/**
 * Command: remote pull <problem-id> <directory>
 * Pulls a problem from Polygon associated with the user's registered API key
 * @example
 * polyman remote pull 123456 ./my-problem
 * polyman remote pull 123456 ./my-problem -s -c  # Pull only solutions and checker
 * polyman remote pull 123456 ./my-problem --all  # Pull everything (default)
 * */
remote
  .command('pull <problem-id> <directory>')
  .description('Pull a problem from Polygon to local directory')
  .option('-a, --all', 'Pull all components')
  .option('-s, --solutions', 'Pull solutions')
  .option('-c, --checker', 'Pull checker')
  .option('-v, --validator', 'Pull validator')
  .option('-g, --generators', 'Pull generators')
  .option('-S, --statements', 'Pull statements')
  .option(
    '-t, --tests <testsets>',
    'Pull tests (optionally specify comma-separated testset names)'
  )
  .option('-m, --metadata', 'Pull metadata (description and tags)')
  .option('-i, --info', 'Pull problem info (time/memory limits)')
  .action(
    async (
      problemId: string,
      directory: string,
      options: {
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
    ) => {
      await remotePullProblemAction(problemId, directory, options);
    }
  );

/**
 * Command: remote push <directory>
 * Pushes a problem to Polygon associated with the user's registered API key
 * @example
 * polyman remote push ./my-problem
 * polyman remote push ./my-problem -s -c  # Push only solutions and checker
 * polyman remote push ./my-problem --all  # Push everything (default)
 * */
remote
  .command('push <directory>')
  .description('Push local problem to Polygon')
  .option('-a, --all', 'Push all components ')
  .option('-s, --solutions', 'Push solutions')
  .option('-c, --checker', 'Push checker')
  .option('-v, --validator', 'Push validator')
  .option('-g, --generators', 'Push generators')
  .option('-S, --statements', 'Push statements')
  .option('-t, --tests', 'Push tests')
  .option('-m, --metadata', 'Push metadata (description and tags)')
  .option('-i, --info', 'Update problem info (time/memory limits)')
  .action(
    async (
      directory: string,
      options: {
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
    ) => {
      await remotePushProblemAction(directory, options);
    }
  );

/**
 * Command: remote view <problem-id>
 * Views a problem on Polygon associated with the user's registered API key
 * @example
 * polyman remote view 123456
 * polyman remote view ./my-problem
 * */
remote
  .command('view <problem-id>')
  .description('View problem details from Polygon')
  .action(remoteViewProblemAction);

/**
 * Command: remote commit <problem-id> <message>
 * Commits changes to a problem on Polygon associated with the user's registered API key
 * @example
 * polyman remote commit 123456 "Updated test cases"
 * polyman remote commit ./my-problem "Fixed validator"
 * */
remote
  .command('commit <problem-id> <message>')
  .description('Commit changes to Polygon problem')
  .action(remoteCommitProblemAction);

/**
 * Command: remote package <problem-id> <type>
 * Packages a problem on Polygon associated with the user's registered API key
 * @example
 * polyman remote package 123456 standard
 * polyman remote package ./my-problem full
 * */
remote
  .command('package <problem-id> <type>')
  .description('Build problem package on Polygon')
  .action(remotePackageProblemAction);

program.parse(process.argv);
