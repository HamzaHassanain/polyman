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
 *                                — expanded over the inclusive range (counting
 *                                  down when a > b)
 *   - `<#list [5, 50, 500] as n> ... </#list>`
 *                                — expanded over a sequence of integers
 *   - `<#list ["a", r"b\c"] as s> ... </#list>`
 *                                — expanded over a sequence of string
 *                                  literals, raw (`r"..."`) ones included
 *   - `<#assign n = 7>`          — defines an integer variable
 *   - `${expr}`                  — integer expression over loop and assigned
 *                                  variables: `+ - * %`, parentheses, unary
 *                                  minus. A bare `${name}` also prints a
 *                                  string loop variable. Anything else is
 *                                  rejected, never passed through literally.
 *
 * Any other FreeMarker directive (`<#if>`, `<#macro>`, `<@x>`, ...), the
 * `#{...}` numeric interpolation and the square-bracket tag syntax (`[#list]`,
 * `[@x]`) are rejected with an error that names them.
 *
 * One command per line: a second unquoted `>` on a line is rejected, as
 * Polygon does. Iterations of a `<#list>` are joined without a separator, like
 * FreeMarker, so a one-line list body puts all its commands on one line.
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
import { insideProblem } from './utils';

const COMMENT_RE = /<#--([\s\S]*?)-->/g;

/**
 * Maximum number of `<#list>` iterations a script may expand to, summed over
 * all lists (nested lists multiply). Guards against `1..1000000000` exhausting
 * memory.
 */
export const MAX_LIST_ITEMS = 10000;

/**
 * Maximum number of tests one multi-output target (`{1-100}`) may list, and
 * the maximum number of tests a whole script may produce. Guards against
 * `{1-100000000}` exhausting memory. Separate from {@link MAX_LIST_ITEMS} so
 * the two limits can change independently.
 */
export const MAX_SCRIPT_TESTS = 10000;
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
    const filePath = insideProblem(baseDir, gs.scriptFile);
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
 * Rewrites generator references for upload to Polygon.
 *
 * Locally a script line starts with `Config.json.generators[].name`, which is
 * free-form (`gen-random`). Polygon resolves the same token against the
 * uploaded source file name without its extension (`gen` for `gen.cpp`), so a
 * script pushed verbatim breaks whenever the two differ. Comments, FreeMarker
 * directives, arguments and targets are preserved byte-for-byte; only the
 * leading generator token of each command line is swapped.
 *
 * @param script - raw local script text
 * @param generators - configured generators used to map name -> source
 * @returns script text safe to send to `problem.saveScript`
 *
 * @example
 * toPolygonScript('gen-random 10 > $', [
 *   { name: 'gen-random', source: './generators/gen.cpp' },
 * ]);
 * // Returns: 'gen 10 > $'
 */
