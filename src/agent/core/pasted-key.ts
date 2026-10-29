/**
 * Stops a pasted Polygon API key or secret before it goes to the model. The
 * chat UIs call {@link looksLikePolygonKey} on each message and show
 * {@link PASTED_KEY_NOTICE} instead of sending it.
 */

/** A Polygon key or secret: 40 hex characters, alone as a word. */
const HEX_40 = /(?<![0-9a-f])[0-9a-f]{40}(?![0-9a-f])/gi;

/** Words that say the text is about a key. */
const KEY_WORDS = /\b(key|secret|api)/i;

/** What the chat shows instead of sending a message with a key. */
export const PASTED_KEY_NOTICE =
  'That looks like a Polygon key. Do not paste keys in the chat. Run `polyman remote register <api-key> <secret>` in your terminal, then ask me to push.';

/**
 * True for a message that looks like it has a Polygon key: two 40-hex
 * tokens, or one when the text also talks about a key, secret or API. One
 * plain git sha alone does not match.
 */
export function looksLikePolygonKey(text: string): boolean {
  const tokens = text.match(HEX_40) ?? [];
  if (tokens.length >= 2) return true;
  return tokens.length === 1 && KEY_WORDS.test(text);
}
