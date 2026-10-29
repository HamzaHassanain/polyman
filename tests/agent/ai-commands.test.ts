import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  aiListAction,
  aiLoginAction,
  aiLogoutAction,
  aiModelsAction,
  aiUseAction,
  type AiIo,
} from '../../src/agent/ai-commands';
import { KeyStore } from '../../src/agent/providers/key-store';
import { ModelCatalog } from '../../src/agent/providers/model-catalog';
import { fixtureResponse, readModelsFixture } from '../fixtures/agent';
import { PolymanError } from '../../src/errors';

const fsFault = vi.hoisted(() => ({ failRename: false }));

// Lets a test make renameSync fail, to reach the error path of write().
vi.mock('fs', async importOriginal => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (fsFault.failRename) {
        throw Object.assign(new Error('rename failed'), { code: 'EIO' });
      }
      return actual.renameSync(...args);
    },
  };
});

const KEY = 'sk-deepseek-1234567890abcd';
const posixOnly = process.platform === 'win32' ? it.skip : it;
const ENV_KEY = 'sk-openai-env-0987654321';

let home: string;
let output: string[];

const makeStore = (env: NodeJS.ProcessEnv = {}) => new KeyStore({ home, env });
const printed = () => output.join('\n');

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'polyman-ai-cmd-'));
  output = [];
  const capture = (...args: unknown[]) => {
    output.push(args.map(String).join(' '));
  };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
  fsFault.failRename = false;
  rmSync(home, { recursive: true, force: true });
});

const caught = async (run: Promise<void>): Promise<PolymanError> => {
  try {
    await run;
  } catch (error) {
    return error as PolymanError;
  }
  throw new Error('expected the command to fail');
};

