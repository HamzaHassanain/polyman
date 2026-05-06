# `polyman list <what>`

Read-only inspection of declared resources. No side effects.

```bash
polyman list solutions     # name, source, tag
polyman list generators    # name, source
polyman list checkers      # standard testlib checkers shipped with polyman
polyman list testsets      # testset name + resolved test count + groups
```

## What each form prints

### `polyman list solutions`

Reads `Config.json.solutions[]`. One line per solution:

```
1. main           → ./solutions/acc.cpp                (MA - Main Accepted)
2. correct2       → ./solutions/acc2.java              (OK - Accepted)
3. tle_solution   → ./solutions/tle.py                 (TL - Time Limit)
```

### `polyman list generators`

Reads `Config.json.generators[]`. One line per generator:

```
1. gen-random     → ./generators/gen.cpp
2. gen-edge       → ./generators/edge.cpp
```

### `polyman list checkers`

Lists every standard checker bundled in polyman's `assets/checkers/` directory, with the description from each checker's source comment. Doesn't need `Config.json` — runs from anywhere.

```
1. ncmp.cpp        → Compare two sequences of integer numbers
2. wcmp.cpp        → Compare sequences of tokens
3. yesno.cpp       → Single token YES/NO (case-insensitive)
…
```

Use this output to pick the right standard checker for `Config.json.checker.source` (see [`../checker.md`](../checker.md)).

### `polyman list testsets`

Reads `Config.json.testsets[]`, parses every script + manual list, and reports the resolved count:

```
1. tests: 4 tests, groups: samples, main
```

Counts include manuals + every script-line target after `$` resolution and `<#list>` expansion.

## When to use

- Quick sanity check before / after editing `Config.json`.
- Picking a standard checker (`polyman list checkers`).
- Confirming the script + manuals resolve to the test count you expect (`polyman list testsets`).

## What NOT to do

- Don't rely on the line numbering as IDs — it's purely a display index.
- Don't expect `list` to show what's on disk vs. what's declared. It only reads `Config.json`. To see resolved files, run `polyman generate` and inspect `testsets/<testset>/`.
- Don't try `polyman list` without a subcommand — it prints help and exits.
