# W7: Gemma brains (prompts, manager, worker, chat prompt, skills)

- Lane: D (Faraj). Tool: Claude Code (Opus). Branch: `hack/w7-brains`. Worktree: `../pm-w7`.
- Time: 3:20 to 4:50 PM.
- Module style: CommonJS like `src/agent/providers/`, relative imports without an extension.
- Read first: `design/agent/10-workflow-manager.md` (all), `design/agent/briefs/SPEC-FORMAT.md` (the chat agent must write the spec in exactly this format), `design/agent/06-problem-agent.md` (Notes file, Skills, System prompt, The Think step), `design/agent/03-providers.md` (Gemma quirks, Budgets), `src/agent/workflow/types.ts`, `src/agent/core/session-types.ts`, `src/agent/tools/types.ts`, `src/agent/providers/types.ts`, `src/agent/providers/mock.ts`, the files in `template/instructions/`.

## Goal

Everything that talks to Gemma in the workflow: the prompts, the manager (plan and decide), the worker (one task as a small session), plus the chat agent's system prompt and the skills loader.

## You own

- `src/agent/workflow/prompts.ts`
- `src/agent/workflow/manager.ts`
- `src/agent/workflow/worker.ts`
- `src/agent/core/prompt.ts`
- `src/agent/skills.ts`
- `tests/agent/workflow/prompts.test.ts`, `manager.test.ts`, `worker.test.ts`, `tests/agent/core/prompt.test.ts`, `tests/agent/skills.test.ts`

You use `AgentSession` (W2), `DefaultToolRegistry`, `FolderSandbox`, `DefaultPermissionGate` (W3), `fsTools`, `cliTools` (W4) through their contracts. They are not merged while you work: import the classes by their planned paths in the code (`../core/session`, `../tools/registry`, ...) **only in `worker.ts`**, and in tests use fakes through the contract interfaces. If the build fails because a file is missing, add a factory parameter instead (`createSession: (deps) => AgentSessionApi`) and let W0b pass the real one. Prefer the factory: it keeps your branch building on its own.

## Build

### `skills.ts`

- `listSkills(): Promise<{ name: string; title: string; line: string }[]>`: reads `template/instructions/*.md` and `template/instructions/commands/*.md` from the installed package (resolve from this file: `path.join(__dirname, '..', '..', 'template', 'instructions')`, which works from `src/agent/` in tests and from `dist/agent/` after the build), first `#` heading as title, first non-empty paragraph line as `line`.
- `loadSkill(name): Promise<string>`.
- Tools (export `skillTools(): Tool[]`): `list_skills` (read) and `load_skill` (read, `{ name: string }` with an enum of the names).

### `prompts.ts`

Short, plain prompts, one rule per line, most important first (doc 06 "System prompt"). Export functions, not big constants:

- `managerPlanPrompt(recipe, recipeDescription)`: the manager's system prompt. It must say: you fill in a fixed recipe, you do not invent task kinds, every wrong approach in the spec gets one `wrong_solution` task, file names follow the template layout, call `submit_plan` exactly once.
- `managerDecidePrompt()`: pick one action with `decide`. When to use each.
- `workerPrompt(kind: TaskKind)`: one prompt per kind. Each says: the task, the files you may write, the skill to read first (`validator` for the validator, `generators` + `generator-script` for generators, `solutions` + `cpp-performance` for solutions, `statements` for the statement, `checker` for the critic is not needed), the check that will run after you finish, and `call finish_task when done`. Hard rules per kind:
  - `main_solution`: C++17, read the spec's intended solution, use 64-bit where the spec says so, test it with `run_solution` on the samples before finishing.
  - `brute_force`: the simplest correct algorithm, ignore time limits, never copy the main idea. You do not see the main solution.
  - `wrong_solution`: implement exactly the wrong approach in `params.approach`, nothing else wrong.
  - `validator`: testlib `registerValidation`, every constraint from the spec, `readEoln` / `readEof`, plus validator tests (valid and invalid) as the `validator.md` skill says.
  - `generators`: testlib `registerGen`, cover each edge case in the spec, a generator script with small, random and max tests.
  - `statement`: legend, input, output, notes, examples from the spec samples. Plain English.
  - `statement_critic`: compare the statement with the spec, call `review({ ok, issues })`.
  - `fix`: read the digest, find the cause before editing, change only the files you own, never weaken a test to make a wrong solution pass.
