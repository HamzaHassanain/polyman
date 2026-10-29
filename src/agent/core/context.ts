/**
 * Keeps the messages sent to the model under the context budget. The history
 * itself is never changed: the session trims a copy before each model call.
 */

import type { ContentPart, Message } from './messages';

/** User turns at the end that are never shortened or dropped. */
const KEEP_TURNS = 4;

/** The first message after old turns were dropped. */
export const CONTEXT_REMOVED_NOTE =
  '[earlier conversation removed to fit the context]';

const REMOVED_PREFIX = '[old result removed: ';

/** Rough token count of a prompt: `ceil(chars / 4)`. */
export function estimateTokens(
  messages: readonly Message[],
  system: string
): number {
  let chars = system.length;
  for (const m of messages) chars += messageChars(m);
  return Math.ceil(chars / 4);
}

/**
 * Returns the messages to send so they fit in `budgetTokens`, with the
 * system prompt counted:
 *
 * 1. Under budget: the same array.
 * 2. Else, from the oldest, tool results are cut to one short line.
 * 3. Still over: the oldest whole turns are dropped, and a note goes first.
 *
 * The last 4 user turns (a user message and everything after it until the
 * next one) are never touched. Whole turns are dropped, so a tool call is
 * never split from its result.
 */
export function trimContext(
  messages: Message[],
  budgetTokens: number,
  system: string
): Message[] {
  let chars = system.length;
  for (const m of messages) chars += messageChars(m);
  const fits = (): boolean => Math.ceil(chars / 4) <= budgetTokens;
  if (fits()) return messages;

  const turns = splitTurns(messages);
  const keepFrom = keptTurnsStart(turns);

  // 1. Cut old tool results, oldest first.
  for (let t = 0; t < keepFrom; t++) {
    const turn = turns[t] ?? [];
    for (let i = 0; i < turn.length; i++) {
      const msg = turn[i];
      if (msg === undefined) continue;
      for (let p = 0; p < msg.parts.length; p++) {
        const part = msg.parts[p];
        if (part?.type !== 'tool_result') continue;
        if (part.content.startsWith(REMOVED_PREFIX)) continue;
        const short = `${REMOVED_PREFIX}${firstLine(part.content, 100)}]`;
        if (short.length >= part.content.length) continue;
        chars -= part.content.length - short.length;
        const parts = [...msg.parts];
        parts[p] = { ...part, content: short };
        turn[i] = { ...msg, parts };
        if (fits()) return turns.flat();
      }
    }
  }

  // 2. Drop the oldest whole turns.
  let dropped = 0;
  chars += CONTEXT_REMOVED_NOTE.length;
  while (dropped < keepFrom && !fits()) {
    for (const m of turns[dropped] ?? []) chars -= messageChars(m);
    dropped += 1;
  }
  if (dropped === 0) return turns.flat();
  const kept = turns.slice(dropped).flat();
  const note: Message = {
    id: 'context-removed',
    role: 'user',
    parts: [{ type: 'text', text: CONTEXT_REMOVED_NOTE }],
    createdAt: messages[0]?.createdAt ?? new Date(0).toISOString(),
  };
  return [note, ...kept];
}

/** Splits messages into turns. Messages before the first user one are a turn. */
function splitTurns(messages: readonly Message[]): Message[][] {
  const turns: Message[][] = [];
  for (const m of messages) {
    const last = turns[turns.length - 1];
    if (m.role === 'user' || last === undefined) turns.push([m]);
    else last.push(m);
  }
  return turns;
}

/** Index of the first of the last {@link KEEP_TURNS} user turns. */
function keptTurnsStart(turns: readonly Message[][]): number {
  let userTurns = 0;
  for (let t = turns.length - 1; t >= 0; t--) {
    if (turns[t]?.[0]?.role !== 'user') continue;
    userTurns += 1;
    if (userTurns === KEEP_TURNS) return t;
  }
  // Fewer user turns than kept: only messages before the first user turn
  // may go.
  return turns[0]?.[0]?.role === 'user' ? 0 : Math.min(1, turns.length);
}

function messageChars(m: Message): number {
  let chars = 0;
  for (const p of m.parts) chars += partChars(p);
  return chars;
}

function partChars(p: ContentPart): number {
  switch (p.type) {
    case 'text':
    case 'reasoning':
      return p.text.length;
    case 'tool_call':
      return p.name.length + (JSON.stringify(p.args) ?? '').length;
    case 'tool_result':
      return p.content.length;
  }
}

function firstLine(text: string, max: number): string {
  return (text.split('\n')[0] ?? '').trim().slice(0, max);
}
