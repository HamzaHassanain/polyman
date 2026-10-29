import { describe, it, expect, vi } from 'vitest';
import { SimpleEventBus } from '../../../src/agent/core/event-bus';
import type { SeqEvent } from '../../../src/agent/core/events';

describe('SimpleEventBus', () => {
  it('numbers events from 1 and calls listeners in order', () => {
    const bus = new SimpleEventBus();
    const seen: string[] = [];
    bus.on(e => seen.push(`a${e.seq}`));
    bus.on(e => seen.push(`b${e.seq}`));

    bus.emit({ type: 'turn_start', turnId: 't1' });
    bus.emit({ type: 'text_delta', text: 'hi' });

    expect(seen).toEqual(['a1', 'b1', 'a2', 'b2']);
  });

  it('keeps calling listeners when one throws', () => {
    const bus = new SimpleEventBus();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const got: SeqEvent[] = [];
    bus.on(() => {
      throw new Error('boom');
    });
    bus.on(e => got.push(e));

    bus.emit({ type: 'text_delta', text: 'x' });

    expect(got).toEqual([{ type: 'text_delta', text: 'x', seq: 1 }]);
    expect(errors).toHaveBeenCalledTimes(1);
    errors.mockRestore();
  });

  it('removes a listener with the returned function', () => {
    const bus = new SimpleEventBus();
    const got: number[] = [];
    const off = bus.on(e => got.push(e.seq));

    bus.emit({ type: 'text_delta', text: 'a' });
    off();
    off();
    bus.emit({ type: 'text_delta', text: 'b' });

    expect(got).toEqual([1]);
  });
});
