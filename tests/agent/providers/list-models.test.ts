import { describe, it, expect, vi } from 'vitest';
import {
  OpenAICompatibleProvider,
  parseModelList,
} from '../../../src/agent/providers/openai-compatible';
import { ProviderError } from '../../../src/agent/providers/types';
import { fixtureResponse, readModelsFixture } from '../../fixtures/agent';

type FetchArgs = Parameters<typeof fetch>;

/** The recorded `GET /models` of OpenRouter, trimmed to 5 models. */
const openRouterModels = () => readModelsFixture('openrouter-models');

function fakeFetch(answer: () => Response | Promise<Response>) {
  return vi.fn((..._args: FetchArgs) => Promise.resolve(answer()));
}

const signal = () => new AbortController().signal;

describe('parseModelList', () => {
  const models = parseModelList(JSON.parse(openRouterModels().body));
  const byId = new Map(models.map(m => [m.id, m]));

  it('reads every model of the recorded OpenRouter list', () => {
    expect(models.map(m => m.id)).toEqual([
      'google/gemma-4-31b-it',
      'deepseek/deepseek-v3.2',
      'google/gemma-3-4b-it',
      'google/gemma-2-27b-it',
      'openrouter/auto',
    ]);
  });

  it('reads context, max output, tools, reasoning and prices', () => {
    expect(byId.get('google/gemma-4-31b-it')).toEqual({
      id: 'google/gemma-4-31b-it',
      contextWindow: 262_144,
      maxOutput: 16_384,
      supportsTools: true,
      reasoning: true,
      pricePerMTokIn: 0.2,
      pricePerMTokOut: 0.4,
    });
  });

  it('takes the smaller context of the model and its top provider', () => {
    // context_length 163840, top_provider.context_length 131072.
    expect(byId.get('deepseek/deepseek-v3.2')?.contextWindow).toBe(131_072);
    expect(byId.get('deepseek/deepseek-v3.2')?.maxOutput).toBe(65_536);
  });

  it('says when a model has no tool support', () => {
    expect(byId.get('google/gemma-3-4b-it')?.supportsTools).toBe(false);
  });

  it('drops unknown prices and a missing max output', () => {
    const auto = byId.get('openrouter/auto');
    expect(auto?.pricePerMTokIn).toBeUndefined();
    expect(auto?.pricePerMTokOut).toBeUndefined();
    expect(auto?.maxOutput).toBeUndefined();
  });

  it('reads a plain OpenAI list with only ids', () => {
    expect(
      parseModelList({
        object: 'list',
        data: [{ id: 'gpt-x', object: 'model' }, { id: '' }, { name: 'no id' }],
      })
    ).toEqual([{ id: 'gpt-x' }]);
  });

  it('ignores bad field types', () => {
    expect(
      parseModelList({
        data: [
          {
            id: 'm',
            context_length: 'big',
            top_provider: { max_completion_tokens: -5 },
            supported_parameters: 'tools',
            pricing: { prompt: 'free', completion: '0.000001' },
          },
        ],
      })
    ).toEqual([{ id: 'm' }]);
  });

  it('throws a server error for a body without data', () => {
    expect(() => parseModelList({ models: [] })).toThrow(ProviderError);
  });
});

describe('OpenAICompatibleProvider.listModels', () => {
  it('GETs {baseUrl}/models with the key and headers, and parses it', async () => {
    const fetchFn = fakeFetch(() => fixtureResponse(openRouterModels()));
    const p = new OpenAICompatibleProvider({
      id: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1/',
      apiKey: 'sk-or-test-key-1234',
      headers: { 'X-Title': 'polyman' },
      fetch: fetchFn,
    });
    const models = await p.listModels(signal());
    expect(models).toHaveLength(5);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('https://openrouter.ai/api/v1/models');
    expect(init?.method).toBe('GET');
    const headers = init?.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer sk-or-test-key-1234');
    expect(headers['X-Title']).toBe('polyman');
    expect(headers['accept']).toBe('application/json');
    expect(headers['content-type']).toBeUndefined();
  });

  it('sends no authorization header without a key', async () => {
    const fetchFn = fakeFetch(() => fixtureResponse(openRouterModels()));
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      fetch: fetchFn,
    });
    await p.listModels(signal());
    const headers = fetchFn.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(headers['authorization']).toBeUndefined();
  });

  it('turns a failed fetch into a network error', async () => {
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      fetch: vi.fn(() => Promise.reject(new Error('getaddrinfo ENOTFOUND'))),
    });
    await expect(p.listModels(signal())).rejects.toMatchObject({
      kind: 'network',
    });
  });

  it('turns an HTTP error into a provider error', async () => {
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      fetch: fakeFetch(
        () => new Response('{"error":{"message":"down"}}', { status: 503 })
      ),
    });
    await expect(p.listModels(signal())).rejects.toMatchObject({
      kind: 'server',
      status: 503,
    });
  });

  it('gives a server error for a body that is not JSON', async () => {
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      fetch: fakeFetch(() => new Response('<html>', { status: 200 })),
    });
    await expect(p.listModels(signal())).rejects.toMatchObject({
      kind: 'server',
    });
  });

  it('stops at once on an aborted signal', async () => {
    const fetchFn = fakeFetch(() => fixtureResponse(openRouterModels()));
    const p = new OpenAICompatibleProvider({
      baseUrl: 'https://openrouter.ai/api/v1',
      fetch: fetchFn,
    });
    const controller = new AbortController();
    controller.abort();
    await expect(p.listModels(controller.signal)).rejects.toThrow();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('OpenRouter without a tool host', () => {
  it('maps the 404 "no endpoints ... tool use" to tools_not_supported', async () => {
    const p = new OpenAICompatibleProvider({
      id: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
      fetch: fakeFetch(
        () =>
          new Response(
            JSON.stringify({
              error: {
                message:
                  'No endpoints found that support tool use. To learn more about provider routing, visit: https://openrouter.ai/docs/guides/routing/provider-selection',
                code: 404,
              },
            }),
            { status: 404 }
          )
      ),
    });
    const stream = p.stream(
      {
        model: 'google/gemma-3-4b-it',
        system: 's',
        messages: [],
        tools: [{ name: 't', description: 'd', parameters: {} }],
      },
      signal()
    );
    const events: unknown[] = [];
    await expect(
      (async () => {
        for await (const e of stream) events.push(e);
      })()
    ).rejects.toMatchObject({ kind: 'tools_not_supported', status: 404 });
  });
});
