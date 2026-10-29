import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  DEFAULT_BUDGETS,
  DEFAULT_CHAT_MODEL,
  createChatProvider,
  modelSetup,
  noKeyMessage,
  type ChatProviderResult,
} from '../../../src/agent/providers/chat-provider';
import { ModelCatalog } from '../../../src/agent/providers/model-catalog';
import { getPreset, presetIds } from '../../../src/agent/providers/presets';
import { KeyStore } from '../../../src/agent/providers/key-store';
import { OpenAICompatibleProvider } from '../../../src/agent/providers/openai-compatible';
import { AnthropicProvider } from '../../../src/agent/providers/anthropic';
import type {
  ChatRequest,
  Provider,
  StreamEvent,
} from '../../../src/agent/providers/types';
import {
  fixtureResponse,
  readFixture,
  readModelsFixture,
} from '../../fixtures/agent';

const OR_KEY = 'sk-or-test-0000111122223333';
const AT = '2026-10-26T00:00:00.000Z';

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'polyman-chat-provider-'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(home, { recursive: true, force: true });
});

function store(env: NodeJS.ProcessEnv = {}): KeyStore {
  return new KeyStore({ home, env });
}

function ok(
  result: ChatProviderResult
): Extract<ChatProviderResult, { provider: Provider }> {
  if ('error' in result) throw new Error(`unexpected error: ${result.error}`);
  return result;
}

function request(over: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: DEFAULT_CHAT_MODEL,
    system: 'You build problems.',
    messages: [
      {
        id: 'm1',
        role: 'user',
        parts: [{ type: 'text', text: 'hi' }],
        createdAt: AT,
      },
    ],
    tools: [],
    ...over,
  };
}

async function collect(p: Provider, req = request()): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const e of p.stream(req, new AbortController().signal)) {
    out.push(e);
  }
  return out;
}

