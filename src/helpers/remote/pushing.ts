/**
 * @fileoverview Helper functions for pushing problems to Polygon.
 * Handles uploading problem files, solutions, tests, and configurations.
 */

import fs from 'fs';
import path from 'path';
import { CheckerTest, PolygonSDK, ValidatorTest } from '../../polygon';
import type ConfigFile from '../../types';
import { fmt } from '../../formatter';
import { logError, throwError } from '../utils';
import { normalizeLineEndingsFromSystemToRemote } from './utils';
import { LocalTestset, TestOptions } from '../../types';
import { readScriptText } from '../script-parser';
import { getResolvedTests } from '../testset';

/**
 * Uploads all solutions to Polygon.
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @param {string} problemDir - Problem directory path
 * @param {ConfigFile} config - Configuration file
 * @returns {Promise<number>} Number of solutions uploaded
 */
export async function uploadSolutions(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile
): Promise<number> {
  let count = 0;

  if (!config.solutions || config.solutions.length === 0) {
    return count;
  }

  for (const solution of config.solutions) {
    try {
      const solutionPath = path.resolve(problemDir, solution.source);
      if (!fs.existsSync(solutionPath)) {
        throw new Error(`Solution file not found: ${solution.source}`);
      }

      const code = normalizeLineEndingsFromSystemToRemote(
        fs.readFileSync(solutionPath, 'utf-8')
      );
      const filename = path.basename(solution.source);

      // Detect source type from extension
      const ext = path.extname(filename).toLowerCase();
      let sourceType = 'cpp.g++17'; // default
      if (ext === '.java') sourceType = 'java11';
      else if (ext === '.py') sourceType = 'python.3';
      else if (ext === '.cpp') sourceType = 'cpp.g++17';
      else if (ext === '.c') sourceType = 'c.gcc11';

      await sdk.saveSolution(problemId, filename, code, solution.tag, {
        sourceType,
        checkExisting: false,
      });
      count++;
    } catch {
      fmt.warning(`  ⚠️  Failed to upload solution: ${solution.name}`);
    }
  }

  return count;
}

/**
 * Uploads checker to Polygon.
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @param {string} problemDir - Problem directory path
 * @param {ConfigFile} config - Configuration file
 * @returns {Promise<number>} Number of files uploaded (0 or 1)
 */
export async function uploadChecker(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile
): Promise<number> {
  if (!config.checker) {
    return 0;
  }

  try {
    const { checker } = config;

    // If it's a standard checker, just set it
    if (checker.isStandard) {
      await sdk.setChecker(problemId, 'std::' + checker.source);
      return 1;
    }

    // Custom checker - upload file first, then set it
    const checkerPath = path.resolve(problemDir, checker.source);
    if (!fs.existsSync(checkerPath)) {
      throw new Error(`Checker file not found: ${checker.source}`);
    }

    const code = normalizeLineEndingsFromSystemToRemote(
      fs.readFileSync(checkerPath, 'utf-8')
    );
    const filename = path.basename(checker.source);

    await sdk.saveFile(problemId, 'source', filename, code, {
      sourceType: 'cpp.g++17',
      checkExisting: false,
    });

    await sdk.setChecker(problemId, filename);

    // Upload checker tests if available
    if (checker.testsFilePath) {
      const testsPath = path.resolve(problemDir, checker.testsFilePath);
      if (fs.existsSync(testsPath)) {
        try {
          const testsContent = fs.readFileSync(testsPath, 'utf-8');
          const testsData = JSON.parse(testsContent) as {
            tests?: Array<CheckerTest>;
          };
          if (testsData.tests) {
            for (const test of testsData.tests) {
              if (
                test.index &&
                test.input &&
                test.output &&
                test.answer &&
                test.expectedVerdict
              ) {
                const checkerVerdict = test.expectedVerdict;
                await sdk.saveCheckerTest(
                  problemId,
                  test.index,
                  normalizeLineEndingsFromSystemToRemote(test.input),
                  normalizeLineEndingsFromSystemToRemote(test.output),
                  normalizeLineEndingsFromSystemToRemote(test.answer),
                  checkerVerdict
                );
              }
            }
          }
        } catch {
          fmt.warning('  ⚠️  Failed to upload checker tests');
        }
      }
    }

    return 1;
  } catch (error) {
    throwError(error, '  ⚠️  Failed to upload checker');
  }
}

