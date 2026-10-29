/**
 * The provider and model of `polyman chat`: the default (Gemma 4 through
 * OpenRouter), the default budgets, and {@link createChatProvider}, which
 * builds the provider for a chat from `ai.json` and the presets.
 */

import { PolymanError } from '../../errors';
import { AnthropicProvider } from './anthropic';
import type { BudgetOverride, ModelCapabilities } from './capabilities';
import { KeyStore } from './key-store';
import { OpenAICompatibleProvider } from './openai-compatible';
import { getPreset, type Preset } from './presets';
import type { Provider } from './types';

/** The model `polyman chat` uses when `ai.json` has no default. */
export const DEFAULT_CHAT_MODEL = 'google/gemma-4-31b-it';

/** The provider of {@link DEFAULT_CHAT_MODEL}. */
export const DEFAULT_CHAT_PROVIDER = 'openrouter';

/** The budgets of one chat. */
export interface ChatBudgets {
  /** Model calls per chat turn. */
  chatMaxSteps: number;
  /** Context budget of the chat, in tokens (system prompt included). */
  contextBudgetTokens: number;
  /** Longest tool result kept in the conversation, in bytes. */
  toolResultCapBytes: number;
  /** Upper bound on generated tokens per call. */
  maxOutputTokens: number;
  /** Sampling temperature. */
  temperature: number;
}

/**
 * Budgets of a chat. They were made for Gemma 4, which is smaller than the
 * frontier models, so it gets fewer steps and a much smaller context than
 * its 262k window (design/agent/03-providers.md). They are also the upper
 * bounds of {@link budgetsFor}, so a big model gets the same budgets.
 */
export const DEFAULT_BUDGETS: Readonly<ChatBudgets> = Object.freeze({
  chatMaxSteps: 20,
  contextBudgetTokens: 32000,
  toolResultCapBytes: 8192,
  maxOutputTokens: 8000,
  temperature: 0.3,
});

/** The smallest context budget we give, even to a tiny model. */
export const MIN_CONTEXT_BUDGET = 1024;

/** The smallest output budget we give, even to a tiny model. */
export const MIN_OUTPUT_TOKENS = 256;

/**
 * The part of the context window the conversation may use, after the
 * output. The rest is for the tool definitions, which the budget does not
 * count, and for the rough `chars / 4` token estimate.
 */
const CONTEXT_SHARE = 0.75;

/**
 * The budgets of a chat with a model:
 *
 * - `maxOutputTokens`: the default (8000), but not more than the model's
 *   max output, and not more than a quarter of its context window.
 * - `contextBudgetTokens`: the default (32000), but not more than 75% of
 *   what is left of the window after the output.
 * - the steps, the tool result cap and the temperature stay the default.
 *
 * Then `override` (the `ai.json` override of the model) may set
 * `chatMaxSteps`, `contextBudgetTokens` and `maxOutputTokens` as they are.
 * Override fields that are not positive integers are ignored.
 *
 * Gemma 4 (262k window, 16k max output) gets exactly {@link DEFAULT_BUDGETS}.
 */
export function budgetsFor(
  caps: Pick<ModelCapabilities, 'contextWindow' | 'maxOutput'>,
  override?: BudgetOverride
): ChatBudgets {
  const base = DEFAULT_BUDGETS;
  const maxOutputTokens = Math.max(
    MIN_OUTPUT_TOKENS,
    Math.min(
      base.maxOutputTokens,
      caps.maxOutput,
      Math.floor(caps.contextWindow / 4)
    )
  );
  const room = Math.floor(
    (caps.contextWindow - maxOutputTokens) * CONTEXT_SHARE
  );
  const budgets: ChatBudgets = {
    ...base,
    maxOutputTokens,
    contextBudgetTokens: Math.max(
      MIN_CONTEXT_BUDGET,
      Math.min(base.contextBudgetTokens, room)
    ),
  };
  if (override) {
    for (const field of BUDGET_FIELDS) {
      const value = (override as Record<string, unknown>)[field];
      if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
        budgets[field] = value;
      }
    }
  }
  return budgets;
}

const BUDGET_FIELDS = [
  'chatMaxSteps',
  'contextBudgetTokens',
  'maxOutputTokens',
] as const;

/** Options of {@link createChatProvider}. */
export interface ChatProviderOptions {
  /** Model id. Overrides the model of the `ai.json` default. */
  model?: string;
  /** Where keys live. Defaults to `~/.polyman/ai.json`. */
  keyStore?: KeyStore;
  /** Env vars to read keys from, when no `keyStore` is given. */
  env?: NodeJS.ProcessEnv;
}

/** A provider ready for a chat, or why there is none. */
export type ChatProviderResult =
  { provider: Provider; model: string; secrets: string[] } | { error: string };

/**
 * Builds the provider for a chat. The provider and model come from the
 * `ai.json` default when it is set (any provider the user picked), else
 * OpenRouter with {@link DEFAULT_CHAT_MODEL}. `model` replaces only the
 * model id. `secrets` holds every known key, for `redact`.
 *
 * It never throws for a missing key or a broken `ai.json`: it returns
 * `{ error }` with a message to show the user.
 */
export function createChatProvider(
  opts: ChatProviderOptions = {}
): Promise<ChatProviderResult> {
  const store =
    opts.keyStore ??
    new KeyStore(opts.env !== undefined ? { env: opts.env } : {});
  try {
    return Promise.resolve(build(store, opts.model));
  } catch (error) {
    // KeyStore errors never hold a key or file content.
    if (error instanceof PolymanError) {
      const hint = error.hint === undefined ? '' : ` ${error.hint}`;
      return Promise.resolve({ error: `${error.message}${hint}` });
    }
    throw error;
  }
}

function build(store: KeyStore, model: string | undefined): ChatProviderResult {
  const def = store.read().default;
  const providerId = def?.provider ?? DEFAULT_CHAT_PROVIDER;
  const modelId = model ?? def?.model ?? DEFAULT_CHAT_MODEL;

  const preset = getPreset(providerId);
  if (!preset) {
    return {
      error: `Unknown provider "${providerId}" in ${store.path}. Run "polyman ai use <provider>/<model>".`,
    };
  }
  const baseUrl = store.baseUrlFor(preset.id);
  if (!baseUrl) {
    return {
      error: `No base URL for ${preset.id}. Run "polyman ai login ${preset.id} --base-url <url>".`,
    };
  }
  // keyForRequest also checks that the key only goes to its own base URL.
  const apiKey = store.keyForRequest(preset.id, baseUrl);
  if (!apiKey && preset.keyRequired) return { error: noKeyMessage(preset) };

  return {
    provider: providerFor(preset, baseUrl, apiKey),
    model: modelId,
    secrets: store.knownKeys(),
  };
}

function noKeyMessage(preset: Preset): string {
  return `No ${preset.label} key. Run "polyman ai login ${preset.id}" or set ${preset.envVar}.`;
}

function providerFor(
  preset: Preset,
  baseUrl: string,
  apiKey: string | undefined
): Provider {
  const key = apiKey !== undefined ? { apiKey } : {};
  const headers = preset.headers ? { headers: { ...preset.headers } } : {};
  if (preset.adapter === 'anthropic') {
    return new AnthropicProvider({
      id: preset.id,
      baseUrl,
      ...key,
      ...headers,
    });
  }
  return new OpenAICompatibleProvider({
    id: preset.id,
    baseUrl,
    ...key,
    ...headers,
    ...(preset.quirks ? { quirks: preset.quirks } : {}),
  });
}
