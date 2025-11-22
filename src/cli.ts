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
  remoteVerifyProblemAction,
  remotePackageProblemAction,
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
  .description('download testlib.h in the current directory')
  .action(downloadTestlibAction);

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
  .action(listAvailableCheckersAction);

/**
 * Command: list-testsets
 * Lists all available testsets in the configuration.
 * Shows testset names, number of tests, and groups.
 *
 * @example
 * polyman list-testsets
 */
program
  .command('list-testsets')
  .description('List available testsets in the configuration')
  .action(listTestsetsAction);

/**
 * Command: list-solutions
 * Lists all available solutions in the configuration.
 * Shows solution names, source files, and tags (MA/OK/WA/TLE/etc).
 *
 * @example
 * polyman list-solutions
 */
program
  .command('list-solutions')
  .description('List available solutions in the configuration')
  .action(listSolutionsAction);

/**
 * Command: list-generators
 * Lists all available generators in the configuration.
 * Shows generator names and source files.
 *
 * @example
 * polyman list-generators
 */
program
  .command('list-generators')
  .description('List available generators in the configuration')
  .action(listGeneratorsAction);

/**
 * Command: generate <target> [modifier]
 * Generates tests based on testset/group/test specification.
 *
 * Usage:
 * - polyman generate all                 → Generate all testsets
 * - polyman generate <testset>           → Generate entire testset
 * - polyman generate <testset> <group>   → Generate specific group
 * - polyman generate <testset> <index>   → Generate specific test (by number)
 *
 * @example
 * polyman generate all
 * polyman generate tests
 * polyman generate tests samples
 * polyman generate tests 5
 */
program
  .command('generate <target> [modifier]')
  .description(
    'Generate tests for testsets\n' +
      '\t<target>:\n' +
      '\t\t"all" - generate all testsets\n' +
      '\t\t<testset-name> - generate specific testset\n' +
      '\t[modifier]:\n' +
      '\t\t<group-name> - generate specific group within testset\n' +
      '\t\t<test-number> - generate specific test within testset'
  )
  .action(generateTestsAction);

/**
 * Command: run-generator <generator-name>
 * Runs test generators to create test files.
 * Use 'all' to run all generators, or specify a generator name.
 *
 * @example
 * polyman run-generator all
 * polyman run-generator gen-random
 */
// program
//   .command('run-generator <generator-name>')
//   .description('Run the test generators for the problem')
//   .action(generateTests);

/**
 * Command: validate <target> [modifier]
 * Validates test input files using the validator program.
 *
 * Usage:
 * - polyman validate all                 → Validate all testsets
 * - polyman validate <testset>           → Validate entire testset
 * - polyman validate <testset> <group>   → Validate specific group
 * - polyman validate <testset> <index>   → Validate specific test (by number)
 *
 * @example
 * polyman validate all
 * polyman validate tests
 * polyman validate tests samples
 * polyman validate tests 5
 */
program
  .command('validate <target> [modifier]')
  .description(
    'Validate tests using the validator\n' +
      '\t<target>:\n' +
      '\t\t"all" - validate all testsets\n' +
      '\t\t<testset-name> - validate specific testset\n' +
      '\t[modifier]:\n' +
      '\t\t<group-name> - validate specific group within testset\n' +
      '\t\t<test-number> - validate specific test within testset'
  )
  .action(validateTestsAction);

/**
 * Command: run-solution <solution-name> <target> [modifier]
 * Runs a solution on test files based on testset/group/test specification.
 *
 * Usage:
 * - polyman run-solution <solution-name> all                 → Run on all testsets
 * - polyman run-solution <solution-name> <testset>           → Run on entire testset
 * - polyman run-solution <solution-name> <testset> <group>   → Run on specific group
 * - polyman run-solution <solution-name> <testset> <index>   → Run on specific test (by number)
 *
 * @example
 * polyman run-solution main all
 * polyman run-solution main tests
 * polyman run-solution main tests samples
 * polyman run-solution main tests 5
 */
program
  .command('run-solution <solution-name> <target> [modifier]')
  .description(
    'Run solution on tests\n' +
      '\t<target>:\n' +
      '\t\t"all" - run on all testsets\n' +
      '\t\t<testset-name> - run on specific testset\n' +
      '\t[modifier]:\n' +
      '\t\t<group-name> - run on specific group within testset\n' +
      '\t\t<test-number> - run on specific test within testset'
  )
  .action(runSolutionAction);

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
  .action(testWhatAction);

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
  .action(fullVerificationAction);

/**
 * Command: register <api-key> <secret>
 * Registers users Polygon api key locally, then to be used in future commands
 * @example
 * polyman register 991d9b535452b525ade5e102dc04ac0ada65044f a4c7c2fc8f4087669edd1139f46c017376af839g
 * */

program
  .command('register <api-key> <secret>')
  .description(
    'Registers users Polygon api key locally, then to be used in future commands, please NOTE that, this is only stored on your machine, this app itself, does not do anything with your data execpt using the key and the secret'
  )
  .action(registerApiKeyAndSecretAction);

