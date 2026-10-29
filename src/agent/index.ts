/**
 * The `polyman chat` entry point. `cli.ts` loads this file with a dynamic
 * `import()` only when `chat` runs.
 *
 * It connects everything: the key and provider, the tools, the permission
 * gate, the session, the workflow scheduler, and the UI (the Ink TUI, or the
 * plain line mode).
 */

import * as fs from 'fs';
import * as path from 'path';
import { SimpleEventBus } from './core/event-bus';
import type { EventBus } from './core/events';
import { ChatPromptBuilder } from './core/prompt';
import { AgentSession } from './core/session';
import type { AgentSessionApi } from './core/session-types';
import { runPlain } from './plain';
import { GEMMA_BUDGETS, createChatProvider } from './providers/gemma';
import { withRetries } from './providers/retry';
import type { Provider } from './providers/types';
import { NodeCliRunner } from './runner/cli-runner';
import type { CliRunner } from './runner/types';
import { skillTools } from './skills';
import { cliTools } from './tools/cli-tools';
import { fsTools } from './tools/fs-tools';
import { ideasTool, type IdeasRunner } from './tools/ideas-tool';
import { NotesStore, notesTools } from './tools/notes-tools';
import {
  readPolygonCredentials,
  remoteTools,
  type PolygonCredentials,
} from './tools/remote-tools';
import { DefaultPermissionGate } from './tools/permissions';
import { DefaultToolRegistry } from './tools/registry';
import { FolderSandbox } from './tools/sandbox';
import type { PermissionMode, Sandbox, Tool } from './tools/types';
import {
  gemmaSchedulerFactory,
  workflowTool,
  type WorkflowToolOptions,
} from './tools/workflow-tool';
import { IdeaWorkflow } from './workflow/ideas';

/** Where the chat starts. */
export interface ChatStart {
  /** The problem folder, or null in "new problem" mode. */
  problemDir: string | null;
  /**
   * The folder `create_problem` makes a new problem in. For a chat started
   * in a problem folder it is the parent, so a new problem goes next to it.
   */
  startDir: string;
  /** The folder name the user asked for, for `create_problem`. */
  suggestedName?: string;
}

/**
 * Finds where the chat starts. A folder with `Config.json` is the problem,
 * and new problems are made next to it. Else there is no problem yet: a
 * folder that does not exist names the new problem and it is made next to
 * it; an existing folder without `Config.json` (or no `dir`) is where new
 * problems are made.
 */
export function resolveChatStart(
  dir: string | undefined,
  cwd: string = process.cwd()
): ChatStart {
  const target = path.resolve(cwd, dir ?? '.');
  if (fs.existsSync(path.join(target, 'Config.json'))) {
    return { problemDir: target, startDir: path.dirname(target) };
  }
  if (dir === undefined || fs.existsSync(target)) {
    return { problemDir: null, startDir: target };
  }
  return {
    problemDir: null,
    startDir: path.dirname(target),
    suggestedName: path.basename(target),
  };
}

/** What {@link createChatRuntime} needs. */
export interface ChatRuntimeOptions {
  /** The folder the user gave, like `./pairs-sum`. */
  dir?: string;
  provider: Provider;
  model: string;
  /** Keys to redact from errors. */
  secrets?: string[];
  /** Runs polyman commands. Defaults to {@link NodeCliRunner}. */
  runner?: CliRunner;
  /** Builds the workflow scheduler. Defaults to Gemma manager and workers. */
  createScheduler?: WorkflowToolOptions['createScheduler'];
  /** Builds the idea workflow. Defaults to Gemma. */
  createIdeas?: () => IdeasRunner;
  /** Base folder for a relative `dir`. Defaults to `process.cwd()`. */
  cwd?: string;
  /**
   * The registered Polygon credentials, or null. Defaults to reading
   * `~/.polyman`. Read on each use, so a `remote register` run in another
   * terminal works without a restart.
   */
  polygonCredentials?: () => PolygonCredentials | null;
}

/** A chat ready to run, without a UI. */
export interface ChatRuntime {
  session: AgentSessionApi;
  bus: EventBus;
  gate: DefaultPermissionGate;
  /** The problem folder now (it changes after `create_problem`). */
  problemDir(): string | null;
  notes: NotesStore;
}

/**
 * Builds the chat: bus, gate, runner, tools, sandbox, prompt and session.
 * It needs no terminal and no key, so tests run it with `MockProvider`.
 */
