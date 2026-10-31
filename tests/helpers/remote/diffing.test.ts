/**
 * Tests for the comparison engine behind `polyman remote diff` and
 * `polyman remote push --dry-run`.
 *
 * The SDK is mocked but the local files are real: whether two components
 * differ is a question about bytes, and mocking the file system would only
 * test the mock.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { diffProblem } from '../../../src/helpers/remote/diffing';
import type { PolygonSDK } from '../../../src/polygon';
import type ConfigFile from '../../../src/types';
import type { DiffComponent } from '../../../src/types';

type SdkMethod =
  | 'getSolutions'
  | 'viewSolution'
  | 'getChecker'
  | 'getValidator'
  | 'getFiles'
  | 'viewFile'
  | 'getStatements'
  | 'getScript'
  | 'getTestInput';

/** Answers a Polygon request with a value, a rejection or a function. */
type Handler = unknown;

function buildSdk(handlers: Partial<Record<SdkMethod, Handler>> = {}) {
  const defaults: Record<SdkMethod, Handler> = {
    getSolutions: [],
    viewSolution: '',
    getChecker: '',
    getValidator: '',
    getFiles: { sourceFiles: [], resourceFiles: [], auxFiles: [] },
    viewFile: '',
    getStatements: {},
    getScript: '',
    getTestInput: '',
  };
  const mocks = {} as Record<SdkMethod, Mock>;
  for (const method of Object.keys(defaults) as SdkMethod[]) {
    const handler = handlers[method] ?? defaults[method];
    mocks[method] = vi.fn((...args: unknown[]) => {
      if (handler instanceof Error) return Promise.reject(handler);
      if (typeof handler === 'function') {
        return Promise.resolve(
          (handler as (...a: unknown[]) => unknown)(...args)
        );
      }
      return Promise.resolve(handler);
    });
  }
  return { sdk: mocks as unknown as PolygonSDK, mocks };
}

let dir: string;
let cleanup: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polyman-diff-'));
  cleanup = dir;
});

afterEach(() => {
  fs.rmSync(cleanup, { recursive: true, force: true });
});

/** Writes a file inside the problem folder and returns its Config.json path. */
const write = (relative: string, content: string): string => {
  const filePath = path.join(dir, relative);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return `./${relative}`;
};

const asConfig = (partial: Partial<ConfigFile>): ConfigFile =>
  partial as unknown as ConfigFile;

/** Looks one component up by the `component/name` pair a report prints. */
const find = (
  components: DiffComponent[],
  component: string,
  name: string
): DiffComponent | undefined =>
  components.find(
    entry => entry.component === component && entry.name === name
  );

const statusOf = (
  components: DiffComponent[],
  component: string,
  name: string
): DiffComponent['status'] | undefined =>
  find(components, component, name)?.status;

