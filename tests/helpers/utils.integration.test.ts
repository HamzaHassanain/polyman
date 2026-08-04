import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { executor } from '../../src/executor';
import { compileCPP, getCompiledCommandToRun } from '../../src/helpers/utils';
import type { LocalSolution } from '../../src/types';

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
        fs.writeFileSync(
          path.join(tmpDir, 'main.cpp'),
          [
            '#include <iostream>',
            'int main() {',
            '  std::cout << "OK\\n";',
            '  return 0;',
            '}',
            '',
          ].join('\n')
        );

        await compileCPP('main.cpp');
        const command = getCompiledCommandToRun({
          name: 'main',
          source: 'main.cpp',
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
    }
  );
});
