#! /usr/bin/env node

/**
 * @fileoverview Command-line interface entry point for Polyman.
 * Defines all CLI commands using Commander.js and maps them to action functions.
 * This is the main entry point when running polyman from the terminal.
 */

import './node-version-check';
import { Argument, Command } from 'commander';
import { readFileSync } from 'fs';
import { join } from 'path';

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
  cacheStatusAction,
  cacheClearAction,
} from './actions';
import {
  SHELLS,
  generateCompletionScript,
  isCompletionKind,
  readCompletionNames,
} from './completion';
import { printComprehensiveHelp } from './help';
import { setCacheEnabled } from './helpers/compile-cache';
import { configureTerminal } from './terminal';
import { PolymanError, exitCodeFor } from './errors';
import { fmt } from './formatter';
import { resolveTheme, type Theme } from './theme';

configureTerminal();

const program = new Command();

/** Color theme for this run, set before commander parses the arguments. */
let theme: Theme | undefined;

// Read version from package.json so the CLI's --version output always matches
// the published package; previously this string was hand-edited and drifted.
const pkg = JSON.parse(
  readFileSync(join(__dirname, '..', 'package.json'), 'utf8')
) as { version: string };

/**
 * CLI Program Configuration
 * Sets up the polyman command-line tool with name, description, and version.
 */
program
  .name('polyman')
  .description(
    'CLI tool for Codeforces problem setters to manage problems via terminal'
  )
  .version(pkg.version)
  .helpOption(false)
  .option('-h, --help', 'display help for command', () => {
    // The callback fires while commander parses, before any action, so stop
    // here: otherwise `polyman new x --help` prints help and then creates x/.
    printComprehensiveHelp(program, theme);
    process.exit(0);
  })
  // Commands that compile sources accept `--no-cache`; commander stores it as
  // `cache: false` on the command that runs.
  .hook('preAction', (_program, actionCommand) => {
    setCacheEnabled(actionCommand.opts<{ cache?: boolean }>().cache !== false);
  });

/** Help text for the `--no-cache` flag shared by every compiling command. */
const NO_CACHE_DESCRIPTION =
  'Recompile every source instead of reusing cached binaries';

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
  .option(
    '--json',
    'Print a JSON report to stdout (human output goes to stderr)'
  )
  .action((directory: string, options: { json?: boolean }) => {
    createTemplateAction(directory, { json: options.json === true });
  });

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
  .option(
    '--json',
    'Print a JSON report to stdout (human output goes to stderr)'
  )
  .action(async (options: { json?: boolean }) => {
    await downloadTestlibAction({ json: options.json === true });
  });

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
  .option(
    '--json',
    'Print a JSON report to stdout (human output goes to stderr)'
  )
  .action((options: { json?: boolean }) => {
    listAvailableCheckersAction({ json: options.json === true });
  });

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
  .option(
    '--json',
    'Print a JSON report to stdout (human output goes to stderr)'
  )
  .action((options: { json?: boolean }) => {
    listTestsetsAction({ json: options.json === true });
  });

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
  .option(
    '--json',
    'Print a JSON report to stdout (human output goes to stderr)'
  )
  .action((options: { json?: boolean }) => {
    listSolutionsAction({ json: options.json === true });
  });

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
  .option(
    '--json',
    'Print a JSON report to stdout (human output goes to stderr)'
  )
  .action((options: { json?: boolean }) => {
    listGeneratorsAction({ json: options.json === true });
  });

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
 * polyman generate --all --json   # machine-readable report on stdout
 */
