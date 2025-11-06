import fs from 'fs';
import path from 'path';
import { executor } from '../executor';
import { compileCPP, DEFAULT_TIMEOUT, DEFAULT_MEMORY_LIMIT } from './utils';
import { logger } from '../logger';
import { Generator } from '../types';

export function ensureGeneratorsExist(
  generators: Generator[] | undefined
): asserts generators is Generator[] {
  if (!generators || generators.length === 0) {
    logger.warning('No test generators defined in the configuration file.');
    process.exit(0);
  }
}
export async function runMatchingGenerators(
  generators: Generator[],
  generatorName: string
) {
  let didRunAGenerator = false;
  let someFailed = false;
  for (const generator of generators) {
    if (generator.name === 'samples' || generator.name === 'manual') continue;
    if (generatorName === 'all' || generator.name === generatorName) {
      logger.log(
        `  ${logger.dim('→')} ${logger.highlight(generator.name)} ${logger.dim('(compiling and running...)')}`
      );
      try {
        await runGenerator(generator);
        const [start, end] = generator['tests-range'];
        const totalTests = end - start + 1;

        logger.log(
          `    ${logger.bold(`${totalTests}/${totalTests} test${totalTests > 1 ? 's' : ''}`)} generated successfully.`
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

export function handleGenerationError(
  error: unknown,
  isCancelationPoint = false
) {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(`${message}`);
  if (isCancelationPoint) process.exit(1);
}

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
function ensureTestsDirectory(): string {
  const testsDir = path.resolve(process.cwd(), 'tests');
  if (!fs.existsSync(testsDir)) {
    fs.mkdirSync(testsDir);
  }
  return testsDir;
}
