/**
 * @fileoverview Test generator compilation and execution utilities.
 * Provides functions to run test generators and create test files.
 */

import type {
  LocalGenerator,
  GeneratorScriptCommand,
  LocalTestset,
} from '../types';
import { executor } from '../executor';
import path from 'path';
import fs from 'fs';
import {
  compileCPP,
  throwError,
  ensureDirectoryExists,
  getCompiledCommandToRun,
} from './utils';
import { DEFAULT_TIMEOUT, DEFAULT_MEMORY_LIMIT } from './utils';
import { fmt } from '../formatter';

/**
 * Runs a generator program to create a test file.
 * Executes the compiled generator with given arguments and redirects output to a file.
 *
 * @param {string} execCommand - Path to compiled generator executable
 * @param {string[]} args - Arguments to pass to the generator
 * @param {string} outputFilePath - Path where test output will be written
 *
 * @throws {Error} If generator execution fails
 * @throws {Error} If generator exceeds time or memory limits (exits process)
 *
 * @example
 * await runGenerator(
 *   './gen-random',
 *   ['1', '100'],
 *   'tests/test1.txt'
 * );
 */
export async function runGenerator(
  execCommand: string,
  args: string[],
  outputFilePath: string
) {
  const argsString = args.join(' ');
  await executor.executeWithRedirect(
    `${execCommand} ${argsString}`,
    {
      timeout: DEFAULT_TIMEOUT,
      memoryLimitMB: DEFAULT_MEMORY_LIMIT,
      silent: true,
      onTimeout: () => {
        fmt.error(
          `${fmt.cross()} ${fmt.bold('Generator Unexpectedly Exceeded Time Limit!')} (${DEFAULT_TIMEOUT}ms)`
        );
        process.exit(1);
      },
      onMemoryExceeded: () => {
        fmt.error(
          `${fmt.cross()} ${fmt.bold('Generator Unexpectedly Exceeded Memory Limit!')} (${DEFAULT_MEMORY_LIMIT} MB)`
        );
        process.exit(1);
      },
    },
    undefined,
    outputFilePath
  );
}

/**
 * Ensures generators are defined in configuration.
 * Type assertion function that throws if no generators exist.
 *
 * @param {LocalGenerator[] | undefined} generators - Generators array to validate
 *
 * @throws {Error} If no generators are defined in configuration
 *
 * @example
 * const config = readConfigFile();
 * ensureGeneratorsExist(config.generators);
 * // Now TypeScript knows generators is defined
 */
export function ensureGeneratorsExist(
  generators: LocalGenerator[] | undefined
): asserts generators is LocalGenerator[] {
  if (!generators || generators.length === 0) {
    throw new Error('No test generators defined in the configuration file.');
  }
}

/**
 * Compiles a generator program.
 * Wrapper around compileCPP with consistent error handling.
 *
 * @param {LocalGenerator} generator - Generator configuration
 * @returns {Promise<string>} Path to compiled generator executable
 *
 * @throws {Error} If compilation fails
 *
 * @example
 * const path = await compileGenerator({ name: 'gen', source: 'generators/gen.cpp' });
 */
export async function compileGenerator(generator: LocalGenerator) {
  try {
    if (!generator.source) {
      throw new Error(
        `Generator ${generator.name} has no source file specified`
      );
    }
    const compiledPath = await compileCPP(generator.source);
    return compiledPath;
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error(`Failed to compile generator ${generator.name}`);
  }
}

/**
 * Compiles all generators needed for the given commands.
 * Returns a map of generator names to compiled paths.
 *
 * @param {GeneratorScriptCommand[]} commands - Generator commands to analyze
 * @param {LocalGenerator[]} generators - Available generators
 * @returns {Promise<Map<string, string>>} Map of generator name to compiled path
 *
 * @throws {Error} If any generator compilation fails
 * @throws {Error} If a required generator is not found
 *
 * @example
 * const compiledPaths = await compileAllGenerators(commands, generators);
 * const genPath = compiledPaths.get('gen-random');
 */
export async function compileAllGenerators(
  commands: GeneratorScriptCommand[],
  generators: LocalGenerator[]
): Promise<Map<string, string>> {
  const compiledGenerators = new Map<string, string>();

  for (const command of commands) {
    if (command.type === 'generator' && command.generator) {
      if (!compiledGenerators.has(command.generator)) {
        const generator = generators.find(g => g.name === command.generator);
        if (!generator) {
          throw new Error(
            `Generator "${command.generator}" not found in configuration`
          );
        }
        try {
          await compileGenerator(generator);
          compiledGenerators.set(
            command.generator,
            getCompiledCommandToRun(generator)
          );
        } catch (error) {
          throwError(error, `Failed to compile generator ${command.generator}`);
        }
      }
    }
  }

  return compiledGenerators;
}

