/**
 * @fileoverview Parser for Polygon-format generator scripts.
 *
 * Each non-empty, non-comment line has the form:
 *
 *     generator-name [args...] > target
 *
 * Where `target` is one of:
 *   - `N`         — a positive integer test index
 *   - `$`         — auto-assign the smallest unused index at resolve time
 *   - `{1-3,7}`   — comma-separated list of indices/ranges; the generator
 *                   itself writes those files (no stdout redirect)
 *
 * Supported FreeMarker constructs:
 *   - `<#-- comment -->`         — ignored, may include `@group <name>` to
 *                                  start a new group block
 *   - `<#list a..b as i> ... </#list>`
 *                                — expanded; `${i}` is substituted with each
 *                                  integer in the inclusive range
 *
 * Generator names with file extensions (`gen.exe`, `gen.cpp`) are rejected.
 */

import type {
  LocalGenerator,
  LocalManualTest,
  LocalTestset,
  ParsedScriptLine,
  ResolvedTest,
  ScriptOutput,
} from '../types';
import fs from 'fs';
import path from 'path';

const COMMENT_RE = /<#--([\s\S]*?)-->/g;
const LIST_RE =
  /<#list\s+(-?\d+)\s*\.\.\s*(-?\d+)\s+as\s+([a-zA-Z_]\w*)\s*>([\s\S]*?)<\/#list>/g;

const GROUP_DIRECTIVE_RE = /^@group\s+(\S+)\s*$/;

/**
 * Reads a generator script from a {@link LocalTestset}.
 *
 * Resolves `scriptFile` relative to `baseDir` (defaults to the current
 * working directory) when `script` is absent. Returns an empty string when
 * neither is set (e.g. testsets that only use manual tests).
 */
export function readScriptText(
  testset: LocalTestset,
  baseDir: string = process.cwd()
): string {
  const gs = testset.generatorScript;
  if (!gs) return '';
  if (typeof gs.script === 'string') return gs.script;
  if (gs.scriptFile) {
    const filePath = path.resolve(baseDir, gs.scriptFile);
    if (!fs.existsSync(filePath)) {
      throw new Error(
        `Generator scriptFile not found for testset "${testset.name}": ${gs.scriptFile}`
      );
    }
    return fs.readFileSync(filePath, 'utf-8');
  }
  return '';
}

/**
 * Tokenizes one already-uncommented script line. Quoted arguments are
 * preserved as a single token; unquoted whitespace separates tokens.
 */
function tokenize(line: string): string[] {
  const out: string[] = [];
  let buf = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        buf += ch;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      if (buf.length > 0) {
        out.push(buf);
        buf = '';
      }
      continue;
    }
    buf += ch;
  }
  if (buf.length > 0) out.push(buf);
  return out;
}

function parseTarget(target: string, lineNumber: number): ScriptOutput {
  if (target === '$') return { kind: 'single', index: null };

  if (target.startsWith('{') && target.endsWith('}')) {
    const inner = target.slice(1, -1).trim();
    if (inner.length === 0) {
      throw new Error(`Empty multi-output target on line ${lineNumber}`);
    }
    const indices: number[] = [];
    for (const piece of inner.split(',')) {
      const p = piece.trim();
      const rangeMatch = /^(\d+)\s*-\s*(\d+)$/.exec(p);
      if (rangeMatch) {
        const a = parseInt(rangeMatch[1], 10);
        const b = parseInt(rangeMatch[2], 10);
        if (a < 1 || b < a) {
          throw new Error(
            `Invalid range "${p}" in multi-output target on line ${lineNumber}`
          );
        }
        for (let i = a; i <= b; i++) indices.push(i);
      } else if (/^\d+$/.test(p)) {
        const v = parseInt(p, 10);
        if (v < 1) {
          throw new Error(
            `Test index must be >= 1 (got ${v}) on line ${lineNumber}`
          );
        }
        indices.push(v);
      } else {
        throw new Error(
          `Invalid index "${p}" in multi-output target on line ${lineNumber}`
        );
      }
    }
    if (indices.length === 0) {
      throw new Error(`Empty multi-output target on line ${lineNumber}`);
    }
    return { kind: 'multi', indices };
  }

  if (/^\d+$/.test(target)) {
    const v = parseInt(target, 10);
    if (v < 1) {
      throw new Error(
        `Test index must be >= 1 (got ${v}) on line ${lineNumber}`
      );
    }
    return { kind: 'single', index: v };
  }

  throw new Error(
    `Invalid output target "${target}" on line ${lineNumber} ` +
      `(expected N, $, or {indices})`
  );
}

