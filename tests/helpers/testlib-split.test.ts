import { describe, expect, it } from 'vitest';
import {
  includesTestlibFirst,
  splitTestlib,
} from '../../src/helpers/testlib-split';
import { MINI_TESTLIB } from './mini-testlib';

describe('testlib-split.ts', () => {
  describe('splitTestlib', () => {
    const split = splitTestlib(MINI_TESTLIB)!;

    it('splits the fixture', () => {
      expect(split).not.toBeNull();
    });

    it('reduces free function definitions to declarations and drops static', () => {
      expect(split.header).toContain('int nextId();');
      expect(split.header).not.toContain('return ++id;');
      expect(split.header).toContain('void quit(const char *message = "bye");');
      expect(split.implementation).toContain('int nextId() {');
      expect(split.implementation).not.toContain('static int nextId');
    });

    it('keeps inline functions and templates in the header', () => {
      expect(split.header).toContain(
        'inline int twice(int x) { return 2 * x; }'
      );
      expect(split.header).not.toContain('static inline');
      expect(split.header).toContain('T identity(const T &x) { return x; }');
      expect(split.header).toContain(
        'inline int peekId() { return nextId() - 1; }'
      );
    });

    it('declares mutable globals extern and defines them in the implementation', () => {
      for (const declaration of [
        'extern char __buffer[16];',
        'extern int __usage;',
        'extern int __exitCode;',
        'extern const char *features[];',
        'extern std::function<int(int)> __scorer;',
      ]) {
        expect(split.header).toContain(declaration);
      }
      expect(split.implementation).toContain('char __buffer[16];');
      expect(split.implementation).toContain('int __usage = 0;');
      expect(split.implementation).toContain(
        'const char *features[] = {"a", "b{"};'
      );
    });

    it('keeps constants in the header', () => {
      expect(split.header).toContain('const int MAX_CASE = 100;');
    });

    it('moves out-of-class member definitions to the implementation', () => {
      expect(split.header).toContain('int get() const;');
      expect(split.header).not.toContain('Counter::Counter()');
      expect(split.header).not.toContain('Counter::get');
      expect(split.header).not.toContain('Counter::created = 0');
      expect(split.implementation).toContain('Counter::Counter() : value(0) {');
      expect(split.implementation).toContain('int Counter::created = 0;');
    });

    it('declares an object defined together with its class', () => {
      expect(split.header).toContain('};\nextern Registry registry;');
      expect(split.implementation).toContain('} registry;');
    });

    it('declares explicit specializations', () => {
      expect(split.header).toMatch(
        /template<>\n#ifdef __GNUC__\n__attribute__\(\(pure\)\)\n#endif\nint parse<int>\(const std::string &s\);/
      );
    });

    it('declares a function whose signature is chosen by #if / #else', () => {
      const result = splitTestlib(
        '#if A\nstatic void setBinary(int fd)\n#else\nstatic void setBinary(long fd)\n#endif\n{\n    (void) fd;\n}\n'
      )!;

      expect(result.header).toBe(
        '#if A\nvoid setBinary(int fd)\n#else\nvoid setBinary(long fd)\n#endif\n;\n'
      );
      expect(result.implementation).not.toContain('static');
    });

    it('keeps preprocessor conditionals balanced in both halves', () => {
      const balance = (source: string) =>
        (source.match(/^#\s*if/gm) ?? []).length -
        (source.match(/^#\s*endif/gm) ?? []).length;
      expect(balance(split.header)).toBe(0);
      expect(balance(split.implementation)).toBe(0);
    });

    it('leaves macros and includes untouched', () => {
      expect(split.header).toContain('#define FMT(x) do { x; } while (0)');
      expect(split.header).toContain('#include <functional>');
    });

    it.each([
      ['a namespace', 'namespace a { void f() {} }\nint x;\n'],
      ['an extern "C" block', 'extern "C" { void f() {} }\n'],
      ['several variables in one declaration', 'int a, b;\n'],
      ['an operator definition', 'bool operator<(A a, A b) { return 0; }\n'],
      ['an unterminated comment', 'int x; /* no end\n'],
      ['a class that declares an unnamed object', 'struct { int v; } s, t;\n'],
      ['a conditional that splits a statement', 'int x\n#endif\n;\n'],
      [
        'branches with different braces',
        'void f() {\n#ifdef A\n{\n#endif\n}\n',
      ],
      ['an unfinished statement', 'int x = 1\n'],
    ])('returns null for %s', (_name, source) => {
      expect(splitTestlib(source)).toBeNull();
    });
  });

  describe('includesTestlibFirst', () => {
    it.each([
      ['a bare include', '#include "testlib.h"\nint main() {}'],
      [
        'comments and blank lines first',
        '// gen\n/* multi\nline */\n\n#include "testlib.h"\n',
      ],
      [
        'standard headers first',
        '#include <bits/stdc++.h>\n#include <vector>\n#include <stdio.h>\n#include "testlib.h"\n',
      ],
    ])('accepts %s', (_name, source) => {
      expect(includesTestlibFirst(source)).toBe(true);
    });

    it.each([
      ['a define first', '#define EJUDGE\n#include "testlib.h"\n'],
      ['a pragma first', '#pragma GCC optimize("O3")\n#include "testlib.h"\n'],
      ['code first', 'using namespace std;\n#include "testlib.h"\n'],
      [
        'another local header first',
        '#include "gen.h"\n#include "testlib.h"\n',
      ],
      [
        'a non-standard system header first',
        '#include <windows.h>\n#include "testlib.h"\n',
      ],
      ['an angle-bracket testlib', '#include <testlib.h>\n'],
      ['no testlib at all', '#include <iostream>\nint main() {}\n'],
    ])('rejects %s', (_name, source) => {
      expect(includesTestlibFirst(source)).toBe(false);
    });
  });
});
