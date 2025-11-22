/**
 * @fileoverview Template creation utilities for new problem setup.
 * Provides functions to copy template files and display setup instructions.
 */

import fs from 'fs';
import path from 'path';
import { fmt } from '../formatter';

/**
 * Displays success message and next steps after template creation.
 * Shows formatted instructions for getting started with the new problem.
 *
 * @param {string} directory - Name of the created problem directory
 *
 * @example
 * // From actions.ts createTemplateAction
 * logTemplateCreationSuccess('my-problem');
 * // Displays:
 * //   1. cd my-problem
 * //   2. Add your solutions, generators, and validator
 * //   3. Edit Config.json...
 * //   4. Run 'polyman generate all' to generate tests
 * //   5. Run 'polyman validate all' to validate tests
 * //   6. Run 'polyman verify' for full verification
 */
export function logTemplateCreationSuccess(directory: string) {
  console.log();
  fmt.info(`  ${fmt.infoIcon()} ${fmt.bold('Next steps:')}`);
  console.log();
  fmt.log(`    ${fmt.primary('1.')} cd ${fmt.highlight(directory)}`);
  fmt.log(
    `    ${fmt.primary('2.')} Add your solutions, generators, and validator`
  );
  fmt.log(
    `    ${fmt.primary('3.')} Edit ${fmt.highlight('Config.json')} to configure your problem`
  );
  fmt.log(
    `    ${fmt.primary('4.')} Run ${fmt.highlight('polyman generate all')} to generate tests`
  );
  fmt.log(
    `    ${fmt.primary('5.')} Run ${fmt.highlight('polyman validate all')} to validate tests`
  );
  fmt.log(
    `    ${fmt.primary('6.')} Run ${fmt.highlight('polyman verify')} for full verification`
  );
  fmt.log(
    `    ${fmt.primary('Quick TUTORIAL ->')} Visit ${fmt.highlight('https://github.com/HamzaHassanain/polyman/blob/master/template/TUTORIAL.md')}`
  );
  fmt.log(
    `    ${fmt.primary('Full Guide ->')} Visit ${fmt.highlight('https://github.com/HamzaHassanain/polyman/blob/master/template/GUIDE.md')}`
  );
  console.log();
}

/**
 * Recursively copies template directory structure to destination.
 * Copies all files and subdirectories from template to problem directory.
 *
 * @param {string} srcDir - Source template directory path
 * @param {string} destDir - Destination problem directory path
 *
 * @example
 * // From actions.ts createTemplate
 * const templateDir = path.resolve(__dirname, '../template');
 * const problemDir = path.resolve(process.cwd(), 'my-problem');
 * copyTemplate(templateDir, problemDir);
 */
export function copyTemplate(srcDir: string, destDir: string) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyTemplate(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Handles template creation errors.
 * Logs error and exits process with code 1.
 *
 * @param {unknown} error - Error that occurred during template creation
 *
 * @example
 * try {
 *   copyTemplate(srcDir, destDir);
 * } catch (error) {
 *   handleTemplateCreationError(error);
 * }
 */
export function handleTemplateCreationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  fmt.error(`${fmt.cross()} ${message}`);
  process.exit(1);
}
