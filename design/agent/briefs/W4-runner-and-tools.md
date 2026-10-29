# W4: CLI runner, file tools and CLI tools

- Lane: A (Hamza). Tool: Claude Code (Opus). Branch: `hack/w4-runner`. Worktree: `../pm-w4`.
- Time: 3:20 to 4:50 PM.
- Read first: `design/agent/04-harness.md` (CliRunner, Tools, first tool list, Sandbox), `design/agent/02-cli-contract.md`, `src/agent/runner/types.ts`, `src/agent/tools/types.ts`, `src/report.ts` (the `--json` report shapes), `src/errors.ts` (exit codes), `src/terminal.ts` (`POLYMAN_AGENT`), `src/cli.ts` (real flags).
- Module style: CommonJS like `src/agent/providers/`, relative imports without an extension.

## Goal

Run the polyman CLI safely as a child process, and give the model the tools that touch files and run commands.

## You own

- `src/agent/runner/lock.ts`
- `src/agent/runner/kill-tree.ts`
- `src/agent/runner/cli-runner.ts`
- `src/agent/tools/fs-tools.ts`
- `src/agent/tools/cli-tools.ts`
- `tests/agent/runner/**`, `tests/agent/tools/fs-tools.test.ts`, `tests/agent/tools/cli-tools.test.ts`, `tests/agent/fixtures/fake-cli.mjs`

## Build

### `lock.ts`

`class Mutex { run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> }`. FIFO. A waiter whose signal aborts leaves the queue and rejects. One shared instance `cliLock` is exported: all CLI runs in the process go through it, so parallel workflow workers never run two compiles at once.

### `kill-tree.ts`

`async function killTree(pid: number, graceMs = 3000): Promise<void>`

- POSIX: `process.kill(-pid, 'SIGTERM')` (the child is a group leader), wait up to `graceMs` for exit, then `process.kill(-pid, 'SIGKILL')`. Ignore `ESRCH`.
- Windows: `taskkill /PID <pid> /T /F` with `execFile` (no shell). Not tested today, write it and leave a comment.

### `cli-runner.ts`

`class NodeCliRunner implements CliRunner`, constructor `{ cliPath?: string; logDir?: (cwd: string) => string }`.

- `cliPath` default: `dist/cli.js` resolved from this file (`path.join(__dirname, '..', '..', 'cli.js')`, this is CommonJS), so the agent runs the same polyman version it ships with.
- `run(args, opts)`, inside `cliLock.run(...)`:
  - `spawn(process.execPath, [cliPath, ...args], { cwd: opts.cwd, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0', POLYMAN_AGENT: '1' } })`. Never a shell, never a command string.
  - Split stderr and stdout into lines. Each stderr line and each stdout line when not `--json` goes to `opts.onLine`.
  - Keep the full output in memory up to 2 MB, write it to `<cwd>/.polyman/agent/logs/<time>-<args[0]>.log`.
  - Timeout (`opts.timeoutMs`): `killTree`, `reason: 'timeout'`. Abort: `killTree`, `reason: 'cancelled'`.
  - `json`: when `args` includes `--json`, `JSON.parse(stdout)`, else undefined (parse errors leave it undefined).
  - `stdoutTail` and `stderrTail`: first 4 KB + last 12 KB with a cut marker when longer. Strip ANSI codes.

### `fs-tools.ts`

Export `fsTools(): Tool[]` with:

| Tool | Risk | Args | Does |
| --- | --- | --- | --- |
| `list_files` | read | `{ path?: string }` | names under the folder, 2 levels deep, skips `node_modules`, `.git`, `.polyman/cache`, `testsets` contents (show count only) |
| `read_file` | read | `{ path: string; offset?: integer; limit?: integer }` | text with line numbers, max 2000 lines, says when cut. Files under `tests/` or `testsets/` longer than 60 lines show the first 30 and last 10 |
| `write_file` | write | `{ path: string; content: string }` | creates parent folders, writes, returns `wrote <path> (<n> lines)` |
| `edit_file` | write | `{ path: string; old_text: string; new_text: string }` | exact replace; `old_text` must appear exactly once, else an error saying "not found" or "found <n> times, add more context" |

