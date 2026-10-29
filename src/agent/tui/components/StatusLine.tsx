import { Text } from 'ink';
import type { UiState } from '../store.js';
import {
  formatCost,
  formatTokens,
  modelShortName,
  noColor,
  pill,
  PILLS,
} from '../theme.js';

/**
 * The last line: the problem, then mode, model, tokens and cost as colored
 * pills, and a hint. Without colors the parts are joined with ` · `.
 */
export function StatusLine({
  status,
  hint,
}: {
  status: UiState['status'];
  /** Replaces the end of the line, like "press ctrl+c again to exit". */
  hint?: string | null;
}) {
  const problem = status.problem ?? 'new problem';
  const model = modelShortName(status.model);
  const tokens = `${formatTokens(status.tokens)} tok`;
  const cost = formatCost(status.costUsd);
  if (noColor()) {
    const parts = [problem, `${status.mode} mode (shift+tab)`, model, tokens];
    parts.push(cost);
    if (hint) parts.push(hint);
    return (
      <Text dimColor wrap="truncate-end">
        {' '}
        {parts.join(' · ')}
      </Text>
    );
  }
  return (
    <Text wrap="truncate-end">
      <Text dimColor> {problem} </Text>
      <Text {...pill(PILLS[status.mode])} bold>
        {` ${status.mode} `}
      </Text>
      <Text dimColor> shift+tab </Text>
      <Text {...pill(PILLS.model)}>{` ${model} `}</Text>{' '}
      <Text {...pill(PILLS.tokens)}>{` ${tokens} `}</Text>{' '}
      <Text {...pill(PILLS.cost)}>{` ${cost} `}</Text>
      {hint && <Text dimColor>{`  ${hint}`}</Text>}
    </Text>
  );
}
