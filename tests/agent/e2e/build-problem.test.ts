/**
 * End-to-end: a scripted "Gemma" builds pairs-sum in a temp folder through
 * the real chat runtime, the real tools, the real scheduler and checkpoints,
 * and the real CLI (`dist/cli.js`). At the end the real `polyman verify`
 * must pass.
 *
 * Each role gets its own MockProvider: the chat agent, the manager, and one
 * per worker task. A small router picks the script from the system prompt
 * (and the task id for workers, since the two wrong solutions share one
 * prompt).
 *
 * testlib.h: `create_problem` runs the real `polyman new`, but
 * `download-testlib` needs the network, so the runner copies
 * `corpus/vendor/testlib.h` instead of running it. Everything else is the
 * real CLI.
 *
 * Needs `npm run build` and g++. Skipped without them.
 */

import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SeqEvent } from '../../../src/agent/core/events';
import { createChatRuntime } from '../../../src/agent/index';
import { MockProvider, type MockStep } from '../../../src/agent/providers/mock';
import type {
  ChatRequest,
  Provider,
  StreamEvent,
} from '../../../src/agent/providers/types';
import { NodeCliRunner } from '../../../src/agent/runner/cli-runner';
import type {
  CliRunner,
  RunOptions,
  RunResult,
} from '../../../src/agent/runner/types';
import {
  managerPlanPrompt,
  recipeDescription,
  TASK_KINDS,
  workerPrompt,
} from '../../../src/agent/workflow/prompts';
import { buildProblemSkeleton } from '../../../src/agent/workflow/recipes';
import type {
  ConfigPatch,
  Plan,
  TaskKind,
} from '../../../src/agent/workflow/types';

const ROOT = path.join(__dirname, '..', '..', '..');
const REAL_CLI = path.join(ROOT, 'dist', 'cli.js');
const TESTLIB = path.join(ROOT, 'corpus', 'vendor', 'testlib.h');
const CASE = path.join(ROOT, 'evals', 'cases', 'pairs-sum');
const FIXTURES = path.join(__dirname, 'fixtures', 'pairs-sum');

const hasGpp = spawnSync('g++', ['--version']).status === 0;
const canRun = hasGpp && fs.existsSync(REAL_CLI) && fs.existsSync(TESTLIB);
if (!canRun) {
  console.warn(
    'e2e build-problem skipped: it needs g++, corpus/vendor/testlib.h and dist/cli.js (run npm run build first)'
  );
}

/** Each test builds the whole problem and runs verify twice. */
const TEST_TIMEOUT_MS = 5 * 60 * 1000;

const SPEC = fs.readFileSync(path.join(CASE, 'spec.md'), 'utf8');

function reference(file: string): string {
  return fs.readFileSync(path.join(CASE, 'reference', file), 'utf8');
}

function fixture(file: string): string {
  return fs.readFileSync(path.join(FIXTURES, file), 'utf8');
}

const GOOD_VALIDATOR = reference('val.cpp');
/** The bug of evals/broken/validator-bound: n may be 0. */
const BROKEN_VALIDATOR = GOOD_VALIDATOR.replace(
  'inf.readInt(1, 200000, "n")',
  'inf.readInt(0, 200000, "n")'
);

/** The router: one MockProvider per role, picked from the request. */
class RoleRouter implements Provider {
  readonly id = 'e2e-router';
  /** Requests no script was found for. */
  readonly unrouted: string[] = [];
  private readonly planPrompt = managerPlanPrompt(
    'build_problem',
    recipeDescription('build_problem')
  );

  constructor(
    readonly chat: MockProvider,
    readonly manager: MockProvider,
    /** By task id, like `t4`. */
    readonly workers: Map<string, MockProvider>
  ) {}

  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent> {
    return this.pick(req).stream(req, signal);
  }

