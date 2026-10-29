import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_QUIRKS,
  NO_CREDITS,
  OpenAICompatibleProvider,
  parseToolArgs,
  requestBody,
  retryAfter,
  toWireMessages,
  type OpenAICompatibleOptions,
} from '../../../src/agent/providers/openai-compatible';
import {
  ProviderError,
  type ChatRequest,
  type Provider,
  type StreamEvent,
} from '../../../src/agent/providers/types';
import type { Message } from '../../../src/agent/core/messages';
import { getPreset } from '../../../src/agent/providers/presets';
import { withRetries } from '../../../src/agent/providers/retry';
import { fixtureResponse, readFixture } from '../../fixtures/agent';

const AT = '2026-10-24T00:00:00.000Z';

function request(over: Partial<ChatRequest> = {}): ChatRequest {
  return {
    model: 'gpt-4.1-mini',
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

type FetchArgs = Parameters<typeof fetch>;

/** A fake `fetch` that answers each call with the next response. */
function fakeFetch(...responses: (() => Response)[]) {
  return vi.fn(async (..._args: FetchArgs): Promise<Response> => {
    const next = responses.shift();
    if (!next) throw new Error('fakeFetch: no response left');
    return Promise.resolve(next());
  });
}

function provider(
  fetchFn: ReturnType<typeof fakeFetch>,
  opts: Partial<OpenAICompatibleOptions> = {}
): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider({
    baseUrl: 'https://api.example.com/v1/',
    apiKey: 'sk-test',
    fetch: fetchFn,
    ...opts,
  });
}

function fixture(name: string, chunkSize?: number): () => Response {
  return () => fixtureResponse(readFixture('openai', name), chunkSize);
}

/** An SSE response made of these chunks, then `[DONE]`. */
function sse(chunks: unknown[], done = true): () => Response {
  const body =
    chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') +
    (done ? 'data: [DONE]\n\n' : '');
  return () =>
    new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
}

function json(status: number, body: unknown, headers = {}): () => Response {
  return () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', ...headers },
    });
}

function delta(d: Record<string, unknown>, finish: string | null = null) {
  return { choices: [{ index: 0, delta: d, finish_reason: finish }] };
}

async function collect(
  p: Provider,
  req = request(),
  signal = new AbortController().signal
): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const event of p.stream(req, signal)) out.push(event);
  return out;
}

async function failure(promise: Promise<unknown>): Promise<ProviderError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ProviderError);
    return err as ProviderError;
  }
  throw new Error('expected a ProviderError');
}

function texts(events: StreamEvent[], type: 'text_delta' | 'reasoning_delta') {
  return events.flatMap(e => (e.type === type ? [e.text] : [])).join('');
}

function sentBody(fetchFn: ReturnType<typeof fakeFetch>, call = 0) {
  const body = fetchFn.mock.calls[call]?.[1]?.body;
  if (typeof body !== 'string') throw new Error('the body is not a string');
  return JSON.parse(body) as Record<string, unknown>;
}

const CHUNK_SIZES = [undefined, 1, 7, 64];

