# `polyman cache`

Polyman caches every C++ binary it compiles in `.polyman/cache/` at the problem root. Compile steps in `generate`, `validate`, `run`, `test` and `verify` reuse a cached binary when nothing that affects it has changed.

```bash
polyman cache status   # cached binaries, their size, last use
polyman cache clear    # delete the cache
```

## When a source is recompiled

A cached binary is reused only when all of these are unchanged:

- the source file,
- every local header it includes with `#include "..."`, recursively (including `testlib.h`),
- `cppStandard` in `Config.json`,
- the compiler (`g++ --version`).

Editing any of them triggers a recompile automatically. You don't need to clear the cache after editing sources.

## When to bypass it

- `--no-cache` on any compiling command recompiles everything for that run and leaves the cache untouched.
- `polyman cache clear` if you edited a system header (`#include <...>`) or suspect the cache is wrong.

## What NOT to do

- Don't edit or copy files inside `.polyman/cache/` by hand.
- Don't commit `.polyman/`; it is machine-specific.
- Java solutions are not cached; they are always compiled with `javac`.
