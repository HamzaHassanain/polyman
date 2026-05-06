# `polyman run <solution-name>`

Compiles the named solution and executes it on the targeted tests, writing each test's stdout (or a failure marker) to `solutions-outputs/<solution>/<testset>/output_test<N>.txt`. Time and memory limits from `Config.json` are enforced.

```bash
polyman run main --all                              # every testset
polyman run main --testset tests                    # one testset
polyman run main --testset tests --group samples    # one group
polyman run main --testset tests --index 5          # one test
polyman run all --all                               # every solution against every test
```

## Solution name

`<solution-name>` matches `Config.json.solutions[].name` (not the source filename). Special value: `all` runs every solution.

## Filters (mutually exclusive)

Same as `generate` and `validate`:

| Flag | Effect |
| --- | --- |
| `--all`, `-a` | All testsets. |
| `--testset <name>`, `-t <name>` | One testset. |
| `--testset <name> --group <name>`, `-g <name>` | One group. |
| `--testset <name> --index <N>`, `-i <N>` | One test by Polygon index. |

## Output files

For each test:

```
solutions-outputs/<solution>/<testset>/output_test<N>.txt
```

The file's first line is one of:

| First line | Meaning |
| --- | --- |
| (the solution's stdout) | Ran cleanly. The whole stdout is captured. |
| `Time Limit Exceeded after <ms>ms` | TLE. polyman killed the process. |
| `Memory Limit Exceeded (<MB> MB)` | MLE. Process exceeded the configured memory cap. |
| `Runtime Error: <stderr>` | Non-zero exit; stderr captured. |

`polyman verify` reads these files to assign verdicts and check tag-conformance.

## Prerequisites

- `testsets/<testset>/` must already contain the inputs. Run `polyman generate --all` first.
- The solution's `sourceType` must match the file extension (`.cpp` ↔ `cpp.g++17`, `.java` ↔ `java.11`, `.py` ↔ `python.3`).

## When to run

- Iterating on a single solution: `polyman run X --testset tests --index N` for fast feedback.
- Sanity-checking a fresh `MA`: `polyman run main --all`.
- Generating reference outputs before manual inspection: `polyman run main --all` populates the canonical answers used by the checker.

## What NOT to do

- Don't run a solution by hand-spawning g++ / python / java. polyman enforces time and memory limits; manual runs don't.
- Don't read solution outputs from `testsets/` — those are inputs. Outputs live in `solutions-outputs/`.
- Don't depend on output formatting being identical across runs. polyman strips final newlines for tag comparison; raw stdout is preserved in the file.
- Don't pass `--all` with `--testset`. They're mutually exclusive.
