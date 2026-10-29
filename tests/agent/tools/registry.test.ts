import { describe, it, expect, vi } from 'vitest';
import type { ApprovalDecision } from '../../../src/agent/core/events';
import {
  DefaultToolRegistry,
  capContent,
} from '../../../src/agent/tools/registry';
import {
  SandboxError,
  type PermissionGate,
  type PermissionMode,
  type Tool,
  type ToolContext,
  type ToolOutput,
} from '../../../src/agent/tools/types';

type Verdict = { allowed: true } | { allowed: false; reason: string };

/** A gate that answers every check with `verdict`, and records the calls. */
class FakeGate implements PermissionGate {
  mode: PermissionMode = 'ask';
  calls: { tool: string; args: unknown }[] = [];
  constructor(
    private readonly answer: (signal: AbortSignal) => Promise<Verdict> = () =>
      Promise.resolve({ allowed: true })
  ) {}
  setMode(m: PermissionMode): void {
    this.mode = m;
  }
  check(tool: Tool, args: unknown, signal: AbortSignal): Promise<Verdict> {
    this.calls.push({ tool: tool.name, args });
    return this.answer(signal);
  }
  askPlan(): Promise<ApprovalDecision> {
    return Promise.resolve({ kind: 'allow_once' });
  }
  resolve(): void {}
}

function makeTool(
  name: string,
  run: Tool['run'] = () => Promise.resolve({ content: 'done' }),
  extra: Partial<Tool> = {}
): Tool {
  return {
    name,
    description: `the ${name} tool`,
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    risk: 'read',
    needsProblem: true,
    run,
    ...extra,
  };
}

function makeCtx(
  overrides: Partial<ToolContext> = {}
): ToolContext & { lines: string[] } {
  const lines: string[] = [];
  return {
    problemDir: '/tmp/problem',
    signal: new AbortController().signal,
    runner: { run: () => Promise.reject(new Error('no runner')) },
    sandbox: {
      root: '/tmp/problem',
      resolve: p => Promise.resolve(p),
    },
    progress: line => lines.push(line),
    setProblemDir: () => {},
    lines,
    ...overrides,
  };
}

function setup(
  gate = new FakeGate(),
  opts: { capBytes?: number; defaultTimeoutMs?: number } = {}
): { registry: DefaultToolRegistry; gate: FakeGate } {
  return {
    registry: new DefaultToolRegistry({ permissions: gate, ...opts }),
    gate,
  };
}

const call = (name: string, args: unknown = { path: 'a.cpp' }) => ({
  id: 'call_1',
  name,
  args,
});

