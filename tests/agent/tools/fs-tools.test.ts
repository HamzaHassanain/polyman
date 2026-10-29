import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fsTools } from '../../../src/agent/tools/fs-tools';
import {
  SandboxError,
  type Sandbox,
  type Tool,
  type ToolContext,
} from '../../../src/agent/tools/types';
import type { CliRunner } from '../../../src/agent/runner/types';

/** A small sandbox for the tests: keeps paths inside the root, no symlinks. */
class FakeSandbox implements Sandbox {
  readonly calls: { path: string; mode: 'read' | 'write' }[] = [];
  constructor(readonly root: string) {}

  resolve(userPath: string, mode: 'read' | 'write'): Promise<string> {
    this.calls.push({ path: userPath, mode });
    const full = path.resolve(this.root, userPath);
    if (full !== this.root && !full.startsWith(this.root + path.sep)) {
      return Promise.reject(
        new SandboxError(`${userPath} is outside the problem`)
      );
    }
    return Promise.resolve(full);
  }
}

let root: string;
let sandbox: FakeSandbox;
let ctx: ToolContext;

const runner: CliRunner = {
  run: () => Promise.reject(new Error('not used')),
};

function tool(name: string): Tool {
  const found = fsTools().find(t => t.name === name);
  if (!found) throw new Error(`no tool ${name}`);
  return found;
}

