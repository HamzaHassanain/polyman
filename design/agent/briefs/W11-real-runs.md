# W11: real runs with Gemma

- Lane: C (Mazen). Tool: Claude Code (Opus). Branch: `hack/w11-real-runs` from `feat/agent-hackday` after the 5:10 merge. Uses the team key.
- Time: 5:10 to 6:05 PM, then used all through wave 3.
- Read first: `design/agent/briefs/T1-test-problems.md`, `design/agent/briefs/SPEC-FORMAT.md`, `src/agent/index.ts` (`createChatRuntime`), `src/agent/workflow/**`.

## Goal

A script that runs the full workflow with **real Gemma** on the T1 problems, with no human, and writes a report that says exactly what went wrong. Wave 3 tuning lives on it.

## You own

- `evals/real/run.mjs`
- `evals/real/report.mjs`
- `evals/real/README.md`

Plain Node ESM (`.mjs`), imports the built CommonJS code from `dist/agent/` (default import, then destructure).

## Build

`node evals/real/run.mjs --case pairs-sum [--model google/gemma-4-31b-it] [--parallel 4]`

1. Temp folder. Run `create_problem` with the real CLI. Copy `evals/cases/<case>/spec.md` to `.polyman/agent/notes.md`.
2. `createChatRuntime` with the real provider from `createChatProvider()` (OpenRouter + Gemma, key from `OPENROUTER_API_KEY`), gate in `plan-approved` mode (auto-approve the plan).
3. Call the `start_workflow` tool directly with `build_problem`. Record every bus event to `events.jsonl`.
4. After it ends, run `verify --json` and the case's hidden checks from T1: the reference main solution passes the agent's tests (`run` with the reference file copied in under a new name), and the agent's main solution passes the reference tests.
5. `report.md` in `evals/real/results/<case>-<time>/`:
   - result (verify passed or not, hidden checks), time, Gemma calls, tokens, cost
   - per task: attempts, final status, checkpoint digests of each failed attempt
   - every tool error (`isError` results) with the tool name and first line
   - a "Failure boxes" section that sorts every problem into the boxes of plan section 9 (broken JSON, wrong tool, plan invalid, unclear digest, same mistake on retry, out of steps)
6. Also `node evals/real/run.mjs --all` for every case in `evals/cases/`, and a short summary table at the end.

## Done when

It runs on `pairs-sum` end to end with real Gemma and writes the report (whatever the result). Commit: `evals: real gemma runs and report`.
