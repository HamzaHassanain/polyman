/**
 * The word of the spinner line: what the agent does now, from the running
 * tool and its last progress line. Pure, tested alone.
 */

import type { UiState } from './store.js';

/** The word of each tool when its progress line says nothing better. */
const TOOL_WORDS: Record<string, string> = {
  create_problem: 'Creating the problem',
  find_ideas: 'Finding ideas',
  edit_file: 'Editing',
  generate: 'Generating tests',
  list_files: 'Reading',
  read_file: 'Reading',
  read_notes: 'Reading notes',
  run_solution: 'Running tests',
  start_workflow: 'Planning',
  test_target: 'Testing',
  validate: 'Validating',
  verify: 'Verifying',
  write_file: 'Writing',
  write_notes: 'Taking notes',
};

/** Words from the progress line, checked in order. */
const LINE_WORDS: [RegExp, string][] = [
  [/compil/i, 'Compiling'],
  [/generat/i, 'Generating tests'],
  [/validat/i, 'Validating'],
  [/checker/i, 'Checking'],
  [/\brun(ning)?\b.*\btests?\b/i, 'Running tests'],
];

/** What else the screen shows, for {@link activityWord}. */
export interface ActivityContext {
  /** An approval box waits for the user. */
  waiting?: boolean;
  /** The workflow tree runs. */
  workflow?: boolean;
  /** The recipe of that workflow. */
  recipe?: string;
}

/** `Compiling…`, `Running tests…`, `Thinking…`, ... */
export function activityWord(
  live: UiState['live'],
  ctx: ActivityContext = {}
): string {
  if (ctx.waiting) return 'Waiting for you…';
  if (ctx.workflow) {
    if (ctx.recipe === 'prove_idea') return 'Proving the idea…';
    if (ctx.recipe === 'find_ideas') return 'Finding ideas…';
    return 'Running the workflow…';
  }
  const tool = live.runningTools[live.runningTools.length - 1];
  if (tool) {
    const line = tool.lastLine ?? '';
    const fromLine = LINE_WORDS.find(([re]) => re.test(line));
    const word = fromLine?.[1] ?? TOOL_WORDS[tool.name] ?? 'Working';
    return `${word}…`;
  }
  if (live.streamingText.trim().length > 0) return 'Writing…';
  return 'Thinking…';
}

/** 65000 ms become `65s`. */
export function formatSeconds(ms: number): string {
  return `${Math.max(0, Math.floor(ms / 1000))}s`;
}
