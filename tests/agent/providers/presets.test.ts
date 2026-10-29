import { describe, it, expect } from 'vitest';
import {
  PRESETS,
  getPreset,
  presetIds,
  urlBelongsTo,
  validatePreset,
  type Preset,
} from '../../../src/agent/providers/presets';

const DESIGN_TABLE: Array<[string, Preset['adapter'], string]> = [
  ['openai', 'openai', 'OPENAI_API_KEY'],
  ['anthropic', 'anthropic', 'ANTHROPIC_API_KEY'],
  ['deepseek', 'openai', 'DEEPSEEK_API_KEY'],
  ['qwen', 'openai', 'DASHSCOPE_API_KEY'],
  ['gemini', 'openai', 'GEMINI_API_KEY'],
  ['groq', 'openai', 'GROQ_API_KEY'],
  ['mistral', 'openai', 'MISTRAL_API_KEY'],
  ['openrouter', 'openai', 'OPENROUTER_API_KEY'],
  ['ollama', 'openai', ''],
  ['custom', 'openai', ''],
];

describe('PRESETS', () => {
  it('has the presets of the design, in order', () => {
    expect(presetIds()).toEqual(DESIGN_TABLE.map(([id]) => id));
  });

  it.each(DESIGN_TABLE)('%s uses the %s adapter and %s', (id, adapter, env) => {
    const preset = getPreset(id);
    expect(preset?.adapter).toBe(adapter);
    expect(preset?.envVar).toBe(env);
  });

  it.each(PRESETS.map(p => [p.id, p] as const))(
    '%s has every required field and no problems',
    (_id, preset) => {
      expect(validatePreset(preset)).toEqual([]);
      expect(preset.label).not.toBe('');
      expect(preset.docsUrl).toMatch(/^https:\/\//);
      expect(Array.isArray(preset.models)).toBe(true);
    }
  );

  it('gives every preset except custom a short list of known models', () => {
    for (const preset of PRESETS) {
      if (preset.id === 'custom') continue;
      expect(preset.models.length).toBeGreaterThan(0);
      expect(preset.models.length).toBeLessThanOrEqual(5);
    }
  });

  it('has unique ids', () => {
    const ids = presetIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique env vars and base URLs', () => {
    const envVars = PRESETS.map(p => p.envVar).filter(v => v !== '');
    expect(new Set(envVars).size).toBe(envVars.length);
    const urls = PRESETS.map(p => p.baseUrl).filter(v => v !== '');
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('pairs each key only with its own base URL', () => {
    for (const owner of PRESETS) {
      if (owner.baseUrl === '') continue;
      for (const other of PRESETS) {
        if (other.baseUrl === '') continue;
        const target = `${other.baseUrl}/chat/completions`;
        expect(urlBelongsTo(owner.baseUrl, target)).toBe(other.id === owner.id);
      }
    }
  });

  it('only lets local servers skip the key', () => {
    for (const preset of PRESETS) {
      if (preset.keyRequired) continue;
      expect(['ollama', 'custom']).toContain(preset.id);
    }
  });

  it('uses https for every hosted preset', () => {
    for (const preset of PRESETS) {
      if (preset.id === 'ollama' || preset.id === 'custom') continue;
      expect(preset.baseUrl).toMatch(/^https:\/\//);
    }
  });

  it('names a source for every price', () => {
    for (const preset of PRESETS) {
      for (const model of preset.models) {
        if (model.pricePerMTokIn !== undefined) {
          expect(model.priceSource).toMatch(/^https:\/\/.+, checked \d{4}/);
        }
      }
    }
  });
});

describe('getPreset', () => {
  it('returns undefined for an unknown id', () => {
    expect(getPreset('nope')).toBeUndefined();
  });
});

describe('urlBelongsTo', () => {
  const base = 'https://api.openai.com/v1';

  it.each([
    'https://api.openai.com/v1',
    'https://api.openai.com/v1/',
    'https://api.openai.com/v1/chat/completions',
    'https://api.openai.com/v1/models?limit=5',
  ])('accepts %s', url => {
    expect(urlBelongsTo(base, url)).toBe(true);
  });

  it.each([
    ['another host', 'https://api.deepseek.com/v1/chat/completions'],
    ['a look-alike host', 'https://api.openai.com.evil.io/v1/models'],
    ['http instead of https', 'http://api.openai.com/v1/models'],
    ['another port', 'https://api.openai.com:8443/v1/models'],
    ['a path outside the base', 'https://api.openai.com/v2/models'],
    ['a path that only shares a prefix', 'https://api.openai.com/v10/models'],
    ['user info in the URL', 'https://user:pw@api.openai.com/v1/models'],
    ['a bad URL', 'not a url'],
  ])('rejects %s', (_why, url) => {
    expect(urlBelongsTo(base, url)).toBe(false);
  });

  it('accepts any path when the base has no path', () => {
    expect(
      urlBelongsTo(
        'https://api.anthropic.com',
        'https://api.anthropic.com/v1/messages'
      )
    ).toBe(true);
  });

  it('rejects everything when the base URL is empty', () => {
    expect(urlBelongsTo('', 'https://api.openai.com/v1')).toBe(false);
  });
});

function urlWith(change: Partial<URL>): string {
  const url = new URL('https://api.demo.test/v1');
  Object.assign(url, change);
  return url.href.replace(/\/$/, '');
}

describe('quirks', () => {
  it.each<[string, Preset['quirks']]>([
    ['openai', { maxTokensField: 'max_completion_tokens' }],
    ['anthropic', undefined],
    ['deepseek', { reasoningFields: ['reasoning_content'] }],
    ['qwen', { reasoningFields: ['reasoning_content'] }],
    ['gemini', undefined],
    ['groq', undefined],
    ['mistral', undefined],
    [
      'openrouter',
      {
        reasoningFields: ['reasoning'],
        extraBody: expect.any(Function) as never,
      },
    ],
    ['ollama', { repairToolArgs: true }],
    ['custom', undefined],
  ])('%s has the quirks %j', (id, quirks) => {
    expect(getPreset(id)?.quirks).toEqual(quirks);
  });
});

describe('validatePreset', () => {
  const good: Preset = {
    id: 'demo',
    label: 'Demo',
    adapter: 'openai',
    baseUrl: 'https://api.demo.test/v1',
    envVar: 'DEMO_API_KEY',
    keyRequired: true,
    docsUrl: 'https://docs.demo.test',
    models: [{ id: 'demo-1' }],
  };

  it('accepts a good preset', () => {
    expect(validatePreset(good)).toEqual([]);
  });

  it('reports a custom preset that carries a URL or a key', () => {
    const custom = getPreset('custom') as Preset;
    expect(validatePreset(custom)).toEqual([]);
    for (const change of [
      { baseUrl: 'http://evil.com' },
      { envVar: 'EVIL_KEY' },
      { keyRequired: true },
      { baseUrl: 'http://evil.com', keyRequired: true },
    ]) {
      expect(validatePreset({ ...custom, ...change }).join('\n')).toMatch(
        /custom must have/
      );
    }
  });

  it.each<[string, Partial<Preset>, RegExp]>([
    ['a bad id', { id: 'Demo' }, /id must be/],
    ['an empty label', { label: ' ' }, /label is empty/],
    ['a bad base URL', { baseUrl: 'api.demo.test' }, /not an http/],
    [
      'plain http to a remote host',
      { baseUrl: 'http://api.demo.test/v1' },
      /localhost/,
    ],
    [
      'plain http written in capitals',
      { baseUrl: 'HTTP://api.demo.test/v1' },
      /localhost/,
    ],
    [
      'a user name in the base URL',
      { baseUrl: urlWith({ username: 'user' }) },
      /user info/,
    ],
    [
      'a password in the base URL',
      { baseUrl: urlWith({ username: 'user', password: 'pw' }) },
      /user info/,
    ],
    [
      'a query in the base URL',
      { baseUrl: 'https://api.demo.test/v1?x=1' },
      /query/,
    ],
    [
      'a hash in the base URL',
      { baseUrl: 'https://api.demo.test/v1#f' },
      /hash/,
    ],
    [
      'an empty user info in the base URL',
      { baseUrl: 'https://@api.demo.test/v1' },
      /user info/,
    ],
    [
      'a bare ? in the base URL',
      { baseUrl: 'https://api.demo.test/v1?' },
      /query/,
    ],
    [
      'a bare # in the base URL',
      { baseUrl: 'https://api.demo.test/v1#' },
      /hash/,
    ],
    [
      'a trailing slash before a bare ?#',
      { baseUrl: 'https://API.demo.test/v1/?#' },
      /query/,
    ],
    ['a trailing slash', { baseUrl: 'https://api.demo.test/v1/' }, /end with/],
    [
      'a trailing backslash',
      { baseUrl: 'https://api.demo.test/v1\\' },
      /written as/,
    ],
    [
      'a scheme in capitals',
      { baseUrl: 'HTTPS://api.demo.test/v1' },
      /written as/,
    ],
    [
      'a host in capitals',
      { baseUrl: 'https://API.demo.test/v1' },
      /written as/,
    ],
    [
      'spaces around the base URL',
      { baseUrl: ' https://api.demo.test/v1 ' },
      /written as/,
    ],
    [
      'the default port in the base URL',
      { baseUrl: 'https://api.demo.test:443/v1' },
      /written as/,
    ],
    ['a key without an env var', { envVar: '' }, /needs an env var/],
    [
      'a lowercase env var',
      { envVar: 'demo_key', keyRequired: false },
      /UPPER_SNAKE/,
    ],
    ['a bad docs URL', { docsUrl: 'docs' }, /docsUrl/],
    [
      'a price with no source',
      { models: [{ id: 'm', pricePerMTokIn: 1 }] },
      /no source/,
    ],
    ['a model listed twice', { models: [{ id: 'm' }, { id: 'm' }] }, /twice/],
    ['a model with no id', { models: [{ id: '' }] }, /no id/],
    [
      'a bad context window',
      { models: [{ id: 'm', contextWindow: -1 }] },
      /contextWindow/,
    ],
  ])('reports %s', (_why, change, problem) => {
    const problems = validatePreset({ ...good, ...change });
    expect(problems.join('\n')).toMatch(problem);
  });
});

describe('OpenRouter preset', () => {
  const openrouter = getPreset('openrouter');
  const GEMMA: Array<[string, number, number]> = [
    ['google/gemma-4-31b-it', 0.2, 0.4],
    ['google/gemma-4-26b-a4b-it', 0.07, 0.23],
    ['google/gemma-4-31b-it:free', 0, 0],
    ['google/gemma-4-26b-a4b-it:free', 0, 0],
  ];

  it('keeps openrouter/auto first', () => {
    expect(openrouter?.models[0]).toEqual({ id: 'openrouter/auto' });
  });

  it.each(GEMMA)('lists %s with tools, context and prices', (id, inP, outP) => {
    const model = openrouter?.models.find(m => m.id === id);
    expect(model).toBeDefined();
    expect(model?.supportsTools).toBe(true);
    expect(model?.contextWindow).toBe(262_144);
    expect(model?.pricePerMTokIn).toBe(inP);
    expect(model?.pricePerMTokOut).toBe(outP);
    expect(model?.priceSource).toMatch(/openrouter\.ai/);
  });

  it('sends the app headers', () => {
    expect(openrouter?.headers).toEqual({
      'HTTP-Referer': 'https://github.com/HamzaHassanain/polyman',
      'X-Title': 'polyman',
    });
  });

  it('keeps OpenRouter reasoning and adds extraBody', () => {
    expect(openrouter?.quirks?.reasoningFields).toEqual(['reasoning']);
    expect(typeof openrouter?.quirks?.extraBody).toBe('function');
  });

  it('gives no other preset headers or Gemma models', () => {
    for (const preset of PRESETS) {
      if (preset.id === 'openrouter') continue;
      expect(preset.headers).toBeUndefined();
      expect(preset.models.some(m => m.id.includes('gemma'))).toBe(false);
    }
  });
});
