/**
 * @fileoverview Splits a single-header `testlib.h` into a declarations-only
 * header and an implementation file.
 *
 * testlib is one header that defines hundreds of non-inline functions and
 * globals, so every generator, validator and checker spends most of its
 * compile time optimizing testlib itself: an empty `main()` that includes it
 * takes as long to compile as a real validator. Splitting it lets polyman
 * compile testlib's bodies once into an object file and link that object
 * into each program, which then only has to parse the declarations.
 *
 * The problem's own `testlib.h` is never modified; the split copies live in
 * the compilation cache (see `prebuilt-testlib.ts`).
 *
 * The split is textual and works on testlib's layout: top-level functions,
 * classes and globals, no namespaces. Every non-template, non-inline function
 * definition is reduced to a declaration, out-of-class member definitions and
 * mutable globals move to the implementation, and top-level `static` is
 * dropped so the header and the object share one copy of each function and
 * variable. Anything the splitter does not recognize makes it return null,
 * and a split that does not compile or link is detected by the caller;
 * either way polyman compiles against the original header as before.
 */

/** Bumped whenever the split output changes, to invalidate prebuilt objects. */
export const SPLIT_FORMAT_VERSION = 1;

/**
 * The two halves of a split `testlib.h`.
 */
export interface TestlibSplit {
  /** Declarations only: included by every program instead of `testlib.h`. */
  header: string;
  /** Every definition: compiled once into the shared object. */
  implementation: string;
}

type TokenKind =
  | 'pp'
  | 'space'
  | 'comment'
  | 'literal'
  | 'ident'
  | 'number'
  | 'punct';

interface Token {
  kind: TokenKind;
  text: string;
  /** Directive name of a preprocessor line (`if`, `endif`, `define`, ...). */
  directive?: string;
}

const CONDITIONAL_OPEN = new Set(['if', 'ifdef', 'ifndef']);
const CONDITIONAL_BRANCH = new Set(['elif', 'else', 'elifdef', 'elifndef']);
const CLASS_KEYS = new Set(['class', 'struct', 'union', 'enum']);
const KEPT_DECLARATIONS = new Set([
  'typedef',
  'using',
  'extern',
  'static_assert',
  'template',
]);
/** Keywords whose parenthesized argument is not a function's parameter list. */
const PAREN_KEYWORDS = new Set([
  '__attribute__',
  '__declspec',
  'alignas',
  'decltype',
  '__typeof__',
  'typeof',
]);

/**
 * Headers a source may include before `testlib.h` without changing how
 * testlib compiles: the C++ standard library and the C standard headers.
 */
const C_STANDARD_HEADERS = new Set([
  'assert.h',
  'complex.h',
  'ctype.h',
  'errno.h',
  'fenv.h',
  'float.h',
  'inttypes.h',
  'iso646.h',
  'limits.h',
  'locale.h',
  'math.h',
  'setjmp.h',
  'signal.h',
  'stdarg.h',
  'stdbool.h',
  'stddef.h',
  'stdint.h',
  'stdio.h',
  'stdlib.h',
  'string.h',
  'time.h',
  'uchar.h',
  'wchar.h',
  'wctype.h',
]);

function isCode(token: Token): boolean {
  return token.kind !== 'space' && token.kind !== 'comment';
}

function skipQuoted(source: string, start: number): number {
  const quote = source[start];
  for (let j = start + 1; j < source.length; j++) {
    const ch = source[j];
    if (ch === '\\') {
      j++;
    } else if (ch === quote) {
      return j + 1;
    } else if (ch === '\n') {
      return -1;
    }
  }
  return -1;
}

function scanPreprocessorLine(source: string, start: number): number {
  let j = start;
  while (j < source.length && source[j] !== '\n') {
    if (source[j] === '\\' && source[j + 1] === '\n') {
      j += 2;
    } else if (source.startsWith('\\\r\n', j)) {
      j += 3;
    } else if (source.startsWith('/*', j)) {
      const end = source.indexOf('*/', j + 2);
      if (end < 0) return -1;
      j = end + 2;
    } else if (source.startsWith('//', j)) {
      while (j < source.length && source[j] !== '\n') j++;
    } else if (source[j] === '"' || source[j] === "'") {
      // An apostrophe in `#error don't` is not a literal; skip it alone.
      const end = skipQuoted(source, j);
      j = end < 0 ? j + 1 : end;
    } else {
      j++;
    }
  }
  return j;
}

