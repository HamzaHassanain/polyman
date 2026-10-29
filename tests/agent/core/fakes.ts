import { SimpleEventBus } from '../../../src/agent/core/event-bus';
import type { SeqEvent } from '../../../src/agent/core/events';
import type { AgentSessionDeps } from '../../../src/agent/core/session-types';
import type { Provider, ToolSpec } from '../../../src/agent/providers/types';
import type { CliRunner } from '../../../src/agent/runner/types';
import type {
  PermissionGate,
  Risk,
  Sandbox,
  Tool,
  ToolCall,
  ToolContext,
  ToolOutput,
  ToolRegistry,
} from '../../../src/agent/tools/types';

/** A fake tool: gets the args and the context, returns an output. */
export type FakeHandler = (
  args: unknown,
  ctx: ToolContext
) => Promise<ToolOutput>;

/** A small registry that runs plain handlers, with no checks. */
export class FakeTools implements ToolRegistry {
  readonly calls: ToolCall[] = [];

  constructor(
    private readonly handlers: Record<string, FakeHandler>,
    private readonly risks: Record<string, Risk> = {}
  ) {}

  register(_tool: Tool): void {}

  specs(): ToolSpec[] {
    return Object.keys(this.handlers).map(name => ({
      name,
      description: `the ${name} tool`,
      parameters: { type: 'object' },
    }));
  }

  riskOf(name: string): Risk | undefined {
    return this.risks[name];
  }

  run(call: ToolCall, ctx: ToolContext): Promise<ToolOutput> {
    this.calls.push(call);
    const handler = this.handlers[call.name];
    if (!handler) {
      return Promise.resolve({
        content: `no tool ${call.name}`,
        isError: true,
      });
    }
    return handler(call.args, ctx);
  }
}

/** A permission gate that records the answers it gets. */
export class FakePermissions implements PermissionGate {
  mode: PermissionGate['mode'] = 'ask';
  readonly resolved: Array<{ id: string; kind: string }> = [];

  setMode(m: PermissionGate['mode']): void {
    this.mode = m;
  }

  check(): Promise<{ allowed: true }> {
    return Promise.resolve({ allowed: true });
  }

  askPlan(): Promise<{ kind: 'allow_once' }> {
    return Promise.resolve({ kind: 'allow_once' });
  }

  resolve(id: string, decision: { kind: string }): void {
    this.resolved.push({ id, kind: decision.kind });
  }
}

/** Deps for a session, with fakes and the given provider and tools. */
export function makeDeps(
  provider: Provider,
  tools: ToolRegistry = new FakeTools({}),
  over: Partial<AgentSessionDeps> = {}
): AgentSessionDeps & { events: SeqEvent[] } {
  const bus = new SimpleEventBus();
  const events: SeqEvent[] = [];
  bus.on(e => events.push(e));
  return {
    provider,
    model: 'mock-model',
    tools,
    permissions: new FakePermissions(),
    bus,
    buildSystemPrompt: () => Promise.resolve('You build problems.'),
    makeToolContext: (signal: AbortSignal): ToolContext => ({
      problemDir: null,
      signal,
      runner: {} as CliRunner,
      sandbox: {} as Sandbox,
      progress: () => {},
      setProblemDir: () => {},
    }),
    secrets: () => [],
    maxSteps: 20,
    contextBudgetTokens: 32000,
    maxOutputTokens: 8000,
    temperature: 0.3,
    ...over,
    events,
  };
}

/** A tool that returns a fixed text. */
export function textTool(content: string): FakeHandler {
  return () => Promise.resolve({ content });
}
