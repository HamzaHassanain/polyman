/**
 * Known providers, so users only type a key. Each preset says which adapter
 * talks to the provider, its base URL, the env var that holds the key, the
 * quirks of its server and a short list of known models.
 *
 * Base URLs, models and prices were checked against the docs linked on each
 * preset on 2026-10-24. Prices change often: they are optional, and every
 * price names the page it comes from in `priceSource`.
 */

import type { ChatRequest, ModelInfo } from './types';

/**
 * Changes from the default OpenAI-compatible quirks for one server.
 *
 * It has the same fields as `Partial<Quirks>` of the OpenAI-compatible
 * adapter (#76). When that adapter lands, this type can become an alias of
 * `Partial<Quirks>`.
 */
export interface PresetQuirks {
  /** Send `stream_options.include_usage`. */
  streamOptions?: boolean;
  /** Name of the max output tokens field in the request body. */
  maxTokensField?: 'max_tokens' | 'max_completion_tokens';
  /** Delta fields that hold reasoning text, checked in order. */
  reasoningFields?: readonly string[];
  /** Try to fix tool arguments that are not valid JSON. */
  repairToolArgs?: boolean;
  /** Whether the server supports tools at all. */
  tools?: boolean;
  /** More fields for the request body, merged after the standard ones. */
  extraBody?: (req: ChatRequest) => Record<string, unknown>;
}

/** A model we know about, with what the provider docs say about it. */
export interface PresetModel extends ModelInfo {
  /** Upper bound on generated tokens. */
  maxOutput?: number;
  /** Whether the model can think before it answers. */
  reasoning?: boolean;
  /** Whether the model can ask for more than one tool call in one turn. */
  parallelToolCalls?: boolean;
  /** USD per million input tokens. Needs `priceSource`. */
  pricePerMTokIn?: number;
  /** USD per million output tokens. Needs `priceSource`. */
  pricePerMTokOut?: number;
  /** Where the prices come from, and when they were checked. */
  priceSource?: string;
}

/** Which adapter talks to a provider. */
export type PresetAdapter = 'openai' | 'anthropic';

/** A provider the user can pick by id. */
export interface Preset {
  /** Stable id, like `deepseek`. */
  id: string;
  /** Name shown to the user, like `DeepSeek`. */
  label: string;
  /** Which adapter talks to this provider. */
  adapter: PresetAdapter;
  /**
   * Base URL of the API. A key of this preset is only ever sent here. Empty
   * for `custom`, where the user gives it.
   */
  baseUrl: string;
  /** Env var that holds the key. Empty when there is none. */
  envVar: string;
  /** False for local servers that need no key. */
  keyRequired: boolean;
  /** The provider docs the base URL was checked against. */
  docsUrl: string;
  /** Changes from the default quirks of the adapter. */
  quirks?: PresetQuirks;
  /** More headers for every request to this provider. */
  headers?: Readonly<Record<string, string>>;
  /** Known models. `listModels()` can find more. */
  models: PresetModel[];
}

const CHECKED = 'checked 2026-10-24';
const OPENROUTER_CHECKED = 'checked 2026-10-25';

