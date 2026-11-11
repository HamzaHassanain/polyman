/**
 * @fileoverview Reads what a push would send to Polygon, without sending it.
 *
 * `remote push` reads a file, normalizes it, and uploads it inside one
 * function, so nothing else can ask "what exactly would go up?". Every local
 * read `push` does lives here and `pushing.ts` calls these, so a
 * `remote diff` or a `--dry-run` cannot disagree with the real upload.
 *
 * These readers do not pick a Polygon `sourceType`: that is `pushing.ts`'s
 * job, and comparing compiler choices is not part of a content diff.
 *
 * Each reader throws when the local file is missing, with the message `push`
 * used to throw, so a dry run reports the same problem as a real push.
 */

import fs from 'fs';
import path from 'path';
import type ConfigFile from '../../types';
import { LocalGenerator, LocalSolution, LocalTestset } from '../../types';
import { insideProblem } from '../utils';
import { readScriptText, toPolygonScript } from '../script-parser';
import { renamePublicClass } from '../java-class';
import { normalizeLineEndingsFromSystemToRemote } from './utils';

/**
 * One source file as Polygon would receive it.
 * @interface SourcePayload
 * @property {filename} - The Polygon file name: the local file name, which is
 *   the name `push` uploads it under
 * @property {content} - The exact text `push` uploads, after line ending
 *   normalization
 */
export interface SourcePayload {
  filename: string;
  content: string;
}

/**
 * One statement section as Polygon would receive it.
 * @interface StatementPayload
 * @property {lang} - Statement language key, e.g. `english`
 * @property {section} - `legend`, `input`, `output`, `notes`, `tutorial`,
 *   `interaction` or `scoring`
 * @property {content} - The exact text `push` uploads
 */
export interface StatementPayload {
  lang: string;
  section: string;
  content: string;
}

/**
 * The statement sections `push` uploads, in the order it uploads them.
 */
export const STATEMENT_SECTIONS = [
  'legend',
  'input',
  'output',
  'notes',
  'tutorial',
  'interaction',
  'scoring',
] as const;

/**
 * Reads a file already resolved inside the problem folder and turns it into
 * the text Polygon expects.
 *
 * @param {string} filePath - Absolute path inside the problem folder
 * @returns {string} The normalized text
 */
export function readNormalizedFile(filePath: string): string {
  return normalizeLineEndingsFromSystemToRemote(
    fs.readFileSync(filePath, 'utf-8')
  );
}

/**
 * Reads one source file of the problem.
 *
 * @param {string} problemDir - Problem directory path
 * @param {string} source - Path from `Config.json`, relative to the problem
 * @param {string} label - What to call the file in the not-found message
 * @returns {SourcePayload} The file name and the normalized text
 * @throws {Error} If the path leaves the problem folder, or the file is missing
 */
export function readSourcePayload(
  problemDir: string,
  source: string,
  label: string
): SourcePayload {
  const filePath = insideProblem(problemDir, source);
  if (!fs.existsSync(filePath)) {
    throw new Error(`${label} file not found: ${source}`);
  }
  return {
    filename: path.basename(source),
    content: readNormalizedFile(filePath),
  };
}

/**
 * Reads a solution the way `push` uploads it. Java is the special case:
 * Polygon requires `public class Main`, so the uploaded copy is renamed while
 * the local file keeps a class that matches its name.
 */
export function readSolutionPayload(
  problemDir: string,
  solution: LocalSolution
): SourcePayload {
  const payload = readSourcePayload(problemDir, solution.source, 'Solution');
  if (path.extname(payload.filename).toLowerCase() !== '.java') {
    return payload;
  }
  const renamed = renamePublicClass(
    fs.readFileSync(insideProblem(problemDir, solution.source), 'utf-8'),
    path.basename(payload.filename, path.extname(payload.filename)),
    'Main'
  );
  return {
    filename: payload.filename,
    content: normalizeLineEndingsFromSystemToRemote(renamed),
  };
}

/** Reads a generator the way `push` uploads it. */
export function readGeneratorPayload(
  problemDir: string,
  generator: LocalGenerator
): SourcePayload {
  return readSourcePayload(problemDir, generator.source, 'Generator');
}

/**
 * Reads every statement section `push` would upload, in a stable order.
 * A section whose file is missing locally is skipped, exactly as `push`
 * skips it, so a dry run never promises an upload that would not happen.
 */
export function readStatementPayloads(
  problemDir: string,
  config: ConfigFile
): StatementPayload[] {
  const payloads: StatementPayload[] = [];
  for (const [lang, statement] of Object.entries(config.statements ?? {})) {
    for (const section of STATEMENT_SECTIONS) {
      const source = statement[section];
      if (!source) continue;
      const filePath = insideProblem(problemDir, source);
      if (!fs.existsSync(filePath)) continue;
      payloads.push({
        lang,
        section,
        content: readNormalizedFile(filePath),
      });
    }
  }
  return payloads;
}

/**
 * Reads one manual test input the way `push` would upload it.
 *
 * @param {number} index - The declared index of the manual test
 * @returns {string} The exact text `push` sends
 * @throws {Error} If the index is not declared, or the file is missing
 */
export function readManualTestPayload(
  problemDir: string,
  testset: LocalTestset,
  index: number
): string {
  const manual = (testset.manualTests ?? []).find(t => t.index === index);
  if (!manual) {
    throw new Error(
      `Manual test ${index} is not declared in testset ${testset.name}`
    );
  }
  const filePath = insideProblem(problemDir, manual.input);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Manual test file not found: ${manual.input}`);
  }
  return readNormalizedFile(filePath);
}

/**
 * Reads the generator script of a testset the way `push` uploads it: the
 * script text with its generator tokens rewritten, because Polygon resolves
 * them against source file names rather than `Config.json` names.
 */
export function readScriptPayload(
  problemDir: string,
  testset: LocalTestset,
  generators: LocalGenerator[]
): string {
  return toPolygonScript(readScriptText(testset, problemDir), generators);
}
