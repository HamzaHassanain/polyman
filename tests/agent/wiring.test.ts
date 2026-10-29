import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SeqEvent } from '../../src/agent/core/events';
import {
  createChatRuntime,
  resolveChatStart,
  type ChatRuntimeOptions,
} from '../../src/agent/index';
import { parseAnswer, planLines, runPlain } from '../../src/agent/plain';
import { MockProvider, type MockStep } from '../../src/agent/providers/mock';
import {
  Capabilities,
  chatOnlyNotice,
} from '../../src/agent/providers/capabilities';
import {
  DEFAULT_BUDGETS,
  budgetsFor,
} from '../../src/agent/providers/chat-provider';
import { ProviderError } from '../../src/agent/providers/types';
import type { CliRunner, RunResult } from '../../src/agent/runner/types';
import {
  NO_SPEC_ERROR,
  proofReport,
  specIsReady,
  type WorkflowRunner,
} from '../../src/agent/tools/workflow-tool';
import type { Plan } from '../../src/agent/workflow/types';

/** Only the sections every recipe needs. */
const MINIMAL_SPEC = [
  '# Idea',
  'Count pairs i < j with a_i + a_j = k.',
  '',
  '# Constraints',
  '- 1 <= n <= 200000',
  '',
  '# Samples',
  '## Input 1',
  '```',
  '4 6',
  '1 5 3 3',
  '```',
  '## Output 1',
  '```',
  '2',
  '```',
].join('\n');

/** A whole spec, ready for build_problem. */
const SPEC = [
  MINIMAL_SPEC,
  '',
  '# Input',
  'n and k, then n integers.',
  '',
  '# Output',
  'The number of pairs.',
  '',
  '# Intended solution',
  'Hash map, O(n), 64-bit answer.',
  '',
  '# Wrong approaches',
  '- answer in int -> WA',
  '- brute force O(n^2) -> TL',
  '',
  '# Edge cases',
  '- n = 1',
].join('\n');

const PLAN: Plan = {
  recipe: 'build_problem',
  tasks: [
    {
      id: 't1',
      kind: 'scaffold',
      title: 'Scaffold',
      dependsOn: [],
      brief: 'make the files',
      ownsFiles: [],
    },
    {
      id: 't2',
      kind: 'main_solution',
      title: 'Main solution',
      dependsOn: ['t1'],
      brief: 'hash map',
      ownsFiles: ['solutions/main.cpp'],
    },
  ],
};

let tmp: string;
let problem: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'w0b-')));
  problem = path.join(tmp, 'pairs-sum');
  fs.mkdirSync(problem);
  fs.writeFileSync(path.join(problem, 'Config.json'), '{"name":"pairs-sum"}');
  fs.writeFileSync(path.join(problem, 'a.txt'), 'hello\n');
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function result(over: Partial<RunResult> = {}): RunResult {
  return {
    exitCode: 0,
    reason: 'exited',
    stdoutTail: '',
    stderrTail: '',
    logPath: '',
    durationMs: 1,
    ...over,
  };
}

/** A runner that plays `polyman new` and `download-testlib`. */
class FakeRunner implements CliRunner {
  readonly calls: { args: string[]; cwd: string }[] = [];

  run(args: string[], opts: { cwd: string }): Promise<RunResult> {
    this.calls.push({ args, cwd: opts.cwd });
    if (args[0] === 'new' && args[1] !== undefined) {
      const dir = path.join(opts.cwd, args[1]);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'Config.json'), '{}');
      return Promise.resolve(result({ json: { path: dir } }));
    }
    return Promise.resolve(result({ json: {} }));
  }
}

function build(
  script: MockStep[],
  over: Partial<ChatRuntimeOptions> = {}
): {
  rt: ReturnType<typeof createChatRuntime>;
  provider: MockProvider;
  events: SeqEvent[];
} {
  const provider = new MockProvider(script);
  const rt = createChatRuntime({
    dir: problem,
    provider,
    model: 'mock-model',
    runner: new FakeRunner(),
    ...over,
  });
  const events: SeqEvent[] = [];
  rt.bus.on(e => events.push(e));
  return { rt, provider, events };
}