/**
 * Splits C++ source into tokens that are coarse enough to find statement
 * and body boundaries: preprocessor lines, comments and literals are single
 * tokens, so braces inside them are never counted.
 *
 * @returns The tokens, or null for input it cannot tokenize (for example an
 *   unterminated comment)
 */
function tokenize(source: string): Token[] | null {
  const tokens: Token[] = [];
  const push = (kind: TokenKind, start: number, end: number) =>
    tokens.push({ kind, text: source.slice(start, end) });
  let atLineStart = true;
  let i = 0;

  while (i < source.length) {
    const c = source[i];

    if (c === '\n') {
      push('space', i, i + 1);
      atLineStart = true;
      i++;
      continue;
    }
    if (/[ \t\r\f\v]/.test(c)) {
      let j = i + 1;
      while (j < source.length && /[ \t\r\f\v]/.test(source[j])) j++;
      push('space', i, j);
      i = j;
      continue;
    }
    if (c === '#' && atLineStart) {
      const end = scanPreprocessorLine(source, i);
      if (end < 0) return null;
      const text = source.slice(i, end);
      tokens.push({
        kind: 'pp',
        text,
        directive: /^#\s*([A-Za-z_]+)/.exec(text)?.[1] ?? '',
      });
      i = end;
      continue;
    }

    atLineStart = false;
    if (source.startsWith('//', i)) {
      let j = i;
      while (j < source.length && source[j] !== '\n') j++;
      push('comment', i, j);
      i = j;
      continue;
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      if (end < 0) return null;
      push('comment', i, end + 2);
      i = end + 2;
      continue;
    }

    const raw = /^(?:u8|u|U|L)?R"([^()\\\s]{0,16})\(/.exec(
      source.slice(i, i + 24)
    );
    if (raw) {
      const close = `)${raw[1]}"`;
      const end = source.indexOf(close, i + raw[0].length);
      if (end < 0) return null;
      push('literal', i, end + close.length);
      i = end + close.length;
      continue;
    }
    if (c === '"' || c === "'") {
      const end = skipQuoted(source, i);
      if (end < 0) return null;
      push('literal', i, end);
      i = end;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < source.length && /[A-Za-z0-9_]/.test(source[j])) j++;
      const word = source.slice(i, j);
      if (
        (source[j] === '"' || source[j] === "'") &&
        ['L', 'u', 'U', 'u8'].includes(word)
      ) {
        const end = skipQuoted(source, j);
        if (end < 0) return null;
        push('literal', i, end);
        i = end;
      } else {
        push('ident', i, j);
        i = j;
      }
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(source[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < source.length) {
        const ch = source[j];
        if (/[0-9A-Za-z_.]/.test(ch)) {
          j++;
        } else if (ch === "'" && /[0-9A-Za-z]/.test(source[j + 1] ?? '')) {
          j++;
        } else if ((ch === '+' || ch === '-') && /[eEpP]/.test(source[j - 1])) {
          j++;
        } else {
          break;
        }
      }
      push('number', i, j);
      i = j;
      continue;
    }
    if (source.startsWith('::', i)) {
      push('punct', i, i + 2);
      i += 2;
      continue;
    }
    push('punct', i, i + 1);
    i++;
  }

  return tokens;
}

/**
 * Finds the `}` that closes the `{` at `open`. Preprocessor conditionals are
 * assumed to pick exactly one branch, so braces are counted in one branch
 * only, and every branch must open and close the same number of braces.
 *
 * @returns Index of the closing brace, or -1 when it cannot be determined
 */
