# W3: tool infrastructure

- Lane: A (Hamza). Tool: Claude Code (Opus). Branch: `hack/w3-tools`. Worktree: `../pm-w3`.
- Time: 3:20 to 4:50 PM.
- Module style: CommonJS like `src/agent/providers/`, relative imports without an extension.
- Read first: `design/agent/04-harness.md` (Tools, PermissionGate, Sandbox), `design/agent/10-workflow-manager.md` (Permissions), `src/agent/tools/types.ts`, `src/agent/core/events.ts`, `src/agent/workflow/types.ts`.

## Goal

The safety layer every tool call goes through: find the tool, check its arguments, check the folder, ask the user when needed, run it with a timeout, and keep the result short.

## You own

- `src/agent/tools/schema.ts`
- `src/agent/tools/registry.ts`
- `src/agent/tools/sandbox.ts`
- `src/agent/tools/permissions.ts`
- `tests/agent/tools/registry.test.ts`, `schema.test.ts`, `sandbox.test.ts`, `permissions.test.ts`

## Build

### `schema.ts`

`function validate(schema: JSONSchema, value: unknown, path = 'args'): string[]` returns a list of errors (empty = ok). Support only what our tools use: `type` (`object`, `string`, `number`, `integer`, `boolean`, `array`), `properties`, `required`, `additionalProperties: false`, `enum`, `items`, `minLength`, `minimum`, `maximum`. Error text is for the model, so make it exact: `args.path: expected string, got number`, `args: missing required property "content"`, `args.tag: must be one of MA, OK, WA, TL, TO`.

### `registry.ts`

`class DefaultToolRegistry implements ToolRegistry`, constructor `{ permissions: PermissionGate; capBytes?: number /* 8192 */; defaultTimeoutMs?: number /* 120000 */ }`.

`run(call, ctx)` follows doc 04 exactly:

1. Unknown tool: `isError` result `Unknown tool "<name>". Tools you can use: <names>`.
2. `call.argsError` is set (the existing provider sets it when the tool JSON could not be repaired): `isError` result `Your arguments were not valid JSON: <error>. Call <name> again with a JSON object.`
3. Schema errors: `isError` result with all errors, one per line.
4. `tool.needsProblem` and `ctx.problemDir === null`: `isError` result `There is no problem folder yet. Call create_problem first.`
5. `permissions.check(tool, args, ctx.signal)`. Denied: result `The user denied this: <reason>` (not an error, the model must read it).
6. Run with the tool's `timeoutMs` or the default. Timeout: `isError` result `<name> timed out after <s>s`. Abort: rethrow the abort so the session ends the turn. Any other throw: `isError` result with the message (a `SandboxError` message as is).
7. Cap `content` at `capBytes` (UTF-8 safe): keep the first 2 KB and the last part, with `\n[... <n> bytes cut ...]\n` in the middle. `data` is kept whole.

`riskOf(name)` (part of the contract) returns the tool's risk, for the session's `tool_call` event.

### `sandbox.ts`

`class FolderSandbox implements Sandbox`, constructor `(root: string, opts?: { allowWrite?: string[] /* task ownsFiles, relative globs */ })`.

`resolve(userPath, mode)`:

- Join with `root` if relative. Resolve the real path with `fs.realpath`. For a file that does not exist yet, realpath the nearest existing parent and add the rest.
- Inside means: equal to the real root, or starts with real root + `path.sep`. (`/x/pairs-evil` is not inside `/x/pairs`.) Symlinks that point outside are outside.
- Outside: throw `SandboxError('<userPath> is outside the problem folder')`.
- Writes are refused (with a clear message) under `.polyman/cache/`, `.polyman/agent/sessions/`, and to any `testlib.h`.
- With `allowWrite`: a write must match one of the patterns (support `*` within a segment and `/**` at the end). Else `SandboxError('<path> is not one of the files this task owns: <list>')`.
- Returns the real absolute path.

### `permissions.ts`

`class DefaultPermissionGate implements PermissionGate`, constructor `(bus: EventBus, mode: PermissionMode = 'ask')`.

`check(tool, args, signal)`:

| Risk | `ask` | `auto-edit` | `plan-approved` |
| --- | --- | --- | --- |
| `read`, `run` | allow | allow | allow |
| `write` | session rule for this tool name? allow : ask | allow | allow (the sandbox limits the files) |
| `remote` | ask | ask | ask |

Asking: make an `approvalId`, emit `approval_needed` with `title` and `command` from `tool.describe?.(args)` (fallback: tool name + short args), then wait on a promise that `resolve(approvalId, decision)` settles. `allow_session` adds a session rule for the tool name. `deny` returns `{ allowed: false, reason: decision.reason ?? 'no reason given' }`. An abort while waiting rejects with the abort error. Emit `approval_resolved` when settled.

`askPlan(plan, signal)`: emit `plan_approval_needed` and wait the same way. On `allow_once` or `allow_session`, switch to `plan-approved` until `setMode` is called again.

`setMode(m)`: only sets the mode. The TUI shows the `auto-edit` warning, not the gate.

## Tests (Vitest)

- schema: each keyword, nested paths in messages, `additionalProperties: false`.
- registry: each of the 7 steps above with fake tools and a fake gate. Cap: a 50 KB result is cut with the marker, UTF-8 not broken.
- sandbox (real temp folders): inside, outside with `..`, the `pairs` / `pairs-evil` case, a symlink pointing out, a new file in a new subfolder, `.polyman/cache` write refused, `testlib.h` write refused, `allowWrite` allow and refuse.
- permissions: the table above, session rule, deny reason, abort while waiting, `askPlan` switches the mode, events emitted.

## Done when

`npm run build`, `npm run lint`, `npm test` pass. One commit: `agent: tool registry, schema check, sandbox and permissions`.

## If late (4:50)

Drop `minLength`, `minimum`, `maximum` from the schema. Keep everything in the sandbox.