describe('ai login', () => {
  it('saves a key from the hidden prompt and only prints it masked', async () => {
    const store = makeStore();
    const promptHidden = vi.fn(() => Promise.resolve(`${KEY}\n`));
    await aiLoginAction('deepseek', {}, { store, promptHidden });
    expect(promptHidden).toHaveBeenCalledWith('DeepSeek API key (hidden): ');
    expect(store.getKey('deepseek')).toEqual({ key: KEY, source: 'file' });
    expect(printed()).toContain('sk-...abcd');
    expect(printed()).not.toContain(KEY);
  });

  it('reads the key from stdin with --key-stdin', async () => {
    const store = makeStore();
    const readStdin = vi.fn(() => Promise.resolve(`  ${KEY}\n`));
    const promptHidden = vi.fn();
    await aiLoginAction(
      'deepseek',
      { keyStdin: true },
      { store, readStdin, promptHidden }
    );
    expect(readStdin).toHaveBeenCalledOnce();
    expect(promptHidden).not.toHaveBeenCalled();
    expect(store.getKey('deepseek')?.key).toBe(KEY);
  });

  it('says when the env var wins over the saved key', async () => {
    const store = makeStore({ OPENAI_API_KEY: ENV_KEY });
    await aiLoginAction(
      'openai',
      { keyStdin: true },
      { store, readStdin: () => Promise.resolve(KEY) }
    );
    expect(printed()).toMatch(/OPENAI_API_KEY is set/);
    expect(printed()).not.toContain(ENV_KEY);
  });

  it('refuses an unknown provider with exit code 2', async () => {
    const err = await caught(aiLoginAction('nope', {}, { store: makeStore() }));
    expect(err.exitCode).toBe(2);
    expect(err.hint).toContain('deepseek');
  });

  it('refuses ollama, which needs no key', async () => {
    const err = await caught(
      aiLoginAction('ollama', {}, { store: makeStore() })
    );
    expect(err.message).toMatch(/does not need a key/);
  });

  it('refuses a bad key and saves nothing', async () => {
    const store = makeStore();
    const err = await caught(
      aiLoginAction(
        'deepseek',
        {},
        { store, promptHidden: () => Promise.resolve('short') }
      )
    );
    expect(err.message).toBe('The key is too short.');
    expect(existsSync(store.path)).toBe(false);
  });

  it('refuses --base-url for a built-in provider', async () => {
    const err = await caught(
      aiLoginAction(
        'openai',
        { baseUrl: 'https://evil.io/v1' },
        { store: makeStore(), promptHidden: () => Promise.resolve(KEY) }
      )
    );
    expect(err.message).toMatch(/only for the custom provider/);
  });

  it('saves custom with its base URL and models', async () => {
    const store = makeStore();
    await aiLoginAction(
      'custom',
      { baseUrl: 'https://my.server/v1/', model: ['m1', ' ', 'm2'] },
      { store, promptHidden: () => Promise.resolve(KEY) }
    );
    expect(store.read().providers['custom']).toEqual({
      apiKey: KEY,
      baseUrl: 'https://my.server/v1',
      models: ['m1', 'm2'],
    });
    expect(store.keyForRequest('custom', 'https://my.server/v1/x')).toBe(KEY);
  });

  it('needs --base-url for custom, and refuses plain http to a remote host', async () => {
    const io: AiIo = {
      store: makeStore(),
      promptHidden: () => Promise.resolve(KEY),
    };
    expect((await caught(aiLoginAction('custom', {}, io))).message).toMatch(
      /needs --base-url/
    );
    expect(
      (
        await caught(
          aiLoginAction('custom', { baseUrl: 'http://10.0.0.5/v1' }, io)
        )
      ).message
    ).toMatch(/localhost/);
  });

  it('removes the new key from the message of a failure', async () => {
    const store = makeStore();
    vi.spyOn(store, 'setKey').mockImplementation(() => {
      throw new Error(`write failed for ${KEY}`);
    });
    const err = await caught(
      aiLoginAction(
        'deepseek',
        {},
        { store, promptHidden: () => Promise.resolve(KEY) }
      )
    );
    expect(err.message).toBe('write failed for [redacted]');
  });

  it('removes known keys from the message and hint of a PolymanError', async () => {
    const store = makeStore({ OPENAI_API_KEY: ENV_KEY });
    vi.spyOn(store, 'read').mockImplementation(() => {
      throw new PolymanError(`bad ${ENV_KEY}`, 2, `hint ${ENV_KEY}`);
    });
    const err = await caught(aiListAction({ store }));
    expect(err).toBeInstanceOf(PolymanError);
    expect(err.exitCode).toBe(2);
    expect(err.message).toBe('bad [redacted]');
    expect(err.hint).toBe('hint [redacted]');
  });

  it('fails cleanly when the write fails', async () => {
    const store = makeStore();
    // A folder where ai.json should be makes the rename fail.
    mkdirSync(store.path, { recursive: true });
    const err = await caught(
      aiLoginAction(
        'deepseek',
        {},
        { store, promptHidden: () => Promise.resolve(KEY) }
      )
    );
    expect(err.message).not.toContain(KEY);
    expect(printed()).not.toContain(KEY);
  });

  it('fails in write() itself, leaves no temp file and keeps the old ai.json', async () => {
    const store = makeStore();
    store.setKey('openai', 'sk-old-key-1234567890');
    const before = readFileSync(store.path, 'utf-8');
    // read() works, so the failure comes from write().
    fsFault.failRename = true;
    const err = await caught(
      aiLoginAction(
        'deepseek',
        {},
        { store, promptHidden: () => Promise.resolve(KEY) }
      )
    );
    fsFault.failRename = false;
    expect(err.message).toContain('rename failed');
    expect(err.message).not.toContain(KEY);
    expect(printed()).not.toContain(KEY);
    expect(readdirSync(store.dir)).toEqual(['ai.json']);
    expect(readFileSync(store.path, 'utf-8')).toBe(before);
  });
});

