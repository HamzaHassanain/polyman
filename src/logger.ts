import chalk from 'chalk';

export class Logger {
  success(message: string) {
    console.log(chalk.green('✓'), chalk.green(message));
  }

  error(message: string) {
    console.log(chalk.red('✖'), chalk.red(message));
  }

  warning(message: string) {
    console.log(chalk.yellow('⚠'), chalk.yellow(message));
  }

  info(message: string) {
    console.log(chalk.blue('ℹ'), chalk.white(message));
  }

  log(message: string) {
    console.log(chalk.gray(message));
  }

  section(title: string) {
    console.log();
    console.log(chalk.bold.blue(`${'═'.repeat(50)}`));
    console.log(chalk.bold.blue(`  ${title}`));
    console.log(chalk.bold.blue(`${'═'.repeat(50)}`));
    console.log();
  }

  step(stepNumber: number, title: string) {
    console.log();
    console.log(
      chalk.bold.blue(`┌─ Step ${stepNumber}: `) + chalk.bold.white(title)
    );
  }

  stepComplete(message?: string) {
    if (message) {
      console.log(chalk.green(`└─ ✓ ${message}`));
    } else {
      console.log(chalk.green(`└─ ✓ Complete`));
    }
  }

  highlight(text: string): string {
    return chalk.bold.blue(text);
  }

  dim(text: string): string {
    return chalk.dim(text);
  }

  bold(text: string): string {
    return chalk.bold(text);
  }

  accent(text: string): string {
    return chalk.hex('#FF6B6B')(text); // Codeforces red accent
  }

  primary(text: string): string {
    return chalk.hex('#1E88E5')(text); // Codeforces blue
  }

  successBox(message: string) {
    console.log();
    console.log(
      chalk.bold.green('  ╔═══════════════════════════════════════════════╗')
    );
    console.log(chalk.bold.green(`    🎉  ${message.padEnd(41)}  `));
    console.log(
      chalk.bold.green('  ╚═══════════════════════════════════════════════╝')
    );
    console.log();
  }

  errorBox(message: string) {
    console.log();
    console.log(
      chalk.bold.red('  ╔═══════════════════════════════════════════╗')
    );
    console.log(chalk.bold.red(`   ❌  ${message.padEnd(35)}  `));
    console.log(
      chalk.bold.red('  ╚═══════════════════════════════════════════╝')
    );
    console.log();
  }
}

export const logger = new Logger();
