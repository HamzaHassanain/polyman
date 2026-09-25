# `polyman verify`

The full pipeline. **The bar for "done".** A successful compile is not sufficient; tag-conformance under `verify` is.

```bash
polyman verify
polyman verify --json      # JSON report on stdout, human log on stderr
polyman verify --no-cache  # recompile every source (see cache.md)
```

Compile steps reuse cached binaries for sources that have not changed; the run ends with a `⚡ Compile cache: …` line. See [`cache.md`](./cache.md).

## Pipeline (in order)

1. **Compile generators** referenced by every testset.
2. **Generate every test** from the script + manuals into `testsets/<testset>/test<N>.txt`.
3. **Compile the validator.**
4. **Run validator self-tests** against `validator/validator_tests.json` (skipped if `testsFilePath` not set).
5. **Validate every generated input** with the validator.
6. **Compile the checker** (or skip for standard checkers).
7. **Run checker self-tests** against `checker/checker_tests.json` (skipped for standard checkers).
8. **Compile every solution.**
9. **Run every solution** on every test, capturing outputs to `solutions-outputs/`.
10. **Compare each non-`MA` solution to `MA` via the checker**, tracking verdicts.
11. **Assert tag-conformance** for every solution. See [`../solutions.md`](../solutions.md) for the tag table.

Fails on the first step that errors. The error names the failing component and (where applicable) the failing test.

## `--json` (for agents and scripts)

`polyman verify --json > verify.json` writes exactly one JSON document to stdout; all human-readable output goes to stderr. Exit code is unchanged: 0 when every step passed, 1 otherwise. The document is written on every failure path, including compile errors and validator self-test failures.

```json
{
  "schemaVersion": 1,
  "polymanVersion": "3.0.0",
  "command": "verify",
  "ok": false,
  "failedStep": "verify-solutions",
  "steps": [
    { "name": "read-config", "ok": true, "errors": [] },
    { "name": "compile-generators", "ok": true, "errors": [] },
    { "name": "generate-tests", "ok": true, "errors": [] },
    { "name": "compile-validator", "ok": true, "errors": [] },
    { "name": "test-validator", "ok": true, "errors": [] },
    { "name": "validate-tests", "ok": true, "errors": [] },
    { "name": "compile-checker", "ok": true, "errors": [] },
    { "name": "test-checker", "ok": true, "errors": [] },
    { "name": "compile-solutions", "ok": true, "errors": [] },
    { "name": "run-solutions", "ok": true, "errors": [] },
    { "name": "verify-solutions", "ok": false, "errors": ["Solution wa marked as WA but passed all tests correctly", "Some solutions did not behave as expected"] }
  ],
  "solutions": [
    { "name": "acc", "tag": "MA", "matchesTag": true, "reason": "Main solution ran on every test", "tests": [ { "testset": "tests", "index": 1, "verdict": "OK", "timeMs": 3, "message": "" } ] },
    { "name": "wa", "tag": "WA", "matchesTag": false, "reason": "Solution wa marked as WA but passed all tests correctly", "tests": [ { "testset": "tests", "index": 1, "verdict": "OK", "timeMs": 3, "message": "" } ] }
  ]
}
```

- `failedStep` is the first step that failed (null on success). Steps after it are absent because verify stops there.
- `steps[].errors` holds the error lines printed during a failed step (compiler output, validator messages, per-test failures). It is empty for steps that passed.
- `solutions[]` lists solutions that were run. `matchesTag` is the tag-conformance result; `reason` explains it. Verdicts are `OK`, `WA`, `TLE`, `MLE`, `RTE` (`WA` is assigned by the checker during the comparison step).
- If verification stops before a solution was compared, its `matchesTag` is false with reason `Not evaluated: verification stopped before comparison`.

## What it catches

- Stale tests (script changed but `polyman generate` not rerun).
- Validator drift (constraints in validator vs. `input-format.tex`).
- A solution misbehaving against its tag (`WA` solution that actually passes; `TL` solution that doesn't TLE).
- Generator producing input that fails the validator.
- Checker rejecting valid output.

## When to run

- Before declaring **any** authoring task done.
- After editing `Config.json`, any solution, the script, the validator, the checker, or any manual test.
- Before `polyman remote push` (Polygon will run its own verification anyway, but local `verify` is faster feedback).

## What NOT to do

- Don't substitute `polyman validate --all && polyman run main --all` for `verify`. They cover subsets — only `verify` checks tag-conformance.
- Don't run `verify` while editing tests in another shell — partial regenerations confuse the comparison.
- Don't claim the work is done if `verify` fails. A failing `verify` blocks the whole problem.

## Diagnosing a `verify` failure

1. Read the error — it names the failing component.
2. Run that component in isolation:
   - Validator failing → [`polyman test validator`](./test.md).
   - Checker failing → [`polyman test checker`](./test.md).
   - One solution failing → [`polyman test <solution-name>`](./test.md) or `polyman run <sol> --testset tests --index N`.
   - Generator producing bad input → `polyman generate --testset tests --index N` then `polyman validate --testset tests --index N`.
3. Fix the failing component, then run `polyman verify` again.

If the error is confusing or the failing step isn't obvious, run the failing component in isolation **before** changing code.
