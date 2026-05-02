import { Command } from 'commander';
import chalk from 'chalk';

/**
 * Prints the comprehensive help message for the CLI.
 * Recursively lists all commands, subcommands, and options.
 * @param command The root command to print help for
 */
export const printComprehensiveHelp = (command: Command): void => {
  console.log(
    chalk.bold.blue(
      `\n${command.name()} - ${command.description()} v${command.version()}\n`
    )
  );

  const printCommand = (cmd: Command, depth: number = 0) => {
    const indent = '  '.repeat(depth);
    const subIndent = '  '.repeat(depth + 1);

    // Print command signature
    let signature = `${cmd.name()}`;
    if (cmd.alias()) {
      signature += `|${cmd.alias()}`;
    }
    const args = cmd
      .registeredArguments?.map((arg) => {
        return arg.required ? `<${arg.name()}>` : `[${arg.name()}]`;
      })
      .join(' ');
    if (args) {
      signature += ` ${args}`;
    }

    console.log(`${indent}${chalk.bold.green(signature)}`);
    if (cmd.description()) {
      console.log(`${subIndent}${cmd.description()}`);
    }

    // Print options
    const options = cmd.options;
    if (options && options.length > 0) {
      console.log(`${subIndent}${chalk.yellow('Options:')}`);
      options.forEach((option) => {
        console.log(
          `${subIndent}  ${option.flags.padEnd(25)} ${option.description}`
        );
      });
    }

    // Recursively print subcommands
    const subcommands = cmd.commands;
    if (subcommands && subcommands.length > 0) {
      if (depth === 0) {
        console.log(`\n${chalk.underline('Commands:')}\n`);
      }
      subcommands.forEach((subCmd) => {
        printCommand(subCmd as Command, depth + 1);
        console.log(''); // Add spacing between commands
      });
    }
  };

  // Start recursion
  // Note: 'program' itself is the root, usually we want to list its commands.
  // The root command usually doesn't have a name like 'new' unless explicitly set,
  // but here we are passed 'program' which is 'polyman'.
  
  // We iterate over the top-level commands directly
  command.commands.forEach((cmd) => {
    printCommand(cmd as Command, 0);
    console.log(chalk.gray('--------------------------------------------------'));
  });
};
