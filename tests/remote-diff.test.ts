/**
 * Tests for `polyman remote diff` and `polyman remote push --dry-run`: the
 * real actions, steps, comparison engine and report, with a mocked Polygon
 * client and credentials. The guarantee under test is that both commands
 * answer "what would change?" without changing anything, and that a dry run
 * cannot disagree with the real push because both read the same payload.
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
import * as actions from '../src/actions';
import { report } from '../src/report';
import { exitCodeFor } from '../src/errors';
import type { DiffReport } from '../src/types';

const API_KEY = 'key0123456789abcdef';
const SECRET = 'secret9876543210fedcba';

const sdk: Record<string, Mock<(...args: never[]) => unknown>> = {};

vi.mock('../src/polygon', () => ({
  PolygonSDK: vi.fn(function () {
    return sdk;
  }),
}));

vi.mock('../src/helpers/remote/utils', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../src/helpers/remote/utils')>();
  return {
    ...actual,
    readCredentials: vi.fn(() => ({ apiKey: API_KEY, secret: SECRET })),
  };
});

const resetSdk = (): void => {
  for (const key of Object.keys(sdk)) delete sdk[key];
  const resolved = (value: unknown = undefined) =>
    vi.fn().mockResolvedValue(value);
  Object.assign(sdk, {
    // writes: a diff or a dry run must never touch any of these
    saveSolution: resolved(),
    saveFile: resolved(),
    setChecker: resolved(),
    setValidator: resolved(),
    saveStatement: resolved(),
    saveGeneralDescription: resolved(),
    saveTags: resolved(),
    saveScript: resolved(),
    saveTest: resolved(),
    updateProblemInfo: resolved(),
    createProblem: resolved({ id: 99 }),
    // reads
    getProblemInfo: resolved({ timeLimit: 1000, memoryLimit: 256 }),
    getSolutions: resolved([{ name: 'main.cpp', tag: 'MA' }]),
    viewSolution: resolved('int main(){}\n'),
    getChecker: resolved('std::wcmp.cpp'),
    getValidator: resolved(''),
    getFiles: resolved({
      resourceFiles: [],
      sourceFiles: [{ name: 'gen.cpp', sourceType: 'cpp.g++17' }],
      auxFiles: [],
    }),
    viewFile: resolved('int main(){}\n'),
    getStatements: resolved({}),
    getScript: resolved(' '),
    getTestInput: resolved(''),
  });
};

let tmp: string;
let writeSpy: ReturnType<typeof vi.spyOn<typeof fs, 'writeSync'>>;
let exitSpy: ReturnType<typeof vi.spyOn>;

/** The one JSON document written to stdout. */
const written = (): DiffReport => {
  const calls = writeSpy.mock.calls.filter(
    call => call[0] === process.stdout.fd
  );
  expect(calls).toHaveLength(1);
  return JSON.parse(String(calls[0][1])) as DiffReport;
};

/**
 * Awaits an action that must fail and returns what it threw. The action
 * rethrows so that cli.ts, the one exit point, can pick the exit code.
 */
const failure = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error('expected the action to fail');
    },
    (error: unknown) => error
  );

const baseConfig: Record<string, unknown> = {
  name: 'two-sum',
  problemId: 7,
  timeLimit: 1000,
  memoryLimit: 256,
  solutions: [
    { name: 'main', source: './solutions/main.cpp', tag: 'MA' },
    { name: 'wa', source: './solutions/wa.cpp', tag: 'WA' },
  ],
  checker: { name: 'wcmp', source: 'wcmp.cpp', isStandard: true },
};

/** Writes a small problem folder and returns its path. */
const writeProblem = (config: Record<string, unknown>): string => {
  const dir = path.join(tmp, 'prob');
  fs.mkdirSync(path.join(dir, 'solutions'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'solutions', 'main.cpp'), 'int main(){}\n');
  fs.writeFileSync(path.join(dir, 'solutions', 'wa.cpp'), 'int main(){}\n');
  fs.writeFileSync(path.join(dir, 'Config.json'), JSON.stringify(config));
  return dir;
};

const componentOf = (doc: DiffReport, name: string) =>
  doc.components.find(component => component.name === name);