/** Every preset, in the order we show them. */
export const PRESETS: readonly Preset[] = [
  {
    id: 'openai',
    label: 'OpenAI',
    adapter: 'openai',
    // https://developers.openai.com/api/reference/overview
    baseUrl: 'https://api.openai.com/v1',
    envVar: 'OPENAI_API_KEY',
    keyRequired: true,
    docsUrl: 'https://developers.openai.com/api/reference/overview',
    // Newer OpenAI models only accept `max_completion_tokens`.
    quirks: { maxTokensField: 'max_completion_tokens' },
    models: [
      {
        id: 'gpt-6.1-sol',
        contextWindow: 1_050_000,
        maxOutput: 128_000,
        supportsTools: true,
        pricePerMTokIn: 2,
        pricePerMTokOut: 10,
        priceSource: `https://developers.openai.com/api/docs/models, ${CHECKED}`,
      },
      {
        id: 'gpt-6-luna',
        contextWindow: 1_050_000,
        maxOutput: 128_000,
        supportsTools: true,
        pricePerMTokIn: 0.1,
        pricePerMTokOut: 0.5,
        priceSource: `https://developers.openai.com/api/docs/models, ${CHECKED}`,
      },
      {
        id: 'gpt-6-astra',
        contextWindow: 1_050_000,
        maxOutput: 128_000,
        supportsTools: true,
        pricePerMTokIn: 10,
        pricePerMTokOut: 50,
        priceSource: `https://developers.openai.com/api/docs/models, ${CHECKED}`,
      },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    adapter: 'anthropic',
    // https://platform.claude.com/docs/en/api/overview
    baseUrl: 'https://api.anthropic.com',
    envVar: 'ANTHROPIC_API_KEY',
    keyRequired: true,
    docsUrl: 'https://platform.claude.com/docs/en/api/overview',
    models: [
      {
        id: 'claude-opus-5-5',
        contextWindow: 1_000_000,
        maxOutput: 128_000,
        supportsTools: true,
        reasoning: true,
        parallelToolCalls: true,
        pricePerMTokIn: 4,
        pricePerMTokOut: 20,
        priceSource: `https://platform.claude.com/docs/en/about-claude/pricing, ${CHECKED}`,
      },
      {
        id: 'claude-sonnet-5-5',
        contextWindow: 1_000_000,
        maxOutput: 128_000,
        supportsTools: true,
        reasoning: true,
        parallelToolCalls: true,
        pricePerMTokIn: 2,
        pricePerMTokOut: 10,
        priceSource: `https://platform.claude.com/docs/en/about-claude/pricing, ${CHECKED}`,
      },
      {
        id: 'claude-haiku-5-5',
        contextWindow: 1_000_000,
        maxOutput: 128_000,
        supportsTools: true,
        reasoning: true,
        parallelToolCalls: true,
        // For prompts up to 100K tokens, longer prompts cost more.
        pricePerMTokIn: 0.1,
        pricePerMTokOut: 0.5,
        priceSource: `https://platform.claude.com/docs/en/about-claude/pricing, ${CHECKED}`,
      },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    adapter: 'openai',
    // https://api-docs.deepseek.com/ gives `https://api.deepseek.com` as the
    // OpenAI-format base URL.
    baseUrl: 'https://api.deepseek.com',
    envVar: 'DEEPSEEK_API_KEY',
    keyRequired: true,
    docsUrl: 'https://api-docs.deepseek.com/',
    quirks: { reasoningFields: ['reasoning_content'] },
    models: [
      { id: 'deepseek-flash', supportsTools: true, reasoning: true },
      { id: 'deepseek-v4-pro', supportsTools: true, reasoning: true },
    ],
  },
  {
    id: 'qwen',
    label: 'Qwen (Alibaba Cloud Model Studio)',
    adapter: 'openai',
    // https://www.alibabacloud.com/help/en/model-studio/regions/ lists this
    // Singapore domain for existing integrations. New accounts may get a
    // workspace domain instead; they can use the `custom` preset for it.
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    envVar: 'DASHSCOPE_API_KEY',
    keyRequired: true,
    docsUrl:
      'https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope',
    quirks: { reasoningFields: ['reasoning_content'] },
    models: [
      { id: 'qwen3.8-max', supportsTools: true },
      { id: 'qwen3.7-plus', supportsTools: true },
      { id: 'qwen3.8-flash', supportsTools: true },
    ],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    adapter: 'openai',
    // https://ai.google.dev/gemini-api/docs/openai
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    envVar: 'GEMINI_API_KEY',
    keyRequired: true,
    docsUrl: 'https://ai.google.dev/gemini-api/docs/openai',
    models: [
      { id: 'gemini-3.8-flash', supportsTools: true },
      { id: 'gemini-4-argon', supportsTools: true },
    ],
  },
  {
    id: 'groq',
    label: 'Groq',
    adapter: 'openai',
    // https://console.groq.com/docs/openai
    baseUrl: 'https://api.groq.com/openai/v1',
    envVar: 'GROQ_API_KEY',
    keyRequired: true,
    docsUrl: 'https://console.groq.com/docs/openai',
    models: [
      {
        id: 'openai/gpt-oss-120b',
        contextWindow: 131_072,
        maxOutput: 65_536,
        supportsTools: true,
        reasoning: true,
        pricePerMTokIn: 0.15,
        pricePerMTokOut: 0.6,
        priceSource: `https://console.groq.com/docs/models, ${CHECKED}`,
      },
      {
        id: 'openai/gpt-oss-20b',
        contextWindow: 131_072,
        maxOutput: 65_536,
        supportsTools: true,
        reasoning: true,
        pricePerMTokIn: 0.075,
        pricePerMTokOut: 0.3,
        priceSource: `https://console.groq.com/docs/models, ${CHECKED}`,
      },
      {
        id: 'llama-3.3-70b-versatile',
        contextWindow: 131_072,
        maxOutput: 32_768,
        supportsTools: true,
      },
    ],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    adapter: 'openai',
    // https://docs.mistral.ai/api/
    baseUrl: 'https://api.mistral.ai/v1',
    envVar: 'MISTRAL_API_KEY',
    keyRequired: true,
    docsUrl: 'https://docs.mistral.ai/api/',
    models: [
      { id: 'mistral-large-latest', supportsTools: true },
      { id: 'mistral-small-latest', supportsTools: true },
    ],
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    adapter: 'openai',
    // https://openrouter.ai/docs/quickstart
    baseUrl: 'https://openrouter.ai/api/v1',
    envVar: 'OPENROUTER_API_KEY',
    keyRequired: true,
    docsUrl: 'https://openrouter.ai/docs/quickstart',
    // https://openrouter.ai/docs/api-reference/overview: these two headers
    // name the app on openrouter.ai.
    headers: {
      'HTTP-Referer': 'https://github.com/HamzaHassanain/polyman',
      'X-Title': 'polyman',
    },
    quirks: {
      reasoningFields: ['reasoning'],
      // `usage.include` puts the real cost on the last chunk. With tools,
      // `require_parameters` only routes to hosts that support them; without
      // it a request can land on a host that ignores the tools.
      extraBody: req => ({
        usage: { include: true },
        ...(req.tools.length > 0
          ? { provider: { require_parameters: true } }
          : {}),
      }),
    },
    models: [
      { id: 'openrouter/auto' },
      {
        id: 'google/gemma-4-31b-it',
        contextWindow: 262_144,
        supportsTools: true,
        pricePerMTokIn: 0.2,
        pricePerMTokOut: 0.4,
        priceSource: `https://openrouter.ai/models, ${OPENROUTER_CHECKED}`,
      },
      {
        id: 'google/gemma-4-26b-a4b-it',
        contextWindow: 262_144,
        supportsTools: true,
        pricePerMTokIn: 0.07,
        pricePerMTokOut: 0.23,
        priceSource: `https://openrouter.ai/models, ${OPENROUTER_CHECKED}`,
      },
      {
        // Free variants are rate limited: for development only.
        id: 'google/gemma-4-31b-it:free',
        contextWindow: 262_144,
        supportsTools: true,
        pricePerMTokIn: 0,
        pricePerMTokOut: 0,
        priceSource: `https://openrouter.ai/models, ${OPENROUTER_CHECKED}`,
      },
      {
        id: 'google/gemma-4-26b-a4b-it:free',
        contextWindow: 262_144,
        supportsTools: true,
        pricePerMTokIn: 0,
        pricePerMTokOut: 0,
        priceSource: `https://openrouter.ai/models, ${OPENROUTER_CHECKED}`,
      },
    ],
  },
  {
    id: 'ollama',
    label: 'Ollama (local)',
    adapter: 'openai',
    // https://docs.ollama.com/api/openai-compatibility
    baseUrl: 'http://localhost:11434/v1',
    envVar: '',
    keyRequired: false,
    docsUrl: 'https://docs.ollama.com/api/openai-compatibility',
    // Small local models often break the tool call JSON.
    quirks: { repairToolArgs: true },
    // Any model the user pulled works; these are only examples.
    models: [{ id: 'qwen3' }, { id: 'llama3.1' }],
  },
  {
    id: 'custom',
    label: 'Custom OpenAI-compatible server',
    adapter: 'openai',
    // The user gives the base URL, the key and the models.
    baseUrl: '',
    envVar: '',
    keyRequired: false,
    docsUrl: 'https://developers.openai.com/api/reference/overview',
    models: [],
  },
];

/** Returns the preset with this id, or `undefined`. */
export function getPreset(id: string): Preset | undefined {
  return PRESETS.find(preset => preset.id === id);
}

/** The ids of every preset, in order. */
export function presetIds(): string[] {
  return PRESETS.map(preset => preset.id);
}

/**
 * True when `url` is the base URL or a path under it: same scheme, host and
 * port, and a path that starts at a `/` boundary of the base path. A key is
 * only sent when this is true for its own preset.
 *
 * @example
 * urlBelongsTo('https://api.openai.com/v1', 'https://api.openai.com/v1/models'); // true
 * urlBelongsTo('https://api.openai.com/v1', 'https://api.openai.com.evil.io/v1'); // false
 */
export function urlBelongsTo(baseUrl: string, url: string): boolean {
  let base: URL;
  let target: URL;
  try {
    base = new URL(baseUrl);
    target = new URL(url);
  } catch {
    return false;
  }
  if (target.username !== '' || target.password !== '') return false;
  if (base.origin !== target.origin) return false;
  const basePath = base.pathname.replace(/\/+$/, '');
  return (
    target.pathname === basePath ||
    target.pathname === `${basePath}/` ||
    target.pathname.startsWith(`${basePath}/`)
  );
}

const ENV_VAR = /^[A-Z][A-Z0-9_]*$/;

/**
 * Lists what is wrong with a preset. An empty list means it is fine.
 * Tests run it on every preset.
 */
export function validatePreset(preset: Preset): string[] {
  const problems: string[] = [];
  const where = `preset "${preset.id}"`;
  if (!/^[a-z][a-z0-9-]*$/.test(preset.id)) {
    problems.push(`${where}: id must be lowercase letters, digits and -`);
  }
  if (preset.label.trim() === '') problems.push(`${where}: label is empty`);
  if (preset.adapter !== 'openai' && preset.adapter !== 'anthropic') {
    problems.push(`${where}: unknown adapter`);
  }
  if (preset.id === 'custom') {
    // The user gives the URL and the key, so the preset must stay empty.
    if (preset.baseUrl !== '' || preset.envVar !== '' || preset.keyRequired) {
      problems.push(
        `${where}: custom must have an empty baseUrl and envVar, and no key`
      );
    }
  } else {
    problems.push(...baseUrlProblems(preset.baseUrl, where));
  }
  if (preset.keyRequired && !ENV_VAR.test(preset.envVar)) {
    problems.push(`${where}: a preset that needs a key needs an env var`);
  }
  if (preset.envVar !== '' && !ENV_VAR.test(preset.envVar)) {
    problems.push(`${where}: envVar must be UPPER_SNAKE_CASE`);
  }
  if (!isHttpUrl(preset.docsUrl)) {
    problems.push(`${where}: docsUrl is not an http(s) URL`);
  }
  const seen = new Set<string>();
  for (const model of preset.models) {
    if (model.id.trim() === '') problems.push(`${where}: a model has no id`);
    if (seen.has(model.id)) {
      problems.push(`${where}: model "${model.id}" is listed twice`);
    }
    seen.add(model.id);
    const hasPrice =
      model.pricePerMTokIn !== undefined || model.pricePerMTokOut !== undefined;
    if (hasPrice && !model.priceSource) {
      problems.push(`${where}: model "${model.id}" has a price but no source`);
    }
    for (const [field, value] of [
      ['contextWindow', model.contextWindow],
      ['maxOutput', model.maxOutput],
    ] as const) {
      if (value !== undefined && !(Number.isInteger(value) && value > 0)) {
        problems.push(`${where}: model "${model.id}" has a bad ${field}`);
      }
    }
  }
  return problems;
}

/**
 * Checks a preset base URL. The URL parser drops a bare `?`, `#` or `@`,
 * lowercases the scheme and host, trims spaces and turns `\` into `/`, so
 * every check also looks at the raw string, and the raw string must be the
 * normal form the parser gives back.
 */
function baseUrlProblems(baseUrl: string, where: string): string[] {
  if (!isHttpUrl(baseUrl)) return [`${where}: baseUrl is not an http(s) URL`];
  const url = new URL(baseUrl);
  if (url.protocol === 'http:' && url.hostname !== 'localhost') {
    return [`${where}: only a localhost server may use http`];
  }
  if (/[@?#]/.test(baseUrl) || url.username || url.password) {
    return [`${where}: baseUrl must not have user info, a query or a hash`];
  }
  if (baseUrl.endsWith('/')) {
    return [`${where}: baseUrl must not end with /`];
  }
  const normal = url.href.replace(/\/$/, '');
  if (baseUrl !== normal) {
    return [`${where}: baseUrl must be written as ${normal}`];
  }
  return [];
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}
