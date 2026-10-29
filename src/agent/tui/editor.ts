/**
 * The text of the input box and its cursor, with pure editing functions.
 * `Composer.tsx` maps keys to them.
 */

/** The input text and the cursor position (an index into `text`). */
export interface EditorState {
  text: string;
  cursor: number;
}

export const EMPTY_EDITOR: EditorState = { text: '', cursor: 0 };

/** Puts the cursor at the end of `text`. */
export function editorOf(text: string): EditorState {
  return { text, cursor: text.length };
}

/** Inserts text at the cursor. Pasted `\r\n` and `\r` become `\n`. */
export function insert(s: EditorState, input: string): EditorState {
  const clean = input.replace(/\r\n?/g, '\n');
  return {
    text: s.text.slice(0, s.cursor) + clean + s.text.slice(s.cursor),
    cursor: s.cursor + clean.length,
  };
}

/** Deletes the character before the cursor. */
export function backspace(s: EditorState): EditorState {
  if (s.cursor === 0) return s;
  return {
    text: s.text.slice(0, s.cursor - 1) + s.text.slice(s.cursor),
    cursor: s.cursor - 1,
  };
}

/** Moves the cursor left or right. */
export function move(s: EditorState, delta: number): EditorState {
  const cursor = Math.max(0, Math.min(s.text.length, s.cursor + delta));
  return { ...s, cursor };
}

/**
 * Enter: with a `\` just before the cursor it becomes a new line, else the
 * text is ready to send.
 */
export function enter(
  s: EditorState
): { kind: 'newline'; state: EditorState } | { kind: 'send'; text: string } {
  if (s.cursor > 0 && s.text[s.cursor - 1] === '\\') {
    const state = insert(backspace(s), '\n');
    return { kind: 'newline', state };
  }
  return { kind: 'send', text: s.text };
}

/** Walks the sent messages with up and down, when the input is empty. */
export class History {
  private readonly items: string[] = [];
  /** The index while walking, or null when not walking. */
  private index: number | null = null;

  /** Adds a sent message and stops walking. */
  add(text: string): void {
    if (text.trim().length > 0 && this.items[this.items.length - 1] !== text) {
      this.items.push(text);
    }
    this.index = null;
  }

  /** Stops walking (the user typed). */
  reset(): void {
    this.index = null;
  }

  /** True while the user walks the history. */
  get walking(): boolean {
    return this.index !== null;
  }

  /** The older message, or null when there is none. */
  up(): string | null {
    if (this.items.length === 0) return null;
    const next = this.index === null ? this.items.length - 1 : this.index - 1;
    if (next < 0) return null;
    this.index = next;
    return this.items[next] ?? null;
  }

  /** The newer message, or '' after the newest one. */
  down(): string | null {
    if (this.index === null) return null;
    const next = this.index + 1;
    if (next >= this.items.length) {
      this.index = null;
      return '';
    }
    this.index = next;
    return this.items[next] ?? null;
  }
}
