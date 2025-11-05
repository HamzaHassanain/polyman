import chalk from 'chalk';

export class Logger {
  success(message: string) {
    console.log(chalk.green('✔'), chalk.green(message));
  }

  error(message: string) {
    console.log(chalk.red('✖'), chalk.red(message));
  }

  warning(message: string) {
    console.log(chalk.yellow('⚠'), chalk.yellow(message));
  }

  info(message: string) {
    console.log(chalk.blue('ℹ'), chalk.blue(message));
  }

  log(message: string) {
    console.log(chalk.white(message));
  }

  section(title: string) {
    console.log();
    console.log(chalk.bold.cyan(`━━━ ${title} ━━━`));
    console.log();
  }

  highlight(text: string): string {
    return chalk.cyan.bold(text);
  }

  dim(text: string): string {
    return chalk.dim(text);
  }
}

export const logger = new Logger();
