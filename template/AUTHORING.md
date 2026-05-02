# AUTHORING.md — Rules for AI agents authoring this problem

This file is the **rules and patterns** spec for any AI agent (Claude, Cursor, Aider, Codex, …) editing files in this problem directory. It complements [`CLAUDE.md`](./CLAUDE.md) (orientation) — read CLAUDE.md first, then this file, **before** changing any solution / generator / validator / checker / statement / `Config.json`.

The rules below are non-negotiable. They are derived from the realities of testlib + the Polygon round-trip + how `polyman verify` enforces solution-tag conformance.

---

## 1. Three modes — pick one per turn

You are in exactly one mode per turn. Pick from what the user JUST said, not from earlier turns. Pasting a problem statement is **not** permission to solve it.

| Mode | Triggered by | What you do |
| ---- | ------------ | ----------- |
| **Default** | User shares a statement, idea, observation, complaint, anything without an explicit imperative. | One-line acknowledgement, then one short clarifier ("Want me to think through the approach, or jump to writing it?"). **No** algorithm sketches. **No** code. **No** edits. |
| **Thinking** | "solve this", "what approach", "how would you do X", "is constraint Y reasonable", "thoughts on…", "analyze…", "explain why O(n log n)". | Discuss complexity, algorithm sketch, edge cases, why a constraint matters. Pseudocode or ≤5-line snippets fine; full files are not. **No file edits.** Stop after the analysis — do not auto-promote to writing. Wait for an explicit "now write it". |
| **Do** | "add", "write", "generate", "fix", "change", "update", "remove", "create", "make", "draft". | Edit the relevant file. Reasoning happens internally; visible output is the artifact + one sentence on what changed. |

Ambiguous? **Ask one short question.** Don't guess.

If a previous turn was cancelled or failed, brief acknowledgement and wait. No apology spiral.

---

## 2. Read before editing

Before you `Edit` or `Write` a file, you must have its current contents in context (you read it this conversation, you wrote it this conversation, or it was in a `polyman list …` output). Don't edit blindly. Don't re-read "to be safe" if you already have it.

For batched changes (e.g. updating multiple generators), read all of them first, then write all of them.

---

## 3. Statement files — `statements/<lang>/*.tex`

Polyman/Polygon split a statement into four LaTeX fragments per language (`legend.tex`, `input-format.tex`, `output-format.tex`, `notes.tex`). Each is a fragment, not a standalone document — no `\documentclass`, no `\begin{document}`.

**Hard rules:**

1. **No sample I/O inside the statement files.** Sample inputs and outputs are created as **manual tests** in `manual/tests/*.txt` and referenced from `Config.json.testsets[].generatorScript.commands[]` with `useInStatements: true`. Polygon renders them automatically under the statement.
2. **No solution spoilers** in `legend.tex` or `notes.tex`. Describe **what** to compute, not **how**. No "use DP", "binary search on the answer", "greedy from the right".
3. **No constraints in `legend.tex`.** Constraints (e.g. $1 \le n \le 10^5$) live in `input-format.tex`, ideally in a bullet list right after the format description.
4. **LaTeX math syntax**: `$...$` for inline, `$$...$$` for display. Use `\le`, `\ge`, `\cdot`, `\ldots`, `\times`. Use `\bmod`, not `mod`.
5. **`notes.tex` walks the samples**: brief explanation of why each sample's output is what it is. Reference samples by index ("In the first sample, …").
6. **One file per concern.** Don't bundle the input format into `legend.tex`.

**Per-file content map:**

| File | Holds |
| ---- | ----- |
| `legend.tex` | Story / problem statement: what the function or solver must compute. No format details, no constraints. |
| `input-format.tex` | Exact input layout (number of lines, order, types) + constraints. |
| `output-format.tex` | Exact output layout. |
| `notes.tex` | Sample walkthroughs, edge-case explanations. |

