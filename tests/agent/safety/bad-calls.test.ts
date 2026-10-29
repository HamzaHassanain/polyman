/**
 * Group 4: bad tool calls, and group 6: no shell. A wrong call is an error
 * the model reads, and the tool never runs.
 */

import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cliTools } from '../../../src/agent/tools/cli-tools';
import { fsTools } from '../../../src/agent/tools/fs-tools';
import {
  makeFolders,
  makeHarness,
  removeFolders,
  spyTool,
  stateOf,
  type Folders,
} from './helpers';

let f: Folders;

beforeEach(() => {
  f = makeFolders();
});

afterEach(() => {
  removeFolders(f);
});

describe('safety: bad tool calls', () => {
  it('an unknown tool is an error that lists the real tools', async () => {
    const h = makeHarness(f.root, { mode: 'auto-edit' });
    for (const name of [
      'bash',
      'shell',
      'exec',
      'run_command',
      '',
      'Write_File',
    ]) {
      const out = await h.call(name, { command: 'rm -rf ~' });
      expect(out.isError).toBe(true);
      expect(out.content).toContain(`Unknown tool "${name}"`);
      expect(out.content).toContain('write_file');
    }
    expect(h.runner.calls).toHaveLength(0);
  });

  it('wrong argument types are refused and nothing is written', async () => {
    const spy = spyTool('spy_write');
    const h = makeHarness(f.root, { mode: 'auto-edit', extraTools: [spy] });
    const before = stateOf(f.root);

    const badPath = await h.call('write_file', { path: 123, content: 'x' });
    expect(badPath.isError).toBe(true);
    expect(badPath.content).toContain('args.path: expected string');

    const badContent = await h.call('write_file', {
      path: 'a.txt',
      content: { evil: true },
    });
    expect(badContent.isError).toBe(true);
    expect(badContent.content).toContain('args.content: expected string');

    const badOffset = await h.call('read_file', {
      path: 'Config.json',
      offset: 1.5,
    });
    expect(badOffset.isError).toBe(true);

    expect((await h.call('spy_write', { path: ['a', 'b'] })).isError).toBe(
      true
    );
    expect(spy.runs).toHaveLength(0);
    expect(stateOf(f.root)).toEqual(before);
  });

  it('missing required arguments are refused', async () => {
    const h = makeHarness(f.root, { mode: 'auto-edit' });
    const write = await h.call('write_file', { path: 'a.txt' });
    expect(write.isError).toBe(true);
    expect(write.content).toContain('missing required property "content"');
    const edit = await h.call('edit_file', {
      path: 'Config.json',
      new_text: 'x',
    });
    expect(edit.isError).toBe(true);
    expect(edit.content).toContain('"old_text"');
    expect(fs.existsSync(path.join(f.root, 'a.txt'))).toBe(false);
  });

  it('argsError from the provider stops the call, even with good-looking args', async () => {
    const spy = spyTool('spy_write');
    const h = makeHarness(f.root, { mode: 'auto-edit', extraTools: [spy] });
    const out = await h.raw({
      id: 'c1',
      name: 'write_file',
      args: { path: 'a.txt', content: 'x' },
      argsError: 'Unexpected token } in JSON at position 12',
    });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('not valid JSON');
    expect(fs.existsSync(path.join(f.root, 'a.txt'))).toBe(false);

    const spied = await h.raw({
      id: 'c2',
      name: 'spy_write',
      args: '{"path": "a',
      argsError: 'Unterminated string',
    });
    expect(spied.isError).toBe(true);
    expect(spy.runs).toHaveLength(0);
  });

  it('arguments that are not an object are refused', async () => {
    const spy = spyTool('spy_write');
    const h = makeHarness(f.root, { mode: 'auto-edit', extraTools: [spy] });
    for (const args of [null, undefined, 'path=a.txt', ['a.txt'], 42, true]) {
      const out = await h.call('spy_write', args);
      expect(out.isError).toBe(true);
      expect(out.content).toContain('args: expected object');
    }
    expect(spy.runs).toHaveLength(0);
  });

  it('extra arguments are refused (no cwd, mode or shell flags)', async () => {
    const spy = spyTool('spy_write');
    const h = makeHarness(f.root, { mode: 'auto-edit', extraTools: [spy] });
    const out = await h.call('write_file', {
      path: 'a.txt',
      content: 'x',
      mode: '0777',
    });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('unknown property "mode"');
    expect((await h.call('spy_write', { path: 'a', cwd: '/' })).isError).toBe(
      true
    );
    expect((await h.call('verify', { shell: 'bash -c "id"' })).isError).toBe(
      true
    );
    expect(spy.runs).toHaveLength(0);
    expect(h.runner.calls).toHaveLength(0);
    expect(fs.existsSync(path.join(f.root, 'a.txt'))).toBe(false);
  });

  it('constructor and toString are refused as extra arguments', async () => {
    const spy = spyTool('spy_write');
    const h = makeHarness(f.root, { mode: 'auto-edit', extraTools: [spy] });
    for (const key of ['constructor', 'toString', 'hasOwnProperty']) {
      const args = JSON.parse(`{"path": "a", "${key}": {"x": 1}}`) as unknown;
      expect((await h.call('spy_write', args)).isError).toBe(true);
    }
    expect(spy.runs).toHaveLength(0);
  });

  // `properties.__proto__` is Object.prototype, an object, so a plain
  // `properties[key]` lookup took it as a schema with no rules and
  // `additionalProperties: false` did not stop a `__proto__` argument.
  it('a __proto__ argument is refused like any unknown property', async () => {
    const spy = spyTool('spy_write');
    const h = makeHarness(f.root, { mode: 'auto-edit', extraTools: [spy] });
    const args = JSON.parse('{"path": "a", "__proto__": {"x": 1}}') as unknown;
    const out = await h.call('spy_write', args);
    expect(out.isError).toBe(true);
    expect(spy.runs).toHaveLength(0);
  });

  it('a tool that needs a problem does not run before there is one', async () => {
    const spy = spyTool('spy_write');
    const h = makeHarness(f.root, {
      mode: 'auto-edit',
      problemDir: null,
      extraTools: [spy],
    });
    for (const name of ['write_file', 'read_file', 'verify', 'spy_write']) {
      const out = await h.call(name, { path: 'a.txt', content: 'x' });
      expect(out.isError).toBe(true);
    }
    const out = await h.call('spy_write', { path: 'a.txt' });
    expect(out.content).toContain('no problem folder');
    expect(spy.runs).toHaveLength(0);
    expect(h.runner.calls).toHaveLength(0);
  });

  it('names that look like CLI options or paths never reach the runner', async () => {
    const h = makeHarness(f.root, { mode: 'auto-edit' });
    const bad: [string, Record<string, unknown>][] = [
      ['run_solution', { name: '--help' }],
      ['run_solution', { name: '-t' }],
      ['run_solution', { name: 'main', testset: '--all' }],
      ['run_solution', { name: 'main;rm -rf ~' }],
      ['run_solution', { name: '../main' }],
      ['generate', { testset: 'tests; rm -rf ~' }],
      ['validate', { testset: '-v' }],
      ['test_target', { what: '--force' }],
      ['test_target', { what: 'checker/../../x' }],
      ['test_target', { what: '' }],
      ['create_problem', { name: '../evil' }],
      ['create_problem', { name: '/tmp/evil' }],
      ['create_problem', { name: '-rf' }],
      ['create_problem', { name: 'Pairs' }],
      ['create_problem', { name: 'a b' }],
    ];
    for (const [name, args] of bad) {
      const out = await h.call(name, args);
      expect(out.isError, `${name} ${JSON.stringify(args)}`).toBe(true);
      expect(out.content).toMatch(/Invalid/);
    }
    expect(h.runner.calls).toHaveLength(0);
    expect(fs.existsSync(path.join(f.base, 'evil'))).toBe(false);
  });

  it('a tool that throws becomes an error result, the registry does not throw', async () => {
    const boom = spyTool('boom', {
      risk: 'read',
      run: () => Promise.reject(new Error('kaboom')),
    });
    const sync = spyTool('sync_boom', {
      risk: 'read',
      run: () => {
        throw new Error('sync kaboom');
      },
    });
    const weird = spyTool('weird', {
      risk: 'read',
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      run: () => Promise.reject('a plain string, not an Error'),
    });
    const h = makeHarness(f.root, { extraTools: [boom, sync, weird] });
    const a = await h.call('boom', { path: 'x' });
    expect(a).toMatchObject({ isError: true, content: 'kaboom' });
    const b = await h.call('sync_boom', { path: 'x' });
    expect(b).toMatchObject({ isError: true, content: 'sync kaboom' });
    const c = await h.call('weird', { path: 'x' });
    expect(c).toMatchObject({
      isError: true,
      content: 'a plain string, not an Error',
    });
  });
});