/** Allows every approval, as a user pressing y. */
function allowAll(rt: ReturnType<typeof createChatRuntime>): void {
  rt.bus.on(e => {
    if (e.type === 'approval_needed' || e.type === 'plan_approval_needed') {
      rt.gate.resolve(e.approvalId, { kind: 'allow_once' });
    }
  });
}

function toolResults(
  events: SeqEvent[]
): Extract<SeqEvent, { type: 'tool_result' }>[] {
  return events.filter(
    (e): e is Extract<SeqEvent, { type: 'tool_result' }> =>
      e.type === 'tool_result'
  );
}

function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('resolveChatStart', () => {
  it('uses a folder with Config.json as the problem, new ones go next to it', () => {
    expect(resolveChatStart(problem)).toEqual({
      problemDir: problem,
      startDir: path.dirname(problem),
    });
  });

  it('starts a new problem next to a folder that does not exist', () => {
    expect(resolveChatStart('new-one', tmp)).toEqual({
      problemDir: null,
      startDir: tmp,
      suggestedName: 'new-one',
    });
  });

  it('makes new problems inside an existing folder without Config.json', () => {
    expect(resolveChatStart(undefined, tmp)).toEqual({
      problemDir: null,
      startDir: tmp,
    });
    expect(resolveChatStart(tmp)).toEqual({ problemDir: null, startDir: tmp });
  });
});

