/**
 * What a model can do: tools, context window, max output, reasoning and
 * prices. The agent needs tools to build a problem. A model without them can
 * still chat.
 *
 * Lookup order, last one wins:
 * 1. safe defaults ({@link DEFAULT_CAPABILITIES})
 * 2. the model list of the preset (`presets.ts`)
 * 3. the live model list of the provider, when there is one
 *    (`model-catalog.ts`, OpenRouter only for now)
 * 4. the user override from `ai.json` (`overrides["provider/model"]`)
 *
 * On top of that, a model that failed with `tools_not_supported` has
 * `tools: false` for the rest of the session.
 */

import { getPreset, type PresetModel } from './presets';
import { ProviderError, type ModelInfo } from './types';

/** What one model can do. */
export interface ModelCapabilities {
  /** Whether the model can call tools. Without tools it can only chat. */
  tools: boolean;
  /** Whether the model can ask for more than one tool call in one turn. */
  parallelToolCalls: boolean;
  /** Whether the model can think before it answers. */
  reasoning: boolean;
  /** Context window in tokens. */
  contextWindow: number;
  /** Upper bound on generated tokens. */
  maxOutput: number;
  /** USD per million input tokens, for the cost display. */
  pricePerMTokIn?: number;
  /** USD per million output tokens, for the cost display. */
  pricePerMTokOut?: number;
}

/**
 * Budget overrides of one model in `ai.json`. They set the chat budgets as
 * they are, instead of the budgets made from the capabilities.
 */
export interface BudgetOverride {
  /** Model calls per chat turn. */
  chatMaxSteps?: number;
  /** Context budget of the chat, in tokens. */
  contextBudgetTokens?: number;
  /** Upper bound on generated tokens per call. */
  maxOutputTokens?: number;
}

/** What `ai.json` may say about one model. */
export type ModelOverride = Partial<ModelCapabilities> & BudgetOverride;

/** User overrides, keyed by `provider/model`, as in `ai.json`. */
export type CapabilityOverrides = Readonly<Record<string, ModelOverride>>;

/**
 * Used when neither the preset, the live list nor the user says anything.
 * `maxOutput` is 8000, what the chat asked every model for before it knew
 * the models, so a model with no data keeps working as before.
 */
export const DEFAULT_CAPABILITIES: Readonly<ModelCapabilities> = Object.freeze({
  tools: true,
  parallelToolCalls: false,
  reasoning: false,
  contextWindow: 32_000,
  maxOutput: 8_000,
});

/** The key of a model in overrides and in the session table. */
export function modelKey(providerId: string, modelId: string): string {
  return `${providerId}/${modelId}`;
}

/** What the preset model list says about a model, or `{}`. */
export function presetCapabilities(
  providerId: string,
  modelId: string
): Partial<ModelCapabilities> {
  const model = getPreset(providerId)?.models.find(m => m.id === modelId);
  return model ? fromPresetModel(model) : {};
}

/** What a live model list says about a model. */
export function liveCapabilities(
  model: ModelInfo | undefined
): Partial<ModelCapabilities> {
  return model ? fromModelInfo(model) : {};
}

/**
 * Looks up a model: defaults, then the preset, then the live list, then the
 * user override. Override fields with a wrong type or value are ignored,
 * since they come from a file the user edits by hand.
 */
export function lookupCapabilities(
  providerId: string,
  modelId: string,
  overrides: CapabilityOverrides = {},
  live?: ModelInfo
): ModelCapabilities {
  const override = overrides[modelKey(providerId, modelId)];
  return {
    ...DEFAULT_CAPABILITIES,
    ...presetCapabilities(providerId, modelId),
    ...liveCapabilities(live),
    ...cleanOverride(override),
  };
}

/** The message shown when a model turns out to have no tool support. */
export function chatOnlyNotice(providerId: string, modelId: string): string {
  return (
    `${modelKey(providerId, modelId)} does not support tools. ` +
    'It can only chat, it cannot build the problem. ' +
    'Pick a model with tool support to build it.'
  );
}

