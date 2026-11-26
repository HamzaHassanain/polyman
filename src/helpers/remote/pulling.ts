/**
 * @fileoverview Helper functions for Polygon remote operations.
 * Handles credential management, SDK initialization, and remote operations.
 */

import fs from 'fs';
import path from 'path';
import { PolygonSDK } from '../../polygon';
import type {
  LocalChecker,
  LocalGenerator,
  LocalManualTest,
  LocalSolution,
  LocalValidator,
  LocalTestset,
  SolutionSourceType,
  StatementConfig,
  TestlibSourceType,
} from '../../types';
import { fmt } from '../../formatter';
import { normalizeLineEndingsFromRemoteToSystem } from './utils';
import { CPP_EXTENSIONS } from '../utils';
import { renamePublicClass } from '../java-class';
import { UNPRINTABLE, printable } from '../printable';

export { printable };

/**
 * Rejects names Polygon returns that are not a plain file name, so a hostile
 * or corrupted name such as `../../x` cannot make us write outside the
 * problem directory.
 *
 * @param {string} name - A file or language name received from Polygon
 * @returns {string} The same name
 * @throws {Error} When the name contains a path separator or a control
 *   character, or is `.`/`..`/empty
 */
export function assertPlainName(name: string): string {
  if (
    typeof name !== 'string' ||
    name === '' ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    UNPRINTABLE.test(name) ||
    path.basename(name) !== name
  ) {
    throw new Error(
      `Refusing unsafe name from Polygon: ${JSON.stringify(name)}`
    );
  }
  return name;
}

/**
 * Short reason for a failed download, so a refused name is not reported as a
 * generic failure.
 */
function reason(error: unknown): string {
  return printable(error instanceof Error ? error.message : String(error));
}

/**
 * A file `remote pull` could not download. The pull still writes everything
 * else, then ends with `ok: false` and a non-zero exit, like a failed upload
 * in `remote push`.
 *
 * @property {string} component - Report component (solution, generator,
 *   resource, checker, validator, statement, metadata)
 * @property {string} name - Which one, as named in the report actions
 * @property {string} error - Plain-text reason from Polygon
 * @property {string} message - Full line for the summary and the report
 *   `errors`
 */
export interface PullFailure {
  component: string;
  name: string;
  error: string;
  message: string;
}

/** Removes the extension, as Config.json names solutions and generators. */
function withoutExtension(name: string): string {
  return name.replace(/\.[^.]+$/, '');
}

/** Path used in Config.json when no solution could be downloaded. */
export const SOLUTION_PLACEHOLDER_SOURCE = './solutions/acc.cpp';

/** Path used in Config.json when Polygon has no validator to download. */
export const VALIDATOR_PLACEHOLDER_SOURCE = './validator/val.cpp';

/** Creates a placeholder's folder, without creating a fake source file. */
function ensurePlaceholderDirectory(problemDir: string, subdir: string): void {
  fs.mkdirSync(path.join(problemDir, subdir), { recursive: true });
}

/**
 * Downloads all solutions from Polygon and returns metadata.
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @param {string} problemDir - Target directory for solutions
 * @returns {Promise<{ data: Array<LocalSolution>; count: number; failures: PullFailure[]; placeholder?: string }>}
 *   `failures` has one entry per solution that could not be downloaded
 *   (Config.json does not list it). `placeholder` is a warning, set when no
 *   solution was downloaded and Config.json lists the main solution
 *   placeholder instead
 */