describe('a .polyman folder others can open', () => {
  const WARNING = /other users can open it/;
  const warnings = () => output.filter(line => WARNING.test(line)).length;
  const mode = (path: string) => statSync(path).mode & 0o777;
  const makeDir = (dirMode: number) => {
    const dir = join(home, '.polyman');
    mkdirSync(dir, { mode: dirMode });
    chmodSync(dir, dirMode);
    return dir;
  };
  const login = (store: KeyStore) =>
    aiLoginAction(
      'deepseek',
      { keyStdin: true },
      { store, readStdin: () => Promise.resolve(KEY) }
    );

  posixOnly(
    'warns once for an existing 0755 folder and keeps its mode',
    async () => {
      const dir = makeDir(0o755);
      const store = makeStore();
      await login(store);
      expect(warnings()).toBe(1);
      expect(printed()).toContain(`${dir} has mode 0755`);
      expect(printed()).toContain(`chmod 700 ${dir}`);
      expect(printed()).not.toContain(KEY);
      expect(mode(dir)).toBe(0o755);
      expect(mode(store.path)).toBe(0o600);
      expect(store.getKey('deepseek')?.key).toBe(KEY);
    }
  );

  posixOnly('does not warn for an existing 0700 folder', async () => {
    makeDir(0o700);
    const store = makeStore();
    await login(store);
    expect(warnings()).toBe(0);
    expect(mode(store.path)).toBe(0o600);
  });

  posixOnly('does not warn for the folder polyman creates', async () => {
    const store = makeStore();
    await login(store);
    await aiUseAction('deepseek/deepseek-flash', { store });
    expect(warnings()).toBe(0);
    expect(mode(store.dir)).toBe(0o700);
    expect(mode(store.path)).toBe(0o600);
  });

  posixOnly('also warns on ai use and ai logout', async () => {
    makeDir(0o755);
    const store = makeStore();
    await aiUseAction('deepseek/deepseek-flash', { store });
    expect(warnings()).toBe(1);
    await aiLogoutAction('deepseek', { store });
    expect(warnings()).toBe(2);
  });

  it('does not warn on Windows', async () => {
    makeDir(0o755);
    const platform = Object.getOwnPropertyDescriptor(process, 'platform');
    Object.defineProperty(process, 'platform', { value: 'win32' });
    try {
      await login(makeStore());
    } finally {
      if (platform) Object.defineProperty(process, 'platform', platform);
    }
    expect(warnings()).toBe(0);
  });
});

describe('ai logout', () => {
  it('removes a saved key', async () => {
    const store = makeStore();
    store.setKey('deepseek', KEY);
    await aiLogoutAction('deepseek', { store });
    expect(store.getKey('deepseek')).toBeUndefined();
    expect(printed()).toMatch(/Removed the DeepSeek key/);
  });

  it('says when there was no key', async () => {
    await aiLogoutAction('deepseek', { store: makeStore() });
    expect(printed()).toMatch(/No saved DeepSeek key/);
  });

  it('says when the env var is still set', async () => {
    await aiLogoutAction('openai', {
      store: makeStore({ OPENAI_API_KEY: ENV_KEY }),
    });
    expect(printed()).toMatch(/OPENAI_API_KEY is still set/);
    expect(printed()).not.toContain(ENV_KEY);
  });
});