export function toPolygonScript(
  script: string,
  generators: LocalGenerator[]
): string {
  const remoteNames = new Map<string, string>();
  for (const g of generators) {
    remoteNames.set(g.name, path.basename(g.source).replace(/\.[^.]+$/, ''));
  }

  return script
    .split(/(\r?\n)/)
    .map(piece => {
      if (piece === '\n' || piece === '\r\n') return piece;
      // Blank out comments in place so token offsets still map onto `piece`.
      const masked = piece.replace(COMMENT_RE, m => ' '.repeat(m.length));
      const match = /^\s*(\S+)/.exec(masked);
      if (!match) return piece;
      const token = match[1];
      const remote = remoteNames.get(token);
      if (remote === undefined || remote === token) return piece;
      const start = match[0].length - token.length;
      return piece.slice(0, start) + remote + piece.slice(start + token.length);
    })
    .join('');
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

/**
 * Offsets of every `>` outside quotes, using the same quoting rules as
 * {@link tokenize}.
 */
function unquotedArrows(line: string): number[] {
  const out: number[] = [];
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '>') {
      out.push(i);
    }
  }
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
    // Count before allocating, so a huge range never gets materialized.
    let counted = 0;
    const tooMany = (): Error =>
      new Error(
        `Multi-output target on line ${lineNumber} expands to more than ` +
          `${MAX_SCRIPT_TESTS} tests (limit ${MAX_SCRIPT_TESTS})`
      );
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
        counted += b - a + 1;
        if (counted > MAX_SCRIPT_TESTS) throw tooMany();
        for (let i = a; i <= b; i++) indices.push(i);
      } else if (/^\d+$/.test(p)) {
        const v = parseInt(p, 10);
        if (v < 1) {
          throw new Error(
            `Test index must be >= 1 (got ${v}) on line ${lineNumber}`
          );
        }
        counted++;
        if (counted > MAX_SCRIPT_TESTS) throw tooMany();
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

type FmPiece =
  | { kind: 'text'; value: string; line: number }
  | { kind: 'directive'; body: string; line: number }
  | { kind: 'expr'; source: string; line: number }
  | { kind: 'assign'; name: string; source: string; line: number }
  | {
      kind: 'list';
      header: string;
      name: string;
      line: number;
      body: FmPiece[];
    };

type FmListNode = Extract<FmPiece, { kind: 'list' }>;

/** An expression error without a location; the caller adds the line. */
class FmExprError extends Error {}

const FM_TOKEN_RE =
  /(<#--[\s\S]*?-->)|<(\/?)([#@])([A-Za-z_][\w.]*)|\$\{([^}]*)\}|(#\{)|(\[\/?[#@][\w.]*)/g;

/**
 * Skips a FreeMarker string literal that starts at `start`: `"..."` or
 * `'...'`, where a backslash escapes the next character, or a raw `r"..."`,
 * where it does not. Returns the index just past the closing quote, `null`
 * when no literal starts at `start`, or -1 when the literal never closes.
 */
function skipStringLiteral(source: string, start: number): number | null {
  let i = start;
  if (source[i] === 'r' && !(start > 0 && /\w/.test(source[start - 1]))) i++;
  const quote = source[i];
  if (quote !== '"' && quote !== "'") return null;
  const raw = i > start;
  for (i++; i < source.length; i++) {
    const c = source[i];
    if (c === '\\' && !raw) i++;
    else if (c === quote) return i + 1;
  }
  return -1;
}

/**
 * Index of the `>` that closes a FreeMarker tag whose name ends at `from`.
 * A string literal may contain `>`. Returns -1 when the tag never closes.
 */
function scanTagClose(script: string, from: number): number {
  for (let i = from; i < script.length; i++) {
    const end = skipStringLiteral(script, i);
    if (end !== null) {
      if (end < 0) return -1;
      i = end - 1;
      continue;
    }
    if (script[i] === '>') return i;
  }
  return -1;
}

/**
 * Builds a lookup from a character offset to its 1-based line number. The
 * newline offsets are collected once, so each lookup is a binary search
 * instead of a rescan from the start of the script.
 */
function makeLineLookup(text: string): (offset: number) => number {
  const newlines: number[] = [];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) {
    newlines.push(i);
  }
  return (offset: number): number => {
    // Count the newlines at an index below `offset`.
    let lo = 0;
    let hi = newlines.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (newlines[mid] < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
}

/**
 * Splits a script into text, `@` comment, `${expr}`, `<#assign>` and
 * `<#list>` nodes. Other comments are dropped, as FreeMarker drops them.
 * Throws for any other FreeMarker construct, naming it.
 */
function parseFreeMarker(script: string): FmPiece[] {
  const lineAt = makeLineLookup(script);
  const root: FmPiece[] = [];
  const open: FmListNode[] = [];
  const target = (): FmPiece[] =>
    open.length > 0 ? open[open.length - 1].body : root;

  // A fresh regex per call, so the scan position is never shared.
  const tokenRe = new RegExp(FM_TOKEN_RE.source, 'g');
  let last = 0;
  const addText = (to: number): void => {
    const text = script.slice(last, to);
    const at = text.indexOf('${');
    if (at >= 0) {
      throw new Error(`Unterminated "\${" on line ${lineAt(last + at)}`);
    }
    if (text.length > 0) {
      target().push({ kind: 'text', value: text, line: lineAt(last) });
    }
  };

  let found: RegExpExecArray | null;
  while ((found = tokenRe.exec(script)) !== null) {
    const offset = found.index;
    addText(offset);
    const line = lineAt(offset);

    if (found[1] !== undefined) {
      last = offset + found[0].length;
      const body = found[1].slice('<#--'.length, -'-->'.length).trim();
      if (!body.startsWith('@')) continue;
      // An `@group` comment is read after expansion, where a `${...}` in it
      // would not have been evaluated, so refuse it.
      const interp = found[1].indexOf('${');
      if (interp >= 0) {
        const expr = /^\$\{[^}]*\}?/.exec(found[1].slice(interp))![0];
        throw new Error(
          `Unsupported expression ${expr} in @group on line ` +
            `${lineAt(offset + interp)}`
        );
      }
      target().push({ kind: 'directive', body, line });
      continue;
    }

    if (found[5] !== undefined) {
      last = offset + found[0].length;
      target().push({ kind: 'expr', source: found[5], line });
      continue;
    }

    if (found[6] !== undefined) {
      throw new Error(
        `Unsupported FreeMarker construct #{...} on line ${line}`
      );
    }
    if (found[7] !== undefined) {
      throw new Error(
        `Unsupported FreeMarker construct ${found[7]} (square-bracket syntax) ` +
          `on line ${line}`
      );
    }

    const closing = found[2] === '/';
    const sigil = found[3];
    const name = found[4];
    const shown = `<${found[2]}${sigil}${name}>`;

    const close = scanTagClose(script, tokenRe.lastIndex);
    if (close < 0) {
      throw new Error(`Unclosed FreeMarker tag ${shown} on line ${line}`);
    }
    const args = script.slice(tokenRe.lastIndex, close);
    tokenRe.lastIndex = close + 1;
    last = close + 1;

    if (sigil === '#' && name === 'list') {
      if (closing) {
        if (open.length === 0) {
          throw new Error(`Unexpected </#list> on line ${line}`);
        }
        open.pop();
        continue;
      }
      const header = /^\s+([\s\S]+?)\s+as\s+([A-Za-z_]\w*)\s*$/.exec(args);
      if (!header) {
        throw new Error(
          `Unsupported <#list> form on line ${line}: <#list${args}> ` +
            `(expected <#list a..b as i> or <#list [x, y] as i>)`
        );
      }
      const node: FmListNode = {
        kind: 'list',
        header: header[1],
        name: header[2],
        line,
        body: [],
      };
      target().push(node);
      open.push(node);
      continue;
    }

    if (sigil === '#' && name === 'assign' && !closing) {
      const assign = /^\s+([A-Za-z_]\w*)\s*=\s*([\s\S]+?)\s*$/.exec(args);
      if (!assign) {
        throw new Error(
          `Unsupported <#assign> form on line ${line}: <#assign${args}> ` +
            `(expected <#assign name = expression>)`
        );
      }
      target().push({
        kind: 'assign',
        name: assign[1],
        source: assign[2],
        line,
      });
      continue;
    }

    throw new Error(
      `Unsupported FreeMarker directive ${shown} on line ${line}`
    );
  }
  addText(script.length);

  if (open.length > 0) {
    throw new Error(`Unclosed <#list> on line ${open[open.length - 1].line}`);
  }
  return root;
}

/** A loop variable is an integer, or a string from a quoted sequence item. */
type FmValue = number | string;

/**
 * FreeMarker string-literal escapes. `\x` is handled separately: it takes
 * one to four hex digits. Any other backslash is an error, as in FreeMarker.
 * `\=` is left out: only FreeMarker 2.3.28+ accepts it, and Polygon's
 * version is unknown.
 * https://freemarker.apache.org/docs/dgui_template_exp.html#dgui_template_exp_stringliteral
 */
const STRING_ESCAPES: Record<string, string> = {
  '"': '"',
  "'": "'",
  '{': '{',
  '\\': '\\',
  n: '\n',
  r: '\r',
  t: '\t',
  b: '\b',
  f: '\f',
  l: '<',
  g: '>',
  a: '&',
};

/**
 * Parses a FreeMarker string literal that occupies all of `source`.
 * `source` is already trimmed. A raw string (`r"..."`) is taken as written.
 * Interpolation (`${...}`, `#{...}`) and trailing junk are rejected: this
 * parser does not evaluate them.
 */
function parseStringLiteral(source: string): string {
  const end = skipStringLiteral(source, 0);
  if (end === null) throw new FmExprError('unsupported');
  if (end < 0) throw new FmExprError('Unclosed string');
  if (source.slice(end).trim() !== '') throw new FmExprError('unsupported');

  if (source[0] === 'r') return source.slice(2, end - 1);

  // skipStringLiteral has checked that no backslash escapes the last quote.
  const body = source.slice(1, end - 1);
  let out = '';
  let i = 0;
  while (i < body.length) {
    const c = body[i];

    if (c === '\\') {
      const esc = body[i + 1];
      if (esc === 'x') {
        let j = i + 2;
        let hex = '';
        while (
          hex.length < 4 &&
          j < body.length &&
          /[0-9A-Fa-f]/.test(body[j])
        ) {
          hex += body[j];
          j++;
        }
        if (hex.length === 0) {
          throw new FmExprError('Invalid string escape "\\x"');
        }
        out += String.fromCharCode(parseInt(hex, 16));
        i = j;
        continue;
      }

      const mapped = STRING_ESCAPES[esc];
      if (mapped === undefined)
        throw new FmExprError(`Invalid string escape "\\${esc}"`);

      out += mapped;
      i += 2;
      continue;
    }

    // `$\{` is an escaped `{`, so it does not start an interpolation.
    if ((c === '$' || c === '#') && body[i + 1] === '{') {
      throw new FmExprError('String interpolation is not supported');
    }
    out += c;
    i++;
  }
  return out;
}

/** Splits a `[...]` sequence on commas that are outside string literals. */
function splitSequenceItems(inner: string): string[] {
  const items: string[] = [];
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const end = skipStringLiteral(inner, i);
    if (end !== null) {
      // An unclosed literal is reported when the item is parsed.
      if (end < 0) break;
      i = end - 1;
      continue;
    }
    if (inner[i] === ',') {
      items.push(inner.slice(start, i));
      start = i + 1;
    }
  }
  items.push(inner.slice(start));
  return items;
}

/**
 * A `${...}` or sequence item that is not a string literal: a bare variable
 * that holds a string gives that string, anything else is an integer
 * expression.
 */
function evalValue(
  source: string,
  lookup: (name: string) => FmValue | undefined
): FmValue {
  const name = source.trim();
  if (/^[A-Za-z_]\w*$/.test(name)) {
    const v = lookup(name);
    if (typeof v === 'string') return v;
  }
  return evalExpression(source, lookup);
}

/**
 * One item of a `<#list [...]>` sequence: a string literal, a string
 * variable, or an integer expression.
 */
function evalSequenceItem(
  item: string,
  lookup: (name: string) => FmValue | undefined
): FmValue {
  const trimmed = item.trim();
  if (trimmed.length === 0) throw new FmExprError('unsupported');
  if (skipStringLiteral(trimmed, 0) !== null) {
    return parseStringLiteral(trimmed);
  }
  return evalValue(trimmed, lookup);
}

/**
 * Evaluates an integer expression: `+ - * %`, parentheses, unary minus,
 * integer literals and variables. Anything else (`/`, string literals,
 * built-ins, decimals) is unsupported, because its FreeMarker result can't
 * be matched here with certainty. A variable that holds a string is rejected
 * here too; `${name}` prints it before this function is called.
 */
function evalExpression(
  source: string,
  lookup: (name: string) => FmValue | undefined
): number {
  const tokens = source.match(/\s*(\d+|[A-Za-z_]\w*|[-+*%()]|\S)/g) ?? [];
  const toks = tokens.map(t => t.trim());
  let pos = 0;

  const unsupported = (): never => {
    throw new FmExprError('unsupported');
  };
  const checked = (n: number): number => {
    if (!Number.isSafeInteger(n)) {
      throw new FmExprError('Integer overflow');
    }
    return n;
  };

  const primary = (): number => {
    const t = toks[pos++];
    if (t === undefined) return unsupported();
    if (/^\d+$/.test(t)) return checked(parseInt(t, 10));
    if (/^[A-Za-z_]\w*$/.test(t)) {
      const v = lookup(t);
      if (v === undefined) throw new FmExprError(`Undefined variable "${t}"`);
      if (typeof v !== 'number') {
        throw new FmExprError(`Variable "${t}" is a string`);
      }
      return v;
    }
    if (t === '(') {
      const v = sum();
      if (toks[pos++] !== ')') return unsupported();
      return v;
    }
    return unsupported();
  };
  const unary = (): number => {
    if (toks[pos] === '-') {
      pos++;
      return checked(-unary());
    }
    if (toks[pos] === '+') {
      pos++;
      return unary();
    }
    return primary();
  };
  const product = (): number => {
    let v = unary();
    while (toks[pos] === '*' || toks[pos] === '%') {
      const op = toks[pos++];
      const rhs = unary();
      if (op === '*') {
        v = checked(v * rhs);
      } else {
        if (rhs === 0) throw new FmExprError('Modulo by zero');
        v = v % rhs;
      }
    }
    return v;
  };
  const sum = (): number => {
    let v = product();
    while (toks[pos] === '+' || toks[pos] === '-') {
      const op = toks[pos++];
      const rhs = product();
      v = checked(op === '+' ? v + rhs : v - rhs);
    }
    return v;
  };

  const value = sum();
  if (pos < toks.length) return unsupported();
  return value;
}

/** Adds the script line to an {@link FmExprError}. */
function rethrowExpr(e: unknown, shown: string, line: number): never {
  if (!(e instanceof FmExprError)) throw e;
  if (e.message === 'unsupported') {
    throw new Error(`Unsupported expression ${shown} on line ${line}`, {
      cause: e,
    });
  }
  throw new Error(`${e.message} in ${shown} on line ${line}`, { cause: e });
}

/** One line of the expanded script. */
interface ExpandedLine {
  text: string;
  /** Source line of the line's first piece. */
  line: number;
  /** Bodies of the `@` comments on this line, in order. */
  directives: string[];
}

/**
 * Expands `<#list>`, `<#assign>` and `${expr}` the way Polygon's FreeMarker
 * does for the subset documented at the top of this file, and splits the
 * result into lines. Each line keeps the source line it starts on, so every
 * iteration of a list body points at the body's line in the source. `@`
 * comments travel beside the text, never inside it, so text that a string
 * value puts on a line is never read as a comment.
 */
function expandFreeMarker(script: string): ExpandedLine[] {
  const globals = new Map<string, FmValue>();
  const locals: Map<string, FmValue>[] = [];
  const lookup = (name: string): FmValue | undefined => {
    for (let i = locals.length - 1; i >= 0; i--) {
      const v = locals[i].get(name);
      if (v !== undefined) return v;
    }
    return globals.get(name);
  };
  const evaluate = (source: string, line: number, shown: string): number => {
    try {
      return evalExpression(source, lookup);
    } catch (e) {
      return rethrowExpr(e, shown, line);
    }
  };
  const evaluateItem = (item: string, line: number, shown: string): FmValue => {
    try {
      return evalSequenceItem(item, lookup);
    } catch (e) {
      return rethrowExpr(e, shown, line);
    }
  };

  const lines: ExpandedLine[] = [];
  let current: ExpandedLine | null = null;
  const lineFor = (line: number): ExpandedLine =>
    (current ??= { text: '', line, directives: [] });
  /**
   * Appends text that starts on source line `line`. A newline in source text
   * moves to the next source line; one from a string value does not.
   */
  const write = (text: string, line: number, fromSource: boolean): void => {
    const parts = text.split('\n');
    for (let k = 0; k < parts.length; k++) {
      if (k > 0) {
        lines.push(lineFor(line));
        current = null;
        if (fromSource) line++;
      }
      if (parts[k].length > 0) lineFor(line).text += parts[k];
    }
  };

  let expandedItems = 0;
  const render = (nodes: FmPiece[]): void => {
    for (const node of nodes) {
      if (node.kind === 'text') {
        write(node.value, node.line, true);
      } else if (node.kind === 'directive') {
        lineFor(node.line).directives.push(node.body);
      } else if (node.kind === 'expr') {
        const shown = '${' + node.source.trim() + '}';
        let value: FmValue;
        try {
          value = evalValue(node.source, lookup);
        } catch (e) {
          return rethrowExpr(e, shown, node.line);
        }
        write(String(value), node.line, false);
      } else if (node.kind === 'assign') {
        globals.set(
          node.name,
          evaluate(
            node.source,
            node.line,
            `<#assign ${node.name} = ${node.source}>`
          )
        );
      } else {
        renderList(node);
      }
    }
  };

  const renderList = (node: FmListNode): void => {
    const shown = `<#list ${node.header} as ${node.name}>`;
    const values: FmValue[] = [];
    const tooLarge = (): Error =>
      new Error(
        `${shown} on line ${node.line} expands to more than ` +
          `${MAX_LIST_ITEMS} items in total (limit ${MAX_LIST_ITEMS})`
      );
    const seq = /^\[([\s\S]*)\]$/.exec(node.header.trim());
    if (seq) {
      if (seq[1].trim().length > 0) {
        for (const item of splitSequenceItems(seq[1])) {
          values.push(evaluateItem(item, node.line, shown));
        }
      }
    } else {
      const dots = node.header.indexOf('..');
      if (dots < 0) {
        throw new Error(`Unsupported expression ${shown} on line ${node.line}`);
      }
      const from = evaluate(node.header.slice(0, dots), node.line, shown);
      const to = evaluate(node.header.slice(dots + 2), node.line, shown);
      const step = from <= to ? 1 : -1;
      // Check the size up front so a huge range never gets materialized.
      if (Math.abs(to - from) + 1 > MAX_LIST_ITEMS) {
        throw tooLarge();
      }
      for (let i = from; step === 1 ? i <= to : i >= to; i += step) {
        values.push(i);
      }
    }

    for (const v of values) {
      expandedItems++;
      if (expandedItems > MAX_LIST_ITEMS) throw tooLarge();
      locals.push(new Map([[node.name, v]]));
      try {
        // No separator, like FreeMarker: a one-line body stays on one line.
        // The newlines of a multi-line body come from the body text itself.
        render(node.body);
      } finally {
        locals.pop();
      }
    }
  };

  render(parseFreeMarker(script));
  if (current !== null) lines.push(current);
  for (const l of lines) l.text = l.text.replace(/\r$/, '');
  return lines;
}

/**
 * Parses a Polygon-format generator script into an ordered list of lines.
 *
 * @param script - raw script text
 * @returns parsed lines in source order
 * @throws if a line is malformed, an extension appears in a generator name,
 *         an output target is invalid, or the script expands to more than
 *         {@link MAX_SCRIPT_TESTS} tests
 */
export function parseGeneratorScript(script: string): ParsedScriptLine[] {
  const out: ParsedScriptLine[] = [];
  let activeGroup: string | undefined;
  let totalTests = 0;

  for (const expanded of expandFreeMarker(script)) {
    const lineNumber = expanded.line;
    const raw = expanded.text;

    // A line that starts a group holds nothing else. Other `@` directives
    // are reserved for future use and ignored.
    const groupMatch =
      expanded.directives.length > 0
        ? GROUP_DIRECTIVE_RE.exec(expanded.directives[0])
        : null;
    if (groupMatch) {
      activeGroup = groupMatch[1];
      continue;
    }

    const code = raw.trim();
    if (code.length === 0) continue;

    const arrows = unquotedArrows(code);
    if (arrows.length > 1) {
      // Polygon takes one command per line and rejects the rest with this.
      throw new Error(
        `Line should end with '> testIndex'. (line ${lineNumber}: ` +
          `${raw.trim()})`
      );
    }
    const arrowIdx = arrows.length === 1 ? arrows[0] : code.lastIndexOf('>');
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
    if (generator === undefined) {
      // tokenize() drops empty quoted tokens, so `"" > 1` has none.
      throw new Error(`Empty generator command on line ${lineNumber}`);
    }
    if (path.extname(generator) !== '') {
      throw new Error(
        `Generator name must not include an extension on line ${lineNumber}: "${generator}"`
      );
    }
    const args = tokens.slice(1);

    const output = parseTarget(target, lineNumber);
    totalTests += output.kind === 'multi' ? output.indices.length : 1;
    if (totalTests > MAX_SCRIPT_TESTS) {
      throw new Error(
        `Script expands to more than ${MAX_SCRIPT_TESTS} tests ` +
          `(limit ${MAX_SCRIPT_TESTS}), exceeded on line ${lineNumber}`
      );
    }

    out.push({
      generator,
      args,
      output,
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
