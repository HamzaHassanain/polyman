import { describe, it, expect } from 'vitest';
import { AgentSession, summaryOf } from '../../../src/agent/core/session';
import type { Message } from '../../../src/agent/core/messages';
import { MockProvider } from '../../../src/agent/providers/mock';
import {
  ProviderError,
  type ChatRequest,
  type Provider,
  type StreamEvent,
} from '../../../src/agent/providers/types';
import { FakePermissions, FakeTools, makeDeps, textTool } from './fakes';

function lastMessage(req: ChatRequest | undefined): Message | undefined {
  return req?.messages[req.messages.length - 1];
}

describe('AgentSession', () => {
  it('runs a plain text turn and emits events in order', async () => {
    const provider = new MockProvider([
      {
        reasoning: 'think',
        text: 'hello',
        usage: { inputTokens: 10, outputTokens: 2 },
      },
    ]);
    const deps = makeDeps(provider);
    const session = new AgentSession(deps);

    expect(await session.send('hi')).toBe('done');

    expect(deps.events.map(e => e.type)).toEqual([
      'turn_start',
      'reasoning_delta',
      'text_delta',
      'usage',
      'turn_end',
    ]);
    const seqs = deps.events.map(e => e.seq);
    expect(seqs).toEqual([1, 2, 3, 4, 5]);
    const start = deps.events[0];
    const end = deps.events[4];
    expect(start?.type === 'turn_start' && end?.type === 'turn_end').toBe(true);
    if (start?.type === 'turn_start' && end?.type === 'turn_end') {
      expect(end.turnId).toBe(start.turnId);
      expect(end.reason).toBe('done');
      expect(end.error).toBeUndefined();
    }
    expect(session.messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(session.messages[1]?.parts).toEqual([
      { type: 'reasoning', text: 'think' },
      { type: 'text', text: 'hello' },
    ]);

    const req = provider.requests[0];
    expect(req?.system).toBe('You build problems.');
    expect(req?.model).toBe('mock-model');
    expect(req?.maxOutputTokens).toBe(8000);
    expect(req?.temperature).toBe(0.3);
  });

  it('runs a tool and shows the result to the next model call', async () => {
    const provider = new MockProvider([
      { toolCall: { id: 'c1', name: 'read_file', args: { path: 'a' } } },
      { text: 'the file says hi' },
    ]);
    const tools = new FakeTools(
      { read_file: textTool('hi\nsecond line') },
      { read_file: 'read' }
    );
    const deps = makeDeps(provider, tools);
    const session = new AgentSession(deps);

    expect(await session.send('read a')).toBe('done');

    expect(tools.calls).toEqual([
      { id: 'c1', name: 'read_file', args: { path: 'a' } },
    ]);
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[0]?.tools.map(t => t.name)).toEqual(['read_file']);
    expect(lastMessage(provider.requests[1])).toMatchObject({
      role: 'tool',
      parts: [
        {
          type: 'tool_result',
          callId: 'c1',
          content: 'hi\nsecond line',
          isError: false,
        },
      ],
    });
    expect(deps.events.map(e => e.type)).toEqual([
      'turn_start',
      'tool_call',
      'tool_result',
      'text_delta',
      'turn_end',
    ]);
    expect(deps.events[1]).toMatchObject({
      type: 'tool_call',
      callId: 'c1',
      name: 'read_file',
      risk: 'read',
    });
    expect(deps.events[2]).toMatchObject({
      type: 'tool_result',
      callId: 'c1',
      ok: true,
      summary: 'hi (+1 line)',
    });
    expect(session.messages.map(m => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
  });

  it('gives unknown tools the read risk and passes argsError', async () => {
    const calls: Array<{ id: string; argsError?: string }> = [];
    const provider: Provider = {
      id: 'broken-args',
      // eslint-disable-next-line @typescript-eslint/require-await
      async *stream(req: ChatRequest): AsyncIterable<StreamEvent> {
        if (req.messages.length === 1) {
          yield {
            type: 'tool_call',
            id: 'c1',
            name: 'mystery',
            args: '{bad',
            argsError: 'not valid JSON',
          };
        } else {
          yield { type: 'text_delta', text: 'ok' };
        }
        yield { type: 'done', stopReason: 'end' };
      },
    };
    const tools = new FakeTools({});
    const deps = makeDeps(provider, tools);
    const session = new AgentSession(deps);

    expect(await session.send('go')).toBe('done');
    calls.push(...tools.calls);
    expect(calls[0]).toMatchObject({ id: 'c1', argsError: 'not valid JSON' });
    expect(deps.events[1]).toMatchObject({ type: 'tool_call', risk: 'read' });
    expect(deps.events[2]).toMatchObject({ type: 'tool_result', ok: false });
  });

  it('runs two tool calls of one step in order, not in parallel', async () => {
    const log: string[] = [];
    const slow = (args: unknown) => {
      const { n } = args as { n: number };
      log.push(`start ${n}`);
      return new Promise<{ content: string }>(resolve =>
        setTimeout(() => {
          log.push(`end ${n}`);
          resolve({ content: `done ${n}` });
        }, 10)
      );
    };
    const provider = new MockProvider([
      {
        toolCalls: [
          { name: 'work', args: { n: 1 } },
          { name: 'work', args: { n: 2 } },
        ],
      },
      { text: 'both done' },
    ]);
    const session = new AgentSession(
      makeDeps(provider, new FakeTools({ work: slow }))
    );

    expect(await session.send('work twice')).toBe('done');
    expect(log).toEqual(['start 1', 'end 1', 'start 2', 'end 2']);
    expect(session.messages.map(m => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'tool',
      'assistant',
    ]);
  });

  it('stops with max_steps after exactly maxSteps model calls', async () => {
    const provider = new MockProvider([
      { toolCall: { name: 'verify', args: { round: 1 } } },
      { toolCall: { name: 'verify', args: { round: 2 } } },
      { toolCall: { name: 'verify', args: { round: 3 } } },
    ]);
    const deps = makeDeps(
      provider,
      new FakeTools({ verify: textTool('FAIL') }),
      { maxSteps: 3 }
    );
    const session = new AgentSession(deps);

    expect(await session.send('fix it')).toBe('max_steps');
    expect(provider.requests).toHaveLength(3);
    expect(provider.remaining).toBe(0);
    const last = session.messages[session.messages.length - 1];
    expect(last?.role).toBe('assistant');
    expect(last?.parts).toEqual([
      { type: 'text', text: 'Stopped after 3 steps. Say "continue" to go on.' },
    ]);
    expect(deps.events[deps.events.length - 1]).toMatchObject({
      type: 'turn_end',
      reason: 'max_steps',
    });
  });

  it('does not run the 3rd identical call', async () => {
    let runs = 0;
    const provider = new MockProvider([
      { toolCall: { name: 'verify', args: { all: true } } },
      { toolCall: { name: 'verify', args: { all: true } } },
      { toolCall: { name: 'verify', args: { all: true } } },
      { text: 'I will ask the user' },
    ]);
    const tools = new FakeTools({
      verify: () => {
        runs += 1;
        return Promise.resolve({ content: `FAIL run ${runs}` });
      },
    });
    const deps = makeDeps(provider, tools);
    const session = new AgentSession(deps);

    expect(await session.send('verify')).toBe('done');
    expect(runs).toBe(2);
    expect(lastMessage(provider.requests[3])).toMatchObject({
      role: 'tool',
      parts: [
        {
          type: 'tool_result',
          content:
            'You already called verify with these arguments 2 times. The result was: FAIL run 2. Try something else or ask the user.',
          isError: true,
        },
      ],
    });
    expect(deps.events.filter(e => e.type === 'tool_call')).toHaveLength(2);
  });

  it('lets the same run again after a write changed the files', async () => {
    let runs = 0;
    let writes = 0;
    const verify = { toolCall: { name: 'verify', args: {} } };
    const write = {
      toolCall: { name: 'write_file', args: { path: 'a', content: 'x' } },
    };
    const provider = new MockProvider([
      verify,
      verify,
      write,
      verify,
      write,
      write,
      { text: 'done' },
    ]);
    const tools = new FakeTools(
      {
        verify: () => {
          runs += 1;
          return Promise.resolve({ content: `run ${runs}` });
        },
        write_file: () => {
          writes += 1;
          return Promise.resolve({ content: 'wrote a' });
        },
      },
      { verify: 'run', write_file: 'write' }
    );
    const session = new AgentSession(makeDeps(provider, tools));

    expect(await session.send('fix it')).toBe('done');
    // The 3rd verify runs because a write came before it.
    expect(runs).toBe(3);
    // Identical writes are still counted: the 3rd one is blocked.
    expect(writes).toBe(2);
  });

  it('asks again when the model writes a tool call as text', async () => {
    const provider = new MockProvider([
      { text: 'I will run it: {"name": "verify", "arguments": {}}' },
      { text: 'sorry, done' },
    ]);
    const session = new AgentSession(
      makeDeps(provider, new FakeTools({ verify: textTool('OK') }))
    );

    expect(await session.send('verify please')).toBe('done');
    expect(provider.requests).toHaveLength(2);
    expect(lastMessage(provider.requests[1])).toMatchObject({
      role: 'user',
      parts: [
        {
          type: 'text',
          text: 'Use the tool call format to call verify, do not write it as text.',
        },
      ],
    });
  });

  it('cancels during a slow tool, then a new send works', async () => {
    let sawAbort = false;
    let started!: () => void;
    const toolStarted = new Promise<void>(resolve => (started = resolve));
    const provider = new MockProvider([
      { toolCall: { name: 'slow', args: {} } },
      { text: 'fresh answer' },
    ]);
    const tools = new FakeTools({
      slow: (_args, ctx) =>
        new Promise(resolve => {
          ctx.signal.addEventListener('abort', () => {
            sawAbort = true;
            resolve({ content: 'stopped', isError: true });
          });
          started();
        }),
    });
    const deps = makeDeps(provider, tools);
    const session = new AgentSession(deps);

    const turn = session.send('run slow');
    await toolStarted;
    session.cancel();

    expect(await turn).toBe('cancelled');
    expect(sawAbort).toBe(true);
    const ends = deps.events.filter(e => e.type === 'turn_end');
    expect(ends).toHaveLength(1);
    expect(ends[0]).toMatchObject({ reason: 'cancelled' });
    // The aborted step left nothing: no tool call without its result.
    expect(session.messages.map(m => m.role)).toEqual(['user']);

    expect(await session.send('again')).toBe('done');
    expect(session.messages.map(m => m.role)).toEqual([
      'user',
      'user',
      'assistant',
    ]);
  });

  it('cancels during the model stream', async () => {
    let streaming!: () => void;
    const isStreaming = new Promise<void>(resolve => (streaming = resolve));
    const provider: Provider = {
      id: 'hangs',
      async *stream(_req, signal): AsyncIterable<StreamEvent> {
        yield { type: 'text_delta', text: 'part' };
        streaming();
        await new Promise((_resolve, reject) =>
          signal.addEventListener('abort', () =>
            reject(new Error('stream aborted'))
          )
        );
      },
    };
    const deps = makeDeps(provider);
    const session = new AgentSession(deps);

    const turn = session.send('hi');
    await isStreaming;
    session.cancel();

    expect(await turn).toBe('cancelled');
    expect(session.messages.map(m => m.role)).toEqual(['user']);
    expect(deps.events[deps.events.length - 1]).toMatchObject({
      type: 'turn_end',
      reason: 'cancelled',
    });
  });

  it('ends with error on a provider error and redacts the key', async () => {
    const secret = 'topsecretvalue99';
    const provider = new MockProvider([
      { error: new ProviderError('auth', `invalid key ${secret}`) },
      { text: 'works now' },
    ]);
    const deps = makeDeps(provider, undefined, { secrets: () => [secret] });
    const session = new AgentSession(deps);

    expect(await session.send('hi')).toBe('error');
    const end = deps.events[deps.events.length - 1];
    expect(end).toMatchObject({ type: 'turn_end', reason: 'error' });
    const error = end?.type === 'turn_end' ? end.error : undefined;
    expect(error).toContain('invalid key');
    expect(error).not.toContain(secret);
    expect(deps.events.filter(e => e.type === 'turn_end')).toHaveLength(1);

    // The session stays usable.
    expect(await session.send('again')).toBe('done');
  });

  it('ends with error when something else throws', async () => {
    const deps = makeDeps(new MockProvider([]), undefined, {
      buildSystemPrompt: () => Promise.reject(new Error('no prompt')),
    });
    const session = new AgentSession(deps);

    expect(await session.send('hi')).toBe('error');
    expect(deps.events[deps.events.length - 1]).toMatchObject({
      type: 'turn_end',
      reason: 'error',
      error: 'no prompt',
    });
  });

  it('throws when send is called during a turn', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    const provider = new MockProvider([
      { toolCall: { name: 'wait', args: {} } },
      { text: 'done' },
    ]);
    const tools = new FakeTools({
      wait: () => gate.then(() => ({ content: 'ok' })),
    });
    const session = new AgentSession(makeDeps(provider, tools));

    const turn = session.send('first');
    await expect(session.send('second')).rejects.toThrow(
      'a turn is already running'
    );
    release();
    expect(await turn).toBe('done');
  });

  it('passes approvals to the permission gate', () => {
    const permissions = new FakePermissions();
    const session = new AgentSession(
      makeDeps(new MockProvider([]), undefined, { permissions })
    );
    session.resolveApproval('a1', { kind: 'deny', reason: 'no' });
    expect(permissions.resolved).toEqual([{ id: 'a1', kind: 'deny' }]);
  });
});

describe('summaryOf', () => {
  it('keeps a one-line result as it is', () => {
    expect(summaryOf('wrote solutions/main.cpp\n')).toBe(
      'wrote solutions/main.cpp'
    );
  });

  it('says how many lines are left after the first one', () => {
    expect(summaryOf('Config.json\nsolutions/\nvalidator/\n')).toBe(
      'Config.json (+2 lines)'
    );
    expect(summaryOf('a\nb')).toBe('a (+1 line)');
  });

  it('cuts a long first line', () => {
    const out = summaryOf(`${'x'.repeat(300)}\nmore`);
    expect(out).toBe(`${'x'.repeat(120)} (+1 line)`);
  });
});
