# polyman corpus

Real problems and deliberately wrong solutions whose **true** verdicts are pinned in
`expected/`. `run.mjs` runs `polyman verify --json` on a fresh copy of every problem and
fails if polyman judges any solution differently. The unit tests mostly mock processes and
never run `verify` on a real problem; this runs real compilers, real checkers and real solutions.

```bash
npm run build
node corpus/run.mjs                 # check against expected/, writes out/junit.xml + out/summary.json
node corpus/run.mjs --only sum-parity
node corpus/run.mjs --record        # draft expected/ from polyman's own output (review before committing!)
```

## How expected verdicts are set

`--record` only drafts a file. A recorded file trusts polyman, so it would freeze polyman's
bugs into the corpus. Every pinned verdict is checked against an independent judgment of the
solution's actual output before it is committed.

`truth.mjs` is that independent judgment, without polyman: it compiles the generators,
validator, checker and solutions with g++ and javac itself, generates the tests from the
script, runs each solution with the time limit and asks the checker about every test that
ran. The `truth` job (`.github/workflows/corpus.yml`) runs it on every problem and fails if a
pinned file disagrees, so the expected verdicts are re-derived on each run instead of trusted.

```bash
node corpus/truth.mjs pair-target          # print what expected/pair-target.json should say
node corpus/truth.mjs --check              # every problem against its pinned file
```

It reproduces `sum-parity.json`, which was pinned by hand before it existed. On Windows,
testlib validators expect CR LF line ends, so the validator steps come out false there.

## What is compared

- every verify step's pass/fail;
- every solution's per-test verdict and whether it matches its tag.

Timing is not judged exactly: an expected `OK` that comes back `TLE` is a warning (a slow
runner), and so are the tests after it, which polyman doesn't run once a solution times out.
Two cases still fail: a solution cut short with no expected `OK` still `OK` (that looks like a
broken limit), and one cut short before a test that expects `WA`, `RE`, `ML` or another
rejection (the verdict it is in the corpus for was never seen).
A solution that never terminates must keep getting `TLE`.

## Needs

`g++`, `java` and Python 3 (polyman runs `python3`, or `python` if that is Python 3).
`run.mjs` prints the toolchain it saw so a report always says where it ran.

## Problems

`sum-parity` is polyman's own template; the other four were written for this corpus, statements
included (MIT, like the rest of the repository). Each has a main solution, correct ones in other
languages, and mutants whose true verdict is the point of the problem.

| Problem           | What it pins                                                                                                                                                                                                           | Solutions             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `sum-parity`      | polyman's own template plus WA/RE/PE/TL mutants in C++ and Python                                                                                                                                                      | 10                    |
| `pair-target`     | a special checker: any pair of positions with the right sum is accepted, so correct solutions that find other pairs (or print them in the other order) must be OK; using one position twice is WA, a missing number PE | 8 (C++, Java, Python) |
| `distinct-count`  | several test cases per input file, standard checker `ncmp`: state not reset between cases (WA), only the first case answered (WA), `Case #k:` labels (PE), `vector::at` past the end (RE)                              | 7                     |
| `mean-deviation`  | real-valued output, standard checker `rcmp6` (1e-6): float arithmetic, two decimals, dividing by n - 1 (WA); "mean,deviation" as one token (PE)                                                                        | 8                     |
| `remainder-pairs` | a 2 s time limit that Java and Python must respect: linear solutions in all three languages pass, quadratic ones in Java and Python must get TLE on the first large test; an `int` answer that overflows (WA)          | 7                     |

