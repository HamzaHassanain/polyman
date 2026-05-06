# checker.md — `checker/chk.cpp` or a standard checker

The checker compares the contestant's output to the jury's reference answer and produces one of `OK / WA / PE`. **Default to a standard checker.** Custom checkers exist only when the output has multiple valid forms (any minimum-cost path, any valid permutation, …).

## Use a standard checker

`polyman list checkers` shows the full list. Pick by output shape:

| Checker | Use when output is |
| --- | --- |
| `ncmp` | Sequence of integers (most problems). |
| `wcmp` | Sequence of whitespace-separated tokens (strings + numbers). |
| `lcmp` | Compared line-by-line; whitespace inside a line is normalized. |
| `yesno` | A single `Yes`/`No` (case-insensitive). |
| `dcmp` | Floating-point with absolute/relative error 1e-6. |
| `rcmp4` / `rcmp6` / `rcmp9` | Floating-point with N decimal places. |
| `fcmp` | Exact file comparison, no normalization. |

Wire it up in `Config.json`:

```json
"checker": { "name": "ncmp", "source": "ncmp.cpp", "isStandard": true }
```

- `name` and `source` use the same string (the checker filename without path); polyman pulls the binary from its bundled `assets/checkers/`.
- `isStandard: true` makes polyman ignore any local `checker/chk.cpp` — keep the file as a stub or delete it.
- **No `testsFilePath`** for standard checkers; they aren't self-tested.
- Run `polyman verify` to confirm solutions still pass.

## Switching from custom → standard (or back)

1. `polyman list checkers` → pick the right standard.
2. Replace the entire `"checker": { … }` block with the standard form above.
3. `polyman verify`. If it passes, `checker/chk.cpp` and `checker/checker_tests.json` become unused — delete or leave them.

To go back the other way: drop in `checker/chk.cpp` and `checker/checker_tests.json`, set `isStandard: false`, run `polyman test checker` then `polyman verify`.

## Custom checker rules

If a standard checker doesn't fit:

```jsonc
"checker": {
  "name": "chk",
  "source": "./checker/chk.cpp",
  "isStandard": false,
  "testsFilePath": "./checker/checker_tests.json"
}
```

1. `#include "testlib.h"` and call `registerTestlibCmd(argc, argv)` first.
2. Read original input from `inf`, contestant output from `ouf`, jury answer from `ans`.
3. End with **exactly one** of:
   - `quitf(_ok, ...)` — accept,
   - `quitf(_wa, ...)` — wrong answer,
   - `quitf(_pe, ...)` — presentation error.
   Use `_fail` only for jury bugs (e.g. malformed `ans` file), **never** for contestant errors.
4. For floating-point: never compare with `==`. Use a tolerance.
5. Add self-tests in `checker/checker_tests.json` covering OK / WA / PE. Run `polyman test checker`.

## Custom checker skeleton

```cpp
#include "testlib.h"
using namespace std;

int main(int argc, char* argv[]) {
    setName("compare integers ignoring whitespace");
    registerTestlibCmd(argc, argv);

    long long ja = ans.readLong();
    long long pa = ouf.readLong();
    if (ja == pa) quitf(_ok, "%lld", ja);
    quitf(_wa, "expected %lld, found %lld", ja, pa);
}
```

## `checker_tests.json` shape

```json
{
  "tests": [
    { "index": 1, "input": "5\n",  "output": "5\n",  "answer": "5\n",  "expectedVerdict": "OK" },
    { "index": 2, "input": "5\n",  "output": "4\n",  "answer": "5\n",  "expectedVerdict": "WRONG_ANSWER" },
    { "index": 3, "input": "5\n",  "output": " 5 \n", "answer": "5\n", "expectedVerdict": "OK" },
    { "index": 4, "input": "5\n",  "output": "abc\n","answer": "5\n",  "expectedVerdict": "PRESENTATION_ERROR" }
  ]
}
```

Cover at minimum: one OK, one WA, one PE, and any tricky case the checker handles (e.g. multiple valid answers).

## What NOT to do

- Don't reach for a custom checker just because the problem is "hard". Standard checkers cover most CP problems.
- Don't compare floats with `==` or with a hard-coded scaled int. Use `doubleCompare` from testlib or an explicit tolerance.
- Don't `quitf(_fail, …)` for contestant mistakes — `_fail` means "the jury setup is broken". Use `_wa` / `_pe`.
- Don't print to stdout from a checker. testlib's `quitf` handles output.
- Don't read from `inf` past the end without checking — ill-formed jury data is a `_fail` situation, not a `_wa`.
- Don't omit `checker_tests.json` for custom checkers. Without self-tests, regressions go silent.
- Don't forget to update `checker_tests.json` when you change the checker logic — see `instructions/working-rules.md`.

## CRLF on Windows

Same as `validator_tests.json`: embedded `input` / `output` / `answer` strings may need `\r\n` on Windows. Keep line endings consistent or `polyman test checker` will produce confusing PE verdicts.
