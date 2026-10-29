import { describe, it, expect } from 'vitest';
import { clearOnStart } from '../../../src/agent/tui/index.js';
import { CLEAR_TERMINAL } from '../../../src/agent/tui/App.js';

describe('clearOnStart', () => {
  it('clears a terminal so the chat starts at the top', () => {
    const written: string[] = [];
    clearOnStart({ isTTY: true, write: t => written.push(t) });
    expect(written).toEqual([CLEAR_TERMINAL]);
  });

  it('writes nothing to a pipe', () => {
    const written: string[] = [];
    clearOnStart({ isTTY: false, write: t => written.push(t) });
    clearOnStart({ write: t => written.push(t) });
    expect(written).toEqual([]);
  });
});