describe('DefaultToolRegistry', () => {
  it('lists specs and risks', () => {
    const { registry } = setup();
    registry.register(makeTool('read_file'));
    registry.register(makeTool('write_file', undefined, { risk: 'write' }));
    expect(registry.specs()).toEqual([
      {
        name: 'read_file',
        description: 'the read_file tool',
        parameters: expect.any(Object) as unknown,
      },
      {
        name: 'write_file',
        description: 'the write_file tool',
        parameters: expect.any(Object) as unknown,
      },
    ]);
    expect(registry.riskOf('write_file')).toBe('write');
    expect(registry.riskOf('nope')).toBeUndefined();
  });

  it('refuses to register the same name twice', () => {
    const { registry } = setup();
    registry.register(makeTool('read_file'));
    expect(() => registry.register(makeTool('read_file'))).toThrow(
      'Tool "read_file" is already registered'
    );
  });

  it('1. unknown tool lists the tools', async () => {
    const { registry, gate } = setup();
    registry.register(makeTool('read_file'));
    registry.register(makeTool('verify'));
    await expect(registry.run(call('raed_file'), makeCtx())).resolves.toEqual({
      content: 'Unknown tool "raed_file". Tools you can use: read_file, verify',
      isError: true,
    });
    expect(gate.calls).toEqual([]);
  });

  it('2. invalid JSON arguments', async () => {
    const { registry, gate } = setup();
    const run = vi.fn(() => Promise.resolve({ content: 'x' }));
    registry.register(makeTool('read_file', run));
    const out = await registry.run(
      { ...call('read_file', {}), argsError: 'Unexpected token }' },
      makeCtx()
    );
    expect(out).toEqual({
      content:
        'Your arguments were not valid JSON: Unexpected token }. ' +
        'Call read_file again with a JSON object.',
      isError: true,
    });
    expect(run).not.toHaveBeenCalled();
    expect(gate.calls).toEqual([]);
  });

  it('3. schema errors, one per line', async () => {
    const { registry, gate } = setup();
    registry.register(makeTool('read_file'));
    const out = await registry.run(call('read_file', { file: 1 }), makeCtx());
    expect(out).toEqual({
      content:
        'args: missing required property "path"\n' +
        'args: unknown property "file", allowed: path',
      isError: true,
    });
    expect(gate.calls).toEqual([]);
  });

  it('4. needs a problem folder', async () => {
    const { registry, gate } = setup();
    registry.register(makeTool('read_file'));
    registry.register(
      makeTool('create_problem', undefined, { needsProblem: false })
    );
    const ctx = makeCtx({ problemDir: null });
    await expect(registry.run(call('read_file'), ctx)).resolves.toEqual({
      content: 'There is no problem folder yet. Call create_problem first.',
      isError: true,
    });
    expect(gate.calls).toEqual([]);
    await expect(registry.run(call('create_problem'), ctx)).resolves.toEqual({
      content: 'done',
    });
  });

  it('5. passes the args to the gate, a deny is not an error', async () => {
    const gate = new FakeGate(() =>
      Promise.resolve({ allowed: false, reason: 'write the brute force first' })
    );
    const { registry } = setup(gate);
    const run = vi.fn(() => Promise.resolve({ content: 'x' }));
    registry.register(makeTool('write_file', run, { risk: 'write' }));
    const out = await registry.run(call('write_file'), makeCtx());
    expect(out).toEqual({
      content: 'The user denied this: write the brute force first',
    });
    expect(out.isError).toBeUndefined();
    expect(gate.calls).toEqual([
      { tool: 'write_file', args: { path: 'a.cpp' } },
    ]);
    expect(run).not.toHaveBeenCalled();
  });

  it('5. rethrows an abort while the gate waits', async () => {
    const controller = new AbortController();
    const gate = new FakeGate(signal => {
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () =>
          reject(new Error('gate stopped'))
        );
      });
    });
    const { registry } = setup(gate);
    registry.register(makeTool('write_file', undefined, { risk: 'write' }));
    const running = registry.run(
      call('write_file'),
      makeCtx({ signal: controller.signal })
    );
    const reason = new Error('cancelled');
    controller.abort(reason);
    await expect(running).rejects.toBe(reason);
  });

  it('6. runs the tool with the args and a working context', async () => {
    const { registry } = setup();
    let seen: { args: unknown; dir: string | null } | undefined;
    registry.register(
      makeTool('read_file', (args, ctx) => {
        seen = { args, dir: ctx.problemDir };
        ctx.progress('line 1');
        return Promise.resolve({ content: 'hello', data: { n: 1 } });
      })
    );
    const ctx = makeCtx();
    await expect(registry.run(call('read_file'), ctx)).resolves.toEqual({
      content: 'hello',
      data: { n: 1 },
    });
    expect(seen).toEqual({ args: { path: 'a.cpp' }, dir: '/tmp/problem' });
    expect(ctx.lines).toEqual(['line 1']);
  });

  it('6. timeout with the tool timeoutMs, and the tool signal aborts', async () => {
    const { registry } = setup();
    let toolSignal: AbortSignal | undefined;
    registry.register(
      makeTool(
        'verify',
        (_args, ctx) => {
          toolSignal = ctx.signal;
          return new Promise<ToolOutput>(() => {});
        },
        { timeoutMs: 20 }
      )
    );
    await expect(registry.run(call('verify'), makeCtx())).resolves.toEqual({
      content: 'verify timed out after 0.02s',
      isError: true,
    });
    expect(toolSignal?.aborted).toBe(true);
  });

  it('6. timeout with the default time limit', async () => {
    const { registry } = setup(undefined, { defaultTimeoutMs: 30 });
    registry.register(
      makeTool('verify', (_args, ctx) => {
        // A tool that stops on abort, by throwing.
        return new Promise<ToolOutput>((_resolve, reject) => {
          ctx.signal.addEventListener('abort', () =>
            reject(new Error('killed'))
          );
        });
      })
    );
    await expect(registry.run(call('verify'), makeCtx())).resolves.toEqual({
      content: 'verify timed out after 0.03s',
      isError: true,
    });
  });

  it('6. rethrows a user abort while the tool runs', async () => {
    const controller = new AbortController();
    const { registry } = setup();
    let toolSignal: AbortSignal | undefined;
    registry.register(
      makeTool('verify', (_args, ctx) => {
        toolSignal = ctx.signal;
        return new Promise<ToolOutput>(() => {});
      })
    );
    const running = registry.run(
      call('verify'),
      makeCtx({ signal: controller.signal })
    );
    await Promise.resolve();
    const reason = new Error('user cancelled');
    controller.abort(reason);
    await expect(running).rejects.toBe(reason);
    expect(toolSignal?.aborted).toBe(true);
  });

  it('6. a throw becomes an error output, SandboxError message as is', async () => {
    const { registry } = setup();
    registry.register(
      makeTool('read_file', () =>
        Promise.reject(new SandboxError('../x is outside the problem folder'))
      )
    );
    registry.register(
      makeTool('list_files', () => {
        throw new Error('sync boom');
      })
    );
    registry.register(
      makeTool('verify', () => Promise.reject(new Error('compile failed')))
    );
    await expect(registry.run(call('read_file'), makeCtx())).resolves.toEqual({
      content: '../x is outside the problem folder',
      isError: true,
    });
    await expect(registry.run(call('list_files'), makeCtx())).resolves.toEqual({
      content: 'sync boom',
      isError: true,
    });
    await expect(registry.run(call('verify'), makeCtx())).resolves.toEqual({
      content: 'compile failed',
      isError: true,
    });
  });

  it('6. keeps isError from the tool', async () => {
    const { registry } = setup();
    registry.register(
      makeTool('verify', () =>
        Promise.resolve({ content: 'WA on test 3', isError: true })
      )
    );
    await expect(registry.run(call('verify'), makeCtx())).resolves.toEqual({
      content: 'WA on test 3',
      isError: true,
    });
  });

  it('7. caps a 50 KB result with the marker, keeps data whole', async () => {
    const { registry } = setup();
    // 3-byte characters, so a byte cut would break one.
    const big = 'é€'.repeat(10_000) + 'END';
    const data = { report: big };
    registry.register(
      makeTool('verify', () => Promise.resolve({ content: big, data }))
    );
    const out = await registry.run(call('verify'), makeCtx());
    const bytes = Buffer.byteLength(out.content);
    expect(Buffer.byteLength(big)).toBeGreaterThan(50_000);
    expect(bytes).toBeLessThanOrEqual(8192);
    expect(bytes).toBeGreaterThan(8000);
    expect(out.content).toMatch(/\n\[\.\.\. \d+ bytes cut \.\.\.\]\n/);
    expect(out.content).not.toContain('�');
    expect(out.content.startsWith('é€é€')).toBe(true);
    expect(out.content.endsWith('é€END')).toBe(true);
    expect(out.data).toBe(data);

    const [head, tail] = out.content.split(
      /\n\[\.\.\. \d+ bytes cut \.\.\.\]\n/
    );
    const cut = Number(/(\d+) bytes cut/.exec(out.content)![1]);
    expect(Buffer.byteLength(head) + cut + Buffer.byteLength(tail)).toBe(
      Buffer.byteLength(big)
    );
    expect(Buffer.byteLength(head)).toBeLessThanOrEqual(2048);
    expect(Buffer.byteLength(head)).toBeGreaterThan(2040);
  });

  it('7. leaves short content alone, honours capBytes', async () => {
    const { registry } = setup(undefined, { capBytes: 100 });
    registry.register(
      makeTool('read_file', () => Promise.resolve({ content: 'x'.repeat(100) }))
    );
    registry.register(
      makeTool('verify', () => Promise.resolve({ content: 'y'.repeat(500) }))
    );
    expect((await registry.run(call('read_file'), makeCtx())).content).toBe(
      'x'.repeat(100)
    );
    const capped = (await registry.run(call('verify'), makeCtx())).content;
    expect(Buffer.byteLength(capped)).toBeLessThanOrEqual(100);
    expect(capped).toContain('bytes cut');
  });
});

describe('capContent', () => {
  it('does not split a 4-byte character', () => {
    const text = '\u{1F600}'.repeat(5000);
    const out = capContent(text, 8192);
    expect(out).not.toContain('�');
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(8192);
  });
});
