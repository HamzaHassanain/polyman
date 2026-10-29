/**
 * Shared setup for the safety tests: real temp folders, the real registry,
 * permission gate and sandbox, with the real file and CLI tools. Only the CLI
 * runner is a spy, so no polyman command really runs.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { SimpleEventBus } from '../../../src/agent/core/event-bus';
import type {
  AgentEvent,
  ApprovalDecision,
  SeqEvent,
} from '../../../src/agent/core/events';
import type {
  CliRunner,
  RunOptions,
  RunResult,
} from '../../../src/agent/runner/types';
import { cliTools } from '../../../src/agent/tools/cli-tools';
import { fsTools } from '../../../src/agent/tools/fs-tools';
import { DefaultPermissionGate } from '../../../src/agent/tools/permissions';
import { DefaultToolRegistry } from '../../../src/agent/tools/registry';
import { FolderSandbox } from '../../../src/agent/tools/sandbox';
import type {
  PermissionMode,
  Tool,
  ToolCall,
  ToolContext,
  ToolOutput,
} from '../../../src/agent/tools/types';

/** The fake CLI of the W4 runner tests. */
export const FAKE_CLI = path.join(__dirname, '..', 'fixtures', 'fake-cli.mjs');

/**
 * A temp `base` with the problem folder `pairs`, its look-alike sibling
 * `pairs-evil`, and an `outside` folder with a secret.
 */
export interface Folders {
  base: string;
  root: string;
  sibling: string;
  outside: string;
}

export function makeFolders(): Folders {
  const base = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'pm-safety-'))
  );
  const root = path.join(base, 'pairs');
  const sibling = path.join(base, 'pairs-evil');
  const outside = path.join(base, 'outside');
  for (const dir of [root, sibling, outside]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret\n');
  fs.writeFileSync(path.join(sibling, 'secret.txt'), 'evil secret\n');
  fs.writeFileSync(path.join(root, 'Config.json'), '{"name":"pairs"}\n');
  fs.writeFileSync(path.join(root, 'testlib.h'), '// upstream testlib\n');
  return { base, root, sibling, outside };
}

export function removeFolders(f: Folders): void {
  fs.rmSync(f.base, { recursive: true, force: true });
}

/**
 * Every entry under `dir` (symlinks not followed) with its content, as
 * sorted `path: content` lines. Entries under `skip` are left out.
 */
export function stateOf(dir: string, skip?: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const name of fs.readdirSync(current)) {
      const full = path.join(current, name);
      if (skip !== undefined && full === skip) continue;
      const rel = path.relative(dir, full);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) {
        out.push(`${rel} -> ${fs.readlinkSync(full)}`);
      } else if (stat.isDirectory()) {
        out.push(`${rel}/`);
        walk(full);
      } else {
        out.push(`${rel}: ${fs.readFileSync(full, 'utf8')}`);
      }
    }
  };
  walk(dir);
  return out.sort();
}

/** Everything outside the problem folder. */
export function outsideState(f: Folders): string[] {
  return stateOf(f.base, f.root);
}

/** A runner that records the calls and never starts a process. */
export class SpyRunner implements CliRunner {
  readonly calls: { args: string[]; opts: RunOptions }[] = [];

  run(args: string[], opts: RunOptions): Promise<RunResult> {
    this.calls.push({ args, opts });
    return Promise.resolve({
      exitCode: 0,
      reason: 'exited',
      stdoutTail: '',
      stderrTail: '',
      logPath: '',
      durationMs: 1,
    });
  }
}

export interface HarnessOptions {
  mode?: PermissionMode;
  /** Files a workflow task owns, passed to the sandbox. */
  allowWrite?: string[];
  /** Null for a session before `create_problem`. */
  problemDir?: string | null;
  /** Tools added after the file and CLI tools. */
  extraTools?: Tool[];
}

export interface Harness {
  bus: SimpleEventBus;
  events: SeqEvent[];
  gate: DefaultPermissionGate;
  registry: DefaultToolRegistry;
  runner: SpyRunner;
  sandbox: FolderSandbox;
  ctx(signal?: AbortSignal): ToolContext;
  /** Runs one call through the registry, like the session does. */
  call(name: string, args: unknown, signal?: AbortSignal): Promise<ToolOutput>;
  /** Runs a raw call, for `argsError` and odd ids. */
  raw(call: ToolCall, signal?: AbortSignal): Promise<ToolOutput>;
  /** Answers every approval (tool or plan) with `decision`, once asked. */
  answerAll(decision: ApprovalDecision): void;
  /** Resolves with the next event of this type. */
  next<T extends AgentEvent['type']>(
    type: T
  ): Promise<Extract<SeqEvent, { type: T }>>;
  /** How many events of this type were emitted. */
  count(type: AgentEvent['type']): number;
}

export function makeHarness(root: string, opts: HarnessOptions = {}): Harness {
  const bus = new SimpleEventBus();
  const events: SeqEvent[] = [];
  bus.on(e => events.push(e));
  const gate = new DefaultPermissionGate(bus, opts.mode ?? 'ask');
  const registry = new DefaultToolRegistry({ permissions: gate });
  for (const tool of [
    ...fsTools(),
    ...cliTools(),
    ...(opts.extraTools ?? []),
  ]) {
    registry.register(tool);
  }
  const runner = new SpyRunner();
  const sandbox = new FolderSandbox(
    root,
    opts.allowWrite !== undefined ? { allowWrite: opts.allowWrite } : {}
  );
  let problemDir = opts.problemDir === undefined ? root : opts.problemDir;
  let nextId = 1;

  const ctx = (signal?: AbortSignal): ToolContext => ({
    problemDir,
    signal: signal ?? new AbortController().signal,
    runner,
    sandbox,
    progress: () => {},
    setProblemDir: dir => {
      problemDir = dir;
    },
  });

  const raw = (call: ToolCall, signal?: AbortSignal): Promise<ToolOutput> => {
    bus.emit({
      type: 'tool_call',
      callId: call.id,
      name: call.name,
      args: call.args,
      risk: registry.riskOf(call.name) ?? 'read',
    });
    return registry.run(call, ctx(signal));
  };

  return {
    bus,
    events,
    gate,
    registry,
    runner,
    sandbox,
    ctx,
    raw,
    call: (name, args, signal) =>
      raw({ id: `call_${nextId++}`, name, args }, signal),
    answerAll: decision => {
      bus.on(e => {
        if (e.type === 'approval_needed' || e.type === 'plan_approval_needed') {
          queueMicrotask(() => gate.resolve(e.approvalId, decision));
        }
      });
    },
    next: <T extends AgentEvent['type']>(type: T) =>
      new Promise<Extract<SeqEvent, { type: T }>>(resolve => {
        const off = bus.on(e => {
          if (e.type === type) {
            off();
            resolve(e as Extract<SeqEvent, { type: T }>);
          }
        });
      }),
    count: type => events.filter(e => e.type === type).length,
  };
}

/** A tool that counts its runs, for checks that a call never ran. */
export function spyTool(
  name: string,
  over: Partial<Tool> = {}
): Tool & { runs: unknown[] } {
  const runs: unknown[] = [];
  return {
    name,
    description: `the ${name} spy`,
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    risk: 'write',
    needsProblem: true,
    run: args => {
      runs.push(args);
      return Promise.resolve({ content: `${name} ran` });
    },
    ...over,
    runs,
  };
}

/** Waits until `check` is true, or `ms` passed. */
export async function waitFor(
  check: () => boolean,
  ms = 5000
): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return true;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  return check();
}

/** True when a process with this pid still exists. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
