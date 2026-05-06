# `polyman new <directory>`

Materializes a fresh problem template into `<directory>`. Bundles `Config.json`, `solutions/`, `generators/` (with `gen-script.txt`), `validator/`, `checker/`, `statements/{english,russian}/`, `manual/tests/`, plus the `instructions/` tree.

```bash
polyman new my-problem
cd my-problem
```

## What you get

```
my-problem/
├── Config.json
├── CLAUDE.md, AGENTS.md
├── instructions/...
├── solutions/acc.cpp + acc2.java + tle.py
├── generators/gen.cpp + gen-script.txt
├── validator/val.cpp + validator_tests.json
├── checker/chk.cpp + checker_tests.json
├── statements/{english,russian}/*.tex
└── manual/tests/m-01-sample.in
```

## Conventions

- `<directory>` is the new problem's path. It will be created if missing.
- The Polygon problem **name** (the slug Polygon uses) is set later from `Config.json.name` on first `polyman remote push`. `polyman new` only seeds a placeholder.

## What NOT to do

- Don't run inside an existing problem directory. It doesn't refuse, but you'll overwrite files unintentionally.
- Don't rename `Config.json`. The whole CLI hard-codes that filename.
- Don't manually copy the template directory and skip `polyman new`. The bundled `polyman` CLI knows where its template lives; copies risk drift.

## Next steps after `polyman new`

```bash
cd my-problem
polyman download-testlib       # fetch testlib.h
polyman generate --all         # produce the tests from the seed script + sample
polyman verify                 # end-to-end check (will fail until you fill in the stubs)
```
