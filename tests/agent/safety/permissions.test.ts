/**
 * Group 3: permissions. The real gate, registry and sandbox, with the user's
 * answers sent through `resolve()` like the TUI does.
 */

import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Plan } from '../../../src/agent/workflow/types';
import {
  makeFolders,
  makeHarness,
  removeFolders,
  spyTool,
  type Folders,
} from './helpers';

let f: Folders;

beforeEach(() => {
  f = makeFolders();
});

afterEach(() => {
  removeFolders(f);
});

function exists(rel: string): boolean {
  return fs.existsSync(path.join(f.root, rel));
}

/** Lets pending promises and timers run. */
function tick(ms = 20): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

describe('safety: permissions', () => {
  it('ask mode: a write waits for approval and only then writes', async () => {
    const h = makeHarness(f.root, { mode: 'ask' });
    const asked = h.next('approval_needed');
    const running = h.call('write_file', { path: 'a.txt', content: 'x' });
    const approval = await asked;
    expect(approval.title).toBe('Write a.txt');

    await tick();
    expect(exists('a.txt')).toBe(false);

    h.gate.resolve(approval.approvalId, { kind: 'allow_once' });
    const out = await running;
    expect(out.isError ?? false).toBe(false);
    expect(exists('a.txt')).toBe(true);
  });

  it('ask mode: read and run tools do not ask', async () => {
    const h = makeHarness(f.root, { mode: 'ask' });
    await h.call('read_file', { path: 'Config.json' });
    await h.call('verify', {});
    expect(h.count('approval_needed')).toBe(0);
    expect(h.runner.calls).toHaveLength(1);
  });

  it('deny stops the write and the model reads the reason', async () => {
    const h = makeHarness(f.root, { mode: 'ask' });
    h.answerAll({ kind: 'deny', reason: 'do not touch the checker' });
    const out = await h.call('write_file', {
      path: 'checker/chk.cpp',
      content: 'x',
    });
    expect(out.content).toContain('denied');
    expect(out.content).toContain('do not touch the checker');
    expect(exists('checker')).toBe(false);
  });

  it('cancel while waiting stops the call and a late answer does nothing', async () => {
    const h = makeHarness(f.root, { mode: 'ask' });
    const controller = new AbortController();
    const asked = h.next('approval_needed');
    const running = h.call(
      'write_file',
      { path: 'a.txt', content: 'x' },
      controller.signal
    );
    const approval = await asked;
    const resolved = h.next('approval_resolved');
    controller.abort();
    await expect(running).rejects.toThrow();
    expect((await resolved).decision).toEqual({
      kind: 'deny',
      reason: 'cancelled',
    });

    h.gate.resolve(approval.approvalId, { kind: 'allow_once' });
    await tick();
    expect(exists('a.txt')).toBe(false);
  });

  it('an already cancelled call never asks and never runs', async () => {
    const h = makeHarness(f.root, { mode: 'ask' });
    const controller = new AbortController();
    controller.abort();
    await expect(
      h.call('write_file', { path: 'a.txt', content: 'x' }, controller.signal)
    ).rejects.toThrow();
    expect(h.count('approval_needed')).toBe(0);
    expect(exists('a.txt')).toBe(false);
  });

  it('allow_session is remembered for that tool only', async () => {
    const h = makeHarness(f.root, { mode: 'ask' });
    h.answerAll({ kind: 'allow_session' });
    await h.call('write_file', { path: 'a.txt', content: 'one two' });
    expect(h.count('approval_needed')).toBe(1);

    await h.call('write_file', { path: 'b.txt', content: 'x' });
    expect(h.count('approval_needed')).toBe(1);

    await h.call('edit_file', {
      path: 'a.txt',
      old_text: 'one',
      new_text: 'three',
    });
    expect(h.count('approval_needed')).toBe(2);
  });

  it('allow_session does not carry over to a new session', async () => {
    const first = makeHarness(f.root, { mode: 'ask' });
    first.answerAll({ kind: 'allow_session' });
    await first.call('write_file', { path: 'a.txt', content: 'x' });

    const second = makeHarness(f.root, { mode: 'ask' });
    second.answerAll({ kind: 'deny', reason: 'new session' });
    const out = await second.call('write_file', {
      path: 'b.txt',
      content: 'x',
    });
    expect(second.count('approval_needed')).toBe(1);
    expect(out.content).toContain('new session');
    expect(exists('b.txt')).toBe(false);
  });

  it('allow_once is not remembered', async () => {
    const h = makeHarness(f.root, { mode: 'ask' });
    h.answerAll({ kind: 'allow_once' });
    await h.call('write_file', { path: 'a.txt', content: 'x' });
    await h.call('write_file', { path: 'a.txt', content: 'y' });
    expect(h.count('approval_needed')).toBe(2);
  });

  it('a remote tool asks in every mode, even after allow_session', async () => {
    const remote = spyTool('remote_push', { risk: 'remote' });
    for (const mode of ['ask', 'auto-edit', 'plan-approved'] as const) {
      const h = makeHarness(f.root, { mode, extraTools: [remote] });
      h.answerAll({ kind: 'allow_session' });
      await h.call('remote_push', { path: 'x' });
      await h.call('remote_push', { path: 'x' });
      expect(h.count('approval_needed')).toBe(2);
    }
    expect(remote.runs).toHaveLength(6);
  });

  it('plan-approved writes without asking but still respects the sandbox', async () => {
    const h = makeHarness(f.root, {
      mode: 'plan-approved',
      allowWrite: ['solutions/brute.cpp'],
    });
    const own = await h.call('write_file', {
      path: 'solutions/brute.cpp',
      content: 'x',
    });
    expect(own.isError ?? false).toBe(false);

    const config = await h.call('write_file', {
      path: 'Config.json',
      content: '{}',
    });
    expect(config.isError).toBe(true);
    const escape = await h.call('write_file', {
      path: '../outside/x',
      content: 'x',
    });
    expect(escape.isError).toBe(true);
    const testlib = await h.call('write_file', {
      path: 'testlib.h',
      content: 'x',
    });
    expect(testlib.isError).toBe(true);

    expect(h.count('approval_needed')).toBe(0);
    expect(fs.readFileSync(path.join(f.root, 'Config.json'), 'utf8')).toBe(
      '{"name":"pairs"}\n'
    );
    expect(fs.existsSync(path.join(f.outside, 'x'))).toBe(false);
  });

  it('auto-edit does not open the sandbox either', async () => {
    const h = makeHarness(f.root, { mode: 'auto-edit' });
    const out = await h.call('write_file', {
      path: '../outside/x',
      content: 'x',
    });
    expect(out.isError).toBe(true);
    expect(fs.existsSync(path.join(f.outside, 'x'))).toBe(false);
  });

  it('only an approved plan switches the gate to plan-approved', async () => {
    const plan = { tasks: [] } as unknown as Plan;
    const h = makeHarness(f.root, { mode: 'ask' });
    h.answerAll({ kind: 'deny', reason: 'no' });
    await h.gate.askPlan(plan, new AbortController().signal);
    expect(h.gate.mode).toBe('ask');

    const g = makeHarness(f.root, { mode: 'ask' });
    g.answerAll({ kind: 'allow_once' });
    await g.gate.askPlan(plan, new AbortController().signal);
    expect(g.gate.mode).toBe('plan-approved');
  });

  it('a wrong or repeated approval id does not approve anything', async () => {
    const h = makeHarness(f.root, { mode: 'ask' });
    const asked = h.next('approval_needed');
    const running = h.call('write_file', { path: 'a.txt', content: 'x' });
    const approval = await asked;

    h.gate.resolve('approval_999', { kind: 'allow_once' });
    h.gate.resolve('', { kind: 'allow_once' });
    await tick();
    expect(exists('a.txt')).toBe(false);

    h.gate.resolve(approval.approvalId, { kind: 'deny', reason: 'no' });
    await running;
    h.gate.resolve(approval.approvalId, { kind: 'allow_once' });
    await tick();
    expect(exists('a.txt')).toBe(false);
  });

  // Control characters from the model could hide where the write really
  // goes. This path writes Config.json, but a raw title shows only
  // "Write solutions/brute.cpp" in a terminal. The gate escapes them.
  it('approval title has no control characters that can hide the real path', async () => {
    const h = makeHarness(f.root, { mode: 'ask' });
    const asked = h.next('approval_needed');
    const running = h.call('write_file', {
      path: 'solutions/brute.cpp\u001b[8m/../../Config.json',
      content: '{}',
    });
    const approval = await asked;
    h.gate.resolve(approval.approvalId, { kind: 'deny', reason: 'test' });
    await running;
    // eslint-disable-next-line no-control-regex
    const control = /[\u0000-\u001f\u007f]/;
    expect(approval.title).not.toMatch(control);
    expect(approval.command ?? '').not.toMatch(control);
    expect(approval.title).toContain('\\u001b[8m/../../Config.json');
  });

  it('approval title shows bidi overrides as text, not as reordering', async () => {
    const h = makeHarness(f.root, { mode: 'ask' });
    const asked = h.next('approval_needed');
    const running = h.call('write_file', {
      path: 'a\u202enosj.gifnoC\u2066/b\u0085.txt',
      content: '{}',
    });
    const approval = await asked;
    h.gate.resolve(approval.approvalId, { kind: 'deny', reason: 'test' });
    await running;
    expect(approval.title).not.toMatch(
      /[\u0080-\u009f\u202a-\u202e\u2066-\u2069]/
    );
    expect(approval.title).toContain('\\u202e');
    expect(approval.title).toContain('\\u2066');
    expect(approval.title).toContain('\\u0085');
  });
});
