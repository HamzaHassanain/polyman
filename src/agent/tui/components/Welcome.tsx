import os from 'node:os';
import { Box, Text } from 'ink';
import { border, fg, gradient, modelShortName } from '../theme.js';

/** "POLYMAN" in small block letters, 2 lines, 30 columns. */
export const WORDMARK = [
  '█▀█ █▀█ █   █▄█ █▀▄▀█ ▄▀█ █▄ █',
  '█▀▀ █▄█ █▄▄  █  █ ▀ █ █▀█ █ ▀█',
];

/** Under this width the wordmark is hidden. */
export const WORDMARK_MIN_COLUMNS = 60;

/** The widest the box gets. */
const MAX_WIDTH = 72;

export const TIPS = [
  'Describe a problem, the agent writes the files and the tests',
  'shift+tab switches between ask and auto-edit',
  '/help for the keys and commands',
];

/** `/home/me/problems/x` becomes `~/problems/x`. */
export function shortPath(dir: string, home = os.homedir()): string {
  if (home && (dir === home || dir.startsWith(`${home}/`))) {
    return `~${dir.slice(home.length)}`;
  }
  return dir;
}

/**
 * The box at the start of the chat, printed once: the wordmark, who is
 * talking, the folder, the model and 3 tips. It never gets wider than the
 * terminal; under 60 columns the wordmark is hidden.
 */
export function Welcome({
  folder,
  model,
  columns,
}: {
  folder: string;
  model: string;
  columns: number;
}) {
  const width = Math.max(20, Math.min(columns, MAX_WIDTH));
  const wordmark = columns >= WORDMARK_MIN_COLUMNS;
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      {...border('agent')}
      paddingX={1}
      width={width}
      marginBottom={1}
    >
      {wordmark && (
        <Box flexDirection="column" marginBottom={1}>
          {WORDMARK.map((line, i) => (
            <Text key={i}>{gradient(line)}</Text>
          ))}
        </Box>
      )}
      <Text wrap="truncate-end">
        {gradient('✦')} <Text bold>polyman chat</Text>
        <Text dimColor> · powered by {modelShortName(model)}</Text>
      </Text>
      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Text dimColor>{'folder '}</Text>
          <Text wrap="truncate-start">{shortPath(folder)}</Text>
        </Box>
        <Text wrap="truncate-end">
          <Text dimColor>{'model  '}</Text>
          {modelShortName(model)}
          <Text dimColor> (OpenRouter)</Text>
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>Tips</Text>
        {TIPS.map((tip, i) => (
          <Text key={i} wrap="truncate-end">
            <Text {...fg('agent')}>{`${i + 1}. `}</Text>
            {tip}
          </Text>
        ))}
      </Box>
    </Box>
  );
}
