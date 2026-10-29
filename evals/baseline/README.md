# Single-loop baseline (W13)

Our pitch is "many small Gemmas checked by the CLI beat one long Gemma loop". This folder measures the long loop: one Gemma chat session with all the tools and no workflow builds a T1 problem from its spec. `compare.mjs` puts it next to the workflow runs of W11.

## How to run

```bash
npm run build
source ~/.config/openrouter.env && node evals/baseline/run.mjs --case pairs-sum
source ~/.config/openrouter.env && node evals/baseline/run.mjs --all
node evals/baseline/compare.mjs --case pairs-sum
```

`run.mjs` options:

- `--case <id>` (can be repeated) or `--all`: cases from `evals/cases/`.
- `--model <id>`: default `google/gemma-4-31b-it`.
- `--max-steps <n>`: model calls in the one turn, default 80.
- `--max-cost <usd>`: the runner cancels the turn above this, default 0.6. It is a safety net for the budget.
- `--max-minutes <n>`: the runner cancels the turn after this, default 40.
- `--rerender <dir>`: only writes `report.md` and `report.json` again from a result folder.

`compare.mjs` options:

- `--case <id>`: every W11 result in `evals/real/results/<case>-*` against every result here. `--latest` takes only the newest of each side.
- `--workflow <path>` and `--baseline <path>`: given results, a result folder or its `report.json` / `report.md`. Each flag can be repeated. Use this when the W11 results live in another worktree.

With more than one run on a side, verify and hidden checks are counted (`3/4`) and the other rows are averages.

## What one run does

1. A temp folder, `polyman new <case>`, `corpus/vendor/testlib.h` copied in (no network), and the case `spec.md` copied to `.polyman/agent/notes.md`.
2. One `AgentSession` built from the same parts as `createChatRuntime` in `src/agent/index.ts`: fs tools, cli tools, skills and notes, but no `start_workflow`. The chat prompt gets one more line: there is no `start_workflow`, do every step yourself.
3. OpenRouter with the preset's quirks plus `reasoning: { enabled: false }`, and the retry wrapper. Context budget, output tokens and temperature are the chat's (`GEMMA_BUDGETS`). Only the step limit is bigger: 80 instead of 20, to give it a fair chance.
4. The gate is in `auto-edit` mode and the runner approves every approval. Remote (Polygon) calls would be denied, an eval never touches Polygon.
5. One message: `Build the whole problem from .polyman/agent/notes.md: statement, main solution, brute force, wrong solutions, validator, generators, checker, Config.json. Run verify at the end and fix it until it passes.`
6. After the turn: `verify --json` run by the eval, then the hidden checks.

The hidden checks use `evals/cases/<case>/reference/`, the agent never sees it:

- reference main passes the agent's tests: `main.cpp` is added to `Config.json` as an `OK` solution and checked with `polyman test` (against the agent's main and checker).
- agent main passes the reference tests: the agent's `MA` source is compiled and run on `reference/tests`, the output is compared token by token with `reference/answers`, within 2x the time limit.
- wrong solutions caught by tests: every `reference/wa-*.cpp` is added with its expected tag and checked with `polyman test`. A catch counts only when the reference main passes the same tests, else every wrong solution "fails" for nothing.

`Config.json` is put back and the copied files are removed after the checks.

Note: the template from `polyman new` already passes `verify` (its own sample problem). So `verify passed` alone says little, the hidden checks are the real result.

## Output

`evals/baseline/results/<case>-<time>/` (git-ignored):

- `report.md`: the result fields of the W11 brief (verify passed, hidden checks, time, Gemma calls, tokens, cost), then the session, verify, hidden checks, failure boxes, tool errors and the last message. See `example-report.md`.
- `report.json`: the same numbers for `compare.mjs`.
- `events.jsonl`: every bus event with its time. `messages.json`: the whole conversation. `verify.json`, `data.json`, `problem/` (the agent's files, without tests and binaries).

The key is only read from the environment. Every file goes through a scrub that removes the key and anything that looks like `sk-or-v1-...`.

"Gemma calls" counts `usage` events, one per model call. "time" is the agent loop only, the checks after it are not counted.

## Results

Run on 2026-10-26, `google/gemma-4-31b-it`, reasoning off, 6 runs, $0.51 in total.

| case | verify | hidden checks | wrong caught | time | Gemma calls | tokens | cost | end |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| pairs-sum | no | 2/2 | 3/3 | 357 s | 80 | 1803172 | $0.1814 | out of steps |
| pairs-sum | yes | 2/2 | 3/3 | 237 s | 37 | 785604 | $0.0796 | done |
| max-subarray | yes | 2/2 | 3/3 | 196 s | 42 | 670415 | $0.0680 | done |
| max-subarray | yes | 2/2 | 3/3 | 301 s | 52 | 901834 | $0.0913 | done |
| bracket-depth | yes | 2/2 | 2/2 | 89 s | 5 | 86356 | $0.0095 | done |
| bracket-depth | yes | 2/2 | 2/2 | 250 s | 38 | 743546 | $0.0757 | done |

What I see in these runs:

- The single loop is better than I expected on T1: 5 of 6 runs pass verify and all 6 pass the hidden checks. T1 problems are easy, so this is not a surprise for Gemma.
- The failed pairs-sum run is a harness problem more than a model problem. The session's repeat guard blocks the 3rd identical call, even when files changed between the calls. Gemma fixed the validator, then called `verify {}` again and got "You already called verify with these arguments 2 times" 50 times in a row, until it ran out of steps. 5 of 6 runs hit this guard (8 to 50 blocked calls), mostly on `verify {}` and `generate`. I think the guard should reset after a write, this is for the chat too, not only the baseline.
- Input tokens are almost all of the cost: the whole 32k context is sent again on every call (about 20k input tokens per call), while the output of a whole run is only 3.5k to 4.4k tokens.
- No run kept a brute force solution in `Config.json`, even though the message asks for one. They wrote main, a TL solution and two WA solutions.
- The bracket-depth run with 5 calls wrote 17 files in one response (parallel tool calls), so it was very cheap.

The workflow column comes from the W11 runs with `compare.mjs`, they were not in this branch when this was written.
