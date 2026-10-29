/**
 * Colors of the chat. `NO_COLOR` turns them all off (https://no-color.org).
 *
 * The helpers return props to spread (`<Text {...fg('agent')}>`), because
 * `exactOptionalPropertyTypes` does not let us pass `color={undefined}`.
 *
 * Every color here is a middle tone, so it reads on a light and on a dark
 * terminal. A background always comes with its own text color.
 */

import chalk from 'chalk';

/** The two ends of the Gemma gradient: blue to violet. */
export const GRADIENT = ['#3b82f6', '#8b5cf6'] as const;

const PALETTE = {
  /** The agent (the middle of the gradient): its ✦ and the boxes. */
  agent: '#636ff6',
  /** Headings of the markdown under the first level. */
  heading: '#7c6cf5',
  /** Tool names. */
  tool: '#5b7cfa',
  ok: 'green',
  error: 'red',
  /** Warnings and TL. */
  warn: '#f5a623',
  /** The TO tag. */
  info: 'cyan',
  /** Inline code and code blocks. */
  code: 'magenta',
  /** Added lines of a diff. */
  added: 'green',
  /** Removed lines of a diff. */
  removed: 'red',
} as const;

export type ColorName = keyof typeof PALETTE;

/** A background with the text color that reads on it. */
export interface Pill {
  bg: string;
  fg: string;
}

/** The pills of the status line. Each permission mode has its own color. */
export const PILLS = {
  ask: { bg: '#3b82f6', fg: '#ffffff' },
  'auto-edit': { bg: '#f5a623', fg: '#000000' },
  'plan-approved': { bg: '#16a34a', fg: '#ffffff' },
  model: { bg: '#8b5cf6', fg: '#ffffff' },
  tokens: { bg: '#374151', fg: '#f3f4f6' },
  cost: { bg: '#0f766e', fg: '#ffffff' },
} as const satisfies Record<string, Pill>;

/** True when the user asked for no colors. */
export function noColor(): boolean {
  const value = process.env['NO_COLOR'];
  return value !== undefined && value !== '';
}

/** The color value, or undefined when colors are off. */
export function colorOf(name: ColorName): string | undefined {
  return noColor() ? undefined : PALETTE[name];
}

/** `color` prop for `<Text>`. */
export function fg(name: ColorName): { color?: string } {
  const color = colorOf(name);
  return color === undefined ? {} : { color };
}

/** `borderColor` prop for `<Box>`. */
export function border(name: ColorName): { borderColor?: string } {
  const color = colorOf(name);
  return color === undefined ? {} : { borderColor: color };
}

/** `color` and `backgroundColor` props for a pill, none without colors. */
export function pill(p: Pill): { color?: string; backgroundColor?: string } {
  return noColor() ? {} : { color: p.fg, backgroundColor: p.bg };
}

/**
 * Props for the user lines: a dim background. `gray` and `whiteBright` are
 * terminal colors, so the terminal theme picks a pair that reads on it.
 */
export function userLine(): { color?: string; backgroundColor?: string } {
  return noColor() ? {} : { color: 'whiteBright', backgroundColor: 'gray' };
}

/** The style of a solution tag or verdict: OK green, WA red, TL amber, ... */
export function verdictStyle(tag: string): { color?: string; bold?: boolean } {
  switch (tag) {
    case 'MA':
      return { ...fg('ok'), bold: true };
    case 'OK':
      return fg('ok');
    case 'TL':
      return fg('warn');
    case 'TO':
      return fg('info');
    default:
      return fg('error');
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

/** `n` colors from `from` to `to`, both ends included. */
export function gradientStops(
  n: number,
  from: string = GRADIENT[0],
  to: string = GRADIENT[1]
): string[] {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  const stops: string[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    const mix = (x: number, y: number) => Math.round(x + (y - x) * t);
    stops.push(rgbToHex([mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2])]));
  }
  return stops;
}

/**
 * The text with each character in its own color of the gradient, made with
 * chalk. The plain text without colors. Spaces keep no color, so the color
 * runs over the visible characters only.
 */
export function gradient(text: string, opts: { bold?: boolean } = {}): string {
  if (noColor()) return text;
  const chars = [...text];
  const visible = chars.filter(c => c.trim().length > 0).length;
  const stops = gradientStops(Math.max(visible, 1));
  let i = 0;
  return chars
    .map(c => {
      if (c.trim().length === 0) return c;
      const paint = chalk.hex(stops[i++] ?? GRADIENT[0]);
      return opts.bold ? paint.bold(c) : paint(c);
    })
    .join('');
}

/** `google/gemma-4-31b-it:free` becomes `gemma-4-31b:free`. */
export function modelShortName(model: string): string {
  const name = model.slice(model.lastIndexOf('/') + 1);
  return name.replace(/-it(?=$|:)/, '');
}

/** 12345 tokens become `12.3k`. */
export function formatTokens(tokens: number): string {
  return `${(tokens / 1000).toFixed(1)}k`;
}

/**
 * 0.0123 becomes `$0.01`. Small costs keep 3 digits: `$0.004`. A cost under
 * $0.001 is `<$0.001`, so a paid call never looks free (`$0.000`).
 */
export function formatCost(costUsd: number): string {
  if (costUsd > 0 && costUsd < 0.001) return '<$0.001';
  const digits = costUsd > 0 && costUsd < 0.01 ? 3 : 2;
  return `$${costUsd.toFixed(digits)}`;
}
