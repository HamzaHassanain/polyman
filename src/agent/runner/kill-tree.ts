/**
 * Stops a CLI child and everything it started (compilers, solutions).
 *
 * On POSIX the runner spawns the child detached, so it leads its own process
 * group and `kill(-pid)` reaches the whole group. On Windows there are no
 * groups and signals do not run cleanup handlers, so `taskkill /T /F` kills
 * the tree.
 */

import { execFile } from 'child_process';

/** How often we check if the group is gone during the grace time. */
const POLL_MS = 50;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Sends `signal` to the process group of `pid`.
 *
 * @returns False when the group does not exist anymore
 */
function signalGroup(pid: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(-pid, signal);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

/**
 * Kills the process tree of `pid`.
 *
 * POSIX: SIGTERM to the group, wait up to `graceMs` for it to end, then
 * SIGKILL. A group that is already gone is not an error.
 *
 * @param pid - Pid of the child, the leader of its process group on POSIX
 * @param graceMs - Time the group gets to exit after SIGTERM
 */
export async function killTree(pid: number, graceMs = 3000): Promise<void> {
  if (process.platform === 'win32') {
    // Not tested on Windows yet (see NOTES.md). taskkill ends the whole tree
    // by pid; it fails when the process is already gone, which is fine.
    await new Promise<void>(resolve => {
      execFile(
        'taskkill',
        ['/PID', String(pid), '/T', '/F'],
        { windowsHide: true },
        () => resolve()
      );
    });
    return;
  }

  if (!signalGroup(pid, 'SIGTERM')) return;
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    if (!signalGroup(pid, 0)) return;
  }
  signalGroup(pid, 'SIGKILL');
}
