# Changelog

## Unreleased

- `run` and `verify` use only `test<N>.txt` files (N > 0), like `validate`, and sort them by N. A stray `test1.txt.bak`, `test_notes.txt` or `test0.txt` in a testset folder is not run any more (GitLab #117, !349).
- The docs say a `WA` tag passes on Wrong Answer or Presentation Error everywhere the tags are described (GitLab #121, !351).
- A solution tagged `RE` must crash on at least one test. Before, an `RE` solution that passed every test was reported as "Behaves as expected" (GitLab #123, !352).
- `remote pull` downloads the problem's resource files, like its own `testlib.h` or a shared header, next to `Config.json`. A failed download fails the pull with exit code 4. `download-testlib` does not replace a `testlib.h` that is different from the upstream one: it exits with code 2 and a hint, so a pulled `testlib.h` is kept (GitLab #120, !353).
- Solutions run with the problem's `inputFile` and `outputFile`. When one of them is a file name (not empty, `stdin` or `stdout`), each test runs in a new temp folder: the test is copied there as `inputFile`, and the output is read from `outputFile`. A value that is a path stops the run with exit code 2 (GitLab #122, !355).
- The standard checker example in GUIDE.md uses the plain name (`wcmp.cpp`), like `remote pull` writes it (GitLab !356).
- The npm `bugs` URL and the guide links point to GitHub (GitLab !347).
- `polyman chat` (preview): an AI agent in the terminal. It talks with you about a problem idea, writes the spec to `.polyman/agent/notes.md`, and builds, fixes or strengthens the problem with workflows (`prove_idea`, `build_problem`, `fix_verify`, `strengthen_tests`, plus `find_ideas` for ideas). Small workers write only their own files, and the polyman CLI checks every task. File writes and every Polygon change ask first, the agent works only inside the problem folder, and `--plain` gives a line mode for pipes. See [GUIDE.md](GUIDE.md#chat-ai-agent) (GitHub PR 119).
- The `polyman ai` commands (`login`, `logout`, `list`, `models`, `use`) now set up the keys and the default model for `polyman chat` (GitHub PR 119).
- The compile cache never stores or restores an empty binary. Two runs at the same time could leave a shared standard checker as an empty file, which accepts every answer. A restore now copies to a temp file and renames it.
- In the chat approval box and the plan box, `enter` right after an arrow key chooses the new option, not the old one (GitHub PR 119, PR 138).
- `remote package` waits the 30 minutes its message says. It polled every 30 seconds 30 times, so it gave up after 15 (GitHub PR 138).
- Bring your own key for any model: `polyman chat --provider <id> --model <id>`, a live OpenRouter model list (`polyman ai models openrouter --search <text>`), budgets that follow the model's context and output size, and chat-only mode for models without tool support (GitHub PR 140).

## 3.1.0

- polyman builds a precompiled `<bits/stdc++.h>` once per compiler and flags and reuses it for every C++ compile that starts with `#include <bits/stdc++.h>`. It lives in the user cache (`POLYMAN_CACHE_DIR` moves it), is not used with clang, Apple's `g++` or `--no-cache`, and a compile that fails with it is retried without it. Turn it off with `POLYMAN_PCH=0`. See [GUIDE.md](GUIDE.md) (GitLab #113, !282).
- `--json` for `generate`, `validate`, `test validator`, `test checker`, `test <solution>`, and for `remote pull`, `push`, `view`, `commit` and `package` (GitLab #69, !319; #70, !320; #72, !321).
- New `polyman ai` commands: `login <provider>` (hidden prompt or `--key-stdin`), `logout`, `list`, `models` and `use <provider/model>`. Keys are saved in `~/.polyman/ai.json` with mode 0600, and polyman warns when `~/.polyman` is readable by others (GitLab #81, !318).
- Provider support for the coming agent: an OpenAI-compatible provider, a native Anthropic provider, presets for the common providers, model capabilities with a chat-only fallback, and retries with rate limits and clear auth errors (GitLab #75, !306; #76, !309; #77, !314; #78, !313; #79, !316; #80, !317).
- C++ solutions are compiled with `-DONLINE_JUDGE`, like on Codeforces, unless `compiler.flags` already defines it. `test` and `verify` stop with an error when the main solution prints nothing on every test while another solution prints output (GitLab #114, !307).
- `remote pull` writes each file's `sourceType` into `Config.json`, so a pull then a push keeps the same compilers, and a C++ solution is built locally with the standard in its `sourceType` unless `cppStandard` or `compiler.flags` sets one (GitLab #109, !308).
- `Config.schema.json` lists the newer C++ source types (`cpp.msys2-mingw64-9-g++17`, `cpp.gcc13-64-winlibs-g++20`, `cpp.gcc14-64-msys2-g++23`), and the template docs explain `-DONLINE_JUDGE` and where the `-std=` value comes from (GitLab !310).
- `verify` warns, and lists it under `warnings` in the `--json` report, when the validator has no `INVALID` self-test (GitLab #111, !265).
- A checker self-test that expects `CRASHED` passes only on a crash exit code, and a checker killed by a signal counts as `CRASHED` on every platform (GitLab #116, !330).
- A PE-tagged solution fails `verify` when it gets no `PRESENTATION_ERROR`; a WA tag passes on WA or PE, as on Polygon (GitLab #60, !266; #112, !267).
- `remote push` reads every manual test before uploading and waits for every upload, so a missing file or a failed upload is reported instead of stopping the push halfway (GitLab #115, !305).
- `remote pull` warns when Polygon has no validator for the problem, and `verify` lists every source file from `Config.json` that is missing in one error before compiling (GitLab #108, !263).
- `remote pull` says which testsets it downloaded and how to get the others with `-t` (GitLab #110, !264).
- A Java solution's public class is renamed between its file name and `Main` on pull and push (GitLab #10, !261).
- Generator scripts: list iterations are joined like FreeMarker and two commands on one line are rejected, an empty generator name is reported with its line number, multi-output ranges and the total number of tests are limited, and scripts are parsed in linear time (GitLab #59, !262; #105, !251; #101, !240; #102, !247).
- The remaining `process.exit` calls are errors with exit codes: `2` for config and usage errors, `3` for missing credentials or Python, `4` for Polygon and network failures (GitLab #68, !311).
- `--help` and `-h` print help and exit without running the command, so `polyman new x --help` no longer creates `x/` (GitLab !339).

## 3.0.3

- Every command now ends with an exit code that says what kind of failure happened: `1` the problem is wrong, `2` usage error (bad `Config.json`, unknown name, missing input), `3` environment error (no Polygon credentials, no Python 3, old Node.js), `4` Polygon or network error, `130`/`143` on SIGINT/SIGTERM. The error message is printed once, at the end. See [GUIDE.md](GUIDE.md#exit-codes) (GitLab #68).
- polyman compiles solutions a few at a time (one per CPU), so a slow or small machine no longer fails a compile on the 10 s limit while it waits for a CPU (GitLab #88).
- A local C++ or Java compiler can be picked with `POLYMAN_CXX` / `POLYMAN_JAVAC` or the optional `compiler` block in `Config.json` (`cpp`, `javac`, `flags`). Local runs only, Polygon still uses each file's `sourceType`. The compile cache also rebuilds when the compiler or `compiler.flags` change (GitHub PR 24).

## 3.0.2

- polyman retries a Polygon call once after a network error, an HTTP 5xx or an HTML page, for reads and for uploads that replace an item; calls that could create a duplicate are never retried. A 5xx that carries Polygon's JSON `FAILED` answer is reported as that error, not retried (GitLab #86).
- `remote package` sends the `full` and `verify` flags the right way round: `full`, `linux` and `windows` build a full package, and every build is verified (GitLab #27).
- `remote push` keeps every path from `Config.json` inside the problem folder, including a generator's `scriptFile`, and checks manual tests and checker/validator test files before it clears or uploads anything (GitLab #62).
- Checker self-tests that expect `WRONG_ANSWER` or `PRESENTATION_ERROR` are judged by that expectation (GitLab #58).
- `new`, `download-testlib` and `list` take `--json` (GitLab #71).
- `remote push` exits with code 2 instead of waiting for a prompt when stdin is not a terminal; pass `--yes` (and `--name` if `Config.json` has no valid name) to create a new problem from a script (GitLab #73).
- Colors are off when `NO_COLOR` is set to a non-empty value, when stdout is not a terminal, or when `POLYMAN_AGENT=1`. This also overrides `FORCE_COLOR` (GitLab #73).
- Generator, validator and checker failures end with an error and an exit code instead of `process.exit` (GitLab #67).
- The Node version check accepts a `v`-prefixed version and Node majors above 22.
- `run`, `test` and `verify` can scale the time limit per language with the optional `timeLimitMultipliers` in `Config.json`, for example `{ "java": 2, "python": 3 }`. Local runs only, Polygon still gets the plain `timeLimit`. A bad value stops before anything runs. From GitHub PR 98 by ElectLive (GitLab #5, #11).