function findClosingBrace(tokens: Token[], open: number): number {
  const conditionals: { start: number; deltas: number[]; hasElse: boolean }[] =
    [];
  let depth = 0;

  for (let j = open; j < tokens.length; j++) {
    const token = tokens[j];
    if (token.kind === 'pp') {
      const directive = token.directive ?? '';
      if (CONDITIONAL_OPEN.has(directive)) {
        conditionals.push({ start: depth, deltas: [], hasElse: false });
      } else if (CONDITIONAL_BRANCH.has(directive)) {
        const top = conditionals.at(-1);
        if (!top) return -1;
        top.deltas.push(depth - top.start);
        top.hasElse ||= directive === 'else';
        depth = top.start;
      } else if (directive === 'endif') {
        const top = conditionals.pop();
        if (!top) return -1;
        top.deltas.push(depth - top.start);
        if (!top.hasElse) top.deltas.push(0);
        if (!top.deltas.every(delta => delta === top.deltas[0])) return -1;
        depth = top.start + top.deltas[0];
      }
      continue;
    }
    if (token.kind !== 'punct') continue;
    if (token.text === '{') {
      depth++;
    } else if (token.text === '}') {
      depth--;
      if (depth === 0) return conditionals.length === 0 ? j : -1;
    }
  }
  return -1;
}

function text(tokens: Token[]): string {
  return tokens.map(t => t.text).join('');
}

/**
 * What remains of a definition removed from the header: its preprocessor
 * lines, which may close a conditional opened before it
 * (`#ifdef __GNUC__` / `__attribute__((pure))` / `#endif` / `int A::f() {`).
 */
function directives(tokens: Token[]): string {
  return tokens
    .filter(t => t.kind === 'pp')
    .map(t => `${t.text}\n`)
    .join('');
}

/**
 * Removes every `static` keyword outside braces, and the space after each.
 * A signature chosen by `#if` / `#else` repeats it once per branch.
 */
function withoutStatic(tokens: Token[]): Token[] {
  const result: Token[] = [];
  let depth = 0;
  for (let j = 0; j < tokens.length; j++) {
    const token = tokens[j];
    if (token.text === '{') depth++;
    else if (token.text === '}') depth--;
    if (depth === 0 && token.kind === 'ident' && token.text === 'static') {
      if (tokens[j + 1]?.kind === 'space') j++;
      continue;
    }
    result.push(token);
  }
  return result;
}

/**
 * Ends a declaration with `;`. When it ends in a directive (a signature
 * chosen by `#if` / `#else` / `#endif`), the `;` goes on the next line.
 */
function terminate(declaration: Token[]): string {
  const last = declaration.filter(isCode).at(-1);
  const body = text(declaration).trimEnd();
  return last?.kind === 'pp' ? `${body}\n;` : `${body};`;
}

/**
 * Index (into `code`) of the first `(` that opens a parameter list or
 * initializer, skipping `__attribute__((...))` and similar, and parentheses
 * inside template arguments (`std::function<double(int)> f;`).
 */
function firstParen(code: Token[]): number {
  let depth = 0;
  let angle = 0;
  for (let j = 0; j < code.length; j++) {
    const t = code[j].text;
    if (t === '(') {
      if (
        depth === 0 &&
        angle === 0 &&
        !PAREN_KEYWORDS.has(code[j - 1]?.text ?? '')
      ) {
        return j;
      }
      depth++;
    } else if (t === ')') {
      depth--;
    } else if (depth === 0 && t === '<') {
      angle++;
    } else if (depth === 0 && t === '>' && angle > 0) {
      angle--;
    }
  }
  return -1;
}

/**
 * Whether the name that ends just before `end` is qualified (`A::f`,
 * `A::~A`, `A::x`), i.e. defines a member declared in a class.
 */
function isQualifiedName(code: Token[], end: number): boolean {
  let k = end - 1;
  if (code[k]?.text === '>') {
    let depth = 0;
    for (; k >= 0; k--) {
      if (code[k].text === '>') depth++;
      else if (code[k].text === '<' && --depth === 0) break;
    }
    k--;
  }
  if (code[k]?.kind !== 'ident') return false;
  if (code[k - 1]?.text === '~') k--;
  return code[k - 1]?.text === '::';
}

