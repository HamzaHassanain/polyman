import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BUDGETS,
  MIN_CONTEXT_BUDGET,
  MIN_OUTPUT_TOKENS,
  budgetsFor,
} from '../../../src/agent/providers/chat-provider';
import {
  DEFAULT_CAPABILITIES,
  lookupCapabilities,
} from '../../../src/agent/providers/capabilities';

describe('budgetsFor', () => {
  it('gives Gemma 4 the default budgets, from the preset only', () => {
    const caps = lookupCapabilities('openrouter', 'google/gemma-4-31b-it');
    expect(budgetsFor(caps)).toEqual(DEFAULT_BUDGETS);
  });

  it('gives Gemma 4 the default budgets with its live info', () => {
    // From the recorded OpenRouter list: 262144 context, 16384 max output.
    const caps = lookupCapabilities(
      'openrouter',
      'google/gemma-4-31b-it',
      {},
      {
        id: 'google/gemma-4-31b-it',
        contextWindow: 262_144,
        maxOutput: 16_384,
      }
    );
    expect(budgetsFor(caps)).toEqual(DEFAULT_BUDGETS);
  });

  it('gives a frontier model the same caps', () => {
    expect(
      budgetsFor({ contextWindow: 1_000_000, maxOutput: 128_000 })
    ).toEqual(DEFAULT_BUDGETS);
  });

  it('clamps the output to the max output of the model', () => {
    const b = budgetsFor({ contextWindow: 128_000, maxOutput: 4096 });
    expect(b.maxOutputTokens).toBe(4096);
    expect(b.contextBudgetTokens).toBe(32_000);
  });

  it('clamps a small 8k model under its window', () => {
    const b = budgetsFor({ contextWindow: 8192, maxOutput: 8192 });
    expect(b.maxOutputTokens).toBe(2048);
    expect(b.contextBudgetTokens).toBe(4608);
    expect(b.maxOutputTokens + b.contextBudgetTokens).toBeLessThan(8192);
  });

  it('keeps steps, tool result cap and temperature', () => {
    const b = budgetsFor({ contextWindow: 8192, maxOutput: 1000 });
    expect(b.chatMaxSteps).toBe(DEFAULT_BUDGETS.chatMaxSteps);
    expect(b.toolResultCapBytes).toBe(DEFAULT_BUDGETS.toolResultCapBytes);
    expect(b.temperature).toBe(DEFAULT_BUDGETS.temperature);
  });

  it('fits an unknown model with the default 32k window', () => {
    const b = budgetsFor(DEFAULT_CAPABILITIES);
    expect(b.maxOutputTokens).toBe(8000);
    expect(b.contextBudgetTokens).toBe(18_000);
  });

  it('never goes under the minimums', () => {
    const b = budgetsFor({ contextWindow: 1000, maxOutput: 10 });
    expect(b.maxOutputTokens).toBe(MIN_OUTPUT_TOKENS);
    expect(b.contextBudgetTokens).toBe(MIN_CONTEXT_BUDGET);
  });

  it('lets the ai.json override set the budgets as they are', () => {
    const b = budgetsFor(
      { contextWindow: 1_000_000, maxOutput: 128_000 },
      {
        chatMaxSteps: 40,
        contextBudgetTokens: 100_000,
        maxOutputTokens: 16_000,
      }
    );
    expect(b.chatMaxSteps).toBe(40);
    expect(b.contextBudgetTokens).toBe(100_000);
    expect(b.maxOutputTokens).toBe(16_000);
  });

  it('ignores override fields that are not positive integers', () => {
    const bad = {
      chatMaxSteps: 0,
      contextBudgetTokens: 1.5,
      maxOutputTokens: '9000',
    } as unknown as Parameters<typeof budgetsFor>[1];
    expect(
      budgetsFor({ contextWindow: 262_144, maxOutput: 16_384 }, bad)
    ).toEqual(DEFAULT_BUDGETS);
  });

  it('never changes the defaults', () => {
    budgetsFor({ contextWindow: 8192, maxOutput: 100 }, { chatMaxSteps: 3 });
    expect(DEFAULT_BUDGETS.chatMaxSteps).toBe(20);
    expect(DEFAULT_BUDGETS.maxOutputTokens).toBe(8000);
  });
});
