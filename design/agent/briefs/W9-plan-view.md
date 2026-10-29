# W9: plan view and plan approval

- Lane: B (Monir). Tool: Monir's choice (Antigravity, OpenCode, Copilot or Codex): give it this file and say "do exactly this task". Branch: `hack/w9-plan-view` from Monir's own `hack/w5-tui` (`git switch -c hack/w9-plan-view hack/w5-tui`), so it does not wait for any merge.
- Time: 4:50 to 5:45 PM. Push by 5:45, Hamza merges it at 5:45.
- Read first: `design/agent/10-workflow-manager.md` (Events and UI, Permissions), the sample screens 2, 3 and 4 in the run sheet, `src/agent/tui/store.ts` and `App.tsx` (from W5), `src/agent/workflow/types.ts`.

## Goal

Show the workflow like the Claude Code todo list, live, and let the user approve the plan.

## You own

- `src/agent/tui/components/PlanView.tsx`
- `src/agent/tui/components/PlanApproval.tsx`
- `tests/agent/tui/plan-view.test.tsx`
- small edits in `src/agent/tui/App.tsx` and `src/agent/tui/store.ts` to mount them (W5 is merged, so you own these edits now)

## Build

### `PlanApproval`

When `state.planApproval` is set: a bordered box (sample screen 2): recipe, problem, task count, the parallel limit, then one row per task: id, title with the tag colored (MA green, TO cyan, WA red, TL amber), the files it owns (shortened to fit). Then the warning in amber: `Workers write only the files above, and the CLI runs the code they write.` Options: `1. Run it`, `2. Cancel` (keys and arrows). Run gives `resolve(approvalId, { kind: 'allow_once' })`, Cancel gives `deny`. (Editing the plan is not in this version.)

### `PlanView`

When `state.workflow` is set, in the live area (sample screen 3):

- Header: `● Workflow: <recipe> (<problem>)` and on the right `$<cost> · <m:ss>` (timer from `plan_created`).
- One line per task: icon (`✔` green passed, `✗` red failed, spinner running, `◻` dim pending, `↻` amber retrying), title, then dim detail: `attempt <n> · <last checkpoint digest first line or last tool>`. Pending tasks with unfinished deps show `waits for <titles>`.
- When `workflow_done` arrives: move the final tree into the transcript (`finished`) as one item, with the summary lines under it.

### `store.ts` additions

`plan_created`, `plan_approval_needed`, `task_started`, `task_checkpoint`, `task_done`, `workflow_done` update `workflow` and `planApproval` (if W5 already did some of this, finish it).

## Tests

- Store: a scripted workflow (plan, 3 tasks, a failed checkpoint, a retry, done) gives the right task states.
- `PlanApproval` renders all task rows and key `1` resolves `allow_once`.
- `PlanView` shows the right icons and the `waits for` text.

## Done when

- Build, lint, test pass.
- Add a workflow script to W5's fake session (`dev/fake-session.ts`) and check it looks like the sample screens in a real terminal.
- Commit: `tui: workflow plan view and approval`, pushed.