export function createChatRuntime(opts: ChatRuntimeOptions): ChatRuntime {
  const start = resolveChatStart(opts.dir, opts.cwd);
  const polygonCredentials = opts.polygonCredentials ?? readPolygonCredentials;
  // The Polygon key and secret are redacted too, from tool output and errors.
  const secrets = (): string[] => {
    const polygon = polygonCredentials();
    return [
      ...(opts.secrets ?? []),
      ...(polygon ? [polygon.apiKey, polygon.secret] : []),
    ];
  };
  const bus = new SimpleEventBus();
  const gate = new DefaultPermissionGate(bus, 'ask');
  const runner = opts.runner ?? new NodeCliRunner();

  let problemDir = start.problemDir;
  let sandbox: Sandbox = new FolderSandbox(problemDir ?? start.startDir);
  let lastCallId = '';
  bus.on(e => {
    // Worker calls (with a task id) are not the chat's running tool.
    if (e.type === 'tool_call' && e.taskId === undefined) lastCallId = e.callId;
  });

  const notes = new NotesStore(bus, () => problemDir);
  const createScheduler =
    opts.createScheduler ??
    gemmaSchedulerFactory({
      provider: opts.provider,
      model: opts.model,
      bus,
      gate,
      secrets,
    });

  const tools = new DefaultToolRegistry({
    permissions: gate,
    capBytes: GEMMA_BUDGETS.toolResultCapBytes,
  });
  const all: Tool[] = [
    ...fsTools(),
    ...cliTools().map(t =>
      t.name === 'create_problem' ? inFolder(t, () => start.startDir) : t
    ),
    ...remoteTools({ credentials: polygonCredentials }),
    ...skillTools(),
    ...notesTools(notes),
    workflowTool({ readSpec: () => notes.read(), createScheduler, gate }),
    ideasTool({
      createRunner:
        opts.createIdeas ??
        (() =>
          new IdeaWorkflow({
            provider: opts.provider,
            model: opts.model,
            bus,
          })),
    }),
  ];
  for (const tool of all) tools.register(tool);

  const prompt = new ChatPromptBuilder({
    problemDir: () => problemDir,
    notes: () => Promise.resolve(notes.pending()),
  });

  const session = new AgentSession({
    provider: opts.provider,
    model: opts.model,
    tools,
    permissions: gate,
    bus,
    async buildSystemPrompt() {
      const text = await prompt.build();
      if (problemDir !== null || start.suggestedName === undefined) {
        return text;
      }
      return `${text}\nThe user asked for the problem folder "${start.suggestedName}": use this name with create_problem.`;
    },
    makeToolContext: signal => ({
      problemDir,
      signal,
      runner,
      sandbox,
      progress: line => {
        bus.emit({ type: 'tool_progress', callId: lastCallId, line });
      },
      setProblemDir: dir => {
        problemDir = path.resolve(dir);
        sandbox = new FolderSandbox(problemDir);
        bus.emit({ type: 'problem_dir_changed', problemDir });
      },
    }),
    secrets,
    maxSteps: GEMMA_BUDGETS.chatMaxSteps,
    contextBudgetTokens: GEMMA_BUDGETS.contextBudgetTokens,
    maxOutputTokens: GEMMA_BUDGETS.maxOutputTokens,
    temperature: GEMMA_BUDGETS.temperature,
  });

  return { session, bus, gate, problemDir: () => problemDir, notes };
}

/**
 * `create_problem` makes the folder in `ctx.problemDir ?? process.cwd()`.
 * This makes it always use the chat's start folder, so a new problem is
 * never made inside the problem that is open now.
 */
function inFolder(tool: Tool, folder: () => string): Tool {
  return {
    ...tool,
    run: (args, ctx) => tool.run(args, { ...ctx, problemDir: folder() }),
  };
}

/** What the TUI shows and changes (W5 `TuiInfo`). */
interface TuiInfo {
  problem: string | null;
  model: string;
  mode?: PermissionMode;
  setMode?: (m: PermissionMode) => void;
}

/**
 * The TUI module (W5), typed loosely: it is ESM and not always in the tree.
 * `startTui` prints `Bye.` itself on exit.
 */
interface TuiModule {
  startTui(
    session: AgentSessionApi,
    bus: EventBus,
    info: TuiInfo
  ): Promise<void>;
}

/** Loads the TUI. The path is a variable so it builds without W5. */
async function loadTui(): Promise<TuiModule> {
  const file = './tui/index.js';
  return (await import(file)) as TuiModule;
}

/** Starts the chat in `opts.dir` with `opts.model`. */
export async function startChat(opts: {
  dir?: string;
  model?: string;
  plain?: boolean;
}): Promise<void> {
  if (opts.plain !== true && !(process.stdin.isTTY && process.stdout.isTTY)) {
    console.error('polyman chat needs a terminal (or use --plain).');
    process.exitCode = 2;
    return;
  }

  const made = await createChatProvider(
    opts.model !== undefined ? { model: opts.model } : {}
  );
  if ('error' in made) {
    console.error(made.error);
    process.exitCode = 2;
    return;
  }

  const runtime = createChatRuntime({
    ...(opts.dir !== undefined ? { dir: opts.dir } : {}),
    provider: withRetries(made.provider, { secrets: made.secrets }),
    model: made.model,
    secrets: made.secrets,
  });
  const { session, bus, gate } = runtime;
  const problem = runtime.problemDir();
  const model = made.model;

  let tui: TuiModule | null = null;
  if (opts.plain !== true) {
    try {
      tui = await loadTui();
    } catch (err) {
      const why = err instanceof Error ? err.message.split('\n')[0] : '';
      console.log(
        `The terminal UI is not available (${why}), using plain mode.`
      );
    }
  }

  try {
    if (tui) {
      await tui.startTui(session, bus, {
        problem,
        model,
        mode: gate.mode,
        setMode: m => gate.setMode(m),
      });
    } else {
      await runPlain(session, bus, { problem, model });
    }
  } finally {
    session.cancel();
    // The TUI prints its own "Bye.".
    if (!tui) console.log('Bye.');
  }
}
