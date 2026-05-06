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

## Whitespace, newlines, EOF — the part that wastes the most time

testlib's `inf` reader is byte-strict. Most "the validator is wrong" debugging sessions are actually whitespace mismatches. Read this before writing `validator_tests.json`.

**Rules for input format and the validator that enforces it:**

- Tokens on the same line are separated by **exactly one space** — call `inf.readSpace()` between them, never `inf.readSpaces()` (that one swallows trailing whitespace and weakens the contract).
- Every line ends with **exactly one `\n`** — call `inf.readEoln()` after the last token of the line.
- The file ends with **`\n` then EOF** — `inf.readEoln(); inf.readEof();` at the bottom of the validator.
- **No trailing spaces** before `\n`, **no double spaces**, **no tabs**, **no CRLF**, **no BOM**.

If your input format changes, the validator's `readSpace` / `readEoln` calls must change in lockstep. A multi-line input where each line has a different token count needs a `readEoln` per line, not at the end.

**Authoring `validator_tests.json` cases without rage:**

Embedded inputs are JSON string literals. Every byte you put into `"input"` is what testlib reads. Common pitfalls:

| Intent | Wrong | Right |
| --- | --- | --- |
| 3 numbers, valid | `"3\n1 2 3"` | `"3\n1 2 3\n"` (trailing `\n` required by `readEof` after `readEoln`) |
| Reject extra blank line | `"3\n1 2 3\n\n"` should be `INVALID` | mark `expectedVerdict: "INVALID"` and write `"3\n1 2 3\n\n"` |
| Reject double space | `"3\n1  2 3\n"` should be `INVALID` | use double space deliberately and mark `INVALID` |
| Reject trailing space | `"3\n1 2 3 \n"` should be `INVALID` | mark `INVALID` |

**Required `INVALID` cases beyond value bounds:** missing trailing `\n`, extra trailing `\n`, double space, trailing space before `\n`, tab between tokens, CRLF (if you support Linux only). These are cheap to write and they keep generator output honest.

**On Windows:** `\n` in JSON sometimes needs to be `\r\n` to match what `git`/editor wrote on disk. If `polyman test validator` returns `INVALID` for an obviously-valid case, run `xxd validator/validator_tests.json | head` and verify the bytes — don't change the validator first.
