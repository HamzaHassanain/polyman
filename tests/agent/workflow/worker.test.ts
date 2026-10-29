import { describe, it, expect } from 'vitest';
import { randomUUID } from 'crypto';
import { MockProvider, type MockStep } from '../../../src/agent/providers/mock';
import {
  ModelWorker,
  MAX_PRECHECKS,
  STEP_LIMIT_SUMMARY,
  checkpointPrecheck,
  configPatchSchema,
  workerToolNames,
  type ModelWorkerOptions,
  type WorkerPrecheck,
} from '../../../src/agent/workflow/worker';
import { workerPrompt } from '../../../src/agent/workflow/prompts';
import type {
  AgentEvent,
  EventBus,
  SeqEvent,
} from '../../../src/agent/core/events';
import type { Message } from '../../../src/agent/core/messages';
import type {
  AgentSessionApi,
  AgentSessionDeps,
} from '../../../src/agent/core/session-types';
import type {
  PermissionGate,
  PermissionMode,
  Sandbox,
  Tool,
  ToolCall,
  ToolContext,
  ToolOutput,
  ToolRegistry,
} from '../../../src/agent/tools/types';
import type { CliRunner } from '../../../src/agent/runner/types';
import type {
  Checkpoint,
  Checkpoints,
  PlanTask,
  TaskKind,
} from '../../../src/agent/workflow/types';

// ---- fakes through the contracts -------------------------------------------

function msg(role: Message['role'], parts: Message['parts']): Message {
  return { id: randomUUID(), role, parts, createdAt: new Date().toISOString() };
}

/** A tiny session loop, enough to drive the worker like W2's AgentSession. */
class FakeSession implements AgentSessionApi {
  readonly messages: Message[] = [];
  readonly sent: string[] = [];
  private ac: AbortController | null = null;

  constructor(readonly deps: AgentSessionDeps) {}

  async send(
    text: string
  ): Promise<'done' | 'cancelled' | 'max_steps' | 'error'> {
    const { deps } = this;
    this.ac = new AbortController();
    const signal = this.ac.signal;
    const turnId = randomUUID();
    this.sent.push(text);
    deps.bus.emit({ type: 'turn_start', turnId });
    this.messages.push(msg('user', [{ type: 'text', text }]));
    try {
      for (let step = 0; step < deps.maxSteps; step++) {
        const system = await deps.buildSystemPrompt();
        let answer = '';
        const calls: ToolCall[] = [];
        for await (const ev of deps.provider.stream(
          {
            model: deps.model,
            system,
            messages: [...this.messages],
            tools: deps.tools.specs(),
          },
          signal
        )) {
          if (ev.type === 'text_delta') {
            answer += ev.text;
            deps.bus.emit({ type: 'text_delta', text: ev.text });
          } else if (ev.type === 'tool_call') {
            calls.push({ id: ev.id, name: ev.name, args: ev.args });
          } else if (ev.type === 'usage') {
            const u: AgentEvent = {
              type: 'usage',
              inputTokens: ev.inputTokens,
              outputTokens: ev.outputTokens,
            };
            if (ev.costUsd !== undefined) u.costUsd = ev.costUsd;
            deps.bus.emit(u);
          }
        }
        this.messages.push(
          msg('assistant', [
            ...(answer ? [{ type: 'text' as const, text: answer }] : []),
            ...calls.map(c => ({
              type: 'tool_call' as const,
              id: c.id,
              name: c.name,
              args: c.args,
            })),
          ])
        );
        if (calls.length === 0) {
          deps.bus.emit({ type: 'turn_end', turnId, reason: 'done' });
          return 'done';
        }
        for (const call of calls) {
          signal.throwIfAborted();
          deps.bus.emit({
            type: 'tool_call',
            callId: call.id,
            name: call.name,
            args: call.args,
            risk: deps.tools.riskOf(call.name) ?? 'read',
          });
          const out = await deps.tools.run(call, deps.makeToolContext(signal));
          deps.bus.emit({
            type: 'tool_result',
            callId: call.id,
            ok: !out.isError,
            summary: out.content.split('\n')[0] ?? '',
          });
          this.messages.push(
            msg('tool', [
              {
                type: 'tool_result',
                callId: call.id,
                content: out.content,
                isError: out.isError ?? false,
              },
            ])
          );
        }
      }
      deps.bus.emit({ type: 'turn_end', turnId, reason: 'max_steps' });
      return 'max_steps';
    } catch (err) {
      if (signal.aborted) {
        deps.bus.emit({ type: 'turn_end', turnId, reason: 'cancelled' });
        return 'cancelled';
      }
      deps.bus.emit({
        type: 'turn_end',
        turnId,
        reason: 'error',
        error: (err as Error).message,
      });
      return 'error';
    }
  }

