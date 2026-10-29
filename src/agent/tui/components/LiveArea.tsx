import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import {
  activityWord,
  formatSeconds,
  type ActivityContext,
} from '../activity.js';
import { tailLines } from '../layout.js';
import type { UiState } from '../store.js';
import { AssistantText } from './MessageView.js';
import { StarSpinner } from './Spinner.js';
import { ToolBlock } from './ToolBlock.js';

/** The last line of the reasoning, cut to fit one line. */
function lastLine(text: string): string {
  const lines = text.trim().split('\n');
  return lines[lines.length - 1] ?? '';
}

/** Milliseconds since the component was drawn first, every second. */
function useElapsed(): number {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now - start;
}

/**
 * `✶ Running tests… (12s · esc to interrupt)` and the last line of the
 * reasoning, if any. One line.
 */
export function WorkingLine({
  live,
  context = {},
}: {
  live: UiState['live'];
  context?: ActivityContext;
}) {
  // Drawn only while the agent works, so it counts from the turn start.
  const elapsed = useElapsed();
  const reasoning =
    live.runningTools.length === 0 && live.streamingText.trim().length === 0
      ? lastLine(live.reasoning)
      : '';
  return (
    <Box marginBottom={1}>
      <StarSpinner />
      <Text wrap="truncate-end">
        {' '}
        <Text bold>{activityWord(live, context)}</Text>
        <Text dimColor>
          {` (${formatSeconds(elapsed)} · esc to interrupt)`}
          {reasoning.length > 0 ? ` ${reasoning}` : ''}
        </Text>
      </Text>
    </Box>
  );
}

/**
 * The part that is redrawn: the answer while it streams, the running tools
 * with their last progress line, and the spinner line while the agent works.
 */
export function LiveArea({
  live,
  busy,
  maxLines = Infinity,
  width = 80,
  context = {},
}: {
  live: UiState['live'];
  busy: boolean;
  /** For the word of the spinner line. */
  context?: ActivityContext;
  /**
   * Most lines the streamed answer may use. A longer answer shows its end
   * only; the whole answer is printed when it is done.
   */
  maxLines?: number;
  /** The terminal width. */
  width?: number;
}) {
  const streaming = live.streamingText.trim();
  // Count at the width inside a code box (bullet, border and padding), so a
  // wrapped code line never takes more lines than we counted.
  const inner = width - 6;
  let tail = { text: streaming, hidden: 0 };
  if (Number.isFinite(maxLines)) {
    tail = tailLines(streaming, maxLines, inner);
    // One line for "lines above", one for the top of a code box opened again.
    if (tail.hidden > 0) {
      const room = tail.text.startsWith('```') ? 2 : 1;
      tail = tailLines(streaming, maxLines - room, inner);
      if (tail.text.startsWith('```') && room === 1) {
        tail = tailLines(streaming, maxLines - 2, inner);
      }
    }
  }
  return (
    <Box flexDirection="column">
      {tail.hidden > 0 && (
        <Text dimColor>{`  … ${tail.hidden} lines above`}</Text>
      )}
      {streaming.length > 0 && (
        <Box marginBottom={1}>
          <AssistantText text={tail.text} />
        </Box>
      )}
      {live.runningTools.map(t => (
        <Box key={t.callId} marginBottom={1}>
          <ToolBlock
            state="running"
            name={t.name}
            args={t.args}
            lastLine={t.lastLine}
          />
        </Box>
      ))}
      {busy && <WorkingLine live={live} context={context} />}
    </Box>
  );
}
