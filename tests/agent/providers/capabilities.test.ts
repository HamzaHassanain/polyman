import { describe, it, expect } from 'vitest';
import {
  Capabilities,
  DEFAULT_CAPABILITIES,
  chatOnlyNotice,
  liveCapabilities,
  lookupCapabilities,
  modelKey,
  presetCapabilities,
  type CapabilityOverrides,
} from '../../../src/agent/providers/capabilities';
import { PRESETS } from '../../../src/agent/providers/presets';
import { ProviderError } from '../../../src/agent/providers/types';

describe('lookupCapabilities', () => {
  it('uses safe defaults for an unknown model', () => {
    expect(lookupCapabilities('custom', 'my-model')).toEqual({
      tools: true,
      parallelToolCalls: false,
      reasoning: false,
      contextWindow: 32_000,
      maxOutput: 8_000,
    });
  });

  it('uses safe defaults for an unknown provider', () => {
    expect(lookupCapabilities('nope', 'x')).toEqual(DEFAULT_CAPABILITIES);
  });

  it('takes what the preset model list says', () => {
    const caps = lookupCapabilities('groq', 'openai/gpt-oss-120b');
    expect(caps).toEqual({
      tools: true,
      parallelToolCalls: false,
      reasoning: true,
      contextWindow: 131_072,
      maxOutput: 65_536,
      pricePerMTokIn: 0.15,
      pricePerMTokOut: 0.6,
    });
  });

  it('keeps defaults for fields the preset leaves out', () => {
    const caps = lookupCapabilities('mistral', 'mistral-large-latest');
    expect(caps.tools).toBe(true);
    expect(caps.contextWindow).toBe(DEFAULT_CAPABILITIES.contextWindow);
    expect(caps.pricePerMTokIn).toBeUndefined();
  });

  it('lets the user override win over the preset', () => {
    const overrides: CapabilityOverrides = {
      'groq/openai/gpt-oss-120b': { contextWindow: 64_000, tools: false },
    };
    const caps = lookupCapabilities('groq', 'openai/gpt-oss-120b', overrides);
    expect(caps.contextWindow).toBe(64_000);
    expect(caps.tools).toBe(false);
    expect(caps.maxOutput).toBe(65_536);
  });

  it('lets the user override win over the defaults', () => {
    const caps = lookupCapabilities('custom', 'my-model', {
      'custom/my-model': { contextWindow: 200_000, pricePerMTokIn: 0 },
    });
    expect(caps.contextWindow).toBe(200_000);
    expect(caps.pricePerMTokIn).toBe(0);
  });

  it('only applies the override of the same provider and model', () => {
    const overrides = { 'openai/m': { contextWindow: 1_000 } };
    expect(lookupCapabilities('groq', 'm', overrides).contextWindow).toBe(
      DEFAULT_CAPABILITIES.contextWindow
    );
  });

  it('ignores override fields with a wrong type or value', () => {
    const overrides = {
      'custom/m': {
        tools: 'yes',
        contextWindow: -5,
        maxOutput: 1.5,
        pricePerMTokIn: Number.NaN,
        pricePerMTokOut: -1,
        reasoning: true,
      },
    } as unknown as CapabilityOverrides;
    expect(lookupCapabilities('custom', 'm', overrides)).toEqual({
      ...DEFAULT_CAPABILITIES,
      reasoning: true,
    });
  });

  it('ignores an override that is not an object', () => {
    const overrides = { 'custom/m': 42 } as unknown as CapabilityOverrides;
    expect(lookupCapabilities('custom', 'm', overrides)).toEqual(
      DEFAULT_CAPABILITIES
    );
  });

  it('never changes the defaults', () => {
    lookupCapabilities('custom', 'm', { 'custom/m': { tools: false } });
    expect(DEFAULT_CAPABILITIES.tools).toBe(true);
  });
});

describe('presetCapabilities', () => {
  it('returns {} for a model the preset does not list', () => {
    expect(presetCapabilities('openai', 'not-a-model')).toEqual({});
  });

  it('maps every known preset model to valid capabilities', () => {
    for (const preset of PRESETS) {
      for (const model of preset.models) {
        const caps = lookupCapabilities(preset.id, model.id);
        expect(caps.contextWindow).toBeGreaterThan(0);
        expect(caps.maxOutput).toBeGreaterThan(0);
      }
    }
  });
});