export async function downloadSolutions(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string
): Promise<{
  data: Array<LocalSolution>;
  count: number;
  failures: PullFailure[];
  placeholder?: string;
}> {
  const solutionsData: Array<LocalSolution> = [];
  const failures: PullFailure[] = [];
  let count = 0;
  let listError = '';

  try {
    const solutions = await sdk.getSolutions(problemId);
    for (const solution of solutions) {
      try {
        assertPlainName(solution.name);
        let code = await sdk.viewSolution(problemId, solution.name);
        // Polygon requires `public class Main`; locally the public class
        // must match the file name.
        if (path.extname(solution.name).toLowerCase() === '.java') {
          code = renamePublicClass(
            code,
            'Main',
            path.basename(solution.name, path.extname(solution.name))
          );
        }
        const targetPath = path.join(problemDir, 'solutions', solution.name);
        fs.writeFileSync(
          targetPath,
          normalizeLineEndingsFromRemoteToSystem(code),
          'utf-8'
        );
        count++;
        solutionsData.push({
          name: solution.name.replace(/\.[^.]+$/, ''),
          source: './solutions/' + solution.name,
          tag: solution.tag,
          ...(typeof solution.sourceType === 'string' &&
            solution.sourceType && {
              sourceType: solution.sourceType as SolutionSourceType,
            }),
        });
      } catch (error) {
        fmt.warning(
          `  ⚠️  Failed to download solution: ${printable(solution.name)} (${reason(error)})`
        );
        failures.push({
          component: 'solution',
          name: withoutExtension(printable(solution.name)),
          error: reason(error),
          message: `Could not download the solution ${printable(solution.name)} (${reason(error)}): Config.json does not list it`,
        });
      }
    }
  } catch (error) {
    listError = reason(error);
    fmt.error(
      `  ${fmt.cross()} Could not download Solution, adding ${SOLUTION_PLACEHOLDER_SOURCE} to be implemented`
    );
  }

  if (solutionsData.length === 0) {
    ensurePlaceholderDirectory(problemDir, 'solutions');
    solutionsData.push({
      name: 'main',
      source: SOLUTION_PLACEHOLDER_SOURCE,
      tag: 'MA' as const,
    });
    const why = listError
      ? `Could not download the solutions list (${listError})`
      : 'No solution was downloaded from Polygon';
    return {
      data: solutionsData,
      count,
      failures,
      placeholder: `${why}: ${SOLUTION_PLACEHOLDER_SOURCE} is listed in Config.json as the main solution but not created`,
    };
  }

  return { data: solutionsData, count, failures };
}

/**
 * Downloads checker from Polygon and returns metadata.
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @param {string} problemDir - Target directory for checker
 * @returns {Promise<{ data: LocalChecker; count: number; failures: PullFailure[]; placeholder?: string }>}
 *   `failures` has an entry when the checker tests could not be downloaded
 *   (Config.json then has no `testsFilePath` for the checker).
 *   `placeholder` is a warning, set when the download failed and Config.json
 *   uses the standard ncmp checker instead
 */
export async function downloadChecker(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string
): Promise<{
  data: LocalChecker;
  count: number;
  failures: PullFailure[];
  placeholder?: string;
}> {
  const failures: PullFailure[] = [];
  let count = 0;

  try {
    let checkerName = await sdk.getChecker(problemId);
    const isStandard = checkerName.includes('std::');
    checkerName = checkerName.replace(/std::/g, '');
    assertPlainName(checkerName);

    if (!isStandard) {
      const checkerCode = await sdk.viewFile(problemId, 'source', checkerName);
      const targetPath = path.join(problemDir, 'checker', checkerName);
      fs.writeFileSync(
        targetPath,
        normalizeLineEndingsFromRemoteToSystem(checkerCode),
        'utf-8'
      );
      count++;

      // Download checker tests
      try {
        const checkerTests = await sdk.getCheckerTests(problemId);
        // Normalize line endings in test inputs
        const normalizedTests = checkerTests.map(test => ({
          ...test,
          input: test.input
            ? normalizeLineEndingsFromRemoteToSystem(test.input)
            : test.input,
          output: test.output
            ? normalizeLineEndingsFromRemoteToSystem(test.output)
            : test.output,
          answer: test.answer
            ? normalizeLineEndingsFromRemoteToSystem(test.answer)
            : test.answer,
        }));
        const testsPath = path.join(
          problemDir,
          'checker',
          'checker_tests.json'
        );
        fs.writeFileSync(
          testsPath,
          JSON.stringify({ tests: normalizedTests }, null, 2),
          'utf-8'
        );
        count++;
      } catch (error) {
        fmt.warning('  ⚠️  Could not fetch checker tests');
        failures.push({
          component: 'checker',
          name: 'checker tests',
          error: reason(error),
          message: `Could not download the checker tests (${reason(error)}): Config.json has no testsFilePath for the checker, so its self-tests are skipped`,
        });
      }
    }

    return {
      data: {
        name: checkerName.replace(/\.[^.]+$/, ''),
        source: isStandard ? checkerName : './checker/' + checkerName,
        isStandard,
        ...(!isStandard &&
          failures.length === 0 && {
            testsFilePath: './checker/' + 'checker_tests.json',
          }),
      },
      count,
      failures,
    };
  } catch (error) {
    fmt.error(
      `  ${fmt.cross()} Could not download Checker (${reason(error)}), adding ncmp.cpp as default`
    );
    return {
      data: { name: 'ncmp', source: 'ncmp.cpp', isStandard: true },
      count: 0,
      failures,
      placeholder: `Could not download the checker (${reason(error)}): Config.json uses the standard checker ncmp.cpp instead`,
    };
  }
}

