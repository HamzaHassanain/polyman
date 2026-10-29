/**
 * Height rules of the live part of the chat. Pure functions, tested alone.
 *
 * The whole problem: when the redrawn part is as tall as the terminal, Ink
 * clears the screen and the scrollback and prints everything again on each
 * frame (the spinner draws 12 frames a second), and lines that scrolled away
 * stay as garbage. So every live part gets a number of lines it may use, and
 * the sum stays under the terminal height.
 */

/** Lines we always keep free under the terminal height. */
export const SAFETY_LINES = 2;

/**
 * The terminal size. A stream that is not a terminal has no height, and no
 * height limit either (Ink redraws everything only on a terminal).
 */
export function sizeOf(out: { columns?: number; rows?: number }): {
  columns: number;
  rows: number;
} {
  return {
    columns: out.columns && out.columns > 0 ? out.columns : 80,
    rows: out.rows && out.rows > 0 ? out.rows : Infinity,
  };
}

/** How many terminal lines `text` takes at `width` columns. */
export function visualLines(text: string, width: number): number {
  const w = Math.max(1, width);
  let total = 0;
  for (const line of text.split('\n')) {
    total += Math.max(1, Math.ceil([...line].length / w));
  }
  return total;
}

/**
 * The end of `text` that fits in `maxLines` terminal lines at `width`
 * columns, cut at a line start. When the cut falls inside a code block, the
 * fence is opened again so the markdown still draws it as code. `hidden` is
 * the number of source lines that were cut.
 */
export function tailLines(
  text: string,
  maxLines: number,
  width: number
): { text: string; hidden: number } {
  const lines = text.split('\n');
  const max = Math.max(1, maxLines);
  let used = 0;
  let start = lines.length;
  while (start > 0) {
    const next = visualLines(lines[start - 1] ?? '', width);
    if (used + next > max) break;
    used += next;
    start--;
  }
  if (start === 0) return { text, hidden: 0 };
  // Keep at least the last line, even when it alone is too long.
  if (start === lines.length) start = lines.length - 1;
  let fences = 0;
  for (let i = 0; i < start; i++) {
    if (/^\s*(```|~~~)/.test(lines[i] ?? '')) fences++;
  }
  if (fences % 2 === 1 && /^\s*(```|~~~)/.test(lines[start] ?? '')) {
    // The tail starts with the closing fence: drop it, no block is open.
    const rest = lines.slice(start + 1).join('\n');
    return { text: rest, hidden: start + 1 };
  }
  const rest = lines.slice(start).join('\n');
  return { text: fences % 2 === 1 ? `\`\`\`\n${rest}` : rest, hidden: start };
}

/**
 * The rows `[start, end)` of a list of `n` rows to show in `max` rows,
 * keeping `focus` in view (a bit under the top, so the rows after it show).
 */
export function windowOf(
  n: number,
  max: number,
  focus: number
): { start: number; end: number } {
  const size = Math.max(1, Math.min(n, max));
  if (n <= size) return { start: 0, end: n };
  const f = Math.max(0, Math.min(n - 1, focus));
  const start = Math.max(0, Math.min(n - size, f - Math.floor(size / 3)));
  return { start, end: start + size };
}

/** What is on the live part now, for {@link liveBudget}. */
export interface LiveParts {
  rows: number;
  /** Lines of the running tools (each tool with its margin). */
  toolLines: number;
  /** The spinner line and its margin, there while the agent works. */
  workingLines: number;
  /** The "wait for the turn" hint. */
  hintLines: number;
  /** Lines of the input text, or null when the input box is hidden. */
  inputLines: number | null;
  prompt: 'approval' | 'plan' | 'details' | null;
  /** Tasks of the live task tree, or 0 when it is not shown. */
  treeTasks: number;
}

/** How many lines each live part may use. */
export interface LiveBudget {
  /** Lines of the streamed answer. */
  streaming: number;
  /** Lines of the task rows of the live tree. */
  tree: number;
  /** Preview lines of a tool approval. */
  preview: number;
  /** Task rows of the plan approval box. */
  planRows: number;
  /** Attempt lines of the task details. */
  details: number;
  /** Lines of the input text. */
  input: number;
}

/** Lines of an approval box without its preview (with the reason input). */
const APPROVAL_CHROME = 15;
/** Lines of the plan approval box without its task rows. */
const PLAN_CHROME = 13;
/** Lines of the task details box without its attempts. */
const DETAILS_CHROME = 12;
/** Lines of the live tree without its task rows: header, hint, margin. */
const TREE_CHROME = 3;

/**
 * Shares the terminal height between the live parts, so the redrawn part
 * stays under the terminal height. Each part gets at least a few lines; on
 * a very short terminal that is the best we can do.
 */
export function liveBudget(p: LiveParts): LiveBudget {
  const input = p.inputLines === null ? 0 : Math.max(3, Math.floor(p.rows / 3));
  const inputShown =
    p.inputLines === null ? 0 : 2 + Math.min(p.inputLines, input);
  // The status line is always there.
  let avail =
    p.rows -
    SAFETY_LINES -
    1 -
    p.hintLines -
    inputShown -
    p.toolLines -
    p.workingLines;

  let tree = 0;
  if (p.treeTasks > 0) {
    const want = p.treeTasks;
    // The hint under the tree is hidden while the task details are open.
    const chrome = p.prompt === 'details' ? TREE_CHROME - 1 : TREE_CHROME;
    let share = avail - chrome;
    // A box under the tree comes first: the tree gets what is left.
    if (p.prompt === 'details') {
      share = Math.floor((avail - DETAILS_CHROME - chrome) / 2);
    } else if (p.prompt === 'approval') {
      share = avail - APPROVAL_CHROME - 3 - chrome;
    }
    tree = Math.max(1, Math.min(want, share));
    avail -= tree + chrome;
  }

  return {
    streaming: Math.max(3, avail - 1),
    tree: tree || Infinity,
    preview: Math.max(1, Math.min(12, avail - APPROVAL_CHROME)),
    planRows: Math.max(1, Math.min(20, avail - PLAN_CHROME)),
    details: Math.max(1, avail - DETAILS_CHROME),
    input,
  };
}
