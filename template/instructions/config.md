# config.md — `Config.json` schema

The single source of truth for the whole problem. Every other file is referenced from here.

## Top-level fields

```jsonc
{
  "problemId": 12345,                    // optional; set after `polyman remote push`
  "name": "my-problem",                  // lowercase, dashes only
  "owner": "username",                   // optional Polygon owner
  "description": "Short description.",
  "tags": ["implementation", "math"],

  "timeLimit": 1000,                     // ms, applied to every solution
  "memoryLimit": 256,                    // MB
  "inputFile": "stdin",                  // keep "stdin" unless asked
  "outputFile": "stdout",                // keep "stdout" unless asked
  "interactive": false,                  // see instructions/checker.md (custom checker) — true is rare

  "compiler": {                          // optional, local-only; omit unless the user asks
    "cpp": "g++-15",                     // C++ compiler executable (default "g++")
    "javac": "javac",                    // Java compiler executable (default "javac")
    "flags": ["-O2", "-std=c++23"]       // extra flags appended to every C++ compile
  },

  "statements":  { …see statements.md… },
  "solutions":   [ …see solutions.md…  ],
  "generators":  [ …see generators.md… ],
  "validator":   { …see validator.md…  },
  "checker":     { …see checker.md…    },
  "testsets":    [ …below             ]
}
```

`compiler` only affects how polyman compiles on this machine; it is never sent to Polygon (Polygon uses `sourceType`). The environment variables `POLYMAN_CXX` and `POLYMAN_JAVAC` override `compiler.cpp` and `compiler.javac`.

## `testsets[]`

Usually one named `"tests"`. Each entry:

```jsonc
{
  "name": "tests",
  "groupsEnabled": true,                 // optional, default false
  "pointsEnabled": false,                // optional, default false
  "groups": [                            // required if groupsEnabled
    { "name": "samples" },
    { "name": "main" }
  ],
  "generatorScript": {                   // see instructions/generator-script.md
    "scriptFile": "./generators/gen-script.txt"
    // OR: "script": "<#-- @group main -->\ngen 1 > $\n"
  },
  "manualTests": [                       // see instructions/manual-tests.md
    { "input": "./manual/tests/m-01-sample.in",
      "output": "./manual/tests/m-01-sample.out",
      "index": 1, "group": "samples", "useInStatements": true }
  ]
}
```

- `generatorScript` and `manualTests` are independent: tests come from both, indexed in one shared 1..N space.
- Indices in the script (`> N` / `> {…}`) and in `manualTests[].index` must be globally unique inside a testset.

## Common edits

- **Add a solution / generator / manual test** → add the source file *and* the `Config.json` entry in the same edit.
- **Change time/memory** → update `timeLimit` / `memoryLimit`, run `polyman verify`.
- **Switch checker** → see `instructions/checker.md`.
- **Multiple testsets** → append another `testsets[]` entry; each testset has its own script + manuals.

## What NOT to do

- Don't desync `Config.json` from disk: every solution / generator / manual file referenced here must exist (and vice-versa for declared entries).
- Don't add `commands[]` under `generatorScript` — that shape was removed. Use `script` or `scriptFile` only.
- Don't reference an undefined group from a script `@group` header or a manual entry.
- Don't change `name` after the first `polyman remote push` — Polygon problem names are immutable post-creation.

## After any `Config.json` change

Run `polyman verify`. A failed `verify` blocks everything.
