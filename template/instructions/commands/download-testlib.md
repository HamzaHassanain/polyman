# `polyman download-testlib`

Fetches `testlib.h` from the upstream GitHub repo into the **current** working directory.

```bash
polyman download-testlib
```

`testlib.h` is required to compile generators, validators, and custom checkers — they all `#include "testlib.h"`. polyman won't compile them otherwise.

## Where the file ends up

In the current working directory. For polyman to find it during compilation, run this from the **problem directory**:

```bash
cd my-problem
polyman download-testlib
```

The command also prints platform-specific instructions for installing `testlib.h` system-wide (`/usr/include`, `/usr/local/include`, or the MinGW include dir on Windows). System-wide install is optional — polyman finds `testlib.h` in the problem dir by default.

## When to run it

- Right after `polyman new`, before the first `polyman generate` / `polyman verify`.
- After upgrading polyman to a new major version, in case the bundled testlib is updated.
- If `polyman generate` errors with `testlib.h: No such file or directory`.

## What NOT to do

- Don't modify `testlib.h` after downloading. polyman expects the upstream version.
- Don't rerun if it's already there and working — it's harmless but pointless.
- Don't commit `testlib.h` if your project policy excludes vendored upstream — polyman will re-download on demand.
