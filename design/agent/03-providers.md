# 03: The model: Gemma 4 through OpenRouter (M1)

## Status

The provider layer is **already built** (M1, merged in v3.1.0, see `src/agent/providers/`):

| File | What it has |
| --- | --- |
| `types.ts` | `Provider`, `ChatRequest`, `StreamEvent` (tool calls carry `argsError` when the JSON is broken), `ProviderError` |
| `openai-compatible.ts` | `OpenAICompatibleProvider`: streaming, tool call collection, `parseToolArgs` with repair (code fences, text after the JSON), error mapping, `Quirks` |
| `anthropic.ts` | `AnthropicProvider` |
| `presets.ts` | presets for OpenAI, Anthropic, DeepSeek, Qwen, Gemini, Groq, Mistral, **OpenRouter**, Ollama, custom |
| `capabilities.ts` | context window, tool support, chat-only fallback |
| `key-store.ts` | `~/.polyman/ai.json` (`KeyStore`: `getKey`, `setDefault`, `knownKeys`), `redact(text, keys)` |
| `retry.ts` | `withRetries`, `retry-after`, backoff |
| `sse-parser.ts` | `parseSse` |
| `mock.ts` | `MockProvider` with scripted steps |
| `../ai-commands.ts` | `polyman ai login / logout / list / models / use` |

## The decision

We keep this layer as it is, and **build and tune the agent for one model: Gemma 4 through OpenRouter.** It is the default model, the one in the prompts, the budgets, the evals and the demo. Other providers keep working through the same `Provider` interface, but we do not tune or test the agent on them in this plan.

| Model id (OpenRouter) | Use | Price per 1M tokens (in / out) | Context | Tools |
| --- | --- | --- | --- | --- |
| `google/gemma-4-31b-it` | default, the main model | $0.20 / $0.40 | 262k | yes |
| `google/gemma-4-26b-a4b-it` | cheaper and faster (MoE, 4B active) | $0.07 / $0.23 | 262k | yes |
| `google/gemma-4-31b-it:free` | development only, rate limited | $0 | 262k | yes |
| `google/gemma-4-26b-a4b-it:free` | development only, rate limited | $0 | 262k | yes |

Prices and tool support are from the OpenRouter models list on 2026-10-25. A real tool call test passed on 2026-10-25: Gemma 4 31B answered `verify({"dir":"."})` for $0.00001.

Why Gemma 4:

- It is an open-weights model. The whole stack is open: our harness plus an open model.
- It supports tool calling and has a big context window.
- It is cheap. A long session (about 6M tokens) costs around $1.20 on the 31B model.
- The same weights can run locally later (the Ollama preset already exists), so private problems do not have to leave the machine.

## What we add for Gemma (hack day task W1)

Small changes to the existing layer, no new provider class:

1. **Presets**: the OpenRouter preset gets the four Gemma 4 models (with `supportsTools: true`, context 262144, prices), and `google/gemma-4-31b-it` becomes the model `polyman chat` uses when `ai.json` has no default.
2. **OpenRouter request options**, through a new `Quirks` field `extraBody` (merged into the request body):
   - `provider: { require_parameters: true }` when the request has tools, so OpenRouter only routes to hosts that support tools. Without it, a request can land on a host that ignores the tools.
   - `usage: { include: true }`, so the last chunk has the real cost.
3. **Cost**: `StreamEvent` `usage` gets an optional `costUsd`, filled from OpenRouter's `usage.cost`.
4. **Headers** for the OpenRouter preset: `HTTP-Referer: https://github.com/HamzaHassanain/polyman`, `X-Title: polyman`.
5. **Errors**: HTTP 402 (no credits) maps to a clear, non-retryable error that says to add credits.
6. **Budgets** for Gemma in `src/agent/providers/gemma.ts` (below).

## Gemma quirks

Gemma 4 is smaller than the frontier models. The harness must expect mistakes and turn them into tool results the model can fix, never into crashes.

| Quirk | Handling |
| --- | --- |
| Tool arguments that are not valid JSON | Already handled: `parseToolArgs` repairs, else the tool call has `argsError`. The tool registry sends that error back so the model calls again. |
| A tool call written as text in `content` instead of `tool_calls` | The session detects a known tool name in the text. It does not run it, it sends a user note: "use the tool call, not text". |
| Wrong argument names or types | The schema check in the tool registry returns the exact problem (see [04-harness.md](04-harness.md)). |
| Loops (the same tool with the same args again and again) | The session counts repeats. After 3 the same call returns: "you already did this, the result was: ... Try something else or ask the user." |
| Long contexts make it worse at following the rules | We use a much smaller budget than the 262k window (see below). |
| Free variants hit rate limits fast | Use them only while developing. The demo and real use go to the paid model. |

## Budgets for Gemma

| Setting | Value | Why |
| --- | --- | --- |
| Max steps per turn | 20 | A small model that is stuck rarely recovers after 20 steps. |
| Context budget | 32k tokens, trim old tool results above that | Quality drops with long contexts. Old files can always be read again. |
| Tool result cap | 8 KB | Short, exact results work better than full logs. The full log stays on disk. |
| Max output tokens per step | 8k | Enough for a full solution or generator file. |
| Temperature | 0.3 to start | Tool work needs stable output. Not sure yet, the evals decide. |
| Tools exposed at once | about 10 | Fewer tools, fewer wrong picks. |

## Key and settings

The existing `~/.polyman/ai.json` and `polyman ai` commands are used as they are:

```bash
polyman ai login openrouter                          # hidden prompt, saves the key
polyman ai use openrouter/google/gemma-4-31b-it      # default model
```

or just `export OPENROUTER_API_KEY=...` (the env var wins over the file). The key is only sent to the OpenRouter base URL, and `redact` removes it from logs, errors and session files.

## Tests

- The existing provider tests stay green.
- W1 adds: the Gemma models in the preset, `extraBody` in the request body (with and without tools), `costUsd` from a recorded OpenRouter stream, the 402 mapping, the headers.
- `MockProvider` takes a script: `[{ text: 'ok' }, { toolCall: { name: 'verify', args: {} } }, ...]`.
