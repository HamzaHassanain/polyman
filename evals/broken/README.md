# Broken problems

Three copies of pairs-sum (`evals/cases/pairs-sum`), each with one planted bug that `polyman verify` catches. We use them to test the `fix_verify` and `strengthen_tests` recipes, and as the backup demo.

| Case | The planted bug | `verify` fails at | The right fix |
| --- | --- | --- | --- |
| `weak-tests` | no test with two values equal to k/2, so `wa-half-value` passes | `verify-solutions` | add a test with many values equal to k/2 |
| `validator-bound` | `val.cpp` reads n with `readInt(0, ...)`, spec says n >= 1 | `test-validator` | `readInt(1, ...)` |
| `main-overflow` | `main.cpp` keeps the answer in `int` | `verify-solutions` (`brute` gets WA) | `long long ans` |

Each folder has `expected.md` with the bug, the real failing output and the fix. Each fix was applied by hand once, `polyman verify` passed, then it was undone. The committed folders are broken on purpose.

## Run one

```bash
npm run build
cd evals/broken/main-overflow
cp ../../../corpus/vendor/testlib.h .
node ../../../dist/cli.js verify          # or: verify --json, see "failedStep"
```

`testlib.h`, compiled binaries, `testsets/`, `solutions-outputs/` and `.polyman/` are ignored by `.gitignore` here. To reset a folder after an agent run: `git checkout -- evals/broken && git clean -fdX evals/broken`.

## How the good version differs from the T1 reference

The good pairs-sum here is a full polyman problem, built from `evals/cases/pairs-sum/reference`:

- Tests 1 to 7 are the T1 tests `01` to `07` as manual tests. The big ones come from `generators/gen.cpp` so we do not commit 2 MB per folder.
- One extra test 8: n = 70000, all values equal to k/2, answer 2449965000. It is above 2^31 and the brute force still finishes it in the time limit. Without it, `brute` gets TL on every big test and can never catch the overflow in main.
- Test 8 is before the n = 200000 tests on purpose: polyman stops running a solution at its first failure (TL on test 9), so the later tests are never checked for it.
- `brute.cpp` compares ints in the inner loop and has `#pragma GCC optimize("O3")`, so it vectorizes: about 0.3 s on test 8 instead of 1.7 s. It is still the plain O(n^2) loop.
