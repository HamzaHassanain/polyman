/**
 * @fileoverview Compares a local problem with what is on Polygon.
 *
 * A push overwrites, so the question a setter needs answered before one is:
 * what is different, and which side wins. This reads the local files through
 * the same readers `push` uses (`local-payloads.ts`), fetches the matching
 * remote content, and reports one status per component. It never writes to
 * Polygon, and never writes to disk.
 *
 * What it does not compare:
 * - Generated test contents. They are a product of the script and the
 *   generator binaries, so the script is compared instead.
 * - Compiler choices (`sourceType`), limits, tags and the problem title.
 * - Testsets that exist only on Polygon. Polygon has no endpoint that lists
 *   the testsets of a problem, so those cannot be detected here; each such
 *   gap is reported as a warning.
 */

import type ConfigFile from '../../types';
import {
  DiffComponent,
  DiffStatus,
  LocalTestset,
  Statement,
} from '../../types';
import type { PolygonSDK } from '../../polygon';
import {
  readGeneratorPayload,
  readManualTestPayload,
  readScriptPayload,
  readSolutionPayload,
  readSourcePayload,
  readStatementPayloads,
} from './local-payloads';

/**
 * The outcome of comparing one problem against Polygon.
 * @interface ProblemDiff
 * @property {DiffComponent[]} components - One entry per compared component
 * @property {string[]} warnings - What could not be compared, and why
 */
export interface ProblemDiff {
  components: DiffComponent[];
  warnings: string[];
}

/**
 * Compares two texts the way a push would put them on Polygon.
 *
 * A local file is normalized to CRLF before upload, so both sides are reduced
 * to `\n` here. Only the line endings are dropped: the existing
 * `normalizeLineEndingsFromWinToUnix` also collapses runs of blank lines, and
 * using it would hide a real edit that added one.
 */
function sameContent(local: string, remote: string): boolean {
  const toLf = (text: string): string => text.replace(/\r\n/g, '\n');
  return toLf(local) === toLf(remote);
}

/** Picks the status for two texts that are both present. */
function statusOf(local: string, remote: string): DiffStatus {
  return sameContent(local, remote) ? 'same' : 'changed';
}

/**
 * Reads one remote text, or `undefined` when Polygon does not have it.
 * A request that fails for another reason is recorded as a warning, so a
 * component that could not be checked is never reported as `same`.
 */
async function fetchRemote(
  warnings: string[],
  label: string,
  fetch: () => Promise<string>
): Promise<string | undefined> {
  try {
    return await fetch();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    warnings.push(`${label}: could not read it from Polygon (${reason})`);
    return undefined;
  }
}

