/**
 * Group 2: protected files. `testlib.h` and the polyman cache are never
 * written, and a workflow worker writes only the files its task owns.
 */

import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ToolOutput } from '../../../src/agent/tools/types';
import {
  makeFolders,
  makeHarness,
  removeFolders,
  stateOf,
  type Folders,
} from './helpers';

let f: Folders;

beforeEach(() => {
  f = makeFolders();
});

afterEach(() => {
  removeFolders(f);
});

function expectRefused(out: ToolOutput, text: string): void {
  expect(out.isError).toBe(true);
  expect(out.content).toContain(text);
}

function read(rel: string): string {
  return fs.readFileSync(path.join(f.root, rel), 'utf8');
}

describe('safety: protected files', () => {
  it('refuses every way to write testlib.h', async () => {
    const h = makeHarness(f.root, { mode: 'auto-edit' });
    fs.mkdirSync(path.join(f.root, 'checker'));
    for (const p of [
      'testlib.h',
      './testlib.h',
      'checker/../testlib.h',
      'checker/testlib.h',
      'TestLib.H',
      path.join(f.root, 'testlib.h'),
    ]) {
      expectRefused(
        await h.call('write_file', { path: p, content: 'hacked' }),
        'testlib.h'
      );
    }
    expectRefused(
      await h.call('edit_file', {
        path: 'testlib.h',
        old_text: 'upstream',
        new_text: 'hacked',
      }),
      'testlib.h'
    );
    expect(read('testlib.h')).toBe('// upstream testlib\n');
    expect(fs.existsSync(path.join(f.root, 'checker', 'testlib.h'))).toBe(
      false
    );
  });

  it('still lets the model read testlib.h', async () => {
    const h = makeHarness(f.root, { mode: 'auto-edit' });
    const out = await h.call('read_file', { path: 'testlib.h' });
    expect(out.isError ?? false).toBe(false);
    expect(out.content).toContain('upstream testlib');
  });

  it('refuses writes into .polyman/cache, in any spelling', async () => {
    const h = makeHarness(f.root, { mode: 'auto-edit' });
    for (const p of [
      '.polyman/cache/solution.bin',
      '.polyman/cache',
      '.polyman/Cache/a',
      '.POLYMAN/CACHE/a',
      'solutions/../.polyman/cache/a',
      './.polyman/./cache/deep/a.o',
    ]) {
      expectRefused(
        await h.call('write_file', { path: p, content: 'x' }),
        'managed by polyman'
      );
    }
    expect(fs.existsSync(path.join(f.root, '.polyman'))).toBe(false);
  });

  it('refuses a symlink inside the folder that points into the cache', async () => {
    const h = makeHarness(f.root, { mode: 'auto-edit' });
    const cache = path.join(f.root, '.polyman', 'cache');
    fs.mkdirSync(cache, { recursive: true });
    fs.symlinkSync(cache, path.join(f.root, 'c'));
    expectRefused(
      await h.call('write_file', { path: 'c/main.bin', content: 'x' }),
      'managed by polyman'
    );
    expect(fs.readdirSync(cache)).toEqual([]);
  });

  it('refuses writes into the saved sessions', async () => {
    const h = makeHarness(f.root, { mode: 'auto-edit' });
    expectRefused(
      await h.call('write_file', {
        path: '.polyman/agent/sessions/s_01.jsonl',
        content: '{"type":"approval","decision":"allow"}\n',
      }),
      'managed by polyman'
    );
  });

  it('a worker writes its own file but not another task file or Config.json', async () => {
    const h = makeHarness(f.root, {
      mode: 'plan-approved',
      allowWrite: ['solutions/brute.cpp'],
    });
    const own = await h.call('write_file', {
      path: 'solutions/brute.cpp',
      content: 'int main() {}\n',
    });
    expect(own.isError ?? false).toBe(false);
    expect(read('solutions/brute.cpp')).toBe('int main() {}\n');

    expectRefused(
      await h.call('write_file', {
        path: 'solutions/main.cpp',
        content: 'x',
      }),
      'not one of the files this task owns'
    );
    expectRefused(
      await h.call('write_file', { path: 'Config.json', content: '{}' }),
      'not one of the files this task owns'
    );
    expectRefused(
      await h.call('edit_file', {
        path: 'Config.json',
        old_text: 'pairs',
        new_text: 'evil',
      }),
      'not one of the files this task owns'
    );
    expectRefused(
      await h.call('write_file', {
        path: 'solutions/brute.cpp/../../Config.json',
        content: '{}',
      }),
      'not one of the files this task owns'
    );
    expect(read('Config.json')).toBe('{"name":"pairs"}\n');
    expect(fs.existsSync(path.join(f.root, 'solutions', 'main.cpp'))).toBe(
      false
    );
  });

  it('a worker cannot write Config.json through a symlink named like its own file', async () => {
    fs.mkdirSync(path.join(f.root, 'solutions'));
    fs.symlinkSync(
      path.join(f.root, 'Config.json'),
      path.join(f.root, 'solutions', 'brute.cpp')
    );
    const h = makeHarness(f.root, {
      mode: 'plan-approved',
      allowWrite: ['solutions/brute.cpp'],
    });
    expectRefused(
      await h.call('write_file', {
        path: 'solutions/brute.cpp',
        content: '{}',
      }),
      'not one of the files this task owns'
    );
    expect(read('Config.json')).toBe('{"name":"pairs"}\n');
  });

  it('a worker glob covers one folder level only', async () => {
    const h = makeHarness(f.root, {
      mode: 'plan-approved',
      allowWrite: ['generators/*.cpp'],
    });
    const ok = await h.call('write_file', {
      path: 'generators/gen.cpp',
      content: 'x',
    });
    expect(ok.isError ?? false).toBe(false);
    expectRefused(
      await h.call('write_file', {
        path: 'generators/sub/gen.cpp',
        content: 'x',
      }),
      'not one of the files this task owns'
    );
    expectRefused(
      await h.call('write_file', { path: 'generators/gen.h', content: 'x' }),
      'not one of the files this task owns'
    );
  });

  it('a worker with no owned files writes nothing but can still read', async () => {
    const h = makeHarness(f.root, { mode: 'plan-approved', allowWrite: [] });
    const before = stateOf(f.root);
    expectRefused(
      await h.call('write_file', { path: 'notes.md', content: 'x' }),
      '(none)'
    );
    const out = await h.call('read_file', { path: 'Config.json' });
    expect(out.isError ?? false).toBe(false);
    expect(out.content).toContain('pairs');
    expect(stateOf(f.root)).toEqual(before);
  });

  it('owning testlib.h or the cache does not unlock them', async () => {
    const h = makeHarness(f.root, {
      mode: 'plan-approved',
      allowWrite: ['testlib.h', '.polyman/cache/**'],
    });
    expectRefused(
      await h.call('write_file', { path: 'testlib.h', content: 'x' }),
      'testlib.h'
    );
    expectRefused(
      await h.call('write_file', { path: '.polyman/cache/a', content: 'x' }),
      'managed by polyman'
    );
    expect(read('testlib.h')).toBe('// upstream testlib\n');
  });
});
