# validator.md — `validator/val.cpp` + `validator/validator_tests.json`

The validator decides whether an input file is well-formed *and* satisfies constraints. It is the contract between `statements/<lang>/input-format.tex` and every test that polyman generates. Exactly **one** validator per problem.

## Hard rules

1. **C++ only**, with `#include "testlib.h"`.
2. Call `registerValidation(argc, argv)` first thing in `main`.
3. Read every value through `inf.readInt(LO, HI, "name")` / `inf.readLong(...)` / `inf.readToken(...)` / `inf.readDouble(...)` — these enforce the constraint by construction. **Never** raw `cin`.
4. Use `inf.readSpace()` between values on the same line, `inf.readEoln()` between lines.
5. End with `inf.readEoln(); inf.readEof();` to reject trailing whitespace and trailing data.
6. **Constraints in the validator must match the constraints in `statements/<lang>/input-format.tex`.** When you tighten one, tighten the other and update `validator_tests.json`.

## Config.json entry

```jsonc
"validator": {
  "name": "validator",
  "source": "./validator/val.cpp",
  "testsFilePath": "./validator/validator_tests.json"
}
```

`testsFilePath` is optional but strongly recommended — it drives `polyman test validator`.

## Validator skeleton

```cpp
#include "testlib.h"
using namespace std;

int main(int argc, char* argv[]) {
    registerValidation(argc, argv);

    int n = inf.readInt(1, 100'000, "n");
    inf.readEoln();
    for (int i = 0; i < n; ++i) {
        inf.readInt(1, 1'000'000'000, "a_i");
        if (i + 1 < n) inf.readSpace();
    }
    inf.readEoln();
    inf.readEof();
    return 0;
}
```

## `validator_tests.json` shape

```json
{
  "tests": [
    { "input": "3\n1 2 3\n",          "expectedVerdict": "VALID" },
    { "input": "0\n",                 "expectedVerdict": "INVALID" },
    { "input": "3\n1 2\n",            "expectedVerdict": "INVALID" },
    { "input": "3\n1 2 3 4\n",        "expectedVerdict": "INVALID" },
    { "input": "3\n1 2 3",            "expectedVerdict": "INVALID" },
    { "input": "3\n0 2 3\n",          "expectedVerdict": "INVALID" },
    { "input": "3\n1 1000000001 3\n", "expectedVerdict": "INVALID" }
  ]
}
```

Cover at minimum:
- one `VALID` happy path,
- one boundary-low `VALID` (e.g. `n = 1`),
- one boundary-high `VALID` (e.g. `n = 100000`, max values),
- `INVALID` for: too few tokens, too many tokens, missing trailing newline, value below LO, value above HI, garbage trailing chars.

Run `polyman test validator` after editing.

## What to do

- Tighten `n` / `a_i` ranges in lockstep with `input-format.tex`.
- For multi-line inputs, alternate `readInt(...)` / `readSpace` / `readEoln` faithfully — the validator is stricter than `cin` and that's the point.
- For graphs / trees / multi-cases, enumerate the structural constraints in the validator (e.g. tree connectivity, simple-edge invariant) — don't trust generators to enforce them.
- Add a `validator_tests.json` case per validator change.

## What NOT to do

- Don't use raw `cin`, `scanf`, `getline` — they bypass the constraint check.
- Don't skip `inf.readEof()` — without it, a file with garbage at the end will pass.
- Don't read floating-point with `readToken` and parse manually — use `inf.readDouble(LO, HI, "name")` so the bound check is part of the read.
- Don't write conditionals that "ignore" out-of-range inputs and `quitf(_ok, …)`. The validator should `quitf(_wa, …)` (or, equivalently, fail an `inf.readInt` bound check) on any non-conforming input.
- Don't drift from `input-format.tex`. If `n` becomes `≤ 200000` in the statement, it must become `≤ 200000` in the validator on the same edit, and `validator_tests.json` must add a boundary case.
- Don't skip `polyman test validator` after editing.

## CRLF on Windows

`validator_tests.json` test inputs are JSON string literals. On Windows the embedded `\n` may need to be `\r\n` for the test to round-trip. Match the OS the user is on; consistent line endings prevent `INVALID` false positives.
