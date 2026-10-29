import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import {
  App,
  CLEAR_TERMINAL,
  RESIZE_SETTLE_MS,
} from '../../../src/agent/tui/App.js';
import {
  FakeBus,
  FakeSession,
} from '../../../src/agent/tui/dev/fake-session.js';
import { AUTO_EDIT_NOTICE } from '../../../src/agent/tui/keybindings.js';

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

/** Waits until the frame passes `check`, or fails after `ms`. */
async function waitFor(
  frame: () => string | undefined,
  check: (f: string) => boolean,
  ms = 2000
): Promise<string> {
  const end = Date.now() + ms;
  for (;;) {
    const f = frame() ?? '';
    if (check(f)) return f;
    if (Date.now() > end) {
      throw new Error(`timed out, last frame:\n${f}`);
    }
    await tick(10);
  }
}

/** The text between the two lines of the input box. */
function inputOf(frame: string | undefined): string {
  const lines = (frame ?? '').split('\n');
  const rules = lines
    .map((l, i) => (l.startsWith('───') ? i : -1))
    .filter(i => i >= 0);
  const [top, bottom] = rules.slice(-2);
  return lines
    .slice((top ?? 0) + 1, bottom)
    .join('\n')
    .trimEnd();
}

function setup(setMode?: (m: string) => void) {
  const bus = new FakeBus();
  const session = new FakeSession(bus, { delayScale: 0 });
  const info = {
    problem: 'pairs-sum',
    model: 'google/gemma-4-31b-it',
    ...(setMode ? { setMode } : {}),
  };
  const ui = render(<App session={session} bus={bus} info={info} />);
  return { bus, session, ...ui };
}

