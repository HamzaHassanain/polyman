/**
 * Starts the chat UI with the fake session, to try the UI before the real
 * agent exists: `npm run build && node dist/agent/tui/dev/run.js`.
 * Type a message with the word "markdown" to see headings and a code box.
 * Type a message with the word "workflow" to see the plan approval and the
 * live task tree (ctrl+o on it shows the task details).
 */

import { startTui } from '../index.js';
import { FakeBus, FakeSession } from './fake-session.js';

const bus = new FakeBus();
const session = new FakeSession(bus);

await startTui(session, bus, {
  problem: 'pairs-sum',
  model: 'google/gemma-4-31b-it',
  setMode: mode => session.setMode(mode),
});
