/**
 * @fileoverview Polygon generator script parser.
 * Parses Polygon-format test generation scripts and converts them to structured commands.
 *
 */

import type { GeneratorScriptCommand } from '../types';
import fs from 'fs';
import path from 'path';

export function validateGeneratorCommands(
  commands: GeneratorScriptCommand[],
  availableGenerators: string[]
): void {
  for (const command of commands) {
    if (
      command.type === 'generator-single' ||
      command.type === 'generator-range'
    ) {
      if (!command.generator) {
        throw new Error('Generator command missing generator name');
      }
      if (!availableGenerators.includes(command.generator)) {
        throw new Error(
          `Generator "${command.generator}" not found in configuration. ` +
            `Available generators: ${availableGenerators.join(', ')}`
        );
      }
    } else if (command.type === 'manual') {
      if (!command.manualFile) {
        throw new Error('Manual command missing file path');
      }
      const filePath = path.resolve(process.cwd(), command.manualFile);
      if (!fs.existsSync(filePath)) {
        throw new Error(`Manual test file not found: ${command.manualFile}`);
      }
    }
  }
}