// The pills show only with colors: do not take NO_COLOR from the shell.
beforeEach(() => {
  vi.stubEnv('NO_COLOR', '');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('App with the fake session', () => {
  it('shows the welcome box, the input and the status line', () => {
    const { lastFrame } = setup();
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✦ polyman chat · powered by gemma-4-31b');
    expect(frame).toMatch(/folder.*pairs-sum/);
    expect(frame).toContain('model  gemma-4-31b (OpenRouter)');
    expect(frame).toContain('Type a message');
    expect(frame).toContain(' ask  shift+tab ');
  });

  it('typing and enter shows the user line and then the assistant text', async () => {
    const { stdin, lastFrame, session } = setup();
    const send = vi.spyOn(session, 'send');
    await tick();
    stdin.write('count pairs with sum k');
    await tick();
    expect(lastFrame()).toContain('> count pairs with sum k');
    stdin.write('\r');
    const frame = await waitFor(lastFrame, f =>
      f.includes('Answer the questions, then say build.')
    );
    expect(send).toHaveBeenCalledWith('count pairs with sum k');
    expect(frame).toContain('> count pairs with sum k');
    expect(frame).toContain('✦ Nice. Before we build anything');
    expect(frame).toContain('● update_notes(Constraints)');
    expect(frame).toContain('⎿ ✔ notes updated');
    expect(frame).not.toContain('esc to interrupt');
  });

  it('runs the approval and the verify turn', async () => {
    const { stdin, lastFrame } = setup();
    await tick();
    stdin.write('hi');
    await tick();
    stdin.write('\r');
    await waitFor(lastFrame, f => f.includes('say build.'));
    stdin.write('build it');
    await tick();
    stdin.write('\r');
    await waitFor(lastFrame, f => f.includes('Write validator/val.cpp?'));
    expect(lastFrame()).toContain('registerValidation');
    stdin.write('1');
    const frame = await waitFor(lastFrame, f => f.includes('as its tag says'));
    expect(frame).toContain('wrote validator/val.cpp');
    expect(frame).toContain('verify failed: wa-overflow.cpp (WA)');
    expect(frame).toContain('verify passed');
    expect(frame).not.toContain('❯ 1. Yes');
  });

  it('enter while busy shows the wait hint, esc interrupts', async () => {
    const bus = new FakeBus();
    const session = new FakeSession(bus, { delayScale: 5 });
    const cancel = vi.spyOn(session, 'cancel');
    const { stdin, lastFrame } = render(
      <App session={session} bus={bus} info={{ problem: null, model: 'm' }} />
    );
    await tick();
    stdin.write('hello');
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('again');
    await tick();
    stdin.write('\r');
    await waitFor(lastFrame, f =>
      f.includes('wait for the turn to end or press esc')
    );
    expect(lastFrame()).toContain('esc to interrupt');
    stdin.write('\u001B');
    const frame = await waitFor(lastFrame, f =>
      f.includes('Interrupted by the user.')
    );
    expect(cancel).toHaveBeenCalled();
    expect(frame).not.toContain('esc to interrupt');
    // The wait hint goes with the turn, the typed text stays.
    const after = await waitFor(
      lastFrame,
      f => !f.includes('wait for the turn to end')
    );
    expect(inputOf(after)).toBe('> again');
  });

  it('shift+tab switches the mode and adds the auto-edit notice', async () => {
    const setMode = vi.fn();
    const { stdin, lastFrame } = setup(setMode);
    await tick();
    stdin.write('\u001B[Z');
    const frame = await waitFor(lastFrame, f =>
      f.includes(' auto-edit  shift+tab ')
    );
    expect(frame).toContain(AUTO_EDIT_NOTICE);
    expect(setMode).toHaveBeenCalledWith('auto-edit');
    stdin.write('\u001B[Z');
    await waitFor(lastFrame, f => f.includes(' ask  shift+tab '));
    expect(setMode).toHaveBeenLastCalledWith('ask');
  });

  it('/help prints the keys as a notice and is not sent', async () => {
    const { stdin, lastFrame, session } = setup();
    const send = vi.spyOn(session, 'send');
    await tick();
    stdin.write('/help');
    await tick();
    stdin.write('\r');
    const frame = await waitFor(lastFrame, f => f.includes('Commands:'));
    expect(frame).toContain('shift+tab');
    expect(send).not.toHaveBeenCalled();
  });

  it('a pasted Polygon key is not sent, a notice shows instead', async () => {
    const { stdin, lastFrame, session } = setup();
    const send = vi.spyOn(session, 'send');
    await tick();
    stdin.write(`api key ${'a'.repeat(40)} secret ${'b'.repeat(40)}`);
    await tick();
    stdin.write('\r');
    const frame = await waitFor(lastFrame, f =>
      f.includes('looks like a Polygon key')
    );
    expect(frame).not.toContain('a'.repeat(40));
    expect(send).not.toHaveBeenCalled();
  });

  it('ctrl+c clears the input and asks for a second press', async () => {
    const { stdin, lastFrame } = setup();
    await tick();
    stdin.write('some text');
    await tick();
    expect(lastFrame()).toContain('some text');
    stdin.write('\u0003');
    const frame = await waitFor(lastFrame, f =>
      f.includes('press ctrl+c again to exit')
    );
    expect(frame).not.toContain('some text');
  });

  it('ctrl+c twice exits and draws no input box or status line last', async () => {
    const { stdin, lastFrame } = setup();
    await tick();
    stdin.write('\u0003');
    await tick();
    stdin.write('\u0003');
    await waitFor(lastFrame, f => !f.includes('Type a message'));
    expect(lastFrame()).not.toContain('ask mode (shift+tab)');
  });

  it('\\ + enter and ctrl+j add new lines, up brings back the last message', async () => {
    const { stdin, lastFrame } = setup();
    await tick();
    stdin.write('line one\\');
    await tick();
    stdin.write('\r');
    await tick();
    stdin.write('line two');
    await tick();
    stdin.write('\n');
    await tick();
    stdin.write('three');
    await tick();
    expect(lastFrame()).toContain('> line one\n  line two\n  three');
    stdin.write('\r');
    await waitFor(lastFrame, f => f.includes('say build.'));
    expect(inputOf(lastFrame())).toContain('Type a message');
    stdin.write('\u001B[A');
    await waitFor(lastFrame, f => inputOf(f).includes('line one'));
    expect(inputOf(lastFrame())).toBe('> line one\n  line two\n  three');
  });

  it('ctrl+z stops the agent and exits at once', async () => {
    const bus = new FakeBus();
    const session = new FakeSession(bus, { delayScale: 5 });
    const cancel = vi.spyOn(session, 'cancel');
    const onForceExit = vi.fn();
    const { stdin, lastFrame } = render(
      <App
        session={session}
        bus={bus}
        info={{ problem: null, model: 'm' }}
        onForceExit={onForceExit}
      />
    );
    await tick();
    stdin.write('hello');
    await tick();
    stdin.write('\r');
    await waitFor(lastFrame, f => f.includes('esc to interrupt'));
    stdin.write('\u001A');
    await waitFor(lastFrame, f => !f.includes('Type a message'));
    expect(cancel).toHaveBeenCalled();
    expect(onForceExit).toHaveBeenCalledTimes(1);
  });

  it('clears the screen and prints the transcript again after a resize', async () => {
    const { stdout, lastFrame } = setup();
    await tick();
    const count = (f: string | undefined) =>
      (f ?? '').split('powered by gemma-4-31b').length - 1;
    expect(count(lastFrame())).toBe(1);
    const tty = stdout as unknown as { isTTY: boolean };
    tty.isTTY = true;
    Object.defineProperty(stdout, 'columns', {
      get: () => 60,
      configurable: true,
    });
    stdout.emit('resize');
    // Nothing happens before the width settles.
    await tick(RESIZE_SETTLE_MS / 3);
    expect(stdout.frames).not.toContain(CLEAR_TERMINAL);
    await tick(RESIZE_SETTLE_MS * 2);
    expect(stdout.frames).toContain(CLEAR_TERMINAL);
    // The debug renderer of the tests keeps every static line, so the
    // welcome box printed again shows as a second copy.
    await waitFor(lastFrame, f => count(f) === 2);
  });
});