/** Solutions: compared by file name, the name `push` uploads them under. */
async function diffSolutions(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile,
  components: DiffComponent[],
  warnings: string[]
): Promise<void> {
  let remote: Awaited<ReturnType<PolygonSDK['getSolutions']>>;
  try {
    remote = await sdk.getSolutions(problemId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    warnings.push(`solutions: could not be listed (${reason})`);
    return;
  }
  const remoteNames = new Set(remote.map(solution => solution.name));
  const localNames = new Set<string>();

  for (const solution of config.solutions ?? []) {
    try {
      // The Java class rename `push` applies is already in this text, so a
      // Java solution pulled from Polygon compares as `same`.
      const { filename, content } = readSolutionPayload(problemDir, solution);
      localNames.add(filename);
      if (!remoteNames.has(filename)) {
        components.push({
          component: 'solution',
          name: filename,
          status: 'local-only',
        });
        continue;
      }
      const remoteText = await fetchRemote(
        warnings,
        `solution ${filename}`,
        () => sdk.viewSolution(problemId, filename)
      );
      if (remoteText === undefined) continue;
      components.push({
        component: 'solution',
        name: filename,
        status: statusOf(content, remoteText),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      warnings.push(`solution ${solution.name}: ${reason}`);
    }
  }

  for (const solution of remote) {
    if (localNames.has(solution.name)) continue;
    components.push({
      component: 'solution',
      name: solution.name,
      status: 'remote-only',
    });
  }
}

/**
 * Compares the one checker Polygon uses. Polygon names a standard checker
 * `std::ncmp` and a custom one by its source file, so the two kinds have
 * different ways to be different.
 */
async function diffChecker(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile,
  components: DiffComponent[],
  warnings: string[]
): Promise<void> {
  const remoteChecker = await fetchRemote(warnings, 'checker', () =>
    sdk.getChecker(problemId)
  );
  if (remoteChecker === undefined) return;
  const remoteIsStandard = remoteChecker.includes('std::');
  // Polygon answers with an empty name for a problem that has no checker.
  const hasRemote = remoteChecker.trim().length > 0;

  if (!config.checker) {
    if (hasRemote) {
      components.push({
        component: 'checker',
        name: remoteChecker,
        status: 'remote-only',
      });
    }
    return;
  }

  if (config.checker.isStandard) {
    // A standard checker has no file to compare: the name is the content.
    const wanted = `std::${config.checker.source}`;
    components.push({
      component: 'checker',
      name: wanted,
      status: !hasRemote
        ? 'local-only'
        : wanted === remoteChecker
          ? 'same'
          : 'changed',
    });
    return;
  }

  let payload: { filename: string; content: string };
  try {
    payload = readSourcePayload(problemDir, config.checker.source, 'Checker');
  } catch (error) {
    warnings.push(
      `checker: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  if (!hasRemote) {
    components.push({
      component: 'checker',
      name: payload.filename,
      status: 'local-only',
    });
    return;
  }

  if (remoteIsStandard) {
    // A custom local checker replaces the standard one on push, but there is
    // no file to compare yet.
    components.push({
      component: 'checker',
      name: payload.filename,
      status: 'changed',
    });
    return;
  }

  if (payload.filename !== remoteChecker) {
    warnings.push(
      `checker: Polygon uses ${remoteChecker}, the local problem uses ${payload.filename}; a push would switch to the local one`
    );
    components.push({
      component: 'checker',
      name: payload.filename,
      status: 'changed',
    });
    return;
  }

  const remoteText = await fetchRemote(
    warnings,
    `checker ${payload.filename}`,
    () => sdk.viewFile(problemId, 'source', payload.filename)
  );
  if (remoteText === undefined) return;
  components.push({
    component: 'checker',
    name: payload.filename,
    status: statusOf(payload.content, remoteText),
  });
}

/** The validator, which Polygon may not have at all. */
async function diffValidator(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile,
  components: DiffComponent[],
  warnings: string[]
): Promise<void> {
  const remoteValidator = await fetchRemote(warnings, 'validator', () =>
    sdk.getValidator(problemId)
  );
  if (remoteValidator === undefined) return;
  const remoteName = remoteValidator.replace(/std::/g, '');
  const hasRemote = remoteValidator.trim().length > 0;

  if (!config.validator) {
    if (hasRemote) {
      components.push({
        component: 'validator',
        name: remoteName,
        status: 'remote-only',
      });
    }
    return;
  }

  if (!hasRemote) {
    const { filename } = readSourcePayload(
      problemDir,
      config.validator.source,
      'Validator'
    );
    components.push({
      component: 'validator',
      name: filename,
      status: 'local-only',
    });
    return;
  }

  let payload: { filename: string; content: string };
  try {
    payload = readSourcePayload(
      problemDir,
      config.validator.source,
      'Validator'
    );
  } catch (error) {
    warnings.push(
      `validator: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  if (payload.filename !== remoteName) {
    warnings.push(
      `validator: Polygon uses ${remoteName}, the local problem uses ${payload.filename}; a push would switch to the local one`
    );
    components.push({
      component: 'validator',
      name: payload.filename,
      status: 'changed',
    });
    return;
  }

  const remoteText = await fetchRemote(
    warnings,
    `validator ${payload.filename}`,
    () => sdk.viewFile(problemId, 'source', payload.filename)
  );
  if (remoteText === undefined) return;
  components.push({
    component: 'validator',
    name: payload.filename,
    status: statusOf(payload.content, remoteText),
  });
}

/** Generators, which Polygon keeps as ordinary source files. */
async function diffGenerators(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile,
  components: DiffComponent[],
  warnings: string[]
): Promise<void> {
  const generators = config.generators ?? [];
  if (generators.length === 0) return;

  let sourceNames: Set<string>;
  try {
    const files = await sdk.getFiles(problemId);
    sourceNames = new Set(
      files.sourceFiles.map((file: { name: string }) => file.name)
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    warnings.push(`generators: files could not be listed (${reason})`);
    return;
  }

  for (const generator of generators) {
    try {
      const { filename, content } = readGeneratorPayload(problemDir, generator);
      if (!sourceNames.has(filename)) {
        components.push({
          component: 'generator',
          name: filename,
          status: 'local-only',
        });
        continue;
      }
      const remoteText = await fetchRemote(
        warnings,
        `generator ${filename}`,
        () => sdk.viewFile(problemId, 'source', filename)
      );
      if (remoteText === undefined) continue;
      components.push({
        component: 'generator',
        name: filename,
        status: statusOf(content, remoteText),
      });
    } catch (error) {
      warnings.push(
        `generator ${generator.name}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // Polygon does not say which source files are generators, so a generator
  // that is only on Polygon cannot be told apart from any other source file.
  warnings.push(
    'generators: a generator that is only on Polygon is not listed here, check `polyman remote view`'
  );
}

/** Statement sections, one entry per configured language and section. */
async function diffStatements(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile,
  components: DiffComponent[],
  warnings: string[]
): Promise<void> {
  let remote: Record<string, Statement>;
  try {
    remote = await sdk.getStatements(problemId);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    warnings.push(`statements: could not be read (${reason})`);
    return;
  }

  const localPayloads = readStatementPayloads(problemDir, config);
  const localLangs = new Set(localPayloads.map(payload => payload.lang));
  const emptyOnRemote = (lang: string, section: string): boolean => {
    const statement = remote[lang] as unknown as
      Record<string, string | undefined> | undefined;
    if (!statement) return true;
    const text = statement[section];
    return text === undefined || text.length === 0;
  };

  for (const payload of localPayloads) {
    const name = `${payload.lang}/${payload.section}`;
    if (!remote[payload.lang] || emptyOnRemote(payload.lang, payload.section)) {
      components.push({ component: 'statement', name, status: 'local-only' });
      continue;
    }
    const statement = remote[payload.lang] as unknown as Record<
      string,
      string | undefined
    >;
    components.push({
      component: 'statement',
      name,
      status: statusOf(payload.content, statement[payload.section] ?? ''),
    });
  }

  for (const lang of Object.keys(remote)) {
    if (localLangs.has(lang)) continue;
    components.push({
      component: 'statement',
      name: lang,
      status: 'remote-only',
    });
  }
}

/**
 * The generator script and the manual tests of one testset. Generated test
 * files are not compared: only the script that produces them and the manual
 * inputs a push would overwrite.
 */
async function diffTestset(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile,
  testset: LocalTestset,
  components: DiffComponent[],
  warnings: string[]
): Promise<void> {
  const generators = config.generators ?? [];

  let script: string;
  try {
    script = readScriptPayload(problemDir, testset, generators);
  } catch (error) {
    warnings.push(
      `testset ${testset.name}: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  const remoteScript = await fetchRemote(
    warnings,
    `script of testset ${testset.name}`,
    () => sdk.getScript(problemId, testset.name)
  );
  if (remoteScript !== undefined) {
    // A testset Polygon does not know answers with an empty script, and
    // `clearTestset` writes a single space, so both count as absent.
    const absentOnRemote = remoteScript.trim().length === 0;
    components.push({
      component: 'generator-script',
      name: testset.name,
      status: absentOnRemote ? 'local-only' : statusOf(script, remoteScript),
    });
  }

  for (const manual of testset.manualTests ?? []) {
    const name = `${testset.name}/${manual.index}`;
    let content: string;
    try {
      content = readManualTestPayload(problemDir, testset, manual.index);
    } catch (error) {
      warnings.push(
        `manual test ${name}: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }
    const remoteText = await fetchRemote(warnings, `manual test ${name}`, () =>
      sdk.getTestInput(problemId, testset.name, manual.index)
    );
    if (remoteText === undefined) continue;
    components.push({
      component: 'manual-test',
      name,
      status: statusOf(content, remoteText),
    });
  }
}

/**
 * Compares the local problem folder with the problem on Polygon.
 *
 * @param {PolygonSDK} sdk - Connected Polygon client
 * @param {number} problemId - The Polygon problem id from `Config.json`
 * @param {string} problemDir - Problem directory path
 * @param {ConfigFile} config - The parsed `Config.json`
 * @returns {Promise<ProblemDiff>} Every component compared, in a stable order,
 *   plus the things that could not be compared
 */
export async function diffProblem(
  sdk: PolygonSDK,
  problemId: number,
  problemDir: string,
  config: ConfigFile
): Promise<ProblemDiff> {
  const components: DiffComponent[] = [];
  const warnings: string[] = [];

  await diffSolutions(sdk, problemId, problemDir, config, components, warnings);
  await diffChecker(sdk, problemId, problemDir, config, components, warnings);
  await diffValidator(sdk, problemId, problemDir, config, components, warnings);
  await diffGenerators(
    sdk,
    problemId,
    problemDir,
    config,
    components,
    warnings
  );
  await diffStatements(
    sdk,
    problemId,
    problemDir,
    config,
    components,
    warnings
  );
  for (const testset of config.testsets ?? []) {
    await diffTestset(
      sdk,
      problemId,
      problemDir,
      config,
      testset,
      components,
      warnings
    );
  }

  return { components, warnings };
}
