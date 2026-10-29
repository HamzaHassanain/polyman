import { describe, it, expect } from 'vitest';
import {
  fixtureResponse,
  listFixtures,
  parseFixture,
  readFixture,
  type Fixture,
  type FixtureFormat,
} from '../fixtures/agent';

const FORMATS: FixtureFormat[] = ['openai', 'anthropic'];
const REQUIRED = ['text', 'tool-call', 'two-tool-calls', 'reasoning', 'error'];

const DOCS_HOSTS: Record<FixtureFormat, string[]> = {
  openai: ['platform.openai.com', 'api-docs.deepseek.com', 'openrouter.ai'],
  anthropic: ['platform.claude.com'],
};

interface SseEvent {
  event?: string;
  data: string;
}

/**
 * Splits an SSE body into events. Only good enough to check the fixtures:
 * the real parser comes with the providers.
 */
function events(body: string): SseEvent[] {
  return body
    .split('\n\n')
    .filter(block => block !== '')
    .map(block => {
      const lines = block.split('\n').filter(l => !l.startsWith(':'));
      const out: SseEvent = { data: '' };
      for (const line of lines) {
        if (line.startsWith('event: ')) out.event = line.slice(7);
        else if (line.startsWith('data: ')) out.data += line.slice(6);
        else throw new Error(`unexpected SSE line: ${line}`);
      }
      return out;
    })
    .filter(e => e.event !== undefined || e.data !== '');
}

function isSse(f: Fixture): boolean {
  return (f.headers['content-type'] ?? '').startsWith('text/event-stream');
}

function json(data: string): Record<string, unknown> {
  return JSON.parse(data) as Record<string, unknown>;
}

