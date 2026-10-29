# W1: Gemma on OpenRouter (small changes to the existing provider layer)

- Lane: A (Hamza). Tool: Claude Code (Opus). Branch: `hack/w1-gemma`. Worktree: `../pm-w1`.
- Time: 3:20 to about 4:00 PM. It is small; do not grow it.
- Read first: `design/agent/03-providers.md` (all), and the existing code: `src/agent/providers/presets.ts`, `openai-compatible.ts` (`Quirks`, `requestBody`, `errorFromResponse`, `TurnState`), `types.ts`, `key-store.ts`, `capabilities.ts`, their tests under `tests/agent/providers/`, and the fixtures `tests/fixtures/agent/openai/gemma-openrouter-*.http` (from W0).

## Goal

Make `google/gemma-4-31b-it` on OpenRouter a first-class, tested model on the **existing** `OpenAICompatibleProvider`. No new provider class. No changes to other presets.

## You own

- `src/agent/providers/presets.ts` (only the `openrouter` entry)
- `src/agent/providers/openai-compatible.ts` (only the small changes below)
- `src/agent/providers/gemma.ts` (new)
- `tests/agent/providers/gemma.test.ts` (new), and new cases in `tests/agent/providers/openai-compatible.test.ts` and `presets.test.ts`

## Build

1. **Preset** (`openrouter` entry in `presets.ts`):
   - `models`: keep `openrouter/auto`, add `google/gemma-4-31b-it`, `google/gemma-4-26b-a4b-it`, `google/gemma-4-31b-it:free`, `google/gemma-4-26b-a4b-it:free`, with `supportsTools: true` and whatever fields the existing entries use for context window and prices (context 262144; prices per 1M: 31b $0.20 in / $0.40 out, 26b $0.07 / $0.23, free $0).
   - `headers` (or the field the presets use for extra headers; if there is none, add an optional `headers` field to the preset type and pass it to the provider where presets build providers): `HTTP-Referer: https://github.com/HamzaHassanain/polyman`, `X-Title: polyman`.
   - `quirks.extraBody` (see 2): `{ usage: { include: true } }`, and `provider: { require_parameters: true }` only when the request has tools.
2. **`Quirks.extraBody`** in `openai-compatible.ts`: a new optional quirk `extraBody?: (req: ChatRequest) => Record<string, unknown>`, merged into the body in `requestBody` after the standard fields. Default: none. Keep `DEFAULT_QUIRKS` behavior for every other preset exactly the same.
3. **Cost**: where `TurnState` turns `chunk.usage` into the `usage` event, also read `usage.cost` (a number, USD) into `costUsd` when present.
4. **402**: in `errorFromResponse`, status 402 gives a `ProviderError` with kind `bad_request`, `retryable: false`, and the message `OpenRouter says there are no credits left. Add credits at https://openrouter.ai/settings/credits` (plus the server message, redacted like the other errors).
5. **`gemma.ts`** (new):
   - `GEMMA_DEFAULT_MODEL = 'google/gemma-4-31b-it'`.
   - `GEMMA_BUDGETS = { chatMaxSteps: 20, contextBudgetTokens: 32000, toolResultCapBytes: 8192, maxOutputTokens: 8000, temperature: 0.3 } as const`.
   - `async function createChatProvider(opts?: { model?: string; keyStore?: KeyStore; env?: NodeJS.ProcessEnv }): Promise<{ provider: Provider; model: string; secrets: string[] } | { error: string }>`: provider and model from `ai.json` `default` if set (any provider the user picked), else OpenRouter with `GEMMA_DEFAULT_MODEL`. Use the existing preset and `KeyStore` code to build the provider the same way `ai-commands.ts` / the presets do; do not duplicate the key lookup. No key: `{ error: 'No OpenRouter key. Run "polyman ai login openrouter" or set OPENROUTER_API_KEY.' }`. `secrets` = `keyStore.knownKeys()`.

## Tests

- Preset: the four Gemma models are listed, with tools and context window; other presets unchanged (snapshot or explicit check).
- `requestBody` for the OpenRouter preset: with tools has `provider.require_parameters` and `usage.include`; without tools has `usage.include` only; another preset (for example `deepseek`) has neither.
- Headers sent for OpenRouter.
- Replaying `gemma-openrouter-text.http`, `gemma-openrouter-tool-call.http` (one `verify` call with `{ dir: '.' }`), `gemma-openrouter-cost.http` (`usage.costUsd` is a number > 0) through the provider with the existing fixture helpers (`fixtureResponse` in `tests/fixtures/agent/index.ts`).
- 402 mapping: not retried, clear message, key redacted.
- `createChatProvider`: default OpenRouter + Gemma with an env key; `ai.json` default wins; no key gives the error.
- All existing provider tests still pass unchanged.

## Done when

`npm run build`, `npm run lint`, `npm test` pass. One commit: `agent: gemma 4 on openrouter`.
