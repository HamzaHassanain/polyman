# generator-script.md — Polygon-format generator script

The script lives at `generators/gen-script.txt` (or inline as `Config.json.testsets[].generatorScript.script`). Polygon parses the same format on its server, so it round-trips with `polyman remote pull / push`.

## Line shape

Each non-comment line is:

```
generator-name [args...] > target
```

| Target | Meaning |
| --- | --- |
| `N`        | Explicit Polygon test index. `gen 1 > 5` writes to `test5.txt`. |
| `$`        | Smallest unused index. Polyman resolves at parse time. |
| `{1-3,7,9-10}` | **Multi-output.** The generator itself writes those files; no stdout redirect. Polyman runs the generator once with cwd set to the testset directory and verifies each promised file exists afterwards. |

### Index uniqueness

Indices are unique across the whole testset — script lines, multi-output targets, AND every `manualTests[].index`. A duplicate is an error.

`$` walks the smallest free positive integer, **skipping** anything reserved by manual tests or earlier explicit lines.

## Comments and FreeMarker

- `<#-- … -->` is a comment. Drop it on its own line or inline; it is stripped.
  - **Comments cannot be nested.** `<#-- outer <#-- inner --> -->` closes after the first `-->`.
- `<#-- @group <name> -->` headers tag every following line with that group, until the next `@group` (or end of file). The group surfaces as `LocalTestset` group metadata and is what `polyman generate --group <name>` filters on.
- `<#list a..b as i> … ${i} … </#list>` expands to one line per integer in `[a, b]` inclusive. `${i}` is substituted for each iteration.
- Reverse loops (`<#list 5..1 as i>`) work too.

## Example

```
<#-- Common cases -->
<#-- @group main -->
<#list 1..50 as i>
gen-random ${i} > $
</#list>

<#-- Tight edge cases -->
<#-- @group edge -->
gen-edge tiny  > $
gen-edge huge  > $

<#-- A counter-example pair the generator emits in one run -->
<#-- @group pair -->
gen-pair 7 > {100-101}
```

## What NOT to do

- **No extensions in generator names.** `gen.exe 1 > $`, `gen.cpp 1 > $` are rejected by the parser. Use the bare name from `Config.json.generators[].name`.
- **No nested comments.** `<#-- outer <#-- inner --> -->` parses as `<#-- outer <#-- inner -->` followed by stray `-->` text.
- **No duplicate indices.** Two lines claiming the same `> N`, or a manual test colliding with a script line, both fail.
- **No mixing `> $` with already-occupied indices implicitly.** If a manual is at index 5, then the script line `gen 1 > $` resolves to whatever the smallest free integer is — possibly index 6, not 5. If you need a specific index, use `> N` explicitly.
- **No raw shell metachars** (`>>`, `&`, `;`, pipes). Targets are `N`, `$`, or `{indices}` — that's it.
- **No empty `> {}` targets.** Multi-output must list at least one index.

## How `> $` resolves

Pseudocode:

```
used = { every index claimed by manualTests[] and by every earlier line }
for each line in source order:
  if target is an explicit N or {indices}: assert none collide, mark them used.
  if target is $:        pick the smallest k >= 1 not in used; mark k used.
```

Because the order is source-order, `$` resolution is deterministic and stable across reruns.

## Multi-output `> {indices}` semantics

- Polyman runs the generator **once** per multi-output line (not once per index).
- Working directory is set to the testset's output directory.
- The generator must produce a file for each listed index. Acceptable filenames:
  `<N>`, `<N>.txt`, `test<N>`, `test<N>.txt` — polyman finds whichever was written and renames to `test<N>.txt`.
- Missing or extra files are an error.

Example generator that writes two files per invocation:

```cpp
#include "testlib.h"
#include <fstream>
using namespace std;

int main(int argc, char* argv[]) {
    registerGen(argc, argv, 1);
    int seed = atoi(argv[1]);

    ofstream a("test" + to_string(2 * seed - 1) + ".txt");
    a << /* first input */ << "\n";
    a.close();

    ofstream b("test" + to_string(2 * seed) + ".txt");
    b << /* second input */ << "\n";
    b.close();
}
```

Script line: `gen-pair 7 > {13,14}`.

## Round-trip with Polygon

`polyman remote push` uploads the script text **verbatim** (no parsing). `polyman remote pull` writes the script text **verbatim** to `generatorScript.script`. There is no JSON round-trip in either direction.

## Files vs inline

```jsonc
"generatorScript": { "scriptFile": "./generators/gen-script.txt" }   // preferred
"generatorScript": { "script": "gen 1 > $\ngen 2 > $" }              // inline alternative
```

Both work; pick one. Don't set both.
