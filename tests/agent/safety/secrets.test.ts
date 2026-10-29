/**
 * Group 7: secrets. An API key in an error must come out redacted. The fake
 * key is built at runtime, so no key-like text is in the repo.
 */

import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentSession } from '../../../src/agent/core/session';
import { SimpleEventBus } from '../../../src/agent/core/event-bus';
import type { SeqEvent } from '../../../src/agent/core/events';
import { MockProvider } from '../../../src/agent/providers/mock';
import { redact, redactKnown } from '../../../src/agent/providers/retry';
import {
  ProviderError,
  type ChatRequest,
} from '../../../src/agent/providers/types';
import { NodeCliRunner, childEnv } from '../../../src/agent/runner/cli-runner';
import { fsTools } from '../../../src/agent/tools/fs-tools';
import { DefaultPermissionGate } from '../../../src/agent/tools/permissions';
import { DefaultToolRegistry } from '../../../src/agent/tools/registry';
import { FolderSandbox } from '../../../src/agent/tools/sandbox';
import type { Tool } from '../../../src/agent/tools/types';
import {
  SpyRunner,
  makeFolders,
  removeFolders,
  spyTool,
  type Folders,
} from './helpers';

const KEY = ['sk', 'or', 'v1', 'a'.repeat(64)].join('-');

let f: Folders;

beforeEach(() => {
  f = makeFolders();
});

afterEach(() => {
  removeFolders(f);
});

/** A session with the real registry, gate and sandbox, and `KEY` known. */
function makeSession(provider: MockProvider, tools: Tool[] = []) {
  const bus = new SimpleEventBus();
  const events: SeqEvent[] = [];
  bus.on(e => events.push(e));
  const permissions = new DefaultPermissionGate(bus, 'auto-edit');
  const registry = new DefaultToolRegistry({ permissions });
  for (const tool of tools) registry.register(tool);
  const sandbox = new FolderSandbox(f.root);
  const session = new AgentSession({
    provider,
    model: 'mock-model',
    tools: registry,
    permissions,
    bus,
    buildSystemPrompt: () => Promise.resolve('You build problems.'),
    makeToolContext: signal => ({
      problemDir: f.root,
      signal,
      runner: new SpyRunner(),
      sandbox,
      progress: () => {},
      setProblemDir: () => {},
    }),
    secrets: () => [KEY],
    maxSteps: 5,
    contextBudgetTokens: 32000,
    maxOutputTokens: 8000,
    temperature: 0.3,
  });
  return { session, events };
}

/** Everything the model was sent, as one string. */
function sentToModel(requests: readonly ChatRequest[]): string {
  return JSON.stringify(requests.map(r => r.messages));
}