/**
 * Strips multi-line comments and expands `<#list a..b as i> ... </#list>`
 * blocks before splitting the script into lines.
 *
 * Comments that contain an `@group` (or other `@`-prefixed directive) are
 * collapsed onto a single line so the per-line parser can still detect them.
 * Comments that don't start with `@` are dropped entirely. This way the line
 * numbers stay close to the source while multi-line `<#-- ... -->` blocks
 * don't bleed past the comment boundary.
 */
function preprocess(script: string): string[] {
  const directiveStripped = script.replace(
    /<#--([\s\S]*?)-->/g,
    (match, body: string) => {
      const trimmed = body.trim();
      if (trimmed.startsWith('@')) {
        // Keep as a single-line directive so the line parser sees it.
        const newlines = match.split('\n').length - 1;
        return `<#-- ${trimmed} -->` + '\n'.repeat(newlines);
      }
      // Drop the contents but preserve newlines so source line numbers stay
      // roughly aligned with the original.
      const newlines = match.split('\n').length - 1;
      return '\n'.repeat(newlines);
    }
  );

  const expanded = directiveStripped.replace(
    LIST_RE,
    (_m, fromStr: string, toStr: string, varName: string, body: string) => {
      const from = parseInt(fromStr, 10);
      const to = parseInt(toStr, 10);
      const step = from <= to ? 1 : -1;
      const re = new RegExp('\\$\\{' + varName + '\\}', 'g');
      const parts: string[] = [];
      for (let i = from; step === 1 ? i <= to : i >= to; i += step) {
        parts.push(body.replace(re, String(i)));
      }
      return parts.join('\n');
    }
  );

  return expanded.split(/\r?\n/);
}

function extractCommentDirective(line: string): string | null {
  const matches = [...line.matchAll(COMMENT_RE)];
  for (const m of matches) {
    const body = m[1].trim();
    if (body.startsWith('@')) return body;
  }
  return null;
}

function stripComments(line: string): string {
  return line.replace(COMMENT_RE, ' ').trim();
}

/**
 * Parses a Polygon-format generator script into an ordered list of lines.
 *
 * @param script - raw script text
 * @returns parsed lines in source order
 * @throws if a line is malformed, an extension appears in a generator name,
 *         or an output target is invalid
 */
export function parseGeneratorScript(script: string): ParsedScriptLine[] {
  const out: ParsedScriptLine[] = [];
  const lines = preprocess(script);
  let activeGroup: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNumber = i + 1;

    const directive = extractCommentDirective(raw);
    if (directive) {
      const groupMatch = GROUP_DIRECTIVE_RE.exec(directive);
      if (groupMatch) {
        activeGroup = groupMatch[1];
        continue;
      }
      // Other @ directives reserved for future use; ignore silently.
    }

    const code = stripComments(raw);
    if (code.length === 0) continue;

    const arrowIdx = code.lastIndexOf('>');
    if (arrowIdx < 0) {
      throw new Error(
        `Missing '> target' on line ${lineNumber}: ${raw.trim()}`
      );
    }
    const left = code.slice(0, arrowIdx).trim();
    const target = code.slice(arrowIdx + 1).trim();
    if (left.length === 0) {
      throw new Error(`Empty generator command on line ${lineNumber}`);
    }
    if (target.length === 0) {
      throw new Error(`Empty output target on line ${lineNumber}`);
    }

    const tokens = tokenize(left);
    const generator = tokens[0];
    if (path.extname(generator) !== '') {
      throw new Error(
        `Generator name must not include an extension on line ${lineNumber}: "${generator}"`
      );
    }
    const args = tokens.slice(1);

    out.push({
      generator,
      args,
      output: parseTarget(target, lineNumber),
      ...(activeGroup !== undefined ? { group: activeGroup } : {}),
      raw: raw.trim(),
      lineNumber,
    });
  }

  return out;
}

