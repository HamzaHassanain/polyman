/**
 * @fileoverview Testset management utilities.
 * Handles testset selection, test generation, and testset operations.
 */

import type {
  LocalTestset,
  LocalGenerator,
  GeneratorScriptCommand,
} from '../types';
import { validateGeneratorCommands } from './script-parser';
import { executeGeneratorScript } from './generator';
import { ensureDirectoryExists, throwError } from './utils';
import path from 'path';

/**
 * Ensures testsets are defined in configuration.
 *
 * @param {LocalTestset[] | undefined} testsets - Testsets array to validate
 *
 * @throws {Error} If no testsets are defined
 */
export function ensureTestsetsExist(
  testsets: LocalTestset[] | undefined
): asserts testsets is LocalTestset[] {
  if (!testsets || testsets.length === 0) {
    throw new Error('No testsets defined in the configuration file.');
  }
}

/**
 * Finds a testset by name.
 *
 * @param {LocalTestset[]} testsets - Available testsets
 * @param {string} name - Testset name
 * @returns {LocalTestset} Found testset
 *
 * @throws {Error} If testset not found
 */
export function findTestset(
  testsets: LocalTestset[],
  name: string
): LocalTestset {
  const testset = testsets.find(t => t.name === name);
  if (!testset) {
    const available = testsets.map(t => t.name).join(', ');
    throw new Error(
      `Testset "${name}" not found. Available testsets: ${available}`
    );
  }
  return testset;
}

/**
 * Gets generator script commands from a testset.
 * Handles all three formats: commands array, script string, and script file.
 *
 * @param {LocalTestset} testset - Testset configuration
 * @returns {GeneratorScriptCommand[]} Array of generator commands
 *
 * @throws {Error} If no generator script is defined
 * @throws {Error} If script parsing fails
 */
export function getGeneratorCommands(
  testset: LocalTestset
): GeneratorScriptCommand[] {
  if (!testset.generatorScript) {
    throw new Error(
      `Testset "${testset.name}" has no generator script defined`
    );
  }

  const { commands } = testset.generatorScript;

  // Priority: commands > scriptFile > script
  if (commands && commands.length > 0) {
    return commands;
  }

  throw new Error(
    `Testset "${testset.name}" generator script has no commands, script, or scriptFile`
  );
}

/**
 * Generates tests for a specific testset.
 *
 * @param {LocalTestset} testset - Testset to generate
 * @param {LocalGenerator[]} generators - Available generators
 * @param {string} [outputDir] - Custom output directory (defaults to tests/<testset-name>)
 *
 * @throws {Error} If generator script is invalid
 * @throws {Error} If test generation fails
 */
export async function generateTestsForTestset(
  testset: LocalTestset,
  generators: LocalGenerator[],
  outputDir?: string
): Promise<void> {
  const commands = getGeneratorCommands(testset);

  const generatorNames = generators.map(g => g.name);
  validateGeneratorCommands(commands, generatorNames);

  const testsDir =
    outputDir || path.resolve(process.cwd(), 'testsets', testset.name);

  ensureDirectoryExists(testsDir);

  await executeGeneratorScript(commands, generators, testsDir);
}

/**
 * Generates a single test by index within a testset.
 *
 * @param {LocalTestset} testset - Testset containing the test
 * @param {number} testIndex - 1-based test index
 * @param {LocalGenerator[]} generators - Available generators
 * @param {string} [outputDir] - Custom output directory
 *
 * @throws {Error} If test index is out of range
 * @throws {Error} If test generation fails
 */
export async function generateSingleTest(
  testset: LocalTestset,
  testIndex: number,
  generators: LocalGenerator[],
  outputDir?: string
): Promise<void> {
  const commands = getGeneratorCommands(testset);

  if (testIndex < 1 || testIndex > commands.length) {
    throw new Error(
      `Test index ${testIndex} is out of range. Testset "${testset.name}" has ${commands.length} tests.`
    );
  }

  const generatorNames = generators.map(g => g.name);
  validateGeneratorCommands(commands, generatorNames);

  const command = commands[testIndex - 1];

  const testsDir =
    outputDir || path.resolve(process.cwd(), 'testsets', testset.name);

  ensureDirectoryExists(testsDir);

  await executeGeneratorScript([command], generators, testsDir);
}

/**
 * Generates tests for a specific group within a testset.
 *
 * @param {LocalTestset} testset - Testset containing the group
 * @param {string} groupName - Group name
 * @param {LocalGenerator[]} generators - Available generators
 * @param {string} [outputDir] - Custom output directory
 *
 * @throws {Error} If group doesn't exist
 * @throws {Error} If test generation fails
 */
export async function generateTestsForGroup(
  testset: LocalTestset,
  groupName: string,
  generators: LocalGenerator[],
  outputDir?: string
): Promise<void> {
  const allCommands = getGeneratorCommands(testset);

  // Filter commands by group
  const groupCommands = allCommands.filter(
    cmd => groupName === 'all' || cmd.group === groupName
  );

  if (groupCommands.length === 0) {
    const availableGroups = [
      ...new Set(allCommands.filter(c => c.group).map(c => c.group)),
    ];
    throw new Error(
      `No tests found in group "${groupName}". Available groups: ${availableGroups.join(', ') || 'none'}`
    );
  }

  const generatorNames = generators.map(g => g.name);
  validateGeneratorCommands(groupCommands, generatorNames);

  const testsDir =
    outputDir || path.resolve(process.cwd(), 'testsets', testset.name);

  ensureDirectoryExists(testsDir);

  await executeGeneratorScript(groupCommands, generators, testsDir);
}

/**
 * Generates tests for all testsets.
 *
 * @param {LocalTestset[]} testsets - All testsets
 * @param {LocalGenerator[]} generators - Available generators
 *
 * @throws {Error} If any testset generation fails
 */
export async function generateAllTestsets(
  testsets: LocalTestset[],
  generators: LocalGenerator[]
): Promise<void> {
  for (const testset of testsets) {
    try {
      await generateTestsForTestset(testset, generators);
    } catch (error) {
      throwError(error, `Failed to generate testset "${testset.name}"`);
    }
  }
}

/**
 * Lists available testsets with their configurations.
 *
 * @param {LocalTestset[]} testsets - Testsets to list
 * @returns {string[]} Array of formatted testset descriptions
 */
export function listTestsets(testsets: LocalTestset[]): string[] {
  return testsets.map(testset => {
    const commands = testset.generatorScript
      ? getGeneratorCommands(testset)
      : [];
    const groups = testset.groups?.map(g => g.name).join(', ') || 'none';

    return `${testset.name}: ${commands.length} tests, groups: ${groups}`;
  });
}
