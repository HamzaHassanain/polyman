/**
 * The keys and typed commands of the chat, as pure functions so they can be
 * tested without a terminal. `App.tsx` uses them.
 */

import type { Key } from 'ink';
import type { PermissionMode } from '../tools/types.js';

/** What a key press means for the whole app (not for the input box). */
export type AppKey =
  | 'interrupt'
  | 'ctrl_c'
  | 'force_exit'
  | 'toggle_mode'
  | 'toggle_details'
  | null;

/** Maps a key press to an app action. Editing keys return null. */
export function appKeyOf(input: string, key: Key): AppKey {
  if (key.ctrl && input === 'c') return 'ctrl_c';
  // Ink reads keys in raw mode, so ctrl+z is a key here, not SIGTSTP.
  if (key.ctrl && input === 'z') return 'force_exit';
  if (key.ctrl && input === 'o') return 'toggle_details';
  if (key.tab && key.shift) return 'toggle_mode';
  if (key.escape) return 'interrupt';
  return null;
}

/** How long a first ctrl+c waits for the second one. */
export const CTRL_C_WINDOW_MS = 1000;

/** Counts ctrl+c presses: the first clears the input, two in 1 s exit. */
export class CtrlCTracker {
  private last = -Infinity;

  /** Records a press at `now` (ms) and says what to do. */
  press(now: number): 'clear' | 'exit' {
    if (now - this.last <= CTRL_C_WINDOW_MS) {
      this.last = -Infinity;
      return 'exit';
    }
    this.last = now;
    return 'clear';
  }
}

/** The mode shift+tab switches to. Only `ask` and `auto-edit` are used. */
export function nextMode(mode: PermissionMode): PermissionMode {
  return mode === 'ask' ? 'auto-edit' : 'ask';
}

/** Shown when the user switches to `auto-edit`. */
export const AUTO_EDIT_NOTICE =
  'auto-edit: the agent can now write files and run the code it writes without asking.';

/** Shown when the user presses enter while the agent works. */
export const BUSY_HINT = 'wait for the turn to end or press esc';

/** Shown after the first ctrl+c. */
export const CTRL_C_HINT = 'press ctrl+c again to exit';

/** The text of `/help`. */
export const HELP_TEXT = [
  'Keys:',
  '  enter              send the message',
  '  ctrl+j, \\ + enter  new line',
  '  up / down          input history (when the input is empty)',
  '  esc                interrupt the agent',
  '  shift+tab          switch mode: ask / auto-edit',
  '  ctrl+o             details of a workflow task (while it runs)',
  '  ctrl+c             clear the input, twice to exit',
  '  ctrl+z             quit now, stops the agent',
  'Commands:',
  '  /help              this help',
].join('\n');

/** A typed command like `/help`, or null for a normal message. */
export function parseCommand(
  text: string
): { name: string; arg: string } | null {
  const trimmed = text.trim();
  const match = /^\/([a-z][a-z-]*)(?:\s+(.*))?$/s.exec(trimmed);
  if (!match) return null;
  return { name: match[1] ?? '', arg: (match[2] ?? '').trim() };
}