/**
 * Downloads validator from Polygon and returns metadata.
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @param {string} problemDir - Target directory for validator
 * @returns {Promise<{ data: LocalValidator; count: number; failures: PullFailure[]; missing?: boolean; placeholder?: string }>}
 *   `failures` has an entry when the validator tests could not be
 *   downloaded (Config.json then has no `testsFilePath` for the validator).
 *   `missing` is true when Polygon has no validator set for the problem.
 *   `placeholder` is a warning, set when the download failed and Config.json
 *   lists the validator placeholder instead
 */
export async function downloadValidator(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string
): Promise<{
  data: LocalValidator;
  count: number;
  failures: PullFailure[];
  missing?: boolean;
  placeholder?: string;
}> {
  const failures: PullFailure[] = [];
  let count = 0;

  try {
    const rawName = await sdk.getValidator(problemId);
    if (rawName === '') {
      fmt.warning(
        `  ⚠️  No validator set on Polygon for problem ${problemId}, adding ${VALIDATOR_PLACEHOLDER_SOURCE} to be implemented`
      );
      ensurePlaceholderDirectory(problemDir, 'validator');
      return {
        data: { name: 'validator', source: VALIDATOR_PLACEHOLDER_SOURCE },
        count: 0,
        failures,
        missing: true,
      };
    }
    const validatorName = assertPlainName(rawName);
    const validatorCode = await sdk.viewFile(
      problemId,
      'source',
      validatorName
    );
    const targetPath = path.join(problemDir, 'validator', validatorName);
    fs.writeFileSync(
      targetPath,
      normalizeLineEndingsFromRemoteToSystem(validatorCode),
      'utf-8'
    );
    count++;

    // Download validator tests
    try {
      const validatorTests = await sdk.getValidatorTests(problemId);
      // Normalize line endings in test inputs
      const normalizedTests = validatorTests.map(test => ({
        ...test,
        input: test.input
          ? normalizeLineEndingsFromRemoteToSystem(test.input)
          : test.input,
      }));
      const testsPath = path.join(
        problemDir,
        'validator',
        'validator_tests.json'
      );
      fs.writeFileSync(
        testsPath,
        JSON.stringify({ tests: normalizedTests }, null, 2),
        'utf-8'
      );
      count++;
    } catch (error) {
      fmt.warning('  ⚠️  Could not fetch validator tests');
      failures.push({
        component: 'validator',
        name: 'validator tests',
        error: reason(error),
        message: `Could not download the validator tests (${reason(error)}): Config.json has no testsFilePath for the validator, so its self-tests are skipped`,
      });
    }

    return {
      data: {
        name: validatorName.replace(/\.[^.]+$/, ''),
        source: './validator/' + validatorName,
        ...(failures.length === 0 && {
          testsFilePath: './validator/validator_tests.json',
        }),
      },
      count,
      failures,
    };
  } catch (error) {
    fmt.error(
      `  ${fmt.cross()} Could not download validator (${reason(error)}), adding ${VALIDATOR_PLACEHOLDER_SOURCE} to be implemented`
    );
    ensurePlaceholderDirectory(problemDir, 'validator');
    return {
      data: { name: 'validator', source: VALIDATOR_PLACEHOLDER_SOURCE },
      count: 0,
      failures,
      placeholder: `Could not download the validator (${reason(error)}): ${VALIDATOR_PLACEHOLDER_SOURCE} is listed in Config.json but not created, so verify will fail until you add it`,
    };
  }
}

/**
 * Names a resource file must not have: the problem folder already uses them.
 * Compared in lower case, for case-insensitive file systems.
 */
const RESERVED_RESOURCE_NAMES = new Set(['config.json', '.polyman']);

