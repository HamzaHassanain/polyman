import { describe, expect, it } from 'vitest';
import { SimpleEventBus } from '../../../src/agent/core/event-bus';
import {
  NotesStore,
  notesTools,
  specProblems,
} from '../../../src/agent/tools/notes-tools';
import type { ToolContext } from '../../../src/agent/tools/types';

const FULL = [
  '# Idea',
  'Count pairs i < j with a_i + a_j = k.',
  '# Constraints',
  '- 1 <= n <= 200000',
  '# Input',
  'n and k, then n integers.',
  '# Output',
  'The number of pairs.',
  '# Intended solution',
  'Hash map, O(n).',
  '# Wrong approaches',
  '- answer in int -> WA',
  '- brute force O(n^2) -> TL',
  '# Edge cases',
  '- n = 1',
  '# Samples',
  '## Input 1',
  '```',
  '4 6',
  '1 5 3 3',
  '```',
  '## Output 1',
  '```',
  '2',
  '```',
].join('\n');

describe('specProblems', () => {
  it('finds nothing in a whole spec', () => {
    expect(specProblems(FULL)).toEqual([]);
  });

  it('names every missing section', () => {
    expect(specProblems('# Idea\nx\n# Constraints\n- n')).toEqual([
      'missing or empty section "# Input"',
      'missing or empty section "# Output"',
      'missing or empty section "# Intended solution"',
      'missing or empty section "# Wrong approaches"',
      'missing or empty section "# Edge cases"',
      'missing or empty section "# Samples"',
    ]);
  });

  it('checks only the sections it is given', () => {
    expect(specProblems('# Idea\nx', ['Idea'])).toEqual([]);
  });

  it('finds samples without a code block', () => {
    const spec = FULL.replace(/# Samples[\s\S]*$/, '# Samples\n4 6 -> 2');
    expect(specProblems(spec)).toEqual([
      expect.stringContaining('no sample found'),
    ]);
  });

  it('finds wrong approaches without a plain "-> VERDICT"', () => {
    const spec = FULL.replace(
      '- answer in int -> WA',
      '- answer in int $\\to$ WA\n- missed case\n- slow -> TLE'
    );
    const problems = specProblems(spec);
    expect(problems).toHaveLength(3);
    expect(problems[0]).toContain('answer in int $\\to$ WA');
    expect(problems[0]).toContain('"-> WA"');
    expect(problems[1]).toContain('missed case');
    expect(problems[2]).toContain('slow -> TLE');
  });
});

describe('write_notes', () => {
  const ctx = {} as ToolContext;
  const tools = (): ReturnType<typeof notesTools> => {
    const store = new NotesStore(new SimpleEventBus(), () => null);
    return notesTools(store);
  };

  it('saves a whole spec without an error', async () => {
    const [read, write] = tools();
    const out = await write.run({ content: FULL }, ctx);
    expect(out.isError).toBeUndefined();
    expect(out.content).toContain('Saved the notes');
    expect((await read.run({}, ctx)).content).toBe(FULL);
  });

  it('saves a bad spec but says what to fix', async () => {
    const [read, write] = tools();
    const out = await write.run({ content: '# Idea\nx' }, ctx);
    expect(out.isError).toBe(true);
    expect(out.content).toContain('Saved the notes');
    expect(out.content).toContain('- missing or empty section "# Samples"');
    expect(out.content).toContain('call write_notes again');
    expect((await read.run({}, ctx)).content).toBe('# Idea\nx');
  });
});