describe('remote diff and push --dry-run', () => {
  beforeEach(() => {
    resetSdk();
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'polyman-diff-action-'));
    writeSpy = vi
      .spyOn(fs, 'writeSync')
      .mockImplementation((_fd, data) => Buffer.byteLength(data));
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    report.reset();
    vi.restoreAllMocks();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('remote diff', () => {
    it('lists one component per compared file and counts what differs', async () => {
      const dir = writeProblem(baseConfig);

      await actions.remoteDiffAction(dir, { json: true });

      const doc = written();
      expect(doc).toMatchObject({
        schemaVersion: 1,
        command: 'remote diff',
        ok: true,
        exitCode: 0,
        problemId: 7,
        changes: 1,
      });
      expect(componentOf(doc, 'main.cpp')).toEqual({
        component: 'solution',
        name: 'main.cpp',
        status: 'same',
      });
      expect(componentOf(doc, 'wa.cpp')).toEqual({
        component: 'solution',
        name: 'wa.cpp',
        status: 'local-only',
      });
      expect(componentOf(doc, 'std::wcmp.cpp')).toEqual({
        component: 'checker',
        name: 'std::wcmp.cpp',
        status: 'same',
      });
      // cli.ts is the only exit point: the action reports and returns.
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('exits 0 when a push would change nothing', async () => {
      sdk['getSolutions'].mockResolvedValue([
        { name: 'main.cpp', tag: 'MA' },
        { name: 'wa.cpp', tag: 'WA' },
      ]);
      const dir = writeProblem(baseConfig);

      await actions.remoteDiffAction(dir, { json: true });

      const doc = written();
      expect(doc.ok).toBe(true);
      expect(doc.exitCode).toBe(0);
      expect(doc.changes).toBe(0);
      expect(
        doc.components.every(component => component.status === 'same')
      ).toBe(true);
    });

    it('reads from Polygon without writing to it', async () => {
      const dir = writeProblem(baseConfig);

      await actions.remoteDiffAction(dir, { json: true });

      for (const method of [
        'saveSolution',
        'saveFile',
        'setChecker',
        'saveStatement',
        'saveScript',
        'saveTest',
        'updateProblemInfo',
        'createProblem',
      ]) {
        expect(sdk[method], method).not.toHaveBeenCalled();
      }
      expect(sdk['viewSolution']).toHaveBeenCalled();
    });

    it('turns a Polygon failure into a warning instead of reporting the file as unchanged', async () => {
      sdk['getSolutions'].mockRejectedValue(
        new Error('Polygon API Error: 500')
      );
      const dir = writeProblem(baseConfig);

      await actions.remoteDiffAction(dir, { json: true });

      const doc = written();
      expect(doc.ok).toBe(true);
      expect(doc.components.filter(c => c.component === 'solution')).toEqual(
        []
      );
      expect(doc.warnings.join('\n')).toContain(
        'solutions: could not be listed (Polygon API Error: 500)'
      );
    });

    it('never prints the API key or secret', async () => {
      sdk['getSolutions'].mockRejectedValue(
        new Error(`rejected apiKey=${API_KEY} secret=${SECRET}`)
      );
      const dir = writeProblem(baseConfig);

      await actions.remoteDiffAction(dir, { json: true });

      const text = String(
        writeSpy.mock.calls.find(c => c[0] === process.stdout.fd)![1]
      );
      expect(text).not.toContain(API_KEY);
      expect(text).not.toContain(SECRET);
      expect(written().warnings.join('\n')).toContain('[REDACTED]');
    });

    it('stops with exit code 2 when the problem is not on Polygon yet', async () => {
      const dir = writeProblem({ ...baseConfig, problemId: undefined });

      const error = await failure(
        actions.remoteDiffAction(dir, { json: true })
      );
      const doc = written();

      expect(exitCodeFor(error)).toBe(2);
      expect(doc).toMatchObject({
        command: 'remote diff',
        ok: false,
        exitCode: 2,
        problemId: null,
        components: [],
        changes: 0,
      });
      expect(doc.errors.join('\n')).toContain(
        'polyman remote push <directory> --dry-run'
      );
      expect(sdk['getSolutions']).not.toHaveBeenCalled();
    });
  });

  describe('remote push --dry-run', () => {
    it('uploads nothing and reports the components a real push would change', async () => {
      sdk['viewSolution'].mockResolvedValue('older\n');
      const dir = writeProblem(baseConfig);

      await actions.remotePushProblemAction(dir, {
        dryRun: true,
        json: true,
      });

      const doc = written();
      expect(doc).toMatchObject({
        command: 'remote push',
        ok: true,
        exitCode: 0,
        problemId: 7,
      });
      expect(componentOf(doc, 'main.cpp')?.status).toBe('changed');
      expect(componentOf(doc, 'wa.cpp')?.status).toBe('local-only');
      for (const method of [
        'saveSolution',
        'setChecker',
        'saveTest',
        'createProblem',
      ]) {
        expect(sdk[method], method).not.toHaveBeenCalled();
      }
    });

    it('only ever calls read methods, for every kind of component', async () => {
      const dir = writeProblem({
        ...baseConfig,
        checker: { name: 'chk', source: './checker/chk.cpp' },
        validator: { name: 'val', source: './validator/val.cpp' },
        generators: [{ name: 'gen-random', source: './generators/gen.cpp' }],
        statements: {
          english: {
            encoding: 'UTF-8',
            name: 'Two Sum',
            legend: './statements/english/legend.tex',
          },
        },
        testsets: [
          {
            name: 'tests',
            groupsEnabled: true,
            generatorScript: { script: 'gen-random 1 > $\n' },
            manualTests: [{ index: 1, input: './manual/m1.in' }],
          },
        ],
      });
      for (const [file, text] of [
        ['checker/chk.cpp', 'chk\n'],
        ['validator/val.cpp', 'val\n'],
        ['generators/gen.cpp', 'gen\n'],
        ['statements/english/legend.tex', 'legend\n'],
        ['manual/m1.in', '1 2\n'],
      ]) {
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        fs.writeFileSync(path.join(dir, file), text);
      }
      sdk['getChecker'].mockResolvedValue('chk.cpp');
      sdk['getValidator'].mockResolvedValue('val.cpp');
      sdk['getStatements'].mockResolvedValue({
        english: { encoding: 'UTF-8', name: 'Two Sum', legend: 'old\n' },
      });
      const before = fs.readFileSync(path.join(dir, 'Config.json'), 'utf-8');

      await actions.remotePushProblemAction(dir, { dryRun: true, json: true });

      const reads = new Set([
        'getProblemInfo',
        'getSolutions',
        'viewSolution',
        'getChecker',
        'getValidator',
        'getFiles',
        'viewFile',
        'getStatements',
        'getScript',
        'getTestInput',
      ]);
      const called = Object.keys(sdk).filter(
        method => sdk[method].mock.calls.length > 0
      );
      expect(called.filter(method => !reads.has(method))).toEqual([]);
      expect(called).toEqual(
        expect.arrayContaining([
          'viewFile',
          'getStatements',
          'getScript',
          'getTestInput',
        ])
      );
      expect(written()).toMatchObject({ ok: true, exitCode: 0 });
      expect(fs.readFileSync(path.join(dir, 'Config.json'), 'utf-8')).toBe(
        before
      );
    });

    it('fails with exit code 4 when Polygon cannot read the problem', async () => {
      sdk['getProblemInfo'].mockRejectedValue(
        new Error('Polygon API Error: no access')
      );
      const dir = writeProblem(baseConfig);

      const error = await failure(
        actions.remotePushProblemAction(dir, { dryRun: true, json: true })
      );

      expect(exitCodeFor(error)).toBe(4);
      expect(written()).toMatchObject({ ok: false, exitCode: 4 });
      expect(sdk['createProblem']).not.toHaveBeenCalled();
    });

    it('treats a problem that is not on Polygon as a warning, not a failure', async () => {
      const dir = writeProblem({ ...baseConfig, problemId: undefined });
      const before = fs.readFileSync(path.join(dir, 'Config.json'), 'utf-8');

      await actions.remotePushProblemAction(dir, { dryRun: true, json: true });

      const doc = written();
      expect(doc).toMatchObject({
        command: 'remote push',
        ok: true,
        exitCode: 0,
        problemId: null,
        changes: 0,
      });
      expect(doc.errors).toEqual([]);
      expect(doc.warnings.join('\n')).toContain('not on Polygon yet');
      expect(sdk['createProblem']).not.toHaveBeenCalled();
      expect(fs.readFileSync(path.join(dir, 'Config.json'), 'utf-8')).toBe(
        before
      );
    });

    it('does not ask to create a problem it will not create', async () => {
      const dir = writeProblem({ ...baseConfig, problemId: undefined });

      // No `--yes`: a real push would prompt here and stop the run.
      await actions.remotePushProblemAction(dir, { dryRun: true });

      expect(sdk['createProblem']).not.toHaveBeenCalled();
    });
  });
});
