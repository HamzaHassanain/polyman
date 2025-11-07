import chalk from 'chalk';

export class Formatter {
  success(message: string) {
    console.log(chalk.green(message));
  }

  error(message: string) {
    console.log(chalk.red(message));
  }

  warning(message: string) {
    console.log(chalk.yellow(message));
  }

  info(message: string) {
    console.log(chalk.white(message));
  }

  log(message: string) {
    console.log(chalk.gray(message));
  }

  // Icon helpers for explicit use
  checkmark(): string {
    return chalk.green('✓');
  }

  cross(): string {
    return chalk.red('✖');
  }

  warningIcon(): string {
    return chalk.yellow('⚠');
  }

  infoIcon(): string {
    return chalk.blue('ℹ');
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

export const fmt = new Formatter();
