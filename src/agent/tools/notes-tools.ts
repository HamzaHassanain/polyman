/**
 * The problem spec tools: `read_notes` and `write_notes`. The spec lives in
 * `.polyman/agent/notes.md` inside the problem folder (SPEC-FORMAT.md).
 *
 * In the Think step there is no problem folder yet, so the notes are kept in
 * memory. When `create_problem` makes the folder (`problem_dir_changed` on
 * the bus), the notes are written into it.
 */

import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { EventBus } from '../core/events';
import { NOTES_PATH } from '../core/prompt';
import { parseSpec } from '../workflow/spec';
import type { Tool, ToolOutput } from './types';

/** Sections the build_problem workflow needs, in the spec order. */
export const SPEC_SECTIONS = [
  'Idea',
  'Constraints',
  'Input',
  'Output',
  'Intended solution',
  'Wrong approaches',
  'Edge cases',
  'Samples',
] as const;

/** Verdicts a wrong approach line may end with. */
const WRONG_VERDICTS = ['WA', 'TL', 'ML', 'RE'];

/** Longest piece of a bad line quoted back to the model. */
const QUOTE_MAX = 60;

/**
 * What is wrong with a spec, as short lines the model can act on. An empty
 * list means the spec is ready for `build_problem`.
 *
 * @param sections The sections that must be there and not empty.
 */
export function specProblems(
  text: string,
  sections: readonly string[] = SPEC_SECTIONS
): string[] {
  const parsed = parseSpec(text);
  const problems: string[] = [];
  for (const name of sections) {
    if ((parsed.sections[name] ?? '').trim() === '') {
      problems.push(`missing or empty section "# ${name}"`);
    }
  }

  if (
    (parsed.sections['Samples'] ?? '').trim() !== '' &&
    parsed.samples.length === 0
  ) {
    problems.push(
      'no sample found: write "## Input 1" and "## Output 1", each followed by a ``` code block'
    );
  }

  for (const raw of (parsed.sections['Wrong approaches'] ?? '').split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('- ')) continue;
    const arrow = line.lastIndexOf('->');
    const verdict =
      arrow < 0
        ? ''
        : line
            .slice(arrow + 2)
            .trim()
            .split(/\s+/)[0];
    if (!WRONG_VERDICTS.includes(verdict ?? '')) {
      const quoted =
        line.length > QUOTE_MAX ? `${line.slice(0, QUOTE_MAX)}...` : line;
      problems.push(
        `wrong approach "${quoted}" must end with "-> WA", "-> TL", "-> ML" or "-> RE" (plain ascii "->")`
      );
    }
  }
  return problems;
}

/** Reads and writes the spec, in memory or in the problem folder. */
export class NotesStore {
  private memory: string | null = null;
  private flushing: Promise<void> = Promise.resolve();

  /**
   * @param bus The chat bus. The store listens for `problem_dir_changed`
   *   and emits `notes_updated`.
   * @param problemDir The problem folder now, or null before one exists.
   */
  constructor(
    private readonly bus: EventBus,
    private readonly problemDir: () => string | null
  ) {
    bus.on(e => {
      if (e.type === 'problem_dir_changed') {
        this.flushing = this.flush(e.problemDir);
      }
    });
  }

  /**
   * The notes not written to a folder yet, or null when there are none.
   * The chat prompt shows these before the folder exists.
   */
  pending(): string | null {
    return this.memory;
  }

  /** The spec text, or '' when there is none. */
  async read(): Promise<string> {
    await this.flushing;
    if (this.memory !== null) return this.memory;
    const dir = this.problemDir();
    if (dir === null) return '';
    try {
      return await readFile(join(dir, NOTES_PATH), 'utf8');
    } catch {
      return '';
    }
  }

  /** Replaces the spec. Returns where it was saved. */
  async write(content: string): Promise<string> {
    await this.flushing;
    const dir = this.problemDir();
    if (dir === null) {
      this.memory = content;
    } else {
      await writeNotes(dir, content);
      this.memory = null;
    }
    this.bus.emit({ type: 'notes_updated', notes: content });
    return dir === null ? 'memory' : join(dir, NOTES_PATH);
  }

  /** Writes the in-memory notes into the new problem folder. */
  private async flush(dir: string): Promise<void> {
    if (this.memory === null) return;
    try {
      await writeNotes(dir, this.memory);
      this.memory = null;
    } catch {
      // Keep them in memory, the next write_notes tries again.
    }
  }
}

async function writeNotes(dir: string, content: string): Promise<void> {
  const file = join(dir, NOTES_PATH);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content, 'utf8');
}

/** The `read_notes` and `write_notes` tools over one {@link NotesStore}. */
export function notesTools(store: NotesStore): Tool[] {
  const readNotes: Tool<Record<string, never>> = {
    name: 'read_notes',
    description:
      'Read the problem spec (.polyman/agent/notes.md): idea, constraints, samples, decisions.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    risk: 'read',
    needsProblem: false,
    describe: () => ({ title: 'Read the notes' }),
    async run(): Promise<ToolOutput> {
      const notes = await store.read();
      return {
        content:
          notes.trim() === ''
            ? '(no notes yet, write the spec with write_notes)'
            : notes,
      };
    },
  };

  const writeNotesTool: Tool<{ content: string }> = {
    name: 'write_notes',
    description:
      'Write the whole problem spec (.polyman/agent/notes.md), in the spec format of your instructions. It replaces the old notes.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The full spec in markdown, with the exact headings.',
        },
      },
      required: ['content'],
      additionalProperties: false,
    },
    risk: 'write',
    needsProblem: false,
    describe: () => ({ title: 'Write the notes (.polyman/agent/notes.md)' }),
    async run(args): Promise<ToolOutput> {
      const where = await store.write(args.content);
      const lines = args.content.split('\n').length;
      const saved =
        where === 'memory'
          ? `Saved the notes (${lines} lines) in memory. They are written to the problem folder when create_problem makes it.`
          : `Saved the notes (${lines} lines) to ${NOTES_PATH}.`;
      const problems = specProblems(args.content);
      if (problems.length === 0) return { content: saved };
      return {
        content: [
          `${saved} But the spec is not ready for the workflow:`,
          ...problems.map(p => `- ${p}`),
          'Fix these and call write_notes again with the full spec.',
        ].join('\n'),
        isError: true,
      };
    },
  };

  return [readNotes, writeNotesTool];
}
