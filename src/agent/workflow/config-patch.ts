/**
 * The single writer of `Config.json` during a workflow. Workers return a
 * {@link ConfigPatch}, the scheduler applies it here, one patch at a time.
 * A patch that makes the config invalid is refused and nothing is written.
 */

import fs from 'fs/promises';
import path from 'path';
import type { ConfigPatch } from './types';

/** The result of {@link applyConfigPatch}. */
export type PatchResult = { ok: true } | { ok: false; error: string };

type Json = Record<string, unknown>;

const TAGS = ['MA', 'OK', 'RJ', 'TL', 'TO', 'WA', 'PE', 'ML', 'RE'];

const SOLUTION_SOURCE_TYPES = [
  'cpp.g++11',
  'cpp.g++14',
  'cpp.g++17',
  'cpp.g++20',
  'cpp.msys2-mingw64-9-g++17',
  'cpp.gcc13-64-winlibs-g++20',
  'cpp.gcc14-64-msys2-g++23',
  'cpp.ms2017',
  'cpp.ms2019',
  'cpp.clang++17',
  'cpp.clang++20',
  'java8',
  'java21',
  'python.2',
  'python.3',
  'python.pypy2',
  'python.pypy3',
];

const REQUIRED_FIELDS = [
  'name',
  'timeLimit',
  'memoryLimit',
  'inputFile',
  'outputFile',
  'interactive',
  'statements',
  'solutions',
  'checker',
  'validator',
];

/** One queue for every patch, so two patches never interleave. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * The Polygon source type of a solution file, from its extension. Same
 * defaults as `resolveSourceType` in `src/helpers/remote/pushing.ts`.
 */
