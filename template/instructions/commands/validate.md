# `polyman validate`

Runs the compiled validator (`validator/val.cpp`) against test inputs in `testsets/<testset>/`. Compiles the validator first if needed.

```bash
polyman validate --all                              # every testset
polyman validate --testset tests                    # one testset
polyman validate --testset tests --group main       # one group
polyman validate --testset tests --index 5          # one test
```

## Filters (mutually exclusive)

| Flag | Effect |
| --- | --- |
| `--all`, `-a` | Validate every testset (default if no flag is given). |
| `--testset <name>`, `-t <name>` | Validate one testset. |
| `--testset <name> --group <name>`, `-g <name>` | Validate every test in that group. |
| `--testset <name> --index <N>`, `-i <N>` | Validate one test by Polygon index. |

`--index` is the Polygon test number (the suffix in `test<N>.txt`).

## What it does

For each targeted test file:

```
./validator < testsets/<testset>/test<N>.txt
```

The validator must `quitf(_ok, …)` (or pass all `inf.read*(LO, HI, …)` checks) for the test to be `VALID`. Any other exit is `INVALID`.

The command **fails** on the first non-`VALID` test, with a per-test error message naming the testset, file, and the validator's stderr.

## Prerequisite

`testsets/<testset>/` must already contain the test files. If not, run `polyman generate --all` first.

## Validator self-tests vs. validation

`polyman validate` runs the validator against *generated* tests. To run the validator against its own JSON fixture (`validator/validator_tests.json`), use [`polyman test validator`](./test.md) instead — that's a different command.

## When to run

- Right after `polyman generate --all` (catch script bugs early).
- After tightening constraints in `validator/val.cpp`.
- Before `polyman remote push` (Polygon will reject malformed tests anyway).

## What NOT to do

- Don't run before `polyman generate` — there's nothing to validate yet.
- Don't run if the script + manuals are stale — you'll be validating tests that no longer reflect `Config.json`.
- Don't expect a `polyman validate --all` pass to imply solutions work. That's `polyman verify`.
- Don't validate `manual/<testset>/m-*.in` directly — run `polyman generate --all` first to get a `test<N>.txt` (the manual is copied verbatim, so failures cleanly point back to the source `.in`).