/**
 * Uploads validator to Polygon.
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @param {string} problemDir - Problem directory path
 * @param {ConfigFile} config - Configuration file
 * @returns {Promise<number>} Number of files uploaded (0 or 1)
 */
export async function uploadValidator(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile
): Promise<number> {
  if (!config.validator) {
    return 0;
  }

  try {
    const validatorPath = path.resolve(problemDir, config.validator.source);
    if (!fs.existsSync(validatorPath)) {
      throw new Error(`Validator file not found: ${config.validator.source}`);
    }

    const code = normalizeLineEndingsFromSystemToRemote(
      fs.readFileSync(validatorPath, 'utf-8')
    );
    const filename = path.basename(config.validator.source);

    await sdk.saveFile(problemId, 'source', filename, code, {
      sourceType: 'cpp.g++17',
      checkExisting: false,
    });

    await sdk.setValidator(problemId, filename);

    // Upload validator tests if available
    if (config.validator.testsFilePath) {
      const testsPath = path.resolve(
        problemDir,
        config.validator.testsFilePath
      );
      if (fs.existsSync(testsPath)) {
        try {
          const testsContent = fs.readFileSync(testsPath, 'utf-8');
          const testsData = JSON.parse(testsContent) as {
            tests?: Array<ValidatorTest>;
          };

          if (testsData.tests) {
            let index: number = 1;
            for (const test of testsData.tests) {
              if (test.input && test.expectedVerdict) {
                const validatorVerdict = test.expectedVerdict as
                  | 'VALID'
                  | 'INVALID';
                await sdk.saveValidatorTest(
                  problemId,
                  test.index ? test.index : index++,
                  normalizeLineEndingsFromSystemToRemote(test.input),
                  validatorVerdict
                );
              }
            }
          }
        } catch {
          fmt.warning('  ⚠️  Failed to upload validator tests');
        }
      }
    }

    return 1;
  } catch {
    fmt.warning('  ⚠️  Failed to upload validator');
    return 0;
  }
}

/**
 * Uploads generators to Polygon.
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @param {string} problemDir - Problem directory path
 * @param {ConfigFile} config - Configuration file
 * @returns {Promise<number>} Number of generators uploaded
 */
export async function uploadGenerators(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile
): Promise<number> {
  let count = 0;

  if (!config.generators || config.generators.length === 0) {
    return count;
  }

  for (const generator of config.generators) {
    try {
      const genPath = path.resolve(problemDir, generator.source);
      if (!fs.existsSync(genPath)) {
        throw new Error(`Generator file not found: ${generator.source}`);
      }

      const code = normalizeLineEndingsFromSystemToRemote(
        fs.readFileSync(genPath, 'utf-8')
      );
      const filename = path.basename(generator.source);

      // Detect source type from extension
      const ext = path.extname(filename).toLowerCase();
      let sourceType = 'cpp.g++17';
      if (ext === '.java') sourceType = 'java11';
      else if (ext === '.py') sourceType = 'python.3';
      else if (ext === '.cpp') sourceType = 'cpp.g++17';

      await sdk.saveFile(problemId, 'source', filename, code, {
        sourceType,
        checkExisting: false,
      });
      count++;
    } catch {
      fmt.warning(`  ⚠️  Failed to upload generator: ${generator.name}`);
    }
  }

  return count;
}

/**
 * Uploads statements to Polygon.
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @param {string} problemDir - Problem directory path
 * @param {ConfigFile} config - Configuration file
 * @returns {Promise<number>} Number of statement files uploaded
 */
