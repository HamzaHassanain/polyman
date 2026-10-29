# weak-tests

## The bug

The tests have no case with two or more values equal to k/2, so `wa-half-value` passes everything.

Compared to the good pairs-sum, only the tests changed: the old sample (`4 6 / 1 5 3 3`), the `8 10 / 5 5 5 1 9 2 8 5` test and the two all-equal generated tests are gone, and the big random test no longer uses 500000000. The sample is now the old `6 7` test.

## Where verify fails

Step `verify-solutions` (Step 10), exit code 1. Real output:

```
┌─ Step 10: Verifying Solutions Against Main Correct
    → Checking brute (TO)
    → ✓ brute Behaves as expected
    → Checking wa-half-value (WA)
     ✖ Solution wa-half-value marked as WA but did not get Wrong Answer or Presentation Error on any test
    → Checking wa-int-overflow (WA)
     ✖ test6.txt in testset tests: wrong answer 1st numbers differ - expected: '3204139228', found: '-1090828068'

    → ✓ wa-int-overflow Behaves as expected
    → Checking wa-quadratic (TL)
    → ✓ wa-quadratic Behaves as expected

   ❌  VERIFICATION FAILED!

Some solutions did not behave as expected
```

`polyman verify --json` gives `"failedStep": "verify-solutions"`.

The `✖` under `wa-int-overflow` is fine: that is the WA it is supposed to get.

## The fix

Recipe `strengthen_tests`. Add a test with many values equal to k/2, for example one more line in `generators/gen-script.txt`:

```
gen 200000 2 1 > 7
```

Any test with at least two values equal to k/2 works (`wa-half-value` pairs each of them with itself). Checked: with this line `polyman verify` passes.

Do not touch `wa-half-value.cpp` or its tag, the solution is the right one, the tests are weak.