describe('ai list', () => {
  it('shows every provider, masked keys and the default', async () => {
    const store = makeStore({ OPENAI_API_KEY: ENV_KEY });
    store.setKey('deepseek', KEY);
    store.setKey('custom', 'sk-custom-key-000111', {
      baseUrl: 'https://my.server/v1',
    });
    store.setDefault('deepseek', 'deepseek-flash');
    await aiListAction({ store });
    const text = printed();
    expect(text).toContain('Default model: deepseek/deepseek-flash');
    expect(text).toMatch(/openai\s+key from OPENAI_API_KEY sk-\.\.\.4321/);
    expect(text).toMatch(/deepseek\s+key saved sk-\.\.\.abcd/);
    expect(text).toMatch(/groq\s+no key/);
    expect(text).toMatch(/ollama\s+no key needed/);
    expect(text).toMatch(/custom\s+key saved .*, https:\/\/my.server\/v1/);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(ENV_KEY);
    expect(text).not.toContain('sk-custom-key-000111');
  });

  it('says when no default is set', async () => {
    await aiListAction({ store: makeStore() });
    expect(printed()).toMatch(/Default model: not set/);
  });

  it('fails with exit code 2 on a broken ai.json, without its content', async () => {
    const store = makeStore();
    mkdirSync(store.dir, { recursive: true });
    writeFileSync(store.path, `{"providers":{"x":{"apiKey":"${KEY}"`);
    const err = await caught(aiListAction({ store }));
    expect(err.exitCode).toBe(2);
    expect(`${err.message} ${err.hint ?? ''}`).not.toContain(KEY);
  });

  it.each([
    ['logout', (io: AiIo) => aiLogoutAction('deepseek', io)],
    ['use', (io: AiIo) => aiUseAction('deepseek/deepseek-flash', io)],
    ['models', (io: AiIo) => aiModelsAction('custom', {}, io)],
    [
      'login',
      (io: AiIo) =>
        aiLoginAction(
          'deepseek',
          {},
          { ...io, promptHidden: () => Promise.resolve(KEY) }
        ),
    ],
  ])(
    'ai %s fails with exit code 2 on a broken ai.json and leaves it alone',
    async (_name, run) => {
      const store = makeStore();
      mkdirSync(store.dir, { recursive: true });
      const content = `{"providers":{"x":{"apiKey":"${KEY}"`;
      writeFileSync(store.path, content);
      const err = await caught(run({ store }));
      expect(err.exitCode).toBe(2);
      expect(`${err.message} ${err.hint ?? ''}`).not.toContain(KEY);
      expect(printed()).not.toContain(KEY);
      expect(readFileSync(store.path, 'utf-8')).toBe(content);
      expect(readdirSync(store.dir)).toEqual(['ai.json']);
    }
  );
});

describe('ai models', () => {
  it('lists the known models of one provider, with prices', async () => {
    await aiModelsAction('groq', {}, { store: makeStore() });
    const text = printed();
    expect(text).toContain('Groq (groq)');
    expect(text).toMatch(
      /openai\/gpt-oss-120b .*context 131,072 .*\$0\.15 in \/ \$0\.60 out/
    );
    expect(text).not.toContain('DeepSeek');
  });

  it('lists every provider when none is given', async () => {
    await aiModelsAction(undefined, {}, { store: makeStore() });
    expect(printed()).toContain('OpenAI (openai)');
    expect(printed()).toContain('Ollama (local) (ollama)');
  });

  it('lists the models saved for custom', async () => {
    const store = makeStore();
    store.setKey('custom', KEY, {
      baseUrl: 'https://my.server/v1',
      models: ['my-model'],
    });
    await aiModelsAction('custom', {}, { store });
    expect(printed()).toMatch(/my-model\s+tools/);
  });

  it('refuses an unknown provider', async () => {
    const err = await caught(
      aiModelsAction('nope', {}, { store: makeStore() })
    );
    expect(err.exitCode).toBe(2);
  });
});