function splitFunction(
  head: Token[],
  body: Token[]
): { header: string; implementation: string } | null {
  const code = head.filter(isCode);
  const words = new Set(code.map(t => t.text));
  if (words.has('operator') || words.has('try')) return null;

  const stripped = withoutStatic(head);
  const definition = text(stripped) + text(body);
  const isTemplate =
    code[0]?.text === 'template' &&
    !(code[1]?.text === '<' && code[2]?.text === '>');
  if (
    isTemplate ||
    words.has('inline') ||
    words.has('constexpr') ||
    words.has('consteval')
  ) {
    return { header: definition, implementation: definition };
  }

  const paren = firstParen(code);
  if (paren < 0) return null;
  if (isQualifiedName(code, paren)) {
    return { header: directives(head), implementation: definition };
  }
  return {
    header: terminate(stripped),
    implementation: definition,
  };
}

function splitDeclaration(
  statement: Token[]
): { header: string; implementation: string } | null {
  const code = statement.filter(isCode);
  const first = code[0]?.text ?? '';
  const keep = { header: text(statement), implementation: text(statement) };

  if (first === ';' || KEPT_DECLARATIONS.has(first)) return keep;
  if (CLASS_KEYS.has(first)) {
    const close = code.map(t => t.text).lastIndexOf('}');
    if (close < 0 || close === code.length - 2) return keep;
    // `class Validator {...} validator;` also defines a global object:
    // keep the class, declare the object, define it once in the object file.
    const name = code[1];
    const variable = code.slice(close + 1, -1);
    if (
      name?.kind !== 'ident' ||
      !['{', ':'].includes(code[2]?.text ?? '') ||
      variable.length !== 1 ||
      variable[0].kind !== 'ident'
    ) {
      return null;
    }
    const classText = text(statement.slice(0, statement.indexOf(code[close])));
    return {
      header: `${classText}};\nextern ${name.text} ${variable[0].text};`,
      implementation: text(statement),
    };
  }

  // Where the declarator ends: the first top-level `=`, `{` or `;`.
  let depth = 0;
  let angle = 0;
  let end = code.length - 1;
  for (let j = 0; j < code.length; j++) {
    const t = code[j].text;
    if (t === '(' || t === '[') depth++;
    else if (t === ')' || t === ']') depth--;
    else if (depth === 0 && t === '<') angle++;
    else if (depth === 0 && t === '>') angle--;
    else if (depth === 0 && (t === '=' || t === '{' || t === ';')) {
      end = j;
      break;
    } else if (depth === 0 && angle === 0 && t === ',') {
      return null;
    }
  }

  const paren = firstParen(code);
  if (paren >= 0 && paren < end) {
    // A function declaration (or a macro call such as `NORETURN_MACRO(x);`).
    const stripped = text(withoutStatic(statement));
    return { header: stripped, implementation: stripped };
  }

  let name = end - 1;
  while (code[name]?.text === ']') {
    while (name >= 0 && code[name].text !== '[') name--;
    name--;
  }
  if (isQualifiedName(code, name + 1)) {
    // Out-of-class definition of a static data member.
    return { header: directives(statement), implementation: text(statement) };
  }

  const declarator = code.slice(0, end);
  const words = new Set(declarator.map(t => t.text));
  const isConstObject =
    words.has('constexpr') ||
    (words.has('const') && !words.has('*') && !words.has('&'));
  if (isConstObject) return keep;

  // A mutable global: declare it here, define it once in the object.
  const endToken = code[end];
  const declaration = withoutStatic(
    statement.slice(0, statement.indexOf(endToken))
  );
  return {
    header: `extern ${terminate(declaration)}`,
    implementation: text(withoutStatic(statement)),
  };
}

/**
 * Splits `testlib.h` into a declarations-only header and an implementation.
 *
 * @param {string} source - Contents of `testlib.h`
 * @returns {TestlibSplit | null} The split, or null when the source contains
 *   a construct the splitter does not handle
 *
 * @example
 * const split = splitTestlib(fs.readFileSync('testlib.h', 'utf-8'));
 * // split.header:         'void registerGen(int argc, char *argv[], int);'
 * // split.implementation: 'void registerGen(int argc, char *argv[], int) {...}'
 */
