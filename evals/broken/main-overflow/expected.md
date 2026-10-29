# main-overflow

## The bug

`solutions/main.cpp` keeps the answer in `int ans`, so it overflows when the answer is above 2^31 - 1 (tests 8, 9 and 10).

`brute` is tagged `TO`: it may be slow, but it is never wrong. It finishes test 8 (n = 70000, answer 2449965000) in the time limit, so it gets WA against the broken main there.

## Where verify fails

Step `verify-solutions` (Step 10), exit code 1. Real output:

```
┌─ Step 10: Verifying Solutions Against Main Correct
    → Checking brute (TO)
     ✖ test8.txt in testset tests: wrong answer 1st numbers differ - expected: '-1845002296', found: '2449965000'

     ✖ Solution brute marked as TO but got Wrong Answer on some tests
    → Checking wa-half-value (WA)
     ✖ test1.txt in testset tests: wrong answer 1st numbers differ - expected: '2', found: '3'

     ✖ test4.txt in testset tests: wrong answer 1st numbers differ - expected: '8', found: '10'

     ✖ test8.txt in testset tests: wrong answer 1st numbers differ - expected: '-1845002296', found: '2450000000'

     ✖ test9.txt in testset tests: wrong answer 1st numbers differ - expected: '-1474936480', found: '20000000000'

     ✖ test10.txt in testset tests: wrong answer 1st numbers differ - expected: '-1509301110', found: '2785682868'

    → ✓ wa-half-value Behaves as expected
    → Checking wa-int-overflow (WA)
     ✖ Solution wa-int-overflow marked as WA but did not get Wrong Answer or Presentation Error on any test
    → Checking wa-quadratic (TL)
    → ✓ wa-quadratic Behaves as expected

   ❌  VERIFICATION FAILED!

Some solutions did not behave as expected
```

`polyman verify --json` gives `"failedStep": "verify-solutions"`.

Two solutions fail, but it is one bug:

- `brute (TO)` gets WA: the main answer is negative, the brute force has the right one.
- `wa-int-overflow (WA)` passes everything: it has the same overflow as main, so their outputs match. This is a hint too.

The negative `expected:` values are the clue: main is the one that is wrong.

## The fix

In `solutions/main.cpp`:

```cpp
long long ans = 0;
```

Checked: with this change `polyman verify` passes.

The wrong fixes are to retag `brute` or `wa-int-overflow`, or to remove the big tests.

## Note

The brute force needs about 0.3 s on test 8 with a 1 s limit. On a very busy machine it can hit the limit there. Then `brute` passes as `TO` and only the `wa-int-overflow` line is left, still at `verify-solutions`.
