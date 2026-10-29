# Task briefs

One brief per task. Give the coding agent the brief file and tell it to do exactly that task. When it is done: push your `hack/...` branch to [Ahmad-Faraj/polyman](https://github.com/Ahmad-Faraj/polyman) and open a PR into `feat/agent-hackday`. Faraj reviews it, Hamza merges it at the next merge time. This page is the short version of each one, in plain words. The full plan and the timeline are in [11-hackday-plan.md](../11-hackday-plan.md).

Lanes: **A** Hamza (core, about 45% of the code), **D** Faraj (workflow manager, about 30%, main reviewer), **B** Monir (terminal UI, about 25%), **C** Mazen (tests and evals, all day). We started building at 2:45 PM; the times below are the new plan.

| Task | Who | When | Brief |
| --- | --- | --- | --- |
| W0 Setup and contracts | Hamza | 2:45 to 3:20 | [W0-setup-and-contracts.md](W0-setup-and-contracts.md) |
| W1 Gemma on OpenRouter | Hamza | 3:20 to 4:00 | [W1-provider.md](W1-provider.md) |
| W2 Agent session | Hamza | 3:20 to 4:50 | [W2-session.md](W2-session.md) |
| W3 Tool infrastructure | Hamza | 3:20 to 4:15 | [W3-tool-infra.md](W3-tool-infra.md) |
| W4 CLI runner and tools | Hamza | 3:20 to 4:50 | [W4-runner-and-tools.md](W4-runner-and-tools.md) |
| W6 Workflow scheduler | Faraj | 3:20 to 4:50 | [W6-scheduler.md](W6-scheduler.md) |
| W7 Gemma brains | Faraj | 3:20 to 4:50 | [W7-gemma-brains.md](W7-gemma-brains.md) |
| W0b Wiring | Hamza | 5:10 to 5:50 | [W0b-wiring.md](W0b-wiring.md) |
| W5 Terminal UI | Monir | 3:20 to 4:50 | [W5-tui.md](W5-tui.md) |
| W9 Plan view | Monir | 4:50 to 5:45 | [W9-plan-view.md](W9-plan-view.md) |
| T1 Test problems | Mazen | 2:45 to 5:50 | [T1-test-problems.md](T1-test-problems.md) |
| T2 Broken problems | Mazen | 4:15 to 4:50 | [T2-broken-problems.md](T2-broken-problems.md) |
| W8 Gemma probe | Mazen | 2:45 to 4:00 | [W8-gemma-probe.md](W8-gemma-probe.md) |
| W10 End-to-end test | Faraj | 5:10 to 5:45 | [W10-e2e-test.md](W10-e2e-test.md) |
| W11 Real runs | Mazen | 5:10 to 5:45, then all of wave 3 | [W11-real-runs.md](W11-real-runs.md) |
| W12 Safety tests | Mazen | 5:10 to 5:45 | [W12-safety-tests.md](W12-safety-tests.md) |
| W13 Single-loop baseline | Mazen | 5:45 to 6:30, then runs | [W13-baseline.md](W13-baseline.md) |
| D1 Demo material | Monir + Mazen | 6:05 to 7:20 | [D1-demo.md](D1-demo.md) |

## W0: Setup and contracts (Hamza, 2:45 to 3:20)

Lays the ground so four people and about ten coding sessions can build at the same time without stepping on each other.

Builds:

- Ink and React installed; only `src/agent/tui/` is ESM
- The contract files: types for events, tools, the CLI runner, the session and the workflow (interfaces only, no logic)
- A `polyman chat` stub command
- Three real Gemma replies recorded as test fixtures

Done when: Build, lint and tests green, pushed at 3:20. The contracts are frozen after this.

Needs: nothing. Gives: the contracts every other task codes against.

## W1: Gemma on OpenRouter (Hamza, 3:20 to 4:00)

Makes Gemma 4 a first-class model in the provider layer that already exists. Small on purpose.

Builds:

- Gemma 4 models in the OpenRouter preset, with prices and tool support
- Request options: `require_parameters` and the cost of each call
- A clear message when OpenRouter says there are no credits (402)
- `gemma.ts`: the default model, the budgets (20 steps, 32k context, 8 KB tool results) and `createChatProvider()`

Done when: Replaying the three recorded Gemma replies through the provider gives the right events.

Needs: W0 fixtures. Gives: the model to W0b, W11, W13.

## W2: Agent session (Hamza, 3:20 to 4:50)

The loop at the heart of the agent: ask Gemma, run the tools it asks for, repeat until it is done. The same class runs the chat and every workflow worker.

Builds:

- Event bus: every step becomes an event that the UI draws
- Session: step limit, `esc` cancels, errors with keys redacted
- Text tool calls: Gemma sometimes writes a tool call as text, we parse it
- Context trim: stay under 32k tokens, cut old tool output first

Done when: Tests with the fake model (MockProvider) pass for every stop reason.

Needs: W0. Gives: the loop W7 and W0b run.

## W3: Tool infrastructure (Hamza, 3:20 to 4:15)

The safety layer every tool call passes through before anything touches the disk.

Builds:

- Registry: find the tool, check the arguments, timeout, cut the result to 8 KB
- Sandbox: no path outside the problem folder, no symlink escape, protected files
- Permissions: ask, auto-edit and plan-approved modes, approval events for the UI

Done when: Tests for escapes, protected files and every permission mode pass.

Needs: W0. Gives: safe tools to W4, W7, W0b. Mazen attacks it in W12.

## W4: CLI runner and tools (Hamza, 3:20 to 4:50)

The hands of the agent: the tools Gemma calls, all built on real polyman commands.

Builds:

- CLI runner: spawns polyman with `--json`, one run at a time (a lock), kills the whole process tree on cancel
- File tools: `list_files`, `read_file`, `write_file`, `edit_file`
- Polyman tools: `create_problem`, `generate`, `validate`, `run_solution`, `test_target`, `verify`
- Short digests of the JSON reports, so Gemma sees what failed in a few lines

Done when: Tests with a fake CLI and with the real one pass.

Needs: W0. Gives: the tools to W6 checkpoints, W7 workers, W0b.

## W6: Workflow scheduler (Faraj, 3:20 to 4:50)

The body of the workflow manager. Plain code, not the model: it runs the plan and decides with real checks.

Builds:

- Recipes: `build_problem`, `fix_verify`, `strengthen_tests`, and checks on every plan
- Scheduler: dependency order, up to 4 tasks at once, the retry ladder
- Checkpoints: compile, run on samples, test the validator, verify, with short error digests
- Config patches: only the scheduler writes `Config.json`

Done when: Tests with a fake manager, fake workers and fake checkpoints pass.

Needs: W0. Gives: the engine W0b starts with `start_workflow`.

## W7: Gemma brains (Faraj, 3:20 to 4:50)

Everything that talks to Gemma in the workflow: what each role is told and how its answers are used.

Builds:

- Prompts for the chat agent, the manager and each kind of worker
- Manager: fills a recipe into a plan; on a failure picks hint, redo or ask the user from a fixed list
- Worker: one task = one small session with only its tools and its own files
- Skills loader: the template's instructions as short skill files

Done when: Tests with the fake model pass for plan, decide and run.

Needs: W0, W2. Gives: the manager and workers to W6 and W0b.

## W0b: Wiring (Hamza, 5:10 to 5:50)

Connects all the parts into one command: `polyman chat`.

Builds:

- `index.ts`: key, provider, tools, gate, session, UI
- `--plain`: a line mode that works without the Ink UI (Hamza's fallback)
- The `start_workflow` tool and the notes tools (the spec lives in `.polyman/agent/notes.md`)
- The `chat` command in `cli.ts`

Done when: `polyman chat --plain` talks to real Gemma and runs a workflow; the full UI opens when W5 is merged.

Needs: the 4:50 merge. Gives: the product. W10, W11, W13 and Mazen's manual tests use it.

## W5: Terminal UI (Monir, 3:20 to 4:50)

What the judges see: a chat app in the terminal that feels like Claude Code.

Builds:

- Store: turns events into screen state (pure code, tested)
- Components: messages, tool calls with their results, the approval prompt, the status line
- Keys: enter, `esc` to interrupt, `shift+tab` for the mode, `ctrl+c` twice to exit
- A fake session that replays a scripted demo, so Monir never waits for Hamza

Done when: The dev run works in a real terminal and looks like the sample screens. Pushed by 4:50.

Needs: W0 contracts only. Gives: the UI W0b opens.

## W9: Plan view (Monir, 4:50 to 5:45)

The workflow live on screen, like a todo list that updates itself.

Builds:

- Plan approval box: run, edit or cancel
- Live task tree: spinner, attempt number, checkpoint result
- `ctrl+o` on a task shows its tool calls

Done when: Matches sample screens 2, 3 and 4 on the fake session. Pushed by 5:45.

Needs: Monir's own W5 branch. Gives: the main demo screen.

## T1: Test problems (Mazen, 2:45 to 5:50)

Three problems with a known good answer: the ground truth we measure Gemma against, and the demo problem. Building them is how Mazen learns polyman.

Builds:

- pairs-sum (first, by 4:15), max-subarray, bracket-depth
- For each: the spec in the notes format, main + brute force + wrong solutions, reference tests
- Hidden checks that W11 and W13 run on Gemma's work

Done when: `verify` passes on each problem, and every wrong solution fails at least one test.

Needs: nothing. Gives: cases to W10, W11, W13 and the demo.

## T2: Broken problems (Mazen, 4:15 to 4:50)

Three copies of pairs-sum, each with one planted bug. They test the fix recipes and are the backup demo.

Builds:

- weak-tests: a wrong solution passes everything
- validator-bound: the validator accepts n = 0
- main-overflow: main uses `int`, the brute force catches it
- `expected.md` per case: the failing step and the right fix

Done when: Each fails `verify` exactly at the expected step; the fix by hand makes it pass.

Needs: pairs-sum. Gives: the `fix_verify` test and the 6:05 cut-line demo.

## W8: Gemma probe (Mazen, 2:45 to 4:00)

Real numbers on how Gemma 4 uses our kind of tools, before we tune anything.

Builds:

- About 10 cases with our real tool names and shapes
- A script that runs each case several times on OpenRouter
- A table: right tool, valid JSON, latency, cost, with and without reasoning

Done when: The table is in Hamza's hands by 4:00.

Needs: the team key. Gives: the budgets (Hamza) and numbers for the slide.

## W10: End-to-end test (Faraj, 5:10 to 5:45)

Proves the whole stack works with a fake Gemma, without spending money, in every `npm test`.

Builds:

- A scripted fake model per role (manager, each worker)
- Builds pairs-sum in a temp folder through the real tools and the real `verify`
- A second test: the validator checkpoint fails, the retry fixes it

Done when: Pushed by 5:45, green in `npm test`.

Needs: the 4:50 merge, pairs-sum. Gives: a safety net for every later fix.

## W11: Real runs (Mazen, 5:10 to 5:45, then all of wave 3)

Runs the full workflow with real Gemma on the test problems, with no human, and says exactly what went wrong.

Builds:

- `run.mjs --case` and `--all`
- Per run: `events.jsonl` and `report.md`: verify, hidden checks, time, calls, tokens, cost
- Every failure sorted into a box, so it goes to the right owner

Done when: One full run on pairs-sum with a report.

Needs: W0b, T1. Gives: the wave 3 tuning loop and the slide numbers.

## W12: Safety tests (Mazen, 5:10 to 5:45)

Tries to break the sandbox and the permissions on purpose, like an attacker or a confused model. Our proof that the agent is safe.

Builds:

- Path escapes: `..`, absolute paths, the sibling folder, symlinks
- Protected files, and workers writing outside their own files
- Permission modes, deny, cancel; huge outputs, timeouts, bad arguments, key redaction

Done when: At least 25 tests, suite green, a bug list (or "no bugs") sent to Hamza.

Needs: W3, W4 merged. Gives: bug reports to Hamza, a line in the PR.

## W13: Single-loop baseline (Mazen, 5:45 to 6:30, then runs)

Measures our pitch: the same problem, the same Gemma, built by one long loop versus our workflow.

Builds:

- One session with all the tools and no workflow, same report as W11
- `compare.mjs`: a side-by-side table (verify, hidden checks, time, calls, tokens, cost)
- Runs on every test problem, at least twice

Done when: A real comparison table, sent to Monir for the slide by 6:40.

Needs: W0b, W11. Gives: the main number on the slide.

## D1: Demo material (Monir + Mazen, 6:05 to 7:20)

Everything for the 3-minute demo except the live run.

Builds:

- Monir: the one slide (real numbers only), the README section, the demo terminal
- Mazen: the backup recording, the final numbers

Done when: The slide is ready, the recording plays, the README section is in.

Needs: W8, W11, W13 numbers. Gives: the submission.

Also in this folder: [SPEC-FORMAT.md](SPEC-FORMAT.md), the format of the problem spec (`notes.md`) that the chat agent writes and the workflow reads.