/**
 * The capability table of one session. It adds the session state on top of
 * {@link lookupCapabilities}: models that failed with `tools_not_supported`.
 */
export class Capabilities {
  private readonly noTools = new Set<string>();

  /**
   * @param overrides the `overrides` of `ai.json`.
   * @param live live model info, keyed by {@link modelKey}.
   */
  constructor(
    private readonly overrides: CapabilityOverrides = {},
    private readonly live: Readonly<Record<string, ModelInfo>> = {}
  ) {}

  /** The `ai.json` override of a model, as it is in the file. */
  override(providerId: string, modelId: string): ModelOverride | undefined {
    return this.overrides[modelKey(providerId, modelId)];
  }

  /** Capabilities of a model for this session. */
  lookup(providerId: string, modelId: string): ModelCapabilities {
    const caps = lookupCapabilities(
      providerId,
      modelId,
      this.overrides,
      this.live[modelKey(providerId, modelId)]
    );
    if (this.noTools.has(modelKey(providerId, modelId))) {
      return { ...caps, tools: false, parallelToolCalls: false };
    }
    return caps;
  }

  /** True when the model can only chat in this session. */
  isChatOnly(providerId: string, modelId: string): boolean {
    return !this.lookup(providerId, modelId).tools;
  }

  /** Turns tools off for a model, for the rest of this session. */
  disableTools(providerId: string, modelId: string): void {
    this.noTools.add(modelKey(providerId, modelId));
  }

  /**
   * Looks at a failed call. On `tools_not_supported` it turns tools off for
   * that model and returns {@link chatOnlyNotice}, the message to show the
   * user. For any other error it changes nothing and returns `undefined`.
   */
  noteError(
    providerId: string,
    modelId: string,
    error: unknown
  ): string | undefined {
    if (!(error instanceof ProviderError)) return undefined;
    if (error.kind !== 'tools_not_supported') return undefined;
    this.disableTools(providerId, modelId);
    return chatOnlyNotice(providerId, modelId);
  }
}

function fromPresetModel(model: PresetModel): Partial<ModelCapabilities> {
  const caps = fromModelInfo(model);
  if (model.parallelToolCalls !== undefined) {
    caps.parallelToolCalls = model.parallelToolCalls;
  }
  return caps;
}

function fromModelInfo(model: ModelInfo): Partial<ModelCapabilities> {
  const caps: Partial<ModelCapabilities> = {};
  if (model.supportsTools !== undefined) caps.tools = model.supportsTools;
  if (model.reasoning !== undefined) caps.reasoning = model.reasoning;
  if (model.contextWindow !== undefined) {
    caps.contextWindow = model.contextWindow;
  }
  if (model.maxOutput !== undefined) caps.maxOutput = model.maxOutput;
  if (model.pricePerMTokIn !== undefined) {
    caps.pricePerMTokIn = model.pricePerMTokIn;
  }
  if (model.pricePerMTokOut !== undefined) {
    caps.pricePerMTokOut = model.pricePerMTokOut;
  }
  return caps;
}

const BOOLEAN_FIELDS = ['tools', 'parallelToolCalls', 'reasoning'] as const;
const TOKEN_FIELDS = ['contextWindow', 'maxOutput'] as const;
const PRICE_FIELDS = ['pricePerMTokIn', 'pricePerMTokOut'] as const;

function cleanOverride(raw: unknown): Partial<ModelCapabilities> {
  if (typeof raw !== 'object' || raw === null) return {};
  const source = raw as Record<string, unknown>;
  const caps: Partial<ModelCapabilities> = {};
  for (const field of BOOLEAN_FIELDS) {
    const value = source[field];
    if (typeof value === 'boolean') caps[field] = value;
  }
  for (const field of TOKEN_FIELDS) {
    const value = source[field];
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      caps[field] = value;
    }
  }
  for (const field of PRICE_FIELDS) {
    const value = source[field];
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      caps[field] = value;
    }
  }
  return caps;
}