describe('Capabilities', () => {
  it('looks up through the overrides it was given', () => {
    const table = new Capabilities({ 'custom/m': { contextWindow: 9_000 } });
    expect(table.lookup('custom', 'm').contextWindow).toBe(9_000);
  });

  it('turns tools off on tools_not_supported and returns the notice', () => {
    const table = new Capabilities();
    const err = new ProviderError('tools_not_supported', 'no tools here');
    const notice = table.noteError('ollama', 'tiny', err);
    expect(notice).toBe(chatOnlyNotice('ollama', 'tiny'));
    expect(table.lookup('ollama', 'tiny').tools).toBe(false);
    expect(table.lookup('ollama', 'tiny').parallelToolCalls).toBe(false);
    expect(table.isChatOnly('ollama', 'tiny')).toBe(true);
  });

  it('only turns tools off for that one model', () => {
    const table = new Capabilities();
    table.noteError(
      'ollama',
      'tiny',
      new ProviderError('tools_not_supported', 'x')
    );
    expect(table.isChatOnly('ollama', 'qwen3')).toBe(false);
    expect(table.isChatOnly('custom', 'tiny')).toBe(false);
  });

  it('keeps the other capabilities of a chat-only model', () => {
    const table = new Capabilities();
    table.disableTools('groq', 'openai/gpt-oss-120b');
    const caps = table.lookup('groq', 'openai/gpt-oss-120b');
    expect(caps.tools).toBe(false);
    expect(caps.contextWindow).toBe(131_072);
  });

  it('beats a user override that says tools: true', () => {
    const table = new Capabilities({ 'custom/m': { tools: true } });
    table.disableTools('custom', 'm');
    expect(table.isChatOnly('custom', 'm')).toBe(true);
  });

  it.each([
    ['another provider error', new ProviderError('auth', 'bad key')],
    ['a plain error', new Error('tools_not_supported')],
    ['a string', 'tools_not_supported'],
  ])('ignores %s', (_why, error) => {
    const table = new Capabilities();
    expect(table.noteError('custom', 'm', error)).toBeUndefined();
    expect(table.isChatOnly('custom', 'm')).toBe(false);
  });

  it('keeps the session state per table', () => {
    const first = new Capabilities();
    first.disableTools('custom', 'm');
    expect(new Capabilities().isChatOnly('custom', 'm')).toBe(false);
  });
});

describe('chatOnlyNotice', () => {
  it('says the model can only chat, not build the problem', () => {
    const notice = chatOnlyNotice('ollama', 'tiny');
    expect(notice).toContain('ollama/tiny');
    expect(notice).toMatch(/only chat/);
    expect(notice).toMatch(/cannot build the problem/);
  });
});

describe('modelKey', () => {
  it('joins provider and model with /', () => {
    expect(modelKey('deepseek', 'deepseek-flash')).toBe(
      'deepseek/deepseek-flash'
    );
  });
});

describe('lookup order with live model info', () => {
  const live = {
    id: 'google/gemma-4-31b-it',
    contextWindow: 200_000,
    maxOutput: 16_384,
    supportsTools: true,
    reasoning: true,
    pricePerMTokIn: 0.25,
    pricePerMTokOut: 0.5,
  };

  it('goes defaults, then preset, then live, then the override', () => {
    // The preset says 262144 and $0.2 / $0.4; live wins over it.
    const caps = lookupCapabilities(
      'openrouter',
      'google/gemma-4-31b-it',
      { 'openrouter/google/gemma-4-31b-it': { maxOutput: 4000 } },
      live
    );
    expect(caps).toEqual({
      tools: true,
      parallelToolCalls: false,
      reasoning: true,
      contextWindow: 200_000,
      maxOutput: 4000,
      pricePerMTokIn: 0.25,
      pricePerMTokOut: 0.5,
    });
  });

  it('keeps the preset fields live does not give', () => {
    const caps = lookupCapabilities(
      'openrouter',
      'google/gemma-4-31b-it',
      {},
      {
        id: 'google/gemma-4-31b-it',
      }
    );
    expect(caps.contextWindow).toBe(262_144);
    expect(caps.pricePerMTokIn).toBe(0.2);
  });

  it('gives an unknown model its real data', () => {
    const caps = lookupCapabilities(
      'openrouter',
      'google/gemma-3-4b-it',
      {},
      {
        id: 'google/gemma-3-4b-it',
        contextWindow: 131_072,
        maxOutput: 16_384,
        supportsTools: false,
      }
    );
    expect(caps.tools).toBe(false);
    expect(caps.contextWindow).toBe(131_072);
  });

  it('lets an override turn tools back on over live data', () => {
    const caps = lookupCapabilities(
      'openrouter',
      'x/y',
      { 'openrouter/x/y': { tools: true } },
      { id: 'x/y', supportsTools: false }
    );
    expect(caps.tools).toBe(true);
  });

  it('maps live info with liveCapabilities', () => {
    expect(liveCapabilities(undefined)).toEqual({});
    expect(liveCapabilities({ id: 'a', supportsTools: false })).toEqual({
      tools: false,
    });
  });

  it('uses the live table of a Capabilities by model key', () => {
    const table = new Capabilities(
      { 'openrouter/x/y': { chatMaxSteps: 5 } },
      { 'openrouter/x/y': { id: 'x/y', supportsTools: false } }
    );
    expect(table.isChatOnly('openrouter', 'x/y')).toBe(true);
    expect(table.isChatOnly('openrouter', 'x/z')).toBe(false);
    expect(table.override('openrouter', 'x/y')).toEqual({ chatMaxSteps: 5 });
    expect(table.override('openrouter', 'x/z')).toBeUndefined();
  });
});