function write(rel: string, content: string): void {
  const full = path.join(root, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function lines(count: number, prefix = 'line'): string {
  return (
    Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`).join('\n') +
    '\n'
  );
}

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pm-fs-')));
  sandbox = new FakeSandbox(root);
  ctx = {
    problemDir: root,
    signal: new AbortController().signal,
    runner,
    sandbox,
    progress: () => {},
    setProblemDir: () => {},
  };
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('fsTools', () => {
  it('has the four tools with closed object schemas', () => {
    const tools = fsTools();
    expect(tools.map(t => t.name)).toEqual([
      'list_files',
      'read_file',
      'write_file',
      'edit_file',
    ]);
    for (const t of tools) {
      expect(t.parameters['type']).toBe('object');
      expect(t.parameters['additionalProperties']).toBe(false);
      expect(t.needsProblem).toBe(true);
    }
    expect(tool('list_files').risk).toBe('read');
    expect(tool('read_file').risk).toBe('read');
    expect(tool('write_file').risk).toBe('write');
    expect(tool('edit_file').risk).toBe('write');
  });

  it('describes calls for approvals', () => {
    expect(
      tool('write_file').describe?.({ path: 'a.cpp', content: '' })
    ).toEqual({
      title: 'Write a.cpp',
    });
    expect(
      tool('edit_file').describe?.({
        path: 'b.cpp',
        old_text: 'x',
        new_text: 'y',
      })
    ).toEqual({ title: 'Edit b.cpp' });
    expect(tool('read_file').describe?.({ path: 'c' })).toEqual({
      title: 'Read c',
    });
    expect(tool('list_files').describe?.({})).toEqual({ title: 'List .' });
  });
});

describe('list_files', () => {
  it('lists 2 levels and skips the noisy folders', async () => {
    write('Config.json', '{}');
    write('solutions/main.cpp', '');
    write('solutions/deep/more/x.cpp', '');
    write('testsets/tests/test1.txt', '1');
    write('testsets/tests/test2.txt', '2');
    write('testsets/samples/test1.txt', '3');
    write('node_modules/pkg/index.js', '');
    write('.git/HEAD', '');
    write('.polyman/cache/obj', '');
    write('.polyman/agent/notes.md', '');

    const out = await tool('list_files').run({}, ctx);
    expect(out.isError).toBeUndefined();
    expect(out.content.split('\n')).toEqual([
      '.polyman/',
      '  .polyman/agent/',
      'Config.json',
      'solutions/',
      '  solutions/deep/',
      '  solutions/main.cpp',
      'testsets/ (3 files, not listed)',
    ]);
  });

  it('lists one folder and checks it with the sandbox', async () => {
    write('solutions/main.cpp', '');
    const out = await tool('list_files').run({ path: 'solutions' }, ctx);
    expect(out.content).toBe('solutions/main.cpp');
    expect(sandbox.calls).toEqual([{ path: 'solutions', mode: 'read' }]);
  });

  it('says when a folder is missing', async () => {
    const out = await tool('list_files').run({ path: 'nope' }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toContain('not found');
  });

  it('refuses a path outside the problem', async () => {
    await expect(
      tool('list_files').run({ path: '../..' }, ctx)
    ).rejects.toThrow(SandboxError);
  });
});

describe('read_file', () => {
  it('reads with line numbers', async () => {
    write('a.txt', 'first\nsecond\n');
    const out = await tool('read_file').run({ path: 'a.txt' }, ctx);
    expect(out.content).toBe('1| first\n2| second');
    expect(sandbox.calls).toEqual([{ path: 'a.txt', mode: 'read' }]);
  });

  it('reads from an offset with a limit', async () => {
    write('a.txt', lines(20));
    const out = await tool('read_file').run(
      { path: 'a.txt', offset: 5, limit: 3 },
      ctx
    );
    expect(out.content.split('\n')).toEqual([
      ' 5| line 5',
      ' 6| line 6',
      ' 7| line 7',
      '... (lines 5-7 of 20 shown, use offset=8 to read more)',
    ]);
  });

  it('reads at most 2000 lines and says it was cut', async () => {
    write('big.txt', lines(2500));
    const out = await tool('read_file').run({ path: 'big.txt' }, ctx);
    const outLines = out.content.split('\n');
    expect(outLines).toHaveLength(2001);
    expect(outLines[1999]).toBe('2000| line 2000');
    expect(outLines[2000]).toBe(
      '... (lines 1-2000 of 2500 shown, use offset=2001 to read more)'
    );
  });

  it('cuts a long test file to its first 30 and last 10 lines', async () => {
    write('testsets/tests/test1.txt', lines(100, 'n'));
    const out = await tool('read_file').run(
      { path: 'testsets/tests/test1.txt' },
      ctx
    );
    const outLines = out.content.split('\n');
    expect(outLines).toHaveLength(41);
    expect(outLines[0]).toBe('  1| n 1');
    expect(outLines[29]).toBe(' 30| n 30');
    expect(outLines[30]).toContain('60 lines cut');
    expect(outLines[31]).toBe(' 91| n 91');
    expect(outLines[40]).toBe('100| n 100');
  });

  it('cuts files under tests/ too, but not short ones', async () => {
    write('manual/tests/m1.in', lines(61));
    const long = await tool('read_file').run(
      { path: 'manual/tests/m1.in' },
      ctx
    );
    expect(long.content).toContain('lines cut');
    write('testsets/tests/short.txt', lines(60));
    const short = await tool('read_file').run(
      { path: 'testsets/tests/short.txt' },
      ctx
    );
    expect(short.content.split('\n')).toHaveLength(60);
  });

  it('reads a test file whole with offset and limit', async () => {
    write('testsets/tests/test1.txt', lines(100));
    const out = await tool('read_file').run(
      { path: 'testsets/tests/test1.txt', offset: 31, limit: 2 },
      ctx
    );
    expect(out.content.split('\n').slice(0, 2)).toEqual([
      ' 31| line 31',
      ' 32| line 32',
    ]);
  });

  it('reports missing, empty, binary files and an offset past the end', async () => {
    const missing = await tool('read_file').run({ path: 'nope.txt' }, ctx);
    expect(missing).toEqual({
      content: 'File not found: nope.txt',
      isError: true,
    });

    write('empty.txt', '');
    const empty = await tool('read_file').run({ path: 'empty.txt' }, ctx);
    expect(empty.content).toBe('empty.txt is empty');

    write('gen', Buffer.from([0x7f, 0x45, 0x00, 0x01]).toString('binary'));
    const binary = await tool('read_file').run({ path: 'gen' }, ctx);
    expect(binary.isError).toBe(true);
    expect(binary.content).toContain('binary file');

    write('a.txt', 'x\n');
    const past = await tool('read_file').run({ path: 'a.txt', offset: 5 }, ctx);
    expect(past.isError).toBe(true);
    expect(past.content).toContain('only 1 lines');
  });
});

describe('write_file', () => {
  it('creates the parent folders and writes', async () => {
    const out = await tool('write_file').run(
      { path: 'generators/new/gen.cpp', content: 'int main() {}\n// end\n' },
      ctx
    );
    expect(out.content).toBe('wrote generators/new/gen.cpp (2 lines)');
    expect(
      fs.readFileSync(path.join(root, 'generators/new/gen.cpp'), 'utf8')
    ).toBe('int main() {}\n// end\n');
    expect(sandbox.calls).toEqual([
      { path: 'generators/new/gen.cpp', mode: 'write' },
    ]);
  });

  it('refuses a path outside the problem', async () => {
    await expect(
      tool('write_file').run({ path: '../evil.txt', content: 'x' }, ctx)
    ).rejects.toThrow(SandboxError);
    expect(fs.existsSync(path.join(root, '..', 'evil.txt'))).toBe(false);
  });
});

describe('edit_file', () => {
  it('replaces text that appears once', async () => {
    write('sol.cpp', 'int a = 1;\nint b = 2;\n');
    const out = await tool('edit_file').run(
      { path: 'sol.cpp', old_text: 'int b = 2;', new_text: 'int b = $&3;' },
      ctx
    );
    expect(out).toEqual({ content: 'edited sol.cpp' });
    expect(fs.readFileSync(path.join(root, 'sol.cpp'), 'utf8')).toBe(
      'int a = 1;\nint b = $&3;\n'
    );
    expect(sandbox.calls).toEqual([{ path: 'sol.cpp', mode: 'write' }]);
  });

  it('says when the text is not found', async () => {
    write('sol.cpp', 'int a = 1;\n');
    const out = await tool('edit_file').run(
      { path: 'sol.cpp', old_text: 'int c', new_text: 'x' },
      ctx
    );
    expect(out.isError).toBe(true);
    expect(out.content).toContain('not found');
  });

  it('matches with other spaces at the line starts and keeps the file indent', async () => {
    write('sol.cpp', 'int main() {\n  int ans = 0;\n  return ans;\n}\n');
    // One space too many, copied from the "2| " of read_file.
    const out = await tool('edit_file').run(
      {
        path: 'sol.cpp',
        old_text: '   int ans = 0;',
        new_text: '   long long ans = 0;\n   ans += 1;',
      },
      ctx
    );
    expect(out.isError).toBeUndefined();
    expect(out.content).toContain('edited sol.cpp');
    expect(fs.readFileSync(path.join(root, 'sol.cpp'), 'utf8')).toBe(
      'int main() {\n  long long ans = 0;\n  ans += 1;\n  return ans;\n}\n'
    );
  });

  it('refuses a loose match that is not unique', async () => {
    write('sol.cpp', '  x = 1;\n    x = 1;\n');
    const out = await tool('edit_file').run(
      { path: 'sol.cpp', old_text: ' x = 1; ', new_text: 'x = 2;' },
      ctx
    );
    expect(out.isError).toBe(true);
    expect(out.content).toContain('found 2 times (ignoring spaces');
  });

  it('says when the text is found more than once', async () => {
    write('sol.cpp', 'x = 1;\nx = 1;\n');
    const out = await tool('edit_file').run(
      { path: 'sol.cpp', old_text: 'x = 1;', new_text: 'x = 2;' },
      ctx
    );
    expect(out.isError).toBe(true);
    expect(out.content).toContain('found 2 times, add more context');
    expect(fs.readFileSync(path.join(root, 'sol.cpp'), 'utf8')).toBe(
      'x = 1;\nx = 1;\n'
    );
  });

  it('refuses empty old_text and a missing file', async () => {
    write('sol.cpp', 'x');
    const empty = await tool('edit_file').run(
      { path: 'sol.cpp', old_text: '', new_text: 'y' },
      ctx
    );
    expect(empty.isError).toBe(true);
    const missing = await tool('edit_file').run(
      { path: 'nope.cpp', old_text: 'a', new_text: 'b' },
      ctx
    );
    expect(missing).toEqual({
      content: 'File not found: nope.cpp',
      isError: true,
    });
  });
});