describe('OpenAICompatibleProvider: streaming fixtures', () => {
  it.each(CHUNK_SIZES)('streams text (chunk size %s)', async size => {
    const events = await collect(provider(fakeFetch(fixture('text', size))));
    expect(texts(events, 'text_delta')).toBe(
      'Hello! I can help you build and test this problem.'
    );
    // The first chunk has empty content, which gives no event.
    expect(events.filter(e => e.type === 'text_delta')).toHaveLength(12);
    expect(events.slice(-2)).toEqual([
      { type: 'usage', inputTokens: 318, outputTokens: 13, cachedTokens: 0 },
      { type: 'done', stopReason: 'end' },
    ]);
  });

  it.each(CHUNK_SIZES)(
    'maps DeepSeek reasoning_content to reasoning_delta (chunk size %s)',
    async size => {
      const events = await collect(
        provider(fakeFetch(fixture('reasoning', size)))
      );
      expect(texts(events, 'reasoning_delta')).toBe(
        'The user asks what the validator checks. It reads n and the array.'
      );
      expect(texts(events, 'text_delta')).toBe(
        'The validator checks that n is between 1 and 10^5.'
      );
      // All reasoning comes before the answer.
      const lastReasoning = events.findLastIndex(
        e => e.type === 'reasoning_delta'
      );
      const firstText = events.findIndex(e => e.type === 'text_delta');
      expect(lastReasoning).toBeLessThan(firstText);
      expect(events.slice(-2)).toEqual([
        {
          type: 'usage',
          inputTokens: 296,
          outputTokens: 27,
          cachedTokens: 192,
        },
        { type: 'done', stopReason: 'end' },
      ]);
    }
  );

  it.each(CHUNK_SIZES)(
    'maps OpenRouter reasoning to reasoning_delta and skips comments (chunk size %s)',
    async size => {
      const events = await collect(
        provider(fakeFetch(fixture('reasoning-openrouter', size)))
      );
      expect(texts(events, 'reasoning_delta')).toBe(
        'The user wants a generator for random arrays.'
      );
      expect(texts(events, 'text_delta')).toBe(
        'Use rnd.next(1, n) for each value.'
      );
      expect(events.slice(-2)).toEqual([
        {
          type: 'usage',
          inputTokens: 280,
          outputTokens: 14,
          cachedTokens: 0,
          costUsd: 0.0001792,
        },
        { type: 'done', stopReason: 'end' },
      ]);
    }
  );

  it.each(CHUNK_SIZES)(
    'collects a tool call and parses it once (chunk size %s)',
    async size => {
      const events = await collect(
        provider(fakeFetch(fixture('tool-call', size)))
      );
      expect(events).toEqual([
        {
          type: 'tool_call',
          id: 'call_q7Xk2LmN9pRs4TvW6yZa8BcD',
          name: 'read_file',
          args: { path: 'solutions/main.cpp' },
        },
        {
          type: 'usage',
          inputTokens: 402,
          outputTokens: 19,
          cachedTokens: 256,
        },
        { type: 'done', stopReason: 'tool_calls' },
      ]);
    }
  );

  it.each(CHUNK_SIZES)(
    'collects two tool calls by index (chunk size %s)',
    async size => {
      const events = await collect(
        provider(fakeFetch(fixture('two-tool-calls', size)))
      );
      expect(events.filter(e => e.type === 'tool_call')).toEqual([
        {
          type: 'tool_call',
          id: 'call_A1b2C3d4E5f6G7h8I9j0K1l2',
          name: 'read_file',
          args: { path: 'Config.json' },
        },
        {
          type: 'tool_call',
          id: 'call_M3n4O5p6Q7r8S9t0U1v2W3x4',
          name: 'list_files',
          args: { dir: 'generators' },
        },
      ]);
      expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'tool_calls' });
    }
  );

  it('turns the 429 fixture into a rate_limit error with retry-after', async () => {
    const fetchFn = fakeFetch(fixture('error'));
    const err = await failure(collect(provider(fetchFn)));
    expect(err.kind).toBe('rate_limit');
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(1000);
    expect(err.retryable).toBe(true);
    expect(err.message).toContain('Rate limit reached for gpt-4.1-mini');
    // No retries here, that is #78.
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('OpenAICompatibleProvider: request', () => {
  it('posts to baseUrl/chat/completions with the key and the signal', async () => {
    const fetchFn = fakeFetch(fixture('text'));
    const controller = new AbortController();
    await collect(provider(fetchFn), request(), controller.signal);

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/chat/completions');
    expect(init?.method).toBe('POST');
    expect(init?.signal).toBe(controller.signal);
    expect(init?.headers).toMatchObject({
      authorization: 'Bearer sk-test',
      'content-type': 'application/json',
      accept: 'text/event-stream',
    });
  });

  it('sends no authorization header without a key, and extra headers', async () => {
    const fetchFn = fakeFetch(fixture('text'));
    const p = new OpenAICompatibleProvider({
      baseUrl: 'http://localhost:11434/v1',
      headers: { 'x-title': 'polyman' },
      fetch: fetchFn,
    });
    await collect(p);
    const headers = fetchFn.mock.calls[0][1]!.headers as Record<string, string>;
    expect(headers['authorization']).toBeUndefined();
    expect(headers['x-title']).toBe('polyman');
    expect(p.id).toBe('openai-compatible');
  });

  it('sends model, messages, tools, stream and stream_options', async () => {
    const fetchFn = fakeFetch(fixture('tool-call'));
    await collect(
      provider(fetchFn),
      request({
        tools: [
          {
            name: 'read_file',
            description: 'Reads a file.',
            parameters: { type: 'object', properties: {} },
          },
        ],
        maxOutputTokens: 1000,
        temperature: 0.2,
        reasoningEffort: 'low',
      })
    );
    expect(sentBody(fetchFn)).toEqual({
      model: 'gpt-4.1-mini',
      messages: [
        { role: 'system', content: 'You build problems.' },
        { role: 'user', content: 'hi' },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'read_file',
            description: 'Reads a file.',
            parameters: { type: 'object', properties: {} },
          },
        },
      ],
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 1000,
      temperature: 0.2,
      reasoning_effort: 'low',
    });
  });

  it('leaves out tools when there are none, and uses the max tokens field quirk', () => {
    const body = requestBody(request({ maxOutputTokens: 50 }), {
      ...DEFAULT_QUIRKS,
      maxTokensField: 'max_completion_tokens',
      streamOptions: false,
    });
    expect(body['tools']).toBeUndefined();
    expect(body['stream_options']).toBeUndefined();
    expect(body['max_tokens']).toBeUndefined();
    expect(body['max_completion_tokens']).toBe(50);
  });

  it('maps tool calls to assistant.tool_calls and tool results to role tool', () => {
    const messages: Message[] = [
      {
        id: 'u1',
        role: 'user',
        parts: [{ type: 'text', text: 'read it' }],
        createdAt: AT,
      },
      {
        id: 'a1',
        role: 'assistant',
        parts: [
          { type: 'reasoning', text: 'secret thoughts' },
          { type: 'text', text: 'Reading.' },
          {
            type: 'tool_call',
            id: 'c1',
            name: 'read_file',
            args: { path: 'a' },
          },
          { type: 'tool_call', id: 'c2', name: 'bad', args: '{"x":' },
        ],
        createdAt: AT,
      },
      {
        id: 't1',
        role: 'tool',
        parts: [
          {
            type: 'tool_result',
            callId: 'c1',
            content: 'file text',
            isError: false,
          },
          {
            type: 'tool_result',
            callId: 'c2',
            content: 'bad JSON',
            isError: true,
          },
        ],
        createdAt: AT,
      },
      {
        id: 'a2',
        role: 'assistant',
        parts: [{ type: 'reasoning', text: 'only thoughts' }],
        createdAt: AT,
      },
    ];
    expect(toWireMessages('', messages)).toEqual([
      { role: 'user', content: 'read it' },
      {
        role: 'assistant',
        content: 'Reading.',
        tool_calls: [
          {
            id: 'c1',
            type: 'function',
            function: { name: 'read_file', arguments: '{"path":"a"}' },
          },
          {
            id: 'c2',
            type: 'function',
            function: { name: 'bad', arguments: '{"x":' },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'file text' },
      { role: 'tool', tool_call_id: 'c2', content: 'bad JSON' },
    ]);
    // Reasoning is never sent back.
    expect(JSON.stringify(toWireMessages('', messages))).not.toContain(
      'thoughts'
    );
  });

  it('sends an assistant message with only tool calls with content null', () => {
    const wire = toWireMessages('sys', [
      {
        id: 'a1',
        role: 'assistant',
        parts: [{ type: 'tool_call', id: 'c1', name: 'verify', args: {} }],
        createdAt: AT,
      },
    ]);
    expect(wire[1]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'verify', arguments: '{}' },
        },
      ],
    });
  });

  it('retries once without stream_options when the server rejects it, and remembers', async () => {
    const fetchFn = fakeFetch(
      json(400, {
        error: {
          message: 'Unrecognized request argument supplied: stream_options',
        },
      }),
      fixture('text'),
      fixture('text')
    );
    const p = provider(fetchFn);
    const events = await collect(p);
    expect(events.at(-1)).toEqual({ type: 'done', stopReason: 'end' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(sentBody(fetchFn, 0)['stream_options']).toEqual({
      include_usage: true,
    });
    expect(sentBody(fetchFn, 1)['stream_options']).toBeUndefined();
    expect(p.quirks.streamOptions).toBe(false);

    await collect(p);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(sentBody(fetchFn, 2)['stream_options']).toBeUndefined();
  });

  it('fails with tools_not_supported before sending when the quirk says no tools', async () => {
    const fetchFn = fakeFetch();
    const p = provider(fetchFn, { quirks: { tools: false } });
    const err = await failure(
      collect(
        p,
        request({
          tools: [{ name: 'verify', description: 'v', parameters: {} }],
        })
      )
    );
    expect(err.kind).toBe('tools_not_supported');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('OpenAICompatibleProvider: errors', () => {
  it.each<[number, unknown, string, boolean]>([
    [401, { error: { message: 'Incorrect API key provided' } }, 'auth', false],
    [403, { error: { message: 'Forbidden' } }, 'auth', false],
    [
      400,
      {
        error: {
          message: "This model's maximum context length is 128000 tokens.",
          code: 'context_length_exceeded',
        },
      },
      'context_too_long',
      false,
    ],
    [413, { error: 'payload too large' }, 'context_too_long', false],
    [
      400,
      {
        error: {
          message: 'registry.ollama.ai/library/gemma:2b does not support tools',
        },
      },
      'tools_not_supported',
      false,
    ],
    [
      400,
      { error: { message: "Invalid 'tools[0].function.name': bad pattern" } },
      'bad_request',
      false,
    ],
    [404, { message: 'model not found' }, 'bad_request', false],
    [500, { error: { message: 'internal error' } }, 'server', true],
    [503, 'Service Unavailable', 'server', true],
  ])(
    'maps HTTP %i to the right kind',
    async (status, body, kind, retryable) => {
      const respond =
        typeof body === 'string'
          ? () => new Response(body, { status })
          : json(status, body);
      const err = await failure(collect(provider(fakeFetch(respond))));
      expect(err.kind).toBe(kind);
      expect(err.status).toBe(status);
      expect(err.retryable).toBe(retryable);
      expect(err.message).toContain(`HTTP ${status}`);
    }
  );

  it('turns a failed fetch into a retryable network error', async () => {
    const fetchFn = vi.fn(() => Promise.reject(new TypeError('fetch failed')));
    const err = await failure(collect(provider(fetchFn)));
    expect(err.kind).toBe('network');
    expect(err.retryable).toBe(true);
    expect(err.message).toContain('fetch failed');
  });

  it('gives a network error when the stream ends before the turn', async () => {
    const fetchFn = fakeFetch(sse([delta({ content: 'Hel' })], false));
    const events: StreamEvent[] = [];
    const run = async () => {
      for await (const e of provider(fetchFn).stream(
        request(),
        new AbortController().signal
      )) {
        events.push(e);
      }
    };
    const err = await failure(run());
    expect(err.kind).toBe('network');
    expect(events).toEqual([{ type: 'text_delta', text: 'Hel' }]);
  });

  it('throws an error sent inside the stream', async () => {
    const fetchFn = fakeFetch(
      sse([delta({ content: 'a' }), { error: { message: 'upstream died' } }])
    );
    const err = await failure(collect(provider(fetchFn)));
    expect(err.kind).toBe('server');
    expect(err.message).toContain('upstream died');
  });

  it('throws a server error on bad JSON in the stream', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(new Response('data: {oops\n\n', { status: 200 }))
    );
    const err = await failure(collect(provider(fetchFn)));
    expect(err.kind).toBe('server');
  });
});

describe('OpenAICompatibleProvider: abort', () => {
  it('throws without calling fetch when already aborted', async () => {
    const fetchFn = fakeFetch(fixture('text'));
    const controller = new AbortController();
    controller.abort();
    await expect(
      collect(provider(fetchFn), request(), controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('stops the stream when aborted in the middle', async () => {
    const fetchFn = fakeFetch(fixture('text', 16));
    const controller = new AbortController();
    const seen: StreamEvent[] = [];
    const run = async () => {
      for await (const e of provider(fetchFn).stream(
        request(),
        controller.signal
      )) {
        seen.push(e);
        if (seen.length === 2) controller.abort();
      }
    };
    await expect(run()).rejects.toMatchObject({ name: 'AbortError' });
    expect(seen).toHaveLength(2);
    expect(seen.some(e => e.type === 'done')).toBe(false);
  });

  it('rethrows the abort when fetch fails because of it', async () => {
    const controller = new AbortController();
    const fetchFn = vi.fn(() => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    });
    const err: unknown = await collect(
      provider(fetchFn as never),
      request(),
      controller.signal
    ).catch((e: unknown) => e);
    expect(err).not.toBeInstanceOf(ProviderError);
    expect(err).toMatchObject({ name: 'AbortError' });
  });
});

describe('OpenAICompatibleProvider: stream details', () => {
  it('uses the custom reasoning fields of the quirks', async () => {
    const fetchFn = fakeFetch(
      sse([
        delta({ thinking: 'hmm', reasoning_content: 'ignored' }),
        delta({ content: 'ok' }, 'stop'),
      ])
    );
    const events = await collect(
      provider(fetchFn, { quirks: { reasoningFields: ['thinking'] } })
    );
    expect(events).toEqual([
      { type: 'reasoning_delta', text: 'hmm' },
      { type: 'text_delta', text: 'ok' },
      { type: 'done', stopReason: 'end' },
    ]);
  });

  it('maps finish_reason length and content_filter', async () => {
    for (const [reason, stop] of [
      ['length', 'max_tokens'],
      ['content_filter', 'content_filter'],
    ] as const) {
      const events = await collect(
        provider(fakeFetch(sse([delta({ content: 'a' }, reason)])))
      );
      expect(events.at(-1)).toEqual({ type: 'done', stopReason: stop });
    }
  });

  it('says tool_calls when a server finishes with stop after tool calls', async () => {
    const fetchFn = fakeFetch(
      sse([
        delta(
          {
            tool_calls: [
              { id: 'c1', function: { name: 'verify', arguments: '{}' } },
            ],
          },
          'stop'
        ),
      ])
    );
    expect(await collect(provider(fetchFn))).toEqual([
      { type: 'tool_call', id: 'c1', name: 'verify', args: {} },
      { type: 'done', stopReason: 'tool_calls' },
    ]);
  });

  it('gives ids to tool calls that have none, and parses empty arguments as {}', async () => {
    const fetchFn = fakeFetch(
      sse([
        delta({
          tool_calls: [
            { index: 0, function: { name: 'verify', arguments: '' } },
            { index: 1, function: { name: 'list_files', arguments: '{}' } },
          ],
        }),
        delta({}, 'tool_calls'),
      ])
    );
    const calls = (await collect(provider(fetchFn))).filter(
      e => e.type === 'tool_call'
    );
    expect(calls).toEqual([
      { type: 'tool_call', id: 'call_1', name: 'verify', args: {} },
      { type: 'tool_call', id: 'call_2', name: 'list_files', args: {} },
    ]);
  });

  it('emits tool calls at the end when finish_reason never comes before [DONE]', async () => {
    const fetchFn = fakeFetch(
      sse([
        delta({
          tool_calls: [
            {
              index: 0,
              id: 'c1',
              function: { name: 'verify', arguments: '{}' },
            },
          ],
        }),
      ])
    );
    expect(await collect(provider(fetchFn))).toEqual([
      { type: 'tool_call', id: 'c1', name: 'verify', args: {} },
      { type: 'done', stopReason: 'tool_calls' },
    ]);
  });

  it('fixes tool arguments with trailing text', async () => {
    const fetchFn = fakeFetch(
      sse([
        delta({
          tool_calls: [
            {
              index: 0,
              id: 'c1',
              function: { name: 'read_file', arguments: '{"path":"a}b"}' },
            },
          ],
        }),
        delta({
          tool_calls: [
            { index: 0, function: { arguments: ' I will now read it.' } },
          ],
        }),
        delta({}, 'tool_calls'),
      ])
    );
    const events = await collect(provider(fetchFn));
    expect(events[0]).toEqual({
      type: 'tool_call',
      id: 'c1',
      name: 'read_file',
      args: { path: 'a}b' },
    });
  });

  it('gives the raw arguments and argsError when they cannot be fixed', async () => {
    const fetchFn = fakeFetch(
      sse([
        delta({
          tool_calls: [
            {
              index: 0,
              id: 'c1',
              function: { name: 'read_file', arguments: '{"path": ' },
            },
          ],
        }),
        delta({}, 'tool_calls'),
      ])
    );
    const [call] = await collect(provider(fetchFn));
    expect(call).toMatchObject({
      type: 'tool_call',
      id: 'c1',
      name: 'read_file',
      args: '{"path": ',
    });
    expect(call?.type === 'tool_call' && call.argsError).toContain(
      'not valid JSON'
    );
  });
});

describe('OpenAICompatibleProvider: tool call indexes', () => {
  const piece = (index: number, id: string | undefined, name: string) => ({
    index,
    ...(id ? { id } : {}),
    function: { name, arguments: '{"n":"' + name + '"}' },
  });

  it.each([2000000000, -1, 1.5, 129])(
    'rejects the tool call index %s',
    async index => {
      const fetchFn = fakeFetch(
        sse([
          delta({ tool_calls: [piece(index, 'c1', 'read_file')] }),
          delta({}, 'tool_calls'),
        ])
      );
      const error = await failure(collect(provider(fetchFn)));
      expect(error.kind).toBe('server');
      expect(error.message).toContain('bad index');
    }
  );

  it('starts a new call when a piece at the same index has another id', async () => {
    const fetchFn = fakeFetch(
      sse([
        delta({ tool_calls: [piece(0, 'a', 'one')] }),
        delta({ tool_calls: [piece(0, 'b', 'two')] }),
        delta({}, 'tool_calls'),
      ])
    );
    const events = await collect(provider(fetchFn));
    expect(events.filter(e => e.type === 'tool_call')).toEqual([
      { type: 'tool_call', id: 'a', name: 'one', args: { n: 'one' } },
      { type: 'tool_call', id: 'b', name: 'two', args: { n: 'two' } },
    ]);
  });

  it('keeps adding pieces without an id, or with the same id, to the call', async () => {
    const fetchFn = fakeFetch(
      sse([
        delta({ tool_calls: [{ index: 0, id: 'a', function: { name: 'x' } }] }),
        delta({
          tool_calls: [{ index: 0, id: 'a', function: { arguments: '{"k":' } }],
        }),
        delta({
          tool_calls: [{ index: 0, function: { arguments: '1}' } }],
        }),
        delta({}, 'tool_calls'),
      ])
    );
    const events = await collect(provider(fetchFn));
    expect(events.filter(e => e.type === 'tool_call')).toEqual([
      { type: 'tool_call', id: 'a', name: 'x', args: { k: 1 } },
    ]);
  });

  it('gives the calls in index order', async () => {
    const fetchFn = fakeFetch(
      sse([
        delta({
          tool_calls: [piece(1, 'b', 'two'), piece(0, 'a', 'one')],
        }),
        delta({}, 'tool_calls'),
      ])
    );
    const events = await collect(provider(fetchFn));
    expect(
      events.flatMap(e => (e.type === 'tool_call' ? [e.name] : []))
    ).toEqual(['one', 'two']);
  });
});

describe('OpenAICompatibleProvider: broken streams', () => {
  /** Gives each chunk in its own read, then fails the next read. */
  const failingBody = (chunks: string[]) => () => {
    const encoder = new TextEncoder();
    let i = 0;
    return new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          const c = chunks[i++];
          if (c === undefined) controller.error(new TypeError('terminated'));
          else controller.enqueue(encoder.encode(c));
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } }
    );
  };

  it('turns a read error in the middle of the stream into a network error', async () => {
    const chunk = `data: ${JSON.stringify(delta({ content: 'hi' }))}\n\n`;
    const fetchFn = fakeFetch(failingBody([chunk]));
    const error = await failure(collect(provider(fetchFn)));
    expect(error.kind).toBe('network');
    expect(error.retryable).toBe(true);
    expect(error.message).toContain('the stream broke: terminated');
  });

  it('turns a read error before the first chunk into a network error', async () => {
    const fetchFn = fakeFetch(failingBody([]));
    const error = await failure(collect(provider(fetchFn)));
    expect(error.kind).toBe('network');
  });

  it('keeps the server error of a bad chunk as it is', async () => {
    const fetchFn = fakeFetch(failingBody(['data: not json\n\n']));
    const error = await failure(collect(provider(fetchFn)));
    expect(error.kind).toBe('server');
  });

  it.each([
    { choices: [null] },
    { choices: 'x' },
    { choices: [{ delta: 'x' }] },
    { choices: [{ delta: { tool_calls: 'x' } }] },
    { choices: [{ delta: { tool_calls: [null] } }] },
  ])(
    'gives a non-retryable server error for a chunk with a bad shape: %j',
    async chunk => {
      const fetchFn = fakeFetch(sse([chunk]));
      const error = await failure(collect(provider(fetchFn)));
      expect(error.kind).toBe('server');
      expect(error.retryable).toBe(false);
      expect(error.message).toContain('bad shape');
    }
  );
});

describe('parseToolArgs', () => {
  it.each<[string, unknown]>([
    ['', {}],
    ['  ', {}],
    ['{"a":1}', { a: 1 }],
    ['{"a":1} trailing words', { a: 1 }],
    ['{"a":"}"}}', { a: '}' }],
    ['{"a":"say \\"hi\\" {"}\nok', { a: 'say "hi" {' }],
    ['```json\n{"a":[1,2]}\n```', { a: [1, 2] }],
    ['[1,2] and more', [1, 2]],
  ])('reads %j', (raw, value) => {
    expect(parseToolArgs(raw, true)).toEqual({ ok: true, value });
  });

  it('fails on JSON it cannot fix', () => {
    for (const raw of ['{"a":', 'not json', '"unterminated']) {
      const parsed = parseToolArgs(raw, true);
      expect(parsed.ok).toBe(false);
    }
  });

  it('does not fix anything when repair is off', () => {
    expect(parseToolArgs('{"a":1} trailing', false).ok).toBe(false);
    expect(parseToolArgs('{"a":1}', false)).toEqual({
      ok: true,
      value: { a: 1 },
    });
  });
});

describe('retryAfter', () => {
  const now = Date.parse('2026-10-24T12:00:00Z');

  it('reads seconds, ms and dates', () => {
    expect(retryAfter(new Headers({ 'retry-after': '2' }), now)).toBe(2000);
    expect(retryAfter(new Headers({ 'retry-after': '0.5' }), now)).toBe(500);
    expect(
      retryAfter(
        new Headers({ 'retry-after-ms': '315', 'retry-after': '1' }),
        now
      )
    ).toBe(315);
    expect(
      retryAfter(
        new Headers({ 'retry-after': 'Sat, 24 Oct 2026 12:00:03 GMT' }),
        now
      )
    ).toBe(3000);
  });

  it('does not read a bare number as a date', () => {
    for (const value of ['-5', '-0.5', 'Infinity', '-Infinity']) {
      expect(
        retryAfter(new Headers({ 'retry-after': value }), now)
      ).toBeUndefined();
    }
    // Still a number of seconds. The cap belongs to a later change.
    expect(retryAfter(new Headers({ 'retry-after': '1e12' }), now)).toBe(1e15);
  });

  it('treats an empty retry-after-ms as missing', () => {
    for (const blank of ['', '  ']) {
      expect(
        retryAfter(
          new Headers({ 'retry-after-ms': blank, 'retry-after': '5' }),
          now
        )
      ).toBe(5000);
    }
    expect(
      retryAfter(new Headers({ 'retry-after-ms': '' }), now)
    ).toBeUndefined();
  });

  it('gives undefined when the header is missing or bad', () => {
    expect(retryAfter(new Headers(), now)).toBeUndefined();
    expect(
      retryAfter(new Headers({ 'retry-after': 'soon' }), now)
    ).toBeUndefined();
  });
});

describe('OpenAICompatibleProvider: extraBody quirk', () => {
  const tool = {
    name: 'verify',
    description: 'Runs polyman verify.',
    parameters: { type: 'object', properties: {} },
  };

  function presetQuirks(id: string) {
    return { ...DEFAULT_QUIRKS, ...getPreset(id)?.quirks };
  }

  it('adds usage.include and provider.require_parameters for OpenRouter with tools', () => {
    const body = requestBody(
      request({ tools: [tool] }),
      presetQuirks('openrouter')
    );
    expect(body['usage']).toEqual({ include: true });
    expect(body['provider']).toEqual({ require_parameters: true });
    expect(body['model']).toBe('gpt-4.1-mini');
    expect(body['stream']).toBe(true);
  });

  it('adds only usage.include for OpenRouter without tools', () => {
    const body = requestBody(request(), presetQuirks('openrouter'));
    expect(body['usage']).toEqual({ include: true });
    expect(body).not.toHaveProperty('provider');
  });

  it('adds nothing for other presets', () => {
    for (const id of ['deepseek', 'openai', 'groq', 'ollama']) {
      const body = requestBody(request({ tools: [tool] }), presetQuirks(id));
      expect(body).not.toHaveProperty('usage');
      expect(body).not.toHaveProperty('provider');
    }
    expect(DEFAULT_QUIRKS.extraBody).toBeUndefined();
  });

  it('merges extraBody after the standard fields', () => {
    const body = requestBody(request({ temperature: 0.2 }), {
      ...DEFAULT_QUIRKS,
      extraBody: req => ({ temperature: 0.9, seen: req.model }),
    });
    expect(body['temperature']).toBe(0.9);
    expect(body['seen']).toBe('gpt-4.1-mini');
  });

  it('sends extraBody in the posted request', async () => {
    const fetchFn = fakeFetch(fixture('text'));
    await collect(
      provider(fetchFn, { quirks: getPreset('openrouter')?.quirks ?? {} })
    );
    expect(sentBody(fetchFn)['usage']).toEqual({ include: true });
  });
});

describe('OpenAICompatibleProvider: cost', () => {
  it('reads usage.cost into costUsd', async () => {
    const fetchFn = fakeFetch(
      sse([
        {
          ...delta({ content: 'ok' }, 'stop'),
          usage: { prompt_tokens: 5, completion_tokens: 1, cost: 0.000012 },
        },
      ])
    );
    const events = await collect(provider(fetchFn));
    expect(events.find(e => e.type === 'usage')).toEqual({
      type: 'usage',
      inputTokens: 5,
      outputTokens: 1,
      costUsd: 0.000012,
    });
  });

  it('leaves costUsd out when the server sends no cost', async () => {
    const fetchFn = fakeFetch(
      sse([
        {
          ...delta({ content: 'ok' }, 'stop'),
          usage: { prompt_tokens: 5, completion_tokens: 1, cost: 'free' },
        },
      ])
    );
    const usage = (await collect(provider(fetchFn))).find(
      e => e.type === 'usage'
    );
    expect(usage).toEqual({ type: 'usage', inputTokens: 5, outputTokens: 1 });
  });
});

describe('OpenAICompatibleProvider: 402 no credits', () => {
  const KEY = 'sk-or-v1-test-key-for-402-redaction-000000';
  const body = {
    error: { message: `Insufficient credits for key ${KEY}`, code: 402 },
  };

  it('maps 402 to a bad_request that is not retryable', async () => {
    const err = await failure(collect(provider(fakeFetch(json(402, body)))));
    expect(err.kind).toBe('bad_request');
    expect(err.status).toBe(402);
    expect(err.retryable).toBe(false);
    expect(err.message.startsWith(NO_CREDITS)).toBe(true);
    expect(err.message).toContain('https://openrouter.ai/settings/credits');
    expect(err.message).toContain('Insufficient credits');
  });

  it('is not retried, and the key is redacted', async () => {
    const fetchFn = fakeFetch(json(402, body), fixture('text'));
    const p = withRetries(provider(fetchFn, { apiKey: KEY }), {
      secrets: [KEY],
      baseDelayMs: 0,
    });
    const err = await failure(collect(p));
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(err.kind).toBe('bad_request');
    expect(err.message).toContain(NO_CREDITS);
    expect(err.message).not.toContain(KEY);
  });

  it('keeps the clear message when the body is empty', async () => {
    const fetchFn = fakeFetch(() => new Response('', { status: 402 }));
    const err = await failure(collect(provider(fetchFn)));
    expect(err.message).toBe(`${NO_CREDITS} (HTTP 402)`);
  });
});