/**
 * Downloads generators and resource files from Polygon.
 *
 * Resource files (testlib.h, headers the sources include, ...) are saved in
 * the problem folder next to Config.json, where `download-testlib` puts
 * testlib.h and where the compiler looks for `#include "..."`.
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @param {string} problemDir - Target directory
 * @param {string[]} skipNames - Checker and validator names (without extension) to skip
 * @returns {Promise<{ data: Array<LocalGenerator>; count: number; failures: PullFailure[]; resources: string[]; placeholder?: string; sourceTypes: Record<string, string> }>}
 *   `failures` has one entry per file that could not be downloaded
 *   (Config.json does not list a generator, a resource file is not written).
 *   `resources` has the name of each resource file written to the problem
 *   folder. `placeholder` is a warning, set when the file list could not be
 *   fetched, so no generator and no resource file was downloaded.
 *   `sourceTypes` maps every source file name on Polygon (generators, the
 *   checker, the validator, ...) to its `sourceType`
 */
export async function downloadGenerators(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  skipNames: string[]
): Promise<{
  data: Array<LocalGenerator>;
  count: number;
  failures: PullFailure[];
  resources: string[];
  placeholder?: string;
  sourceTypes: Record<string, string>;
}> {
  const generatorsData: Array<LocalGenerator> = [];
  const failures: PullFailure[] = [];
  const resources: string[] = [];
  // No prototype: a Polygon file named `__proto__` or `constructor` must not
  // read back an inherited value.
  const sourceTypes: Record<string, string> = Object.create(null) as Record<
    string,
    string
  >;
  let count = 0;

  try {
    const files = await sdk.getFiles(problemId);
    for (const file of files.sourceFiles) {
      if (typeof file.sourceType === 'string' && file.sourceType) {
        sourceTypes[file.name] = file.sourceType;
      }
    }

    // Download generators (skip solutions, checker, validator)
    for (const file of files.sourceFiles) {
      if (
        file.sourceType?.includes('checker') ||
        file.sourceType?.includes('validator') ||
        file.sourceType?.startsWith('solution.') ||
        skipNames.some(name =>
          CPP_EXTENSIONS.some(ext => file.name === name + ext)
        )
      ) {
        continue;
      }

      try {
        assertPlainName(file.name);
        const content = await sdk.viewFile(problemId, 'source', file.name);
        const targetPath = path.join(problemDir, 'generators', file.name);
        fs.writeFileSync(
          targetPath,
          normalizeLineEndingsFromRemoteToSystem(content),
          'utf-8'
        );
        count++;
        generatorsData.push({
          name: file.name.replace(/\.[^.]+$/, ''),
          source: './generators/' + file.name,
          ...(typeof file.sourceType === 'string' &&
            file.sourceType && {
              sourceType: file.sourceType as TestlibSourceType,
            }),
        });
      } catch (error) {
        fmt.warning(
          `  ⚠️  Failed to download: ${printable(file.name)} (${reason(error)})`
        );
        failures.push({
          component: 'generator',
          name: withoutExtension(printable(file.name)),
          error: reason(error),
          message: `Could not download the generator ${printable(file.name)} (${reason(error)}): Config.json does not list it`,
        });
      }
    }

    // Resource files go next to Config.json, as on Polygon they are
    // available to every source of the problem.
    for (const file of files.resourceFiles ?? []) {
      try {
        assertPlainName(file.name);
        if (RESERVED_RESOURCE_NAMES.has(file.name.toLowerCase())) {
          throw new Error(
            `${file.name} is a polyman file in the problem folder`
          );
        }
        const content = await sdk.viewFile(problemId, 'resource', file.name);
        fs.writeFileSync(
          path.join(problemDir, file.name),
          normalizeLineEndingsFromRemoteToSystem(content),
          'utf-8'
        );
        count++;
        resources.push(file.name);
      } catch (error) {
        fmt.warning(
          `  ⚠️  Failed to download the resource file: ${printable(file.name)} (${reason(error)})`
        );
        failures.push({
          component: 'resource',
          name: printable(file.name),
          error: reason(error),
          message: `Could not download the resource file ${printable(file.name)} (${reason(error)}): it is not in the problem folder`,
        });
      }
    }
  } catch (error) {
    fmt.warning('  ⚠️  Could not fetch files');
    return {
      data: generatorsData,
      count,
      failures,
      resources,
      placeholder: `Could not fetch the problem files (${reason(error)}): Config.json lists no generators and no resource files were downloaded`,
      sourceTypes,
    };
  }

  return { data: generatorsData, count, failures, resources, sourceTypes };
}