describe('createChatRuntime', () => {
  it('runs a scripted list_files turn and gives a tool_result', async () => {
    const { rt, provider, events } = build([
      { toolCall: { name: 'list_files', args: {} } },
      { text: 'There is a.txt.' },
    ]);
    expect(await rt.session.send('what is here?')).toBe('done');

    const [res] = toolResults(events);
    expect(res?.ok).toBe(true);
    const tool = rt.session.messages.find(m => m.role === 'tool');
    expect(JSON.stringify(tool?.parts)).toContain('a.txt');

    const req = provider.requests[0];
    const names = req?.tools?.map(t => t.name) ?? [];
    for (const name of [
      'list_files',
      'create_problem',
      'load_skill',
      'read_notes',
      'write_notes',
      'start_workflow',
      'find_ideas',
    ]) {
      expect(names).toContain(name);
    }
    expect(req?.model).toBe('mock-model');
    expect(req?.system).toContain(`Problem: ${problem}`);
  });

  it('start_workflow without a spec gives the spec error', async () => {
    let built = 0;
    const { rt, events } = build(
      [
        {
          toolCall: {
            name: 'start_workflow',
            args: { recipe: 'build_problem' },
          },
        },
        { text: 'I need the spec first.' },
      ],
      {
        createScheduler: () => {
          built += 1;
          throw new Error('not used');
        },
      }
    );
    allowAll(rt);
    expect(await rt.session.send('build it')).toBe('done');

    const [res] = toolResults(events);
    expect(res).toMatchObject({ ok: false });
    expect(res?.summary).toMatch(
      new RegExp(`^${escapeRe(NO_SPEC_ERROR)} \\(\\+\\d+ lines\\)$`)
    );
    expect(built).toBe(0);
  });

  it('start_workflow runs the scheduler with the spec and the recipe', async () => {
    fs.mkdirSync(path.join(problem, '.polyman', 'agent'), { recursive: true });
    fs.writeFileSync(path.join(problem, '.polyman', 'agent', 'notes.md'), SPEC);
    const seen: { dir: string; spec: string; recipe: string }[] = [];
    const { rt, events } = build(
      [
        {
          toolCall: {
            name: 'start_workflow',
            args: { recipe: 'build_problem' },
          },
        },
        { text: 'Done.' },
      ],
      {
        createScheduler: (dir): WorkflowRunner => ({
          run: (spec, recipe) => {
            seen.push({ dir, spec, recipe });
            return Promise.resolve({
              ok: true,
              results: [],
              summary: 'all 2 tasks passed\nverify OK',
            });
          },
        }),
      }
    );
    allowAll(rt);
    await rt.session.send('build it');

    expect(seen).toEqual([
      { dir: problem, spec: SPEC, recipe: 'build_problem' },
    ]);
    expect(toolResults(events)[0]).toMatchObject({
      ok: true,
      summary: 'all 2 tasks passed (+2 lines)',
      data: [],
    });
  });

  it('start_workflow asks only for the plan and puts the mode back after', async () => {
    fs.mkdirSync(path.join(problem, '.polyman', 'agent'), { recursive: true });
    fs.writeFileSync(path.join(problem, '.polyman', 'agent', 'notes.md'), SPEC);
    const modes: string[] = [];
    const { rt, events } = build(
      [
        {
          toolCall: {
            name: 'start_workflow',
            args: { recipe: 'build_problem' },
          },
        },
        { text: 'Done.' },
      ],
      {
        createScheduler: (): WorkflowRunner => ({
          run: async (_spec, _recipe, signal) => {
            await rt.gate.askPlan(PLAN, signal);
            modes.push(rt.gate.mode);
            return { ok: true, results: [], summary: 'all passed' };
          },
        }),
      }
    );
    allowAll(rt);
    expect(rt.gate.mode).toBe('ask');
    await rt.session.send('build it');

    expect(events.filter(e => e.type === 'approval_needed')).toHaveLength(0);
    expect(events.filter(e => e.type === 'plan_approval_needed')).toHaveLength(
      1
    );
    expect(modes).toEqual(['plan-approved']);
    expect(rt.gate.mode).toBe('ask');
    const tool = rt.session.messages.find(m => m.role === 'tool');
    expect(JSON.stringify(tool?.parts)).toContain('The workflow is over.');
  });

  it('puts the mode back when the workflow throws', async () => {
    fs.mkdirSync(path.join(problem, '.polyman', 'agent'), { recursive: true });
    fs.writeFileSync(path.join(problem, '.polyman', 'agent', 'notes.md'), SPEC);
    const { rt, events } = build(
      [
        {
          toolCall: {
            name: 'start_workflow',
            args: { recipe: 'build_problem' },
          },
        },
        { text: 'It broke.' },
      ],
      {
        createScheduler: (): WorkflowRunner => ({
          run: async (_spec, _recipe, signal) => {
            await rt.gate.askPlan(PLAN, signal);
            throw new Error('boom');
          },
        }),
      }
    );
    allowAll(rt);
    rt.gate.setMode('auto-edit');
    await rt.session.send('build it');

    expect(toolResults(events)[0]?.ok).toBe(false);
    expect(rt.gate.mode).toBe('auto-edit');
  });

  it('build_problem needs the whole spec, fix_verify only the core', async () => {
    fs.mkdirSync(path.join(problem, '.polyman', 'agent'), { recursive: true });
    fs.writeFileSync(
      path.join(problem, '.polyman', 'agent', 'notes.md'),
      MINIMAL_SPEC
    );
    const recipes: string[] = [];
    const { rt, events } = build(
      [
        {
          toolCall: {
            name: 'start_workflow',
            args: { recipe: 'build_problem' },
          },
        },
        {
          toolCall: { name: 'start_workflow', args: { recipe: 'fix_verify' } },
        },
        { text: 'ok' },
      ],
      {
        createScheduler: (): WorkflowRunner => ({
          run: (_spec, recipe) => {
            recipes.push(recipe);
            return Promise.resolve({ ok: true, results: [], summary: 'ok' });
          },
        }),
      }
    );
    allowAll(rt);
    await rt.session.send('build it');

    const [built, fixed] = toolResults(events);
    expect(built).toMatchObject({ ok: false });
    expect(built?.summary.startsWith(`${NO_SPEC_ERROR} (+`)).toBe(true);
    const first = rt.session.messages.find(m => m.role === 'tool');
    expect(JSON.stringify(first?.parts)).toContain(
      'missing or empty section \\"# Intended solution\\"'
    );
    expect(fixed?.ok).toBe(true);
    expect(recipes).toEqual(['fix_verify']);
  });

  it('keeps notes in memory and writes them when create_problem makes the folder', async () => {
    const runner = new FakeRunner();
    const { rt, provider, events } = build(
      [
        { toolCall: { name: 'write_notes', args: { content: SPEC } } },
        { toolCall: { name: 'create_problem', args: { name: 'new-one' } } },
        { toolCall: { name: 'read_notes', args: {} } },
        { text: 'Created.' },
      ],
      { dir: 'new-one', cwd: tmp, runner }
    );
    allowAll(rt);
    expect(rt.problemDir()).toBeNull();
    expect(await rt.session.send('make it')).toBe('done');

    const created = path.join(tmp, 'new-one');
    expect(runner.calls[0]).toEqual({
      args: ['new', 'new-one', '--json'],
      cwd: tmp,
    });
    expect(rt.problemDir()).toBe(created);
    expect(
      fs.readFileSync(
        path.join(created, '.polyman', 'agent', 'notes.md'),
        'utf8'
      )
    ).toBe(SPEC);
    expect(events.some(e => e.type === 'problem_dir_changed')).toBe(true);
    expect(events.some(e => e.type === 'notes_updated')).toBe(true);
    expect(toolResults(events).map(r => r.ok)).toEqual([true, true, true]);
    expect(provider.requests[0]?.system).toContain('"new-one"');
    expect(provider.requests[1]?.system).toContain('Count pairs');
  });
});