  cancel(): void {
    this.ac?.abort();
  }

  resolveApproval(): void {}
}

class FakeRegistry implements ToolRegistry {
  readonly tools = new Map<string, Tool>();
  constructor(readonly permissions: PermissionGate) {}
  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }
  specs() {
    return [...this.tools.values()].map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }
  riskOf(name: string) {
    return this.tools.get(name)?.risk;
  }
  async run(call: ToolCall, ctx: ToolContext): Promise<ToolOutput> {
    const tool = this.tools.get(call.name);
    if (!tool) return { content: `Unknown tool "${call.name}"`, isError: true };
    try {
      return await tool.run(call.args, ctx);
    } catch (err) {
      return { content: (err as Error).message, isError: true };
    }
  }
}

function fakeGate(mode: PermissionMode): PermissionGate {
  return {
    mode,
    setMode(m) {
      this.mode = m;
    },
    check: () => Promise.resolve({ allowed: true }),
    askPlan: () => Promise.resolve({ kind: 'allow_once' }),
    resolve: () => {},
  };
}

function fakeTool(name: string, risk: Tool['risk'] = 'read'): Tool {
  return {
    name,
    description: `fake ${name}`,
    parameters: { type: 'object', properties: {} },
    risk,
    needsProblem: true,
    run: (args: unknown) =>
      Promise.resolve(
        name === 'write_file' && (args as { path?: string }).path === 'bad.cpp'
          ? { content: 'refused', isError: true }
          : { content: `${name} ok` }
      ),
  };
}

const POOL: Tool[] = [
  fakeTool('read_file'),
  fakeTool('list_files'),
  fakeTool('write_file', 'write'),
  fakeTool('edit_file', 'write'),
  fakeTool('run_solution', 'run'),
  fakeTool('test_target', 'run'),
  fakeTool('generate', 'run'),
  fakeTool('verify', 'run'),
  fakeTool('create_problem', 'write'),
];

function recordingBus(): EventBus & { events: AgentEvent[] } {
  const events: AgentEvent[] = [];
  const listeners: ((e: SeqEvent) => void)[] = [];
  return {
    events,
    emit(e) {
      events.push(e);
      listeners.forEach(l => l({ ...e, seq: events.length }));
    },
    on(fn) {
      listeners.push(fn);
      return () => {};
    },
  };
}

function setup(script: MockStep[], extra: Partial<ModelWorkerOptions> = {}) {
  const provider = new MockProvider(script);
  const bus = recordingBus();
  const sessions: FakeSession[] = [];
  const registries: FakeRegistry[] = [];
  const sandboxes: { root: string; allowWrite: string[] }[] = [];
  const gates: PermissionGate[] = [];
  const worker = new ModelWorker({
    provider,
    model: 'gemma',
    problemDir: '/x/pairs',
    runner: {} as CliRunner,
    bus,
    tools: POOL,
    createSession: deps => {
      const s = new FakeSession(deps);
      sessions.push(s);
      return s;
    },
    createRegistry: permissions => {
      const r = new FakeRegistry(permissions);
      registries.push(r);
      return r;
    },
    createSandbox: (root, allowWrite): Sandbox => {
      sandboxes.push({ root, allowWrite });
      return { root, resolve: p => Promise.resolve(`${root}/${p}`) };
    },
    createGate: (_bus, mode) => {
      const g = fakeGate(mode);
      gates.push(g);
      return g;
    },
    ...extra,
  });
  return { provider, bus, sessions, registries, sandboxes, gates, worker };
}

