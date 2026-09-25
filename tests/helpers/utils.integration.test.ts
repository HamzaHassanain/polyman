import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { executor } from '../../src/executor';
import {
  getCacheStats,
  resetCompileCacheState,
} from '../../src/helpers/compile-cache';
import {
  getPrebuiltTestlibDir,
  resetPrebuiltTestlibState,
} from '../../src/helpers/prebuilt-testlib';
import { compileCPP, getCompiledCommandToRun } from '../../src/helpers/utils';
import type { LocalSolution } from '../../src/types';
import { MINI_TESTLIB } from './mini-testlib';

/** Exercises every kind of definition the split moves into the object. */
const MINI_TESTLIB_PROGRAM = `#include "testlib.h"
int main() {
  Counter a, b;
  a.next();
  a.next();
  __usage += 5;
  // Sequenced: argument evaluation order is unspecified.
  int first = nextId();
  int second = nextId();
  int peek = peekId();
  std::printf("%d %d %d %d %d %d %d\\n", first, second, peek,
              Counter::created, a.get(), registry.size(),
              parse<int>("abc") + twice(__usage) + MAX_CASE);
  quit(features[1]);
}
`;

function hasGpp(): boolean {
  try {
    execFileSync('g++', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('utils.ts integration', () => {
  it.skipIf(process.platform === 'win32' || !hasGpp())(
    'compiles and runs C++ from a POSIX path with shell metacharacters',
    async () => {
      const originalCwd = process.cwd();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "polyman path 3)'"));

      try {
        process.chdir(tmpDir);

        // A root-level header included by bare name from a subdirectory
        // source, mirroring how `generators/gen.cpp` includes the
        // problem-root `testlib.h`. This only resolves because compileCPP
        // passes the problem root to g++ via `-iquote`.
        fs.writeFileSync(
          path.join(tmpDir, 'probe.h'),
          'inline const char* probe() { return "OK"; }\n'
        );
        fs.mkdirSync(path.join(tmpDir, 'solutions'));
        fs.writeFileSync(
          path.join(tmpDir, 'solutions', 'main.cpp'),
          [
            '#include "probe.h"',
            '#include <iostream>',
            'int main() {',
            '  std::cout << probe() << "\\n";',
            '  return 0;',
            '}',
            '',
          ].join('\n')
        );

        await compileCPP('solutions/main.cpp');
        const command = getCompiledCommandToRun({
          name: 'main',
          source: 'solutions/main.cpp',
          tag: 'MA',
        } satisfies LocalSolution);
        const result = await executor.execute(command, {
          timeout: 1000,
          silent: true,
        });

        expect(result.stdout.trim()).toBe('OK');
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    30_000
  );

  it.skipIf(process.platform === 'win32' || !hasGpp())(
    'reuses the cached binary until an included header changes',
    async () => {
      const originalCwd = process.cwd();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'polyman-cache-'));
      const solution: LocalSolution = {
        name: 'main',
        source: 'solutions/main.cpp',
        tag: 'MA',
      };
      const run = async () =>
        (
          await executor.execute(getCompiledCommandToRun(solution), {
            timeout: 1000,
            silent: true,
          })
        ).stdout.trim();

      try {
        process.chdir(tmpDir);
        resetCompileCacheState();
        const header = path.join(tmpDir, 'testlib.h');
        fs.writeFileSync(header, 'inline int answer() { return 1; }\n');
        fs.mkdirSync(path.join(tmpDir, 'solutions'));
        fs.writeFileSync(
          path.join(tmpDir, 'solutions', 'main.cpp'),
          '#include "testlib.h"\n#include <cstdio>\nint main() { std::printf("%d\\n", answer()); }\n'
        );

        await compileCPP('solutions/main.cpp');
        expect(getCacheStats()).toMatchObject({ hits: 0, misses: 1 });

        fs.rmSync(path.join(tmpDir, 'solutions', 'main'));
        await compileCPP('solutions/main.cpp');
        expect(getCacheStats()).toMatchObject({ hits: 1, misses: 1 });
        expect(await run()).toBe('1');

        fs.writeFileSync(header, 'inline int answer() { return 2; }\n');
        await compileCPP('solutions/main.cpp');
        expect(getCacheStats()).toMatchObject({ hits: 1, misses: 2 });
        expect(await run()).toBe('2');
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    60_000
  );

  it.skipIf(process.platform === 'win32' || !hasGpp())(
    'links testlib programs against one prebuilt testlib object',
    async () => {
      const originalCwd = process.cwd();
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'polyman-testlib-'));
      const runProgram = async (name: string) =>
        (
          await executor.execute(
            getCompiledCommandToRun({
              name,
              source: `solutions/${name}.cpp`,
              tag: 'MA',
            }),
            { timeout: 1000, silent: true }
          )
        ).stdout.trim();

      try {
        process.chdir(tmpDir);
        resetCompileCacheState();
        resetPrebuiltTestlibState();
        fs.writeFileSync(path.join(tmpDir, 'testlib.h'), MINI_TESTLIB);
        fs.mkdirSync(path.join(tmpDir, 'solutions'));
        fs.writeFileSync(
          path.join(tmpDir, 'solutions', 'a.cpp'),
          MINI_TESTLIB_PROGRAM
        );
        fs.writeFileSync(
          path.join(tmpDir, 'solutions', 'b.cpp'),
          `// another program\n${MINI_TESTLIB_PROGRAM}`
        );
        // Defines a macro first, so it must compile against the original.
        fs.writeFileSync(
          path.join(tmpDir, 'solutions', 'c.cpp'),
          `#define POLYMAN_UNRELATED 1\n${MINI_TESTLIB_PROGRAM}`
        );

        await Promise.all(
          ['a', 'b', 'c'].map(n => compileCPP(`solutions/${n}.cpp`))
        );

        const [object] = fs
          .readdirSync(getPrebuiltTestlibDir())
          .map(key => path.join(getPrebuiltTestlibDir(), key, 'testlib.o'));
        expect(fs.readdirSync(getPrebuiltTestlibDir())).toHaveLength(1);
        expect(fs.existsSync(object)).toBe(true);
        expect(
          fs.readdirSync(path.dirname(object)).includes('unsupported')
        ).toBe(false);
        // One copy of each global and static: nextId() counts 1, 2, 3 whether
        // called from the program or from the header's inline peekId().
        const expected = '1 2 2 2 2 1 113\nb{';
        for (const name of ['a', 'b', 'c']) {
          expect(await runProgram(name)).toBe(expected);
        }
      } finally {
        process.chdir(originalCwd);
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
    60_000
  );
});
