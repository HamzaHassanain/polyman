# commands/index.md — polyman CLI map

One file per top-level command. **Read only the file for the command you are about to invoke.** Don't pre-load the whole CLI surface.

| Command | What it does | File |
| --- | --- | --- |
| `polyman new` | Materialize a fresh problem template. | [`new.md`](./new.md) |
| `polyman download-testlib` | Fetch `testlib.h` into the current directory. | [`download-testlib.md`](./download-testlib.md) |
| `polyman list <what>` | Inspect declared solutions / generators / testsets / standard checkers. | [`list.md`](./list.md) |
| `polyman generate` | Materialize tests from the script + manual tests. | [`generate.md`](./generate.md) |
| `polyman validate` | Run the validator on every input. | [`validate.md`](./validate.md) |
| `polyman run <solution>` | Run a solution on the targeted tests. | [`run.md`](./run.md) |
| `polyman test <what>` | Run validator / checker self-tests, or compare a solution to main. | [`test.md`](./test.md) |
| `polyman verify` | Full pipeline: generate, validate, run, tag-check. | [`verify.md`](./verify.md) |
| `polyman remote …` | Polygon-side operations (register, list, pull, push, view, commit, package). | [`remote.md`](./remote.md) |

## Filter conventions (shared by `generate`, `validate`, `run`)

Filter flags are **mutually exclusive** — pick one per invocation:

- `--all`, `-a` — every testset (default if no filter is given).
- `--testset <name>`, `-t <name>` — one testset.
- `--testset <name> --group <name>`, `-g <name>` — one group within a testset.
- `--testset <name> --index <N>`, `-i <N>` — one test by Polygon index.

`--index` is the Polygon test number (the `> N` in the script or `manualTests[].index`), not the position in the script.

## Global flags

- `polyman --version` (or `-V`) — print version.
- `polyman --help` (or `-h`) — comprehensive help.
- `polyman <command> --help` — per-command help.
