/**
 * The event bus of the agent core: a plain typed emitter that numbers every
 * event, so logs and session files read in order.
 */

import type { AgentEvent, EventBus, SeqEvent } from './events';

/** An {@link EventBus} that calls its listeners in order, one by one. */
export class SimpleEventBus implements EventBus {
  private seq = 0;
  private listeners: Array<(e: SeqEvent) => void> = [];

  /**
   * Gives the event the next `seq` (from 1) and calls every listener. A
   * listener that throws is logged and does not stop the others.
   */
  emit(e: AgentEvent): void {
    this.seq += 1;
    const event: SeqEvent = { ...e, seq: this.seq };
    for (const fn of [...this.listeners]) {
      try {
        fn(event);
      } catch (err) {
        console.error('agent event listener failed:', err);
      }
    }
  }

  /** Adds a listener. Returns a function that removes it. */
  on(fn: (e: SeqEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i !== -1) this.listeners.splice(i, 1);
    };
  }
}
