# Real runs

The whole `build_problem` workflow with real Gemma on the T1 cases in `evals/cases/`, with no human. The report says what went wrong and sorts each problem into the failure boxes of plan section 9, so the right owner fixes it.

## How to run

```bash
npm run build
source ~/.config/openrouter.env        # or: export OPENROUTER_API_KEY=...
node evals/real/run.mjs --case pairs-sum
node evals/real/run.mjs --all          # every case, then a summary table
```

Options:

- `--model id`: OpenRouter model id (default `google/gemma-4-31b-it`).
- `--parallel N`: tasks at the same time (default: `WORKFLOW_LIMITS.parallel`).
- `--reasoning off|on`: default `off`, the probe showed it is better and 3 to 4 times cheaper.
- `--max-cost USD`: stop a case when its Gemma cost goes over this (default 0.6).

`node evals/real/report.mjs <results folder>` builds `report.md` again from `run.json` and `events.jsonl`, for when you change the report rules.

## What one run does

1. Makes a temp folder and runs the real `create_problem` tool (`polyman new` + `download-testlib`). It copies `corpus/vendor/testlib.h` when the download fails. Then it writes `spec.md` of the case to `.polyman/agent/notes.md`.
2. Builds `createChatRuntime` with the provider from `createChatProvider()` (OpenRouter, key from `OPENROUTER_API_KEY`, an empty home so a local `ai.json` does not change the model). The runner approves the plan and denies any other approval.
3. Calls the `start_workflow` tool with `build_problem` directly.
4. After it ends, runs `polyman verify --json` and two hidden checks:
   - the reference `main.cpp` is copied in as `ref-main` (tag OK) and `polyman run ref-main --all` must give OK on every test of the agent,
   - the agent's MA solution is compiled with `g++ -O2` and must match `reference/answers/` on every reference test, inside the time limit.
5. Writes `evals/real/results/<case>-<time>/` (git-ignored): `events.jsonl`, `run.json`, `verify.json` and `report.md`. The work folder in `/tmp` is kept, its path is in the report.

The scheduler, manager, worker, tool and checkpoint classes are the product ones. Two things differ from `polyman chat`, only to see more:

- The worker sessions get a tap on their bus. In the product their tool events stay inside the worker, so without the tap the report could not list worker tool errors.
- The provider gets `reasoning: { enabled: false }` (or `true` with `--reasoning on`). The product sends no reasoning field today.

## The report

- Result: workflow, verify, the hidden checks, time, Gemma calls, tokens, cost.
- The plan, then per task: attempts, final status and the digest of each failed attempt.
- Gemma calls per manager step and per task.
- Every tool error inside workers (`isError` results), with the tool and the first line.
- Failure boxes. The rules (`sortIntoBoxes` in `report.mjs`):

| Box | Rule |
| --- | --- |
| Broken tool JSON, tool call as text | a tool call with `argsError`, or a reply with no tool call whose text has a tool call (`findTextToolCall`) |
| Wrong tool picked, wrong args | a worker tool error from the registry or sandbox (unknown tool, schema error, write outside owned files, `old_text` not found, repeat guard), or a manager call without `submit_plan` / `decide` |
| Plan invalid | the first plan was refused (the retry carries `# Plan errors to fix`), or the default plan was used |
| Checkpoint fails with an unclear digest | a failed digest under 40 chars, or a generic one |
| Same mistake on every retry | two failed attempts of a task in a row with the same first digest line (numbers ignored) |
| Runs out of steps | a worker turn ended at `max_steps`, or a reply was cut at the output token limit |
| Not in a box | model call errors, cost stop, failed tasks not in another box, a task that passed while its worker wrote no file, final verify and hidden check failures |

The rules are simple on purpose. Read the boxes by eye before you send them to the owner.

## Secrets

The key is only read from the environment. Every line that goes to a file passes `redact` (from `providers/key-store`) and a regex for OpenRouter keys. Check with `grep -rn "sk-or-v1-[a-f0-9]" evals/real/results` after a run.
