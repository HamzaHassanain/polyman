/**
 * Group 1: path escapes. A confused or hostile model tries to read or write
 * outside the problem folder through the real file tools.
 */

import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FolderSandbox } from '../../../src/agent/tools/sandbox';
import { SandboxError, type ToolOutput } from '../../../src/agent/tools/types';
import {
  makeFolders,
  makeHarness,
  outsideState,
  removeFolders,
  type Folders,
  type Harness,
} from './helpers';

let f: Folders;
let h: Harness;
let before: string[];

beforeEach(() => {
  f = makeFolders();
  // auto-edit: no approval, so only the sandbox stands in the way.
  h = makeHarness(f.root, { mode: 'auto-edit' });
  before = outsideState(f);
});

afterEach(() => {
  removeFolders(f);
});

function expectRefused(out: ToolOutput, text = 'outside the problem folder') {
  expect(out.isError).toBe(true);
  expect(out.content).toContain(text);
}

function expectNothingOutside(): void {
  expect(outsideState(f)).toEqual(before);
}

describe('safety: path escapes', () => {
  it('refuses ../x for read and write', async () => {
    expectRefused(
      await h.call('write_file', { path: '../x', content: 'pwned' })
    );
    expectRefused(await h.call('read_file', { path: '../outside/secret.txt' }));
    expectRefused(await h.call('list_files', { path: '..' }));
    expect(fs.existsSync(path.join(f.base, 'x'))).toBe(false);
    expectNothingOutside();
  });

  it('refuses ../../etc/passwd', async () => {
    const read = await h.call('read_file', { path: '../../etc/passwd' });
    expectRefused(read);
    expect(read.content).not.toContain('root:');
    expectRefused(
      await h.call('write_file', { path: '../../etc/passwd', content: 'x' })
    );
    expectRefused(
      await h.call('edit_file', {
        path: '../../etc/passwd',
        old_text: 'root',
        new_text: 'toor',
      })
    );
  });

  it('refuses absolute paths outside the folder', async () => {
    const secret = path.join(f.outside, 'secret.txt');
    const read = await h.call('read_file', { path: secret });
    expectRefused(read);
    expect(read.content).not.toContain('top secret');
    expectRefused(await h.call('read_file', { path: '/etc/passwd' }));
    expectRefused(
      await h.call('write_file', {
        path: path.join(f.outside, 'new.txt'),
        content: 'pwned',
      })
    );
    expectNothingOutside();
  });

  it('accepts an absolute path that is inside the folder', async () => {
    const out = await h.call('write_file', {
      path: path.join(f.root, 'notes.md'),
      content: 'ok\n',
    });
    expect(out.isError).toBeFalsy();
    expect(fs.readFileSync(path.join(f.root, 'notes.md'), 'utf8')).toBe('ok\n');
  });

  it('refuses the look-alike sibling folder (pairs vs pairs-evil)', async () => {
    expectRefused(
      await h.call('read_file', { path: '../pairs-evil/secret.txt' })
    );
    expectRefused(
      await h.call('write_file', { path: '../pairs-evil/x', content: 'x' })
    );
    expectRefused(
      await h.call('write_file', {
        path: path.join(f.sibling, 'x'),
        content: 'x',
      })
    );
    await expect(
      h.sandbox.resolve(path.join(f.sibling, 'secret.txt'), 'read')
    ).rejects.toBeInstanceOf(SandboxError);
    expectNothingOutside();
  });

  it('refuses a symlinked folder inside that points outside', async () => {
    fs.symlinkSync(f.outside, path.join(f.root, 'link'));
    const read = await h.call('read_file', { path: 'link/secret.txt' });
    expectRefused(read);
    expect(read.content).not.toContain('top secret');
    expectRefused(await h.call('list_files', { path: 'link' }));
    expectRefused(
      await h.call('write_file', { path: 'link/new.txt', content: 'pwned' })
    );
    expectRefused(
      await h.call('edit_file', {
        path: 'link/secret.txt',
        old_text: 'top',
        new_text: 'no',
      })
    );
    expectNothingOutside();
  });

  it('refuses a symlinked file inside that points outside', async () => {
    fs.symlinkSync(
      path.join(f.outside, 'secret.txt'),
      path.join(f.root, 'notes.txt')
    );
    expectRefused(await h.call('read_file', { path: 'notes.txt' }));
    expectRefused(
      await h.call('write_file', { path: 'notes.txt', content: 'pwned' })
    );
    expectNothingOutside();
  });

  it('refuses a dangling symlink whose target is outside', async () => {
    const target = path.join(f.outside, 'created.txt');
    fs.symlinkSync(target, path.join(f.root, 'out.txt'));
    expectRefused(
      await h.call('write_file', { path: 'out.txt', content: 'pwned' })
    );
    expect(fs.existsSync(target)).toBe(false);
    expectNothingOutside();
  });

  it('refuses subdir/../../x', async () => {
    fs.mkdirSync(path.join(f.root, 'subdir'));
    expectRefused(
      await h.call('write_file', { path: 'subdir/../../x', content: 'x' })
    );
    expectRefused(
      await h.call('write_file', {
        path: 'subdir/../../pairs-evil/x',
        content: 'x',
      })
    );
    expectRefused(
      await h.call('read_file', { path: 'subdir/../../outside/secret.txt' })
    );
    expectNothingOutside();
  });

  it('refuses a path with a NUL byte', async () => {
    expectRefused(
      await h.call('write_file', { path: 'a\0../../x', content: 'x' }),
      'not a valid path'
    );
    expectRefused(
      await h.call('read_file', { path: 'Config.json\0.txt' }),
      'not a valid path'
    );
    expect(fs.readdirSync(f.root).sort()).toEqual(['Config.json', 'testlib.h']);
    expectNothingOutside();
  });

  it('never writes outside with Windows-style ..\\x', async () => {
    for (const p of ['..\\x', '..\\..\\x', 'subdir\\..\\..\\x']) {
      const out = await h.call('write_file', { path: p, content: 'x' });
      if (process.platform === 'win32') {
        expectRefused(out);
      } else {
        // On POSIX a backslash is a normal file name character, so this is
        // one odd file inside the folder, not an escape.
        expect(out.isError ?? false).toBe(false);
        expect(fs.existsSync(path.join(f.root, p))).toBe(true);
      }
    }
    expect(fs.existsSync(path.join(f.base, 'x'))).toBe(false);
    expectNothingOutside();
  });

  it('refuses a symlink loop with an error, not a hang or a crash', async () => {
    fs.symlinkSync(path.join(f.root, 'b'), path.join(f.root, 'a'));
    fs.symlinkSync(path.join(f.root, 'a'), path.join(f.root, 'b'));
    const read = await h.call('read_file', { path: 'a' });
    expect(read.isError).toBe(true);
    expect(read.content).toMatch(/cannot be resolved|too many symlinks/);
    const write = await h.call('write_file', { path: 'a/x', content: 'x' });
    expect(write.isError).toBe(true);
    expectNothingOutside();
  });

  it('list_files shows a symlink to outside but does not go into it', async () => {
    fs.symlinkSync(f.outside, path.join(f.root, 'link'));
    const out = await h.call('list_files', {});
    expect(out.isError ?? false).toBe(false);
    expect(out.content).toContain('link');
    expect(out.content).not.toContain('secret.txt');
  });

  it('still allows a symlink that stays inside the folder', async () => {
    fs.mkdirSync(path.join(f.root, 'solutions'));
    fs.symlinkSync(
      path.join(f.root, 'solutions'),
      path.join(f.root, 'sol'),
      'dir'
    );
    const out = await h.call('write_file', {
      path: 'sol/main.cpp',
      content: 'int main() {}\n',
    });
    expect(out.isError ?? false).toBe(false);
    expect(fs.existsSync(path.join(f.root, 'solutions', 'main.cpp'))).toBe(
      true
    );
  });

  it('works the same when the sandbox root is given through a symlink', async () => {
    const alias = path.join(f.base, 'alias');
    fs.symlinkSync(f.root, alias);
    const sandbox = new FolderSandbox(alias);
    expect(sandbox.root).toBe(f.root);
    await expect(
      sandbox.resolve('../outside/secret.txt', 'read')
    ).rejects.toThrow(/outside the problem folder/);
    await expect(sandbox.resolve('Config.json', 'write')).resolves.toBe(
      path.join(f.root, 'Config.json')
    );
  });
});
