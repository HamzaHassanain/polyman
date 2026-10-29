# validator-bound

## The bug

`validator/val.cpp` reads n with `readInt(0, 200000, "n")`, but the spec says 1 <= n <= 200000.

`validator/validator_tests.json` has test 4, `0 5\n\n` (n = 0), that expects `INVALID`. The validator accepts it.

## Where verify fails

Step `test-validator` (Step 4), exit code 1. Real output:

```
┌─ Step 4: Testing Validator
  ✖ Validator Test 4 failed:
	Validator did not detect invalid test expected to be INVALID

   ❌  VERIFICATION FAILED!

Some validator tests failed
```

`polyman verify --json` gives `"failedStep": "test-validator"`.

## The fix

In `validator/val.cpp`:

```cpp
int n = inf.readInt(1, 200000, "n");
```

Checked: with this change `polyman verify` passes.

The wrong fix is to change test 4 in `validator_tests.json` to `VALID` or delete it. The test is right, the validator is wrong.