describe('create_problem from an open problem', () => {
  it('makes the new problem next to the open one, not inside it', async () => {
    const runner = new FakeRunner();
    const { rt } = build(
      [
        { toolCall: { name: 'create_problem', args: { name: 'other' } } },
        { text: 'Created.' },
      ],
      { dir: problem, runner }
    );
    allowAll(rt);
    expect(rt.problemDir()).toBe(problem);
    expect(await rt.session.send('a new problem please')).toBe('done');

    const parent = path.dirname(problem);
    expect(runner.calls[0]).toEqual({
      args: ['new', 'other', '--json'],
      cwd: parent,
    });
    expect(rt.problemDir()).toBe(path.join(parent, 'other'));
  });
});

describe('specIsReady', () => {
  it('needs Idea, Constraints and Samples', () => {
    expect(specIsReady(MINIMAL_SPEC)).toBe(true);
    expect(specIsReady('')).toBe(false);
    expect(specIsReady('# Idea\nx\n# Constraints\n- n\n# Samples\n')).toBe(
      false
    );
  });
});

describe('proofReport', () => {
  it('lists each task with its icon and digest, for the model', () => {
    const report = proofReport([
      {
        taskId: 'stress',
        status: 'failed',
        attempts: 1,
        summary: 'failed after 1 attempt: small test 4',
        checkpoint: {
          name: 'stress',
          ok: false,
          digest: 'small test 4: brute says 2, main says 1\ninput:\n  2 3',
        },
      },
      {
        taskId: 'samples',
        status: 'passed',
        attempts: 1,
        summary: 'ok',
        checkpoint: {
          name: 'samples',
          ok: true,
          digest: '2 samples: spec = brute = main',
        },
      },
      {
        taskId: 'kill-1',
        status: 'skipped',
        attempts: 0,
        summary: 'blocked by stress',
        checkpoint: { name: 'skipped', ok: false, digest: 'blocked by stress' },
      },
    ]);
    expect(report).toBe(
      [
        '✗ stress: small test 4: brute says 2, main says 1',
        '    input:',
        '      2 3',
        '✔ samples: 2 samples: spec = brute = main',
        '- kill-1: blocked by stress',
      ].join('\n')
    );
  });
});

