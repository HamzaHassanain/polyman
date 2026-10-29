# W0b: wiring (`polyman chat` for real)

- Lane: A (Hamza). Tool: Claude Code (Opus). Runs in the main checkout on `feat/agent-hackday`, after the wave 1 merge.
- Time: 5:10 to 5:50 PM.
- Read first: `design/agent/05-chat-ui.md` (Start and exit), `design/agent/10-workflow-manager.md`, and the merged code: `src/agent/**`.

## Goal

Connect everything: key, provider, tools, gate, session, scheduler, TUI. After this, `node dist/cli.js chat ./pairs-sum` is a working chat that can run a whole workflow.

## You own

- `src/agent/index.ts` (replace the stub)
- `src/agent/plain.ts`
- `src/agent/tools/workflow-tool.ts`
- `src/agent/tools/notes-tools.ts`
- `src/cli.ts` (only the `chat` command block)
- `tests/agent/wiring.test.ts`

## Build

### `tools/notes-tools.ts`

- `read_notes` (read, `{}`), `write_notes` (write, `{ content: string }`): `.polyman/agent/notes.md` inside the problem folder. Before a folder exists, keep the notes in memory and write them when `create_problem` runs (listen for `problem_dir_changed` on the bus).

### `tools/workflow-tool.ts`

`start_workflow` (risk `write`, needs a problem): args `{ recipe: 'build_problem' | 'fix_verify' | 'strengthen_tests' }`.

- Reads the spec from notes. Empty or missing `# Idea` / `# Constraints` / `# Samples`: error `Write the spec first with write_notes (see the format in your instructions).`
- Builds a `WorkflowScheduler` with: `GemmaManager`, `GemmaWorker` (with the real factories: `AgentSession`, `DefaultToolRegistry`, `FolderSandbox`, `DefaultPermissionGate` in `plan-approved` mode, the tool lists from W4 and W7), `CliCheckpoints(new NodeCliRunner())`, the chat's own gate (for `askPlan`) and bus.
- Runs it with the turn's signal (esc stops the workflow).
- Returns the `summary` as `content` and the results as `data`.
- Timeout: 30 minutes.

### `plain.ts` (works without the TUI)

`runPlain(session, bus, { problem, model })`: a line-mode chat with `readline`, no Ink. It prints each event as one line (`> tool(args)`, `  = result first line`, `[task t4] attempt 2: checkpoint failed: ...`, the plan as a numbered list), reads the user's message from stdin, and asks approvals as `Allow write_file solutions/main.cpp? [y/N/a(lways)]` and `Run this plan? [y/N]`. `ctrl+c` cancels the turn, a second one exits. This is Hamza's way to test and tune while the TUI is not merged, and the demo fallback if the TUI breaks.

### `index.ts`

`startChat({ dir, model })`:

1. Without `--plain`: `process.stdin.isTTY && process.stdout.isTTY`, else print `polyman chat needs a terminal (or use --plain).` and exit code 2.
2. `createChatProvider({ model })` from `providers/gemma` (W1): provider, model and secrets. An `error` result: print it, exit 2.
3. `--model` is passed through; with no `--model` and no `ai.json` default it is `google/gemma-4-31b-it`.
4. Problem dir: `dir` if it has `Config.json`; else `null` and the chat starts in "new problem" mode (the folder name is used by `create_problem`).
5. Build: `SimpleEventBus`, `DefaultPermissionGate(bus, 'ask')`, `NodeCliRunner`, `DefaultToolRegistry` with `fsTools`, `cliTools`, `skillTools`, notes tools, `start_workflow`. `FolderSandbox` on the problem dir (re-made when `create_problem` changes the dir). the provider from step 2. `ChatPromptBuilder`. `AgentSession` with `GEMMA_BUDGETS` and `secrets` from step 2.
6. `--plain`: `await runPlain(session, bus, { problem, model })`. Else `await startTui(session, bus, { problem, model })` (dynamic `import('./tui/index.js')` so Ink loads only here). If that import fails (TUI not merged yet), print one line and fall back to `runPlain`.
7. On exit: cancel any running turn (kills child processes), print `Bye.`.

### `cli.ts`

`chat [dir]` with `--model <id>` and `--plain`. Keep the dynamic `import('./agent/index.js')`. Update the command's help text.

## Tests

`tests/agent/wiring.test.ts`: build everything with `MockProvider` instead of OpenRouter (export a `createChatRuntime(opts)` from `index.ts` that does steps 3 to 5 and returns `{ session, bus, gate }`, so it is testable without a TTY). A scripted turn that calls `list_files` gives a `tool_result`. `start_workflow` without a spec gives the error. `runPlain` with a fake stdin: a message, a `y` to an approval, the printed lines.

## Done when

- Build, lint, test pass.
- Manual: `node dist/cli.js chat /tmp/pairs-sum --plain` works; `node dist/cli.js chat /tmp/pairs-sum` opens the TUI (if W5 is merged); "hello" gets a Gemma answer; `esc` interrupts; `ctrl+c` twice exits.
- Commit: `agent: wire polyman chat`. Push.