function task(
  kind: TaskKind,
  ownsFiles: string[] = [],
  extra: Partial<PlanTask> = {}
): PlanTask {
  return {
    id: 't2',
    kind,
    title: `Task ${kind}`,
    dependsOn: [],
    brief: 'Do the thing.',
    ownsFiles,
    ...extra,
  };
}

const SPEC = '# Idea\nCount pairs.';
const signal = () => new AbortController().signal;
const finish = (summary: string, configPatch?: unknown): MockStep => ({
  toolCall: {
    name: 'finish_task',
    args: configPatch === undefined ? { summary } : { summary, configPatch },
  },
});

// ---- tests -------------------------------------------------------------------

describe('workerToolNames', () => {
  it('gives each kind only the tools it needs', () => {
    expect(workerToolNames('main_solution')).toEqual([
      'read_file',
      'list_files',
      'load_skill',
      'write_file',
      'edit_file',
      'finish_task',
    ]);
    // These read Config.json, which has the worker's entries only after
    // finish_task: finish_task runs the real check instead.
    for (const k of [
      'main_solution',
      'brute_force',
      'wrong_solution',
      'validator',
      'generators',
    ] as const) {
      expect(workerToolNames(k)).not.toContain('run_solution');
      expect(workerToolNames(k)).not.toContain('test_target');
      expect(workerToolNames(k)).not.toContain('generate');
    }
    expect(workerToolNames('fix')).toContain('verify');
    const critic = workerToolNames('statement_critic');
    expect(critic).toContain('review');
    expect(critic).not.toContain('write_file');
    expect(critic).not.toContain('edit_file');
    for (const k of ['main_solution', 'validator', 'statement'] as const) {
      expect(workerToolNames(k)).not.toContain('verify');
      expect(workerToolNames(k)).not.toContain('create_problem');
    }
  });
});