describe('chat tool progress', () => {
  it('keeps the chat call id when a worker tool call comes between', async () => {
    let bus: { emit: ReturnType<typeof createChatRuntime>['bus']['emit'] } = {
      emit: () => {},
    };
    const runner: CliRunner = {
      run(_args, opts) {
        bus.emit({
          type: 'tool_call',
          callId: 'w1',
          name: 'read_file',
          args: {},
          risk: 'read',
          taskId: 't4',
        });
        opts.onLine?.('generating tests');
        return Promise.resolve(result({ json: {} }));
      },
    };
    const { rt, events } = build(
      [{ toolCall: { name: 'verify', args: {} } }, { text: 'Done.' }],
      { runner }
    );
    bus = rt.bus;
    allowAll(rt);
    await rt.session.send('verify it');
    const chatCall = events.find(
      e => e.type === 'tool_call' && e.name === 'verify'
    );
    const progress = events.find(e => e.type === 'tool_progress');
    expect(chatCall).toBeDefined();
    expect(progress).toMatchObject({
      type: 'tool_progress',
      callId: chatCall?.type === 'tool_call' ? chatCall.callId : '',
      line: 'generating tests',
    });
  });
});

/** Runs the plain chat over fake stdin and stdout. */
async function plain(
  rt: ReturnType<typeof createChatRuntime>,
  lines: string[]
): Promise<string> {
  const input = new PassThrough();
  const output = new PassThrough();
  let text = '';
  output.on('data', (chunk: Buffer) => {
    text += chunk.toString();
  });
  const done = runPlain(rt.session, rt.bus, {
    problem: rt.problemDir(),
    model: 'mock-model',
    input,
    output,
  });
  input.end(lines.map(l => `${l}\n`).join(''));
  await done;
  return text;
}

describe('Polygon tools in the chat', () => {
  it('registers them and redacts the Polygon key and secret', async () => {
    const key = 'a'.repeat(40);
    const secret = 'b'.repeat(40);
    fs.writeFileSync(
      path.join(problem, 'Config.json'),
      '{"name":"pairs-sum","problemId":12345}'
    );
    const runner: CliRunner = {
      run: () =>
        Promise.resolve(
          result({
            json: {
              ok: true,
              problemId: 12345,
              actions: [],
              errors: [],
              warnings: [],
            },
            stderrTail: `signed with ${key} and ${secret}\n`,
          })
        ),
    };
    const { rt, provider } = build(
      [{ toolCall: { name: 'remote_view', args: {} } }, { text: 'Done.' }],
      { runner, polygonCredentials: () => ({ apiKey: key, secret }) }
    );
    expect(await rt.session.send('show it on polygon')).toBe('done');

    const names = provider.requests[0]?.tools?.map(t => t.name) ?? [];
    for (const name of [
      'remote_push',
      'remote_commit',
      'remote_package',
      'remote_view',
    ]) {
      expect(names).toContain(name);
    }
    const tool = rt.session.messages.find(m => m.role === 'tool');
    const text = JSON.stringify(tool?.parts);
    expect(text).toContain('Polygon problem 12345');
    expect(text).not.toContain(key);
    expect(text).not.toContain(secret);
  });
});

describe('the chat with model-aware budgets and capabilities', () => {
  it('sends the budgets it was given', async () => {
    const { rt, provider } = build([{ text: 'hi' }], {
      budgets: budgetsFor({ contextWindow: 8192, maxOutput: 8192 }),
    });
    expect(await rt.session.send('hi')).toBe('done');
    expect(provider.requests[0]?.maxOutputTokens).toBe(2048);
  });

  it('uses the default budgets without any', async () => {
    const { rt, provider } = build([{ text: 'hi' }]);
    await rt.session.send('hi');
    expect(provider.requests[0]?.maxOutputTokens).toBe(
      DEFAULT_BUDGETS.maxOutputTokens
    );
    expect(provider.requests[0]?.temperature).toBe(DEFAULT_BUDGETS.temperature);
  });

  it('runs a model with no tools in chat-only mode and prints the notice', async () => {
    const capabilities = new Capabilities(
      {},
      {
        'openrouter/google/gemma-3-4b-it': {
          id: 'google/gemma-3-4b-it',
          supportsTools: false,
        },
      }
    );
    const { rt, provider } = build([{ text: 'I can only chat.' }], {
      providerId: 'openrouter',
      model: 'google/gemma-3-4b-it',
      capabilities,
    });
    const out = await plain(rt, ['build pairs sum']);
    expect(provider.requests[0]?.tools).toEqual([]);
    expect(out).toContain(
      `[warn: ${chatOnlyNotice('openrouter', 'google/gemma-3-4b-it')}]`
    );
    expect(out).toContain('I can only chat.');
  });

  it('goes chat-only after tools_not_supported instead of failing', async () => {
    const { rt, provider, events } = build([
      { error: new ProviderError('tools_not_supported', 'no tool use') },
      { text: 'Talking only.' },
    ]);
    expect(await rt.session.send('hi')).toBe('done');
    expect(provider.requests[1]?.tools).toEqual([]);
    expect(events.filter(e => e.type === 'notice')).toHaveLength(1);
  });
});

