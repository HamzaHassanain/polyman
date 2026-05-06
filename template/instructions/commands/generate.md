# `polyman generate`

Materializes test inputs from the script + manual tests into `testsets/<testset>/test<N>.txt`. Compiles every referenced generator first.

```bash
polyman generate --all                              # every testset
polyman generate --testset tests                    # one testset
polyman generate --testset tests --group samples    # one group
polyman generate --testset tests --index 5          # one test
```

## Filters (mutually exclusive)

| Flag | Effect |
| --- | --- |
| `--all`, `-a` | Generate every testset (default if no flag is given). |
| `--testset <name>`, `-t <name>` | Generate one named testset. |
| `--testset <name> --group <name>`, `-g <name>` | Generate every test in that group. |
| `--testset <name> --index <N>`, `-i <N>` | Generate one test by Polygon index. |

`--index` is the **Polygon-side** test index (`> N` in the script, or `manualTests[].index`). Not the position in the script.

## Pipeline (per invocation)

1. Parse `generatorScript.script` (or `scriptFile`) — see [`../generator-script.md`](../generator-script.md).
2. Validate references: every `gen-name` in the script must appear in `Config.json.generators[]`. Every manual file must exist on disk.
3. Resolve to a flat `[ResolvedTest]` list with concrete Polygon indices (`$` → smallest unused, no duplicates).
4. Compile each referenced generator once (skipped if already compiled).
5. Per resolved test:
   - **Manual** → copy `manual/<testset>/m-*.in` to `testsets/<testset>/test<index>.txt`.
   - **Single-output generator** → run with stdout redirected to `testsets/<testset>/test<index>.txt`.
   - **Multi-output generator** (`> {1-3,7}`) → run once with cwd at the testset dir; verify each promised file exists; rename to `test<index>.txt`.

## What NOT to do

- Don't hand-edit `testsets/<testset>/test<N>.txt`. The next `generate` overwrites them.
- Don't use `--index` with the script-line *position* — it's the Polygon test number.
- Don't combine filters (`--all --testset tests` is invalid — only one filter wins).
- Don't expect `generate` to validate the inputs. Run `polyman validate --all` after.
- Don't forget to rerun `generate` after touching: the script, generator args, manual files, manual indices, or testset config. Stale `testsets/<testset>/` is the most common cause of confusing `verify` failures.

## Errors and what they mean

- `Generator "X" not found in configuration.` — the script references a name not in `generators[]`. Add it or fix the script.
- `Manual test input not found: ./manual/...` — the path in `manualTests[]` doesn't exist on disk.
- `Duplicate test index N` — two sources (manual + script, or two script lines) claim the same index. Renumber.
- `Multi-output generator "X" did not produce a file for index N` — the generator's multi-output line promised an index but didn't write the file. Fix the generator or fix the script.