All paths go through `ctx.sandbox.resolve`. `describe()` returns `{ title: 'Write <path>' }` etc. for approvals. Parameters are JSON schemas with `additionalProperties: false`.

### `cli-tools.ts`

Export `cliTools(): Tool[]`. Every tool runs `ctx.runner.run([...], { cwd: ctx.problemDir, timeoutMs, signal: ctx.signal, onLine: ctx.progress })` and returns a **short digest** in `content` (the model reads this) and the full `RunResult` in `data`.

| Tool | Risk | Args | CLI | Timeout |
| --- | --- | --- | --- | --- |
| `create_problem` | write | `{ name: string }` (folder name, `[a-z0-9-]+`) | `new <name>` in the parent folder, then `download-testlib` in the new folder; then `ctx.setProblemDir(...)` | 60 s |
| `generate` | run | `{ testset?: string }` | `generate --all --json` or `generate -t <testset> --json` | 300 s |
| `validate` | run | `{ testset?: string }` | `validate --all --json` or `-t <testset> --json` | 300 s |
| `run_solution` | run | `{ name: string; testset?: string }` | `run <name> --all --json` or `-t` | 300 s |
| `test_target` | run | `{ what: string }` (`validator`, `checker` or a solution name) | `test <what> --json` | 300 s |
| `verify` | run | `{}` | `verify --json` | 600 s |

`create_problem` has `needsProblem: false`, all others `true`. For `create_problem`, the parent folder is `ctx.problemDir ?? process.cwd()`; check the name before running.

Digest rules:

Every command above supports `--json` on `master` (v3.1.0), so digests come from the JSON report, with the exit code from `src/errors.ts`:

| Exit | Meaning | Tool result |
| --- | --- | --- |
| 0 | ok | normal result |
| 1 | the problem is wrong (a test, a verdict) | normal result: the model reads it and fixes the problem |
| 2 | bad arguments, unknown name, invalid `Config.json` | `isError`, with the error message and its hint |
| 3 | missing tool (`g++`, `java`) | `isError`: `<tool> is missing on this machine. Tell the user.` |
| 4 | Polygon or network | `isError` |
| 130, 143 | cancelled, killed | one line |

- No JSON on stdout (should not happen): `<tool> OK` or `<tool> FAILED (exit <code>)` + the last 20 non-empty stderr lines + `Full log: <logPath>`.
- `generate`, `validate`, `test`: one summary line (counts), then each failing item (max 15), then `Full log: <logPath>`.
- `verify` and `run`: read the report types from `src/report.ts`. Write: passed or `FAILED at "<step>"`, then one line per solution (`name (TAG): verdict summary, max time`), then the first failing detail, then `Full log: <logPath>`. Max 40 lines.
- Timeout or cancel: say so in one line.

## Tests

- `tests/agent/fixtures/fake-cli.mjs`: a tiny script that, by its args, prints lines, sleeps, exits with a code, prints JSON, or spawns a child that sleeps (to test kill-tree).
- Runner (with `cliPath` = fake CLI): output and exit code; `--json` parsed; tails cut; timeout kills the child **and its child** (check the grandchild pid is gone); abort works; two `run` calls at once run one after the other (lock).
- Mutex: FIFO, abort while waiting.
- fs-tools on a temp folder with a real `FolderSandbox` if W3 is merged, else a tiny fake sandbox: list, read with offset, long test file cut, write creates folders, edit once / not found / found twice.
- cli-tools with a fake runner: each tool builds the right args, each digest rule, `create_problem` name check and `setProblemDir` call.
- One real smoke test (skip with `it.skipIf(!fs.existsSync('dist/cli.js'))`): `create_problem` + `generate` on a temp folder with the real CLI.

## Done when

`npm run build`, `npm run lint`, `npm test` pass. One commit: `agent: cli runner, file tools and cli tools`.

## If late (4:50)

Drop the Windows kill path (leave a TODO) and the special `generate`/`validate`/`test` digests (use the generic one). Keep the lock and the POSIX kill.