/**
 * Validates that every generator referenced by the script exists in
 * {@link LocalGenerator}[]. Throws on the first unknown generator.
 */
export function validateGeneratorReferences(
  lines: ParsedScriptLine[],
  generators: LocalGenerator[]
): void {
  const known = new Set(generators.map(g => g.name));
  for (const line of lines) {
    if (!known.has(line.generator)) {
      throw new Error(
        `Generator "${line.generator}" (line ${line.lineNumber}) ` +
          `not found in configuration. ` +
          `Available: ${[...known].join(', ') || '(none)'}`
      );
    }
  }
}

/**
 * Validates that every {@link LocalManualTest.input} file exists on disk.
 */
export function validateManualTests(manuals: LocalManualTest[]): void {
  for (const m of manuals) {
    const inputPath = path.resolve(process.cwd(), m.input);
    if (!fs.existsSync(inputPath)) {
      throw new Error(`Manual test input not found: ${m.input}`);
    }
    if (m.output) {
      const outputPath = path.resolve(process.cwd(), m.output);
      if (!fs.existsSync(outputPath)) {
        throw new Error(`Manual test output not found: ${m.output}`);
      }
    }
    if (m.index < 1) {
      throw new Error(
        `Manual test index must be >= 1, got ${m.index} for ${m.input}`
      );
    }
  }
}

/**
 * Resolves a script + manual tests into a flat, ordered list of
 * {@link ResolvedTest}s with concrete Polygon indices assigned.
 *
 * Conflict rules:
 *   - Manual indices reserve their slot; script `$` will skip them.
 *   - Two test entries cannot share an index — error.
 *   - Multi-output generator targets reserve every listed index.
 */
export function resolveTests(
  scriptLines: ParsedScriptLine[],
  manualTests: LocalManualTest[]
): ResolvedTest[] {
  const used = new Set<number>();
  const resolved: ResolvedTest[] = [];

  // Manual tests first — they have explicit indices.
  for (const m of manualTests) {
    if (used.has(m.index)) {
      throw new Error(`Duplicate test index ${m.index} (manual: ${m.input})`);
    }
    used.add(m.index);
    resolved.push({
      index: m.index,
      source: {
        kind: 'manual',
        inputFile: m.input,
        ...(m.output ? { outputFile: m.output } : {}),
      },
      ...(m.group !== undefined ? { group: m.group } : {}),
      ...(m.points !== undefined ? { points: m.points } : {}),
      ...(m.useInStatements !== undefined
        ? { useInStatements: m.useInStatements }
        : {}),
    });
  }

  let nextDollar = 1;
  for (const line of scriptLines) {
    if (line.output.kind === 'single') {
      let idx: number;
      if (line.output.index === null) {
        while (used.has(nextDollar)) nextDollar++;
        idx = nextDollar;
        nextDollar++;
      } else {
        idx = line.output.index;
        if (used.has(idx)) {
          throw new Error(
            `Duplicate test index ${idx} on line ${line.lineNumber}: ${line.raw}`
          );
        }
      }
      used.add(idx);
      resolved.push({
        index: idx,
        source: {
          kind: 'generator',
          generator: line.generator,
          args: line.args,
          multiOutputs: null,
        },
        ...(line.group !== undefined ? { group: line.group } : {}),
      });
    } else {
      const indices = line.output.indices;
      for (const idx of indices) {
        if (used.has(idx)) {
          throw new Error(
            `Duplicate test index ${idx} on line ${line.lineNumber}: ${line.raw}`
          );
        }
        used.add(idx);
      }
      // One ResolvedTest per produced file — they all share the same line.
      for (const idx of indices) {
        resolved.push({
          index: idx,
          source: {
            kind: 'generator',
            generator: line.generator,
            args: line.args,
            multiOutputs: indices.slice(),
          },
          ...(line.group !== undefined ? { group: line.group } : {}),
        });
      }
    }
  }

  resolved.sort((a, b) => a.index - b.index);
  return resolved;
}