describe('ai use', () => {
  it('sets the default', async () => {
    const store = makeStore();
    store.setKey('deepseek', KEY);
    await aiUseAction('deepseek/deepseek-flash', { store });
    expect(store.read().default).toEqual({
      provider: 'deepseek',
      model: 'deepseek-flash',
    });
    expect(printed()).not.toMatch(/⚠|not in the known models|No DeepSeek key/);
  });

  it('keeps a / inside the model id', async () => {
    const store = makeStore();
    await aiUseAction('groq/openai/gpt-oss-120b', { store });
    expect(store.read().default).toEqual({
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
    });
  });

  it('warns about an unknown model and a missing key', async () => {
    await aiUseAction('groq/my-model', { store: makeStore() });
    expect(printed()).toMatch(/not in the known models of Groq/);
    expect(printed()).toMatch(/No Groq key yet/);
  });

  it('warns when the model can only chat', async () => {
    const store = makeStore();
    store.update(s => {
      s.overrides['ollama/tiny'] = { tools: false };
    });
    await aiUseAction('ollama/tiny', { store });
    expect(printed()).toMatch(/can only chat, it cannot build the problem/);
  });

  it.each(['deepseek', 'deepseek/', '/model', ''])(
    'refuses %j with exit code 2',
    async spec => {
      const err = await caught(aiUseAction(spec, { store: makeStore() }));
      expect(err.exitCode).toBe(2);
      expect(err.hint).toMatch(/polyman ai use/);
    }
  );

  it('refuses an unknown provider', async () => {
    const err = await caught(aiUseAction('nope/model', { store: makeStore() }));
    expect(err.message).toMatch(/Unknown provider/);
  });
});

