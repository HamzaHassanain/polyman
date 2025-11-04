import chalk from 'chalk';
// import ora, { Ora } from 'ora';

export class Logger {
  // private spinner: Ora | null = null;

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

  // startSpinner(message: string): Ora {
  //   this.spinner = ora({
  //     text: message,
  //     color: 'cyan',
  //   }).start();
  //   return this.spinner;
  // }

  // succeedSpinner(message?: string) {
  //   if (this.spinner) {
  //     this.spinner.succeed(message);
  //     this.spinner = null;
  //   }
  // }

  // failSpinner(message?: string) {
  //   if (this.spinner) {
  //     this.spinner.fail(message);
  //     this.spinner = null;
  //   }
  // }

  // stopSpinner() {
  //   if (this.spinner) {
  //     this.spinner.stop();
  //     this.spinner = null;
  //   }
  // }

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
