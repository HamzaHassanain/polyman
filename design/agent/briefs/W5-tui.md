# W5: terminal UI (Ink)

- Lane: B (Monir). Tool: Monir's choice (Antigravity, OpenCode, Copilot or Codex): give it this file and say "do exactly this task". Monir owns only `src/agent/tui/**` and never waits for Hamza's code: build against the contracts and the fake session below. Branch: `hack/w5-tui` in Monir's own clone.
- Time: 3:20 to 4:50 PM. Push the branch when done: `git push -u origin hack/w5-tui`.
- Module style: `src/agent/tui/` is the only **ESM** folder (W0 adds its `package.json`). Relative imports there end in `.js`. Import the CommonJS agent modules by their path with `.js` too (`import type { SeqEvent } from '../core/events.js'`); Node gives named exports for TypeScript's CommonJS output.
- Read first: `design/agent/05-chat-ui.md` (all), the six sample screens in the run sheet artifact (Hamza shares the link, also described below), `src/agent/core/events.ts`, `src/agent/core/session-types.ts`, `src/agent/workflow/types.ts`.

## Goal

The terminal chat UI, built with Ink and React, that looks like Claude Code: finished messages printed once into the normal scrollback, only the bottom part redrawn. It works against a **fake session** first, so it does not wait for the real agent.

## You own

- `src/agent/tui/**` (except `components/PlanView.tsx` and `components/PlanApproval.tsx`, which are W9)
- `tests/agent/tui/**`

## Build

### `store.ts` (no Ink here, pure and tested)

`type UiState` and `function reduce(state: UiState, e: SeqEvent): UiState`.

- `UiState` has: `finished: Item[]` (printed once), `live: { streamingText: string; reasoning: string; runningTools: ToolView[] }`, `approval: ApprovalView | null`, `planApproval: { approvalId; plan } | null`, `workflow: { plan: Plan; tasks: Record<taskId, TaskView> } | null`, `status: { problem: string | null; model: string; mode: PermissionMode; tokens: number; costUsd: number; busy: boolean }`.
- `Item` = `{ kind: 'user' | 'assistant' | 'tool' | 'notice'; ... }`.
- Rules: `text_delta` adds to `streamingText`. `tool_call` moves the streamed text into `finished` as an assistant item and adds a running tool. `tool_progress` sets the tool's last line. `tool_result` moves the tool into `finished` with ok or error and its summary. `turn_end` flushes the streamed text, sets `busy: false`, and adds a notice for `cancelled`, `max_steps` or `error`. `usage` adds tokens and cost. `approval_needed` sets `approval`, `approval_resolved` clears it. Workflow events update `workflow` (W9 draws it).
- The user's own message is added with a local action `{ type: 'user_message', text }`.

### Components (`src/agent/tui/components/`)

| Component | Shows |
| --- | --- |
| `Header` | ` polyman chat · <problem or "new problem"> · <model short name> (OpenRouter) · /help for commands` |
| `Transcript` | Ink `<Static>` over `finished`: user lines start with `> ` in bold, assistant text starts with a blue `●`, tool items are `● name(short args)` and `  ⎿ summary` (dim, red when error) |
| `Markdown` | small renderer with the `marked` lexer: headings bold, lists, inline code and code blocks in a different color, no syntax highlighting |
| `LiveArea` | the streaming assistant text, running tools with a spinner and their last progress line |
| `ApprovalPrompt` | a bordered box: title, the command or a short diff preview, options `1. Yes`, `2. Yes, and do not ask again for <tool> in this session`, `3. No, and tell the agent what to do differently`. Arrow keys and number keys. Option 3 opens a one-line input for the reason |
| `Composer` | the input between two horizontal lines. `enter` sends, `ctrl+j` or `\` + `enter` new line, `up` / `down` history when empty, paste works |
| `StatusLine` | ` <problem> · <model> · <mode> mode (shift+tab) · <tokens>k tok · $<cost> · esc to interrupt` |

Look: match the six sample screens (Think step, plan approval, workers running, retry detail, verify and fix, done). Colors: blue for the agent and the approval box, green ok, red errors and WA, amber warnings and TL, dim grey for secondary text. `NO_COLOR` turns colors off.

### `App.tsx` and keys (`keybindings.ts`)

`App` takes `{ session: AgentSessionApi; bus: EventBus; info: { problem: string | null; model: string } }`, subscribes to the bus once (`useEffect`), keeps `UiState` with `useReducer`.

| Key | Action |
| --- | --- |
| `enter` | `session.send(text)` (not while busy: show "wait for the turn to end or press esc") |
| `esc` | `session.cancel()` while busy |
| `ctrl+c` | clear the input; twice within 1 s exits (`useApp().exit()`) |
| `shift+tab` | switch `ask` / `auto-edit`. Going to `auto-edit` adds a notice: `auto-edit: the agent can now write files and run the code it writes without asking.` |
| `/help` | typed command: prints keys and commands as a notice |

### `index.tsx`

`export async function startTui(session, bus, info): Promise<void>`: `render(<App .../>)`, resolve when the app exits, print `Bye.` after.

### Fake session for development (`src/agent/tui/dev/fake-session.ts` + `dev/run.tsx`)

A class implementing `AgentSessionApi` that, on `send`, replays scripted events with small delays: the Think step answer, `update_notes` tool, an approval for `write_file` with a diff preview, a `verify` tool with progress lines and a failed then passed result, usage events. `node dist/agent/tui/dev/run.js` starts the TUI with it, so you can see and try the UI before anything else exists.

## Tests (`tests/agent/tui/`, `.test.ts` for the store, `.test.tsx` for components)

- `store`: one test per rule above, plus a full scripted turn ending in the right `finished` list.
- With `ink-testing-library`: `ToolBlock` ok and error, `ApprovalPrompt` shows the 3 options and number key 1 calls `resolveApproval` with `allow_once`, `StatusLine` text, `App` with the fake session: typing and `enter` shows the user line and then the assistant text.

## Done when

- `npm run build`, `npm run lint`, `npm test` pass.
- `node dist/agent/tui/dev/run.js` runs in a real terminal, and Monir tried every key in the table.
- One commit: `tui: chat ui with ink`, pushed to `origin hack/w5-tui`.

## If late (4:50)

Plain text instead of `Markdown`. No history in the composer. Keep approvals, esc and the status line.
