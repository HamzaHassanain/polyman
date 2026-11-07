import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as parser from '../../src/helpers/script-parser';
import type {
  LocalGenerator,
  LocalManualTest,
  LocalTestset,
  ParsedScriptLine,
} from '../../src/types';
import fs from 'fs';
import path from 'path';

vi.mock('fs');

const exists = (mockResult: boolean | ((p: string) => boolean)) => {
  vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
    const s = String(p);
    return typeof mockResult === 'function' ? mockResult(s) : mockResult;
  });
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('parseGeneratorScript - basic line shapes', () => {
  it('parses a single explicit-index line', () => {
    const out = parser.parseGeneratorScript('gen 1 2 3 > 5');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      generator: 'gen',
      args: ['1', '2', '3'],
      output: { kind: 'single', index: 5 },
      lineNumber: 1,
    });
    expect(out[0].group).toBeUndefined();
  });

  it('parses a $ target as null index (deferred)', () => {
    const out = parser.parseGeneratorScript('gen abc > $');
    expect(out[0].output).toEqual({ kind: 'single', index: null });
  });

  it('parses a multi-output target with mixed ranges and singletons', () => {
    const out = parser.parseGeneratorScript('gen 4 7 > {1-3,7,9-10}');
    expect(out[0].output).toEqual({
      kind: 'multi',
      indices: [1, 2, 3, 7, 9, 10],
    });
  });

  it('preserves quoted args as a single token', () => {
    const out = parser.parseGeneratorScript('gen "hello world" 5 > 1');
    expect(out[0].args).toEqual(['hello world', '5']);
  });

  it('skips blank lines', () => {
    const out = parser.parseGeneratorScript('\n\ngen 1 > 1\n\n');
    expect(out).toHaveLength(1);
    expect(out[0].lineNumber).toBe(3);
  });
});

describe('parseGeneratorScript - errors', () => {
  it('rejects extensions in generator names', () => {
    expect(() => parser.parseGeneratorScript('gen.exe 1 > 1')).toThrow(
      /must not include an extension/
    );
    expect(() => parser.parseGeneratorScript('gen.cpp 1 > 1')).toThrow();
  });

  it('rejects a generator name that is an empty quoted token', () => {
    for (const script of ['"" > 1', "'' > 1", '" > $']) {
      expect(() => parser.parseGeneratorScript(script)).toThrow(
        'Empty generator command on line 1'
      );
    }
  });

  it('reports the line number of an empty generator name', () => {
    expect(() =>
      parser.parseGeneratorScript('gen 1 > 1\n\n"" > 2\ngen 3 > 3')
    ).toThrow('Empty generator command on line 3');
  });

  it('rejects missing > target', () => {
    expect(() => parser.parseGeneratorScript('gen 1 2 3')).toThrow(
      /Missing '> target'/
    );
  });

  it('rejects empty target', () => {
    expect(() => parser.parseGeneratorScript('gen 1 >')).toThrow(
      /Empty output target/
    );
  });

  it('rejects empty multi-output target', () => {
    expect(() => parser.parseGeneratorScript('gen > {}')).toThrow(/Empty/);
  });

  it('rejects bad multi-output index', () => {
    expect(() => parser.parseGeneratorScript('gen > {abc}')).toThrow(/Invalid/);
  });

  it('rejects index < 1', () => {
    expect(() => parser.parseGeneratorScript('gen > 0')).toThrow(/>= 1/);
  });

  it('rejects unknown target form', () => {
    expect(() => parser.parseGeneratorScript('gen > foo')).toThrow(
      /Invalid output target/
    );
  });
});

describe('parseGeneratorScript - comments and FreeMarker', () => {
  it('strips inline comments', () => {
    const out = parser.parseGeneratorScript('<#-- a -->gen 1 > 1<#-- b -->');
    expect(out).toHaveLength(1);
    expect(out[0].generator).toBe('gen');
  });

  it('ignores comment-only lines', () => {
    const out = parser.parseGeneratorScript(
      '<#-- this is just a note -->\ngen 1 > 1'
    );
    expect(out).toHaveLength(1);
  });

  it('expands <#list a..b as i> with ${i} substitution', () => {
    const out = parser.parseGeneratorScript(
      '<#list 1..3 as i>\ngen ${i} > $\n</#list>'
    );
    expect(out).toHaveLength(3);
    expect(out.map(l => l.args[0])).toEqual(['1', '2', '3']);
    expect(out.every(l => l.output.kind === 'single')).toBe(true);
  });

  it('expands <#list> in reverse when from > to', () => {
    const out = parser.parseGeneratorScript(
      '<#list 3..1 as i>\ngen ${i} > $\n</#list>'
    );
    expect(out.map(l => l.args[0])).toEqual(['3', '2', '1']);
  });

  it('strips multi-line non-directive comments', () => {
    const out = parser.parseGeneratorScript(
      [
        '<#-- This is a multi-line comment',
        '     spanning several lines.',
        '     None of these lines should fail to parse. -->',
        'gen 1 > 1',
      ].join('\n')
    );
    expect(out).toHaveLength(1);
    expect(out[0].generator).toBe('gen');
    expect(out[0].lineNumber).toBe(4);
  });

  it('preserves @group directives across multi-line comment blocks', () => {
    const out = parser.parseGeneratorScript(
      ['<#--', '  @group main', '-->', 'gen 1 > 1'].join('\n')
    );
    expect(out[0].group).toBe('main');
  });

  it('attaches @group from the most recent header', () => {
    const out = parser.parseGeneratorScript(
      [
        '<#-- @group samples -->',
        'gen 1 > 1',
        '<#-- @group main -->',
        'gen 2 > 2',
        'gen 3 > 3',
      ].join('\n')
    );
    expect(out.map(l => l.group)).toEqual(['samples', 'main', 'main']);
  });
});