describe('ModelWorker', () => {
  it('builds the session with the tools, sandbox, gate and budget of the kind', async () => {
    const t = setup([finish('done')]);
    await t.worker.run(
      {
        task: task('main_solution', ['solutions/main.cpp']),
        spec: SPEC,
        attempt: 1,
        fresh: true,
      },
      signal()
    );
    expect([...t.registries[0].tools.keys()]).toEqual(
      workerToolNames('main_solution')
    );
    expect(t.provider.requests[0].tools.map(x => x.name)).toEqual(
      workerToolNames('main_solution')
    );
    expect(t.sandboxes).toEqual([
      { root: '/x/pairs', allowWrite: ['solutions/main.cpp'] },
    ]);
    expect(t.gates[0].mode).toBe('plan-approved');
    expect(t.registries[0].permissions).toBe(t.gates[0]);
    const deps = t.sessions[0].deps;
    expect(deps.maxSteps).toBe(12);
    expect(deps.contextBudgetTokens).toBe(16000);
    expect(deps.model).toBe('gemma');
    expect(await deps.buildSystemPrompt()).toBe(workerPrompt('main_solution'));
    const ctx = deps.makeToolContext(signal());
    expect(ctx.problemDir).toBe('/x/pairs');
  });

  it('uses the small budget and the critic tools for simple kinds', async () => {
    const t = setup([
      {
        toolCall: {
          name: 'review',
          args: { ok: false, issues: ['n bound is 1e5, spec says 2e5'] },
        },
      },
      { text: 'never played' },
    ]);
    const out = await t.worker.run(
      { task: task('statement_critic'), spec: SPEC, attempt: 1, fresh: true },
      signal()
    );
    expect(t.sessions[0].deps.maxSteps).toBe(8);
    expect(t.provider.requests[0].tools.map(x => x.name)).toEqual([
      'read_file',
      'list_files',
      'load_skill',
      'review',
      'finish_task',
    ]);
    expect(out.summary).toBe(
      'review found 1 issue(s): n bound is 1e5, spec says 2e5'
    );
    expect(out.filesWritten).toEqual([]);
    expect(t.provider.remaining).toBe(1);
  });

  it('finish_task stops the session and returns the patch and the files', async () => {
    const patch = {
      addSolutions: [
        { name: 'main', source: './solutions/main.cpp', tag: 'MA' },
      ],
    };
    const t = setup([
      {
        toolCalls: [
          {
            name: 'write_file',
            args: { path: './solutions/main.cpp', content: 'x' },
          },
          { name: 'write_file', args: { path: 'bad.cpp', content: 'x' } },
        ],
      },
      {
        toolCall: {
          name: 'edit_file',
          args: { path: 'solutions/main.cpp', old_text: 'a', new_text: 'b' },
        },
      },
      finish('wrote the hash map solution', patch),
      { text: 'this step must not run' },
    ]);
    const out = await t.worker.run(
      {
        task: task('main_solution', ['solutions/main.cpp']),
        spec: SPEC,
        attempt: 1,
        fresh: true,
      },
      signal()
    );
    expect(out).toEqual({
      summary: 'wrote the hash map solution',
      configPatch: patch,
      filesWritten: ['solutions/main.cpp'],
    });
    expect(t.provider.remaining).toBe(1);
  });

  it('puts the spec, the brief, the params and the note in the first message', async () => {
    const t = setup([finish('ok')]);
    await t.worker.run(
      {
        task: task('wrong_solution', ['solutions/wa-1.cpp'], {
          params: { approach: 'int overflow', tag: 'WA' },
        }),
        spec: SPEC,
        attempt: 3,
        note: 'sample 1: expected 2 got 1',
        fresh: true,
      },
      signal()
    );
    const first = t.sessions[0].sent[0];
    expect(first).toContain('Count pairs.');
    expect(first).toContain('Do the thing.');
    expect(first).toContain('Files you own: solutions/wa-1.cpp');
    expect(first).toContain('- approach: int overflow');
    expect(first).toContain('Last attempt failed: sample 1: expected 2 got 1');
  });

  it('keeps the session when fresh is false and makes a new one when true', async () => {
    const t = setup([finish('a1'), finish('a2'), finish('a3')]);
    const tk = task('validator', ['validator/val.cpp']);
    const r1 = await t.worker.run(
      { task: tk, spec: SPEC, attempt: 1, fresh: true },
      signal()
    );
    const r2 = await t.worker.run(
      { task: tk, spec: SPEC, attempt: 2, note: 'test 3 failed', fresh: false },
      signal()
    );
    expect(t.sessions).toHaveLength(1);
    expect(t.sessions[0].sent[1]).toMatch(
      /^Last attempt failed: test 3 failed/
    );
    expect(t.sessions[0].sent[1]).not.toContain('Count pairs.');
    const r3 = await t.worker.run(
      { task: tk, spec: SPEC, attempt: 3, note: 'both failed', fresh: true },
      signal()
    );
    expect(t.sessions).toHaveLength(2);
    expect(t.sessions[1].sent[0]).toContain('Count pairs.');
    expect([r1.summary, r2.summary, r3.summary]).toEqual(['a1', 'a2', 'a3']);
  });

  it('gives the step limit summary without finish_task', async () => {
    const steps: MockStep[] = Array.from({ length: 8 }, (_, i) => ({
      toolCall: { name: 'read_file', args: { path: `f${i}` } },
    }));
    const t = setup(steps);
    const out = await t.worker.run(
      {
        task: task('statement', ['statements/english/legend.tex']),
        spec: SPEC,
        attempt: 1,
        fresh: true,
      },
      signal()
    );
    expect(out).toEqual({ summary: STEP_LIMIT_SUMMARY, filesWritten: [] });
    expect(t.provider.remaining).toBe(0);
  });

  it('forwards usage and the tool events with the task id, not text', async () => {
    const t = setup([
      {
        text: 'I will write it',
        toolCall: { name: 'read_file', args: { path: 'Config.json' } },
        usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.0002 },
      },
      { ...finish('done'), usage: { inputTokens: 20, outputTokens: 7 } },
    ]);
    await t.worker.run(
      {
        task: task('generators', ['generators/gen.cpp']),
        spec: SPEC,
        attempt: 1,
        fresh: true,
      },
      signal()
    );
    expect(t.bus.events).toEqual([
      { type: 'usage', inputTokens: 10, outputTokens: 5, costUsd: 0.0002 },
      {
        type: 'tool_call',
        callId: 'mock_call_1_1',
        name: 'read_file',
        args: { path: 'Config.json' },
        risk: 'read',
        taskId: 't2',
      },
      {
        type: 'tool_result',
        callId: 'mock_call_1_1',
        ok: true,
        summary: 'read_file ok',
        taskId: 't2',
      },
      { type: 'usage', inputTokens: 20, outputTokens: 7 },
      {
        type: 'tool_call',
        callId: 'mock_call_2_1',
        name: 'finish_task',
        args: { summary: 'done' },
        risk: 'read',
        taskId: 't2',
      },
      {
        type: 'tool_result',
        callId: 'mock_call_2_1',
        ok: true,
        summary: 'Task finished. Stop now.',
        taskId: 't2',
      },
    ]);
    expect(t.bus.events.some(e => e.type === 'text_delta')).toBe(false);
    expect(t.bus.events.some(e => 'seq' in e)).toBe(false);
  });

  it('forwards tool_progress with the task id', async () => {
    const t = setup([finish('done')]);
    await t.worker.run(
      {
        task: task('fix', [], { id: 't7' }),
        spec: SPEC,
        attempt: 1,
        fresh: true,
      },
      signal()
    );
    t.sessions[0]?.deps.bus.emit({
      type: 'tool_progress',
      callId: 'c9',
      line: 'compiling main.cpp',
    });
    expect(t.bus.events.at(-1)).toEqual({
      type: 'tool_progress',
      callId: 'c9',
      line: 'compiling main.cpp',
      taskId: 't7',
    });
  });

  it('reports a model that stops with text and no finish_task', async () => {
    const t = setup([{ text: 'I am done.\nBye.' }]);
    const out = await t.worker.run(
      {
        task: task('brute_force', ['solutions/brute.cpp']),
        spec: SPEC,
        attempt: 1,
        fresh: true,
      },
      signal()
    );
    expect(out.summary).toBe('ended without finish_task: I am done.');
  });

  it('throws when the workflow signal aborts', async () => {
    const t = setup([finish('never')]);
    const ac = new AbortController();
    ac.abort();
    await expect(
      t.worker.run(
        {
          task: task('fix', ['solutions/main.cpp']),
          spec: SPEC,
          attempt: 1,
          fresh: true,
        },
        ac.signal
      )
    ).rejects.toThrow();
  });
});

