# W12: safety tests (break the sandbox on purpose)

- Lane: C (Mazen). Tool: Claude Code (Opus). Branch: `hack/w12-safety` from `feat/agent-hackday` after the 4:50 merge (it needs W3 and W4).
- Time: 5:10 to 5:45 PM. Push by 5:45, Hamza merges it at 5:45.
- Read first: `design/agent/04-harness.md` (Tools, PermissionGate, Sandbox), `design/agent/briefs/W3-tool-infra.md`, `design/agent/briefs/W4-runner-and-tools.md`, and the merged code in `src/agent/tools/` and `src/agent/runner/`.

## Goal

The agent writes files and runs programs on the user's machine. Think like an attacker (or like a confused model) and try to make it do something it must not. Every attempt becomes a test. This is our proof that the harness is safe, and it goes in the PR.

## You own

- `tests/agent/safety/**` only. You do **not** fix code in `src/`: that belongs to Hamza.

## Build

Black-box tests against the real classes: `FolderSandbox`, `DefaultToolRegistry`, `DefaultPermissionGate`, the file tools and the CLI tools, on real temp folders.

1. **Path escapes** (read and write): `../x`, `../../etc/passwd`, an absolute path, the sibling folder (`/tmp/pairs` vs `/tmp/pairs-evil`), a symlink inside the folder that points outside, `subdir/../../x`, a path with a NUL byte, and on Windows-style input `..\\x`. All refused with a clear error, nothing written.
2. **Protected files**: writing `testlib.h` and anything under `.polyman/cache` is refused. A workflow worker sandbox (`allowWrite` set to its own files) cannot write another task's file or `Config.json`.
3. **Permissions**: in `ask` mode a write waits for approval; `deny` stops it and the model gets the reason; cancel (abort signal) while waiting stops it; `allow_session` is remembered only for that tool; `plan-approved` mode still respects the sandbox.
4. **Bad tool calls**: unknown tool name, wrong argument types, missing required args, `argsError` from the provider: an error result, the tool does not run.
5. **Output and time**: a tool result over 8 KB is cut and says so; a CLI run over its timeout is killed (use `tests/agent/fixtures/fake-cli.mjs` from W4 to spawn a child that sleeps, and check the child is gone too).
6. **No shell**: the registry has no tool that runs an arbitrary command. Check the list of tool names against the allowed list from W4.
7. **Secrets**: an error message that contains an `sk-or-v1-...` key comes out redacted (use the existing `redact` from `src/agent/providers/`).

## If you find a real hole

Do not fix it. Write the test anyway, mark it `it.skip` with a comment `// BUG: <one line>`, so the suite stays green, and send Hamza one message with the list.

## Done when

- `npm run build`, `npm run lint`, `npm test` pass.
- At least 25 tests across the 7 groups.
- The bug list (or "no bugs found") is sent to Hamza.
- One commit: `agent: safety tests for sandbox, permissions and tools`. Pushed.
