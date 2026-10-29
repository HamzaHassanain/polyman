import { Text } from 'ink';
import { verdictStyle } from '../theme.js';

/** The solution tags and verdicts we color in tool results. */
const VERDICT = /\b(MA|OK|WA|TL|TO|ML|RE|PE|RJ)\b/;

/**
 * A line with each verdict word in its color (OK green, WA red, TL amber,
 * TO cyan, MA bold green). The other words are dim when `dim` is set.
 */
export function VerdictLine({ text, dim }: { text: string; dim: boolean }) {
  // split() with a group keeps the verdicts at the odd places.
  const parts = text.split(new RegExp(VERDICT.source, 'g'));
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Text key={i} {...verdictStyle(part)}>
            {part}
          </Text>
        ) : (
          <Text key={i} dimColor={dim}>
            {part}
          </Text>
        )
      )}
    </>
  );
}