/**
 * Downloads statements in all languages and saves as .tex files.
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @param {string} problemDir - Target directory
 * @returns {Promise<{ config: Record<string, StatementConfig>; count: number; problemName: string; failures: PullFailure[] }>}
 *   `failures` has one entry per statement language that was skipped, and
 *   one when the statements could not be downloaded
 */
export async function downloadStatements(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string
): Promise<{
  config: Record<string, StatementConfig>;
  count: number;
  problemName: string;
  failures: PullFailure[];
}> {
  const statementsConfig: Record<string, StatementConfig> = {};
  const failures: PullFailure[] = [];
  let count = 0;
  let problemName = 'problem';

  try {
    const statementsData = await sdk.getStatements(problemId);

    for (const [lang, statement] of Object.entries(statementsData)) {
      try {
        assertPlainName(lang);
      } catch (error) {
        fmt.warning(
          `  ⚠️  Skipping statement language ${printable(JSON.stringify(lang))} (${reason(error)})`
        );
        failures.push({
          component: 'statement',
          name: printable(lang),
          error: reason(error),
          message: `Could not download the statement ${printable(JSON.stringify(lang))} (${reason(error)}): Config.json does not list it`,
        });
        continue;
      }
      const langDir = path.join(problemDir, 'statements', lang);
      if (!fs.existsSync(langDir)) {
        fs.mkdirSync(langDir, { recursive: true });
      }

      // Extract problem name from first available statement
      if (!problemName || problemName === 'problem') {
        if (statement.name) {
          problemName = statement.name;
        }
      }

      const langConfig: Record<string, string> = {
        encoding: statement.encoding || 'UTF-8',
        name: statement.name || problemName,
      };

      // Save each statement component as .tex file
      if (statement.legend) {
        fs.writeFileSync(
          path.join(langDir, 'legend.tex'),
          normalizeLineEndingsFromRemoteToSystem(statement.legend),
          'utf-8'
        );
        langConfig['legend'] = `./statements/${lang}/legend.tex`;
        count++;
      }

      if (statement.input) {
        fs.writeFileSync(
          path.join(langDir, 'input-format.tex'),
          normalizeLineEndingsFromRemoteToSystem(statement.input),
          'utf-8'
        );
        langConfig['input'] = `./statements/${lang}/input-format.tex`;
        count++;
      }

      if (statement.output) {
        fs.writeFileSync(
          path.join(langDir, 'output-format.tex'),
          normalizeLineEndingsFromRemoteToSystem(statement.output),
          'utf-8'
        );
        langConfig['output'] = `./statements/${lang}/output-format.tex`;
        count++;
      }

      if (statement.notes) {
        fs.writeFileSync(
          path.join(langDir, 'notes.tex'),
          normalizeLineEndingsFromRemoteToSystem(statement.notes),
          'utf-8'
        );
        langConfig['notes'] = `./statements/${lang}/notes.tex`;
        count++;
      }

      if (statement.tutorial) {
        fs.writeFileSync(
          path.join(langDir, 'tutorial.tex'),
          normalizeLineEndingsFromRemoteToSystem(statement.tutorial),
          'utf-8'
        );
        langConfig['tutorial'] = `./statements/${lang}/tutorial.tex`;
        count++;
      }

      if (statement.interaction) {
        fs.writeFileSync(
          path.join(langDir, 'interaction.tex'),
          normalizeLineEndingsFromRemoteToSystem(statement.interaction),
          'utf-8'
        );
        langConfig['interaction'] = `./statements/${lang}/interaction.tex`;
        count++;
      }

      if (statement.scoring) {
        fs.writeFileSync(
          path.join(langDir, 'scoring.tex'),
          normalizeLineEndingsFromRemoteToSystem(statement.scoring),
          'utf-8'
        );
        langConfig['scoring'] = `./statements/${lang}/scoring.tex`;
        count++;
      }

      statementsConfig[lang] = langConfig as unknown as StatementConfig;
    }
  } catch (error) {
    fmt.warning('  ⚠️  Could not fetch statements');
    const listed = Object.keys(statementsConfig);
    failures.push({
      component: 'statement',
      name: 'statements',
      error: reason(error),
      message: `Could not download the statements (${reason(error)}): Config.json lists ${listed.length > 0 ? 'only ' + listed.join(', ') : 'no statements'}`,
    });
  }

  return { config: statementsConfig, count, problemName, failures };
}