  private pick(req: ChatRequest): Provider {
    if (req.system === this.planPrompt) return this.manager;
    if (req.system.startsWith('You are a polyman worker.')) {
      const kind = TASK_KINDS.find(k => workerPrompt(k) === req.system);
      const first = req.messages[0]?.parts.find(p => p.type === 'text');
      const text = first?.type === 'text' ? first.text : '';
      const match = /Your task: (\S+), (\w+):/.exec(text);
      const worker = match ? this.workers.get(match[1]) : undefined;
      if (worker && kind !== undefined && match?.[2] === kind) return worker;
      this.unrouted.push(`worker ${match?.[1] ?? '?'} (${kind ?? '?'})`);
      throw new Error(`no worker script for ${match?.[1] ?? 'unknown task'}`);
    }
    if (req.system.startsWith('You are polyman, an assistant')) {
      return this.chat;
    }
    this.unrouted.push(req.system.split('\n')[0] ?? '');
    throw new Error('no script for this system prompt');
  }
}

/**
 * The real CLI, except `download-testlib`: it copies the vendored
 * testlib.h, so the test works offline.
 */
class OfflineRunner implements CliRunner {
  readonly commands: string[] = [];
  private readonly real = new NodeCliRunner({ cliPath: REAL_CLI });

  run(args: string[], opts: RunOptions): Promise<RunResult> {
    this.commands.push(args.join(' '));
    if (args[0] !== 'download-testlib') return this.real.run(args, opts);
    fs.copyFileSync(TESTLIB, path.join(opts.cwd, 'testlib.h'));
    return Promise.resolve({
      exitCode: 0,
      reason: 'exited',
      json: { ok: true, command: 'download-testlib' },
      stdoutTail: '',
      stderrTail: '',
      logPath: '',
      durationMs: 1,
    });
  }
}

/** A worker that writes its files, then calls finish_task. */
function writes(
  files: Record<string, string>,
  summary: string,
  configPatch?: ConfigPatch
): MockStep[] {
  return [
    {
      toolCalls: Object.entries(files).map(([p, content]) => ({
        name: 'write_file',
        args: { path: p, content },
      })),
    },
    {
      toolCall: {
        name: 'finish_task',
        args: configPatch ? { summary, configPatch } : { summary },
      },
    },
  ];
}

/** The worker scripts of the skeleton plan, by task id. */
function workerScripts(
  plan: Plan,
  validatorScript: MockStep[]
): Map<string, MockStep[]> {
  const scripts = new Map<string, MockStep[]>();
  const byKind = (kind: TaskKind) => plan.tasks.filter(t => t.kind === kind);

  scripts.set(
    byKind('statement')[0].id,
    writes(
      {
        'statements/english/legend.tex': fixture('statements/legend.tex'),
        'statements/english/input-format.tex': fixture(
          'statements/input-format.tex'
        ),
        'statements/english/output-format.tex': fixture(
          'statements/output-format.tex'
        ),
        'statements/english/notes.tex': fixture('statements/notes.tex'),
      },
      'wrote the statement',
      {
        statements: {
          english: {
            encoding: 'UTF-8',
            name: 'Pairs With Sum K',
            legend: './statements/english/legend.tex',
            input: './statements/english/input-format.tex',
            output: './statements/english/output-format.tex',
            notes: './statements/english/notes.tex',
          },
        },
      }
    )
  );
  scripts.set(byKind('statement_critic')[0].id, [
    { toolCall: { name: 'review', args: { ok: true, issues: [] } } },
  ]);
  scripts.set(
    byKind('main_solution')[0].id,
    writes({ 'solutions/main.cpp': reference('main.cpp') }, 'hash map, O(n)', {
      addSolutions: [
        { name: 'main', source: './solutions/main.cpp', tag: 'MA' },
      ],
    })
  );
  scripts.set(
    byKind('brute_force')[0].id,
    writes(
      { 'solutions/brute.cpp': reference('brute.cpp') },
      'every pair, O(n^2)',
      {
        addSolutions: [
          { name: 'brute', source: './solutions/brute.cpp', tag: 'TO' },
        ],
      }
    )
  );
  scripts.set(byKind('validator')[0].id, validatorScript);
  scripts.set(
    byKind('generators')[0].id,
    writes(
      {
        'generators/gen-random.cpp': fixture('gen-random.cpp'),
        'generators/gen-script.txt': fixture('gen-script.txt'),
      },
      'one generator and a script with the edge cases',
      {
        generators: [
          { name: 'gen-random', source: './generators/gen-random.cpp' },
        ],
        generatorScript: {
          testset: 'tests',
          scriptFile: './generators/gen-script.txt',
        },
      }
    )
  );

  // The skeleton numbers wrong solutions in spec order.
  const wrongSources = ['wa-int-overflow.cpp', 'wa-half-value.cpp'];
  const wrong = byKind('wrong_solution');
  expect(wrong).toHaveLength(wrongSources.length);
  wrong.forEach((task, i) => {
    const file = task.ownsFiles[0];
    const name = path.basename(file, '.cpp');
    scripts.set(
      task.id,
      writes({ [file]: reference(wrongSources[i]) }, `wrong: ${name}`, {
        addSolutions: [
          { name, source: `./${file}`, tag: task.params?.['tag'] as 'WA' },
        ],
      })
    );
  });
  return scripts;
}

