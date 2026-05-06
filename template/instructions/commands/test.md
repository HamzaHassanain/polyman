# `polyman test <what>`

Runs component self-tests. Three forms:

```bash
polyman test validator        # run validator/validator_tests.json
polyman test checker          # run checker/checker_tests.json
polyman test <solution-name>  # diff a named solution against MA, assert tag-conformance
```

## `polyman test validator`

1. Reads `validator/validator_tests.json` (`{ tests: [{ input, expectedVerdict }] }`).
2. Compiles `validator/val.cpp`.
3. For each entry, writes `input` to a temp file and pipes it to the validator.
4. Verifies the validator's verdict matches `expectedVerdict` (`VALID` / `INVALID`).
5. Cleans up the temp directory.

Fails on the first mismatch with a per-test message. See [`../validator.md`](../validator.md) for the JSON shape and recommended coverage.

## `polyman test checker`

1. Reads `checker/checker_tests.json` (`{ tests: [{ index, input, output, answer, expectedVerdict }] }`).
2. Compiles the checker.
3. For each entry, writes the three input/output/answer files and runs the checker.
4. Verifies the verdict matches `expectedVerdict` (`OK` / `WRONG_ANSWER` / `PRESENTATION_ERROR` / `CRASHED`).

**Skipped for standard checkers** (`isStandard: true`) — those are trusted not to need self-tests.

See [`../checker.md`](../checker.md) for the JSON shape.

## `polyman test <solution-name>`

The per-solution version of `polyman verify`. Validates that the named solution behaves consistent with its `tag`:

1. Compiles the named solution and the `MA` solution.
2. Compiles the checker.
3. Runs both solutions on every testset.
4. Compares each test's outputs via the checker, tracking verdicts (WA, TLE, MLE, RTE, PE).
5. Asserts the tracked verdicts match the named solution's `tag` claim:
   - `MA` / `OK` → must pass every test.
   - `WA` → must produce WA on at least one test.
   - `TL` → must produce TLE on at least one test.
   - `ML` → must produce MLE on at least one test.
   - `RE` → must crash on at least one test.
   - `PE` → must produce PE on at least one test.
   - `RJ` → must fail somehow on at least one test.
   - `TO` → permissive; no strict assertion.

Faster than `polyman verify` when you're iterating on a single solution.

## When to run

- After editing the validator: `polyman test validator`.
- After editing a custom checker: `polyman test checker`.
- After editing a single solution and you want a quick conformance check before a full `verify`: `polyman test <solution-name>`.

## What NOT to do

- Don't run `polyman test checker` against a problem with a standard checker — it's a no-op (and the absence of `chk.cpp` will look like an error to a reader who doesn't know that).
- Don't expect `polyman test <solution-name>` to recompile the generators or regenerate tests. Run `polyman generate --all` first if the script changed.
- Don't try `polyman test`  with no argument — it prints help and exits.
- Don't use this when you really need `polyman verify`. `verify` runs the full pipeline including generator/validator/checker self-tests; `polyman test <X>` only checks one component.
