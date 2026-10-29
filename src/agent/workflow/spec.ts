/**
 * Parses the problem spec (`.polyman/agent/notes.md`). The format is in
 * `design/agent/briefs/SPEC-FORMAT.md`: `# <Name>` sections, wrong approaches
 * as `- text -> VERDICT` lines, samples as `## Input <n>` / `## Output <n>`
 * pairs with fenced blocks, and the limits and checker in `# Decisions`.
 */

import type { SolutionTag } from '../../types';
import type { Spec } from './types';

/** One line of `# Wrong approaches`. */
export interface WrongApproach {
  /** The text before `->`. */
  text: string;
  /** The expected verdict after `->`. `WA` when it is missing or unknown. */
  verdict: SolutionTag;
  /**
   * True for the plain brute force `TL` line. The `brute_force` task (tag
   * `TO`) covers it, so it gets no `wrong_solution` task.
   */
  isBruteForce: boolean;
}

/** One sample from `# Samples`. */
export interface Sample {
  index: number;
  input: string;
  output: string;
}

/** Everything the scheduler and the checkpoints read from the spec. */
export interface ParsedSpec {
  /** Section text by name, without the `# Name` line. */
  sections: Record<string, string>;
  wrongApproaches: WrongApproach[];
  /** Samples that have both an input and an output, by index. */
  samples: Sample[];
  /** From `Time limit <x> second(s)` in `# Decisions`. */
  timeLimitMs?: number;
  /** From `memory limit <y> MB` in `# Decisions`. */
  memoryLimitMb?: number;
  /** From `Checker: <name>` in `# Decisions`, without `.cpp`. */
  checker?: string;
}

const VERDICTS: readonly SolutionTag[] = [
  'MA',
  'OK',
  'RJ',
  'TL',
  'TO',
  'WA',
  'PE',
  'ML',
  'RE',
];

/** Splits the text into `# Name` sections. Headings in code fences do not count. */
function splitSections(text: string): Record<string, string> {
  const sections: Record<string, string> = {};
  let name: string | null = null;
  let body: string[] = [];
  let inFence = false;

  const flush = (): void => {
    if (name !== null) sections[name] = body.join('\n').trim();
  };

  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith('```')) inFence = !inFence;
    const heading = inFence ? null : /^# (.+?)\s*$/.exec(line);
    if (heading?.[1]) {
      flush();
      name = heading[1];
      body = [];
    } else {
      body.push(line);
    }
  }
  flush();
  return sections;
}

function parseWrongApproaches(body: string): WrongApproach[] {
  const approaches: WrongApproach[] = [];
  let bruteForceSeen = false;
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('- ')) continue;
    const item = line.slice(2).trim();
    const arrow = item.lastIndexOf('->');
    const text = (arrow >= 0 ? item.slice(0, arrow) : item).trim();
    const word = (arrow >= 0 ? item.slice(arrow + 2) : '')
      .trim()
      .split(/\s+/)[0]
      ?.toUpperCase()
      .replace(/[^A-Z]/g, '');
    const verdict = VERDICTS.find(v => v === word) ?? 'WA';
    const isBruteForce =
      !bruteForceSeen && verdict === 'TL' && /brute/i.test(text);
    if (isBruteForce) bruteForceSeen = true;
    approaches.push({ text, verdict, isBruteForce });
  }
  return approaches;
}

function parseSamples(body: string): Sample[] {
  const inputs = new Map<number, string>();
  const outputs = new Map<number, string>();
  let target: { map: Map<number, string>; index: number } | null = null;
  let fence: string[] | null = null;

  for (const line of body.split(/\r?\n/)) {
    if (fence !== null) {
      if (line.trimStart().startsWith('```')) {
        if (target) target.map.set(target.index, fence.join('\n'));
        target = null;
        fence = null;
      } else {
        fence.push(line);
      }
      continue;
    }
    const heading = /^##\s+(Input|Output)\s+(\d+)\s*$/i.exec(line.trim());
    if (heading?.[1] && heading[2]) {
      const map = heading[1].toLowerCase() === 'input' ? inputs : outputs;
      target = { map, index: Number(heading[2]) };
    } else if (line.trimStart().startsWith('```')) {
      fence = [];
    }
  }

  const samples: Sample[] = [];
  for (const [index, input] of inputs) {
    const output = outputs.get(index);
    if (output !== undefined) samples.push({ index, input, output });
  }
  return samples.sort((a, b) => a.index - b.index);
}

/** Parses the spec text. Never throws: missing parts are just empty. */
export function parseSpec(text: Spec): ParsedSpec {
  const sections = splitSections(text);
  const parsed: ParsedSpec = {
    sections,
    wrongApproaches: parseWrongApproaches(sections['Wrong approaches'] ?? ''),
    samples: parseSamples(sections['Samples'] ?? ''),
  };

  const decisions = sections['Decisions'] ?? '';
  const time =
    /time limit\D{0,10}?(\d+(?:\.\d+)?)\s*(ms|milliseconds?|s|sec|seconds?)\b/i.exec(
      decisions
    );
  if (time?.[1] && time[2]) {
    const value = Number(time[1]);
    const ms = time[2].toLowerCase().startsWith('m') ? value : value * 1000;
    parsed.timeLimitMs = Math.round(ms);
  }
  const memory = /memory limit\D{0,10}?(\d+)\s*MB/i.exec(decisions);
  if (memory?.[1]) parsed.memoryLimitMb = Number(memory[1]);
  const checker = /checker:\s*`?([A-Za-z0-9_-]+)(?:\.cpp)?/i.exec(decisions);
  if (checker?.[1]) parsed.checker = checker[1];

  return parsed;
}

/** The wrong approaches that need a `wrong_solution` task each. */
export function wrongSolutionApproaches(parsed: ParsedSpec): WrongApproach[] {
  return parsed.wrongApproaches.filter(a => !a.isBruteForce);
}