- `chatSystemPrompt(env)`: the chat agent (doc 06 system prompt + Think step rules + the spec format from `SPEC-FORMAT.md`, which it writes with `write_file` to `.polyman/agent/notes.md` + "when the user says build, call `create_problem` if there is no folder, then `start_workflow` with recipe `build_problem`").

### `manager.ts`

`class GemmaManager implements Manager`, constructor `{ provider: Provider; model: string }`.

- `makePlan`: one model call (no session needed) with the system prompt, the spec, the recipe description, and one tool `submit_plan` whose parameters are the JSON schema of `Plan` (write the schema by hand here). Up to 3 steps: if the model answers with text, append `Call submit_plan now.` and call again. Parse the args, return the `Plan`. Never check the plan here (W6 does).
- `decide`: same pattern with the `decide` tool (schema = `ManagerDecision`), input = the spec, a short table of task results (id, kind, status, one-line summary) and the failed task's digest. Fallback after 3 steps: `{ action: 'ask_user', question: 'The task <id> failed 3 times: <digest first line>' }`.

### `worker.ts`

`class GemmaWorker implements Worker`, constructor `{ provider; model; problemDir; runner: CliRunner; bus: EventBus; createSession: (deps: AgentSessionDeps) => AgentSessionApi; createRegistry; createSandbox; createGate }` (factories so W0b wires the real classes).

`run({ task, spec, attempt, note, fresh }, signal)`:

1. Tools by kind: always `read_file`, `list_files`, `load_skill`, `finish_task`; plus `write_file`, `edit_file` for kinds that own files; plus `run_solution` (solutions), `test_target` (validator), `generate` (generators), `verify` (fix); `review` instead of the write tools for `statement_critic`.
2. `finish_task` tool (made here): `{ summary: string; configPatch?: object }`, risk `read`. When called, store the values and stop the session (cancel after this step).
3. `review` tool (critic only): `{ ok: boolean; issues: string[] }`, stored as the outcome summary.
4. Sandbox with `allowWrite = task.ownsFiles`. Gate in mode `plan-approved` (writes allowed inside the sandbox list, remote never present).
5. Session deps: `maxSteps` = `WORKFLOW_LIMITS.workerStepsHard` for `main_solution`, `validator`, `fix`, else `workerStepsSimple`; `contextBudgetTokens: 16000`; system prompt = `workerPrompt(kind)`; first user message = the spec + the task brief + params + (if `note`) `Last attempt failed: <note>`.
6. Keep one session per task id across attempts when `fresh` is false; make a new one when `fresh` is true.
7. Forward the session's `usage` events to `bus` (so the workflow total cost is right) but not its text deltas (the UI shows tasks, not worker text). Tag tool events with the task id if the event type allows; else drop them.
8. Return `{ summary, configPatch, filesWritten }` (files from successful `write_file` / `edit_file` calls). No `finish_task` before the step limit: summary `stopped at the step limit without finish_task`.

### `core/prompt.ts`

`class ChatPromptBuilder` with `build(): Promise<string>` = `chatSystemPrompt(env)` + skills index + environment (OS, `g++ --version` first line or "missing", polyman version from `package.json`) + problem state (notes.md if present, short `Config.json` summary, file names 2 levels deep). Cache the environment part.

## Tests (MockProvider, fakes for session, registry, sandbox and gate)

- `skills`: lists the real template files, loads one, unknown name errors.
- `prompts`: every `TaskKind` has a prompt, each names its check and `finish_task`; the manager prompt names `submit_plan`.
- `manager`: a mock answering with `submit_plan` gives the plan; text first then the tool call works; 3 text answers throw a clear error; `decide` fallback.
- `worker`: tool list per kind; `finish_task` stops and returns the patch; `fresh` makes a new session; the note is in the first message; step limit gives the right summary; usage is forwarded to the bus.
- `prompt.ts`: includes notes and config summary when a problem folder exists (temp folder from `template/`).

## Done when

`npm run build`, `npm run lint`, `npm test` pass. One commit: `agent: gemma manager, workers, prompts and skills`.

## If late (4:50)

Skip `statement_critic` and `review`. `chatSystemPrompt` without the environment part.