/**
 * Compiles all unique generators used across all testsets.
 *
 * @param {LocalTestset[]} testsets - Testsets to analyze for generator usage
 * @param {LocalGenerator[]} generators - Available generators
 * @returns {Promise<void>} Resolves when all generators are compiled
 *
 * @throws {Error} If any generator compilation fails
 *
 * @example
 * await compileGeneratorsForTestsets(config.testsets, config.generators);
 */
export async function compileGeneratorsForTestsets(
  testsets: LocalTestset[],
  generators: LocalGenerator[]
): Promise<void> {
  const uniqueGeneratorNames = new Set<string>();

  // Collect all unique generator names from all testsets
  for (const testset of testsets) {
    if (testset.generatorScript?.commands) {
      for (const command of testset.generatorScript.commands) {
        if (command.type === 'generator' && command.generator) {
          uniqueGeneratorNames.add(command.generator);
        }
      }
    }
  }

  // Compile each unique generator
  for (const generatorName of uniqueGeneratorNames) {
    const generator = generators.find(g => g.name === generatorName);
    if (!generator) {
      throw new Error(
        `Generator "${generatorName}" not found in configuration`
      );
    }
    await compileGenerator(generator);
  }
}

/**
 * Executes generation script commands to create test files.
 * Processes each command in the script, handling both manual and generated tests.
 * Requires generators to be pre-compiled (use compileAllGenerators first).
 *
 * @param {GeneratorScriptCommand[]} commands - Array of generation commands
 * @param {LocalGenerator[]} generators - Available generators
 * @param {string} [outputDir] - Output directory for tests (defaults to ./tests)
 * @param {number} [startIndex] - Starting test index (defaults to 1)
 *
 * @throws {Error} If any command fails to execute
 *
 * @example
 * await executeGeneratorScript(
 *   [
 *     { type: 'manual', manualFile: './tests/manual/sample.txt' },
 *   ],
 *   generators,
 *   './tests/my-testset'
 * );
 */
export async function executeGeneratorScript(
  commands: GeneratorScriptCommand[],
  generators: LocalGenerator[],
  outputDir: string
) {
  let someFailed = false;
  const testsDir = outputDir || path.resolve(process.cwd(), 'testsets');
  ensureDirectoryExists(testsDir);

  // Get compiled paths for all generators
  const compiledGenerators = new Map<string, string>();
  for (const generator of generators) {
    const compiledPath = getCompiledCommandToRun(generator);
    compiledGenerators.set(generator.name, compiledPath);
  }
  let testNumber = 1;
  for (const command of commands) {
    try {
      if (command.type === 'manual' && command.manualFile) {
        // Copy manual test file
        const testFilePath = path.join(testsDir, `test${testNumber++}.txt`);
        await copyManualTest(command.manualFile, testFilePath);
      } else if (command.type === 'generator' && command.generator) {
        // Run generator multiple times for a range
        const compiledPath = compiledGenerators.get(command.generator);
        if (!compiledPath) {
          throw new Error(`Generator "${command.generator}" not compiled`);
        }
        if (!command.range || command.range.length !== 2) {
          throw new Error(
            `Generator range command for "${command.generator}" missing valid range [start, end]`
          );
        }
        const [start, end] = command.range;
        for (let i = start; i <= end; i++) {
          const testFilePath = path.join(testsDir, `test${testNumber++}.txt`);
          const args = [i.toString()];
          await runGenerator(compiledPath, args, testFilePath);
        }
      } else {
        throw new Error(`Invalid command type or missing required fields`);
      }
    } catch (error) {
      someFailed = true;
      fmt.error(
        `  ${fmt.cross()} Test ${testNumber} generation failed:\n\t${(error as Error).message}`
      );
    }
  }

  if (someFailed) {
    throw new Error('Some tests failed to generate');
  }
}

/**
 * Copies a manual test file to the tests directory.
 *
 * @private
 * @param {string} sourceFilePath - Path to manual test file
 * @param {string} destFilePath - Destination path in tests directory
 *
 * @throws {Error} If file doesn't exist or copy fails
 *
 * @example
 * await copyManualTest('./tests/manual/sample1.txt', 'tests/test1.txt');
 */
async function copyManualTest(
  sourceFilePath: string,
  destFilePath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const sourcePath = path.resolve(process.cwd(), sourceFilePath);
    if (!fs.existsSync(sourcePath)) {
      return reject(new Error(`Manual test file not found: ${sourceFilePath}`));
    }

    fs.copyFile(sourcePath, destFilePath, err => {
      if (err) {
        return reject(new Error(`Failed to copy manual test: ${err.message}`));
      }
      resolve();
    });
  });
}
