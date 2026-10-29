# W0: setup and contracts

- Lane: A (Hamza). Tool: Claude Code (Opus). Runs in the main checkout on `feat/agent-hackday`, right after the plan commit.
- Time: 2:45 to 3:20 PM. Everything else waits for this, so keep it small and exact.
- Read first: `CLAUDE.md`, `design/agent/11-hackday-plan.md` section 2 (what exists), `design/agent/04-harness.md` (AgentSession, Events, Tools, PermissionGate, Sandbox, CliRunner), `design/agent/10-workflow-manager.md` (Task results and the plan, Events and UI), and the existing code: `src/agent/providers/types.ts`, `src/agent/core/messages.ts`, `src/agent/providers/mock.ts`, `src/agent/providers/key-store.ts`, `src/cli.ts` (the `ai` command and `loadAiCommands`).

## Goal

Add the Ink setup and the **new contract files** next to the existing provider contracts. After this commit the contracts are frozen. Other workers code against them in parallel.

**Do not rewrite or move anything that exists** in `src/agent/providers/`, `src/agent/core/messages.ts`, `src/agent/ai-commands.ts`. The only allowed change there is the one line in `types.ts` below.

## Module style

The agent code is **CommonJS** like the rest of polyman: relative imports without an extension, exactly like `src/agent/providers/*.ts` today. Only `src/agent/tui/` is ESM.

## Part 1: Ink setup (only for `src/agent/tui/`)

1. `src/agent/tui/package.json` with exactly `{ "type": "module" }`. Inside that folder, relative imports end in `.js`.
2. `tsconfig.json`: add `"jsx": "react-jsx"`. `tsconfig.eslint.json` and `eslint.config.cjs`: lint `.tsx` under `src/` and `tests/` with the same rules.
3. `vitest.config.ts`: `include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx']`.
4. `package.json`:
   - `"build": "tsc && node -e \"require('fs').copyFileSync('src/agent/tui/package.json','dist/agent/tui/package.json')\""`
   - add `"dist/agent/tui/package.json"` to `files` (today only `dist/**/*.js` is shipped, so the ESM marker would be missing from the npm package).
