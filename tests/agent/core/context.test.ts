import { describe, it, expect } from 'vitest';
import {
  CONTEXT_REMOVED_NOTE,
  estimateTokens,
  trimContext,
} from '../../../src/agent/core/context';
import type { Message } from '../../../src/agent/core/messages';

const AT = '2026-10-26T00:00:00.000Z';
let ids = 0;

function msg(role: Message['role'], parts: Message['parts']): Message {
  ids += 1;
  return { id: `m${ids}`, role, parts, createdAt: AT };
}

/** One user turn: a question, a tool call, its result and an answer. */
function turn(n: number, resultChars: number): Message[] {
  return [
    msg('user', [{ type: 'text', text: `question ${n}` }]),
    msg('assistant', [
      { type: 'tool_call', id: `c${n}`, name: 'read_file', args: { n } },
    ]),
    msg('tool', [
      {
        type: 'tool_result',
        callId: `c${n}`,
        content: `result ${n}\n${'x'.repeat(resultChars)}`,
        isError: false,
      },
    ]),
    msg('assistant', [{ type: 'text', text: `answer ${n}` }]),
  ];
}

function history(results: number[]): Message[] {
  return results.flatMap((chars, i) => turn(i + 1, chars));
}

/** Every tool call has its result, and every result has its call. */
function expectPairsKept(messages: Message[]): void {
  const calls = new Set<string>();
  const results = new Set<string>();
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type === 'tool_call') calls.add(p.id);
      if (p.type === 'tool_result') results.add(p.callId);
    }
  }
  expect([...results].sort()).toEqual([...calls].sort());
}

function toolContents(messages: Message[]): string[] {
  return messages.flatMap(m =>
    m.parts.flatMap(p => (p.type === 'tool_result' ? [p.content] : []))
  );
}

describe('estimateTokens', () => {
  it('counts system and all parts as chars / 4', () => {
    const messages = [msg('user', [{ type: 'text', text: 'abcd' }])];
    expect(estimateTokens(messages, 'abcde')).toBe(3);
  });
});

describe('trimContext', () => {
  it('returns the same messages when under budget', () => {
    const messages = history([10, 10]);
    expect(trimContext(messages, 10_000, 'system')).toBe(messages);
  });

  it('shortens old tool results first, oldest first', () => {
    const messages = history([4000, 4000, 100, 100, 100, 100]);
    const before = JSON.stringify(messages);
    const total = estimateTokens(messages, '');
    // Cutting the first big result is enough.
    const out = trimContext(messages, total - 900, '');

    expect(out).toHaveLength(messages.length);
    const contents = toolContents(out);
    expect(contents[0]).toBe('[old result removed: result 1]');
    expect(contents[1]).toBe(
      messages[6]?.parts[0]?.type === 'tool_result'
        ? messages[6].parts[0].content
        : ''
    );
    expect(estimateTokens(out, '')).toBeLessThanOrEqual(total - 900);
    // The history itself is not changed.
    expect(JSON.stringify(messages)).toBe(before);
  });

  it('never touches the last 4 user turns', () => {
    const messages = history([100, 100, 4000, 4000, 4000, 4000]);
    // Cutting both old results (about 80 chars each) is just enough.
    const out = trimContext(messages, estimateTokens(messages, '') - 30, '');

    const last16 = messages.slice(-16);
    expect(out.slice(-16)).toEqual(last16);
    expect(toolContents(out.slice(0, -16))).toEqual([
      '[old result removed: result 1]',
      '[old result removed: result 2]',
    ]);
  });

  it('drops the oldest whole turns when shortening is not enough', () => {
    const messages = history([50, 50, 50, 50, 50, 50]);
    const lastFour = messages.slice(-16);
    const budget = estimateTokens(lastFour, 'sys') + 20;
    const out = trimContext(messages, budget, 'sys');

    expect(out[0]).toMatchObject({
      role: 'user',
      parts: [{ type: 'text', text: CONTEXT_REMOVED_NOTE }],
    });
    expect(out.slice(1)).toEqual(lastFour);
    expectPairsKept(out);
  });

  it('keeps the last 4 turns even when they alone are over budget', () => {
    const messages = history([5000, 5000, 5000, 5000, 5000]);
    const out = trimContext(messages, 100, '');

    expect(out[0]?.parts[0]).toEqual({
      type: 'text',
      text: CONTEXT_REMOVED_NOTE,
    });
    expect(out.slice(1)).toEqual(messages.slice(-16));
    expectPairsKept(out);
  });

  it('never splits a tool call from its result', () => {
    // Turns with several tool steps each, trimmed at many budgets.
    const messages: Message[] = [];
    for (let n = 1; n <= 7; n++) {
      messages.push(msg('user', [{ type: 'text', text: `q${n}` }]));
      for (let s = 1; s <= 3; s++) {
        const id = `c${n}_${s}`;
        messages.push(
          msg('assistant', [
            { type: 'tool_call', id, name: 'verify', args: { s } },
          ])
        );
        messages.push(
          msg('tool', [
            {
              type: 'tool_result',
              callId: id,
              content: 'y'.repeat(300 * s),
              isError: false,
            },
          ])
        );
      }
    }
    const total = estimateTokens(messages, '');
    for (let budget = 0; budget <= total; budget += 97) {
      const out = trimContext(messages, budget, '');
      expectPairsKept(out);
      for (let i = 0; i < out.length; i++) {
        const m = out[i];
        if (m?.role === 'tool') {
          expect(out[i - 1]?.role).not.toBe('user');
        }
      }
    }
  });

  it('does not count messages before the first user turn as kept', () => {
    const lead = msg('assistant', [{ type: 'text', text: 'z'.repeat(4000) }]);
    const rest = history([10, 10]);
    const out = trimContext([lead, ...rest], 100, '');
    expect(out[0]?.parts[0]).toEqual({
      type: 'text',
      text: CONTEXT_REMOVED_NOTE,
    });
    expect(out.slice(1)).toEqual(rest);
  });
});
