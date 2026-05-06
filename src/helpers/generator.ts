/**
 * @fileoverview Test generator compilation and execution.
 *
 * Drives Polygon-format generator scripts: parses, resolves to concrete test
 * indices, then runs each generator (or copies each manual test) into the
 * testset's output directory as `test<index>.txt`.
 */

import type { LocalGenerator, LocalTestset, ResolvedTest } from '../types';
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
import {
  parseGeneratorScript,
  readScriptText,
  resolveTests,
  validateGeneratorReferences,
  validateManualTests,
} from './script-parser';

/**
 * Runs a generator with stdout redirected to a single output file.
 */
async function runGeneratorToFile(
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
        void executor.cleanup();
        process.exit(1);
      },
      onMemoryExceeded: () => {
        fmt.error(
          `${fmt.cross()} ${fmt.bold('Generator Unexpectedly Exceeded Memory Limit!')} (${DEFAULT_MEMORY_LIMIT} MB)`
        );
        void executor.cleanup();
        process.exit(1);
      },
    },
    undefined,
    outputFilePath
  );
}

/**
 * Runs a generator that writes its own output files (multi-output `> {…}`
 * targets). The generator runs with cwd set to the testset directory so any
 * relative file paths it produces land where the rest of the pipeline expects
 * them.
 */
async function runGeneratorMultiOutput(
  execCommand: string,
  args: string[],
  cwd: string
) {
  const argsString = args.join(' ');
  await executor.execute(`${execCommand} ${argsString}`, {
    timeout: DEFAULT_TIMEOUT,
    memoryLimitMB: DEFAULT_MEMORY_LIMIT,
    silent: true,
    cwd,
    onTimeout: () => {
      fmt.error(
        `${fmt.cross()} ${fmt.bold('Generator Unexpectedly Exceeded Time Limit!')} (${DEFAULT_TIMEOUT}ms)`
      );
      void executor.cleanup();
      process.exit(1);
    },
    onMemoryExceeded: () => {
      fmt.error(
        `${fmt.cross()} ${fmt.bold('Generator Unexpectedly Exceeded Memory Limit!')} (${DEFAULT_MEMORY_LIMIT} MB)`
      );
      void executor.cleanup();
      process.exit(1);
    },
  });
}

export function ensureGeneratorsExist(
  generators: LocalGenerator[] | undefined
): asserts generators is LocalGenerator[] {
  if (!generators || generators.length === 0) {
    throw new Error('No test generators defined in the configuration file.');
  }
}

export async function compileGenerator(generator: LocalGenerator) {
  if (!generator.source) {
    throw new Error(`Generator ${generator.name} has no source file specified`);
  }
  await compileCPP(generator.source);
}

/**
 * Compiles all generators referenced by the given resolved tests.
 * Returns a map of generator name → compiled-run command.
 */
export async function compileGeneratorsForTests(
  tests: ResolvedTest[],
  generators: LocalGenerator[]
): Promise<Map<string, string>> {
  const compiled = new Map<string, string>();
  const referenced = new Set<string>();

  for (const t of tests) {
    if (t.source.kind === 'generator') {
      referenced.add(t.source.generator);
    }
  }

  for (const name of referenced) {
    const gen = generators.find(g => g.name === name);
    if (!gen) {
      throw new Error(`Generator "${name}" not found in configuration`);
    }
    if (!compiled.has(name)) {
      try {
        await compileGenerator(gen);
        compiled.set(name, getCompiledCommandToRun(gen));
      } catch (error) {
        throwError(error, `Failed to compile generator ${name}`);
      }
    }
  }

  return compiled;
}

/**
 * Compiles every generator used across every testset's resolved tests.
 */