interface OpenAIChunk {
  choices: {
    delta: {
      tool_calls?: {
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason: string | null;
  }[];
  usage?: unknown;
}

/** Tool calls of an OpenAI stream, collected by index. */
function openaiToolCalls(f: Fixture) {
  const calls: { id: string; name: string; args: string }[] = [];
  for (const e of events(f.body)) {
    if (e.data === '[DONE]') continue;
    const chunk = JSON.parse(e.data) as OpenAIChunk;
    for (const choice of chunk.choices) {
      for (const tc of choice.delta.tool_calls ?? []) {
        const call = (calls[tc.index] ??= { id: '', name: '', args: '' });
        call.id += tc.id ?? '';
        call.name += tc.function?.name ?? '';
        call.args += tc.function?.arguments ?? '';
      }
    }
  }
  return calls.map(c => ({ ...c, args: JSON.parse(c.args) as unknown }));
}

interface AnthropicEvent {
  type: string;
  index?: number;
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type?: string; partial_json?: string; stop_reason?: string };
}

/** Tool calls of an Anthropic stream, collected by block index. */
function anthropicToolCalls(f: Fixture) {
  const calls = new Map<number, { id: string; name: string; args: string }>();
  for (const e of events(f.body)) {
    const ev = JSON.parse(e.data) as AnthropicEvent;
    const block = ev.content_block;
    if (ev.type === 'content_block_start' && block?.type === 'tool_use') {
      calls.set(ev.index ?? -1, {
        id: block.id ?? '',
        name: block.name ?? '',
        args: '',
      });
    }
    if (ev.delta?.type === 'input_json_delta') {
      const call = calls.get(ev.index ?? -1);
      if (!call) throw new Error('input_json_delta without a tool_use block');
      call.args += ev.delta.partial_json ?? '';
    }
  }
  return [...calls.values()].map(c => ({
    ...c,
    args: JSON.parse(c.args) as unknown,
  }));
}

describe('agent fixtures', () => {
  describe.each(FORMATS)('%s', format => {
    const names = listFixtures(format);

    it('has the five required cases', () => {
      expect(names).toEqual(expect.arrayContaining(REQUIRED));
    });

    it.each(names)('%s says where its format comes from', name => {
      const f = readFixture(format, name);
      expect(f.sources.length).toBeGreaterThan(0);
      for (const src of f.sources) {
        const host = new URL(src).host;
        expect(src.startsWith('https://')).toBe(true);
        expect(DOCS_HOSTS[format]).toContain(host);
      }
      expect(f.notes.some(n => n.includes('#79'))).toBe(true);
    });

    it.each(names)('%s has a well formed body', name => {
      const f = readFixture(format, name);
      if (!isSse(f)) {
        expect(f.status).toBeGreaterThanOrEqual(400);
        expect(() => json(f.body)).not.toThrow();
        return;
      }
      expect(f.status).toBe(200);
      expect(f.body.endsWith('\n\n')).toBe(true);
      const evs = events(f.body);
      expect(evs.length).toBeGreaterThan(2);
      for (const e of evs) {
        if (e.data === '[DONE]') continue;
        const data = json(e.data);
        // Anthropic names every event after its data type.
        if (format === 'anthropic') expect(e.event).toBe(data['type']);
        else expect(e.event).toBeUndefined();
      }
    });
  });

  describe('openai', () => {
    it.each(listFixtures('openai').filter(n => n !== 'error'))(
      '%s ends with a usage chunk and [DONE]',
      name => {
        const evs = events(readFixture('openai', name).body);
        expect(evs.at(-1)?.data).toBe('[DONE]');
        const usage = JSON.parse(evs.at(-2)?.data ?? '') as OpenAIChunk;
        // OpenAI sends usage in its own chunk with no choices. OpenRouter
        // puts it on the chunk with the finish reason.
        if (usage.choices.length > 0) {
          expect(usage.choices[0]?.finish_reason).toBeTruthy();
        }
        expect(usage.usage).toBeTruthy();
      }
    );

    it('tool-call has one complete call', () => {
      expect(openaiToolCalls(readFixture('openai', 'tool-call'))).toEqual([
        {
          id: 'call_q7Xk2LmN9pRs4TvW6yZa8BcD',
          name: 'read_file',
          args: { path: 'solutions/main.cpp' },
        },
      ]);
    });

    it('two-tool-calls has two calls with their own ids', () => {
      const calls = openaiToolCalls(readFixture('openai', 'two-tool-calls'));
      expect(calls.map(c => [c.name, c.args])).toEqual([
        ['read_file', { path: 'Config.json' }],
        ['list_files', { dir: 'generators' }],
      ]);
      expect(new Set(calls.map(c => c.id)).size).toBe(2);
    });

    it.each(['reasoning', 'reasoning-openrouter'])(
      '%s streams reasoning before the answer',
      name => {
        const body = readFixture('openai', name).body;
        const field = name === 'reasoning' ? 'reasoning_content' : 'reasoning';
        // The first non-empty value of each field.
        const reasoning = body.search(new RegExp(`"${field}":"[^"]`));
        const answer = body.search(/"content":"[^"]/);
        expect(reasoning).toBeGreaterThan(-1);
        expect(reasoning).toBeLessThan(answer);
      }
    );

    it('reasoning-openrouter has SSE comment lines', () => {
      const body = readFixture('openai', 'reasoning-openrouter').body;
      expect(body).toMatch(/^: OPENROUTER PROCESSING$/m);
    });

    it('error is a 429 with retry-after and a JSON error body', () => {
      const f = readFixture('openai', 'error');
      expect(f.status).toBe(429);
      expect(f.headers['retry-after']).toBe('1');
      const err = json(f.body)['error'] as Record<string, unknown>;
      expect(err['code']).toBe('rate_limit_exceeded');
    });
  });

  describe('anthropic', () => {
    const types = (name: string) =>
      events(readFixture('anthropic', name).body).map(
        e => (JSON.parse(e.data) as AnthropicEvent).type
      );

    it.each(listFixtures('anthropic').filter(n => n !== 'error'))(
      '%s starts with message_start and ends with message_stop',
      name => {
        const t = types(name);
        expect(t[0]).toBe('message_start');
        expect(t.at(-1)).toBe('message_stop');
        expect(t.at(-2)).toBe('message_delta');
      }
    );

    it('tool-call has text, then one complete tool_use', () => {
      const f = readFixture('anthropic', 'tool-call');
      expect(f.body).toContain('"type":"text_delta"');
      expect(anthropicToolCalls(f)).toEqual([
        {
          id: 'toolu_01Qr7St9Uv1Wx3Yz5Ab7Cd9E',
          name: 'read_file',
          args: { path: 'solutions/main.cpp' },
        },
      ]);
      expect(f.body).toContain('"stop_reason":"tool_use"');
    });

    it('two-tool-calls has two tool_use blocks', () => {
      const calls = anthropicToolCalls(
        readFixture('anthropic', 'two-tool-calls')
      );
      expect(calls.map(c => [c.name, c.args])).toEqual([
        ['read_file', { path: 'Config.json' }],
        ['list_files', { dir: 'generators' }],
      ]);
    });

    it('reasoning has a thinking block with a signature, then text', () => {
      const body = readFixture('anthropic', 'reasoning').body;
      const thinking = body.indexOf('"type":"thinking_delta"');
      const signature = body.indexOf('"type":"signature_delta"');
      const text = body.indexOf('"type":"text_delta"');
      expect(thinking).toBeGreaterThan(-1);
      expect(thinking).toBeLessThan(signature);
      expect(signature).toBeLessThan(text);
    });

    it('error breaks the stream with an error event after some text', () => {
      const t = types('error');
      expect(t).toContain('content_block_delta');
      expect(t.at(-1)).toBe('error');
      expect(t).not.toContain('message_stop');
    });
  });
});