export async function uploadStatements(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile
): Promise<number> {
  let count = 0;

  if (!config.statements) {
    return count;
  }

  for (const [lang, statement] of Object.entries(config.statements)) {
    try {
      const statementData: Record<string, string> = {
        encoding: statement.encoding || 'UTF-8',
        name: statement.name || config.name,
      };

      // Read each statement component file
      if (statement.legend) {
        const legendPath = path.resolve(problemDir, statement.legend);

        if (fs.existsSync(legendPath)) {
          statementData['legend'] = normalizeLineEndingsFromSystemToRemote(
            fs.readFileSync(legendPath, 'utf-8')
          );
        }
      }

      if (statement.input) {
        const inputPath = path.resolve(problemDir, statement.input);
        if (fs.existsSync(inputPath)) {
          statementData['input'] = normalizeLineEndingsFromSystemToRemote(
            fs.readFileSync(inputPath, 'utf-8')
          );
        }
      }

      if (statement.output) {
        const outputPath = path.resolve(problemDir, statement.output);
        if (fs.existsSync(outputPath)) {
          statementData['output'] = normalizeLineEndingsFromSystemToRemote(
            fs.readFileSync(outputPath, 'utf-8')
          );
        }
      }

      if (statement.notes) {
        const notesPath = path.resolve(problemDir, statement.notes);
        if (fs.existsSync(notesPath)) {
          statementData['notes'] = normalizeLineEndingsFromSystemToRemote(
            fs.readFileSync(notesPath, 'utf-8')
          );
        }
      }

      if (statement.tutorial) {
        const tutorialPath = path.resolve(problemDir, statement.tutorial);
        if (fs.existsSync(tutorialPath)) {
          statementData['tutorial'] = normalizeLineEndingsFromSystemToRemote(
            fs.readFileSync(tutorialPath, 'utf-8')
          );
        }
      }

      if (statement.interaction) {
        const interactionPath = path.resolve(problemDir, statement.interaction);
        if (fs.existsSync(interactionPath)) {
          statementData['interaction'] = normalizeLineEndingsFromSystemToRemote(
            fs.readFileSync(interactionPath, 'utf-8')
          );
        }
      }

      if (statement.scoring) {
        const scoringPath = path.resolve(problemDir, statement.scoring);
        if (fs.existsSync(scoringPath)) {
          statementData['scoring'] = normalizeLineEndingsFromSystemToRemote(
            fs.readFileSync(scoringPath, 'utf-8')
          );
        }
      }

      await sdk.saveStatement(problemId, lang, statementData);
      count++;
    } catch {
      fmt.warning(`  ⚠️  Failed to upload statement for language: ${lang}`);
    }
  }

  return count;
}

/**
 * Uploads problem metadata (description and tags).
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @param {ConfigFile} config - Configuration file
 * @returns {Promise<number>} Number of metadata items uploaded (0-2)
 */
export async function uploadMetadata(
  sdk: PolygonSDK,
  problemId: number,
  config: ConfigFile
): Promise<number> {
  let count = 0;

  // Upload description
  if (config.description !== undefined) {
    try {
      await sdk.saveGeneralDescription(problemId, config.description);
      count++;
    } catch {
      fmt.warning('  ⚠️  Failed to upload description');
    }
  }

  // Upload tags
  if (config.tags) {
    try {
      await sdk.saveTags(problemId, config.tags);
      count++;
    } catch {
      fmt.warning('  ⚠️  Failed to upload tags');
    }
  }

  return count;
}

/**
 * Uploads testset configuration and tests.
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @param {string} problemDir - Problem directory path
 * @param {ConfigFile} config - Configuration file
 * @returns {Promise<{ testsCount: number; manualsCount: number }>}
 */