export function sourceTypeFor(file: string): string | null {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.cpp' || ext === '.cc' || ext === '.cxx') return 'cpp.g++17';
  if (ext === '.java') return 'java21';
  if (ext === '.py') return 'python.3';
  return null;
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

/** Checks the shape of a patch from a worker. Returns an error or null. */
export function checkPatchShape(patch: unknown): string | null {
  if (!isObject(patch)) return 'the patch must be an object';
  const known = [
    'set',
    'addSolutions',
    'validator',
    'generators',
    'checker',
    'statements',
    'generatorScript',
    'manualTests',
  ];
  for (const key of Object.keys(patch)) {
    if (!known.includes(key)) return `unknown patch field: ${key}`;
  }

  const set = patch['set'];
  if (set !== undefined) {
    if (!isObject(set)) return 'set must be an object';
    if (set['name'] !== undefined && !isString(set['name'])) {
      return 'set.name must be a string';
    }
    for (const key of ['timeLimit', 'memoryLimit']) {
      if (set[key] !== undefined && !isPositiveInt(set[key])) {
        return `set.${key} must be a positive integer`;
      }
    }
  }

  const solutions = patch['addSolutions'];
  if (solutions !== undefined) {
    if (!Array.isArray(solutions)) return 'addSolutions must be a list';
    for (const s of solutions) {
      if (!isObject(s) || !isString(s['name']) || !isString(s['source'])) {
        return 'each solution needs a name and a source';
      }
      if (typeof s['tag'] !== 'string' || !TAGS.includes(s['tag'])) {
        return `solution ${s['name']}: bad tag ${String(s['tag'])}, use one of ${TAGS.join(', ')}`;
      }
      if (!sourceTypeFor(s['source'])) {
        return `solution ${s['name']}: unknown language of ${s['source']}, use .cpp, .java or .py`;
      }
    }
  }

  const validator = patch['validator'];
  if (validator !== undefined) {
    if (
      !isObject(validator) ||
      !isString(validator['name']) ||
      !isString(validator['source'])
    ) {
      return 'validator needs a name and a source';
    }
  }

  const generators = patch['generators'];
  if (generators !== undefined) {
    if (!Array.isArray(generators)) return 'generators must be a list';
    for (const g of generators) {
      if (!isObject(g) || !isString(g['name']) || !isString(g['source'])) {
        return 'each generator needs a name and a source';
      }
    }
  }

  const checker = patch['checker'];
  if (checker !== undefined) {
    if (!isObject(checker) || !isString(checker['name'])) {
      return 'checker needs a name';
    }
    if (checker['isStandard'] !== true && !isString(checker['source'])) {
      return 'a custom checker needs a source';
    }
  }

  const statements = patch['statements'];
  if (statements !== undefined) {
    if (!isObject(statements)) return 'statements must be an object';
    for (const [lang, st] of Object.entries(statements)) {
      if (!isObject(st) || !isString(st['name'])) {
        return `statement ${lang} needs a name`;
      }
    }
  }

  const script = patch['generatorScript'];
  if (script !== undefined) {
    if (
      !isObject(script) ||
      !isString(script['testset']) ||
      !isString(script['scriptFile'])
    ) {
      return 'generatorScript needs a testset and a scriptFile';
    }
  }

  const manual = patch['manualTests'];
  if (manual !== undefined) {
    if (!Array.isArray(manual)) return 'manualTests must be a list';
    for (const t of manual) {
      if (!isObject(t) || !isString(t['testset']) || !isString(t['input'])) {
        return 'each manual test needs a testset and an input';
      }
    }
  }
  return null;
}

/** Puts `item` in place of the entry with the same `key`, or adds it. */
function upsert(list: Json[], item: Json, key: string): void {
  const i = list.findIndex(x => x[key] === item[key]);
  if (i >= 0) list[i] = item;
  else list.push(item);
}

function listOf(config: Json, key: string): Json[] {
  const value = config[key];
  const list: Json[] = Array.isArray(value) ? value.filter(isObject) : [];
  config[key] = list;
  return list;
}

function testsetOf(config: Json, name: string): Json {
  const testsets = listOf(config, 'testsets');
  let testset = testsets.find(t => t['name'] === name);
  if (!testset) {
    testset = { name };
    testsets.push(testset);
  }
  return testset;
}

/** Applies a checked patch to a parsed config, in place. */
function apply(config: Json, patch: ConfigPatch): void {
  if (patch.set) {
    const { name, timeLimit, memoryLimit } = patch.set;
    if (name !== undefined) config['name'] = name;
    if (timeLimit !== undefined) config['timeLimit'] = timeLimit;
    if (memoryLimit !== undefined) config['memoryLimit'] = memoryLimit;
  }

  if (patch.addSolutions) {
    const solutions = listOf(config, 'solutions');
    for (const s of patch.addSolutions) {
      const entry: Json = {
        name: s.name,
        source: s.source,
        tag: s.tag,
        sourceType: sourceTypeFor(s.source),
      };
      // The plan has exactly one main solution, so a new MA replaces the
      // old one (for example the one left from the template).
      const kept = solutions.filter(
        x =>
          x['name'] !== s.name &&
          x['source'] !== s.source &&
          !(s.tag === 'MA' && x['tag'] === 'MA')
      );
      kept.push(entry);
      solutions.splice(0, solutions.length, ...kept);
    }
  }

  if (patch.validator) {
    const v: Json = {
      name: patch.validator.name,
      source: patch.validator.source,
    };
    if (patch.validator.testsFilePath !== undefined) {
      v['testsFilePath'] = patch.validator.testsFilePath;
    }
    config['validator'] = v;
  }

  if (patch.generators) {
    const generators = listOf(config, 'generators');
    for (const g of patch.generators) {
      upsert(generators, { name: g.name, source: g.source }, 'name');
    }
  }

  if (patch.checker) {
    const c = patch.checker;
    if (c.isStandard) {
      const name = c.name.replace(/\.cpp$/, '');
      config['checker'] = { name, source: `${name}.cpp`, isStandard: true };
    } else {
      const entry: Json = { name: c.name, source: c.source, isStandard: false };
      if (c.testsFilePath !== undefined)
        entry['testsFilePath'] = c.testsFilePath;
      config['checker'] = entry;
    }
  }

  if (patch.statements) {
    const statements = isObject(config['statements'])
      ? config['statements']
      : {};
    for (const [lang, st] of Object.entries(patch.statements)) {
      statements[lang] = { ...st };
    }
    config['statements'] = statements;
  }

  if (patch.generatorScript) {
    const testset = testsetOf(config, patch.generatorScript.testset);
    testset['generatorScript'] = {
      scriptFile: patch.generatorScript.scriptFile,
    };
  }

  if (patch.manualTests) {
    for (const t of patch.manualTests) {
      const testset = testsetOf(config, t.testset);
      const tests = listOf(testset, 'manualTests');
      const existing = tests.find(x => x['input'] === t.input);
      const index =
        typeof existing?.['index'] === 'number'
          ? existing['index']
          : Math.max(
              0,
              ...tests.map(x =>
                typeof x['index'] === 'number' ? x['index'] : 0
              )
            ) + 1;
      const entry: Json = { input: t.input, index };
      if (t.group !== undefined) {
        entry['group'] = t.group;
        const groups = listOf(testset, 'groups');
        if (!groups.some(g => g['name'] === t.group))
          groups.push({ name: t.group });
        testset['groupsEnabled'] = true;
      }
      if (t.useInStatements !== undefined) {
        entry['useInStatements'] = t.useInStatements;
      }
      upsert(tests, entry, 'input');
    }
  }
}

/**
 * The errors of a config against the required fields of
 * `Config.schema.json` and the tag and source type enums.
 */
export function configErrors(config: unknown): string[] {
  if (!isObject(config)) return ['Config.json is not an object'];
  const errors: string[] = [];
  for (const field of REQUIRED_FIELDS) {
    if (config[field] === undefined) errors.push(`missing field ${field}`);
  }

  const name = config['name'];
  if (name !== undefined) {
    if (typeof name !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
      errors.push('name must be lowercase letters, digits and single dashes');
    }
  }
  for (const key of ['timeLimit', 'memoryLimit']) {
    if (config[key] !== undefined && !isPositiveInt(config[key])) {
      errors.push(`${key} must be a positive integer`);
    }
  }
  for (const key of ['inputFile', 'outputFile']) {
    if (config[key] !== undefined && typeof config[key] !== 'string') {
      errors.push(`${key} must be a string`);
    }
  }
  if (
    config['interactive'] !== undefined &&
    typeof config['interactive'] !== 'boolean'
  ) {
    errors.push('interactive must be true or false');
  }

  const statements = config['statements'];
  if (statements !== undefined) {
    if (!isObject(statements)) errors.push('statements must be an object');
    else {
      for (const [lang, st] of Object.entries(statements)) {
        if (
          !isObject(st) ||
          !isString(st['encoding']) ||
          !isString(st['name'])
        ) {
          errors.push(`statement ${lang} needs an encoding and a name`);
        }
      }
    }
  }

  const solutions = config['solutions'];
  if (solutions !== undefined) {
    if (!Array.isArray(solutions) || solutions.length === 0) {
      errors.push('solutions must be a list with at least one solution');
    } else {
      for (const s of solutions) {
        if (!isObject(s) || !isString(s['name']) || !isString(s['source'])) {
          errors.push('each solution needs a name and a source');
          continue;
        }
        if (typeof s['tag'] !== 'string' || !TAGS.includes(s['tag'])) {
          errors.push(`solution ${s['name']}: bad tag ${String(s['tag'])}`);
        }
        const st = s['sourceType'];
        if (
          st !== undefined &&
          (typeof st !== 'string' || !SOLUTION_SOURCE_TYPES.includes(st))
        ) {
          errors.push(
            `solution ${s['name']}: bad sourceType ${JSON.stringify(st)}`
          );
        }
      }
      const mains = solutions.filter(s => isObject(s) && s['tag'] === 'MA');
      if (mains.length > 1) errors.push('more than one MA solution');
    }
  }

  for (const key of ['checker', 'validator']) {
    const value = config[key];
    if (value === undefined) continue;
    if (
      !isObject(value) ||
      !isString(value['name']) ||
      !isString(value['source'])
    ) {
      errors.push(`${key} needs a name and a source`);
    }
  }

  const generators = config['generators'];
  if (generators !== undefined) {
    if (!Array.isArray(generators)) errors.push('generators must be a list');
    else if (
      generators.some(
        g => !isObject(g) || !isString(g['name']) || !isString(g['source'])
      )
    ) {
      errors.push('each generator needs a name and a source');
    }
  }

  const testsets = config['testsets'];
  if (testsets !== undefined) {
    if (!Array.isArray(testsets)) errors.push('testsets must be a list');
    else {
      for (const t of testsets) {
        if (!isObject(t) || !isString(t['name'])) {
          errors.push('each testset needs a name');
          continue;
        }
        const manual = t['manualTests'];
        if (
          Array.isArray(manual) &&
          manual.some(
            m =>
              !isObject(m) ||
              !isString(m['input']) ||
              !isPositiveInt(m['index'])
          )
        ) {
          errors.push(
            `testset ${t['name']}: each manual test needs an input and an index`
          );
        }
      }
    }
  }
  return errors;
}

/**
 * Fills the parts of a patch a small model often leaves out, when there is
 * only one sensible value: the testset of `generatorScript` and of manual
 * tests (the first testset of the config, else `tests`), a `generatorScript`
 * given as a plain file path, and the validator name. Returns a new patch;
 * anything it does not know stays as it is for {@link checkPatchShape}.
 */
export function fillPatchDefaults(patch: unknown, config: unknown): unknown {
  if (!isObject(patch)) return patch;
  const testsets =
    isObject(config) && Array.isArray(config['testsets'])
      ? config['testsets']
      : [];
  const first: unknown = testsets.find(isObject)?.['name'];
  const testset = isString(first) ? first : 'tests';
  const out: Json = { ...patch };

  const script = out['generatorScript'];
  if (isString(script)) {
    out['generatorScript'] = { testset, scriptFile: script };
  } else if (isObject(script) && script['testset'] === undefined) {
    out['generatorScript'] = { ...script, testset };
  }

  const manual = out['manualTests'];
  if (Array.isArray(manual)) {
    out['manualTests'] = manual.map((t: unknown) =>
      isObject(t) && t['testset'] === undefined ? { ...t, testset } : t
    );
  }

  const validator = out['validator'];
  if (isObject(validator) && validator['name'] === undefined) {
    out['validator'] = { ...validator, name: 'validator' };
  }
  return out;
}

async function applyNow(
  problemDir: string,
  rawPatch: unknown
): Promise<PatchResult> {
  const file = path.join(problemDir, 'Config.json');
  let config: unknown;
  try {
    config = JSON.parse(await fs.readFile(file, 'utf-8'));
  } catch (error) {
    return {
      ok: false,
      error: `cannot read Config.json: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!isObject(config))
    return { ok: false, error: 'Config.json is not an object' };

  const patch = fillPatchDefaults(rawPatch, config);
  const shapeError = checkPatchShape(patch);
  if (shapeError) return { ok: false, error: shapeError };

  // Refuse only what the patch broke: a problem that was already invalid
  // in some other field can still get patches.
  const before = new Set(configErrors(config));
  apply(config, patch as ConfigPatch);
  const added = configErrors(config).filter(e => !before.has(e));
  if (added.length > 0) {
    return {
      ok: false,
      error: `the patch makes Config.json invalid: ${added.join('; ')}`,
    };
  }

  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
  await fs.rename(tmp, file);
  return { ok: true };
}

/**
 * Applies a worker's patch to `<problemDir>/Config.json`. Patches run one
 * at a time. On any error nothing is written.
 */
export function applyConfigPatch(
  problemDir: string,
  patch: unknown
): Promise<PatchResult> {
  const run = queue.then(
    () => applyNow(problemDir, patch),
    () => applyNow(problemDir, patch)
  );
  queue = run.catch(() => undefined);
  return run.catch((error: unknown) => ({
    ok: false as const,
    error: error instanceof Error ? error.message : String(error),
  }));
}

/** What {@link dropTemplateExamples} removed from `Config.json`. */
export interface DroppedExamples {
  /** Solution names. */
  solutions: string[];
  /** Manual test inputs. */
  manualTests: string[];
  /** Statement languages. */
  statements: string[];
}

/** True when `file` in the problem is the same as the template's copy. */
async function sameAsTemplate(
  problemDir: string,
  templateDir: string,
  file: unknown
): Promise<boolean> {
  if (!isString(file)) return false;
  const rel = path.normalize(file);
  if (path.isAbsolute(rel) || rel.startsWith('..')) return false;
  try {
    const [mine, template] = await Promise.all([
      fs.readFile(path.join(problemDir, rel)),
      fs.readFile(path.join(templateDir, rel)),
    ]);
    return mine.equals(template);
  } catch {
    return false;
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function dropNow(
  problemDir: string,
  templateDir: string
): Promise<DroppedExamples> {
  const dropped: DroppedExamples = {
    solutions: [],
    manualTests: [],
    statements: [],
  };
  const file = path.join(problemDir, 'Config.json');
  const config: unknown = JSON.parse(await fs.readFile(file, 'utf-8'));
  if (!isObject(config)) return dropped;
  const same = (f: unknown): Promise<boolean> =>
    sameAsTemplate(problemDir, templateDir, f);

  // The MA stays: the main_solution task replaces it.
  if (Array.isArray(config['solutions'])) {
    const kept: unknown[] = [];
    for (const s of config['solutions'] as unknown[]) {
      if (isObject(s) && s['tag'] !== 'MA' && (await same(s['source']))) {
        dropped.solutions.push(String(s['name']));
      } else {
        kept.push(s);
      }
    }
    config['solutions'] = kept;
  }

  if (Array.isArray(config['testsets'])) {
    for (const t of config['testsets'] as unknown[]) {
      if (!isObject(t) || !Array.isArray(t['manualTests'])) continue;
      const kept: unknown[] = [];
      for (const m of t['manualTests'] as unknown[]) {
        if (isObject(m) && (await same(m['input']))) {
          dropped.manualTests.push(String(m['input']));
        } else {
          kept.push(m);
        }
      }
      t['manualTests'] = kept;
    }
  }

  // A statement goes when every file it has is still the template's.
  const statements = config['statements'];
  if (isObject(statements)) {
    for (const [lang, st] of Object.entries(statements)) {
      if (!isObject(st)) continue;
      const files = ['legend', 'input', 'output', 'notes']
        .map(k => st[k])
        .filter(isString);
      let found = 0;
      let changed = false;
      for (const f of files) {
        if (!(await exists(path.resolve(problemDir, f)))) continue;
        found++;
        if (!(await same(f))) changed = true;
      }
      if (found > 0 && !changed) {
        dropped.statements.push(lang);
        delete statements[lang];
      }
    }
  }

  const count =
    dropped.solutions.length +
    dropped.manualTests.length +
    dropped.statements.length;
  if (count > 0) {
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
    await fs.rename(tmp, file);
  }
  return dropped;
}

/**
 * Removes the examples that `polyman new` copies from the template and a
 * workflow does not replace: solutions (not the MA), manual tests and
 * statements whose files are still the same as in `templateDir`. Anything
 * the user changed stays, and no file is deleted. It runs in the same
 * queue as the patches.
 */
export function dropTemplateExamples(
  problemDir: string,
  templateDir: string
): Promise<DroppedExamples | { error: string }> {
  const run = queue.then(
    () => dropNow(problemDir, templateDir),
    () => dropNow(problemDir, templateDir)
  );
  queue = run.catch(() => undefined);
  return run.catch((error: unknown) => ({
    error: error instanceof Error ? error.message : String(error),
  }));
}
