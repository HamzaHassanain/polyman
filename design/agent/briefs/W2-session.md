# W2: agent session (the loop)

- Lane: A (Hamza). Tool: Claude Code (Opus). Branch: `hack/w2-session`. Worktree: `../pm-w2`.
- Time: 3:20 to 4:50 PM.
- Read first: `design/agent/04-harness.md` (AgentSession, Events, ContextManager), `src/agent/core/session-types.ts`, `src/agent/core/events.ts`, `src/agent/core/messages.ts`, `src/agent/tools/types.ts`, `src/agent/providers/types.ts`, `src/agent/providers/mock.ts` (existing: `MockStep` has `text`, `reasoning`, `toolCall`, `toolCalls`, `usage`, `error`).
- Module style: CommonJS like `src/agent/providers/`, relative imports without an extension.

## Goal

`AgentSession`: one turn = model call, tools, model call, ... until the model stops, the step limit, a cancel or an error. Every output is an event on the bus. The same class runs the chat and every workflow worker (with different deps).

## You own

- `src/agent/core/event-bus.ts`
- `src/agent/core/session.ts`
- `src/agent/core/context.ts`
- `src/agent/core/text-tool-call.ts`
- `tests/agent/core/**`

## Build

### `event-bus.ts`

`class SimpleEventBus implements EventBus`: `emit` adds a growing `seq` (from 1) and calls every listener in order. A listener that throws must not stop the others (catch, `console.error`). `on` returns an unsubscribe function.

### `session.ts`

`class AgentSession implements AgentSessionApi`, constructor `(deps: AgentSessionDeps)`.

`send(text)`:

1. If a turn is running, throw `Error('a turn is already running')`.
2. Make a new `AbortController` for this turn. Emit `turn_start` with a new `turnId`.
3. Append the user message.
4. Loop `step` from 0 to `deps.maxSteps - 1`:
   1. Build the request: `system = await deps.buildSystemPrompt()`, `messages = trimContext(...)` (see context.ts), `tools = deps.tools.specs()`, `model`, `maxOutputTokens`, `temperature`.
   2. Stream from `deps.provider`. Forward `text_delta`, `reasoning_delta`, `usage` to the bus. Collect text, reasoning and tool calls into one assistant message, append it when the step ends.
   3. No tool calls: if the text has a tool call written as text (`findTextToolCall`, below), append a user message `Use the tool call format to call <name>, do not write it as text.` and continue. Else end the turn with `done`.
   4. For each tool call, in order, one at a time (pass the provider's `argsError` into the `ToolCall`, the registry handles it):
      - Repeat guard: keep a map `name + JSON.stringify(args)` to `{ count, lastContent }` for this turn. On the 3rd identical call, do not run it. The result is `You already called <name> with these arguments 2 times. The result was: <lastContent>. Try something else or ask the user.` (`isError: true`).
      - Else emit `tool_call` (with `risk` from `deps.tools.riskOf(name)`, else `'read'`), run `deps.tools.run(call, deps.makeToolContext(signal))`, emit `tool_result` with a one-line `summary` (first line of `content`, max 120 chars).
      - Append a `tool` message with the `tool_result` part.
5. After the loop: end with `max_steps`, and append an assistant note `Stopped after <n> steps. Say "continue" to go on.`
6. `ProviderError` or any other throw: emit `turn_end` with `error` and the message passed through the existing `redact(message, deps.secrets())` from `../providers/retry`, return `'error'`. The session stays usable.
7. Always emit `turn_end` exactly once per turn with the reason.

`cancel()`: abort the current turn's controller. The running provider stream and tool must stop (they get the signal). The turn ends with `cancelled`. Messages from the aborted step are not appended.

`resolveApproval(id, decision)`: `deps.permissions.resolve(id, decision)`.

`messages`: a read-only view of the history.

### `text-tool-call.ts`

`function findTextToolCall(text: string, toolNames: string[]): string | null`: returns the tool name when the text contains a JSON object with `"name": "<known tool>"`, or a line like `verify({...})` with a known tool name. Gemma sometimes writes the call as text instead of using the tool call format.

### `context.ts`

`function trimContext(messages: Message[], budgetTokens: number, system: string): Message[]`

- Estimate tokens as `Math.ceil(chars / 4)` over system + all parts.
- Under budget: return as is.
- Over: walking from the oldest, replace `tool_result` content with `[old result removed: <first line, max 100 chars>]`, never touching the last 4 user turns (a user turn = a user message and everything after it until the next user message). Stop as soon as it fits.
- Still over: drop whole oldest turns (except the last 4) and put one user message first: `[earlier conversation removed to fit the context]`.
- Never split an assistant `tool_call` from its `tool_result` (the provider rejects that).

## Tests (Vitest, `tests/agent/core/`, all with `MockProvider` and a fake `ToolRegistry`)

- Plain text turn: events in order `turn_start`, `text_delta`s, `usage`, `turn_end(done)`, seq numbers grow.
- Tool turn: tool call, result appended, second model call sees the `tool` message, then done.
- Two tool calls in one step run in order, not in parallel (the fake tool records start and end times).
- Step limit: a script that always calls a tool ends with `max_steps` after exactly `maxSteps` model calls.
- Repeat guard: the 3rd identical call is not run and gets the "already called" result.
- Tool call written as text gets the correction message and one more step.
- Cancel during a slow tool: the tool sees the abort, turn ends `cancelled`, a new `send` works after.
- Provider error: `turn_end(error)`, the key is redacted from the message.
- `send` while running throws.
- `trimContext`: under budget unchanged; old tool results shortened first; last 4 turns kept; tool call and result pairs never split.

## Done when

`npm run build`, `npm run lint`, `npm test` pass. One commit: `agent: session loop, event bus and context trim`.

## If late (4:50)

`trimContext` returns the messages unchanged (keep the function and one test). Keep everything else.
