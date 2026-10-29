# W10: end-to-end test with the mock provider

- Lane: D (Faraj). Tool: Claude Code (Opus). Branch: `hack/w10-e2e` from `feat/agent-hackday` after the 5:10 merge. It needs `createChatRuntime` from W0b: until W0b is pushed, build the runtime in the test from the merged parts, then switch to `createChatRuntime`.
- Time: 5:10 to 5:45 PM. Push by 5:45, Hamza merges it at 5:45.
- Read first: `design/agent/briefs/SPEC-FORMAT.md`, `design/agent/briefs/T1-test-problems.md`, `src/agent/index.ts` (`createChatRuntime`), `src/agent/workflow/**`, `src/agent/providers/mock.ts`.

## Goal

Prove the whole stack works without spending money: a scripted "Gemma" builds a real problem in a temp folder, and the real `polyman verify` passes.

## You own

- `tests/agent/e2e/build-problem.test.ts`
- `tests/agent/e2e/fixtures/**`

## Build

1. Fixture: the `pairs-sum` problem from T1 (if T1 is not pushed yet, write it yourself from the example in `SPEC-FORMAT.md`): the spec, and the final files (`main.cpp`, `brute.cpp`, `wa-overflow.cpp`, `val.cpp`, a generator, a statement).
2. A `MockProvider` script per role. The manager's script answers `submit_plan` with the plan from `buildProblemSkeleton(spec)`. Each worker's script writes its fixture file with `write_file`, then calls `finish_task` with the right config patch. Use one `MockProvider` per role, picked by the system prompt (a small router provider that looks at `req.system`).
3. The test: temp folder, `create_problem` through the real CLI (`dist/cli.js`), write the spec to notes, run `start_workflow({ recipe: 'build_problem' })` through the registry with an auto-approving gate. Expect `workflow_done` with `ok: true`, and run `node dist/cli.js verify --json` yourself at the end: it passes.
4. A second test: the validator worker writes a broken validator first (`readInt(0, ...)`), the checkpoint fails, attempt 2 writes the fixed one. Expect the retry events.

Skip the file with `describe.skipIf(!hasGpp || !fs.existsSync('dist/cli.js'))`. Give it a 5-minute timeout.

## Done when

Build, lint, test pass (the e2e runs locally, where `g++` exists). Commit: `agent: end-to-end workflow test with the mock provider`.