const VALIDATOR_PATCH: ConfigPatch = {
  validator: {
    name: 'validator',
    source: './validator/val.cpp',
    testsFilePath: './validator/validator_tests.json',
  },
};

function validatorFiles(source: string): Record<string, string> {
  return {
    'validator/val.cpp': source,
    'validator/validator_tests.json': fixture('validator_tests.json'),
  };
}

let tmp: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pm-e2e-')));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Builds pairs-sum through the chat and returns what happened. */
async function buildPairsSum(validatorScript: MockStep[]): Promise<{
  problem: string;
  events: SeqEvent[];
  router: RoleRouter;
  runner: OfflineRunner;
  workers: Map<string, MockProvider>;
}> {
  const plan = buildProblemSkeleton(SPEC);
  const workers = new Map(
    [...workerScripts(plan, validatorScript)].map(([id, script]) => [
      id,
      new MockProvider(script, `worker-${id}`),
    ])
  );
  const chat = new MockProvider(
    [
      { toolCall: { name: 'create_problem', args: { name: 'pairs-sum' } } },
      { toolCall: { name: 'write_notes', args: { content: SPEC } } },
      {
        toolCall: {
          name: 'start_workflow',
          args: { recipe: 'build_problem' },
        },
      },
      { text: 'The problem is built and verify passed.' },
    ],
    'chat'
  );
  const manager = new MockProvider(
    [{ toolCall: { name: 'submit_plan', args: plan } }],
    'manager'
  );
  const router = new RoleRouter(chat, manager, workers);
  const runner = new OfflineRunner();

  const rt = createChatRuntime({
    dir: 'pairs-sum',
    cwd: tmp,
    provider: router,
    model: 'fake-gemma',
    runner,
  });
  const events: SeqEvent[] = [];
  rt.bus.on(e => {
    events.push(e);
    // The user says yes to every question, the plan included.
    if (e.type === 'approval_needed' || e.type === 'plan_approval_needed') {
      rt.gate.resolve(e.approvalId, { kind: 'allow_once' });
    }
  });

  expect(rt.problemDir()).toBeNull();
  expect(await rt.session.send('build pairs-sum')).toBe('done');

  const problem = path.join(tmp, 'pairs-sum');
  expect(rt.problemDir()).toBe(problem);
  expect(router.unrouted).toEqual([]);
  expect(chat.remaining).toBe(0);
  expect(manager.remaining).toBe(0);
  return { problem, events, router, runner, workers };
}

function ofType<T extends SeqEvent['type']>(
  events: SeqEvent[],
  type: T
): Extract<SeqEvent, { type: T }>[] {
  return events.filter(
    (e): e is Extract<SeqEvent, { type: T }> => e.type === type
  );
}