export async function compileGeneratorsForTestsets(
  testsets: LocalTestset[],
  generators: LocalGenerator[]
): Promise<void> {
  const referenced = new Set<string>();
  for (const ts of testsets) {
    const lines = parseGeneratorScript(readScriptText(ts));
    for (const line of lines) referenced.add(line.generator);
  }
  for (const name of referenced) {
    const gen = generators.find(g => g.name === name);
    if (!gen) {
      throw new Error(`Generator "${name}" not found in configuration`);
    }
    await compileGenerator(gen);
  }
}

/**
 * Runs the resolved tests for a single testset, writing each input to
 * `<testsDir>/test<index>.txt`.
 *
 * Multi-output lines run once per unique line (not once per produced file)
 * and are expected to write all listed test files themselves.
 */
export async function executeResolvedTests(
  tests: ResolvedTest[],
  generators: LocalGenerator[],
  testsDir: string
): Promise<void> {
  ensureDirectoryExists(testsDir);

  const compiled = new Map<string, string>();
  for (const generator of generators) {
    compiled.set(generator.name, getCompiledCommandToRun(generator));
  }

  let someFailed = false;
  // Group multi-output tests by (generator, args, multiOutputs key) so we
  // only invoke the generator once per source line.
  const handled = new Set<string>();

  for (const t of tests) {
    try {
      if (t.source.kind === 'manual') {
        const dest = path.join(testsDir, `test${t.index}.txt`);
        await copyManualInput(t.source.inputFile, dest);
        continue;
      }

      const src = t.source;
      if (src.multiOutputs) {
        const key = `${src.generator}|${src.args.join(' ')}|${src.multiOutputs.join(',')}`;
        if (handled.has(key)) continue;
        handled.add(key);

        const compiledPath = compiled.get(src.generator);
        if (!compiledPath) {
          throw new Error(`Generator "${src.generator}" not compiled`);
        }
        await runGeneratorMultiOutput(compiledPath, src.args, testsDir);
        // Verify each promised file exists and rename to test<N>.txt convention.
        for (const idx of src.multiOutputs) {
          const expectedNames = [
            String(idx),
            `${idx}`,
            `test${idx}`,
            `${idx}.txt`,
            `test${idx}.txt`,
          ];
          let found: string | undefined;
          for (const candidate of expectedNames) {
            const p = path.join(testsDir, candidate);
            if (fs.existsSync(p)) {
              found = p;
              break;
            }
          }
          if (!found) {
            throw new Error(
              `Multi-output generator "${src.generator}" did not produce a ` +
                `file for index ${idx} (looked for: ${expectedNames.join(', ')})`
            );
          }
          const target = path.join(testsDir, `test${idx}.txt`);
          if (path.resolve(found) !== path.resolve(target)) {
            fs.renameSync(found, target);
          }
        }
      } else {
        const compiledPath = compiled.get(src.generator);
        if (!compiledPath) {
          throw new Error(`Generator "${src.generator}" not compiled`);
        }
        const dest = path.join(testsDir, `test${t.index}.txt`);
        await runGeneratorToFile(compiledPath, src.args, dest);
      }
    } catch (error) {
      someFailed = true;
      fmt.error(
        `  ${fmt.cross()} Test ${t.index} generation failed:\n\t${
          (error as Error).message
        }`
      );
    }
  }

  if (someFailed) {
    throw new Error('Some tests failed to generate');
  }
}

async function copyManualInput(
  sourceFilePath: string,
  destFilePath: string
): Promise<void> {
  const sourcePath = path.resolve(process.cwd(), sourceFilePath);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Manual test file not found: ${sourceFilePath}`);
  }
  await fs.promises.copyFile(sourcePath, destFilePath);
}

/**
 * Resolves and validates a testset's tests without running anything.
 * Throws on missing generator, missing manual file, or duplicate index.
 */
export function resolveTestsetTests(
  testset: LocalTestset,
  generators: LocalGenerator[]
): ResolvedTest[] {
  const lines = parseGeneratorScript(readScriptText(testset));
  validateGeneratorReferences(lines, generators);
  const manuals = testset.manualTests ?? [];
  validateManualTests(manuals);
  return resolveTests(lines, manuals);
}
