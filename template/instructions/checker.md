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

## Whitespace, newlines, EOF — read this before writing checker tests

Custom checker reads use the same byte-strict testlib API as the validator. Most "checker says PE but the answer is right" sessions are whitespace mismatches. Get this right up front.

**Reading rules inside the checker:**

- Use `ouf.readToken()` / `ouf.readInt()` / `ouf.readLong()` / `ouf.readDouble()`. They skip leading whitespace and stop at the next whitespace or EOF — that's the right behavior for accepting normal contestant output.
- Don't call `ouf.readEoln()` / `ouf.readEof()` unless the problem **really** requires a strict trailing-newline format. Penalizing a contestant for a missing trailing `\n` is hostile; reach for `wcmp` / `lcmp` standard checkers if that's what you want.
- Match the way `ans` is written by `MA`: if `MA` prints `"%lld\n"`, read both `ouf` and `ans` with `readLong()` and don't sweat the newline.
- For multi-line outputs, alternate `readToken` per token on the same line and only worry about line breaks when "which token is on which line" matters semantically.
- For floating-point: `doubleCompare(ja, pa, EPS)` from testlib, or compare with an explicit absolute/relative tolerance. Never `==`.

**Authoring `checker_tests.json` cases:**

`input` / `output` / `answer` are byte-exact JSON string literals — every space, tab, and `\n` is consumed by the checker as written. Most useful cases pre-trim contestant output to exactly what `ouf.readToken()` would consume (`"5\n"`), but **also** include surface-level junk to prove the checker tolerates it:

| Case | What to write |
| --- | --- |
| Plain OK | `"output": "5\n"`, `"answer": "5\n"`, `OK` |
| Tolerate trailing space | `"output": "5 \n"`, `"answer": "5\n"`, `OK` (`readToken` skips whitespace) |
| Tolerate missing trailing `\n` | `"output": "5"`, `"answer": "5\n"`, `OK` |
| Tolerate leading space | `"output": " 5\n"`, `"answer": "5\n"`, `OK` |
| Wrong value | `"output": "4\n"`, `"answer": "5\n"`, `WRONG_ANSWER` |
| Garbage where number expected | `"output": "abc\n"`, `"answer": "5\n"`, `PRESENTATION_ERROR` |
| Empty output | `"output": ""`, `"answer": "5\n"`, `PRESENTATION_ERROR` (`readToken` hits EOF) |

Cover both directions: prove the checker **accepts** cosmetic whitespace differences, and prove it **rejects** garbage. A checker that fails the trailing-space-tolerant test is too strict and will silently fail real contestant submissions.

**On Windows:** if `polyman test checker` reports surprise PE/WA verdicts, dump the JSON with `xxd checker/checker_tests.json | head` first. CRLF in the JSON literally injects `\r` into the output stream, and the checker sees an extra byte before `\n`.
