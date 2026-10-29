import { describe, it, expect } from 'vitest';
import {
  liveBudget,
  sizeOf,
  tailLines,
  visualLines,
  windowOf,
  type LiveParts,
} from '../../../src/agent/tui/layout.js';
import { visibleInput } from '../../../src/agent/tui/components/Composer.js';

describe('tui layout', () => {
  it('sizeOf has no height limit without a terminal', () => {
    expect(sizeOf({ columns: 100, rows: 32 })).toEqual({
      columns: 100,
      rows: 32,
    });
    expect(sizeOf({})).toEqual({ columns: 80, rows: Infinity });
  });

  it('visualLines counts wrapped lines', () => {
    expect(visualLines('', 10)).toBe(1);
    expect(visualLines('a\nb', 10)).toBe(2);
    expect(visualLines('x'.repeat(25), 10)).toBe(3);
  });

  it('tailLines keeps the end and opens a cut code block again', () => {
    const text = ['intro', '', '```cpp', 'a', 'b', 'c', '```', 'end'].join(
      '\n'
    );
    expect(tailLines(text, 100, 80)).toEqual({ text, hidden: 0 });
    expect(tailLines(text, 2, 80)).toEqual({ text: 'end', hidden: 7 });
    expect(tailLines(text, 4, 80)).toEqual({
      text: '```\nb\nc\n```\nend',
      hidden: 4,
    });
    // A single line longer than the space is still shown.
    expect(tailLines('x'.repeat(500), 2, 80).text).toBe('x'.repeat(500));
  });

  it('windowOf keeps the focus row in view', () => {
    expect(windowOf(5, 10, 0)).toEqual({ start: 0, end: 5 });
    expect(windowOf(12, 4, 0)).toEqual({ start: 0, end: 4 });
    expect(windowOf(12, 4, 6)).toEqual({ start: 5, end: 9 });
    expect(windowOf(12, 4, 11)).toEqual({ start: 8, end: 12 });
  });

  const parts = (p: Partial<LiveParts>): LiveParts => ({
    rows: 24,
    toolLines: 0,
    workingLines: 0,
    hintLines: 0,
    inputLines: 1,
    prompt: null,
    treeTasks: 0,
    ...p,
  });

  it('liveBudget keeps the streamed answer under the terminal height', () => {
    // 24 rows: 2 safe, 1 status, 3 input box, 1 margin.
    expect(liveBudget(parts({})).streaming).toBe(17);
    expect(liveBudget(parts({ rows: Infinity })).streaming).toBe(Infinity);
  });

  it('liveBudget makes the tree and the details box fit together', () => {
    const b = liveBudget(
      parts({
        inputLines: null,
        prompt: 'details',
        treeTasks: 12,
        toolLines: 2,
      })
    );
    // tree + its header and margin + details chrome + details lines.
    expect(b.tree + 2 + 12 + b.details).toBeLessThanOrEqual(24 - 2 - 1 - 2);
    expect(b.tree).toBeGreaterThanOrEqual(1);
    // A tall terminal shows the whole tree.
    expect(liveBudget(parts({ rows: 60, treeTasks: 12 })).tree).toBe(12);
  });

  it('liveBudget cuts the approval preview and the plan rows', () => {
    expect(
      liveBudget(parts({ inputLines: null, prompt: 'approval' })).preview
    ).toBe(6);
    expect(liveBudget(parts({ rows: 60, prompt: 'approval' })).preview).toBe(
      12
    );
    expect(
      liveBudget(parts({ inputLines: null, prompt: 'plan' })).planRows
    ).toBe(8);
  });

  it('visibleInput shows the lines around the cursor of a long input', () => {
    const text = ['l0', 'l1', 'l2', 'l3', 'l4', 'l5'].join('\n');
    const all = visibleInput({ text, cursor: 0 }, 10);
    expect(all).toEqual({ state: { text, cursor: 0 }, hidden: 0 });
    const end = visibleInput({ text, cursor: text.length }, 3);
    expect(end).toEqual({ state: { text: 'l4\nl5', cursor: 5 }, hidden: 4 });
  });
});