On polyman 3.0.0 the corpus is red on every problem for the same two open bugs and nothing
else: the tests after a solution's first wrong answer are reported `OK` although the checker
never judged them (#21), and a presentation error is reported as `WA` (#28). Every `OK`, `TLE`
and `RTE`, and every solution's match with its tag, is right, Java and Python time limits included.

## Precompiled header

`pch-check.mjs` checks the precompiled `<bits/stdc++.h>` (#113) on one corpus solution: the
first problem whose main solution starts with `#include <bits/stdc++.h>`. It runs
`polyman run <main> --all` five times with `POLYMAN_DEBUG=1`, each on a fresh copy with the
same tests: PCH off (`--no-cache`), PCH built on an empty folder, the same PCH used again,
`compiler.flags: ["-O1"]` (a key of its own) and `POLYMAN_CXX=clang++` (skipped, not g++).
Each run must take that path, by polyman's log, and give the same verdicts and output files.
A compile that fails with the PCH (polyman retries without it, or marks the key unsupported)
fails the run, even though the fallback compile works.

```bash
npm run build
node corpus/pch-check.mjs                       # needs g++ and clang++
node corpus/pch-check.mjs --problem sum-parity --clang clang++-17 --keep
```

In CI it runs as the `pch` job of `.github/workflows/corpus.yml`, on the same events as `corpus`.

Known limits: `main()` is tested on its pieces (path parsing, run folders, judging each
result, exit codes) and on a bad argument, not end to end. A full run needs g++ and clang++,
so the exit 0 and 1 outcomes, a missing compiler, a failing `generate` and `--keep` are
proved by the `pch` job itself, not by a unit test.

## Polygon round trip

`polygon-roundtrip.mjs` pushes a corpus problem to Polygon with `polyman remote push`, reads it
back through the Polygon API and compares it with the folder: solutions (tag, source type),
checker and validator tests, generator script lines, manual tests and statements. It also fails
when polyman reported a successful push although Polygon differs.

It generates the tests locally with polyman and compares every input with the one Polygon generated,
byte for byte apart from line endings (testlib's random generator is seeded from the arguments, so
the two match across platforms; on 3.0.0 all four tests of `sum-parity` do). It also expands every script in `scripts/` twice, with polyman's own parser and with Polygon
(saved as the testset's script, read back test by test), and puts the problem's script back after.
polyman generates tests locally from its expansion and Polygon from its own, so a difference means
the setter verified other tests than the ones Polygon publishes.

```bash
POLYGON_API_KEY=... POLYGON_API_SECRET=... node corpus/polygon-roundtrip.mjs --problem-id 618552
POLYGON_API_KEY=... POLYGON_API_SECRET=... node corpus/polygon-roundtrip.mjs --all
```

In CI it runs nightly as the `polygon` job of `.github/workflows/nightly.yml`, on the default
branch only and only when the repository has the `POLYGON_API_KEY` and `POLYGON_API_SECRET`
secrets of a test Polygon account; without them the job is skipped. It runs with `--all`: every problem listed in `polygon.json` with its Polygon problem, one JUnit report each.
Each problem needs a Polygon problem of its own, and creating one is a person's decision, so a
problem that isn't listed is reported as skipped (by name, in the log and as skipped test cases)
instead of silently left out. Today only `sum-parity` (618552) is listed.

## Mutation testing

The `mutation` job of `.github/workflows/mutation.yml` runs [Stryker](https://stryker-mutator.io/) on `src/helpers/solution.ts`, where
verdicts are decided: it makes hundreds of small changes ("mutants") to the code and counts how many
the unit tests catch. On 3.0.0: 463 mutants, 115 survive and 34 are never executed by any test, a
score of 67.8%. One survivor: `isWATag` returning `true` for every tag passes all 967 tests. With
that bug, a solution tagged OK that gives wrong answers would no longer fail `verify`.

```bash
npm i --no-save --legacy-peer-deps @stryker-mutator/core@9 @stryker-mutator/vitest-runner@9
TZ=Asia/Kolkata ./node_modules/.bin/stryker run corpus/stryker.config.json   # report: corpus/out/mutation/index.html
node corpus/mutation-metrics.mjs corpus/out/mutation/mutation.json corpus/out/mutation-summary.md
```

`mutation-metrics.mjs` writes the score and the mutants no unit test catches as Markdown; in CI it
goes to the run's summary, and the HTML report is the `mutation-report` artifact.

### Judges vs the mutants the unit tests miss

Mutation testing measures the unit tests. `survivors.mjs` asks the next question, who judges the
judge: of the mutants the unit tests miss (Stryker's `Survived`, and `NoCoverage` reported
separately), how many does the corpus catch? Each mutant is planted in the source, polyman is
rebuilt with `tsc` and `run.mjs` judges all problems. A mutant is killed when any verdict or step
differs from the unmutated build judged in the same job (the release gate's rule), so an open bug
doesn't count as a kill. Each run gets the full `--timeout`; no verdict counts as a kill only when it
happens twice on the same problem, and a mutant that runs past three timeouts in all is an error, not
a kill. The source is put back after every mutant, also when a build or run fails or the job is
stopped; a stopped job also kills its child processes, but `dist/` may still be a mutant's build, so
run `npm run build` before using it. A mutant that `tsc` rejects is still judged (tsc emits JavaScript anyway)
and marked, since `npm run build` would fail on it.

```bash
npm run build
node corpus/survivors.mjs --report corpus/out/mutation/mutation.json --shard 1/8
node corpus/survivors.mjs report --shards 8     # sums corpus/out/survivors/shard-*.json
```

In CI (`.github/workflows/mutation.yml`), the `mutation` job runs Stryker, eight `survivors`
shards judge the mutants from its report and `survivors-report` puts `summary.md` in the run's
summary, with the kills of the unit survivors and of the untested mutants and their totals. It runs
on the weekly schedule and on workflow_dispatch, and on pushes to the default branch that change
something it reads (polyman's source, tests, `template/`, `assets/`, the corpus, the dependencies,
`tsconfig*.json`, `vitest.config.ts`, the workflow). Pull requests run the `mutation` job only; to
judge a pull request's survivors, run the workflow by hand on its branch. The summary lists every mutant both the unit tests and the judges miss.

## Upstream drift

polyman depends on two things it doesn't control: Polygon's API (documented in
`codeforces/polygon-misc`) and `testlib.h`. `upstream.mjs` compares their latest commits with the
ones pinned in `upstream.json` and fails, listing what changed, when either moved (the `upstream` job of
`.github/workflows/nightly.yml`). After checking polyman against the change, `node corpus/upstream.mjs --update` moves the pins.

## In CI

| Workflow                          | Jobs                                                                                       |
| --------------------------------- | ------------------------------------------------------------------------------------------ |
| `corpus.yml` (push, pull request) | `corpus`, `toolchain` (node-20.19, no-python-alias), `pch`, `truth`                        |
| `ci.yml`                          | `macos`: the corpus with Homebrew GNU g++, on the default branch and by hand               |
| `mutation.yml`                    | `mutation`, `survivors` (8 shards), `survivors-report`                                     |
| `nightly.yml`                     | `production` (the corpus on `polyman-cli@latest`), `upstream`, `polygon`                   |
| `release.yml` (`v*` tags)         | `publish` to npm `next`, `next-check` (no regression against `latest`), `promote`, Release |
