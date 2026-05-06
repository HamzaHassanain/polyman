# generators.md — `generators/*.cpp` + `Config.json.generators[]`

Generators are testlib C++ programs that print a single test input to stdout. They are invoked by the generator script (see `instructions/generator-script.md`) with positional arguments.

## Hard rules

1. **C++ only**, with `#include "testlib.h"`.
2. Call `registerGen(argc, argv, 1)` first thing in `main`.
3. Read CLI arguments **positionally** via `argv[1]`, `argv[2]`, … parsed with `atoi` / `atoll` / `atof`. **Do NOT** use testlib's `opt<T>("name")` — polyman's generator script passes positional args only.
4. Output goes to **stdout** with `cout` / `printf`. The generated test is whatever you print.
5. **Deterministic given the same args.** testlib's `rnd` is seeded from the args, so identical args produce identical output. Do not use `srand`, `time(NULL)`, `/dev/urandom`, or any other source of system entropy.
6. Output must satisfy the validator. After authoring, run `polyman generate --all && polyman validate --all` before declaring done.

## Config.json entry

```jsonc
"generators": [
  { "name": "gen-random", "source": "./generators/gen.cpp" },
  { "name": "gen-edge",   "source": "./generators/edge.cpp" }
]
```

`name` is what the script line uses; `source` is the on-disk file. The two don't have to match.

## How the script invokes a generator

See `instructions/generator-script.md`. Each script line is `gen-name [args...] > target` — for `gen-random 7 > $`, polyman runs `./gen-random 7` with stdout redirected to `testsets/<testset>/test<index>.txt`.

For multi-output `> {1-3,7}`, the generator runs **once** with cwd set to the testset directory and is expected to write the listed files itself (no stdout redirect). See `instructions/generator-script.md` for details.

## Generator skeleton

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

## Patterns by use case

- **Stress / random tests:** `<#list 1..N as i> gen-random ${i} > $ </#list>` — one generator instance, varying seed.
- **Specific edge values:** `gen-edge max-n > $`, `gen-edge min-n > $` — distinct argv tokens that the generator branches on.
- **Pair / trio of related tests** (e.g. counter-examples): multi-output. `gen-pair 4 7 > {3-5}` writes three files at once, named so polyman can pick them up (`1`, `2`, `3` or `test1.txt`, `test2.txt`, `test3.txt`, etc.).

## What NOT to do

- Don't read named options (`opt<T>("name")`) — polyman passes positional args only.
- Don't use system randomness (`srand`, `time`, `random_device`). Generators must be reproducible.
- Don't write to files directly **except** for multi-output generators (`> {…}` targets), which must write to relative paths in cwd.
- Don't skip the validator: produce input that the validator rejects and `polyman validate --all` will fail.
- Don't include extensions when referencing the generator from the script (`gen.exe 1 > $` is rejected by polyman; use `gen 1 > $`).
- Don't change the generator's argv contract without updating the script.

## Self-tests

Generators have **no** dedicated self-test fixture — `polyman validate --all` against the generated tests is the test. If you need extra coverage, add an explicit `gen-edge … > $` line per edge case to the script.
