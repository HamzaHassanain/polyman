/**
 * @fileoverview Test generator compilation and execution utilities.
 * Provides functions to run test generators and create test files.
 */

import fs from 'fs';
import path from 'path';
import { executor } from '../executor';
import { compileCPP, DEFAULT_TIMEOUT, DEFAULT_MEMORY_LIMIT } from './utils';
import { fmt } from '../formatter';
import { Generator } from '../types';

/**
 * Ensures generators are defined in configuration.
 * Type assertion function that exits gracefully if no generators exist.
 *
 * @param {Generator[] | undefined} generators - Generators array to validate
 *
 * @example
 * const config = readConfigFile();
 * ensureGeneratorsExist(config.generators);
 * // Now TypeScript knows generators is defined and non-empty
 */
export function ensureGeneratorsExist(
  generators: Generator[] | undefined
): asserts generators is Generator[] {
  if (!generators || generators.length === 0) {
    fmt.warning(
      `${fmt.warningIcon()} No test generators defined in the configuration file.`
    );
    process.exit(0);
  }
}

/**
 * Runs matching test generators based on name.
 * Compiles and executes generators, creating test files in the tests/ directory.
 * Fails fast - stops on first generator failure.
 *
 * @param {Generator[]} generators - Array of generator configurations
 * @param {string} generatorName - Name of generator to run, or 'all' for all generators
 *
 * @throws {Error} If no generator matches the name
 * @throws {Error} If any generator fails to compile or run
 *
 * @example
 * // From actions.ts generateTests
 * const config = readConfigFile();
 * await runMatchingGenerators(config.generators, 'gen-random');
 *
 * @example
 * // Run all generators
 * await runMatchingGenerators(config.generators, 'all');
 */
export async function runMatchingGenerators(
  generators: Generator[],
  generatorName: string
) {
  let didRunAGenerator = false;
  let someFailed = false;
  for (const generator of generators) {
    if (generator.name === 'samples' || generator.name === 'manual') continue;
    if (generatorName === 'all' || generator.name === generatorName) {
      fmt.log(
        `  ${fmt.dim('→')} ${fmt.highlight(generator.name)} ${fmt.dim('(compiling and running...)')}`
      );
      try {
        await runGenerator(generator);
        const [start, end] = generator['tests-range'];
        const totalTests = end - start + 1;

        fmt.log(
          `    ${fmt.bold(`${totalTests}/${totalTests} test${totalTests > 1 ? 's' : ''}`)} generated successfully.`
        );
      } catch (error) {
        handleGenerationError(error);
        someFailed = true;
      }
    }

    didRunAGenerator = true;
  }

  if (!didRunAGenerator && generatorName !== 'all') {
    throw new Error(`No generator named "${generatorName}" found`);
  }

  if (someFailed) {
    throw new Error('Some generators failed to run');
  }
}

/**
 * Handles test generation errors.
 * Logs error message and optionally exits process.
 *
 * @param {unknown} error - Error that occurred during generation
 * @param {boolean} [isCancelationPoint=false] - Whether to exit process on error
 *
 * @example
 * try {
 *   await runGenerator(generator);
 * } catch (error) {
 *   handleGenerationError(error, false);
 * }
 */
export function handleGenerationError(
  error: unknown,
  isCancelationPoint = false
) {
  const message = error instanceof Error ? error.message : String(error);
  fmt.error(`  ${fmt.cross()} ${message}`);
  if (isCancelationPoint) process.exit(1);
}

/**
 * Runs a single test generator.
 * Compiles the generator and generates all tests in its range.
 *
 * @private
 * @param {Generator} generator - Generator configuration
 *
 * @throws {Error} If generator has no source file
 * @throws {Error} If compilation fails
 * @throws {Error} If test generation fails
 *
 * @example
 * // Generates tests from test1.txt to test10.txt
 * await runGenerator({
 *   name: 'gen-random',
 *   source: 'generators/random.cpp',
 *   'tests-range': [1, 10]
 * });
 */
async function runGenerator(generator: Generator) {
  if (!generator.source) {
    throw new Error(`Generator ${generator.name} has no source file specified`);
  }

  try {
    const testsDir = ensureTestsDirectory();
    const compiledPath = await compileCPP(generator.source);
    await generateTestFiles(compiledPath, generator, testsDir);
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error(
          `Failed to run generator ${generator.name}:\n\t ${String(error)}`
        );
  } finally {
    executor.cleanup();
  }
}

/**
 * Generates test files using a compiled generator.
 * Calls the generator with test numbers as arguments and redirects output to files.
 *
 * @private
 * @param {string} compiledPath - Path to compiled generator executable
 * @param {Generator} generator - Generator configuration
 * @param {string} testsDir - Directory where test files will be created
 *
 * @throws {Error} If test generation fails for any test number
 *
 * @example
 * // Generates test1.txt, test2.txt, test3.txt in tests/ directory
 * await generateTestFiles('./gen-random', {
 *   name: 'gen-random',
 *   'tests-range': [1, 3]
 * }, 'tests');
 */
async function generateTestFiles(
  compiledPath: string,
  generator: Generator,
  testsDir: string
) {
  const [start, end] = generator['tests-range'];
  for (let i = start; i <= end; i++) {
    const outputFilePath = path.join(testsDir, `test${i}.txt`);

    try {
      await executor.executeWithRedirect(
        `${compiledPath} ${i}`,
        {
          timeout: DEFAULT_TIMEOUT,
          memoryLimitMB: DEFAULT_MEMORY_LIMIT,
          silent: true,
        },
        undefined,
        outputFilePath
      );
    } catch (error) {
      throw error instanceof Error
        ? error
        : new Error(
            `Failed to generate test ${i} using generator ${generator.name}: ${String(
              error
            )}`
          );
    }
  }
}

/**
 * Ensures the tests directory exists.
 * Creates the directory if it doesn't exist.
 *
 * @private
 * @returns {string} Absolute path to tests directory
 *
 * @example
 * const testsDir = ensureTestsDirectory();
 * // Returns: '/path/to/problem/tests'
 */
function ensureTestsDirectory(): string {
  const testsDir = path.resolve(process.cwd(), 'tests');
  if (!fs.existsSync(testsDir)) {
    fs.mkdirSync(testsDir);
  }
  return testsDir;
}