/** The tools W4 allows, from design/agent/briefs/W4-runner-and-tools.md. */
const ALLOWED_TOOLS = [
  'create_problem',
  'edit_file',
  'generate',
  'list_files',
  'read_file',
  'run_solution',
  'test_target',
  'validate',
  'verify',
  'write_file',
];

/** Polyman commands the CLI tools may run. */
const ALLOWED_COMMANDS = ['generate', 'validate', 'run', 'test', 'verify'];

describe('safety: no shell', () => {
  it('the registry has exactly the allowed tools', () => {
    const h = makeHarness(f.root);
    const names = h.registry
      .specs()
      .map(s => s.name)
      .sort();
    expect(names).toEqual(ALLOWED_TOOLS);
  });

  it('no tool looks like a shell or takes a free command', () => {
    const tools = [...fsTools(), ...cliTools()];
    for (const tool of tools) {
      expect(tool.name).not.toMatch(
        /shell|bash|exec|command|eval|spawn|system/
      );
      const props = Object.keys(tool.parameters['properties'] ?? {});
      for (const prop of props) {
        expect(prop).not.toMatch(/^(command|cmd|shell|script|argv|args|exec)$/);
      }
      expect(tool.parameters['additionalProperties']).toBe(false);
    }
  });

  it('every run tool starts one fixed polyman command, args as an array', async () => {
    const h = makeHarness(f.root, { mode: 'auto-edit' });
    await h.call('generate', {});
    await h.call('validate', { testset: 'tests' });
    await h.call('run_solution', { name: 'main' });
    await h.call('test_target', { what: 'checker' });
    await h.call('verify', {});
    expect(h.runner.calls).toHaveLength(5);
    for (const { args, opts } of h.runner.calls) {
      expect(ALLOWED_COMMANDS).toContain(args[0]);
      expect(args).toContain('--json');
      for (const arg of args) expect(arg).not.toMatch(/\s/);
      expect(opts.cwd).toBe(f.root);
    }
  });

  it('create_problem runs only new and download-testlib', async () => {
    const h = makeHarness(f.root, { mode: 'auto-edit', problemDir: null });
    const ctx = h.ctx();
    const out = await h.registry.run(
      { id: 'c1', name: 'create_problem', args: { name: 'pairs-sum' } },
      ctx
    );
    expect(out.isError ?? false).toBe(false);
    expect(h.runner.calls.map(c => c.args)).toEqual([
      ['new', 'pairs-sum', '--json'],
      ['download-testlib', '--json'],
    ]);
  });
});
