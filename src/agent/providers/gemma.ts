/**
 * Gemma 4 through OpenRouter: the default model of `polyman chat`, its
 * budgets, and {@link createChatProvider}, which builds the provider for a
 * chat from `ai.json` and the presets.
 */

import { PolymanError } from '../../errors';
import { AnthropicProvider } from './anthropic';
import { KeyStore } from './key-store';
import { OpenAICompatibleProvider } from './openai-compatible';
import { getPreset, type Preset } from './presets';
import type { Provider } from './types';

/** The model `polyman chat` uses when `ai.json` has no default. */
export const GEMMA_DEFAULT_MODEL = 'google/gemma-4-31b-it';

/** The provider of {@link GEMMA_DEFAULT_MODEL}. */
export const GEMMA_DEFAULT_PROVIDER = 'openrouter';

/**
 * Budgets for Gemma. It is smaller than the frontier models, so it gets
 * fewer steps and a much smaller context than its 262k window
 * (design/agent/03-providers.md).
 */
export const GEMMA_BUDGETS = {
  chatMaxSteps: 20,
  contextBudgetTokens: 32000,
  toolResultCapBytes: 8192,
  maxOutputTokens: 8000,
  temperature: 0.3,
} as const;

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
 * OpenRouter with {@link GEMMA_DEFAULT_MODEL}. `model` replaces only the
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
  const providerId = def?.provider ?? GEMMA_DEFAULT_PROVIDER;
  const modelId = model ?? def?.model ?? GEMMA_DEFAULT_MODEL;

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
