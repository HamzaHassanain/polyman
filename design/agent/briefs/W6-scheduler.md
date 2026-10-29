# W6: workflow scheduler, recipes and checkpoints

- Lane: D (Faraj). Tool: Claude Code (Opus). Branch: `hack/w6-scheduler`. Worktree: `../pm-w6`.
- Time: 3:20 to 4:50 PM.
- Module style: CommonJS like `src/agent/providers/`, relative imports without an extension.
- Read first: `design/agent/10-workflow-manager.md` (all), `design/agent/briefs/SPEC-FORMAT.md`, `src/agent/workflow/types.ts`, `src/agent/runner/types.ts`, `src/agent/tools/types.ts` (PermissionGate), `src/agent/core/events.ts`, `template/Config.json`, `template/Config.schema.json`, `src/types.d.ts` (`ConfigFile`, `SolutionTag`).

## Goal

The part of the workflow manager that is **our code, not the model**: check the plan, run tasks in dependency order with up to 4 in parallel, run the checkpoints, retry and escalate, apply config patches one at a time, and report everything as events.

## You own

- `src/agent/workflow/recipes.ts`
- `src/agent/workflow/checkpoints.ts`
- `src/agent/workflow/scheduler.ts`
- `src/agent/workflow/config-patch.ts`
- `src/agent/workflow/compile.ts`
- `src/agent/workflow/spec.ts`
- `tests/agent/workflow/recipes.test.ts`, `checkpoints.test.ts`, `scheduler.test.ts`, `config-patch.test.ts`

## Build

### `recipes.ts`

