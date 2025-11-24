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
import { normalizeLineEndingsFromUnixToWin } from './utils';
import { GeneratorScriptCommand, LocalTestset, TestOptions } from '../../types';

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

      const code = normalizeLineEndingsFromUnixToWin(
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

    const code = normalizeLineEndingsFromUnixToWin(
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
                  normalizeLineEndingsFromUnixToWin(test.input),
                  normalizeLineEndingsFromUnixToWin(test.output),
                  normalizeLineEndingsFromUnixToWin(test.answer),
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

    const code = normalizeLineEndingsFromUnixToWin(
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
                  normalizeLineEndingsFromUnixToWin(test.input),
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

      const code = normalizeLineEndingsFromUnixToWin(
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
          statementData['legend'] = normalizeLineEndingsFromUnixToWin(
            fs.readFileSync(legendPath, 'utf-8')
          );
        }
      }

      if (statement.input) {
        const inputPath = path.resolve(problemDir, statement.input);
        if (fs.existsSync(inputPath)) {
          statementData['input'] = normalizeLineEndingsFromUnixToWin(
            fs.readFileSync(inputPath, 'utf-8')
          );
        }
      }

      if (statement.output) {
        const outputPath = path.resolve(problemDir, statement.output);
        if (fs.existsSync(outputPath)) {
          statementData['output'] = normalizeLineEndingsFromUnixToWin(
            fs.readFileSync(outputPath, 'utf-8')
          );
        }
      }

      if (statement.notes) {
        const notesPath = path.resolve(problemDir, statement.notes);
        if (fs.existsSync(notesPath)) {
          statementData['notes'] = normalizeLineEndingsFromUnixToWin(
            fs.readFileSync(notesPath, 'utf-8')
          );
        }
      }

      if (statement.tutorial) {
        const tutorialPath = path.resolve(problemDir, statement.tutorial);
        if (fs.existsSync(tutorialPath)) {
          statementData['tutorial'] = normalizeLineEndingsFromUnixToWin(
            fs.readFileSync(tutorialPath, 'utf-8')
          );
        }
      }

      if (statement.interaction) {
        const interactionPath = path.resolve(problemDir, statement.interaction);
        if (fs.existsSync(interactionPath)) {
          statementData['interaction'] = normalizeLineEndingsFromUnixToWin(
            fs.readFileSync(interactionPath, 'utf-8')
          );
        }
      }

      if (statement.scoring) {
        const scoringPath = path.resolve(problemDir, statement.scoring);
        if (fs.existsSync(scoringPath)) {
          statementData['scoring'] = normalizeLineEndingsFromUnixToWin(
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
    let currentIndex = 1;
    try {
      // clear testset
      await clearTestset(sdk, problemId, testset.name);

      // Enable groups if needed
      if (testset.groupsEnabled) {
        try {
          await sdk.enableGroups(problemId, testset.name, true);
        } catch (error) {
          logError(error);
        }
      }

      // Process generator script commands
      if (!testset.generatorScript?.commands) {
        fmt.warning(
          `  ⚠️  No generator script commands for testset: ${testset.name}`
        );
        continue;
      }
      const indeices = { currentIndex, manualsCount };
      // Upload manual tests
      const manualTestsPromises = createManaulTestsPromises(
        sdk,
        problemId,
        problemDir,
        testset,
        indeices
      );

      try {
        await Promise.all(manualTestsPromises);
      } catch (error) {
        logError(error);
      }

      currentIndex = indeices.currentIndex;
      manualsCount = indeices.manualsCount;

      const script = buildGenerationScript(testset.generatorScript.commands);

      // Upload generation script
      try {
        await sdk.saveScript(problemId, testset.name, script);
      } catch (error) {
        logError(error);
      }

      // add groups for generaeted tests
      for (const command of testset.generatorScript?.commands || []) {
        if (!command?.group) continue;
        try {
          const testUpdatePromises = [];
          const totalTests =
            command.type === 'generator' && command.range
              ? command.range[1] - command.range[0] + 1
              : 0;

          for (let i = 0; i < totalTests; i++) {
            testUpdatePromises.push(
              sdk.saveTest(problemId, testset.name, currentIndex++, '', {
                testGroup: command.group,
              })
            );
          }
          await Promise.all(testUpdatePromises);
        } catch (error) {
          logError(error);
        }
      }

      testsCount += testset.generatorScript?.commands?.length || 0;
    } catch (error) {
      logError(error);
    }
  }

  return { testsCount, manualsCount };
}

/**
 * Builds a FreeMarker generation script from commands.
 *
 * @param {Array} commands - Generator script commands
 * @returns {string} Generation script text
 */
function buildGenerationScript(
  commands: Array<GeneratorScriptCommand>
): string {
  const lines: string[] = [];

  for (const command of commands) {
    if (command.type === 'generator' && command.generator && command.range) {
      const [from, to] = command.range;
      lines.push(`<#list ${from}..${to} as i>`);
      lines.push(`${command.generator} \${i} > $`.trim());
      lines.push(`</#list>`);
    }
    // Manual tests are uploaded separately, not in the script
  }

  return lines.join('\n');
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

function createManaulTestsPromises(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  testset: LocalTestset,
  indeices: {
    currentIndex: number;
    manualsCount: number;
  }
): Array<Promise<void>> {
  const promises: Array<Promise<void>> = [];
  for (const command of testset?.generatorScript?.commands || []) {
    if (command.type === 'manual' && command.manualFile) {
      const testPath = path.resolve(problemDir, command.manualFile);
      if (!fs.existsSync(testPath)) {
        throw new Error(`Manual test file not found: ${command.manualFile}`);
      }

      const input = normalizeLineEndingsFromUnixToWin(
        fs.readFileSync(testPath, 'utf-8')
      );

      const options: TestOptions = {};
      if (command.group) options.testGroup = command.group;
      if (command.points !== undefined) options.testPoints = command.points;
      if (command.useInStatements) options.testUseInStatements = true;

      indeices.manualsCount++;
      promises.push(
        sdk.saveTest(
          problemId,
          testset.name,
          indeices.currentIndex++,
          input,
          options
        )
      );
    }
  }
  return promises;
}
