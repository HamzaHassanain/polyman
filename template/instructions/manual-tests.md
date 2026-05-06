# manual-tests.md — Hand-authored tests under `manual/<testset>/`

Manual tests are input files written by the author rather than produced by a generator. They live alongside the testset and are declared in `Config.json.testsets[].manualTests[]`.

## Filename convention

```
manual/<testset>/m-<NN>[-label].in       # required: the test input
manual/<testset>/m-<NN>[-label].out      # optional: reference answer (round-trips with Polygon)
```

- `<NN>` is the Polygon-side test index, zero-padded for ordering (`m-01-...`, `m-02-...`).
- `-<label>` is a free-text suffix for human readability (`m-01-sample.in`, `m-02-edge-large.in`). Optional.
- The leading `m-` distinguishes manuals from generated `test<N>.txt` files in `testsets/<testset>/`.

## Config.json entry

```jsonc
"manualTests": [
  { "input": "./manual/tests/m-01-sample.in",
    "output": "./manual/tests/m-01-sample.out",   // optional
    "index": 1,
    "group": "samples",
    "useInStatements": true,
    "points": 0                                    // optional
  }
]
```

| Field | Meaning |
| --- | --- |
| `input` | Path to the `.in` file. **Required.** |
| `output` | Path to the matching `.out` reference answer. Optional; when present it round-trips with Polygon and stays as bookkeeping. |
| `index` | Polygon-side test number. **Unique** across the script (`> N` / `> {…}`) and every other manual entry. |
| `group` | Test group (must appear in `testsets[].groups[]` if `groupsEnabled: true`). |
| `useInStatements` | `true` → Polygon embeds the test under the rendered statement. Use for samples. |
| `points` | Per-test points if `pointsEnabled: true`. |

## Conventions

- **Samples** (the I/O shown in the statement) → `group: "samples"`, `useInStatements: true`. 2-3 samples is typical.
- **Hand-crafted edge cases** (smallest, largest, special structures the generator is unlikely to produce) → their own group like `"edge"`, `useInStatements: false`.
- The `.in` file content is the **input only**. Polyman runs the `MA` solution to derive the canonical output during `verify`.
- The optional `.out` file is the reference answer; it round-trips with `polyman remote pull / push` but the local pipeline still uses the `MA`-generated output for checker comparison.

## Lifecycle

1. Drop the `.in` (and optional `.out`) under `manual/<testset>/m-<NN>[-label].in`.
2. Add the matching `manualTests[]` entry in `Config.json` — same edit.
3. `polyman generate --all` copies the input into `testsets/<testset>/test<index>.txt`.
4. `polyman validate --all` confirms the validator accepts it.
5. `polyman verify` confirms every solution behaves as its tag claims, on the new test included.

## What NOT to do

- **Don't put manual tests inside the generator script.** Polygon stores manuals out-of-band; mixing them in the script breaks the round-trip.
- **Don't reuse an `index`** between two manuals or between a manual and a script line. Polyman flags duplicate-index errors at parse time.
- **Don't hand-edit `testsets/<testset>/test<N>.txt`.** Those are derived; they get overwritten on the next `polyman generate`. Edit the source `.in` under `manual/` instead.
- **Don't omit `index`.** It's required and must be explicit; polyman does not auto-assign manuals.
- **Don't ship a `.in` whose content fails the validator.** After adding one, run `polyman validate --all`.
- **Don't rename the file without updating the `input` field** (and `output` if present) in `Config.json`. Out-of-sync paths fail `polyman generate`.
- **Don't add a manual with `group: "X"` when `"X"` isn't in `testsets[].groups[]`** — `polyman generate --group X` will silently skip nothing it expected.

## Renumbering

If you want to shift a manual from index 2 to index 5:

1. Rename the file: `m-02-foo.in` → `m-05-foo.in` (and `.out` if present).
2. Update `index: 5` in the `manualTests[]` entry.
3. Make sure no script line is producing `> 5` already; if so, free that index first.
4. `polyman generate --all`.

There is no automation for renaming. Both changes happen in the same edit.

## CRLF on Windows

`.in` files are checked into git. Configure `.gitattributes` so manual `.in` / `.out` files use the same line endings on every platform — mixed CRLF/LF can cause silent validator/checker failures on round-trip.