5. Dependencies, pinned to versions that support Node 20 (polyman's `engines` is `^20.19.0 || >=22.12.0`; Ink 7 and 8 need Node 22):
   - `npm install ink@6.8.0 react@^19.2.0 marked@^18.1.1`
   - `npm install -D ink-testing-library@^4.0.0 @types/react@^19.2.0`
   - No other new dependencies.
6. Smoke check, then delete it: `src/agent/tui/smoke.tsx` renders `<Text>ok</Text>`; a CommonJS file `src/agent/smoke-load.ts` does `const m = await import('./tui/smoke.js')` and calls it. After `npm run build`, running it prints `ok`. Delete both files before the commit and write in the commit body that the smoke check passed.

## Part 2: contracts

### One change to an existing file

`src/agent/providers/types.ts`, the `usage` member of `StreamEvent`: add `costUsd?: number;`. Nothing else in that file changes. (W1 fills it from OpenRouter.)

### New files (types and interfaces only)

Copy shapes from the design docs. Where this brief and a doc differ, this brief wins.

**`src/agent/core/events.ts`**

- `ApprovalDecision = { kind: 'allow_once' | 'allow_session' | 'deny'; reason?: string }`.
- `AgentEvent`: the union from doc 04 "Events" plus the workflow events from doc 10 "Events and UI": `plan_created { plan }`, `plan_approval_needed { approvalId; plan }`, `task_started { taskId; attempt }`, `task_checkpoint { taskId; name; ok; digest }`, `task_done { taskId; result }`, `workflow_done { ok; summary; costUsd }`. The `usage` event also has `costUsd?: number`.
- `SeqEvent = AgentEvent & { seq: number }`.
- `interface EventBus { emit(e: AgentEvent): void; on(fn: (e: SeqEvent) => void): () => void }`.

**`src/agent/tools/types.ts`**

- `Risk`, `Tool<A>`, `ToolContext`, `ToolOutput` exactly as in doc 04 "Tools" (`ToolContext` has `problemDir`, `signal`, `runner`, `sandbox`, `progress`, `setProblemDir`).
- `ToolCall { id: string; name: string; args: unknown; argsError?: string }` (`argsError` comes from the existing provider `tool_call` event).
- `interface ToolRegistry { register(tool: Tool): void; specs(): ToolSpec[]; riskOf(name: string): Risk | undefined; run(call: ToolCall, ctx: ToolContext): Promise<ToolOutput> }` (`ToolSpec` from `../providers/types`).
- `PermissionMode = 'ask' | 'auto-edit' | 'plan-approved'`.
- `PermissionGate`:

```ts
interface PermissionGate {
  mode: PermissionMode;
  setMode(m: PermissionMode): void;
  // emits approval_needed on the bus when it must ask, then waits for resolve()
  check(tool: Tool, args: unknown, signal: AbortSignal): Promise<{ allowed: true } | { allowed: false; reason: string }>;
  // emits plan_approval_needed and waits; used by the workflow scheduler
  askPlan(plan: Plan, signal: AbortSignal): Promise<ApprovalDecision>;
  // called by AgentSession.resolveApproval and by the TUI
  resolve(approvalId: string, decision: ApprovalDecision): void;
}
```

- `interface Sandbox { root: string; resolve(userPath: string, mode: 'read' | 'write'): Promise<string> }` and `class SandboxError extends Error {}` (the only class in this file).

**`src/agent/runner/types.ts`**

`RunOptions`, `RunResult`, and `interface CliRunner { run(args: string[], opts: RunOptions): Promise<RunResult> }` from doc 04 "CliRunner".

**`src/agent/core/session-types.ts`**

```ts
interface AgentSessionDeps {
  provider: Provider;
  model: string;               // 'google/gemma-4-31b-it' by default
  tools: ToolRegistry;
  permissions: PermissionGate;
  bus: EventBus;
  buildSystemPrompt(): Promise<string>;
  makeToolContext(signal: AbortSignal): ToolContext;
  secrets(): string[];         // keys to redact from errors (KeyStore.knownKeys)
  maxSteps: number;            // 20 for chat, 8 or 12 for workers
  contextBudgetTokens: number; // 32000 for chat, 16000 for workers
  maxOutputTokens: number;     // 8000
  temperature: number;         // 0.3
}
interface AgentSessionApi {
  readonly messages: readonly Message[];
  send(text: string): Promise<'done' | 'cancelled' | 'max_steps' | 'error'>;
  cancel(): void;
  resolveApproval(approvalId: string, decision: ApprovalDecision): void;
}
```

**`src/agent/workflow/types.ts`**

- `TaskKind`, `PlanTask`, `Plan`, `TaskResult` from doc 10.
- `type Spec = string` (notes.md text, format in `design/agent/briefs/SPEC-FORMAT.md`).
- `ConfigPatch` (the only way workers change `Config.json`; field names follow `template/Config.json`):

```ts
interface ConfigPatch {
  set?: { name?: string; timeLimit?: number; memoryLimit?: number };
  addSolutions?: { name: string; source: string; tag: SolutionTag }[]; // sourceType is filled by the scheduler from the extension
  validator?: { name: string; source: string; testsFilePath?: string };
  generators?: { name: string; source: string }[];
  checker?: { name: string; isStandard: true } | { name: string; isStandard: false; source: string; testsFilePath?: string };
  statements?: Record<string, { encoding: 'UTF-8'; name: string; legend: string; input: string; output: string; notes?: string }>;
  generatorScript?: { testset: string; scriptFile: string };
  manualTests?: { testset: string; input: string; group?: string; useInStatements?: boolean }[];
}
```

  (`SolutionTag` comes from `src/types.d.ts`; import it the same way other files do.)
- `ManagerDecision = { action: 'retry_with_hint'; taskId: string; hint: string } | { action: 'redo_task'; taskId: string; redoTaskId: string; hint: string } | { action: 'ask_user'; taskId: string; question: string }`.
- `interface Manager { makePlan(spec: Spec, recipe: Plan['recipe'], signal: AbortSignal): Promise<Plan>; decide(input: { spec: Spec; plan: Plan; failed: TaskResult; results: TaskResult[] }, signal: AbortSignal): Promise<ManagerDecision> }`.
- `WorkerOutcome = { summary: string; configPatch?: ConfigPatch; filesWritten: string[] }`, and `TaskResult.configPatch` is `ConfigPatch` too.
- `interface Worker { run(input: { task: PlanTask; spec: Spec; attempt: number; note?: string; fresh: boolean }, signal: AbortSignal): Promise<WorkerOutcome> }`.
- `Checkpoint = { name: string; ok: boolean; digest: string }`.
- `interface Checkpoints { check(task: PlanTask, spec: Spec, problemDir: string, signal: AbortSignal): Promise<Checkpoint>; runNoModelTask(task: PlanTask, spec: Spec, problemDir: string, signal: AbortSignal): Promise<{ checkpoint: Checkpoint; configPatch?: ConfigPatch }> }`.
- `WORKFLOW_LIMITS = { parallel: 4, workerStepsSimple: 8, workerStepsHard: 12, fixRounds: 3 } as const` (the only value export).

## Part 3: chat stub and fixtures

1. `src/agent/index.ts`: `export async function startChat(opts: { dir?: string; model?: string }): Promise<void>` that only prints `polyman chat is not ready yet`. W0b replaces it.
2. `src/cli.ts`: a `chat [dir]` command with `--model <id>`, lazy-loaded exactly like the `ai` command (`const loadChat = () => import('./agent/index.js')`). Same comment block style as the other commands.
3. Gemma fixtures for W1, recorded from the real API into `tests/fixtures/agent/openai/` in the same `.http` format as the existing files there (comment header, status line, headers, blank line, body). Names: `gemma-openrouter-text.http`, `gemma-openrouter-tool-call.http`, `gemma-openrouter-cost.http`:

```bash
source ~/.config/openrouter.env
B='https://openrouter.ai/api/v1/chat/completions'
T='[{"type":"function","function":{"name":"verify","description":"Run polyman verify","parameters":{"type":"object","properties":{"dir":{"type":"string"}},"required":["dir"]}}}]'
rec() { # $1 = name, $2 = body
  { echo "# request: OpenRouter, model google/gemma-4-31b-it, stream: true"
    echo "# Recorded from OpenRouter on $(date +%F)."
    curl -sN -i "$B" -H "Authorization: Bearer $OPENROUTER_API_KEY" -H 'Content-Type: application/json' -d "$2" \
      | tr -d '\r' | grep -v -i -E '^(date|set-cookie|cf-|server|x-request-id|access-control|vary|alt-svc):'
  } > "tests/fixtures/agent/openai/$1.http"
}
rec gemma-openrouter-text '{"model":"google/gemma-4-31b-it","stream":true,"messages":[{"role":"user","content":"Say hello in five words."}]}'
rec gemma-openrouter-tool-call '{"model":"google/gemma-4-31b-it","stream":true,"provider":{"require_parameters":true},"tools":'"$T"',"messages":[{"role":"user","content":"Run verify in the folder ."}]}'
rec gemma-openrouter-cost '{"model":"google/gemma-4-31b-it","stream":true,"usage":{"include":true},"messages":[{"role":"user","content":"Say ok."}]}'
```

   Check each file: real `data:` lines, ends with `data: [DONE]`, the existing `tests/agent/fixtures.test.ts` passes on them, and `grep -c sk-or-v1 tests/fixtures/agent/openai/gemma-*` is 0 for every file.

## Tests

- `tests/agent/contracts.test.ts`: imports every new contract file (catches broken imports) and checks `WORKFLOW_LIMITS`.
- `tests/cli.test.ts`: if it lists commands, add `chat`.
- All existing tests still pass.

## Done when

- `npm run build`, `npm run lint`, `npm test` pass. `node dist/cli.js chat` prints `polyman chat is not ready yet`.
- `git grep -n "sk-or-v1-[a-f0-9]"` finds nothing.
- One commit: `agent: contracts and ink setup`. Hamza pushes it.

## Do not

- Change existing provider code (except the one `costUsd` line).
- Write logic beyond Part 3.
