/**
 * The terminal UI of `polyman chat`. `src/agent/index.ts` loads this file
 * with `await import('./tui/index.js')`, so Ink loads only for the chat.
 */

import { render } from 'ink';
import type { EventBus } from '../core/events.js';
import type { AgentSessionApi } from '../core/session-types.js';
import { App, CLEAR_TERMINAL, type TuiInfo } from './App.js';

export type { TuiInfo } from './App.js';

/**
 * Clears the screen and the scrollback, so the chat starts at the top of
 * the terminal. Only on a terminal: a pipe gets no escape codes.
 */
export function clearOnStart(out: {
  isTTY?: boolean;
  write(text: string): unknown;
}): void {
  if (out.isTTY) out.write(CLEAR_TERMINAL);
}

/**
 * Draws the chat and resolves when the user exits. Prints `Bye.` after.
 * After ctrl+z the process exits right away, so a stuck tool or request
 * cannot keep it alive.
 */
export async function startTui(
  session: AgentSessionApi,
  bus: EventBus,
  info: TuiInfo
): Promise<void> {
  let forced = false;
  clearOnStart(process.stdout);
  const instance = render(
    <App
      session={session}
      bus={bus}
      info={info}
      onForceExit={() => {
        forced = true;
      }}
    />,
    { exitOnCtrlC: false }
  );
  try {
    await instance.waitUntilExit();
  } finally {
    instance.cleanup();
    console.log('Bye.');
  }
  if (forced) process.exit(130);
}