describe('parseGeneratorScript - FreeMarker expansion (corpus/scripts)', () => {
  const argsOf = (script: string) =>
    parser.parseGeneratorScript(script).map(l => l.args.join(' '));

  it('list.txt: expands a range with ${i}', () => {
    expect(argsOf('<#list 1..3 as i>\ngen ${i} > $\n</#list>\n')).toEqual([
      '1',
      '2',
      '3',
    ]);
  });

  it('expression.txt: evaluates ${i*10}', () => {
    expect(argsOf('<#list 1..3 as i>\ngen ${i*10} > $\n</#list>\n')).toEqual([
      '10',
      '20',
      '30',
    ]);
  });

  it('assign.txt: substitutes an assigned variable', () => {
    expect(argsOf('<#assign n = 7>\ngen ${n} > $\n')).toEqual(['7']);
  });

  it('sequence.txt: expands a list over a sequence', () => {
    expect(
      argsOf('<#list [5, 50, 500] as n>\ngen ${n} > $\n</#list>\n')
    ).toEqual(['5', '50', '500']);
  });

  it('expands a sequence of strings', () => {
    expect(
      argsOf(
        '<#list ["random", "adversarial"] as mode>\n' +
          'spider -N=5 -label=${mode} > $\n' +
          '</#list>\n'
      )
    ).toEqual(['-N=5 -label=random', '-N=5 -label=adversarial']);
  });

  it('accepts single quotes, commas inside strings, and escapes', () => {
    expect(
      argsOf(
        "<#list ['random', 'adversarial'] as mode>\ngen ${mode} > $\n</#list>"
      )
    ).toEqual(['random', 'adversarial']);
    expect(argsOf('<#list ["a,b", "c"] as s>\ngen ${s} > $\n</#list>')).toEqual(
      ['a,b', 'c']
    );
    expect(
      argsOf('<#list ["a\\\\b", "\\x61"] as s>\ngen ${s} > $\n</#list>')
    ).toEqual(['a\\b', 'a']);
    expect(argsOf('<#list ["a\\tb"] as s>\ngen "${s}" > $\n</#list>')).toEqual([
      'a\tb',
    ]);
  });

  it('keeps a > inside a string literal, including the \\g escape', () => {
    expect(
      argsOf('<#list ["a>b", "c\\gd"] as s>\ngen "${s}" > $\n</#list>')
    ).toEqual(['a>b', 'c>d']);
  });

  it('mixes integers and strings, and reuses a string variable', () => {
    expect(
      argsOf('<#list [1, "a", 2+1] as x>\ngen ${x} > $\n</#list>')
    ).toEqual(['1', 'a', '3']);
    expect(
      argsOf(
        [
          '<#list ["p", "q"] as p>',
          '<#list [p] as t>',
          'gen ${t} > $',
          '</#list>',
          '</#list>',
        ].join('\n')
      )
    ).toEqual(['p', 'q']);
    expect(argsOf('<#list [""] as s>\ngen x${s}y > $\n</#list>')).toEqual([
      'xy',
    ]);
  });

  it('does not let a string loop variable escape its list', () => {
    expect(
      argsOf(
        '<#assign mode = 1>\n<#list ["a"] as mode>\ngen ${mode} > $\n</#list>\ngen ${mode} > $'
      )
    ).toEqual(['a', '1']);
    expect(() =>
      parser.parseGeneratorScript(
        '<#list ["a"] as mode>\ngen ${mode} > $\n</#list>\ngen ${mode} > $'
      )
    ).toThrow(/Undefined variable "mode"/);
  });

  it('nested.txt: expands nested lists in order', () => {
    expect(
      argsOf(
        [
          '<#list 1..2 as i>',
          '<#list 1..2 as j>',
          'gen ${i} ${j} > $',
          '</#list>',
          '</#list>',
          '',
        ].join('\n')
      )
    ).toEqual(['1 1', '1 2', '2 1', '2 2']);
  });

  it('supports + - * % parentheses and unary minus', () => {
    expect(
      argsOf('<#assign n = 7>\ngen ${(n+1)*2} ${n%4} ${n-10} ${-n} ${2*-n} > $')
    ).toEqual(['16 3 -3 -7 -14']);
  });

  it('evaluates expressions in list bounds and sequences', () => {
    expect(
      argsOf('<#assign n = 2>\n<#list n..n*2 as i>\ngen ${i} > $\n</#list>')
    ).toEqual(['2', '3', '4']);
    expect(argsOf('<#list [1+1, 3*3] as n>\ngen ${n} > $\n</#list>')).toEqual([
      '2',
      '9',
    ]);
  });

  it('expands an empty sequence to nothing', () => {
    expect(
      argsOf('<#list [] as n>\ngen ${n} > $\n</#list>\ngen 1 > $')
    ).toEqual(['1']);
  });

  it('scopes the loop variable to its list', () => {
    expect(() =>
      parser.parseGeneratorScript(
        '<#list 1..2 as i>\ngen ${i} > $\n</#list>\ngen ${i} > $'
      )
    ).toThrow(/Undefined variable "i" in \${i} on line 4/);
  });

  it('keeps @group comments working inside a list', () => {
    const out = parser.parseGeneratorScript(
      '<#-- @group g -->\n<#list 1..2 as i>\ngen ${i} > $\n</#list>'
    );
    expect(out.map(l => l.group)).toEqual(['g', 'g']);
  });
});

