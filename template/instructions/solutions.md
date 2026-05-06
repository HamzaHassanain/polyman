# solutions.md — `solutions/*.{cpp,java,py}` + `Config.json.solutions[]`

Solutions are reference and adversarial implementations of the problem. Every solution carries a **tag** declaring its expected behavior. `polyman verify` fails the whole problem if a solution doesn't match its tag.

## Solution tags

| Tag  | Meaning                | What `verify` expects                          |
| ---- | ---------------------- | ---------------------------------------------- |
| `MA` | Main correct           | Passes every test. **Exactly one required.**   |
| `OK` | Alternative correct    | Passes every test.                             |
| `WA` | Wrong answer           | WA on at least one test.                       |
| `TL` | Time limit exceeded    | TLE on at least one test.                      |
| `TO` | TLE-or-OK              | Algorithmically correct, may TLE — not strict. Use sparingly. |
| `ML` | Memory limit exceeded  | MLE on at least one test.                      |
| `RE` | Runtime error          | Crashes on at least one test.                  |
| `PE` | Presentation error     | PE on at least one test.                       |
| `RJ` | Rejected (any failure) | Fails some test, any verdict.                  |

### Picking a tag

- A correct, fast reference → `MA` (only if no `MA` exists yet) or `OK`.
- A correct but slow alternative meant to TLE under the limit → `TL`. If it might or might not TLE → `TO`.
- A submission with a known bug intended to fail → `WA` (or `PE` if the bug is purely formatting).
- A brute force kept for cross-checking → `OK` (if it fits the time limit) or `TO`.

## Config.json entry

```jsonc
"solutions": [
  { "name": "main",   "source": "./solutions/acc.cpp",   "tag": "MA", "sourceType": "cpp.g++17" },
  { "name": "brute",  "source": "./solutions/brute.cpp", "tag": "OK", "sourceType": "cpp.g++17" },
  { "name": "tle",    "source": "./solutions/tle.py",    "tag": "TL", "sourceType": "python.3" }
]
```

`sourceType` values: `cpp.g++17` (default), `cpp.g++20`, `cpp.clang++17`, `cpp.clang++20`, `java.11`, `java.17`, `java.21`, `python.3`, `python.pypy3`.

## Naming

Polygon refuses two solutions with the same stem and different extensions (`acc.cpp` + `acc.java` collide). Use distinct stems: `acc.cpp`, `acc2.java`, `tle.py`.

## What to do

- **The `MA` solution should be C++** unless you have a strong reason otherwise. Python/Java MA risks failing the time limit you set, which breaks the meaning of "correct".
- C++ solutions on the hot path (`MA`, `OK`, sometimes `TO`) must follow `instructions/cpp-performance.md`.
- After adding/editing a solution, run `polyman run <name> --all` then `polyman verify`.
- When adding a buggy/slow/MLE/RE solution, **also** add the matching tag — otherwise `verify` will reject the whole problem.

## What NOT to do

- Don't ship two solutions with the same stem (`acc.cpp` + `acc.java` will collide on Polygon).
- Don't tag a solution as `MA` if a `MA` already exists; promote one or demote the other to `OK`.
- Don't forget `sourceType`. Polygon defaults to C++ if omitted, which silently miscompiles Java/Python.
- Don't run a solution by hand-spawning g++/python/java — let polyman compile and execute so time/memory limits are enforced consistently.
- Don't leave a solution with no body and no tag in `Config.json.solutions[]` — `verify` will fail and the error is confusing.

## Solution skeleton (C++)

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

See `instructions/cpp-performance.md` for the full performance contract.
