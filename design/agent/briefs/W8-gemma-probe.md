# W8: Gemma probe

- Lane: C (Mazen). Tool: Claude Code (Opus). Branch: `hack/w8-probe`, in Mazen's own checkout (it touches no shared file).
- Time: 2:45 to 4:00 PM. It does not need the contracts, so it starts first.
- Uses the **second key** Hamza made for the team (never Hamza's main key, never in the repo): `export OPENROUTER_API_KEY=...` in that terminal. Budget: under $0.50.
- Read first: `design/agent/03-providers.md` (Gemma quirks, Budgets), `design/agent/10-workflow-manager.md` (Ten rules).

## Goal

Real numbers on how Gemma 4 behaves with our kind of tools, before we tune anything. These numbers set the budgets and go on the demo slide.

## You own

- `evals/probe/probe.mjs`
- `evals/probe/cases.mjs`
- `evals/probe/README.md`
- `evals/probe/results/` (add `evals/**/results/` to `.gitignore` in your commit, that one line only)

Plain Node 20 ESM (`.mjs`), `fetch`, no dependencies, not part of `tsc` (outside `src/`).

## Build

### `cases.mjs`

About 10 cases. Each: a system prompt, a user message, the tool specs, and what a correct answer is. Use our real tool names and shapes (from `design/agent/04-harness.md` "First tool list" and `10-workflow-manager.md`):

1. "Run verify" with `verify` among 6 tools: correct = one `verify` call.
2. "Read solutions/main.cpp" : `read_file` with the right path.
3. "Write a validator that reads n (1..2e5) then n numbers": `write_file` with path `validator/val.cpp` and content containing `registerValidation`.
4. "Fix the off by one: replace `readInt(0,` with `readInt(1,` in validator/val.cpp": `edit_file` with exact `old_text`.
5. Two independent reads in one request: two calls (parallel tool calls), or one then the other.
6. A plan request with `submit_plan` and a small spec: args parse as JSON and have `tasks` with `kind`, `dependsOn`, `ownsFiles`.
7. `decide` after a failed validator 3 times: one of the 3 actions.
8. A long content case: write a 150-line generator: JSON still valid.
9. A trap: no tool needed ("what does TO mean?"): answers with text, no tool call.
10. A case where the model is likely to write the call as text (ask for "the exact tool call"): detect it.

### `probe.mjs`

`node evals/probe/probe.mjs --models google/gemma-4-31b-it,google/gemma-4-26b-a4b-it --runs 3`

- For each model, case and run: one non-streaming call to `https://openrouter.ai/api/v1/chat/completions` with `tools`, `provider: { require_parameters: true }`, `usage: { include: true }`, `temperature: 0.3`.
- Record: tool calls (names, raw args), whether the args parse with `JSON.parse`, whether they parse after the simple repairs (strip code fences, cut after the last balanced `}`), correct or not (per the case's check function), tool call written as text (regex for a known tool name followed by `(` or `"name":`), latency ms, tokens, cost, `reasoning` present or not.
- Max 4 requests at a time. Retry once on 429 or 5xx.
- Write `evals/probe/results/<date>.json` (all raw data) and `evals/probe/results/<date>.md`:

```
| model | correct | valid JSON | valid after repair | call as text | parallel calls | p50 latency | cost |
```

  plus one line per failed case with the raw output (first 200 chars).

### `README.md`

How to run it, what each column means, and the results table from the run (copied by hand after the run).

## Done when

- The script runs on both models with `--runs 3` and writes the two result files.
- The results table is in the README and sent to Hamza in one message. This is the input for Hamza's budgets and the demo slide.
- One commit: `evals: gemma probe`, pushed to `origin hack/w8-probe`.

## If late

1 run per case instead of 3. Only the 31B model.
