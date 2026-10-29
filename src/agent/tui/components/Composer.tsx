import { useRef } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';
import {
  backspace,
  editorOf,
  enter,
  insert,
  move,
  type EditorState,
  type History,
} from '../editor.js';
import { windowOf } from '../layout.js';

/**
 * The part of a long input that fits in `maxLines` lines, around the line
 * of the cursor, and how many lines are hidden.
 */
export function visibleInput(
  value: EditorState,
  maxLines: number
): { state: EditorState; hidden: number } {
  const lines = value.text.split('\n');
  if (lines.length <= maxLines) return { state: value, hidden: 0 };
  const cursorLine = value.text.slice(0, value.cursor).split('\n').length - 1;
  // One line says how many lines are hidden.
  const { start, end } = windowOf(
    lines.length,
    Math.max(1, maxLines - 1),
    cursorLine
  );
  let offset = 0;
  for (let i = 0; i < start; i++) offset += (lines[i] ?? '').length + 1;
  const text = lines.slice(start, end).join('\n');
  const cursor = Math.max(0, Math.min(text.length, value.cursor - offset));
  return { state: { text, cursor }, hidden: lines.length - (end - start) };
}

/** Draws the text with the cursor as an inverse cell. */
function TextWithCursor({
  state,
  focus,
}: {
  state: EditorState;
  focus: boolean;
}) {
  const before = state.text.slice(0, state.cursor);
  const at = state.text[state.cursor];
  const after = state.text.slice(state.cursor + 1);
  if (!focus) return <Text>{state.text}</Text>;
  return (
    <Text>
      {before}
      {at === undefined || at === '\n' ? (
        <Text inverse> </Text>
      ) : (
        <Text inverse>{at}</Text>
      )}
      {at === '\n' ? '\n' : ''}
      {after}
    </Text>
  );
}

/**
 * The input between two lines. `enter` sends, `ctrl+j` or `\` + `enter`
 * adds a new line, `up` / `down` walk the history when the input is empty.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  history,
  isActive = true,
  maxLines = Infinity,
}: {
  value: EditorState;
  onChange: (s: EditorState) => void;
  onSubmit: (text: string) => void;
  history: History;
  isActive?: boolean;
  /** Most lines of the input text. A longer input shows the cursor part. */
  maxLines?: number;
}) {
  const { stdout } = useStdout();
  const width = Math.max(10, (stdout.columns || 80) - 1);
  // Keys can come faster than React renders: read and write the newest value.
  const current = useRef(value);
  current.current = value;
  const update = (next: EditorState) => {
    current.current = next;
    onChange(next);
  };

  useInput(
    (input, key) => {
      const value = current.current;
      // App handles ctrl+c, esc and shift+tab.
      if (key.escape || (key.ctrl && input === 'c') || key.tab) return;

      if (key.return) {
        if (key.shift || key.meta) {
          update(insert(value, '\n'));
          return;
        }
        const result = enter(value);
        if (result.kind === 'newline') {
          update(result.state);
        } else {
          onSubmit(result.text);
        }
        return;
      }
      if (key.upArrow) {
        if (value.text.length === 0 || history.walking) {
          const older = history.up();
          if (older !== null) update(editorOf(older));
        }
        return;
      }
      if (key.downArrow) {
        if (history.walking) {
          const newer = history.down();
          if (newer !== null) update(editorOf(newer));
        }
        return;
      }
      if (key.leftArrow) {
        update(move(value, -1));
        return;
      }
      if (key.rightArrow) {
        update(move(value, 1));
        return;
      }
      if (key.backspace || key.delete) {
        history.reset();
        update(backspace(value));
        return;
      }
      if (key.ctrl || input.length === 0) return;
      // Typed text, a paste, or ctrl+j (it arrives as "\n").
      history.reset();
      update(insert(value, input));
    },
    { isActive }
  );

  const line = '─'.repeat(width);
  const empty = value.text.length === 0;
  const visible = visibleInput(value, maxLines);
  return (
    <Box flexDirection="column">
      <Text dimColor>{line}</Text>
      <Box>
        <Box width={2} flexShrink={0}>
          <Text>{'>'}</Text>
        </Box>
        <Box flexGrow={1}>
          {empty && isActive ? (
            <Text>
              <Text inverse> </Text>
              <Text dimColor>Type a message, /help for commands</Text>
            </Text>
          ) : (
            <TextWithCursor state={visible.state} focus={isActive} />
          )}
        </Box>
      </Box>
      {visible.hidden > 0 && (
        <Text dimColor>{`  … ${visible.hidden} more lines`}</Text>
      )}
      <Text dimColor>{line}</Text>
    </Box>
  );
}