/**
 * Command: remote-list
 * Lists the user's problems on Polygon associated with the registered API key
 * @example
 * polyman remote-list
 * polyman remote-list --owner tourist
 * */

program
  .command('remote-list')
  .description(
    "Lists the user's problems on Polygon associated with the registered API key"
  )
  .option('-o, --owner <username>', 'Filter problems by owner username')
  .action(async (options: { owner?: string }) => {
    await remoteListProblemsAction(options.owner);
  });

/**
 * Command: remote-pull <directory/problem-id> <path-to-save-directory>
 * Pulls a problem from Polygon associated with the user's registered API key
 * @example
 * polyman remote-pull 123456 /path/to/save
 * polyman remote-pull . .
 * */

program
  .command('remote-pull <directory/problem-id> <path-to-save-directory>')
  .description(
    "Pulls a problem from Polygon associated with the user's registered API key. The pulled problem will be saved in a format closer to the template structure used by Polyman. If the user's path already has a problem with different ID (or no ID), they will be warned about the conflict, but if the ID is the same, they will be asked to merge the changes, or overwrite the local problem."
  )
  .option(
    '-t',
    '--testsets <testsets>',
    "Specify particular testsets to pull, separated by commas (e.g., 'pretests,maintests'). If not provided, a we will try to pull a testset NAMED tests."
  )
  .action(
    async (probelmId: string, path: string, options: { testsets?: string }) => {
      await remotePullProblemAction(probelmId, path, options.testsets);
    }
  );

/**
 * Command: remote-pull <problem-id>
 * Pulls a problem from Polygon associated with the user's registered API key
 * @example
 * polyman remote-pull 123456
 * */

program
  .command('remote-push <directory>')
  .description(
    "Pushes a problem to Polygon associated with the user's registered API key. The path should point to the local problem directory. If a problem with the same ID exists, the user will be asked to confirm overwriting it, otherwise a new problem will be created. If the Config does not contain a Polygon problem ID, a new problem will be created."
  )
  .action(remotePushProblemAction);
/**
 * Command: remote-view <problem-id/directory>
 * Views a problem on Polygon associated with the user's registered API key
 * @example
 * polyman remote-view 123456
 * polyman remote-view ./my-problem
 * */

program
  .command('remote-view <directory/problem-id>')
  .description(
    `Views a problem on Polygon associated with the user's registered API key. The path should point to the local problem directory With Config File That Has An ID  or problem ID. This command views the problem's files and metadata on The terminal on a pleasant UI.`
  )
  .action(remoteViewProblemAction);

/**
 * Command: remote-pull <problem-id>
 * Pulls a problem from Polygon associated with the user's registered API key
 * @example
 * polyman remote-pull 123456
 * */

program
  .command('remote-commit <directory/problem-id> <commit-message>')
  .description(
    `
    Commits changes to a problem on Polygon associated with the user's registered API key. The path should point to the local problem directory With Config File That Has An ID  or problem ID. This command allows users to commit changes made locally to the problem on Polygon, ensuring that updates are reflected on the platform.`
  )
  .action(remoteCommitProblemAction);
/**
 * Command: remote-verify <directory/problem-id>
 * Verifies a problem on Polygon associated with the user's registered API key
 * @example
 * polyman remote-verify 123456
 * */

program
  .command('remote-verify <directory/problem-id>')
  .description(
    `
    Verifies a problem on Polygon associated with the user's registered API key. The path should point to the local problem directory With Config File That Has An ID or problem ID. This command runs a series of checks and validations on the problem to ensure it meets the required standards and guidelines set by Polygon before it can be published or updated on the platform.`
  )
  .action(remoteVerifyProblemAction);

/**
 * Command: remote-package <directory/problem-id> <package-type>
 * Packages a problem on Polygon associated with the user's registered API key
 * @example
 * polyman remote-package 123456 std
 * polyman remote-package 123456 full
 * */

program
  .command('remote-package <directory/problem-id> <package-type>')
  .description(
    `
    Packages a problem on Polygon associated with the user's registered API key. The path should point to the local problem directory With Config File That Has An ID or problem ID. This command packages the problem into the specified package type, preparing it for distribution or deployment on the platform.`
  )
  .action(remotePackageProblemAction);

// /**
//  * Command: remote-package <directory/problem-id> <package-type>
//  * Packages a problem on Polygon associated with the user's registered API key
//  * @example
//  * polyman remote-package 123456 std
//  * polyman remote-package 123456 full
//  * */

// program
//   .command(
//     'download-package <directory/problem-id> <package-type>'
//   )
//   .description(
//     `
//     Packages a problem on Polygon associated with the user's registered API key. The path should point to the local problem directory With Config File That Has An ID or problem ID. This command packages the problem into the specified package type, preparing it for distribution or deployment on the platform.`
//   )
//   .action(remotePackageProblemAction);

program.parse(process.argv);
