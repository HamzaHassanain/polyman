/**
 * @fileoverview Terminal output formatter with Codeforces-themed styling.
 * Provides consistent, colorful CLI output using chalk library.
 * All methods use explicit icon placement for better indentation control.
 */

import chalk from 'chalk';

/**
 * Formatter class for creating styled terminal output with Codeforces theme.
 * Uses chalk library for coloring with custom hex colors (#1E88E5 blue, #FF6B6B red).
 *
 * @class Formatter
 * @example
 * import { fmt } from './formatter';
 *
 * fmt.section('📁 CREATE TEMPLATE');
 * fmt.step(1, 'Creating directory');
 * fmt.success('Directory created!');
 * fmt.stepComplete('Done');
 */
export class Formatter {
  /**
   * Prints a success message in green.
   * @param {string} message - The message to display
   * @example
   * fmt.success('Template created successfully!');
   */
  success(message: string) {
    console.log(chalk.green(message));
  }

  /**
   * Prints an error message in red.
   * @param {string} message - The error message to display
   * @example
   * fmt.error('Failed to compile validator');
   */
  error(message: string) {
    console.log(chalk.red(message));
  }

  /**
   * Prints a warning message in yellow.
   * @param {string} message - The warning message to display
   * @example
   * fmt.warning('testlib.h already exists');
   */
  warning(message: string) {
    console.log(chalk.yellow(message));
  }

  /**
   * Prints an informational message in white.
   * @param {string} message - The info message to display
   * @example
   * fmt.info(`Target: ${generatorName}`);
   */
  info(message: string) {
    console.log(chalk.white(message));
  }

  /**
   * Prints a dimmed/gray log message.
   * Used for less important information.
   * @param {string} message - The message to display
   * @example
   * fmt.log('Additional details...');
   */
  log(message: string) {
    console.log(chalk.gray(message));
  }

  /**
   * Returns a green checkmark icon (✓).
   * Use explicitly in messages for better indentation control.
   * @returns {string} Styled checkmark
   * @example
   * fmt.success(`${fmt.checkmark()} Test passed`);
   */
  checkmark(): string {
    return chalk.green('✓');
  }

  /**
   * Returns a red cross icon (✖).
   * Use explicitly in messages for better indentation control.
   * @returns {string} Styled cross
   * @example
   * fmt.error(`${fmt.cross()} Test failed`);
   */
  cross(): string {
    return chalk.red('✖');
  }

  /**
   * Returns a yellow warning icon (⚠).
   * Use explicitly in messages for better indentation control.
   * @returns {string} Styled warning icon
   * @example
   * fmt.warning(`${fmt.warningIcon()} Memory limit not supported on Windows`);
   */
  warningIcon(): string {
    return chalk.yellow('⚠');
  }

  /**
   * Returns a blue info icon (ℹ).
   * Use explicitly in messages for better indentation control.
   * @returns {string} Styled info icon
   * @example
   * fmt.info(`${fmt.infoIcon()} Found 5 generators`);
   */
  infoIcon(): string {
    return chalk.blue('ℹ');
  }

  /**
   * Prints a section header with blue double-line border.
   * Used to separate major sections in command output.
   * @param {string} title - The section title
   * @example
   * fmt.section('📁 CREATE NEW PROBLEM TEMPLATE');
   */
  section(title: string) {
    console.log();
    console.log(chalk.bold.blue(`${'═'.repeat(50)}`));
    console.log(chalk.bold.blue(`  ${title}`));
    console.log(chalk.bold.blue(`${'═'.repeat(50)}`));
    console.log();
  }

  /**
   * Prints a numbered step header with a top corner bracket.
   * @param {number} stepNumber - The step number
   * @param {string} title - The step description
   * @example
   * fmt.step(1, 'Creating Directory Structure');
   */
  step(stepNumber: number, title: string) {
    console.log();
    console.log(
      chalk.bold.blue(`┌─ Step ${stepNumber}: `) + chalk.bold.white(title)
    );
  }

  /**
   * Prints a step completion message with a bottom corner bracket and checkmark.
   * @param {string} [message] - Optional completion message (defaults to 'Complete')
   * @example
   * fmt.stepComplete('Directory created');
   */
  stepComplete(message?: string) {
    if (message) {
      console.log(chalk.green(`└─ ✓ ${message}`));
    } else {
      console.log(chalk.green(`└─ ✓ Complete`));
    }
  }

  /**
   * Returns highlighted text in Codeforces blue color.
   * @param {string} text - Text to highlight
   * @returns {string} Styled text
   * @example
   * fmt.info(`Target: ${fmt.highlight('all')}`);
   */
  highlight(text: string): string {
    return chalk.bold.blue(text);
  }

  /**
   * Returns dimmed/grayed text.
   * @param {string} text - Text to dim
   * @returns {string} Styled text
   * @example
   * fmt.info(`${fmt.dim('(optional)')}`);
   */
  dim(text: string): string {
    return chalk.dim(text);
  }

  /**
   * Returns bold text.
   * @param {string} text - Text to make bold
   * @returns {string} Styled text
   * @example
   * console.log(fmt.bold('Important:'));
   */
  bold(text: string): string {
    return chalk.bold(text);
  }

  /**
   * Returns text in Codeforces red accent color (#FF6B6B).
   * @param {string} text - Text to style
   * @returns {string} Styled text
   * @example
   * fmt.log(`Error: ${fmt.accent('Failed')}`);
   */
  accent(text: string): string {
    return chalk.hex('#FF6B6B')(text); // Codeforces red accent
  }

  /**
   * Returns text in Codeforces primary blue color (#1E88E5).
   * @param {string} text - Text to style
   * @returns {string} Styled text
   * @example
   * fmt.info(`Main solution: ${fmt.primary(mainSolution.name)}`);
   */
  primary(text: string): string {
    return chalk.hex('#1E88E5')(text); // Codeforces blue
  }

  /**
   * Prints a success box with green border and celebration emoji.
   * Used for final success messages.
   * @param {string} message - Success message to display
   * @example
   * fmt.successBox('TEMPLATE CREATED SUCCESSFULLY!');
   */
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

  /**
   * Prints an error box with red border and cross emoji.
   * Used for final error messages.
   * @param {string} message - Error message to display
   * @example
   * fmt.errorBox('VALIDATION FAILED!');
   */
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

/**
 * Singleton instance of the Formatter class.
 * Import and use this instance throughout the application for consistent styling.
 *
 * @constant
 * @type {Formatter}
 * @example
 * import { fmt } from './formatter';
 * fmt.success('Operation completed!');
 */
export const fmt = new Formatter();