describe('ai models with the live OpenRouter list', () => {
  const T0 = Date.UTC(2026, 9, 29, 10, 2);
  const live = () =>
    vi.fn((..._args: Parameters<typeof fetch>) =>
      Promise.resolve(fixtureResponse(readModelsFixture('openrouter-models')))
    );
  const offline = () =>
    vi.fn((..._args: Parameters<typeof fetch>) =>
      Promise.reject(new TypeError('fetch failed'))
    );
  const catalog = (fetchFn: typeof fetch, now = T0) =>
    new ModelCatalog({ home, fetch: fetchFn, now: () => now });

  it('shows every live model as a table', async () => {
    await aiModelsAction(
      'openrouter',
      {},
      { store: makeStore(), catalog: catalog(live()) }
    );
    const text = printed();
    expect(text).toContain('OpenRouter (openrouter): 5 models (live list)');
    expect(text).toMatch(/model\s+tools\s+context\s+\$\/1M in\s+\$\/1M out/);
    expect(text).toMatch(
      /google\/gemma-4-31b-it\s+yes\s+262,144\s+\$0\.20\s+\$0\.40/
    );
    expect(text).toMatch(/google\/gemma-3-4b-it\s+no\s+131,072/);
    expect(text).toMatch(/openrouter\/auto\s+yes\s+2,000,000\s+\?\s+\?/);
  });

  it('filters the ids with --search, case does not matter', async () => {
    await aiModelsAction(
      'openrouter',
      { search: 'DeepSeek' },
      { store: makeStore(), catalog: catalog(live()) }
    );
    const text = printed();
    expect(text).toContain('1 of 5 models match "deepseek"');
    expect(text).toMatch(
      /deepseek\/deepseek-v3\.2\s+yes\s+131,072\s+\$0\.28\s+\$0\.42/
    );
    expect(text).not.toContain('gemma');
  });

  it('says when no model matches', async () => {
    await aiModelsAction(
      'openrouter',
      { search: 'zzz' },
      { store: makeStore(), catalog: catalog(live()) }
    );
    expect(printed()).toContain('0 of 5 models match "zzz"');
  });

  it('says when the list comes from the cache', async () => {
    const store = makeStore();
    await aiModelsAction('openrouter', {}, { store, catalog: catalog(live()) });
    output = [];
    const fetchFn = live();
    await aiModelsAction(
      'openrouter',
      {},
      { store, catalog: catalog(fetchFn, T0 + 60_000) }
    );
    expect(fetchFn).not.toHaveBeenCalled();
    expect(printed()).toContain('(cached list from 2026-10-29T10:02 UTC)');
  });

  it('fetches again with --refresh', async () => {
    const store = makeStore();
    await aiModelsAction('openrouter', {}, { store, catalog: catalog(live()) });
    const fetchFn = live();
    await aiModelsAction(
      'openrouter',
      { refresh: true },
      { store, catalog: catalog(fetchFn) }
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('falls back to the known models when offline', async () => {
    await aiModelsAction(
      'openrouter',
      { search: 'gemma-4' },
      { store: makeStore(), catalog: catalog(offline()) }
    );
    const text = printed();
    expect(text).toContain('Cannot get the live OpenRouter model list');
    expect(text).toContain('OpenRouter (openrouter)');
    expect(text).toMatch(/google\/gemma-4-31b-it .*context 262,144/);
    expect(text).not.toContain('openrouter/auto');
  });

  it('never fetches for "ai models" with no provider', async () => {
    const fetchFn = live();
    await aiModelsAction(
      undefined,
      { search: 'gemma' },
      { store: makeStore(), catalog: catalog(fetchFn) }
    );
    expect(fetchFn).not.toHaveBeenCalled();
    expect(printed()).toContain(
      'Every OpenRouter model, live: polyman ai models openrouter --search <text>'
    );
  });

  it('filters the preset models of other providers too', async () => {
    await aiModelsAction(
      'groq',
      { search: 'nothing-like-this' },
      { store: makeStore(), catalog: catalog(live()) }
    );
    expect(printed()).toContain('no model matches');
  });
});

describe('ai use with the live OpenRouter list', () => {
  const live = () =>
    vi.fn((..._args: Parameters<typeof fetch>) =>
      Promise.resolve(fixtureResponse(readModelsFixture('openrouter-models')))
    );
  const catalog = (fetchFn: typeof fetch) =>
    new ModelCatalog({ home, fetch: fetchFn });

  it('accepts any listed model, with no warning', async () => {
    const store = makeStore({ OPENROUTER_API_KEY: 'sk-or-env-0123456789' });
    await aiUseAction('openrouter/deepseek/deepseek-v3.2', {
      store,
      catalog: catalog(live()),
    });
    expect(store.read().default).toEqual({
      provider: 'openrouter',
      model: 'deepseek/deepseek-v3.2',
    });
    expect(printed()).not.toMatch(/not in the|no tool support|No OpenRouter/);
  });

  it('warns, and still saves, when the id is not in the live list', async () => {
    const store = makeStore({ OPENROUTER_API_KEY: 'sk-or-env-0123456789' });
    await aiUseAction('openrouter/acme/new-model', {
      store,
      catalog: catalog(live()),
    });
    expect(store.read().default?.model).toBe('acme/new-model');
    expect(printed()).toContain(
      'acme/new-model is not in the live OpenRouter model list. It is used as is.'
    );
    expect(printed()).toContain('polyman ai models openrouter --search <text>');
  });

  it('warns when the live list says the model has no tools', async () => {
    await aiUseAction('openrouter/google/gemma-3-4b-it', {
      store: makeStore({ OPENROUTER_API_KEY: 'sk-or-env-0123456789' }),
      catalog: catalog(live()),
    });
    expect(printed()).toMatch(/can only chat, it cannot build the problem/);
  });

  it('uses the known models offline', async () => {
    await aiUseAction('openrouter/acme/new-model', {
      store: makeStore({ OPENROUTER_API_KEY: 'sk-or-env-0123456789' }),
      catalog: catalog(
        vi.fn((..._args: Parameters<typeof fetch>) =>
          Promise.reject(new TypeError('fetch failed'))
        )
      ),
    });
    expect(printed()).toContain(
      'acme/new-model is not in the known models of OpenRouter'
    );
  });

  it('says where to get a key when there is none', async () => {
    await aiUseAction('openrouter/google/gemma-4-31b-it', {
      store: makeStore(),
      catalog: catalog(live()),
    });
    expect(printed()).toContain(
      'No OpenRouter key yet. Run: polyman ai login openrouter (get a key at https://openrouter.ai/keys)'
    );
  });
});
