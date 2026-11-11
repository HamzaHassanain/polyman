/**
 * @fileoverview Helper functions for pushing problems to Polygon.
 * Handles uploading problem files, solutions, tests, and configurations.
 */

import fs from 'fs';
import path from 'path';
import { CheckerTest, PolygonSDK, ValidatorTest } from '../../polygon';
import type ConfigFile from '../../types';
import { fmt } from '../../formatter';
import { insideProblem, isCppSource, logError, throwError } from '../utils';
import { normalizeLineEndingsFromSystemToRemote } from './utils';
import { LocalManualTest, LocalTestset, TestOptions } from '../../types';
import { readScriptText, toPolygonScript } from '../script-parser';
import { getResolvedTests } from '../testset';
import {
  STATEMENT_SECTIONS,
  readGeneratorPayload,
  readNormalizedFile,
  readSolutionPayload,
  readSourcePayload,
} from './local-payloads';

/** Polygon compiler used for C++ files that do not declare a `sourceType`. */
export const DEFAULT_CPP_SOURCE_TYPE = 'cpp.g++17';

/** Polygon compiler used for Java files that do not declare a `sourceType`. */
export const DEFAULT_JAVA_SOURCE_TYPE = 'java21';

/** Java source types Polygon accepts (`java11` and dotted forms are rejected). */
export const POLYGON_JAVA_SOURCE_TYPES = ['java8', 'java21'] as const;

/**
 * Picks the Polygon `sourceType` for a file: the value declared in
 * `Config.json` wins; otherwise it is inferred from the extension.
 * A declared Java type that Polygon does not accept (e.g. `java.11`) throws
 * instead of being sent and refused.
 *
 * @param {string} filename - File name (extension decides the fallback)
 * @param {string} [declared] - `sourceType` from the config entry, if any
 * @returns {string} Polygon compiler identifier (e.g. `cpp.gcc14-64-msys2-g++23`)
 * @throws {Error} If the declared type is an unsupported Java type
 *
 * @example
 * resolveSourceType('sol.cc');                              // 'cpp.g++17'
 * resolveSourceType('sol.cpp', 'cpp.gcc14-64-msys2-g++23'); // declared wins
 * resolveSourceType('Sol.java');                            // 'java21'
 */
export function resolveSourceType(filename: string, declared?: string): string {
  const trimmed = declared?.trim();
  if (trimmed) {
    if (
      trimmed.toLowerCase().startsWith('java') &&
      !(POLYGON_JAVA_SOURCE_TYPES as readonly string[]).includes(trimmed)
    ) {
      throw new Error(
        `Unsupported Java sourceType '${trimmed}'. Polygon accepts: ${POLYGON_JAVA_SOURCE_TYPES.join(', ')}`
      );
    }
    return trimmed;
  }
  if (isCppSource(filename)) return DEFAULT_CPP_SOURCE_TYPE;

  const ext = path.extname(filename).toLowerCase();
  if (ext === '.java') return DEFAULT_JAVA_SOURCE_TYPE;
  if (ext === '.py') return 'python.3';
  if (ext === '.c') return 'c.gcc11';
  return DEFAULT_CPP_SOURCE_TYPE;
}

/**
 * Formats an unknown thrown value as a one-line message for warnings.
 */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Adds a one-line failure to the caller's list, so the push summary can
 * list what did not reach Polygon and set a non-zero exit code.
 */
function recordFailure(
  failures: string[],
  label: string,
  error: unknown
): void {
  failures.push(`${label}: ${describeError(error)}`);
}

/**
 * Uploads all solutions to Polygon.
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @param {string} problemDir - Problem directory path
 * @param {ConfigFile} config - Configuration file
 * @param {string[]} [failures] - Collects one line per item that failed to upload
 * @returns {Promise<number>} Number of solutions uploaded
 */
