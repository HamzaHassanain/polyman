import ConfigFile, { Generator, Solution, Validator } from './types';
import { logger } from './logger';
import { executor } from './executor';
import path from 'path';
import fs from 'fs';

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

export function readConfigFile(): ConfigFile {
  try {
    const configFilePath = path.resolve(process.cwd(), 'config.json');
    const configData = fs.readFileSync(configFilePath, 'utf-8');
    return JSON.parse(configData) as ConfigFile;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function runGenerator(generator: Generator) {
  // const spinner = logger.startSpinner(
  //   `Running generator: ${logger.highlight(generator.name)}\n`
  // );
  logger.info(`Running Generator: ${generator.name}`);
  try {
    const testsDir = path.resolve(process.cwd(), 'tests');
    const generatorSourcePath = path.resolve(process.cwd(), generator.source);

    if (!fs.existsSync(testsDir)) {
      fs.mkdirSync(testsDir);
    }

    const compiledPath = await compileCPP(generatorSourcePath);

    const [start, end] = generator['tests-range'];
    const totalTests = end - start + 1;

    for (let i = start; i <= end; i++) {
      const outputFilePath = path.join(testsDir, `test${i}.txt`);

      await executor.executeWithRedirect(
        `${compiledPath} ${i}`,
        {
          timeout: 5000,
          memoryLimitMB: 1024,
          silent: true,
          onError: result => {
            throw new Error(`Failed to generate test ${i}: ${result.stderr}`);
          },
        },
        undefined,
        outputFilePath
      );
    }

    logger.success(
      `Generator ${logger.highlight(generator.name)} created tests ${start}-${end} ${logger.dim(`(${totalTests} tests)`)}`
    );
  } catch (error) {
    logger.error(`Failed to run generator: ${generator.name}`);
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    executor.cleanup();
  }
}

export async function runValidator(validator: Validator) {
  // const spinner = logger.startSpinner('Running validator...\n');

  logger.info('Running Validator...');

  try {
    const testsDir = path.resolve(process.cwd(), 'tests');
    const validatorSourcePath = path.resolve(process.cwd(), validator.source);

    const compiledPath = await compileCPP(validatorSourcePath);

    const testFiles = fs.readdirSync(testsDir);
    let passedTests = 0;
    let failedTests = 0;

    for (const testFile of testFiles) {
      const testFilePath = path.join(testsDir, testFile);

      await executor.executeWithRedirect(
        compiledPath,
        {
          timeout: 5000,
          memoryLimitMB: 1024,
          silent: true,
          onSuccess: () => {
            passedTests++;
            logger.success(
              `Test ${logger.highlight(testFile)} passed validation`
            );
          },
          onError: () => {
            failedTests++;
            logger.error(
              `Test ${logger.highlight(testFile)} failed validation`
            );
          },
        },
        testFilePath,
        undefined
      );
    }

    // spinner.stop();

    if (failedTests > 0) {
      logger.warning(
        `Validation complete: ${logger.highlight(passedTests.toString())} passed, ${logger.highlight(failedTests.toString())} failed`
      );
      throw new Error(`${failedTests} test(s) failed validation`);
    } else {
      logger.success(
        `All ${logger.highlight(passedTests.toString())} test(s) passed validation!`
      );
    }
  } catch (error) {
    // spinner.stop();
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    executor.cleanup();
  }
}
export async function runSolution(
  solution: Solution,
  timeout: number,
  memoryLimitMB: number
) {
  // const spinner = logger.startSpinner(
  //   `Running solution: ${logger.highlight(solution.name)}\n`
  // );
  logger.info(`Running Solution: ${solution.name}`);

  try {
    const testsDir = path.resolve(process.cwd(), 'tests');
    const solutionSourcePath = path.resolve(process.cwd(), solution.source);

    if (!fs.existsSync(solutionSourcePath)) {
      throw new Error(`Solution file not found: ${solutionSourcePath}`);
    }

    const cmdToRun = await compileSolution(solutionSourcePath);

    const testFiles = fs.readdirSync(testsDir);

    const outputDir = path.resolve(process.cwd(), 'outputs', solution.name);

    if (fs.existsSync(outputDir)) {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
    fs.mkdirSync(outputDir, { recursive: true });

    for (const testFile of testFiles) {
      const testFilePath = path.join(testsDir, testFile);
      const testOutputDir = path.resolve(outputDir, `output_${testFile}`);

      await executor.executeWithRedirect(
        cmdToRun,
        {
          timeout,
          memoryLimitMB,
          silent: true,
          onError: result => {
            logger.error(
              `Solution ${logger.highlight(solution.name)} failed on test ${logger.highlight(testFile)}`
            );
            logger.error(`Error: ${result.stderr}`);
          },
          onTimeout: () => {
            logger.error(
              `Solution ${logger.highlight(solution.name)} timed out on test ${logger.highlight(testFile)}`
            );
          },
          onMemoryExceeded: () => {
            logger.error(
              `Solution ${logger.highlight(solution.name)} exceeded memory limit on test ${logger.highlight(testFile)}`
            );
          },
        },
        testFilePath,
        testOutputDir
      );
    }

    // spinner.succeed(
    //   `Solution ${logger.highlight(solution.name)} ran on all tests`
    // );
    logger.success(
      `Solution ${logger.highlight(solution.name)} ran on all tests`
    );
  } catch (error) {
    // spinner.fail(`Failed to run solution: ${solution.name}`);
    logger.error(`Failed to run solution: ${solution.name}`);
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    executor.cleanup();
  }
}

export async function compileSolution(sourcePath: string): Promise<string> {
  try {
    const ext = path.extname(sourcePath);
    switch (ext) {
      case '.cpp':
        return await compileCPP(sourcePath);
      case '.py':
        return `python3 ${sourcePath}`;
      case '.java':
        return await compileJava(sourcePath);
      default:
        throw new Error(`Unsupported solution file extension: ${ext}`);
    }
  } catch (error) {
    logger.error(`Failed to compile solution: ${sourcePath}`);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function compileCPP(sourcePath: string): Promise<string> {
  try {
    const ext = path.extname(sourcePath);

    if (ext !== '.cpp') {
      throw new Error(`Unsupported source file extension: ${ext}`);
    }

    const compileCommand = `g++ -o ${sourcePath.replace('.cpp', '')} ${sourcePath} -O2 -std=c++23`;

    await executor.execute(compileCommand, {
      timeout: 5000,
      // memoryLimitMB: 2048,
      silent: true,
    });

    return sourcePath.replace('.cpp', '');
  } catch (error) {
    logger.error(`Failed to compile: ${sourcePath}`);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function compileJava(sourcePath: string): Promise<string> {
  try {
    const absolutePath = path.resolve(sourcePath);
    const directory = path.dirname(absolutePath);
    const fileName = path.basename(absolutePath);
    const className = fileName.replace('.java', '');

    const compileCommand = `javac ${absolutePath}`;

    await executor.execute(compileCommand, {
      timeout: 5000,
      // memoryLimitMB: 2048,
      silent: true,
    });

    return `java -cp ${directory} ${className}`;
  } catch (error) {
    logger.error(`Failed to compile: ${sourcePath}`);
    throw error instanceof Error ? error : new Error(String(error));
  }
}