**Languages:** `english/` is required; `russian/` ships in the template but is optional (delete the directory if you don't need it, or translate).

---

## 4. Solutions — `solutions/*.{cpp,java,py}` + `Config.json.solutions[]`

Every solution carries a **tag** declaring its expected behaviour. `polyman verify` fails the whole problem if a solution does not match its tag.

| Tag  | Meaning                | `verify` expects                          |
| ---- | ---------------------- | ----------------------------------------- |
| `MA` | Main correct           | Passes every test. **Exactly one required.** |
| `OK` | Alternative correct    | Passes every test.                        |
| `WA` | Wrong answer           | WA on at least one test.                  |
| `TL` | Time limit exceeded    | TLE on at least one test.                 |
| `TO` | TLE-or-OK              | Algorithmically correct, may TLE — not strict. Use sparingly. |
| `ML` | Memory limit exceeded  | MLE on at least one test.                 |
| `RE` | Runtime error          | Crashes on at least one test.             |
| `PE` | Presentation error     | PE on at least one test.                  |
| `RJ` | Rejected (any failure) | Fails some test, any verdict.             |

**Choosing a tag when adding a solution:**

- A correct, fast reference → `MA` (only if no `MA` exists yet) or `OK`.
- A correct but slow alternative meant to TLE under the limit → `TL`. If it might or might not TLE → `TO`.
- A submission with a known bug intended to fail → `WA` (or `PE` if the bug is formatting).
- A brute force kept for cross-checking → `OK` (if it fits the time limit) or `TO`.

**Naming:** Polygon refuses two solutions with the same stem and different extensions (e.g. `acc.cpp` + `acc.java` collide). Use distinct stems: `acc.cpp`, `acc2.java`, `tle.py`.

**Source types** in `Config.json` — pick one matching the file:

- C++: `cpp.g++17` (default), `cpp.g++20`, `cpp.clang++17`, `cpp.clang++20`.
- Java: `java.11`, `java.17`, `java.21`.
- Python: `python.3`, `python.pypy3`.

The `MA` solution should be C++ unless you have a strong reason otherwise — Python/Java MA solutions risk failing your own time limit and break the contract for what "correct" looks like.

---

## 5. Generators — `generators/*.cpp` + `Config.json.generators[]`

Generators **must** be C++ and use testlib (`#include "testlib.h"`).

**Hard rules:**

1. Call `registerGen(argc, argv, 1)` first thing in `main`.
2. Read CLI arguments **positionally** via `argv[1]`, `argv[2]`, … parsed with `atoi` / `atoll`. **Do NOT** use `opt<T>("name")` — polyman's generator script passes positional args only.
3. Output goes to **stdout** with `cout` / `printf`. The generated test is whatever you print.
4. **Deterministic given the same args.** testlib's `rnd` is seeded from the args, so identical args produce identical output. Do not use `srand`, `time(NULL)`, or `/dev/urandom`.
5. Output must satisfy the validator. After writing a generator, run `polyman generate --all && polyman validate --all` before declaring done.

**How `Config.json` invokes a generator:**

```jsonc
"generators": [
  { "name": "gen-random", "source": "./generators/gen.cpp" }
],
"testsets": [{
  "name": "tests",
  "generatorScript": {
    "commands": [
      { "type": "manual",   "manualFile": "./manual/tests/sample1.txt", "group": "samples", "useInStatements": true },
      { "type": "generator","generator":  "gen-random", "range": [1, 50],   "group": "main"   }
    ]
  }
}]
```

`range: [1, 50]` runs the generator 50 times, passing the integer as `argv[1]` (this is the **seed convention**: argv[1] becomes both the testlib seed and an in-generator parameter you can use for sizing).

**Generator template skeleton:**

```cpp
#include "testlib.h"
using namespace std;

int main(int argc, char* argv[]) {
    registerGen(argc, argv, 1);
    int n = rnd.next(1, atoi(argv[1]) * 100);   // size scales with seed
    cout << n << "\n";
    for (int i = 0; i < n; ++i) {
        cout << rnd.next(1, 1'000'000'000);
        cout << (i + 1 == n ? "\n" : " ");
    }
}
```

---

## 6. Validators — `validator/val.cpp` + `validator/validator_tests.json`

Validators **must** be C++ and use testlib. Exactly one per problem.

**Hard rules:**

1. Call `registerValidation(argc, argv)` first.
2. Read every value through `inf.readInt(LO, HI, "name")` / `inf.readToken(...)` / etc. **Never** raw `cin`. This is what enforces constraints.
3. End with `inf.readEoln()` then `inf.readEof()` to reject trailing garbage.
4. Use `inf.readSpace()` between values on the same line, `inf.readEoln()` between lines.
5. Validator self-tests live in `validator/validator_tests.json` — pairs of `{ input: "...", expectedVerdict: "VALID" | "INVALID" }`. Run with `polyman test validator`.
6. **Constraints in the validator must match the constraints in `input-format.tex`.** When you tighten one, tighten the other and update `validator_tests.json`.

**Validator skeleton:**

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

---

## 7. Checkers — `checker/chk.cpp` + `checker/checker_tests.json`, or a standard one

**Default to a standard checker.** Only write a custom checker if the output has multiple valid forms (e.g. any minimum-cost path, any valid permutation).

**Standard checkers** (pick one in `Config.json`):

| Name      | Use for                                             |
| --------- | --------------------------------------------------- |
| `ncmp`    | Sequence of integers (most problems).               |
| `wcmp`    | Sequence of tokens / words.                         |
| `lcmp`    | Exact line comparison.                              |
| `yesno`   | Single Yes/No (case-insensitive).                   |
| `dcmp`    | Floating-point with absolute/relative error 1E-6.   |
| `rcmp4/6/9` | Floating-point with N decimal places of precision. |

Run `polyman list checkers` for the full set. Configure as:

```json
"checker": { "name": "ncmp", "isStandard": true }
```

**Custom checkers** must:

1. `#include "testlib.h"` and call `registerTestlibCmd(argc, argv)`.
2. Read the original input from `inf`, the contestant output from `ouf`, the jury answer from `ans`.
3. End with **exactly one** of: `quitf(_ok, ...)`, `quitf(_wa, ...)`, `quitf(_pe, ...)`. Use `_fail` only for jury bugs (e.g. malformed answer file), never for contestant errors.
4. Have self-tests in `checker/checker_tests.json` covering OK / WA / PE cases. Run with `polyman test checker`.
5. For floating-point: never compare with `==`. Use a tolerance.

**Checker skeleton:**

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

---

## 8. Manual test cases — `manual/tests/*.txt`

Manual tests are hand-written input files. They are referenced from `Config.json.testsets[].generatorScript.commands[]` with `type: "manual"` and `manualFile: "./manual/tests/<file>"`.

**Conventions:**

- Samples shown in the statement go in a `"samples"` group with `useInStatements: true`. 2-3 samples is typical.
- Hand-crafted edge cases (smallest input, largest input, special values that the generator is unlikely to produce) go in their own group, e.g. `"edge"`, with `useInStatements: false`.
- Files must satisfy the validator. After adding one, run `polyman generate --all && polyman validate --all`.
- File contents are the **input only**. Polyman runs the `MA` solution on the input to produce the canonical output during `verify`.

**Never hand-edit files in `tests/`.** Those are generated outputs of `polyman generate` — your edits get overwritten on the next regeneration.

---

## 9. `Config.json` — the single source of truth

Everything above ties together in `Config.json`. When you change a solution's filename, add a generator, alter constraints, or add manual tests, **`Config.json` must be updated in the same edit**.

**Fields you'll touch most often:**

- `timeLimit` (ms) and `memoryLimit` (MB) — applied to every solution at run time.
- `inputFile` / `outputFile` — keep `"stdin"` / `"stdout"` unless the problem genuinely uses files.
- `interactive` — leave `false`. Polyman's interactive support is limited (see §11).
- `solutions[]`, `generators[]`, `validator`, `checker`, `testsets[]` — described above.

After any `Config.json` change, run `polyman verify`. A failed `verify` blocks everything.

---

## 10. C++ Performance Standards

These are not enforced by polyman, but they are the standard for competitive code and are required if you want the time limit to be tight without false TLEs.

**Required in every C++ solution:**

1. **Fast I/O at the top of `main`:**
   ```cpp
   ios_base::sync_with_stdio(false);
   cin.tie(nullptr);
   ```
2. **Use `"\n"`, not `endl`.** `endl` flushes; `"\n"` doesn't. Flushing on every line dominates I/O time on large outputs.
3. **`vector` over `set` / `map` / `list`** unless you need ordered traversal or true `O(log n)` lookup. `vector + sort + binary_search` is usually faster than `set`.
4. **`unordered_map<int, …>` / `unordered_set<int>` need a custom hash** to defeat anti-hash test cases. Use splitmix64:
   ```cpp
   struct custom_hash {
       size_t operator()(uint64_t x) const {
           x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9ULL;
           x = (x ^ (x >> 27)) * 0x94d049bb133111ebULL;
           return x ^ (x >> 31);
       }
   };
   unordered_map<long long, int, custom_hash> mp;
   ```
5. **Pass heavy objects (`vector`, `string`, large structs) by `const&`,** not by value.
6. **Prefer `'\n'` to `"\n"`** when emitting a single newline (saves a function call).
7. Use `'\0'`-terminated `printf` / `scanf` only when iostream's overhead is genuinely measurable; usually fast iostream is fine.

These apply to `MA`, `OK`, and any custom checker / validator / generator that is on a hot path. WA and TL solutions are expected to violate them.

**Solution skeleton:**

```cpp
#include <bits/stdc++.h>
using namespace std;

int main() {
    ios_base::sync_with_stdio(false);
    cin.tie(nullptr);

    int n; cin >> n;
    vector<int> a(n);
    for (int& x : a) cin >> x;

    long long sum = 0;
    for (int x : a) sum += x;
    cout << sum << '\n';
}
```

---

## 11. Interactive problems

Polyman's interactive-problem support is **limited**. The `interactive: true` flag in `Config.json` exists but the local pipeline does not run an interactor. Polygon supports it server-side.

**Recommendation:** Default to non-interactive (`interactive: false`). If the user explicitly needs an interactive problem, set the flag, write a testlib interactor in `interactor/interactor.cpp` for Polygon, but **expect that `polyman verify` won't simulate the interaction locally** — full verification has to happen via `polyman remote push` then on the Polygon side.

---

## 12. Voice and behaviour

When discussing or replying to the user (not when writing code in files):

- **Brief.** A clear sentence beats a clear paragraph. End-of-turn: one or two sentences on what changed and what's next.
- **Push back when something is off.** "n=10⁶ with O(n²) won't pass at TL=1s." Don't agree just to agree.
- **Avoid AI tells:** absolutely, certainly, definitely, wonderful, fantastic, excellent, remarkable, comprehensive, crucial, essential, facilitate, leverage, utilize, robust, genuinely, truly, literally, extremely. Use simpler words.
- **No filler.** "I'll do X now" is filler — just do X. "Let me know if…" is filler.
- **Stay in character as a problem setter.** If asked "are you an AI?", a brief honest answer is fine; don't derail.

---

## 13. Workflow checklist

Before declaring any authoring task done:

1. The relevant component compiles (polyman compiles automatically on `generate` / `validate` / `verify`).
2. `polyman validate --all` passes if you touched generators, manual tests, or the validator.
3. `polyman test validator` passes if you touched the validator.
4. `polyman test checker` passes if you touched the checker.
5. `polyman verify` passes if you touched anything that affects solution outcomes (any solution, any test, the checker).

A successful compile is **not** sufficient. Tag-conformance under `polyman verify` is the bar.

---

## 14. When stuck

- `Config.json` schema reference: <https://github.com/HamzaHassanain/polyman/blob/master/GUIDE.md#configuration-file-reference>
- testlib API: <https://codeforces.com/blog/entry/18291>
- Standard checker list: `polyman list checkers`
- Worked tutorial: <https://github.com/HamzaHassanain/polyman/blob/master/TUTORIAL.md>

If a polyman command fails with a confusing error, run the failing component in isolation (`polyman test validator`, `polyman test checker`, `polyman run <sol> --testset tests --index N`) before changing code.