describe('finish_task precheck', () => {
  const patch = {
    addSolutions: [{ name: 'main', source: './solutions/main.cpp', tag: 'MA' }],
  };

  function checks(...results: Checkpoint[]) {
    const seen: Parameters<WorkerPrecheck>[0][] = [];
    const precheck: WorkerPrecheck = input => {
      seen.push(input);
      return Promise.resolve(
        results.shift() ?? { name: 'samples', ok: true, digest: '' }
      );
    };
    return { seen, precheck };
  }

  it('sends a failed check back to the worker and goes on until it passes', async () => {
    const { seen, precheck } = checks({
      name: 'samples',
      ok: false,
      digest: 'sample 1: expected 2 got 3',
    });
    const t = setup(
      [
        finish('first try', patch),
        {
          toolCall: { name: 'edit_file', args: { path: 'solutions/main.cpp' } },
        },
        finish('fixed', patch),
      ],
      { precheck }
    );
    const out = await t.worker.run(
      {
        task: task('main_solution', ['solutions/main.cpp']),
        spec: SPEC,
        attempt: 1,
        fresh: true,
      },
      signal()
    );
    expect(out.summary).toBe('fixed');
    expect(out.configPatch).toEqual(patch);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ spec: SPEC, configPatch: patch });
    expect(seen[0].task.kind).toBe('main_solution');
    // The model saw the digest as an error result.
    const results = t.sessions[0].messages
      .flatMap(m => m.parts)
      .filter(p => p.type === 'tool_result');
    expect(results[0]).toMatchObject({ isError: true });
    expect(JSON.stringify(results[0])).toContain('expected 2 got 3');
  });

  it(`ends the task after ${MAX_PRECHECKS} failed checks`, async () => {
    const bad = { name: 'compile', ok: false, digest: 'compile error' };
    const { seen, precheck } = checks(bad, bad, bad, bad);
    const script = Array.from({ length: MAX_PRECHECKS + 1 }, () =>
      finish('try', patch)
    );
    const t = setup(script, { precheck });
    const out = await t.worker.run(
      {
        task: task('wrong_solution', ['solutions/wa-1.cpp']),
        spec: SPEC,
        attempt: 1,
        fresh: true,
      },
      signal()
    );
    expect(seen).toHaveLength(MAX_PRECHECKS);
    expect(out.summary).toBe('try');
    expect(out.configPatch).toEqual(patch);
  });

  it('keeps the patch of a failed check when the worker runs out of steps', async () => {
    const { precheck } = checks({ name: 'generate', ok: false, digest: 'x' });
    const script: MockStep[] = [finish('try', patch)];
    for (let i = 0; i < 20; i++) {
      script.push({ toolCall: { name: 'read_file', args: { path: 'a' } } });
    }
    const t = setup(script, { precheck });
    const out = await t.worker.run(
      {
        task: task('generators', ['generators/gen.cpp']),
        spec: SPEC,
        attempt: 1,
        fresh: true,
      },
      signal()
    );
    expect(out.summary).toBe(STEP_LIMIT_SUMMARY);
    expect(out.configPatch).toEqual(patch);
  });
});

