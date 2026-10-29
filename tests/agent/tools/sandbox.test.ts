import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FolderSandbox } from '../../../src/agent/tools/sandbox';
import { SandboxError } from '../../../src/agent/tools/types';

let base: string;
let root: string;

beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pm-sbx-')));
  root = path.join(base, 'pairs');
  fs.mkdirSync(path.join(root, 'solutions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Config.json'), '{}');
  fs.writeFileSync(path.join(root, 'solutions', 'main.cpp'), 'int main(){}');
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

async function refused(
  promise: Promise<string>,
  message: string | RegExp
): Promise<void> {
  const err = await promise.then(
    () => undefined,
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(SandboxError);
  if (typeof message === 'string') {
    expect((err as Error).message).toBe(message);
  } else {
    expect((err as Error).message).toMatch(message);
  }
}

describe('FolderSandbox', () => {
  it('has the real root', () => {
    expect(new FolderSandbox(root).root).toBe(root);
  });

  it('resolves relative paths inside the folder', async () => {
    const sandbox = new FolderSandbox(root);
    await expect(sandbox.resolve('Config.json', 'read')).resolves.toBe(
      path.join(root, 'Config.json')
    );
    await expect(sandbox.resolve('solutions/main.cpp', 'write')).resolves.toBe(
      path.join(root, 'solutions', 'main.cpp')
    );
    await expect(sandbox.resolve('.', 'read')).resolves.toBe(root);
    await expect(sandbox.resolve('', 'read')).resolves.toBe(root);
  });

  it('accepts an absolute path inside the folder', async () => {
    const sandbox = new FolderSandbox(root);
    const abs = path.join(root, 'Config.json');
    await expect(sandbox.resolve(abs, 'read')).resolves.toBe(abs);
  });

  it('accepts a .. that stays inside', async () => {
    const sandbox = new FolderSandbox(root);
    await expect(
      sandbox.resolve('solutions/../Config.json', 'read')
    ).resolves.toBe(path.join(root, 'Config.json'));
  });

  it('refuses .. that leaves the folder', async () => {
    const sandbox = new FolderSandbox(root);
    fs.writeFileSync(path.join(base, 'secret.txt'), 'x');
    await refused(
      sandbox.resolve('../secret.txt', 'read'),
      '../secret.txt is outside the problem folder'
    );
    await refused(
      sandbox.resolve('solutions/../../secret.txt', 'write'),
      'solutions/../../secret.txt is outside the problem folder'
    );
  });

  it('refuses an absolute path outside the folder', async () => {
    const sandbox = new FolderSandbox(root);
    const outside = path.join(base, 'secret.txt');
    await refused(
      sandbox.resolve(outside, 'read'),
      `${outside} is outside the problem folder`
    );
    await refused(
      sandbox.resolve(os.homedir(), 'read'),
      /is outside the problem folder$/
    );
  });

  it('refuses a sibling folder that shares the name prefix', async () => {
    const evil = path.join(base, 'pairs-evil');
    fs.mkdirSync(evil);
    fs.writeFileSync(path.join(evil, 'x.cpp'), '');
    const sandbox = new FolderSandbox(root);
    await refused(
      sandbox.resolve(path.join(evil, 'x.cpp'), 'read'),
      /is outside the problem folder$/
    );
    await refused(
      sandbox.resolve('../pairs-evil/x.cpp', 'write'),
      '../pairs-evil/x.cpp is outside the problem folder'
    );
  });

  it('refuses a symlinked folder that points outside', async () => {
    const outside = path.join(base, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'secret.txt'), 'x');
    fs.symlinkSync(outside, path.join(root, 'link'), 'junction');
    const sandbox = new FolderSandbox(root);
    await refused(
      sandbox.resolve('link/secret.txt', 'read'),
      'link/secret.txt is outside the problem folder'
    );
    await refused(
      sandbox.resolve('link/new.txt', 'write'),
      'link/new.txt is outside the problem folder'
    );
  });

  it.skipIf(process.platform === 'win32')(
    'refuses a symlinked file and a dangling symlink that point outside',
    async () => {
      const secret = path.join(base, 'secret.txt');
      fs.writeFileSync(secret, 'x');
      fs.symlinkSync(secret, path.join(root, 'file-link'));
      fs.symlinkSync(
        path.join(base, 'not-yet.txt'),
        path.join(root, 'dangling')
      );
      const sandbox = new FolderSandbox(root);
      await refused(
        sandbox.resolve('file-link', 'read'),
        'file-link is outside the problem folder'
      );
      await refused(
        sandbox.resolve('dangling', 'write'),
        'dangling is outside the problem folder'
      );
    }
  );

  it('accepts a symlink that stays inside', async () => {
    fs.symlinkSync(
      path.join(root, 'solutions'),
      path.join(root, 'sols'),
      'junction'
    );
    const sandbox = new FolderSandbox(root);
    await expect(sandbox.resolve('sols/main.cpp', 'read')).resolves.toBe(
      path.join(root, 'solutions', 'main.cpp')
    );
  });

  it('works when the root itself is reached through a symlink', async () => {
    const alias = path.join(base, 'alias');
    fs.symlinkSync(root, alias, 'junction');
    const sandbox = new FolderSandbox(alias);
    expect(sandbox.root).toBe(root);
    await expect(sandbox.resolve('Config.json', 'read')).resolves.toBe(
      path.join(root, 'Config.json')
    );
  });

  it('resolves a new file in a new subfolder', async () => {
    const sandbox = new FolderSandbox(root);
    await expect(
      sandbox.resolve('generators/new/gen.cpp', 'write')
    ).resolves.toBe(path.join(root, 'generators', 'new', 'gen.cpp'));
  });

  it('refuses writes under .polyman/cache and the sessions folder', async () => {
    const sandbox = new FolderSandbox(root);
    await refused(
      sandbox.resolve('.polyman/cache/x.bin', 'write'),
      /^\.polyman\/cache\/x\.bin cannot be written: \.polyman\/cache\/ is managed by polyman$/
    );
    await refused(
      sandbox.resolve('.polyman/agent/sessions/s1.jsonl', 'write'),
      /cannot be written: \.polyman\/agent\/sessions\/ is managed by polyman$/
    );
    await refused(
      sandbox.resolve('.Polyman/Cache/x', 'write'),
      /cannot be written/
    );
    // Reading them and writing next to them is fine.
    await expect(sandbox.resolve('.polyman/cache/x.bin', 'read')).resolves.toBe(
      path.join(root, '.polyman', 'cache', 'x.bin')
    );
    await expect(
      sandbox.resolve('.polyman/agent/notes.md', 'write')
    ).resolves.toBe(path.join(root, '.polyman', 'agent', 'notes.md'));
    await expect(
      sandbox.resolve('.polyman/cache-notes.md', 'write')
    ).resolves.toBe(path.join(root, '.polyman', 'cache-notes.md'));
  });

  it('refuses writes to any testlib.h', async () => {
    const sandbox = new FolderSandbox(root);
    await refused(
      sandbox.resolve('testlib.h', 'write'),
      /^testlib\.h cannot be written: testlib\.h is the upstream testlib/
    );
    await refused(
      sandbox.resolve('checker/testlib.h', 'write'),
      /cannot be written/
    );
    await expect(sandbox.resolve('testlib.h', 'read')).resolves.toBe(
      path.join(root, 'testlib.h')
    );
  });

  describe('allowWrite', () => {
    const owns = ['solutions/main.cpp', 'generators/*.cpp', 'manual/**'];

    it('allows the owned files', async () => {
      const sandbox = new FolderSandbox(root, { allowWrite: owns });
      await expect(
        sandbox.resolve('solutions/main.cpp', 'write')
      ).resolves.toBe(path.join(root, 'solutions', 'main.cpp'));
      await expect(
        sandbox.resolve('generators/gen-random.cpp', 'write')
      ).resolves.toBe(path.join(root, 'generators', 'gen-random.cpp'));
      await expect(
        sandbox.resolve('manual/deep/test1.txt', 'write')
      ).resolves.toBe(path.join(root, 'manual', 'deep', 'test1.txt'));
      await expect(
        sandbox.resolve(path.join(root, 'solutions', 'main.cpp'), 'write')
      ).resolves.toBe(path.join(root, 'solutions', 'main.cpp'));
    });

    it('refuses other files, with the list', async () => {
      const sandbox = new FolderSandbox(root, { allowWrite: owns });
      await refused(
        sandbox.resolve('Config.json', 'write'),
        'Config.json is not one of the files this task owns: ' +
          'solutions/main.cpp, generators/*.cpp, manual/**'
      );
      // `*` does not cross a folder.
      await refused(
        sandbox.resolve('generators/sub/gen.cpp', 'write'),
        /is not one of the files this task owns/
      );
      await refused(
        sandbox.resolve('generators/gen.py', 'write'),
        /is not one of the files this task owns/
      );
    });

    it('still allows reads of any file inside', async () => {
      const sandbox = new FolderSandbox(root, { allowWrite: owns });
      await expect(sandbox.resolve('Config.json', 'read')).resolves.toBe(
        path.join(root, 'Config.json')
      );
    });

    it('does not open protected files', async () => {
      const sandbox = new FolderSandbox(root, { allowWrite: ['testlib.h'] });
      await refused(sandbox.resolve('testlib.h', 'write'), /cannot be written/);
    });

    it('refuses every write with an empty list', async () => {
      const sandbox = new FolderSandbox(root, { allowWrite: [] });
      await refused(
        sandbox.resolve('solutions/main.cpp', 'write'),
        'solutions/main.cpp is not one of the files this task owns: (none)'
      );
    });

    it('accepts patterns that start with ./', async () => {
      const sandbox = new FolderSandbox(root, {
        allowWrite: ['./solutions/main.cpp'],
      });
      await expect(
        sandbox.resolve('solutions/main.cpp', 'write')
      ).resolves.toBe(path.join(root, 'solutions', 'main.cpp'));
    });
  });

  it('refuses a path with a null byte', async () => {
    const sandbox = new FolderSandbox(root);
    await refused(sandbox.resolve('a\0b', 'read'), /is not a valid path$/);
  });
});