export function splitTestlib(source: string): TestlibSplit | null {
  const tokens = tokenize(source);
  if (tokens === null) return null;

  const header: string[] = [];
  const implementation: string[] = [];
  const emit = (part: { header: string; implementation: string }) => {
    header.push(part.header);
    implementation.push(part.implementation);
  };

  let statement: Token[] = [];
  let depth = 0;
  // Conditionals opened inside the current statement, and outside any.
  let conditionals = 0;
  let outerConditionals = 0;
  let braced = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const directive = token.directive ?? '';

    if (statement.length === 0 && !(isCode(token) && token.kind !== 'pp')) {
      if (CONDITIONAL_OPEN.has(directive)) outerConditionals++;
      else if (directive === 'endif') outerConditionals--;
      emit({ header: token.text, implementation: token.text });
      continue;
    }
    statement.push(token);

    if (token.kind === 'pp') {
      if (CONDITIONAL_OPEN.has(directive)) {
        conditionals++;
      } else if (CONDITIONAL_BRANCH.has(directive) || directive === 'endif') {
        if (conditionals > 0) {
          if (directive === 'endif') conditionals--;
        } else if (outerConditionals > 0) {
          // testlib wraps attributes this way before a declaration:
          //   #ifdef __GNUC__ / __attribute__((const)) / #endif / int f();
          // The directives stay in the statement's text in both halves.
          if (directive === 'endif') outerConditionals--;
        } else {
          return null;
        }
      }
      continue;
    }
    if (token.kind !== 'punct') continue;

    if (token.text === '(' || token.text === '[') {
      depth++;
    } else if (token.text === ')' || token.text === ']') {
      depth--;
    } else if (depth === 0 && token.text === ';') {
      if (conditionals !== 0) return null;
      const part = splitDeclaration(statement);
      if (part === null) return null;
      emit(part);
      statement = [];
      braced = false;
    } else if (depth === 0 && token.text === '{' && !braced) {
      if (conditionals !== 0) return null;
      const close = findClosingBrace(tokens, i);
      if (close < 0) return null;

      const head = statement.slice(0, -1);
      const code = head.filter(isCode);
      // testlib has neither; the splitter does not descend into them.
      if (
        code[0]?.text === 'namespace' ||
        (code[0]?.text === 'extern' && code[1]?.kind === 'literal')
      ) {
        return null;
      }
      const paren = firstParen(code);
      const equals = code.findIndex(t => t.text === '=');
      // `T x = {...}` is a variable; `void f(int x = 1) {` is a function.
      const isFunction =
        !CLASS_KEYS.has(code[0]?.text ?? '') &&
        paren >= 0 &&
        (equals < 0 || equals > paren);

      if (isFunction) {
        const part = splitFunction(head, tokens.slice(i, close + 1));
        if (part === null) return null;
        emit(part);
        statement = [];
      } else {
        // A class body or a braced initializer: the statement ends at `;`.
        statement.push(...tokens.slice(i + 1, close + 1));
        braced = true;
      }
      i = close;
    }
  }

  if (statement.some(isCode)) return null;
  emit({ header: text(statement), implementation: text(statement) });
  return { header: header.join(''), implementation: implementation.join('') };
}

/**
 * Whether a source includes `testlib.h` before anything that could change
 * how testlib compiles. testlib reads configuration macros (`EJUDGE`,
 * `USE_RND_AS_BEFORE_087`, ...), so a source that defines anything, uses a
 * pragma, or declares code before the include must compile against the
 * original header. Standard library includes are allowed.
 *
 * @param {string} source - Contents of a generator, validator, checker or
 *   solution
 * @returns {boolean} True when the prebuilt testlib object can be linked
 *
 * @example
 * includesTestlibFirst('#include "testlib.h"\nint main() {}'); // true
 * includesTestlibFirst('#define EJUDGE\n#include "testlib.h"'); // false
 */
export function includesTestlibFirst(source: string): boolean {
  const tokens = tokenize(source);
  if (tokens === null) return false;

  for (const token of tokens) {
    if (!isCode(token)) continue;
    if (token.kind !== 'pp') return false;
    if (/^#\s*include\s*"testlib\.h"/.test(token.text)) return true;
    const system = /^#\s*include\s*<([^>]+)>\s*(\/\/.*|\/\*.*\*\/\s*)?$/.exec(
      token.text
    );
    const name = system?.[1];
    if (
      name === undefined ||
      !(
        /^[a-z_]+$/.test(name) ||
        name === 'bits/stdc++.h' ||
        C_STANDARD_HEADERS.has(name)
      )
    ) {
      return false;
    }
  }
  return false;
}
