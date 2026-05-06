# cpp-performance.md — C++ performance contract

These standards are not enforced by polyman, but they are the standard for competitive code and are required if you want the time limit to be tight without false TLEs.

Apply to: `MA` and `OK` C++ solutions, custom checker, validator, and any generator that runs on a hot path. `WA`/`TL` adversarial solutions are expected to violate them.

## Required at the top of `main`

```cpp
ios_base::sync_with_stdio(false);
cin.tie(nullptr);
```

`sync_with_stdio(false)` decouples C and C++ stdio; `cin.tie(nullptr)` removes the implicit `flush(cout)` before every `cin`.

## Use `"\n"`, not `endl`

`endl` flushes; `"\n"` doesn't. On large outputs the flushing dominates I/O time. Prefer `'\n'` to `"\n"` when emitting a single newline (one less function call).

## Container choice

- Default to `vector` over `set` / `map` / `list`. Unless you need ordered traversal or true `O(log n)` lookup, `vector` + `sort` + `binary_search` is faster, more cache-friendly, and uses less memory.
- `array<T, N>` over `vector<T>` when `N` is a compile-time constant.
- `string` is a `vector<char>` for performance purposes — same advice applies.

## `unordered_map` / `unordered_set` need a custom hash

Contest judges include anti-hash tests that murder the default `std::hash<int>`. Always use splitmix64:

```cpp
struct custom_hash {
    size_t operator()(uint64_t x) const {
        x = (x ^ (x >> 30)) * 0xbf58476d1ce4e5b9ULL;
        x = (x ^ (x >> 27)) * 0x94d049bb133111ebULL;
        return x ^ (x >> 31);
    }
};

unordered_map<long long, int, custom_hash> mp;
unordered_set<long long, custom_hash>      st;
```

## Pass heavy objects by `const&`

```cpp
void f(const vector<int>& a)        // ✓
void f(vector<int> a)                // ✗ copy on every call
```

Applies to `vector`, `string`, `map`, large structs, and anything else with non-trivial copy cost.

## Solution skeleton

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

## Digit separators on large literals

Use C++14 single-quote separators on any integer literal `≥ 10000`. Polygon's review surface flags bare `1000000` etc. as readability warnings, and large bare numbers are easy to miscount when reading code.

```cpp
const int MAXN   = 200'000;        // ✓     not 200000
const int LIMIT  = 1'000'000'000;  // ✓     not 1000000000
const long long M = 1'000'000'007; // ✓     not 1000000007
```

Apply everywhere it would otherwise be a wall of digits: validator bounds, generator bounds, checker thresholds, solution constants.

## Other notes

- `printf` / `scanf` are sometimes marginally faster than fast iostream, but the difference is rarely measurable. Don't reach for them unless you have a profile.
- For very large output (millions of tokens), build a `string` buffer and `cout << buf` once, instead of streaming each token.
- Use `int` until you can prove `long long` is needed; the latter is twice as wide and slower for arithmetic.
- Avoid `map<string, T>` in hot paths — string comparisons are slow. Hash strings to `uint64_t` and use `unordered_map<uint64_t, T, custom_hash>`.

## What NOT to do

- Don't use `endl`. (Worth saying twice.)
- Don't use `system_clock`, `chrono::high_resolution_clock`, or any wall-clock measurement inside the solution. Polyman enforces time limits externally; your `chrono` calls only slow you down.
- Don't read with `cin` and `scanf` mixed without `sync_with_stdio(false)` first — interleaving order becomes undefined.
- Don't `cin >> v` where `v` is a `vector` of structs — you have to read field by field.
- Don't use `std::endl` in a tight `for` loop. (Yes, three times.)
- Don't preallocate memory you don't need. `vector<int> a(n)` is fine; `vector<int> a; a.reserve(n);` is fine; `vector<int> a(MAXN)` is wasteful.
- Don't trust `unordered_map`'s default hash on a CP judge. Always custom-hash.

## Performance profile

The above earns you a 4-5x speedup over naive C++ on I/O-heavy problems and removes most "my algorithm is right but TLE" surprises. If you are still TLE'ing after applying these rules, the algorithm is wrong, not the language.