describe('diffing.ts', () => {
  describe('solutions', () => {
    const config = () =>
      asConfig({
        name: 'two-sum',
        problemId: 7,
        solutions: [
          {
            name: 'main',
            source: write('solutions/main.cpp', 'int main(){}\n'),
            tag: 'MA',
          },
          { name: 'wa', source: write('solutions/wa.cpp', 'bad\n'), tag: 'WA' },
        ],
      });

    it('reports same, changed, local only and remote only in one pass', async () => {
      const { sdk } = buildSdk({
        getSolutions: [
          { name: 'main.cpp', tag: 'MA' },
          { name: 'wa.cpp', tag: 'WA' },
          { name: 'jury.cpp', tag: 'MA' },
        ],
        viewSolution: (problemId: number, name: string) =>
          name === 'wa.cpp' ? 'different\n' : 'int main(){}\n',
      });

      const { components } = await diffProblem(sdk, 7, dir, config());

      expect(statusOf(components, 'solution', 'main.cpp')).toBe('same');
      expect(statusOf(components, 'solution', 'wa.cpp')).toBe('changed');
      expect(statusOf(components, 'solution', 'jury.cpp')).toBe('remote-only');
    });

    it('marks a solution Polygon has never heard of as local only without fetching it', async () => {
      const { sdk, mocks } = buildSdk({
        getSolutions: [{ name: 'main.cpp', tag: 'MA' }],
      });

      const { components } = await diffProblem(sdk, 7, dir, config());

      expect(statusOf(components, 'solution', 'wa.cpp')).toBe('local-only');
      const fetched = mocks['viewSolution'].mock.calls.map(
        call => call[1] as string
      );
      expect(fetched).toEqual(['main.cpp']);
    });

    it('ignores the line endings a push adds before upload', async () => {
      const main = write('solutions/main.cpp', 'int main(){}\n');
      const wa = write('solutions/wa.cpp', 'int main(){}\n');
      const { sdk } = buildSdk({
        getSolutions: [{ name: 'main.cpp' }, { name: 'wa.cpp' }],
        // Polygon returns CRLF for a file written on Windows.
        viewSolution: 'int main(){}\r\n',
      });

      const { components } = await diffProblem(
        sdk,
        7,
        dir,
        asConfig({
          solutions: [
            { name: 'main', source: main, tag: 'MA' },
            { name: 'wa', source: wa, tag: 'MA' },
          ],
        })
      );

      expect(statusOf(components, 'solution', 'main.cpp')).toBe('same');
      expect(statusOf(components, 'solution', 'wa.cpp')).toBe('same');
    });

    it('does not treat a blank-line-only difference as nothing', async () => {
      const main = write('solutions/main.cpp', 'a\n\nb\n');
      const { sdk } = buildSdk({
        getSolutions: [{ name: 'main.cpp' }],
        // Polygon holds an extra blank line a push would remove.
        viewSolution: 'a\n\n\nb\n',
      });

      const { components } = await diffProblem(
        sdk,
        7,
        dir,
        asConfig({
          solutions: [{ name: 'main', source: main, tag: 'MA' }],
        })
      );

      expect(statusOf(components, 'solution', 'main.cpp')).toBe('changed');
    });

    it('compares the Java copy push uploads, not the local file', async () => {
      // Locally the class matches the file name; a push renames it to `Main`.
      const source = write(
        'solutions/Solution.java',
        'public class Solution {}\n'
      );
      const { sdk } = buildSdk({
        getSolutions: [{ name: 'Solution.java' }],
        viewSolution: 'public class Main {}\n',
      });

      const { components } = await diffProblem(
        sdk,
        7,
        dir,
        asConfig({ solutions: [{ name: 'main', source, tag: 'MA' }] })
      );

      expect(statusOf(components, 'solution', 'Solution.java')).toBe('same');
    });

    it('warns about a missing local file instead of inventing a component', async () => {
      const main = write('solutions/main.cpp', 'int main(){}\n');
      const { sdk } = buildSdk({
        getSolutions: [{ name: 'main.cpp' }],
      });

      const { components, warnings } = await diffProblem(
        sdk,
        7,
        dir,
        asConfig({
          solutions: [
            { name: 'main', source: main, tag: 'MA' },
            { name: 'gone', source: './solutions/gone.cpp', tag: 'WA' },
          ],
        })
      );

      expect(components.map(entry => entry.name)).toEqual(['main.cpp']);
      expect(warnings.join('\n')).toContain(
        'solution gone: Solution file not found: ./solutions/gone.cpp'
      );
    });

    it('warns when the list cannot be read and reports nothing as same', async () => {
      const { sdk } = buildSdk({ getSolutions: new Error('403') });

      const { components, warnings } = await diffProblem(sdk, 7, dir, config());

      expect(components).toHaveLength(0);
      expect(warnings.join('\n')).toContain(
        'solutions: could not be listed (403)'
      );
    });

    it('warns when one file cannot be read rather than calling it unchanged', async () => {
      const { sdk } = buildSdk({
        getSolutions: [{ name: 'main.cpp' }, { name: 'wa.cpp' }],
        viewSolution: (problemId: number, name: string) => {
          if (name === 'main.cpp') return 'int main(){}\n';
          throw new Error('500');
        },
      });

      const { components, warnings } = await diffProblem(sdk, 7, dir, config());

      expect(statusOf(components, 'solution', 'main.cpp')).toBe('same');
      expect(find(components, 'solution', 'wa.cpp')).toBeUndefined();
      expect(warnings.join('\n')).toContain(
        'solution wa.cpp: could not read it from Polygon (500)'
      );
    });
  });

  describe('checker and validator', () => {
    const customChecker = () =>
      write('checker/checker.cpp', 'custom checker\n');

    it('compares a standard checker by name, not by file', async () => {
      const { sdk, mocks } = buildSdk({ getChecker: 'std::wcmp.cpp' });

      const { components } = await diffProblem(
        sdk,
        7,
        dir,
        asConfig({
          checker: { name: 'wcmp', source: 'wcmp.cpp', isStandard: true },
        })
      );

      expect(statusOf(components, 'checker', 'std::wcmp.cpp')).toBe('same');
      expect(mocks['viewFile']).not.toHaveBeenCalled();
    });

    it('calls a different standard checker changed', async () => {
      const { sdk } = buildSdk({ getChecker: 'std::ncmp.cpp' });

      const { components } = await diffProblem(
        sdk,
        7,
        dir,
        asConfig({
          checker: { name: 'wcmp', source: 'wcmp.cpp', isStandard: true },
        })
      );

      expect(statusOf(components, 'checker', 'std::wcmp.cpp')).toBe('changed');
    });

    it('marks a standard checker Polygon does not have as local only', async () => {
      const { sdk } = buildSdk({ getChecker: '' });

      const { components } = await diffProblem(
        sdk,
        7,
        dir,
        asConfig({
          checker: { name: 'wcmp', source: 'wcmp.cpp', isStandard: true },
        })
      );

      expect(statusOf(components, 'checker', 'std::wcmp.cpp')).toBe(
        'local-only'
      );
    });

    it('marks a custom checker Polygon does not have as local only', async () => {
      const source = write('checker/checker.cpp', 'custom checker\n');
      const { sdk } = buildSdk({ getChecker: '' });

      const { components } = await diffProblem(
        sdk,
        7,
        dir,
        asConfig({ checker: { name: 'check', source } })
      );

      expect(statusOf(components, 'checker', 'checker.cpp')).toBe('local-only');
    });

    it('compares the source of a custom checker', async () => {
      const source = customChecker();
      const { sdk } = buildSdk({
        getChecker: 'checker.cpp',
        viewFile: 'custom checker\n',
      });

      const { components } = await diffProblem(
        sdk,
        7,
        dir,
        asConfig({ checker: { name: 'check', source } })
      );

      expect(statusOf(components, 'checker', 'checker.cpp')).toBe('same');
    });

    it('flags a checker Polygon keeps under a different name as changed', async () => {
      const source = customChecker();
      const { sdk } = buildSdk({ getChecker: 'old-checker.cpp' });

      const { components, warnings } = await diffProblem(
        sdk,
        7,
        dir,
        asConfig({ checker: { name: 'check', source } })
      );

      expect(statusOf(components, 'checker', 'checker.cpp')).toBe('changed');
      expect(warnings.join('\n')).toContain(
        'a push would switch to the local one'
      );
    });

    it('reports the Polygon checker as remote only when there is no local one', async () => {
      const { sdk } = buildSdk({ getChecker: 'checker.cpp' });

      const { components } = await diffProblem(sdk, 7, dir, asConfig({}));

      expect(statusOf(components, 'checker', 'checker.cpp')).toBe(
        'remote-only'
      );
    });

    it('marks a validator Polygon does not have as local only', async () => {
      const source = write('validator/val.cpp', 'validator\n');
      const { sdk } = buildSdk({ getValidator: '' });

      const { components } = await diffProblem(
        sdk,
        7,
        dir,
        asConfig({ validator: { name: 'val', source } })
      );

      expect(statusOf(components, 'validator', 'val.cpp')).toBe('local-only');
    });

    it('compares a validator that exists on both sides', async () => {
      const source = write('validator/val.cpp', 'validator\n');
      const { sdk } = buildSdk({
        getValidator: 'val.cpp',
        viewFile: 'validator v2\n',
      });

      const { components } = await diffProblem(
        sdk,
        7,
        dir,
        asConfig({ validator: { name: 'val', source } })
      );

      expect(statusOf(components, 'validator', 'val.cpp')).toBe('changed');
    });
  });

  describe('generators', () => {
    it('checks membership of the source files and then the content', async () => {
      const known = write('generators/gen.cpp', 'gen one\n');
      const fresh = write('generators/other.cpp', 'gen two\n');
      const { sdk } = buildSdk({
        getFiles: {
          sourceFiles: [{ name: 'gen.cpp' }],
          resourceFiles: [],
          auxFiles: [],
        },
        viewFile: 'gen one\n',
      });

      const { components } = await diffProblem(
        sdk,
        7,
        dir,
        asConfig({
          generators: [
            { name: 'gen', source: known },
            { name: 'other', source: fresh },
          ],
        })
      );

      expect(statusOf(components, 'generator', 'gen.cpp')).toBe('same');
      expect(statusOf(components, 'generator', 'other.cpp')).toBe('local-only');
    });

    it('warns that a remote-only generator cannot be detected', async () => {
      const source = write('generators/gen.cpp', 'gen one\n');
      const { sdk } = buildSdk();

      const { warnings } = await diffProblem(
        sdk,
        7,
        dir,
        asConfig({ generators: [{ name: 'gen', source }] })
      );

      expect(warnings.join('\n')).toContain(
        'generators: a generator that is only on Polygon is not listed here'
      );
    });
  });

  describe('statements', () => {
    it('compares one entry per language and section', async () => {
      const legend = write('statements/english/legend.tex', 'Legend\n');
      const input = write('statements/english/input.tex', 'Input\n');
      const { sdk } = buildSdk({
        getStatements: {
          english: { legend: 'Legend\n', input: 'Other input\n' },
          russian: { legend: 'Russian\n' },
        },
      });

      const { components } = await diffProblem(
        sdk,
        7,
        dir,
        asConfig({
          statements: {
            english: {
              name: 'Two Sum',
              encoding: 'UTF-8',
              legend,
              input,
            },
          },
        })
      );

      expect(statusOf(components, 'statement', 'english/legend')).toBe('same');
      expect(statusOf(components, 'statement', 'english/input')).toBe(
        'changed'
      );
      expect(statusOf(components, 'statement', 'russian')).toBe('remote-only');
    });

    it('marks a section Polygon has empty as local only', async () => {
      const legend = write('statements/english/legend.tex', 'Legend\n');
      const notes = write('statements/english/notes.tex', 'Notes\n');
      const { sdk } = buildSdk({
        getStatements: { english: { legend: 'Legend\n', notes: '' } },
      });

      const { components } = await diffProblem(
        sdk,
        7,
        dir,
        asConfig({
          statements: {
            english: { name: 'P', encoding: 'UTF-8', legend, notes },
          },
        })
      );

      expect(statusOf(components, 'statement', 'english/legend')).toBe('same');
      expect(statusOf(components, 'statement', 'english/notes')).toBe(
        'local-only'
      );
    });

    it('skips a section whose file is missing locally, exactly as push does', async () => {
      const legend = write('statements/english/legend.tex', 'Legend\n');
      const { sdk } = buildSdk({
        getStatements: { english: { legend: 'Legend\n' } },
      });

      const { components } = await diffProblem(
        sdk,
        7,
        dir,
        asConfig({
          statements: {
            english: {
              name: 'P',
              encoding: 'UTF-8',
              legend,
              output: './statements/english/output.tex',
            },
          },
        })
      );

      expect(components.map(entry => entry.name)).toEqual(['english/legend']);
    });

    it('warns when statements cannot be read', async () => {
      write('statements/english/legend.tex', 'Legend\n');
      const { sdk } = buildSdk({ getStatements: new Error('timeout') });

      const { components, warnings } = await diffProblem(
        sdk,
        7,
        dir,
        asConfig({
          statements: {
            english: {
              name: 'P',
              encoding: 'UTF-8',
              legend: './statements/english/legend.tex',
            },
          },
        })
      );

      expect(components).toHaveLength(0);
      expect(warnings.join('\n')).toContain(
        'statements: could not be read (timeout)'
      );
    });
  });

  describe('testsets', () => {
    const testsetConfig = (script: string) =>
      asConfig({
        generators: [
          { name: 'gen-random', source: write('generators/gen.cpp', 'gen\n') },
        ],
        testsets: [
          {
            name: 'tests',
            generatorScript: { script },
            manualTests: [
              { index: 1, input: write('manual/tests/m-01.in', '1 2\n') },
            ],
          },
        ],
      });

    it('compares the script push would send, with generator names rewritten', async () => {
      // Locally the line starts with the Config.json name; Polygon knows the
      // source file name, and a push rewrites it. The diff must use the same
      // text or it would promise an upload that never happens.
      const { sdk, mocks } = buildSdk({
        getScript: 'gen 1 2 > $\n',
      });

      const { components } = await diffProblem(
        sdk,
        7,
        dir,
        testsetConfig('gen-random 1 2 > $\n')
      );

      expect(statusOf(components, 'generator-script', 'tests')).toBe('same');
      expect(mocks['getScript']).toHaveBeenCalledWith(7, 'tests');
    });

    it('calls a changed script changed', async () => {
      const { sdk } = buildSdk({ getScript: 'gen 1 3 > $\n' });

      const { components } = await diffProblem(
        sdk,
        7,
        dir,
        testsetConfig('gen-random 1 2 > $\n')
      );

      expect(statusOf(components, 'generator-script', 'tests')).toBe('changed');
    });

    it('treats the blank script of a cleared testset as absent', async () => {
      const { sdk } = buildSdk({ getScript: ' ' });

      const { components } = await diffProblem(
        sdk,
        7,
        dir,
        testsetConfig('gen-random 1 2 > $\n')
      );

      expect(statusOf(components, 'generator-script', 'tests')).toBe(
        'local-only'
      );
    });

    it('compares each declared manual test input', async () => {
      const { sdk, mocks } = buildSdk({
        getTestInput: (problemId: number, testset: string, index: number) =>
          index === 1 ? '1 2\n' : 'other\n',
      });

      const { components } = await diffProblem(
        sdk,
        7,
        dir,
        testsetConfig('gen-random 1 2 > $\n')
      );

      expect(statusOf(components, 'manual-test', 'tests/1')).toBe('same');
      expect(mocks['getTestInput']).toHaveBeenCalledWith(7, 'tests', 1);
    });

    it('warns about a testset whose script cannot be read and moves on', async () => {
      const { sdk } = buildSdk({
        getScript: new Error('404'),
        getTestInput: '1 2\n',
      });

      const { components, warnings } = await diffProblem(
        sdk,
        7,
        dir,
        testsetConfig('gen-random 1 2 > $\n')
      );

      expect(find(components, 'generator-script', 'tests')).toBeUndefined();
      expect(warnings.join('\n')).toContain(
        'script of testset tests: could not read it from Polygon (404)'
      );
      expect(statusOf(components, 'manual-test', 'tests/1')).toBe('same');
    });
  });

  describe('ordering', () => {
    it('lists every component in one stable order', async () => {
      const solution = write('solutions/main.cpp', 'main\n');
      const checker = write('checker/checker.cpp', 'checker\n');
      const generator = write('generators/gen.cpp', 'gen\n');
      const legend = write('statements/english/legend.tex', 'Legend\n');
      const { sdk } = buildSdk({
        getSolutions: [{ name: 'main.cpp' }],
        viewSolution: 'main\n',
        getChecker: 'checker.cpp',
        viewFile: 'gen\n',
        getFiles: { sourceFiles: [{ name: 'gen.cpp' }] },
        getStatements: { english: { legend: 'Legend\n' } },
        getScript: 'gen 1 > $\n',
      });

      const first = await diffProblem(
        sdk,
        7,
        dir,
        asConfig({
          solutions: [{ name: 'main', source: solution, tag: 'MA' }],
          checker: { name: 'check', source: checker },
          generators: [{ name: 'gen', source: generator }],
          statements: { english: { name: 'P', encoding: 'UTF-8', legend } },
          testsets: [
            {
              name: 'tests',
              generatorScript: { script: 'gen-random 1 > $\n' },
            },
          ],
        })
      );
      const second = await diffProblem(
        sdk,
        7,
        dir,
        asConfig({
          solutions: [{ name: 'main', source: solution, tag: 'MA' }],
          checker: { name: 'check', source: checker },
          generators: [{ name: 'gen', source: generator }],
          statements: { english: { name: 'P', encoding: 'UTF-8', legend } },
          testsets: [
            {
              name: 'tests',
              generatorScript: { script: 'gen-random 1 > $\n' },
            },
          ],
        })
      );

      expect(
        first.components.map(entry => `${entry.component}:${entry.name}`)
      ).toEqual(
        second.components.map(entry => `${entry.component}:${entry.name}`)
      );
      expect(first.components.map(entry => entry.component)).toEqual([
        'solution',
        'checker',
        'generator',
        'statement',
        'generator-script',
      ]);
    });
  });
});
