/**
 * @fileoverview Testset management — resolves Polygon-format scripts plus
 * manual tests into concrete test lists, and drives generation by testset,
 * group, or single index.
 */

import type { LocalTestset, LocalGenerator, ResolvedTest } from '../types';
import { executeResolvedTests, resolveTestsetTests } from './generator';
import {
  parseGeneratorScript,
  readScriptText,
  resolveTests,
  validateManualTests,
} from './script-parser';
import { ensureDirectoryExists, throwError } from './utils';
import path from 'path';

export function ensureTestsetsExist(
  testsets: LocalTestset[] | undefined
): asserts testsets is LocalTestset[] {
  if (!testsets || testsets.length === 0) {
    throw new Error('No testsets defined in the configuration file.');
  }
}

export function findTestset(
  testsets: LocalTestset[],
  name: string
): LocalTestset {
  const testset = testsets.find(t => t.name === name);
  if (!testset) {
    const available = testsets.map(t => t.name).join(', ');
    throw new Error(
      `Testset "${name}" not found. Available testsets: ${available}`
    );
  }
  return testset;
}

/**
 * Resolves the full ordered test list (manual + script) for a testset.
 * Throws on parse errors, missing files, or duplicate indices.
 */
export function getResolvedTests(
  testset: LocalTestset,
  generators: LocalGenerator[]
): ResolvedTest[] {
  return resolveTestsetTests(testset, generators);
}

/**
 * Lightweight resolver: parses script + manuals to get test indices/groups
 * without checking that referenced generators or manual files exist on disk.
 * Useful for filtering/validating already-on-disk tests (validate, run, …).
 */
export function getTestIndicesForGroup(
  testset: LocalTestset,
  groupName: string
): number[] {
  const lines = parseGeneratorScript(readScriptText(testset));
  const manuals = testset.manualTests ?? [];
  const tests = resolveTests(lines, manuals);
  return tests
    .filter(t => groupName === 'all' || t.group === groupName)
    .map(t => t.index);
}

/**
 * Like {@link getTestIndicesForGroup} but returns every index in the testset.
 */
export function getAllTestIndices(testset: LocalTestset): number[] {
  const lines = parseGeneratorScript(readScriptText(testset));
  const manuals = testset.manualTests ?? [];
  return resolveTests(lines, manuals).map(t => t.index);
}

function testsetOutputDir(testsetName: string, override?: string): string {
  return override || path.resolve(process.cwd(), 'testsets', testsetName);
}

/**
 * Generates every test in a single testset.
 */
export async function generateTestsForTestset(
  testset: LocalTestset,
  generators: LocalGenerator[],
  outputDir?: string
): Promise<void> {
  const tests = getResolvedTests(testset, generators);
  const dir = testsetOutputDir(testset.name, outputDir);
  ensureDirectoryExists(dir);
  await executeResolvedTests(tests, generators, dir);
}

/**
 * Generates a single test by Polygon index.
 */
export async function generateSingleTest(
  testset: LocalTestset,
  testIndex: number,
  generators: LocalGenerator[],
  outputDir?: string
): Promise<void> {
  const tests = getResolvedTests(testset, generators);
  const target = tests.find(t => t.index === testIndex);
  if (!target) {
    const indices = tests.map(t => t.index).join(', ');
    throw new Error(
      `Test ${testIndex} not found in testset "${testset.name}". ` +
        `Available indices: ${indices || '(none)'}`
    );
  }
  const dir = testsetOutputDir(testset.name, outputDir);
  ensureDirectoryExists(dir);

  // For multi-output lines we need every test that shares the same line so
  // the generator runs exactly once and writes all promised files.
  let toRun: ResolvedTest[] = [target];
  if (
    target.source.kind === 'generator' &&
    target.source.multiOutputs !== null
  ) {
    const multi = target.source.multiOutputs;
    const generatorName = target.source.generator;
    toRun = tests.filter(t => {
      if (t.source.kind !== 'generator') return false;
      if (t.source.multiOutputs === null) return false;
      if (t.source.generator !== generatorName) return false;
      return arraysEqual(t.source.multiOutputs, multi);
    });
  }
  await executeResolvedTests(toRun, generators, dir);
}

/**
 * Generates every test in a named group.
 *
 * Group annotations come from the script (`<#-- @group name -->` headers) and
 * from each manual test's `group` field. `groupName === 'all'` means every
 * test.
 */
export async function generateTestsForGroup(
  testset: LocalTestset,
  groupName: string,
  generators: LocalGenerator[],
  outputDir?: string
): Promise<void> {
  const tests = getResolvedTests(testset, generators);
  const filtered = tests.filter(
    t => groupName === 'all' || t.group === groupName
  );
  if (filtered.length === 0) {
    const groups = [...new Set(tests.map(t => t.group).filter(Boolean))];
    throw new Error(
      `No tests found in group "${groupName}". ` +
        `Available groups: ${groups.join(', ') || '(none)'}`
    );
  }
  const dir = testsetOutputDir(testset.name, outputDir);
  ensureDirectoryExists(dir);
  await executeResolvedTests(filtered, generators, dir);
}

export async function generateAllTestsets(
  testsets: LocalTestset[],
  generators: LocalGenerator[]
): Promise<void> {
  for (const testset of testsets) {
    try {
      await generateTestsForTestset(testset, generators);
    } catch (error) {
      throwError(error, `Failed to generate testset "${testset.name}"`);
    }
  }
}

/**
 * One-line summary per testset for `polyman list testsets`.
 */
export function listTestsets(testsets: LocalTestset[]): string[] {
  return testsets.map(testset => {
    let count = 0;
    try {
      const lines = parseGeneratorScript(readScriptText(testset));
      const manuals = testset.manualTests ?? [];
      validateManualTests(manuals);
      count = resolveTests(lines, manuals).length;
    } catch {
      count = testset.manualTests?.length ?? 0;
    }
    const groups = testset.groups?.map(g => g.name).join(', ') || 'none';
    return `${testset.name}: ${count} tests, groups: ${groups}`;
  });
}

function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