program
  .command('generate')
  .description('Generate tests for testsets')
  .option('-a, --all', 'Generate all testsets')
  .option('-t, --testset <name>', 'Generate specific testset')
  .option('-g, --group <name>', 'Generate specific group within testset')
  .option('-i, --index <number>', 'Generate specific test by index')
  .option('--no-cache', NO_CACHE_DESCRIPTION)
  .option(
    '--json',
    'Print a JSON report to stdout (human output goes to stderr)'
  )
  .action(
    async (options: {
      all?: boolean;
      testset?: string;
      group?: string;
      index?: string;
      json?: boolean;
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

      await generateTestsAction(target, modifier, {
        json: options.json === true,
      });
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
 * polyman validate --all --json   # machine-readable report on stdout
 */
program
  .command('validate')
  .description('Validate tests using the validator')
  .option('-a, --all', 'Validate all testsets')
  .option('-t, --testset <name>', 'Validate specific testset')
  .option('-g, --group <name>', 'Validate specific group within testset')
  .option('-i, --index <number>', 'Validate specific test by index')
  .option('--no-cache', NO_CACHE_DESCRIPTION)
  .option(
    '--json',
    'Print a JSON report to stdout (human output goes to stderr)'
  )
  .action(
    async (options: {
      all?: boolean;
      testset?: string;
      group?: string;
      index?: string;
      json?: boolean;
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

      await validateTestsAction(target, modifier, {
        json: options.json === true,
      });
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
 * polyman run main --all --json   # machine-readable report on stdout
 */
program
  .command('run <solution-name>')
  .description('Run solution on tests')
  .option('-a, --all', 'Run on all testsets')
  .option('-t, --testset <name>', 'Run on specific testset')
  .option('-g, --group <name>', 'Run on specific group within testset')
  .option('-i, --index <number>', 'Run on specific test by index')
  .option(
    '--json',
    'Print a JSON report to stdout (human output goes to stderr)'
  )
  .option('--no-cache', NO_CACHE_DESCRIPTION)
  .action(
    async (
      solutionName: string,
      options: {
        all?: boolean;
        testset?: string;
        group?: string;
        index?: string;
        json?: boolean;
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

      await runSolutionAction(solutionName, target, modifier, {
        json: options.json === true,
      });
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
 * polyman test checker --json   # machine-readable report on stdout
 */
program
  .command('test <what>')
  .description('Test validator, checker, or a solution against main correct')
  .option(
    '--json',
    'Print a JSON report to stdout (human output goes to stderr)'
  )
  .option('--no-cache', NO_CACHE_DESCRIPTION)
  .action(async (what: string, options: { json?: boolean }) => {
    await testWhatAction(what, { json: options.json === true });
  });

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
 * polyman verify --json   # machine-readable report on stdout
 */
program
  .command('verify')
  .description('Run full problem verification (generate, validate, test all)')
  .option(
    '--json',
    'Print a JSON report to stdout (human output goes to stderr)'
  )
  .option('--no-cache', NO_CACHE_DESCRIPTION)
  .action(async (options: { json?: boolean }) => {
    await fullVerificationAction({ json: options.json === true });
  });

// ============================================================================
// CACHE COMMANDS
// ============================================================================

const cache = program
  .command('cache')
  .description('Manage the compilation cache of the current problem');

/**
 * Command: cache status
 * Shows the cached binaries of the problem in the current directory.
 *
 * @example
 * polyman cache status
 */
cache
  .command('status')
  .description('Show cached binaries, their size, and when they were used')
  .action(cacheStatusAction);

/**
 * Command: cache clear
 * Deletes the compilation cache so every source is recompiled.
 *
 * @example
 * polyman cache clear
 */
cache
  .command('clear')
  .description('Delete the compilation cache (forces recompilation)')
  .action(cacheClearAction);

// ============================================================================
// SHELL COMPLETION COMMANDS
// ============================================================================

/**
 * Command: completion <shell>
 * Prints a completion script for bash, zsh or fish to stdout.
 *
 * @example
 * eval "$(polyman completion bash)"
 * polyman completion fish > ~/.config/fish/completions/polyman.fish
 */
program
  .command('completion')
  .description('Print a shell completion script (bash, zsh or fish)')
  .addArgument(new Argument('<shell>', 'Target shell').choices(SHELLS))
  .action((shell: string) => {
    process.stdout.write(generateCompletionScript(program, shell));
  });

/**
 * Command: __complete <kind> [testset]
 * Hidden helper that the completion scripts call to list testset, group,
 * solution or generator names from Config.json, one per line. It prints
 * nothing, and never fails, when Config.json is missing or invalid.
 */
program
  .command('__complete <kind> [testset]', { hidden: true })
  .description('List names from Config.json for shell completion')
  .action((kind: string, testset: string | undefined) => {
    if (!isCompletionKind(kind)) return;
    const names = readCompletionNames(kind, testset);
    if (names.length > 0) process.stdout.write(`${names.join('\n')}\n`);
  });

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
  .option(
    '--json',
    'Print a JSON report to stdout (human output goes to stderr)'
  )
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
        json?: boolean;
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
 * polyman remote push . --yes --name two-sum  # Create the Polygon problem headlessly
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
  .option('-y, --yes', 'Create a new Polygon problem without confirmation')
  .option('-n, --name <name>', 'Name (slug) for a new Polygon problem')
  .option(
    '--json',
    'Print a JSON report to stdout (human output goes to stderr)'
  )
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
        yes?: boolean;
        name?: string;
        json?: boolean;
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
  .option(
    '--json',
    'Print a JSON report to stdout (human output goes to stderr)'
  )
  .action(async (problemId: string, options: { json?: boolean }) => {
    await remoteViewProblemAction(problemId, { json: options.json === true });
  });

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
  .option(
    '--json',
    'Print a JSON report to stdout (human output goes to stderr)'
  )
  .action(
    async (problemId: string, message: string, options: { json?: boolean }) => {
      await remoteCommitProblemAction(problemId, message, {
        json: options.json === true,
      });
    }
  );

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
  .option(
    '--json',
    'Print a JSON report to stdout (human output goes to stderr)'
  )
  .action(
    async (problemId: string, type: string, options: { json?: boolean }) => {
      await remotePackageProblemAction(problemId, type, {
        json: options.json === true,
      });
    }
  );

// ============================================================================
// AI COMMANDS
// ============================================================================

/**
 * Loads the `ai` commands only when one of them runs, so other commands do
 * not load the agent code and do not get slower to start.
 */
const loadAiCommands = () => import('./agent/ai-commands.js');

const ai = program
  .command('ai')
  .description('Manage AI provider keys and the default model');

/**
 * Command: ai login <provider>
 * Saves a provider key in ~/.polyman/ai.json. The key is read from a hidden
 * prompt or from stdin, never from argv, so it stays out of shell history.
 * @example
 * polyman ai login deepseek
 * polyman ai login openai --key-stdin < key.txt
 * polyman ai login custom --base-url https://my-server/v1 --model my-model
 */
ai.command('login <provider>')
  .description('Save an API key for a provider (hidden prompt or stdin)')
  // A key typed after the provider must fail, not be silently ignored.
  .allowExcessArguments(false)
  .option('--key-stdin', 'Read the key from stdin instead of a prompt')
  .option('--base-url <url>', 'Base URL of the server (custom only)')
  .option(
    '--model <id>',
    'A model the server offers (custom only, can be repeated)',
    (value: string, previous: string[]) => [...previous, value],
    [] as string[]
  )
  .action(
    async (
      provider: string,
      options: { keyStdin?: boolean; baseUrl?: string; model: string[] }
    ) => {
      const { aiLoginAction } = await loadAiCommands();
      await aiLoginAction(provider, {
        keyStdin: options.keyStdin === true,
        ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
        model: options.model,
      });
    }
  );

/**
 * Command: ai logout <provider>
 * @example
 * polyman ai logout deepseek
 */
ai.command('logout <provider>')
  .description('Remove the saved API key of a provider')
  .action(async (provider: string) => {
    const { aiLogoutAction } = await loadAiCommands();
    await aiLogoutAction(provider);
  });

/**
 * Command: ai list
 * @example
 * polyman ai list
 */
ai.command('list')
  .description('List providers, which have keys (masked), and the default')
  .action(async () => {
    const { aiListAction } = await loadAiCommands();
    await aiListAction();
  });

/**
 * Command: ai models [provider]
 * For OpenRouter it shows the live model list (cached for 24 hours), with
 * tool support, context and prices. Offline it shows the known models.
 * @example
 * polyman ai models
 * polyman ai models groq
 * polyman ai models openrouter --search deepseek
 */
ai.command('models [provider]')
  .description(
    'List the known models of every provider, or of one (live list for openrouter)'
  )
  .option('--search <text>', 'Only models whose id has this text')
  .option('--refresh', 'Fetch the live list again, even when it is cached')
  .action(
    async (
      provider: string | undefined,
      options: { search?: string; refresh?: boolean }
    ) => {
      const { aiModelsAction } = await loadAiCommands();
      await aiModelsAction(provider, {
        ...(options.search !== undefined ? { search: options.search } : {}),
        ...(options.refresh === true ? { refresh: true } : {}),
      });
    }
  );

/**
 * Command: ai use <provider/model>
 * @example
 * polyman ai use deepseek/deepseek-flash
 * polyman ai use openrouter/deepseek/deepseek-v3.2
 */
ai.command('use <provider/model>')
  .description('Set the default provider and model')
  .action(async (spec: string) => {
    const { aiUseAction } = await loadAiCommands();
    await aiUseAction(spec);
  });

// ============================================================================
// CHAT COMMAND
// ============================================================================

/**
 * Loads the agent only when `chat` runs, so other commands do not load it
 * and do not get slower to start.
 */
const loadChat = () => import('./agent/index.js');

/**
 * Command: chat [dir]
 * Starts the AI agent in the terminal. A folder with Config.json is the
 * problem; else the chat starts in "new problem" mode and the folder name is
 * used for the new problem.
 * @example
 * polyman chat
 * polyman chat my-problem --model google/gemma-4-31b-it
 * polyman chat my-problem --provider openrouter --model deepseek/deepseek-v3.2
 * polyman chat my-problem --plain
 */
program
  .command('chat [dir]')
  .description(
    'Chat with the AI agent to think about, build and fix a problem (a folder without Config.json starts a new problem)'
  )
  .option(
    '--provider <id>',
    'Provider to use, like openrouter (default: the one of "polyman ai use", else openrouter)'
  )
  .option(
    '--model <id>',
    'Model to use, like google/gemma-4-31b-it or any id of "polyman ai models openrouter"'
  )
  .option('--plain', 'Line mode without the terminal UI, works with pipes')
  .action(
    async (
      dir: string | undefined,
      options: { provider?: string; model?: string; plain?: boolean }
    ) => {
      const { startChat } = await loadChat();
      await startChat({
        ...(dir !== undefined ? { dir } : {}),
        ...(options.provider !== undefined
          ? { provider: options.provider }
          : {}),
        ...(options.model !== undefined ? { model: options.model } : {}),
        ...(options.plain === true ? { plain: true } : {}),
      });
    }
  );

/**
 * The one place that turns a failed action into a message and an exit code.
 * A {@link PolymanError} exits with its own code, anything else with 1.
 *
 * Detecting the theme may ask the terminal for its background color, which is
 * async, so it runs once here before commander starts any action.
 */
void resolveTheme().then(async resolved => {
  theme = resolved;
  fmt.setTheme(resolved);
  await program.parseAsync(process.argv).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    fmt.error(message);
    if (error instanceof PolymanError && error.hint) {
      fmt.error(`Hint: ${error.hint}`);
    }
    process.exit(exitCodeFor(error));
  });
});