describe('safety: secrets', () => {
  it('redact hides an OpenRouter-style key it was not told about', () => {
    const out = redact(`HTTP 401: invalid key ${KEY} for this account`, []);
    expect(out).not.toContain(KEY);
    expect(out).not.toContain('a'.repeat(20));
    expect(out).toContain('***');
    expect(out).toContain('invalid key');
  });

  it('redact hides a known secret of any shape', () => {
    const custom = 'hunter2polygon';
    const out = redact(`polygon said: bad secret ${custom}!`, [custom]);
    expect(out).not.toContain(custom);
    expect(out).toContain('polygon said');
  });

  it('redact leaves normal tool messages alone', () => {
    const text = 'verify FAILED at "validate": tests #3 is invalid';
    expect(redact(text, [KEY])).toBe(text);
  });

  it('a provider error with the key ends the turn redacted', async () => {
    const provider = new MockProvider([
      {
        error: new ProviderError('auth', `HTTP 401: No auth for key ${KEY}`, {
          status: 401,
        }),
      },
    ]);
    const { session, events } = makeSession(provider);
    expect(await session.send('hi')).toBe('error');
    const end = events.find(e => e.type === 'turn_end');
    expect(end).toMatchObject({ type: 'turn_end', reason: 'error' });
    expect(JSON.stringify(end)).not.toContain(KEY);
    expect(JSON.stringify(events)).not.toContain(KEY);
  });

  it('a plain error with the key in a URL is redacted too', async () => {
    const provider = new MockProvider([]);
    provider.stream = () => {
      throw new Error(`fetch failed: https://openrouter.ai/x?key=${KEY}`);
    };
    const { session, events } = makeSession(provider);
    expect(await session.send('hi')).toBe('error');
    expect(JSON.stringify(events)).not.toContain(KEY);
  });

  // A tool error with the key (a CLI error, a program that prints its env)
  // must not reach the model, the history or the `tool_result` summary.
  it('a tool error with the key reaches neither the model nor the UI', async () => {
    const leaky = spyTool('leaky', {
      risk: 'read',
      run: () => Promise.reject(new Error(`401 from server, key=${KEY}`)),
    });
    const provider = new MockProvider([
      { toolCall: { name: 'leaky', args: { path: 'x' } } },
      { text: 'ok' },
    ]);
    const { session, events } = makeSession(provider, [leaky]);
    expect(await session.send('go')).toBe('done');
    expect(JSON.stringify(events)).not.toContain(KEY);
    expect(sentToModel(provider.requests)).not.toContain(KEY);
    expect(JSON.stringify(session.messages)).not.toContain(KEY);
  });

  it('tool output keeps code that only looks like a key', () => {
    const code = 'int key_count = 0; // sk-test ' + 'x'.repeat(50);
    expect(redactKnown(`${code} ${KEY}`, [KEY])).toBe(`${code} ***`);
  });

  it('the CLI child env has no *_API_KEY or preset key vars', () => {
    const env = childEnv({
      PATH: '/usr/bin',
      HOME: '/home/u',
      OPENROUTER_API_KEY: KEY,
      ANTHROPIC_API_KEY: KEY,
      polygon_api_key: KEY,
      SOME_TOOL_API_KEY: KEY,
      POLYMAN_CXX: 'g++',
    });
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/u',
      POLYMAN_CXX: 'g++',
    });
  });

  it('a file outside the folder with a key cannot be read by the model', async () => {
    const keyFile = path.join(f.outside, 'ai.json');
    fs.writeFileSync(keyFile, JSON.stringify({ openrouter: KEY }));
    const provider = new MockProvider([
      { toolCall: { name: 'read_file', args: { path: keyFile } } },
      { toolCall: { name: 'read_file', args: { path: '../outside/ai.json' } } },
      { text: 'ok' },
    ]);
    const { session, events } = makeSession(provider, fsTools());
    expect(await session.send('read the key')).toBe('done');
    expect(sentToModel(provider.requests)).not.toContain(KEY);
    expect(JSON.stringify(events)).not.toContain(KEY);
  });

  // A generator or solution the model wrote runs under the CLI child, so the
  // child must not get OPENROUTER_API_KEY (or other *_API_KEY vars), or it
  // could print the key into the result and the log file.
  it('the CLI child does not get the provider API key env vars', async () => {
    const script = path.join(f.base, 'env-cli.js');
    fs.writeFileSync(
      script,
      // Prints only OPENROUTER_API_KEY, never the whole env.
      'const keys = Object.entries(process.env).filter(([k]) => k === "OPENROUTER_API_KEY");\n' +
        'process.stdout.write(JSON.stringify(Object.fromEntries(keys)) + "\\n");\n'
    );
    const runner = new NodeCliRunner({
      cliPath: script,
      logDir: () => path.join(f.base, 'logs'),
    });
    const saved = process.env['OPENROUTER_API_KEY'];
    process.env['OPENROUTER_API_KEY'] = KEY;
    try {
      const result = await runner.run([], {
        cwd: f.root,
        timeoutMs: 20_000,
        signal: new AbortController().signal,
      });
      expect(result.stdoutTail).not.toContain(KEY);
    } finally {
      if (saved === undefined) delete process.env['OPENROUTER_API_KEY'];
      else process.env['OPENROUTER_API_KEY'] = saved;
    }
  });
});