/** Stubs the global fetch to play one recorded OpenRouter fixture. */
function stubFetch(name: string, chunkSize?: number) {
  const fn = vi.fn((..._args: Parameters<typeof fetch>) =>
    Promise.resolve(fixtureResponse(readFixture('openai', name), chunkSize))
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

async function gemma(): Promise<Provider> {
  return ok(
    await createChatProvider({
      keyStore: store({ OPENROUTER_API_KEY: OR_KEY }),
    })
  ).provider;
}

describe('chat defaults', () => {
  it('has the default model and the budgets of the design', () => {
    expect(DEFAULT_CHAT_MODEL).toBe('google/gemma-4-31b-it');
    expect(DEFAULT_BUDGETS).toEqual({
      chatMaxSteps: 20,
      contextBudgetTokens: 32000,
      toolResultCapBytes: 8192,
      maxOutputTokens: 8000,
      temperature: 0.3,
    });
  });
});

describe('createChatProvider', () => {
  it('defaults to OpenRouter and Gemma with an env key', async () => {
    const result = ok(
      await createChatProvider({
        keyStore: store({ OPENROUTER_API_KEY: OR_KEY }),
      })
    );
    expect(result.provider).toBeInstanceOf(OpenAICompatibleProvider);
    expect(result.provider.id).toBe('openrouter');
    expect(result.model).toBe(DEFAULT_CHAT_MODEL);
    expect(result.secrets).toContain(OR_KEY);
  });

  it('builds its own KeyStore from env when none is given', async () => {
    vi.stubEnv('HOME', home);
    vi.stubEnv('USERPROFILE', home);
    try {
      const result = ok(
        await createChatProvider({ env: { OPENROUTER_API_KEY: OR_KEY } })
      );
      expect(result.provider.id).toBe('openrouter');
      expect(result.secrets).toEqual([OR_KEY]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('uses the given model on the default provider', async () => {
    const result = ok(
      await createChatProvider({
        model: 'google/gemma-4-26b-a4b-it',
        keyStore: store({ OPENROUTER_API_KEY: OR_KEY }),
      })
    );
    expect(result.provider.id).toBe('openrouter');
    expect(result.model).toBe('google/gemma-4-26b-a4b-it');
  });

  it('lets the ai.json default win', async () => {
    const keys = store({ OPENROUTER_API_KEY: OR_KEY });
    keys.setKey('deepseek', 'sk-deepseek-file-key-1234');
    keys.setDefault('deepseek', 'deepseek-flash');
    const result = ok(await createChatProvider({ keyStore: keys }));
    expect(result.provider).toBeInstanceOf(OpenAICompatibleProvider);
    expect(result.provider.id).toBe('deepseek');
    expect(result.model).toBe('deepseek-flash');
    expect(result.secrets).toEqual(
      expect.arrayContaining([OR_KEY, 'sk-deepseek-file-key-1234'])
    );
  });

  it('builds the Anthropic adapter for an anthropic default', async () => {
    const keys = store({ ANTHROPIC_API_KEY: 'sk-ant-test-key-12345' });
    keys.setDefault('anthropic', 'claude-haiku-5-5');
    const result = ok(await createChatProvider({ keyStore: keys }));
    expect(result.provider).toBeInstanceOf(AnthropicProvider);
    expect(result.model).toBe('claude-haiku-5-5');
  });

  it('needs no key for a local server', async () => {
    const keys = store();
    keys.setDefault('ollama', 'qwen3');
    const result = ok(await createChatProvider({ keyStore: keys }));
    expect(result.provider.id).toBe('ollama');
  });

  it('gives the OpenRouter error when there is no key', async () => {
    const result = await createChatProvider({ keyStore: store() });
    expect(result).toEqual({
      error:
        'No OpenRouter key. Run "polyman ai login openrouter" or set OPENROUTER_API_KEY. Get a key at https://openrouter.ai/keys',
    });
  });

  it('names the picked provider when its key is missing', async () => {
    const keys = store({ OPENROUTER_API_KEY: OR_KEY });
    keys.setDefault('groq', 'llama-3.3-70b-versatile');
    const result = await createChatProvider({ keyStore: keys });
    expect(result).toEqual({
      error: 'No Groq key. Run "polyman ai login groq" or set GROQ_API_KEY.',
    });
  });

  it('gives an error for an unknown provider in ai.json', async () => {
    const keys = store();
    keys.setDefault('nope', 'm');
    const result = await createChatProvider({ keyStore: keys });
    expect('error' in result && result.error).toMatch(
      /Unknown provider "nope"/
    );
  });

  it('gives an error for custom without a base URL', async () => {
    const keys = store();
    keys.setDefault('custom', 'my-model');
    const result = await createChatProvider({ keyStore: keys });
    expect('error' in result && result.error).toMatch(/No base URL for custom/);
  });

  it('gives an error, not a throw, for a broken ai.json', async () => {
    mkdirSync(join(home, '.polyman'), { recursive: true });
    writeFileSync(join(home, '.polyman', 'ai.json'), `{ "key": "${OR_KEY}"`);
    const result = await createChatProvider({
      keyStore: store({ OPENROUTER_API_KEY: OR_KEY }),
    });
    expect('error' in result && result.error).toMatch(/not valid JSON/);
    expect(JSON.stringify(result)).not.toContain(OR_KEY);
  });
});

describe('createChatProvider with --provider and --model', () => {
  it('uses any OpenRouter model id with --model', async () => {
    const result = ok(
      await createChatProvider({
        model: 'deepseek/deepseek-v3.2',
        keyStore: store({ OPENROUTER_API_KEY: OR_KEY }),
      })
    );
    expect(result.providerId).toBe('openrouter');
    expect(result.providerLabel).toBe('OpenRouter');
    expect(result.model).toBe('deepseek/deepseek-v3.2');
  });

  it('lets --provider and --model win over the ai.json default', async () => {
    const keys = store({ OPENROUTER_API_KEY: OR_KEY });
    keys.setKey('deepseek', 'sk-deepseek-file-key-1234');
    keys.setDefault('deepseek', 'deepseek-flash');
    const result = ok(
      await createChatProvider({
        provider: 'openrouter',
        model: 'qwen/qwen3-coder',
        keyStore: keys,
      })
    );
    expect(result.provider.id).toBe('openrouter');
    expect(result.model).toBe('qwen/qwen3-coder');
  });

  it('takes the ai.json model when --provider is the same provider', async () => {
    const keys = store({ OPENROUTER_API_KEY: OR_KEY });
    keys.setDefault('openrouter', 'meta-llama/llama-4-maverick');
    const result = ok(
      await createChatProvider({ provider: 'openrouter', keyStore: keys })
    );
    expect(result.model).toBe('meta-llama/llama-4-maverick');
  });

  it('gives --provider openrouter the default model', async () => {
    const keys = store({ OPENROUTER_API_KEY: OR_KEY });
    keys.setKey('deepseek', 'sk-deepseek-file-key-1234');
    keys.setDefault('deepseek', 'deepseek-flash');
    const result = ok(
      await createChatProvider({ provider: 'openrouter', keyStore: keys })
    );
    expect(result.model).toBe(DEFAULT_CHAT_MODEL);
  });

  it('gives another --provider its first preset model', async () => {
    const result = ok(
      await createChatProvider({
        provider: 'deepseek',
        keyStore: store({ DEEPSEEK_API_KEY: 'sk-deepseek-env-key-123' }),
      })
    );
    expect(result.providerId).toBe('deepseek');
    expect(result.model).toBe(getPreset('deepseek')?.models[0]?.id);
  });

  it('gives --provider custom its first saved model', async () => {
    const keys = store();
    keys.setKey('custom', 'sk-custom-key-123456', {
      baseUrl: 'https://my.server/v1',
      models: ['mine-1', 'mine-2'],
    });
    const result = ok(
      await createChatProvider({ provider: 'custom', keyStore: keys })
    );
    expect(result.model).toBe('mine-1');
  });

  it('asks for --model when custom has no saved model', async () => {
    const keys = store();
    keys.setKey('custom', 'sk-custom-key-123456', {
      baseUrl: 'https://my.server/v1',
    });
    const result = await createChatProvider({
      provider: 'custom',
      keyStore: keys,
    });
    expect('error' in result && result.error).toMatch(
      /No model for custom\. Pick one with --model <id>/
    );
  });

  it('lists the known providers for an unknown --provider', async () => {
    const result = await createChatProvider({
      provider: 'nope',
      keyStore: store(),
    });
    expect(result).toEqual({
      error: `Unknown provider "nope". Known providers: ${presetIds().join(', ')}.`,
    });
  });

  it('lists the known providers for an unknown ai.json provider', async () => {
    const keys = store();
    keys.setDefault('nope', 'm');
    const result = await createChatProvider({ keyStore: keys });
    expect('error' in result && result.error).toContain(
      `Known providers: ${presetIds().join(', ')}.`
    );
  });
});

describe('noKeyMessage', () => {
  it('says where to get an OpenRouter key', () => {
    const preset = getPreset('openrouter');
    if (!preset) throw new Error('no openrouter preset');
    expect(noKeyMessage(preset)).toBe(
      'No OpenRouter key. Run "polyman ai login openrouter" or set OPENROUTER_API_KEY. Get a key at https://openrouter.ai/keys'
    );
  });

  it('has no key page for a preset without one', () => {
    const preset = getPreset('groq');
    if (!preset) throw new Error('no groq preset');
    expect(noKeyMessage(preset)).toBe(
      'No Groq key. Run "polyman ai login groq" or set GROQ_API_KEY.'
    );
  });
});

describe('modelSetup', () => {
  const T0 = 1_793_000_000_000;
  const catalog = (fetchFn: typeof fetch) =>
    new ModelCatalog({ home, fetch: fetchFn, now: () => T0 });
  const live = () =>
    vi.fn((..._args: Parameters<typeof fetch>) =>
      Promise.resolve(fixtureResponse(readModelsFixture('openrouter-models')))
    );
  const offline = () =>
    vi.fn((..._args: Parameters<typeof fetch>) =>
      Promise.reject(new TypeError('fetch failed'))
    );

  it('keeps the Gemma budgets with the live list', async () => {
    const setup = await modelSetup('openrouter', DEFAULT_CHAT_MODEL, {
      keyStore: store(),
      catalog: catalog(live()),
    });
    expect(setup.live?.maxOutput).toBe(16_384);
    expect(setup.budgets).toEqual(DEFAULT_BUDGETS);
  });

  it('keeps the Gemma budgets offline', async () => {
    const setup = await modelSetup('openrouter', DEFAULT_CHAT_MODEL, {
      keyStore: store(),
      catalog: catalog(offline()),
    });
    expect(setup.live).toBeUndefined();
    expect(setup.budgets).toEqual(DEFAULT_BUDGETS);
  });

  it('clamps the budgets of a small live model', async () => {
    // google/gemma-2-27b-it has an 8192 window in the recorded list.
    const setup = await modelSetup('openrouter', 'google/gemma-2-27b-it', {
      keyStore: store(),
      catalog: catalog(live()),
    });
    expect(setup.caps.contextWindow).toBe(8192);
    expect(setup.budgets.maxOutputTokens).toBe(2048);
    expect(setup.budgets.contextBudgetTokens).toBe(4608);
  });

  it('knows a live model with no tools can only chat', async () => {
    const setup = await modelSetup('openrouter', 'google/gemma-3-4b-it', {
      keyStore: store(),
      catalog: catalog(live()),
    });
    expect(
      setup.capabilities.isChatOnly('openrouter', 'google/gemma-3-4b-it')
    ).toBe(true);
  });

  it('applies the ai.json overrides last, budgets too', async () => {
    const keys = store();
    keys.update(s => {
      s.overrides['openrouter/google/gemma-3-4b-it'] = {
        tools: true,
        chatMaxSteps: 7,
      };
    });
    const setup = await modelSetup('openrouter', 'google/gemma-3-4b-it', {
      keyStore: keys,
      catalog: catalog(live()),
    });
    expect(setup.caps.tools).toBe(true);
    expect(setup.budgets.chatMaxSteps).toBe(7);
  });

  it('does not fetch for a provider without a live list', async () => {
    const fetchFn = live();
    const setup = await modelSetup('deepseek', 'deepseek-flash', {
      keyStore: store(),
      catalog: catalog(fetchFn),
    });
    expect(fetchFn).not.toHaveBeenCalled();
    expect(setup.live).toBeUndefined();
  });

  it('works with a broken ai.json', async () => {
    mkdirSync(join(home, '.polyman'), { recursive: true });
    writeFileSync(join(home, '.polyman', 'ai.json'), '{ broken');
    const setup = await modelSetup('openrouter', DEFAULT_CHAT_MODEL, {
      keyStore: store(),
      catalog: catalog(offline()),
    });
    expect(setup.budgets).toEqual(DEFAULT_BUDGETS);
  });
});

describe('Gemma on OpenRouter: recorded streams', () => {
  it('posts to OpenRouter with the key, app headers and extra body', async () => {
    const fetchFn = stubFetch('gemma-openrouter-text');
    await collect(await gemma());
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init?.headers).toMatchObject({
      authorization: `Bearer ${OR_KEY}`,
      'HTTP-Referer': 'https://github.com/HamzaHassanain/polyman',
      'X-Title': 'polyman',
    });
    const body = JSON.parse(init?.body as string) as Record<string, unknown>;
    expect(body['model']).toBe(DEFAULT_CHAT_MODEL);
    expect(body['usage']).toEqual({ include: true });
    expect(body).not.toHaveProperty('provider');
  });

  it.each([undefined, 1, 13])(
    'streams text with its cost (chunk size %s)',
    async size => {
      stubFetch('gemma-openrouter-text', size);
      const events = await collect(await gemma());
      const text = events
        .flatMap(e => (e.type === 'text_delta' ? [e.text] : []))
        .join('');
      expect(text).toBe('Hello, how are you doing?');
      expect(events.slice(-2)).toEqual([
        {
          type: 'usage',
          inputTokens: 19,
          outputTokens: 8,
          cachedTokens: 0,
          costUsd: 0.00000462,
        },
        { type: 'done', stopReason: 'end' },
      ]);
    }
  );

  it.each([undefined, 1, 13])(
    'gives one verify tool call (chunk size %s)',
    async size => {
      const fetchFn = stubFetch('gemma-openrouter-tool-call', size);
      const events = await collect(
        await gemma(),
        request({
          tools: [
            {
              name: 'verify',
              description: 'Runs polyman verify.',
              parameters: {
                type: 'object',
                properties: { dir: { type: 'string' } },
              },
            },
          ],
        })
      );
      expect(events.filter(e => e.type === 'tool_call')).toEqual([
        {
          type: 'tool_call',
          id: 'call-967015ee-fb03-41d4-a0b8-d7ee05dc2281',
          name: 'verify',
          args: { dir: '.' },
        },
      ]);
      expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_calls' });
      const body = JSON.parse(
        fetchFn.mock.calls[0][1]?.body as string
      ) as Record<string, unknown>;
      expect(body['provider']).toEqual({ require_parameters: true });
      expect(body['usage']).toEqual({ include: true });
    }
  );

  it('reads the cost of the last chunk', async () => {
    stubFetch('gemma-openrouter-cost');
    const events = await collect(await gemma());
    const usage = events.find(e => e.type === 'usage');
    expect(usage?.type).toBe('usage');
    const cost = usage?.type === 'usage' ? usage.costUsd : undefined;
    expect(typeof cost).toBe('number');
    expect(cost).toBeGreaterThan(0);
    expect(cost).toBe(0.000006);
  });
});