export async function uploadTestsets(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile
): Promise<{ testsCount: number; manualsCount: number }> {
  let testsCount = 0;
  let manualsCount = 0;

  if (!config.testsets || config.testsets.length === 0) {
    return { testsCount, manualsCount };
  }

  for (const testset of config.testsets) {
    try {
      // Read the script up front so a missing scriptFile aborts before we
      // clear the remote testset. Resolve scriptFile against problemDir,
      // not cwd, so push works from any directory.
      const scriptText = readScriptText(testset, problemDir);

      await clearTestset(sdk, problemId, testset.name);

      if (testset.groupsEnabled) {
        try {
          await sdk.enableGroups(problemId, testset.name, true);
        } catch (error) {
          logError(error);
        }
      }

      // Upload manual test inputs (each takes its declared index).
      const manualPromises = createManualTestsPromises(
        sdk,
        problemId,
        problemDir,
        testset
      );
      try {
        await Promise.all(manualPromises);
        manualsCount += testset.manualTests?.length ?? 0;
      } catch (error) {
        logError(error);
      }

      // Upload the generator script verbatim — Polygon parses it itself.
      try {
        await sdk.saveScript(problemId, testset.name, scriptText);
      } catch (error) {
        logError(error);
      }

      // Apply per-test metadata (group, points, useInStatements) on tests
      // produced by the script. Manuals already carried theirs at saveTest.
      const allTests = (() => {
        try {
          return getResolvedTests(testset, config.generators ?? [], problemDir);
        } catch {
          return [];
        }
      })();
      for (const t of allTests) {
        if (t.source.kind !== 'generator') continue;
        if (
          t.group === undefined &&
          t.points === undefined &&
          t.useInStatements === undefined
        ) {
          continue;
        }
        const opts: TestOptions = {};
        if (t.group !== undefined) opts.testGroup = t.group;
        if (t.points !== undefined) opts.testPoints = t.points;
        if (t.useInStatements) opts.testUseInStatements = true;
        try {
          await sdk.saveTest(problemId, testset.name, t.index, '', opts);
        } catch (error) {
          logError(error);
        }
      }

      testsCount += allTests.length;
    } catch (error) {
      logError(error);
    }
  }

  return { testsCount, manualsCount };
}

/**
 * Updates problem information on Polygon.
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @param {ConfigFile} config - Configuration file
 * @returns {Promise<void>}
 */
export async function updateProblemInfo(
  sdk: PolygonSDK,
  problemId: number,
  config: ConfigFile
): Promise<void> {
  const info: Record<string, string | number | boolean> = {};

  if (config.inputFile) info['inputFile'] = config.inputFile;
  if (config.outputFile) info['outputFile'] = config.outputFile;
  if (config.interactive !== undefined)
    info['interactive'] = config.interactive;
  if (config.timeLimit) info['timeLimit'] = config.timeLimit;
  if (config.memoryLimit) info['memoryLimit'] = config.memoryLimit;

  await sdk.updateProblemInfo(problemId, info);
}

async function clearTestset(
  sdk: PolygonSDK,
  problemId: number,
  testsetName: string
): Promise<void> {
  const allPromises = [
    sdk.enableGroups(problemId, testsetName, false),
    sdk.saveScript(problemId, testsetName, ' '),
    sdk.enableGroups(problemId, testsetName, false),
  ];
  try {
    await Promise.all(allPromises);
  } catch (error) {
    fmt.warning(
      `  ⚠️  Failed to clear testset: ${testsetName}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function createManualTestsPromises(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  testset: LocalTestset
): Array<Promise<void>> {
  const promises: Array<Promise<void>> = [];
  for (const m of testset.manualTests ?? []) {
    const testPath = path.resolve(problemDir, m.input);
    if (!fs.existsSync(testPath)) {
      throw new Error(`Manual test file not found: ${m.input}`);
    }

    const input = normalizeLineEndingsFromSystemToRemote(
      fs.readFileSync(testPath, 'utf-8')
    );

    const options: TestOptions = {};
    if (m.group !== undefined) options.testGroup = m.group;
    if (m.points !== undefined) options.testPoints = m.points;
    if (m.useInStatements) options.testUseInStatements = true;

    promises.push(
      sdk.saveTest(problemId, testset.name, m.index, input, options)
    );
  }
  return promises;
}
