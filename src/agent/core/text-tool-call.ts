/**
 * Finds a tool call the model wrote as text instead of using the tool call
 * format. Gemma does this sometimes; the session then asks it to use the
 * format.
 */

/** `"name": "verify"`, a JSON object field when a `{` comes before it. */
const JSON_NAME = /"name"\s*:\s*"([^"]+)"/g;

/** A line like `verify({...})`, maybe inside a list or a code span. */
const CALL_LINE = /^[\s`>*-]*([A-Za-z_][\w.-]*)\s*\(\s*\{/gm;

/**
 * Returns the tool name when `text` has a JSON object with
 * `"name": "<known tool>"`, or a line like `verify({...})` with a known tool
 * name. Returns null otherwise.
 */
export function findTextToolCall(
  text: string,
  toolNames: readonly string[]
): string | null {
  if (toolNames.length === 0) return null;
  const known = new Set(toolNames);
  for (const match of text.matchAll(JSON_NAME)) {
    const name = match[1];
    const inObject = text.lastIndexOf('{', match.index) !== -1;
    if (name !== undefined && inObject && known.has(name)) return name;
  }
  for (const match of text.matchAll(CALL_LINE)) {
    const name = match[1];
    if (name !== undefined && known.has(name)) return name;
  }
  return null;
}