- `RECIPES`: for each recipe (`build_problem`, `fix_verify`, `strengthen_tests`), the allowed task kinds, the fixed tasks the plan must contain, and the dependency rules. For `build_problem` use the diagram and table in doc 10 "Recipe build_problem": `scaffold` first; `statement`, `main_solution`, `brute_force`, `validator`, `generators`, `wrong_solution`s after `scaffold`; `statement_critic` after `statement`; `checker` after `scaffold`; `generate_validate` after `validator` and `generators`; `verify` after everything else.
- `checkPlan(plan: Plan, spec: Spec): string[]` returns errors (empty = ok). Checks: recipe known; task ids unique; every `dependsOn` id exists; no cycles (say which ids); every kind allowed in the recipe; exactly one `main_solution`; every file in `ownsFiles` owned by at most one task; no-model kinds (`scaffold`, `checker`, `generate_validate`, `verify`) own no files; for `build_problem`, the number of `wrong_solution` tasks equals the number of wrong approaches from `parseSpec`, not counting the plain brute force `TL` line (see `SPEC-FORMAT.md`).
- `buildProblemSkeleton(spec: Spec): Plan`: a valid default plan from the spec alone (used when the manager fails twice, and in W10's test). Names: `solutions/main.cpp`, `solutions/brute.cpp`, `solutions/wa-<n>.cpp`, `validator/val.cpp`, `generators/gen-*.cpp`, `statements/english/*`.

### `config-patch.ts`

`async function applyConfigPatch(problemDir: string, patch: unknown): Promise<{ ok: true } | { ok: false; error: string }>`

- The patch is `ConfigPatch` from `workflow/types` (W0). Map it onto the real `Config.json` fields (see `template/Config.json`): solutions get `sourceType` from the extension (`.cpp` gives `cpp.g++17`, look at how `src/` picks source types), `generatorScript` and `manualTests` go into the named testset.
- Read `Config.json`, apply, check the result with a small validator against the required fields of `Config.schema.json` (do not add a dependency; check the fields the schema marks required and the tag enum), write it back with 2-space JSON. On error, write nothing.
- One global queue (reuse the pattern of a mutex) so patches never interleave.

### `spec.ts`

`parseSpec(text: Spec)` returns the sections, the wrong approaches with their verdicts, the samples, and the limits from `# Decisions`, following `design/agent/briefs/SPEC-FORMAT.md` exactly. `checkPlan`, the checkpoints and the checker choice all use it.

### `compile.ts`

- `compileCpp(file: string, problemDir: string, signal): Promise<{ ok: true; binary: string } | { ok: false; error: string }>`: `g++ -std=c++17 -O2 -I <problemDir> -o <tmp binary> <file>` with `execFile` (no shell), 60 s timeout.
- `runOnInput(binary, input, timeoutMs = 5000, signal)`: stdin = input, returns stdout or a timeout or crash message.
- `sameTokens(a, b)`: compare whitespace-separated tokens.
- All of it goes through one small FIFO queue in this file, so parallel workers never run many compiles at once.

### `checkpoints.ts`

`class CliCheckpoints implements Checkpoints`, constructor `(runner: CliRunner)`.

`check(task, spec, problemDir, signal)` per kind:

| Kind | Checkpoint |
| --- | --- |
| `statement` | the files in `ownsFiles` exist and none is empty |
| `statement_critic` | always ok (the worker's `review` result decides, see W7) |
| `main_solution`, `brute_force` | compile the file and run it on every sample from the spec (`# Samples`), compare tokens with the expected output. Digest on failure: compiler error (first 15 lines) or `sample <n>: expected <..> got <..>` |
| `wrong_solution` | the file compiles |
| `validator` | `test validator` exit 0 |
| `generators` | `generate --all` exit 0 |

`runNoModelTask(task, spec, problemDir, signal)`:

| Kind | Does |
| --- | --- |
| `scaffold` | handled by the `create_problem` tool before the workflow; here: check `Config.json` exists, set the limits from `parseSpec` through a config patch |
| `checker` | `Checker:` from `# Decisions` if set; else from the spec's `# Output` section: integers: `ncmp`; yes/no: `yesno`; else `wcmp`. Return a config patch. If the spec says "any valid answer" return a failed checkpoint `custom checker needed, not supported yet` |
| `generate_validate` | `generate --all` then `validate --all` |
| `verify` | `verify --json`, digest like W4's verify digest (make a small local digest from the `verify --json` report; W4 has the same idea, the merge can join them later) |

### `scheduler.ts`

`class WorkflowScheduler`, constructor `{ manager: Manager; worker: Worker; checkpoints: Checkpoints; permissions: PermissionGate; bus: EventBus; problemDir: string; limits?: typeof WORKFLOW_LIMITS }`.

`async run(spec: Spec, recipe: Plan['recipe'], signal: AbortSignal): Promise<{ ok: boolean; results: TaskResult[]; summary: string }>`

1. Plan: `manager.makePlan(spec, recipe, signal)`, then `checkPlan`. Errors: call `makePlan` once more with the errors added to the spec as `# Plan errors to fix`. Still errors: use `buildProblemSkeleton(spec)` (only for `build_problem`) and emit a notice in the summary.
2. Emit `plan_created`. `permissions.askPlan(plan, signal)`. Denied: return `{ ok: false, summary: 'plan not approved' }`.
3. Run the DAG: a task starts when all its `dependsOn` are `passed`. At most `limits.parallel` worker tasks at once. No-model tasks do not count against the limit.
4. One task:
   - Emit `task_started` with the attempt.
   - No-model kind: `checkpoints.runNoModelTask`.
   - Else: `worker.run({ task, spec, attempt, note, fresh })`, apply its `configPatch` (if any) with `applyConfigPatch`, then `checkpoints.check`.
   - Emit `task_checkpoint`. Passed: `task_done` with `status: 'passed'`.
   - Failed: attempt 1 to attempt 2 with `fresh: false` and `note = checkpoint.digest`. Attempt 2 to attempt 3 with `fresh: true` and a short note of both failures. After attempt 3: `manager.decide(...)`:
     - `retry_with_hint`: one more fresh attempt with the hint.
     - `redo_task`: reset that earlier task and everything that depends on it to pending, run it again with the hint (max once per workflow).
     - `ask_user`: mark `failed`, stop starting tasks that depend on it, add the question to the summary.
   - `verify` failing starts the fix loop: up to `limits.fixRounds` rounds of a `fix` task (kind `fix`, `ownsFiles` = files named in the digest, or all solution, generator and validator files if none are named) followed by `verify` again.
5. Tasks not blocked by a failure keep running.
6. Emit `workflow_done` with `ok`, a 3 to 6 line `summary`, and the total cost from `usage` events seen on the bus while running (subscribe at start, unsubscribe at the end).
7. Abort: stop starting tasks, wait for running ones to settle (they get the signal), emit `workflow_done` with `ok: false`.

## Tests (fake manager, fake worker, fake checkpoints, temp folder for config)

- `parseSpec` on the example in `SPEC-FORMAT.md`: 3 wrong approaches, 1 sample, limits.
- `compile.ts` (skip if `g++` is missing): a correct file passes the sample, a wrong one gives the expected/got digest, a syntax error gives the compiler error.
- `checkPlan`: each rule with a bad plan, and a good plan.
- `buildProblemSkeleton` passes `checkPlan` for a spec with 2 wrong approaches.
- `applyConfigPatch`: add a solution, bad tag refused and nothing written, two patches at once do not lose either.
- Scheduler: dependency order; never more than 4 workers at once (fake worker records concurrency); retry ladder (attempt 2 not fresh, attempt 3 fresh, then `decide`); `redo_task` reruns the dependents; `ask_user` stops only the dependent branch; plan errors trigger one re-plan then the skeleton; plan denied; fix loop stops after 3 rounds; abort.
- Events: the right sequence for a 3-task plan.

## Done when

`npm run build`, `npm run lint`, `npm test` pass. One commit: `agent: workflow scheduler, recipes and checkpoints`.

## If late (4:50)

Parallel limit 1 (the code can stay, set the default to 1). No `redo_task` (treat it as `retry_with_hint`). `strengthen_tests` and `fix_verify` recipes can be lists without extra checks.
