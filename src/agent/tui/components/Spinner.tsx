import { useEffect, useState } from 'react';
import { Text } from 'ink';
import { fg, gradientStops, noColor, type ColorName } from '../theme.js';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/** The ✦ grows and shrinks, like the Claude Code spinner. */
export const STAR_FRAMES = ['·', '✢', '✳', '✶', '✦', '✶', '✳', '✢'];

/** The star colors: blue to violet and back. */
const STAR_COLORS = (() => {
  const up = gradientStops(STAR_FRAMES.length / 2 + 1);
  return [...up, ...up.slice(1, -1).reverse()];
})();

/** The frame number now, updated every `ms`. */
function useFrame(n: number, ms: number): number {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame(f => (f + 1) % n), ms);
    return () => clearInterval(timer);
  }, [n, ms]);
  return frame;
}

/** A small spinner for the running tasks of the workflow tree. */
export function Spinner({ color = 'agent' }: { color?: ColorName }) {
  const frame = useFrame(FRAMES.length, 80);
  return <Text {...fg(color)}>{FRAMES[frame]}</Text>;
}

/** The chat spinner: a ✦ that grows and moves over the gradient. */
export function StarSpinner() {
  const frame = useFrame(STAR_FRAMES.length, 120);
  const color = STAR_COLORS[frame % STAR_COLORS.length];
  return (
    <Text {...(noColor() || color === undefined ? {} : { color })}>
      {STAR_FRAMES[frame]}
    </Text>
  );
}
