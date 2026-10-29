import { afterEach, describe, it, expect } from 'vitest';
import type { Key } from 'ink';
import {
  appKeyOf,
  CtrlCTracker,
  nextMode,
  parseCommand,
} from '../../../src/agent/tui/keybindings.js';
import {
  backspace,
  editorOf,
  enter,
  History,
  insert,
  move,
} from '../../../src/agent/tui/editor.js';
import {
  fg,
  formatCost,
  formatTokens,
  modelShortName,
} from '../../../src/agent/tui/theme.js';

const noKey: Key = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  home: false,
  end: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false,
  super: false,
  hyper: false,
  capsLock: false,
  numLock: false,
};

describe('keybindings', () => {
  it('maps ctrl+c, ctrl+z, shift+tab and esc', () => {
    expect(appKeyOf('c', { ...noKey, ctrl: true })).toBe('ctrl_c');
    expect(appKeyOf('z', { ...noKey, ctrl: true })).toBe('force_exit');
    expect(appKeyOf('z', noKey)).toBeNull();
    expect(appKeyOf('o', { ...noKey, ctrl: true })).toBe('toggle_details');
    expect(appKeyOf('', { ...noKey, tab: true, shift: true })).toBe(
      'toggle_mode'
    );
    expect(appKeyOf('', { ...noKey, escape: true })).toBe('interrupt');
    expect(appKeyOf('', { ...noKey, tab: true })).toBeNull();
    expect(appKeyOf('c', noKey)).toBeNull();
  });

  it('ctrl+c twice within 1 s exits, slower presses only clear', () => {
    const t = new CtrlCTracker();
    expect(t.press(0)).toBe('clear');
    expect(t.press(1500)).toBe('clear');
    expect(t.press(2400)).toBe('exit');
    expect(t.press(2500)).toBe('clear');
  });

  it('shift+tab switches between ask and auto-edit', () => {
    expect(nextMode('ask')).toBe('auto-edit');
    expect(nextMode('auto-edit')).toBe('ask');
    expect(nextMode('plan-approved')).toBe('ask');
  });

  it('parses typed commands', () => {
    expect(parseCommand('/help')).toEqual({ name: 'help', arg: '' });
    expect(parseCommand(' /mode  auto-edit ')).toEqual({
      name: 'mode',
      arg: 'auto-edit',
    });
    expect(parseCommand('hello /help')).toBeNull();
    expect(parseCommand('/usr/bin is a path')).toBeNull();
  });
});

describe('editor', () => {
  it('inserts, deletes and moves the cursor', () => {
    let s = insert(editorOf('ac'), 'x');
    expect(s).toEqual({ text: 'acx', cursor: 3 });
    s = move(s, -2);
    s = insert(s, 'b');
    expect(s).toEqual({ text: 'abcx', cursor: 2 });
    s = backspace(s);
    expect(s).toEqual({ text: 'acx', cursor: 1 });
    expect(move(s, -5).cursor).toBe(0);
    expect(move(s, 9).cursor).toBe(3);
    expect(backspace(editorOf(''))).toEqual({ text: '', cursor: 0 });
  });

  it('turns pasted CR LF into new lines', () => {
    expect(insert(editorOf(''), 'a\r\nb\rc').text).toBe('a\nb\nc');
  });

  it('enter sends, \\ + enter adds a new line', () => {
    expect(enter(editorOf('hi'))).toEqual({ kind: 'send', text: 'hi' });
    expect(enter(editorOf('hi\\'))).toEqual({
      kind: 'newline',
      state: { text: 'hi\n', cursor: 3 },
    });
  });

  it('walks the history up and down', () => {
    const h = new History();
    expect(h.up()).toBeNull();
    h.add('one');
    h.add('two');
    h.add('two');
    h.add('  ');
    expect(h.up()).toBe('two');
    expect(h.walking).toBe(true);
    expect(h.up()).toBe('one');
    expect(h.up()).toBeNull();
    expect(h.down()).toBe('two');
    expect(h.down()).toBe('');
    expect(h.walking).toBe(false);
    expect(h.down()).toBeNull();
  });
});

describe('theme', () => {
  const old = process.env['NO_COLOR'];
  afterEach(() => {
    if (old === undefined) delete process.env['NO_COLOR'];
    else process.env['NO_COLOR'] = old;
  });

  it('gives colors, and none with NO_COLOR', () => {
    delete process.env['NO_COLOR'];
    expect(fg('error')).toEqual({ color: 'red' });
    expect(fg('agent')).toEqual({ color: '#636ff6' });
    process.env['NO_COLOR'] = '1';
    expect(fg('error')).toEqual({});
  });

  it('formats the model, tokens and cost', () => {
    expect(modelShortName('google/gemma-4-31b-it')).toBe('gemma-4-31b');
    expect(modelShortName('google/gemma-4-26b-a4b-it:free')).toBe(
      'gemma-4-26b-a4b:free'
    );
    expect(modelShortName('mock')).toBe('mock');
    expect(formatTokens(12345)).toBe('12.3k');
    expect(formatCost(0.0123)).toBe('$0.01');
    expect(formatCost(0.0042)).toBe('$0.004');
    expect(formatCost(0)).toBe('$0.00');
    expect(formatCost(0.0002)).toBe('<$0.001');
  });
});