export async function uploadSolutions(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile,
  failures: string[] = []
): Promise<number> {
  let count = 0;

  if (!config.solutions || config.solutions.length === 0) {
    return count;
  }

  for (const solution of config.solutions) {
    try {
      // A Java solution gets its public class renamed to `Main` inside the
      // reader: Polygon requires it, while locally the class must match the
      // file name.
      const { filename, content: code } = readSolutionPayload(
        problemDir,
        solution
      );

      const sourceType = resolveSourceType(filename, solution.sourceType);

      await sdk.saveSolution(problemId, filename, code, solution.tag, {
        sourceType,
        checkExisting: false,
      });
      count++;
    } catch (error) {
      fmt.warning(
        `  ⚠️  Failed to upload solution: ${solution.name}: ${describeError(error)}`
      );
      recordFailure(failures, `solution ${solution.name}`, error);
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
 * @param {string[]} [failures] - Collects one line per item that failed to upload
 * @returns {Promise<number>} Number of files uploaded (0 or 1)
 */
export async function uploadChecker(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile,
  failures: string[] = []
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
    // Resolve the tests path now so a refusal leaves nothing half-uploaded.
    const testsPath = checker.testsFilePath
      ? insideProblem(problemDir, checker.testsFilePath)
      : undefined;

    const { filename, content: code } = readSourcePayload(
      problemDir,
      checker.source,
      'Checker'
    );

    await sdk.saveFile(problemId, 'source', filename, code, {
      sourceType: resolveSourceType(filename, checker.sourceType),
      checkExisting: false,
    });

    await sdk.setChecker(problemId, filename);

    // Upload checker tests if available
    if (testsPath) {
      if (fs.existsSync(testsPath)) {
        try {
          const testsContent = fs.readFileSync(testsPath, 'utf-8');
          const testsData = JSON.parse(testsContent) as {
            tests?: Array<Partial<CheckerTest>>;
          };
          if (testsData.tests) {
            // Tests without a valid index get the next number that no test
            // declares explicitly, so they can't overwrite one another.
            const indexes = testsData.tests.map((test, position) => {
              const raw: unknown = test.index;
              if (raw === undefined || raw === null) return undefined;
              const value = Number(raw);
              if (Number.isInteger(value) && value > 0) return value;
              fmt.warning(
                `  ⚠️  Checker test #${position + 1} has an invalid index (${JSON.stringify(raw)}); it will be numbered automatically`
              );
              return undefined;
            });
            const declared = new Set<number>();
            for (const [position, value] of indexes.entries()) {
              if (value === undefined) continue;
              if (declared.has(value)) {
                fmt.warning(
                  `  ⚠️  Checker test #${position + 1} repeats index ${value}; it overwrites the earlier test with that index`
                );
              }
              declared.add(value);
            }
            let nextIndex = 1;
            const takeNextIndex = (): number => {
              while (declared.has(nextIndex)) nextIndex++;
              return nextIndex++;
            };

            for (const [position, test] of testsData.tests.entries()) {
              // Empty input, output and answer are valid checker tests (an
              // empty contestant output, say); only absence is an error.
              const { input, output, answer, expectedVerdict } = test;
              if (
                typeof input !== 'string' ||
                typeof output !== 'string' ||
                typeof answer !== 'string' ||
                !expectedVerdict
              ) {
                const missing = (
                  ['input', 'output', 'answer', 'expectedVerdict'] as const
                ).filter(field =>
                  field === 'expectedVerdict'
                    ? !test[field]
                    : typeof test[field] !== 'string'
                );
                fmt.warning(
                  `  ⚠️  Skipped checker test #${position + 1}: missing ${missing.join(', ')}`
                );
                continue;
              }

              const index = indexes[position] ?? takeNextIndex();
              try {
                await sdk.saveCheckerTest(
                  problemId,
                  index,
                  normalizeLineEndingsFromSystemToRemote(input),
                  normalizeLineEndingsFromSystemToRemote(output),
                  normalizeLineEndingsFromSystemToRemote(answer),
                  expectedVerdict
                );
              } catch (error) {
                fmt.warning(
                  `  ⚠️  Failed to upload checker test #${position + 1}: ${describeError(error)}`
                );
                recordFailure(failures, `checker test #${position + 1}`, error);
              }
            }
          }
        } catch (error) {
          fmt.warning(
            `  ⚠️  Failed to upload checker tests: ${describeError(error)}`
          );
          recordFailure(failures, 'checker tests', error);
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
 * @param {string[]} [failures] - Collects one line per item that failed to upload
 * @returns {Promise<number>} Number of files uploaded (0 or 1)
 */
export async function uploadValidator(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile,
  failures: string[] = []
): Promise<number> {
  if (!config.validator) {
    return 0;
  }

  try {
    // Resolve the tests path now so a refusal leaves nothing half-uploaded.
    const testsPath = config.validator.testsFilePath
      ? insideProblem(problemDir, config.validator.testsFilePath)
      : undefined;

    const { filename, content: code } = readSourcePayload(
      problemDir,
      config.validator.source,
      'Validator'
    );

    await sdk.saveFile(problemId, 'source', filename, code, {
      sourceType: resolveSourceType(filename, config.validator.sourceType),
      checkExisting: false,
    });

    await sdk.setValidator(problemId, filename);

    // Upload validator tests if available
    if (testsPath) {
      if (fs.existsSync(testsPath)) {
        try {
          const testsContent = fs.readFileSync(testsPath, 'utf-8');
          const testsData = JSON.parse(testsContent) as {
            tests?: Array<ValidatorTest>;
          };

          if (testsData.tests) {
            let index: number = 1;
            for (const [position, test] of testsData.tests.entries()) {
              if (test.input && test.expectedVerdict) {
                const validatorVerdict = test.expectedVerdict;
                // One rejected test must not stop the rest from uploading.
                try {
                  await sdk.saveValidatorTest(
                    problemId,
                    test.index ? test.index : index++,
                    normalizeLineEndingsFromSystemToRemote(test.input),
                    validatorVerdict
                  );
                } catch (error) {
                  fmt.warning(
                    `  ⚠️  Failed to upload validator test #${position + 1}: ${describeError(error)}`
                  );
                  recordFailure(
                    failures,
                    `validator test #${position + 1}`,
                    error
                  );
                }
              }
            }
          }
        } catch (error) {
          fmt.warning(
            `  ⚠️  Failed to upload validator tests: ${describeError(error)}`
          );
          recordFailure(failures, 'validator tests', error);
        }
      }
    }

    return 1;
  } catch (error) {
    fmt.warning(`  ⚠️  Failed to upload validator: ${describeError(error)}`);
    recordFailure(failures, 'validator', error);
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
 * @param {string[]} [failures] - Collects one line per item that failed to upload
 * @returns {Promise<number>} Number of generators uploaded
 */
export async function uploadGenerators(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile,
  failures: string[] = []
): Promise<number> {
  let count = 0;

  if (!config.generators || config.generators.length === 0) {
    return count;
  }

  for (const generator of config.generators) {
    try {
      const { filename, content: code } = readGeneratorPayload(
        problemDir,
        generator
      );

      const sourceType = resolveSourceType(filename, generator.sourceType);

      await sdk.saveFile(problemId, 'source', filename, code, {
        sourceType,
        checkExisting: false,
      });
      count++;
    } catch (error) {
      fmt.warning(
        `  ⚠️  Failed to upload generator: ${generator.name}: ${describeError(error)}`
      );
      recordFailure(failures, `generator ${generator.name}`, error);
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
 * @param {string[]} [failures] - Collects one line per item that failed to upload
 * @returns {Promise<number>} Number of statement files uploaded
 */
export async function uploadStatements(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile,
  failures: string[] = []
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

      // Read each statement section that is configured and present locally.
      for (const section of STATEMENT_SECTIONS) {
        const sectionSource = statement[section];
        if (!sectionSource) continue;
        const sectionPath = insideProblem(problemDir, sectionSource);
        if (fs.existsSync(sectionPath)) {
          statementData[section] = readNormalizedFile(sectionPath);
        }
      }

      await sdk.saveStatement(problemId, lang, statementData);
      count++;
    } catch (error) {
      fmt.warning(
        `  ⚠️  Failed to upload statement for language: ${lang}: ${describeError(error)}`
      );
      recordFailure(failures, `statement ${lang}`, error);
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
 * @param {string[]} [failures] - Collects one line per item that failed to upload
 * @returns {Promise<number>} Number of metadata items uploaded (0-2)
 */
export async function uploadMetadata(
  sdk: PolygonSDK,
  problemId: number,
  config: ConfigFile,
  failures: string[] = []
): Promise<number> {
  let count = 0;

  // Upload description
  if (config.description !== undefined) {
    try {
      await sdk.saveGeneralDescription(problemId, config.description);
      count++;
    } catch (error) {
      fmt.warning(
        `  ⚠️  Failed to upload description: ${describeError(error)}`
      );
      recordFailure(failures, 'description', error);
    }
  }

  // Upload tags
  if (config.tags) {
    try {
      await sdk.saveTags(problemId, config.tags);
      count++;
    } catch (error) {
      fmt.warning(`  ⚠️  Failed to upload tags: ${describeError(error)}`);
      recordFailure(failures, 'tags', error);
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
 * @param {string[]} [failures] - Collects one line per item that failed to upload
 * @returns {Promise<{ testsCount: number; manualsCount: number }>}
 */
export async function uploadTestsets(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile,
  failures: string[] = []
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

      // Likewise refuse manual test paths outside the problem folder before
      // anything is cleared on Polygon.
      const manualPaths = (testset.manualTests ?? []).map(m =>
        insideProblem(problemDir, m.input)
      );

      await clearTestset(sdk, problemId, testset.name, failures);

      if (testset.groupsEnabled) {
        try {
          await sdk.enableGroups(problemId, testset.name, true);
        } catch (error) {
          logError(error);
          recordFailure(failures, `testset ${testset.name} groups`, error);
        }
      }

      // Upload manual test inputs (each takes its declared index). A missing
      // file or a failed upload is recorded and the push goes on; every
      // started upload is awaited so none of them rejects unhandled.
      manualsCount += await uploadManualTests(
        sdk,
        problemId,
        manualPaths,
        testset,
        failures
      );

      // Upload the generator script — Polygon parses it itself, but it
      // resolves generator tokens against source file names (without
      // extension) rather than Config.json names, so rewrite those first.
      const generators = config.generators ?? [];
      try {
        await sdk.saveScript(
          problemId,
          testset.name,
          toPolygonScript(scriptText, generators)
        );
      } catch (error) {
        logError(error);
        recordFailure(failures, `testset ${testset.name} script`, error);
      }

      // Apply per-test metadata on tests produced by the script. Manuals
      // already carried theirs at saveTest.
      const allTests = (() => {
        try {
          return getResolvedTests(testset, generators, problemDir);
        } catch (error) {
          logError(error);
          recordFailure(failures, `testset ${testset.name} tests`, error);
          return [];
        }
      })();

      // Script lines only carry a group (points/useInStatements are manual
      // test properties). setTestGroup targets existing tests by index and
      // needs no test input, unlike saveTest which rejects an empty
      // testInput. One call per group.
      const indicesByGroup = new Map<string, number[]>();
      for (const t of allTests) {
        if (t.source.kind !== 'generator' || t.group === undefined) continue;
        const list = indicesByGroup.get(t.group) ?? [];
        list.push(t.index);
        indicesByGroup.set(t.group, list);
      }
      for (const [group, indices] of indicesByGroup) {
        try {
          await sdk.setTestGroup(problemId, testset.name, group, indices);
        } catch (error) {
          logError(error);
          recordFailure(
            failures,
            `testset ${testset.name} group ${group}`,
            error
          );
        }
      }

      testsCount += allTests.length;
    } catch (error) {
      logError(error);
      recordFailure(failures, `testset ${testset.name}`, error);
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
 * @param {string[]} [failures] - Collects one line per item that failed to upload
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
  testsetName: string,
  failures: string[]
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
      `  ⚠️  Failed to clear testset: ${testsetName}: ${describeError(error)}`
    );
    recordFailure(failures, `testset ${testsetName} clear`, error);
  }
}

/**
 * Uploads the manual tests of a testset. Every input is read before any
 * upload starts, so a missing file cannot leave started uploads behind.
 * Missing files and failed uploads are recorded in `failures`, and all
 * uploads are awaited, so none of them rejects unhandled.
 *
 * @returns {Promise<number>} The number of manual tests uploaded
 */
async function uploadManualTests(
  sdk: PolygonSDK,
  problemId: number,
  manualPaths: string[],
  testset: LocalTestset,
  failures: string[]
): Promise<number> {
  const ready: Array<{ m: LocalManualTest; input: string }> = [];
  for (const [position, m] of (testset.manualTests ?? []).entries()) {
    const label = `testset ${testset.name} manual test ${m.input}`;
    try {
      const testPath = manualPaths[position];
      if (!fs.existsSync(testPath)) {
        throw new Error(`Manual test file not found: ${m.input}`);
      }
      ready.push({ m, input: readNormalizedFile(testPath) });
    } catch (error) {
      logError(error);
      recordFailure(failures, label, error);
    }
  }

  const results = await Promise.allSettled(
    ready.map(({ m, input }) => {
      const options: TestOptions = {};
      if (m.group !== undefined) options.testGroup = m.group;
      if (m.points !== undefined) options.testPoints = m.points;
      if (m.useInStatements) options.testUseInStatements = true;
      return sdk.saveTest(problemId, testset.name, m.index, input, options);
    })
  );

  let uploaded = 0;
  for (const [i, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      uploaded++;
      continue;
    }
    logError(result.reason);
    recordFailure(
      failures,
      `testset ${testset.name} manual test ${ready[i].m.input}`,
      result.reason
    );
  }
  return uploaded;
}
