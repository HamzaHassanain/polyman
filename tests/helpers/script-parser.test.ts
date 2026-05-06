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
});