describe('parseFixture', () => {
  it('reads sources, notes, status, headers and the exact body', () => {
    const f = parseFixture(
      [
        '# source: https://example.com/docs',
        '# a note',
        'HTTP/2 201',
        'Content-Type: text/plain',
        'X-Thing:  a: b ',
        '',
        'line one\n\nline two\n',
      ].join('\n')
    );
    expect(f).toEqual({
      sources: ['https://example.com/docs'],
      notes: ['a note'],
      status: 201,
      headers: { 'content-type': 'text/plain', 'x-thing': 'a: b' },
      body: 'line one\n\nline two\n',
    });
  });

  it('accepts CRLF in the head and keeps the body as is', () => {
    const f = parseFixture('HTTP/1.1 200 OK\r\na: 1\r\n\r\ndata: x\r\n\r\n');
    expect(f.headers).toEqual({ a: '1' });
    expect(f.body).toBe('data: x\r\n\r\n');
  });

  it('fails without a status line', () => {
    expect(() => parseFixture('# source: x\ndata: x\n', 'f.http')).toThrow(
      /f\.http: expected an HTTP status line/
    );
  });

  it('fails without a blank line after the headers', () => {
    expect(() => parseFixture('HTTP/1.1 200 OK\na: 1')).toThrow(/blank line/);
  });

  it('fails on a bad header line', () => {
    expect(() => parseFixture('HTTP/1.1 200 OK\nnope\n\n')).toThrow(
      /bad header line/
    );
  });
});

describe('fixtureResponse', () => {
  it('plays the body, status and headers', async () => {
    const f = readFixture('openai', 'error');
    const res = fixtureResponse(f);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('1');
    expect(await res.text()).toBe(f.body);
  });

  it('sends the body in chunks of the given size', async () => {
    const f = readFixture('anthropic', 'text');
    const body = fixtureResponse(f, 7).body as ReadableStream<Uint8Array>;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const sizes: number[] = [];
    let text = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sizes.push(value.length);
      text += decoder.decode(value, { stream: true });
    }
    expect(text).toBe(f.body);
    expect(sizes.slice(0, -1).every(s => s === 7)).toBe(true);
    expect(sizes.length).toBeGreaterThan(1);
  });
});