describe('checkpointPrecheck', () => {
  it('applies the patch, then runs the checkpoint of the task', async () => {
    const fs = await import('fs/promises');
    const os = await import('os');
    const path = await import('path');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'precheck-'));
    await fs.copyFile(
      path.join(__dirname, '..', '..', '..', 'template', 'Config.json'),
      path.join(dir, 'Config.json')
    );
    const checked: string[] = [];
    const checkpoints: Checkpoints = {
      async check(t, _spec, problemDir) {
        const config = JSON.parse(
          await fs.readFile(path.join(problemDir, 'Config.json'), 'utf-8')
        ) as { generators: { name: string }[] };
        checked.push(config.generators.map(g => g.name).join(','));
        return { name: t.kind, ok: true, digest: '' };
      },
      runNoModelTask: () => Promise.reject(new Error('unused')),
    };
    const precheck = checkpointPrecheck(checkpoints, dir);
    const ok = await precheck(
      {
        task: task('generators', ['generators/gen-edge.cpp']),
        spec: SPEC,
        configPatch: {
          generators: [
            { name: 'gen-edge', source: './generators/gen-edge.cpp' },
          ],
        },
      },
      signal()
    );
    expect(ok.ok).toBe(true);
    expect(checked[0]).toContain('gen-edge');

    const refused = await precheck(
      {
        task: task('generators'),
        spec: SPEC,
        configPatch: { nope: 1 } as never,
      },
      signal()
    );
    expect(refused).toMatchObject({ name: 'config patch', ok: false });
    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe('configPatchSchema', () => {
  it('shows the exact patch shape of each kind', () => {
    const gen = configPatchSchema('generators') as {
      properties: Record<string, { required?: string[] }>;
      required: string[];
    };
    expect(gen.required).toEqual(['generators', 'generatorScript']);
    // polyman fills the testset when it is missing.
    expect(gen.properties['generatorScript'].required).toEqual(['scriptFile']);
    const sol = JSON.stringify(configPatchSchema('wrong_solution'));
    expect(sol).toContain('addSolutions');
    expect(sol).toContain('"WA"');
    expect(JSON.stringify(configPatchSchema('validator'))).toContain(
      'testsFilePath'
    );
    expect(configPatchSchema('fix')).toEqual({
      type: 'object',
      description: expect.any(String) as string,
    });
  });

  it('makes configPatch required in finish_task for kinds with a patch', async () => {
    const t = setup([finish('done')]);
    await t.worker.run(
      {
        task: task('generators', ['generators/gen.cpp']),
        spec: SPEC,
        attempt: 1,
        fresh: true,
      },
      signal()
    );
    const spec = t.provider.requests[0].tools.find(
      x => x.name === 'finish_task'
    )!;
    const params = spec.parameters as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(params.required).toEqual(['summary', 'configPatch']);
    expect(params.properties['configPatch']).toEqual(
      configPatchSchema('generators')
    );
  });
});
