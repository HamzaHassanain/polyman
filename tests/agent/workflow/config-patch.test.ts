import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  applyConfigPatch,
  configErrors,
  dropTemplateExamples,
  fillPatchDefaults,
  sourceTypeFor,
} from '../../../src/agent/workflow/config-patch';

const TEMPLATE = path.resolve(__dirname, '../../../template/Config.json');
const TEMPLATE_DIR = path.dirname(TEMPLATE);

let dir: string;

async function readConfig(): Promise<Record<string, unknown>> {
  return JSON.parse(
    await fs.readFile(path.join(dir, 'Config.json'), 'utf-8')
  ) as Record<string, unknown>;
}

type Solution = {
  name: string;
  source: string;
  tag: string;
  sourceType?: string;
};

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'polyman-patch-'));
  await fs.copyFile(TEMPLATE, path.join(dir, 'Config.json'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('applyConfigPatch', () => {
  it('starts from a template that passes the checks', async () => {
    expect(configErrors(await readConfig())).toEqual([]);
  });

  it('adds a solution with its source type, as 2-space JSON', async () => {
    const result = await applyConfigPatch(dir, {
      addSolutions: [
        { name: 'brute', source: './solutions/brute.cpp', tag: 'TO' },
      ],
    });
    expect(result).toEqual({ ok: true });
    const text = await fs.readFile(path.join(dir, 'Config.json'), 'utf-8');
    expect(text).toContain('\n  "name": ');
    expect(text.endsWith('}\n')).toBe(true);
    const solutions = (await readConfig())['solutions'] as Solution[];
    expect(solutions.find(s => s.name === 'brute')).toEqual({
      name: 'brute',
      source: './solutions/brute.cpp',
      tag: 'TO',
      sourceType: 'cpp.g++17',
    });
  });

  it('refuses a bad tag and writes nothing', async () => {
    const before = await fs.readFile(path.join(dir, 'Config.json'), 'utf-8');
    const result = await applyConfigPatch(dir, {
      addSolutions: [{ name: 'x', source: 'solutions/x.cpp', tag: 'BAD' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('bad tag BAD');
    expect(await fs.readFile(path.join(dir, 'Config.json'), 'utf-8')).toBe(
      before
    );
  });

  it('refuses a patch that breaks the config and writes nothing', async () => {
    const before = await fs.readFile(path.join(dir, 'Config.json'), 'utf-8');
    const result = await applyConfigPatch(dir, { set: { name: 'Bad Name' } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('name must be lowercase');
    expect(await fs.readFile(path.join(dir, 'Config.json'), 'utf-8')).toBe(
      before
    );
  });

  it('does not lose either of two patches sent at once', async () => {
    const [a, b] = await Promise.all([
      applyConfigPatch(dir, {
        addSolutions: [
          { name: 'wa-1', source: 'solutions/wa-1.cpp', tag: 'WA' },
        ],
      }),
      applyConfigPatch(dir, {
        addSolutions: [
          { name: 'wa-2', source: 'solutions/wa-2.cpp', tag: 'WA' },
        ],
        set: { timeLimit: 2000 },
      }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    const config = await readConfig();
    const names = (config['solutions'] as Solution[]).map(s => s.name);
    expect(names).toContain('wa-1');
    expect(names).toContain('wa-2');
    expect(config['timeLimit']).toBe(2000);
  });

  it('replaces the old MA with the new main solution', async () => {
    await applyConfigPatch(dir, {
      addSolutions: [
        { name: 'main-sol', source: 'solutions/main.cpp', tag: 'MA' },
      ],
    });
    const solutions = (await readConfig())['solutions'] as Solution[];
    const mains = solutions.filter(s => s.tag === 'MA');
    expect(mains).toEqual([
      {
        name: 'main-sol',
        source: 'solutions/main.cpp',
        tag: 'MA',
        sourceType: 'cpp.g++17',
      },
    ]);
  });

  it('maps the checker, validator, generators, script and manual tests', async () => {
    const result = await applyConfigPatch(dir, {
      set: { timeLimit: 1500, memoryLimit: 128 },
      checker: { name: 'ncmp', isStandard: true },
      validator: {
        name: 'val',
        source: 'validator/val.cpp',
        testsFilePath: 'validator/t.json',
      },
      generators: [{ name: 'gen-random', source: 'generators/gen-random.cpp' }],
      generatorScript: {
        testset: 'tests',
        scriptFile: 'generators/script.txt',
      },
      manualTests: [
        { testset: 'tests', input: 'manual/tests/m-02.in', group: 'edge' },
      ],
      statements: {
        english: {
          encoding: 'UTF-8',
          name: 'Pairs',
          legend: 'statements/english/legend.tex',
          input: 'statements/english/input-format.tex',
          output: 'statements/english/output-format.tex',
        },
      },
    });
    expect(result).toEqual({ ok: true });
    const config = await readConfig();
    expect(config['timeLimit']).toBe(1500);
    expect(config['memoryLimit']).toBe(128);
    expect(config['checker']).toEqual({
      name: 'ncmp',
      source: 'ncmp.cpp',
      isStandard: true,
    });
    expect(config['validator']).toEqual({
      name: 'val',
      source: 'validator/val.cpp',
      testsFilePath: 'validator/t.json',
    });
    expect(config['generators']).toEqual([
      { name: 'gen-random', source: 'generators/gen-random.cpp' },
    ]);
    const testset = (config['testsets'] as Record<string, unknown>[])[0];
    expect(testset['generatorScript']).toEqual({
      scriptFile: 'generators/script.txt',
    });
    const manual = testset['manualTests'] as {
      input: string;
      index: number;
      group?: string;
    }[];
    expect(manual.find(m => m.input === 'manual/tests/m-02.in')).toEqual({
      input: 'manual/tests/m-02.in',
      index: 2,
      group: 'edge',
    });
    expect(
      (testset['groups'] as { name: string }[]).map(g => g.name)
    ).toContain('edge');
    expect(
      (config['statements'] as Record<string, { name: string }>)['english']
        ?.name
    ).toBe('Pairs');
    expect(configErrors(config)).toEqual([]);
  });

  it('refuses a patch with an unknown field or a bad shape', async () => {
    expect((await applyConfigPatch(dir, { foo: 1 })).ok).toBe(false);
    expect((await applyConfigPatch(dir, 'nope')).ok).toBe(false);
    expect((await applyConfigPatch(dir, { set: { timeLimit: -1 } })).ok).toBe(
      false
    );
    expect(
      (
        await applyConfigPatch(dir, {
          addSolutions: [{ name: 'a', source: 'a.rb', tag: 'OK' }],
        })
      ).ok
    ).toBe(false);
  });

  it('fails when Config.json is missing', async () => {
    await fs.rm(path.join(dir, 'Config.json'));
    const result = await applyConfigPatch(dir, { set: { timeLimit: 1000 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('cannot read Config.json');
  });
});

describe('sourceTypeFor', () => {
  it('picks the source type from the extension', () => {
    expect(sourceTypeFor('a.cpp')).toBe('cpp.g++17');
    expect(sourceTypeFor('A.java')).toBe('java21');
    expect(sourceTypeFor('a.py')).toBe('python.3');
    expect(sourceTypeFor('a.rb')).toBeNull();
  });
});

describe('dropTemplateExamples', () => {
  beforeEach(async () => {
    await fs.cp(TEMPLATE_DIR, dir, { recursive: true });
  });

  it('removes the template examples a workflow does not replace', async () => {
    const dropped = await dropTemplateExamples(dir, TEMPLATE_DIR);
    expect(dropped).toEqual({
      solutions: ['correct2', 'tle_solution'],
      manualTests: ['./manual/tests/m-01-sample.in'],
      statements: ['english', 'russian'],
    });
    const config = await readConfig();
    expect((config['solutions'] as Solution[]).map(s => s.name)).toEqual([
      'main',
    ]);
    const [testset] = config['testsets'] as { manualTests: unknown[] }[];
    expect(testset?.manualTests).toEqual([]);
    expect(config['statements']).toEqual({});
    // The files stay on disk.
    await fs.access(path.join(dir, 'solutions', 'acc2.java'));

    // A second run finds nothing and does not write.
    const before = await fs.readFile(path.join(dir, 'Config.json'), 'utf-8');
    expect(await dropTemplateExamples(dir, TEMPLATE_DIR)).toEqual({
      solutions: [],
      manualTests: [],
      statements: [],
    });
    expect(await fs.readFile(path.join(dir, 'Config.json'), 'utf-8')).toBe(
      before
    );
  });

  it('keeps what the user changed', async () => {
    await fs.appendFile(path.join(dir, 'solutions', 'acc2.java'), '// mine\n');
    await fs.writeFile(
      path.join(dir, 'manual', 'tests', 'm-01-sample.in'),
      '1\n'
    );
    await fs.appendFile(
      path.join(dir, 'statements', 'english', 'legend.tex'),
      'More.\n'
    );
    const dropped = await dropTemplateExamples(dir, TEMPLATE_DIR);
    expect(dropped).toEqual({
      solutions: ['tle_solution'],
      manualTests: [],
      statements: ['russian'],
    });
    const config = await readConfig();
    expect((config['solutions'] as Solution[]).map(s => s.name)).toEqual([
      'main',
      'correct2',
    ]);
    expect(Object.keys(config['statements'] as object)).toEqual(['english']);
  });

  it('fails when Config.json is missing', async () => {
    await fs.rm(path.join(dir, 'Config.json'));
    const dropped = await dropTemplateExamples(dir, TEMPLATE_DIR);
    expect(dropped).toHaveProperty('error');
  });
});

describe('patch defaults', () => {
  it('fills a missing generatorScript testset with the first testset', async () => {
    const result = await applyConfigPatch(dir, {
      generatorScript: { scriptFile: './generators/gen-script.txt' },
    });
    expect(result).toEqual({ ok: true });
    const testsets = (await readConfig())['testsets'] as {
      name: string;
      generatorScript?: { scriptFile: string };
    }[];
    expect(testsets).toHaveLength(1);
    expect(testsets[0].generatorScript).toEqual({
      scriptFile: './generators/gen-script.txt',
    });
  });

  it('accepts a generatorScript given as a plain path', () => {
    expect(
      fillPatchDefaults(
        { generatorScript: './generators/gen-script.txt' },
        { testsets: [{ name: 'main' }] }
      )
    ).toEqual({
      generatorScript: {
        testset: 'main',
        scriptFile: './generators/gen-script.txt',
      },
    });
  });

  it('fills manual test testsets and the validator name, keeps the rest', () => {
    expect(
      fillPatchDefaults(
        {
          manualTests: [{ input: './manual/a.in' }, 'odd'],
          validator: { source: './validator/val.cpp' },
          set: { timeLimit: 2000 },
        },
        {}
      )
    ).toEqual({
      manualTests: [{ input: './manual/a.in', testset: 'tests' }, 'odd'],
      validator: { source: './validator/val.cpp', name: 'validator' },
      set: { timeLimit: 2000 },
    });
  });

  it('still refuses what it cannot fill', async () => {
    const result = await applyConfigPatch(dir, {
      generatorScript: { testset: 'tests' },
    });
    expect(result).toMatchObject({ ok: false });
  });
});
