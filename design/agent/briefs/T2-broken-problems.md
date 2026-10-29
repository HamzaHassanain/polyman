# T2: broken problems

- Lane: C (Mazen). Tool: Claude Code (Opus) to help, but Mazen checks every file. Branch: `hack/t2-broken`.
- Time: 4:15 to 4:50 PM, right after pairs-sum (T1) is done. Open the PR by 4:45; it goes in at the 4:50 merge if Faraj has reviewed it, else at 5:45.
- Read first: `design/agent/10-workflow-manager.md` (recipes `fix_verify` and `strengthen_tests`), `design/agent/briefs/T1-test-problems.md`, the "Start here" tab in the run sheet.

## Goal

Three copies of pairs-sum, each with **one planted bug** that `polyman verify` catches. We use them to test the `fix_verify` and `strengthen_tests` recipes, and as the backup demo if Gemma cannot build a full problem by 6:05 (cut line).

## You own

- `evals/broken/<case>/` for each case: a full problem folder plus `expected.md`
- `evals/broken/README.md`

## The cases

| Case | The planted bug | `verify` should fail at | The right fix |
| --- | --- | --- | --- |
| `weak-tests` | Remove the tests where many values equal k/2. `wa-half.cpp` (counts a_i = k/2 pairs wrong) now passes everything. | `verify-solutions`: `wa-half (WA)` passed every test | add a test with many equal values (strengthen_tests) |
| `validator-bound` | `val.cpp` reads `n` with `readInt(0, ...)`, but the spec says n ≥ 1. `validator_tests.json` has a test with n = 0 that expects INVALID. | `test-validator` | `readInt(1, ...)` |
| `main-overflow` | `main.cpp` keeps the answer in `int`. The brute force is tagged `TO`, so it is allowed to be slow but never wrong, and it disagrees with main on a big test. | `verify-solutions`: the brute force gets WA against main | use `long long` in main |

Each `expected.md` has: the bug in one line, the exact failing step and message from `polyman verify` (paste the real output), and the fix.

## Rules

- Start from your finished pairs-sum. Change only the one thing per case.
- Run `polyman verify` in each folder and paste the real failing output into `expected.md`.
- Apply the fix by hand once, check that `verify` passes, then undo it. The committed folder must be broken.

## Done when

- `polyman verify` fails in each folder exactly at the step in the table, with exit code 1.
- The fix by hand makes it pass (checked, then undone).
- One commit: `evals: broken problems for fix_verify`. Pushed.
