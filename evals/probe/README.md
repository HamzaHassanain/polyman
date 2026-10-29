# Gemma probe

Real numbers on how Gemma 4 behaves with polyman's tools, before we tune anything. The numbers set the budgets and go on the demo slide.

Each case is one non-streaming call to OpenRouter with our real tool names and shapes (from `design/agent/04-harness.md` and `src/agent/workflow/types.ts`). There is no agent loop here: one request, one answer, then a check.

## How to run

```bash
source ~/.config/openrouter.env        # or: export OPENROUTER_API_KEY=...
node evals/probe/probe.mjs --models google/gemma-4-31b-it,google/gemma-4-26b-a4b-it --runs 3
```

Options:

- `--models a,b`: OpenRouter model ids (default `google/gemma-4-31b-it`).
- `--runs N`: calls per case, model and reasoning mode (default 1).
- `--reasoning off,on`: run with reasoning off, on, or both (default both).
- `--cases c01-verify,c09-no-tool`: only these cases.

Every call uses `temperature: 0.3`, `provider: { require_parameters: true }`, `usage: { include: true }` and `reasoning: { enabled: true | false }`. At most 4 requests run at a time, and a 429 or 5xx is retried once.

The script writes `evals/probe/results/<date>.json` (all raw data: tool calls, raw args, content, tokens, cost, provider) and `evals/probe/results/<date>.md` (the tables below). The results folder is in `.gitignore`. The key is only read from the environment, it is never written to a file.

## The cases

`cases.mjs` has 10 cases. Each one has a system prompt, a user message, the tools the model sees and a check.

| Case | Correct when |
| --- | --- |
| c01-verify | "Run verify" with 6 tools: exactly one `verify` call |
| c02-read | one `read_file` with `solutions/main.cpp` |
| c03-write-validator | a `write_file` to `validator/val.cpp` with `registerValidation` in it |
| c04-edit | an `edit_file` whose `old_text` matches the file once, and the result has `readInt(1,` and no `readInt(0,` |
| c05-two-reads | two `read_file` calls for both files, or one of them (the other comes on the next step) |
| c06-plan | `submit_plan` with `tasks`, each with `kind`, `dependsOn` and `ownsFiles` |
| c07-decide | exactly one `decide` call with one of the 3 actions |
| c08-long-generator | a `write_file` of `generators/gen.cpp` with `registerGen` and at least 80 lines (the long JSON case) |
| c09-no-tool | trap: "what does TO mean?" is answered with text (mentions TLE or time limit), no tool call |
| c10-call-as-text | trap: "give me the exact tool call" still gets a real `run_solution` call, not text |

## The columns

- `reasoning`: `off` or `on` (`reasoning.enabled` in the request).
- `correct`: answers that pass the case check, out of all calls. HTTP errors count as not correct.
- `valid JSON`: answers where every tool call's arguments parse with `JSON.parse`, out of the answers with at least one tool call.
- `valid after repair`: the same, after the simple repairs (strip code fences, cut after the first balanced `}`), like `parseToolArgs` in the provider.
- `call as text`: answers whose text has a known tool name followed by `(`, or `"name": "<tool>"`. The harness must catch these and ask for a real tool call.
- `parallel calls`: answers with 2 or more tool calls in one response.
- `p50 latency`: median time of one full (non-streaming) call.
- `cost`: sum of OpenRouter's `usage.cost` for that row.

## Results

Run on 2026-10-26: 10 cases, 3 runs each, 2 models, reasoning off and on. 120 calls, no HTTP errors, total cost **$0.056**.

| model | reasoning | correct | valid JSON | valid after repair | call as text | parallel calls | p50 latency | cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| google/gemma-4-31b-it | off | 30/30 | 27/27 | 27/27 | 0 | 3 | 4235 ms | $0.0089 |
| google/gemma-4-31b-it | on | 26/30 | 27/27 | 27/27 | 0 | 3 | 5921 ms | $0.0279 |
| google/gemma-4-26b-a4b-it | off | 22/30 | 24/24 | 24/24 | 3 | 2 | 1699 ms | $0.0037 |
| google/gemma-4-26b-a4b-it | on | 18/30 | 22/22 | 22/22 | 0 | 0 | 3233 ms | $0.0155 |

Correct per case:

| case | gemma-4-31b-it off | gemma-4-31b-it on | gemma-4-26b-a4b-it off | gemma-4-26b-a4b-it on |
| --- | --- | --- | --- | --- |
| c01-verify | 3/3 | 3/3 | 3/3 | 3/3 |
| c02-read | 3/3 | 3/3 | 3/3 | 3/3 |
| c03-write-validator | 3/3 | 3/3 | 3/3 | 3/3 |
| c04-edit | 3/3 | 3/3 | 0/3 | 0/3 |
| c05-two-reads | 3/3 | 3/3 | 3/3 | 3/3 |
| c06-plan | 3/3 | 3/3 | 1/3 | 0/3 |
| c07-decide | 3/3 | 3/3 | 3/3 | 3/3 |
| c08-long-generator | 3/3 | 2/3 | 3/3 | 0/3 |
| c09-no-tool | 3/3 | 3/3 | 3/3 | 3/3 |
| c10-call-as-text | 3/3 | 0/3 | 0/3 | 0/3 |

What I see:

- Tool call JSON was always valid, even for the long generator (100 to 170 lines in one `write_file`). The repair step was never needed in this run, we keep it anyway.
- **Gemma 4 31B with reasoning off is the best row: 30/30**, p50 about 4.2 s, about $0.0003 per call.
- Reasoning on did not help on these cases. It costs 3 to 4 times more and is slower, and it eats the output budget: on the long generator it used 6.7k to 7.9k reasoning tokens out of 8k, so the 26B was cut (`finish_reason: length`, 0/3) and one 31B call wrote only 15 lines. The 26B planner was also cut at 4k on 2 of 3 plans. If we turn reasoning on (manager, main solution, fixer), the output budget must be much bigger than 8k.
- On c10, the 31B with reasoning on read `Config.json` first to find the solution name. This is a fair first step, but the strict check counts it as wrong. It never wrote the call as text.
- The 26B (reasoning off) wrote the call as text in all 3 runs of c10 (`run_solution(name="main", all=True)`). The 31B never did. So the "call as text" detection in the session is needed for the 26B.
- The 26B used `write_file` (the whole file again) instead of `edit_file` in c04, and left `ownsFiles` out of some plan tasks in c06 (`verify`, `generate_validate`, `statement_critic`). The schema check in the registry must catch the missing fields.
- Parallel calls: the 31B read both files in one response in all 3 runs of c05, the 26B in 2 of 3 with reasoning off.

The full per-call data (raw args, text, tokens, provider) is in `results/<date>.json`, and the failed calls with their first 200 chars are in `results/<date>.md`.