/** Checks the run passed, then runs the real verify once more. */
function expectBuilt(problem: string, events: SeqEvent[]): void {
  const done = ofType(events, 'workflow_done');
  expect(done).toHaveLength(1);
  expect(done[0].ok, done[0].summary).toBe(true);

  const results = ofType(events, 'task_done').map(e => e.result);
  const plan = ofType(events, 'plan_created')[0].plan;
  expect(results.map(r => r.taskId).sort()).toEqual(
    plan.tasks.map(t => t.id).sort()
  );
  for (const r of results) {
    expect(r.status, `${r.taskId}: ${r.checkpoint.digest}`).toBe('passed');
  }

  const workflow = ofType(events, 'tool_result').find(r =>
    r.summary.startsWith('build_problem')
  );
  expect(workflow?.ok).toBe(true);

  const config = JSON.parse(
    fs.readFileSync(path.join(problem, 'Config.json'), 'utf8')
  ) as {
    timeLimit: number;
    memoryLimit: number;
    checker: { name: string };
    solutions: { name: string; tag: string }[];
  };
  expect(config.timeLimit).toBe(1000);
  expect(config.memoryLimit).toBe(256);
  expect(config.checker.name).toBe('ncmp');
  expect(config.solutions.map(s => `${s.name}:${s.tag}`).sort()).toEqual([
    'brute:TO',
    'main:MA',
    'wa-1:WA',
    'wa-2:WA',
  ]);

  const verify = spawnSync(process.execPath, [REAL_CLI, 'verify', '--json'], {
    cwd: problem,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const report = JSON.parse(verify.stdout) as {
    ok: boolean;
    solutions: { name: string; matchesTag: boolean }[];
  };
  expect(report.ok, verify.stderr.slice(-2000)).toBe(true);
  expect(verify.status).toBe(0);
  expect(report.solutions.every(s => s.matchesTag)).toBe(true);
}

describe.skipIf(!canRun)('e2e: build pairs-sum with a fake Gemma', () => {
  it(
    'builds the problem and verify passes',
    async () => {
      const { problem, events, runner, workers } = await buildPairsSum(
        writes(
          validatorFiles(GOOD_VALIDATOR),
          'validator with self-tests',
          VALIDATOR_PATCH
        )
      );
      expectBuilt(problem, events);

      expect(runner.commands).toContain('new pairs-sum --json');
      expect(runner.commands).toContain('verify --json');
      expect(
        fs.readFileSync(path.join(problem, 'solutions', 'main.cpp'))
      ).toEqual(Buffer.from(reference('main.cpp')));
      expect(
        fs.readFileSync(
          path.join(problem, '.polyman', 'agent', 'notes.md'),
          'utf8'
        )
      ).toBe(SPEC);
      for (const [id, worker] of workers) {
        expect(worker.remaining, `worker ${id}`).toBe(0);
      }
      // Every worker task passed on its first attempt.
      expect(ofType(events, 'task_started').every(e => e.attempt === 1)).toBe(
        true
      );
    },
    TEST_TIMEOUT_MS
  );

  it(
    'sends a failed validator check back to the worker from finish_task',
    async () => {
      expect(BROKEN_VALIDATOR).not.toBe(GOOD_VALIDATOR);
      const { problem, events, workers } = await buildPairsSum([
        ...writes(
          validatorFiles(BROKEN_VALIDATOR),
          'validator with self-tests',
          VALIDATOR_PATCH
        ),
        // finish_task ran the real check, it failed, the same session goes on.
        ...writes(
          { 'validator/val.cpp': GOOD_VALIDATOR },
          'n starts at 1 now',
          VALIDATOR_PATCH
        ),
      ]);
      expectBuilt(problem, events);

      const plan = buildProblemSkeleton(SPEC);
      const validatorId = plan.tasks.find(t => t.kind === 'validator')!.id;
      const started = ofType(events, 'task_started').filter(
        e => e.taskId === validatorId
      );
      expect(started.map(e => e.attempt)).toEqual([1]);
      const checks = ofType(events, 'task_checkpoint').filter(
        e => e.taskId === validatorId
      );
      expect(checks.map(c => [c.name, c.ok])).toEqual([
        ['test validator', true],
      ]);
      const done = ofType(events, 'task_done').find(
        e => e.taskId === validatorId
      )!;
      expect(done.result).toMatchObject({ status: 'passed', attempts: 1 });

      // The worker saw the failed check as the result of its finish_task.
      const worker = workers.get(validatorId)!;
      expect(worker.remaining).toBe(0);
      const retry = worker.requests[2];
      const last = JSON.stringify(
        retry.messages[retry.messages.length - 1].parts
      );
      expect(last).toMatch(/expected INVALID got VALID/);
      expect(last).toContain('call finish_task again');
      expect(
        fs.readFileSync(path.join(problem, 'validator', 'val.cpp'), 'utf8')
      ).toBe(GOOD_VALIDATOR);
    },
    TEST_TIMEOUT_MS
  );
});
