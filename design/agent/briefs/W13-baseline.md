# W13: single-loop baseline (the number for the slide)

- Lane: C (Mazen). Tool: Claude Code (Opus). Branch: `hack/w13-baseline` from `feat/agent-hackday` after W0b is pushed (about 5:50). You can write it from 5:45 against the W0b brief.
- Time: 5:45 to 6:30 PM, then run it in wave 3. Uses the team key. Hamza merges it at the freeze (6:50).
- Read first: `design/agent/10-workflow-manager.md` (why: one long loop vs small tasks), `design/agent/briefs/W11-real-runs.md`, `design/agent/briefs/W0b-wiring.md` (`createChatRuntime`), and W11's code in `evals/real/`.

## Goal

Our whole pitch is "many small Gemmas checked by the CLI beat one long Gemma loop". This task measures it. Same problem, same model, same tools, two ways:

1. **Workflow** (W11): the manager, the workers, the checkpoints.
2. **Baseline** (this task): one Gemma session with all the tools, told to build the whole problem from the spec.

## You own

- `evals/baseline/run.mjs`
- `evals/baseline/compare.mjs`
- `evals/baseline/README.md`

## Build

1. `node evals/baseline/run.mjs --case pairs-sum`:
   - Same setup as W11: temp folder, `create_problem`, spec copied to `.polyman/agent/notes.md`.
   - One `AgentSession` from `createChatRuntime`, but **without** the `start_workflow` tool. If `createChatRuntime` has no option for that, build the registry yourself from the same parts as `src/agent/index.ts`.
   - The gate auto-approves everything (as W11 does).
   - `maxSteps` 80 (a fair chance), other budgets as the chat.
   - One message: `Build the whole problem from .polyman/agent/notes.md: statement, main solution, brute force, wrong solutions, validator, generators, checker, Config.json. Run verify at the end and fix it until it passes.`
   - Write the same `events.jsonl` and `report.md` as W11 (import W11's report code, do not copy it), into `evals/baseline/results/<case>-<time>/`.
2. `node evals/baseline/compare.mjs --case pairs-sum`: finds the latest W11 result and the latest baseline result for the case and prints a markdown table:

| | Workflow | One loop |
| --- | --- | --- |
| verify passed | | |
| hidden checks passed | | |
| time | | |
| Gemma calls | | |
| tokens | | |
| cost | | |
| wrong solutions caught by tests | | |

3. Run both on every T1 problem at least twice in wave 3 (W11 runs come from your own wave 3 runs).

## Done when

- It runs end to end on pairs-sum and the comparison table is real.
- The table goes to Monir for the slide and to Hamza. Only real numbers, even if the baseline wins on some row.
- One commit: `evals: single-loop baseline and comparison`. Pushed.