describe('runPlain', () => {
  it('sends a message, asks the approval, prints each event as a line', async () => {
    const { rt } = build([
      { toolCall: { name: 'write_notes', args: { content: SPEC } } },
      { text: 'Saved the spec.', usage: { inputTokens: 10, outputTokens: 3 } },
    ]);
    const out = await plain(rt, ['write the spec', 'y']);
    const lines = out.split('\n');

    expect(lines).toContain('you> write the spec');
    expect(lines.some(l => l.startsWith('> write_notes({"content":'))).toBe(
      true
    );
    expect(lines).toContain(
      'Allow Write the notes (.polyman/agent/notes.md)? [y/N/a(lways)]'
    );
    expect(lines).toContain(
      '  = Saved the notes (32 lines) to .polyman/agent/notes.md.'
    );
    expect(lines).toContain('Saved the spec.');
    expect(lines).toContain('[10 in / 3 out tokens]');
    expect(
      fs.readFileSync(
        path.join(problem, '.polyman', 'agent', 'notes.md'),
        'utf8'
      )
    ).toBe(SPEC);
  });

  it('does not send a pasted Polygon key to the model', async () => {
    const { rt, provider } = build([{ text: 'Hi.' }]);
    const key = 'a'.repeat(40);
    const secret = 'b'.repeat(40);
    const out = await plain(rt, [
      `My API key is ${key} and my secret is ${secret}`,
      'hello',
    ]);
    expect(out).toContain('That looks like a Polygon key.');
    expect(out).not.toContain(key);
    expect(out).not.toContain(secret);
    expect(provider.requests).toHaveLength(1);
    expect(JSON.stringify(provider.requests)).not.toContain(key);
    expect(out).toContain('you> hello');
  });

  it('denies when the user says no', async () => {
    const { rt } = build([
      { toolCall: { name: 'write_notes', args: { content: SPEC } } },
      { text: 'ok, not saved.' },
    ]);
    const out = await plain(rt, ['write the spec', 'n']);
    expect(out).toContain('  = The user denied this: the user said no');
    expect(fs.existsSync(path.join(problem, '.polyman'))).toBe(false);
  });

  it('shows the plan and asks to run it', async () => {
    fs.mkdirSync(path.join(problem, '.polyman', 'agent'), { recursive: true });
    fs.writeFileSync(path.join(problem, '.polyman', 'agent', 'notes.md'), SPEC);
    let decision = '';
    const { rt } = build(
      [
        {
          toolCall: {
            name: 'start_workflow',
            args: { recipe: 'build_problem' },
          },
        },
        { text: 'Built.' },
      ],
      {
        createScheduler: (): WorkflowRunner => ({
          run: async (_spec, _recipe, signal) => {
            rt.bus.emit({ type: 'plan_created', plan: PLAN });
            decision = (await rt.gate.askPlan(PLAN, signal)).kind;
            rt.bus.emit({ type: 'task_started', taskId: 't2', attempt: 2 });
            rt.bus.emit({
              type: 'task_checkpoint',
              taskId: 't2',
              name: 'samples',
              ok: false,
              digest: 'sample 1: expected 2, got 1\nmore',
            });
            return { ok: true, results: [], summary: 'all passed' };
          },
        }),
      }
    );
    // start_workflow itself is not asked, only the plan.
    const out = await plain(rt, ['build it', 'y']);
    const lines = out.split('\n');

    expect(decision).toBe('allow_once');
    expect(lines).toContain('Plan (build_problem, 2 tasks):');
    expect(lines).toContain('  1. [t1] Scaffold');
    expect(lines).toContain('  2. [t2] Main solution (after t1)');
    expect(lines).toContain('Run this plan? [y/N]');
    expect(lines).toContain(
      '[task t2] attempt 2: checkpoint failed: sample 1: expected 2, got 1'
    );
    expect(lines.some(l => l.startsWith('  = all passed'))).toBe(true);
  });

  it('prints the tool calls of workflow workers with their task id', async () => {
    fs.mkdirSync(path.join(problem, '.polyman', 'agent'), { recursive: true });
    fs.writeFileSync(path.join(problem, '.polyman', 'agent', 'notes.md'), SPEC);
    const { rt } = build(
      [
        {
          toolCall: {
            name: 'start_workflow',
            args: { recipe: 'build_problem' },
          },
        },
        { text: 'Built.' },
      ],
      {
        createScheduler: (): WorkflowRunner => ({
          run: async (_spec, _recipe, signal) => {
            rt.bus.emit({ type: 'plan_created', plan: PLAN });
            await rt.gate.askPlan(PLAN, signal);
            rt.bus.emit({
              type: 'tool_call',
              callId: 'w1',
              name: 'run_solution',
              args: { name: 'main' },
              risk: 'run',
              taskId: 't4',
            });
            rt.bus.emit({
              type: 'tool_progress',
              callId: 'w1',
              line: 'compiling',
              taskId: 't4',
            });
            rt.bus.emit({
              type: 'tool_result',
              callId: 'w1',
              ok: false,
              summary: `WA on sample 1 ${'x'.repeat(200)}\nsecond line`,
              taskId: 't4',
            });
            rt.bus.emit({
              type: 'tool_result',
              callId: 'w2',
              ok: true,
              summary: '3 of 3 samples ok',
              taskId: 't4',
            });
            return { ok: true, results: [], summary: 'all passed' };
          },
        }),
      }
    );
    const out = await plain(rt, ['build it', 'y']);
    const lines = out.split('\n');

    expect(lines).toContain('  [t4] > run_solution({"name":"main"})');
    expect(lines).toContain('  [t4]   = 3 of 3 samples ok');
    const failed = lines.find(l => l.startsWith('  [t4]   = error: WA'));
    expect(failed).toBeDefined();
    expect(failed?.endsWith('...')).toBe(true);
    expect(out).not.toContain('second line');
    expect(out).not.toContain('compiling');
    // The chat's own call stays a normal line.
    expect(lines.some(l => l.startsWith('> start_workflow('))).toBe(true);
  });

  it('denies a waiting approval when the input ends', async () => {
    const { rt } = build([
      { toolCall: { name: 'write_notes', args: { content: SPEC } } },
      { text: 'ok.' },
    ]);
    const out = await plain(rt, ['write the spec']);
    expect(out).toContain('(no answer, end of input: denied)');
    expect(out).toContain('  = The user denied this: no answer');
  });
});

describe('parseAnswer and planLines', () => {
  it('reads y, a and the rest', () => {
    expect(parseAnswer('Y', 'tool')).toEqual({ kind: 'allow_once' });
    expect(parseAnswer('a', 'tool')).toEqual({ kind: 'allow_session' });
    expect(parseAnswer('a', 'plan').kind).toBe('deny');
    expect(parseAnswer('', 'tool')).toEqual({
      kind: 'deny',
      reason: 'the user said no',
    });
    expect(parseAnswer('use ncmp', 'tool')).toEqual({
      kind: 'deny',
      reason: 'use ncmp',
    });
  });

  it('numbers the plan tasks', () => {
    expect(planLines(PLAN)).toHaveLength(3);
  });
});