describe('parseGeneratorScript - unsupported FreeMarker is rejected', () => {
  it('names an unsupported directive and its line', () => {
    expect(() =>
      parser.parseGeneratorScript('gen 1 > $\n<#if true>\ngen 2 > $\n</#if>')
    ).toThrow('Unsupported FreeMarker directive <#if> on line 2');
  });

  it('names an unsupported macro call', () => {
    expect(() => parser.parseGeneratorScript('<@m/>\ngen 1 > $')).toThrow(
      'Unsupported FreeMarker directive <@m> on line 1'
    );
  });

  it('rejects division instead of guessing', () => {
    expect(() =>
      parser.parseGeneratorScript('<#list 1..3 as i>\ngen ${i/2} > $\n</#list>')
    ).toThrow('Unsupported expression ${i/2} on line 2');
  });

  it('rejects an undefined variable', () => {
    expect(() => parser.parseGeneratorScript('gen ${n} > $')).toThrow(
      'Undefined variable "n" in ${n} on line 1'
    );
  });

  it('keeps the expression error as the cause', () => {
    let thrown: unknown;
    try {
      parser.parseGeneratorScript('gen ${n} > $');
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toMatchObject({
      cause: { message: 'Undefined variable "n"' },
    });
  });

  it('never passes ${...} through literally', () => {
    expect(() => parser.parseGeneratorScript('gen ${"a"} > $')).toThrow(
      'Unsupported expression ${"a"} on line 1'
    );
    expect(() => parser.parseGeneratorScript('gen ${1.5} > $')).toThrow(
      /Unsupported expression/
    );
    expect(() => parser.parseGeneratorScript('gen ${i > $')).toThrow(
      'Unterminated "${" on line 1'
    );
  });

  it('rejects modulo by zero and unsupported list forms', () => {
    expect(() => parser.parseGeneratorScript('gen ${5%0} > $')).toThrow(
      /Modulo by zero/
    );
    expect(() =>
      parser.parseGeneratorScript('<#list xs as i>\ngen ${i} > $\n</#list>')
    ).toThrow(/Unsupported expression <#list xs as i> on line 1/);
    expect(() =>
      parser.parseGeneratorScript('<#list 1..2>\ngen 1 > $\n</#list>')
    ).toThrow(/Unsupported <#list> form on line 1/);
  });

  it('rejects unbalanced list tags', () => {
    expect(() => parser.parseGeneratorScript('gen 1 > $\n</#list>')).toThrow(
      'Unexpected </#list> on line 2'
    );
    expect(() =>
      parser.parseGeneratorScript('<#list 1..2 as i>\ngen 1 > $')
    ).toThrow('Unclosed <#list> on line 1');
  });

  it('rejects an unsupported <#assign> form', () => {
    expect(() => parser.parseGeneratorScript('<#assign n>\ngen 1 > $')).toThrow(
      /Unsupported <#assign> form on line 1/
    );
  });
});

describe('parseGeneratorScript - list size limit', () => {
  it('exports the limit as a named constant', () => {
    expect(parser.MAX_LIST_ITEMS).toBe(10000);
  });

  it('rejects a huge range quickly, naming the list and line', () => {
    const start = Date.now();
    expect(() =>
      parser.parseGeneratorScript(
        'gen 1 > $\n<#list 1..1000000000 as i>\ngen ${i} > $\n</#list>'
      )
    ).toThrow(/<#list 1\.\.1000000000 as i> on line 2 expands to more than/);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('rejects nested lists whose product exceeds the limit', () => {
    const start = Date.now();
    expect(() =>
      parser.parseGeneratorScript(
        '<#list 1..100000 as i>\n<#list 1..100000 as j>\ngen ${i} ${j} > $\n</#list>\n</#list>'
      )
    ).toThrow(/expands to more than 10000 items/);
    expect(() =>
      parser.parseGeneratorScript(
        '<#list 1..1000 as i>\n<#list 1..1000 as j>\ngen ${i} > $\n</#list>\n</#list>'
      )
    ).toThrow(/<#list 1\.\.1000 as j> on line 2 expands to more than/);
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('rejects a huge descending range', () => {
    expect(() =>
      parser.parseGeneratorScript(
        '<#list 1000000000..1 as i>\ngen 1 > $\n</#list>'
      )
    ).toThrow(/on line 1 expands to more than/);
  });

  it('still allows a list of exactly the limit', () => {
    const out = parser.parseGeneratorScript(
      `<#list 1..${parser.MAX_LIST_ITEMS} as i>\ngen ${'${i}'} > $\n</#list>`
    );
    expect(out).toHaveLength(parser.MAX_LIST_ITEMS);
  });
});

describe('parseGeneratorScript - ${} inside @group comments', () => {
  it('rejects an interpolation in a group name', () => {
    expect(() =>
      parser.parseGeneratorScript('gen 1 > $\n<#-- @group g${i} -->\ngen 2 > $')
    ).toThrow('Unsupported expression ${i} in @group on line 2');
  });

  it('rejects it inside a list too', () => {
    expect(() =>
      parser.parseGeneratorScript(
        '<#list 1..2 as i>\n<#-- @group g${i} -->\ngen ${i} > $\n</#list>'
      )
    ).toThrow('Unsupported expression ${i} in @group on line 2');
  });

  it('still ignores ${} in ordinary comments', () => {
    expect(
      parser.parseGeneratorScript('<#-- note ${x} -->\ngen 1 > $')
    ).toHaveLength(1);
  });
});

describe('parseGeneratorScript - #{} and square-bracket tags are rejected', () => {
  it('rejects #{...} numeric interpolation', () => {
    expect(() =>
      parser.parseGeneratorScript('gen 1 > $\ngen #{1} > $')
    ).toThrow('Unsupported FreeMarker construct #{...} on line 2');
  });

  it('rejects [#list ...] square-bracket directives', () => {
    expect(() =>
      parser.parseGeneratorScript('[#list 1..3 as i]\ngen ${i} > $\n[/#list]')
    ).toThrow('Unsupported FreeMarker construct [#list');
    expect(() => parser.parseGeneratorScript('gen 1 > $\n[/#list]')).toThrow(
      /\[\/#list.* on line 2/
    );
  });

  it('rejects [@macro] calls', () => {
    expect(() => parser.parseGeneratorScript('[@m/]\ngen 1 > $')).toThrow(
      'Unsupported FreeMarker construct [@m (square-bracket syntax) on line 1'
    );
  });
});

describe('parseGeneratorScript - expression edge cases', () => {
  const argsOf = (script: string) =>
    parser.parseGeneratorScript(script).map(l => l.args.join(' '));

  it('reports integer overflow', () => {
    expect(() =>
      parser.parseGeneratorScript('gen ${99999999999*99999999999} > $')
    ).toThrow(/Integer overflow/);
  });

  it('handles unary plus and stacked signs', () => {
    expect(argsOf('gen ${+3} ${+-3} ${-+3} ${- -3} > $')).toEqual([
      '3 -3 -3 3',
    ]);
  });

  it('rejects malformed expressions', () => {
    for (const expr of ['(1+2', '', '1+']) {
      expect(() => parser.parseGeneratorScript(`gen \${${expr}} > $`)).toThrow(
        /Unsupported expression/
      );
    }
  });

  it('rejects a stray </#assign>', () => {
    expect(() =>
      parser.parseGeneratorScript('<#assign n = 1>\n</#assign>\ngen 1 > $')
    ).toThrow('Unsupported FreeMarker directive </#assign> on line 2');
  });

  it('expands a CRLF script with a list and reports ${} on the right line', () => {
    expect(argsOf('<#list 1..2 as i>\r\ngen ${i} > $\r\n</#list>\r\n')).toEqual(
      ['1', '2']
    );
    expect(() =>
      parser.parseGeneratorScript(
        '<#list 1..2 as i>\r\ngen 1 > $\r\n</#list>\r\ngen ${} > $\r\n'
      )
    ).toThrow(/Unsupported expression \${} on line 4/);
  });
});

describe('parseGeneratorScript - FreeMarker edge cases (review of !83)', () => {
  const argsOf = (script: string) =>
    parser.parseGeneratorScript(script).map(l => l.args.join(' '));

  it('rejects a list of 10001 items but accepts 10000', () => {
    expect(() =>
      parser.parseGeneratorScript(
        '<#list 1..10001 as i>\ngen ${i} > $\n</#list>'
      )
    ).toThrow(/<#list 1\.\.10001 as i> on line 1 expands to more than 10000/);
    expect(
      parser.parseGeneratorScript(
        '<#list 1..10000 as i>\ngen ${i} > $\n</#list>'
      )
    ).toHaveLength(10000);
  });

  it('counts an outer and inner list together against the limit', () => {
    // 100 outer + 100 * 100 inner iterations = 10100 > 10000.
    expect(() =>
      parser.parseGeneratorScript(
        '<#list 1..100 as i>\n<#list 1..100 as j>\ngen ${i} ${j} > $\n</#list>\n</#list>'
      )
    ).toThrow(/expands to more than 10000 items in total/);
    // 99 outer + 99 * 100 inner iterations = 9999 <= 10000.
    expect(
      parser.parseGeneratorScript(
        '<#list 1..99 as i>\n<#list 1..100 as j>\ngen ${i} ${j} > $\n</#list>\n</#list>'
      )
    ).toHaveLength(9900);
  });

  it('follows the sign of the dividend for a negative modulo', () => {
    expect(argsOf('gen ${-7%3} ${7%-3} ${-7%-3} > $')).toEqual(['-1 1 -1']);
  });

  it('keeps an <#assign> inside a list global', () => {
    expect(
      argsOf(
        '<#list 1..2 as i>\n<#assign last = i*10>\n</#list>\ngen ${last} > $'
      )
    ).toEqual(['20']);
  });

  it('lets <#assign> reassign a variable', () => {
    expect(
      argsOf('<#assign n = 1>\ngen ${n} > $\n<#assign n = n+1>\ngen ${n} > $')
    ).toEqual(['1', '2']);
  });

  it('lets a loop variable shadow a global, then restores the global', () => {
    expect(
      argsOf(
        '<#assign i = 100>\n<#list 1..2 as i>\ngen ${i} > $\n</#list>\ngen ${i} > $'
      )
    ).toEqual(['1', '2', '100']);
  });

  it('rejects a trailing comma or an empty item in a sequence', () => {
    for (const items of ['1,2,', '1,,2', '"a",', '"a",,']) {
      expect(() =>
        parser.parseGeneratorScript(
          `<#list [${items}] as n>\ngen \${n} > $\n</#list>`
        )
      ).toThrow(/Unsupported expression <#list \[.*\] as n> on line 1/);
    }
  });

  it('rejects a bad string literal in a sequence', () => {
    expect(() =>
      parser.parseGeneratorScript('<#list ["a] as s>\ngen ${s} > $\n</#list>')
    ).toThrow('Unclosed FreeMarker tag <#list> on line 1');
    expect(() =>
      parser.parseGeneratorScript(
        '<#list ["\\q"] as s>\ngen ${s} > $\n</#list>'
      )
    ).toThrow(/Invalid string escape "\\q"/);
    // Only FreeMarker 2.3.28+ accepts `\=`, and Polygon's version is unknown.
    expect(() =>
      parser.parseGeneratorScript(
        '<#list ["a\\=b"] as s>\ngen ${s} > $\n</#list>'
      )
    ).toThrow(/Invalid string escape "\\="/);
    expect(() =>
      parser.parseGeneratorScript(
        '<#list ["a${b}"] as s>\ngen ${s} > $\n</#list>'
      )
    ).toThrow(/String interpolation is not supported/);
    expect(() =>
      parser.parseGeneratorScript('<#assign s = "a">\ngen ${s} > $')
    ).toThrow(/Unsupported expression <#assign s = "a">/);
  });

  it('rejects a string variable in an integer expression', () => {
    expect(() =>
      parser.parseGeneratorScript(
        '<#list ["a"] as mode>\ngen ${mode+1} > $\n</#list>'
      )
    ).toThrow(/Variable "mode" is a string in \$\{mode\+1\} on line 2/);
    expect(() =>
      parser.parseGeneratorScript(
        '<#list ["a"] as mode>\n<#list mode..1 as i>\ngen ${i} > $\n</#list>\n</#list>'
      )
    ).toThrow(/Variable "mode" is a string/);
  });

  it('rejects > inside an expression', () => {
    expect(() =>
      parser.parseGeneratorScript('<#list 1..2 as i>\ngen ${i>1} > $\n</#list>')
    ).toThrow(/Unsupported expression \${i>1} on line 2/);
  });

  it('treats a } after an expression as plain text', () => {
    expect(argsOf('gen ${(1)} } > $')).toEqual(['1 }']);
  });

  it('rejects braces inside an expression', () => {
    expect(() => parser.parseGeneratorScript('gen ${ {1} } > $')).toThrow(
      'Unsupported expression ${{1} on line 1'
    );
  });
});

describe('parseGeneratorScript - string values are output, not script', () => {
  const argsOf = (script: string) =>
    parser.parseGeneratorScript(script).map(l => l.args.join(' '));

  it('keeps comment markers inside a string literal', () => {
    expect(
      argsOf('<#list ["<#--", "-->"] as s>\ngen "x${s}y" > $\n</#list>')
    ).toEqual(['x<#--y', 'x-->y']);
  });

  it('does not read a comment from a string value as @group', () => {
    for (const item of ['"<#-- @group g -->"', '"\\l#-- @group g --\\g"']) {
      const out = parser.parseGeneratorScript(
        `<#list [${item}] as s>\ngen "\${s}" > $\n</#list>\ngen 2 > $`
      );
      expect(out.map(l => l.args)).toEqual([['<#-- @group g -->'], ['2']]);
      expect(out.map(l => l.group)).toEqual([undefined, undefined]);
    }
  });

  it('drops a multi-line comment without splitting the command', () => {
    const out = parser.parseGeneratorScript(
      'gen 1 <#-- a\nb --> > 1\ngen 2 > 2'
    );
    expect(out.map(l => [l.args, l.lineNumber])).toEqual([
      [['1'], 1],
      [['2'], 3],
    ]);
  });

  it('numbers every expanded line by its source line', () => {
    const out = parser.parseGeneratorScript(
      '<#list 1..2 as i>\ngen ${i} > $\n</#list>\ngen 5 > 1'
    );
    expect(out.map(l => l.lineNumber)).toEqual([2, 2, 4]);
  });

  it('keeps source line numbers when a string value holds a newline', () => {
    const out = parser.parseGeneratorScript(
      '<#list ["1 > 1\\ngen 2"] as s>\ngen ${s} > 2\n</#list>\ngen 3 > 3'
    );
    expect(out.map(l => [l.raw, l.lineNumber])).toEqual([
      ['gen 1 > 1', 2],
      ['gen 2 > 2', 2],
      ['gen 3 > 3', 4],
    ]);
    expect(() =>
      parser.parseGeneratorScript(
        '<#list ["a\\nb"] as s>\ngen ${s} > $\n</#list>\ngen 5 > 1'
      )
    ).toThrow("Missing '> target' on line 2: gen a");
  });

  it('takes a raw string literal as written', () => {
    expect(
      argsOf(
        '<#list [r"C:\\", r"a\\nb", r"${x}"] as s>\ngen "${s}" > $\n</#list>'
      )
    ).toEqual(['C:\\', 'a\\nb', '${x}']);
    expect(
      argsOf('<#assign r = 3>\n<#list [r, r+1] as n>\ngen ${n} > $\n</#list>')
    ).toEqual(['3', '4']);
  });
});

describe('parseGeneratorScript - one command per line (Polygon)', () => {
  const body = 'gen-equal ${i} 5 > $';

  it('rejects a list body on one line, like Polygon', () => {
    expect(() =>
      parser.parseGeneratorScript(`<#list 1..3 as i>${body}</#list>`)
    ).toThrow("Line should end with '> testIndex'.");
  });

  it('expands the same body on its own lines to 3 tests', () => {
    const out = parser.parseGeneratorScript(
      `<#list 1..3 as i>\n${body}\n</#list>`
    );
    expect(out).toHaveLength(3);
    expect(out.map(l => l.args.join(' '))).toEqual(['1 5', '2 5', '3 5']);
  });

  it('rejects two commands on one line without a list', () => {
    expect(() =>
      parser.parseGeneratorScript('gen-equal 1 5 > $gen-equal 2 5 > $')
    ).toThrow("Line should end with '> testIndex'.");
  });

  it('names the line of the offending command', () => {
    expect(() =>
      parser.parseGeneratorScript('gen 1 > $\ngen 2 > $gen 3 > $')
    ).toThrow(/\(line 2: /);
  });

  it('ignores a > inside a quoted argument', () => {
    const out = parser.parseGeneratorScript('gen "a>b" > $');
    expect(out).toHaveLength(1);
    expect(out[0].args).toEqual(['a>b']);
  });
});

describe('validateGeneratorReferences', () => {
  it('passes when all generators exist', () => {
    const lines = parser.parseGeneratorScript('gen 1 > 1\nother 2 > 2');
    const generators: LocalGenerator[] = [
      { name: 'gen', source: 'a.cpp' },
      { name: 'other', source: 'b.cpp' },
    ];
    expect(() =>
      parser.validateGeneratorReferences(lines, generators)
    ).not.toThrow();
  });

  it('throws on the first unknown generator with line number', () => {
    const lines = parser.parseGeneratorScript('gen 1 > 1\nbogus 2 > 2');
    const generators: LocalGenerator[] = [{ name: 'gen', source: 'a.cpp' }];
    expect(() => parser.validateGeneratorReferences(lines, generators)).toThrow(
      /"bogus".*line 2/s
    );
  });
});

describe('validateManualTests', () => {
  it('passes when input (and optional output) exists', () => {
    exists(true);
    const manuals: LocalManualTest[] = [
      { input: './m.in', output: './m.out', index: 1 },
    ];
    expect(() => parser.validateManualTests(manuals)).not.toThrow();
  });

  it('throws when input file is missing', () => {
    exists((p: string) => !p.endsWith('m.in'));
    const manuals: LocalManualTest[] = [{ input: './m.in', index: 1 }];
    expect(() => parser.validateManualTests(manuals)).toThrow(
      /Manual test input not found/
    );
  });

  it('throws when output file is declared but missing', () => {
    exists((p: string) => !p.endsWith('m.out'));
    const manuals: LocalManualTest[] = [
      { input: './m.in', output: './m.out', index: 1 },
    ];
    expect(() => parser.validateManualTests(manuals)).toThrow(
      /Manual test output not found/
    );
  });

  it('throws on index < 1', () => {
    exists(true);
    const manuals: LocalManualTest[] = [{ input: './m.in', index: 0 }];
    expect(() => parser.validateManualTests(manuals)).toThrow(/>= 1/);
  });
});

describe('resolveTests', () => {
  const mkLines = (s: string): ParsedScriptLine[] =>
    parser.parseGeneratorScript(s);

  it('places manuals at their explicit indices', () => {
    const tests = parser.resolveTests(
      [],
      [
        { input: './a.in', index: 1 },
        { input: './b.in', index: 3 },
      ]
    );
    expect(tests.map(t => t.index)).toEqual([1, 3]);
    expect(tests[0].source).toMatchObject({
      kind: 'manual',
      inputFile: './a.in',
    });
  });

  it('passes manual group/points/useInStatements through', () => {
    const [t] = parser.resolveTests(
      [],
      [
        {
          input: './a.in',
          index: 1,
          group: 'samples',
          points: 5,
          useInStatements: true,
        },
      ]
    );
    expect(t).toMatchObject({
      group: 'samples',
      points: 5,
      useInStatements: true,
    });
  });

  it('$ skips indices reserved by manuals', () => {
    const tests = parser.resolveTests(mkLines('gen 1 > $\ngen 2 > $'), [
      { input: './a.in', index: 1 },
    ]);
    const generated = tests
      .filter(t => t.source.kind === 'generator')
      .map(t => t.index)
      .sort((a, b) => a - b);
    expect(generated).toEqual([2, 3]);
  });

  it('$ skips indices reserved by earlier explicit > N', () => {
    const tests = parser.resolveTests(
      mkLines('gen a > $\ngen b > 5\ngen c > $\ngen d > $'),
      []
    );
    expect(tests.map(t => t.index)).toEqual([1, 2, 3, 5]);
  });

  it('detects duplicate explicit indices across script', () => {
    expect(() =>
      parser.resolveTests(mkLines('gen 1 > 5\ngen 2 > 5'), [])
    ).toThrow(/Duplicate test index 5/);
  });

  it('detects index conflict between manual and script', () => {
    expect(() =>
      parser.resolveTests(mkLines('gen 1 > 1'), [{ input: './a.in', index: 1 }])
    ).toThrow(/Duplicate test index 1/);
  });

  it('detects duplicates within multi-output and across lines', () => {
    expect(() =>
      parser.resolveTests(mkLines('gen 1 > {1-3}\ngen 2 > 2'), [])
    ).toThrow(/Duplicate test index 2/);
  });

  it('emits one resolved test per index produced by multi-output', () => {
    const tests = parser.resolveTests(mkLines('gen 1 > {1-3,7}'), []);
    expect(tests.map(t => t.index)).toEqual([1, 2, 3, 7]);
    for (const t of tests) {
      expect(t.source.kind).toBe('generator');
      if (t.source.kind === 'generator') {
        expect(t.source.multiOutputs).toEqual([1, 2, 3, 7]);
      }
    }
  });

  it('preserves group from script @group headers', () => {
    const tests = parser.resolveTests(
      mkLines(['<#-- @group small -->', 'gen 10 > $', 'gen 20 > $'].join('\n')),
      []
    );
    expect(tests.every(t => t.group === 'small')).toBe(true);
  });

  it('returns tests sorted by index', () => {
    const tests = parser.resolveTests(
      mkLines('gen a > 7\ngen b > 3\ngen c > 5'),
      []
    );
    expect(tests.map(t => t.index)).toEqual([3, 5, 7]);
  });
});

describe('readScriptText', () => {
  it('returns empty string when generatorScript is missing', () => {
    expect(parser.readScriptText({ name: 'tests' })).toBe('');
  });

  it('returns the inline script verbatim', () => {
    const ts: LocalTestset = {
      name: 'tests',
      generatorScript: { script: 'gen 1 > 1' },
    };
    expect(parser.readScriptText(ts)).toBe('gen 1 > 1');
  });

  it('reads from scriptFile when set', () => {
    const ts: LocalTestset = {
      name: 'tests',
      generatorScript: { scriptFile: './x.txt' },
    };
    exists(true);
    vi.mocked(fs.readFileSync).mockReturnValue('gen 9 > 9');
    expect(parser.readScriptText(ts)).toBe('gen 9 > 9');
    expect(fs.readFileSync).toHaveBeenCalledWith(
      path.resolve(process.cwd(), './x.txt'),
      'utf-8'
    );
  });

  it('throws when scriptFile is missing', () => {
    const ts: LocalTestset = {
      name: 'tests',
      generatorScript: { scriptFile: './missing.txt' },
    };
    exists(false);
    expect(() => parser.readScriptText(ts)).toThrow(/scriptFile not found/);
  });

  it('resolves scriptFile against an explicit baseDir, not cwd', () => {
    const ts: LocalTestset = {
      name: 'tests',
      generatorScript: { scriptFile: './gen-script.txt' },
    };
    exists(true);
    vi.mocked(fs.readFileSync).mockReturnValue('gen 1 > $');
    parser.readScriptText(ts, '/path/to/problem');
    expect(fs.readFileSync).toHaveBeenCalledWith(
      path.resolve('/path/to/problem', './gen-script.txt'),
      'utf-8'
    );
  });

  it('refuses a scriptFile outside baseDir without reading it', () => {
    const ts: LocalTestset = {
      name: 'tests',
      generatorScript: { scriptFile: '../x' },
    };
    exists(true);
    expect(() => parser.readScriptText(ts, '/path/to/problem')).toThrow(
      /Refusing path/
    );
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it('refuses an absolute scriptFile outside baseDir', () => {
    const ts: LocalTestset = {
      name: 'tests',
      generatorScript: { scriptFile: '/etc/passwd' },
    };
    exists(true);
    expect(() => parser.readScriptText(ts, '/path/to/problem')).toThrow(
      /Refusing path/
    );
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it('still reads a scriptFile whose name starts with two dots', () => {
    const ts: LocalTestset = {
      name: 'tests',
      generatorScript: { scriptFile: '..x.txt' },
    };
    exists(true);
    vi.mocked(fs.readFileSync).mockReturnValue('gen 1 > 1');
    expect(parser.readScriptText(ts, '/path/to/problem')).toBe('gen 1 > 1');
  });
});

describe('toPolygonScript', () => {
  const generators: LocalGenerator[] = [
    { name: 'gen-random', source: './generators/gen.cpp' },
    { name: 'edge', source: './generators/edge.cpp' },
  ];

  it('rewrites the leading generator token to the source basename', () => {
    expect(parser.toPolygonScript('gen-random 10 > $', generators)).toBe(
      'gen 10 > $'
    );
  });

  it('leaves names that already match the basename untouched', () => {
    expect(parser.toPolygonScript('edge 1 > 5', generators)).toBe('edge 1 > 5');
  });

  it('preserves comments, directives, blank lines and line endings', () => {
    const script =
      '<#-- gen-random is used below -->\r\n' +
      '\r\n' +
      '<#-- @group main -->\r\n' +
      '  gen-random 10 > $\r\n' +
      '<#list 1..3 as i>\r\n' +
      'gen-random ${i} > $\r\n' +
      '</#list>\r\n';
    expect(parser.toPolygonScript(script, generators)).toBe(
      '<#-- gen-random is used below -->\r\n' +
        '\r\n' +
        '<#-- @group main -->\r\n' +
        '  gen 10 > $\r\n' +
        '<#list 1..3 as i>\r\n' +
        'gen ${i} > $\r\n' +
        '</#list>\r\n'
    );
  });

  it('does not rewrite tokens inside a leading inline comment', () => {
    expect(
      parser.toPolygonScript('<#-- gen-random --> gen-random 1 > $', generators)
    ).toBe('<#-- gen-random --> gen 1 > $');
  });

  it('does not touch arguments that happen to equal a generator name', () => {
    expect(
      parser.toPolygonScript('gen-random gen-random > $', generators)
    ).toBe('gen gen-random > $');
  });

  it('leaves unknown generator tokens alone', () => {
    expect(parser.toPolygonScript('other 1 > $', generators)).toBe(
      'other 1 > $'
    );
  });
});

describe('parseGeneratorScript - test count limits', () => {
  it('exports the limit as 10000', () => {
    expect(parser.MAX_SCRIPT_TESTS).toBe(10000);
  });

  it('rejects a huge range at once, naming the line', () => {
    const start = performance.now();
    expect(() => parser.parseGeneratorScript('gen 1 > {1-100000000}')).toThrow(
      /line 1 expands to more than 10000 tests/
    );
    expect(performance.now() - start).toBeLessThan(1000);
  });

  it('names the right line for a huge range further down', () => {
    expect(() =>
      parser.parseGeneratorScript('gen 1 > 1\n\ngen 2 > {1-100000000}')
    ).toThrow(/line 3/);
  });

  it('accepts a range of exactly the limit and rejects one above it', () => {
    const out = parser.parseGeneratorScript('gen 1 > {1-10000}');
    expect(out).toHaveLength(1);
    const output = out[0].output;
    expect(output.kind).toBe('multi');
    if (output.kind === 'multi') expect(output.indices).toHaveLength(10000);

    expect(() => parser.parseGeneratorScript('gen 1 > {1-10001}')).toThrow(
      /more than 10000 tests \(limit 10000\)/
    );
  });

  it('counts ranges and single indices together within one target', () => {
    expect(() =>
      parser.parseGeneratorScript('gen 1 > {1-6000,7001-13000}')
    ).toThrow(/line 1 expands to more than 10000 tests/);
    expect(() =>
      parser.parseGeneratorScript('gen 1 > {1-10000,10001}')
    ).toThrow(/line 1 expands to more than 10000 tests/);
  });

  it('rejects many targets whose total is above the limit', () => {
    const script = [
      'gen 1 > {1-5000}',
      'gen 2 > {5001-10000}',
      'gen 3 > {10001-10002}',
    ].join('\n');
    expect(() => parser.parseGeneratorScript(script)).toThrow(
      /Script expands to more than 10000 tests.*line 3/
    );
  });

  it('accepts a script of exactly the limit', () => {
    const script = ['gen 1 > {1-5000}', 'gen 2 > {5001-10000}'].join('\n');
    expect(parser.parseGeneratorScript(script)).toHaveLength(2);
  });

  it('counts single-target lines and names the line that exceeds', () => {
    const lines = Array.from({ length: 10001 }, () => 'gen 1 > $');
    expect(() => parser.parseGeneratorScript(lines.join('\n'))).toThrow(
      /Script expands to more than 10000 tests.*line 10001/
    );
    expect(
      parser.parseGeneratorScript(lines.slice(0, 10000).join('\n'))
    ).toHaveLength(10000);
  });
});

describe('line lookup on big scripts', () => {
  const bigLine = 'gen ${1+1} ${2+2} ${3+3} ${4+4} ${5+5} > $';
  const bigScript = (): string => {
    const lines: string[] = [];
    let size = 0;
    while (size < 250 * 1024) {
      lines.push(bigLine);
      size += bigLine.length + 1;
    }
    return lines.join('\n');
  };

  it('parses a 250 KB script of ${...} lines in under a second', () => {
    const script = bigScript();
    expect(script.length).toBeGreaterThanOrEqual(250 * 1024);
    const start = performance.now();
    const parsed = parser.parseGeneratorScript(script);
    const elapsed = performance.now() - start;
    expect(parsed.length).toBeGreaterThan(5000);
    expect(parsed.length).toBeLessThanOrEqual(10000);
    expect(elapsed).toBeLessThan(1000);
  });

  it('reports the exact line of a bad expression late in a big script', () => {
    const script = bigScript() + '\ngen ${i/2} > $';
    const lastLine = script.split('\n').length;
    expect(lastLine).toBeGreaterThan(5000);
    expect(() => parser.parseGeneratorScript(script)).toThrow(
      `on line ${lastLine}`
    );
    expect(() => parser.parseGeneratorScript(script)).toThrow(/\$\{i\/2\}/);
  });

  it('reports the exact line of an unterminated ${ late in a big script', () => {
    const script = bigScript() + '\ngen ${1+1 > $';
    const lastLine = script.split('\n').length;
    expect(() => parser.parseGeneratorScript(script)).toThrow(
      `Unterminated "\${" on line ${lastLine}`
    );
  });
});