/**
 * Fetches problem metadata (description and tags).
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @returns {Promise<{ description?: string; tags?: string[]; failures: PullFailure[] }>}
 *   A field that could not be downloaded is left out, so Config.json does not
 *   get an empty value that a later push would upload over the real one.
 *   `failures` has one entry per field that could not be downloaded.
 */
export async function fetchProblemMetadata(
  sdk: PolygonSDK,
  problemId: number
): Promise<{ description?: string; tags?: string[]; failures: PullFailure[] }> {
  const metadata: { description?: string; tags?: string[] } = {};
  const failures: PullFailure[] = [];

  try {
    metadata.description = await sdk.viewGeneralDescription(problemId);
  } catch (error) {
    fmt.warning(`  ⚠️  Could not fetch the description (${reason(error)})`);
    failures.push({
      component: 'metadata',
      name: 'description',
      error: reason(error),
      message: `Could not download the description (${reason(error)}): Config.json has no description, so push will not change it on Polygon`,
    });
  }

  try {
    metadata.tags = await sdk.viewTags(problemId);
  } catch (error) {
    fmt.warning(`  ⚠️  Could not fetch the tags (${reason(error)})`);
    failures.push({
      component: 'metadata',
      name: 'tags',
      error: reason(error),
      message: `Could not download the tags (${reason(error)}): Config.json has no tags, so push will not change them on Polygon`,
    });
  }

  return { ...metadata, failures };
}

/**
 * Downloads tests and builds testset configuration with generator scripts.
 *
 * @param {PolygonSDK} sdk - Polygon SDK instance
 * @param {number} problemId - Problem ID
 * @param {string} problemDir - Target directory
 * @param {string} testsetName - Name of testset (usually 'tests')
 * @param {LocalGenerator[]} generators - Available generators
 * @returns {Promise<{ testset: LocalTestset; manualCount: number }>}
 */
export async function downloadTestsetAndBuildGenerationScripts(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  testsetName: string,
  _generators: LocalGenerator[]
): Promise<{
  testset: LocalTestset;
  manualCount: number;
}> {
  const testsDir = path.join(problemDir, 'testsets', testsetName);
  const manualTestsDir = path.join(problemDir, 'manual', testsetName);
  if (!fs.existsSync(testsDir)) {
    fs.mkdirSync(testsDir, { recursive: true });
  }

  // Polygon owns the script text — store it verbatim, no parsing back.
  const generationScript = await sdk.getScript(problemId, testsetName);

  const tests = await sdk.getTests(problemId, testsetName, false);

  const manualTests: LocalManualTest[] = [];
  let manualCount = 0;

  for (const test of tests) {
    if (test.manual && test.input) {
      if (!Number.isInteger(test.index) || test.index < 0) {
        throw new Error(
          `Refusing unsafe test index from Polygon: ${printable(JSON.stringify(test.index))}`
        );
      }
      if (!fs.existsSync(manualTestsDir)) {
        fs.mkdirSync(manualTestsDir, { recursive: true });
      }

      const padded = String(test.index).padStart(2, '0');
      const inFilename = `m-${padded}.in`;
      const inPath = path.join(manualTestsDir, inFilename);
      fs.writeFileSync(inPath, test.input.replace(/\r\n/g, '\n'), 'utf-8');
      manualCount++;

      const entry: LocalManualTest = {
        input: `./manual/${testsetName}/${inFilename}`,
        index: test.index,
      };
      if (test.group) entry.group = test.group;
      if (test.points !== undefined) entry.points = test.points;
      if (test.useInStatements) entry.useInStatements = true;
      manualTests.push(entry);
    }
  }

  const testset: LocalTestset = {
    name: testsetName,
    generatorScript: {
      script: generationScript,
    },
  };

  if (manualTests.length > 0) {
    testset.manualTests = manualTests;
  }

  const hasGroups = tests.some(t => t.group);
  if (hasGroups) {
    testset.groupsEnabled = true;
    const groupNames = [
      ...new Set(tests.filter(t => t.group).map(t => t.group!)),
    ];
    testset.groups = groupNames.map(name => ({ name }));
  }

  const hasPoints = tests.some(t => t.points !== undefined);
  if (hasPoints) {
    testset.pointsEnabled = true;
  }

  return { testset, manualCount };
}
