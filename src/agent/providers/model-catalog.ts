/**
 * Live model info for providers that publish it: the context window, max
 * output, tool support and prices of every model. For now only OpenRouter,
 * whose `GET /models` needs no key and lists hundreds of models.
 *
 * - The list is cached in `~/.polyman/agent/models/<provider>.json` for
 *   {@link CATALOG_TTL_MS} (24 hours).
 * - It is fetched with no key at all, from the base URL of the preset, so
 *   no key can leak to another server.
 * - It never throws: offline, a slow server or a broken cache give the old
 *   cache, or nothing. The caller then uses the preset and the defaults.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { OpenAICompatibleProvider } from './openai-compatible';
import { getPreset } from './presets';
import type { ModelInfo } from './types';

/** How long a cached list is fresh: 24 hours. */
export const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

/** How long to wait for the live list before giving up. */
export const CATALOG_TIMEOUT_MS = 5000;

/** Providers with a live model list. */
export const LIVE_MODEL_PROVIDERS: readonly string[] = ['openrouter'];

/** Where the catalog keeps its files and how it fetches. Tests pass fakes. */
export interface ModelCatalogOptions {
  /** Folder of the cache files. Defaults to `<home>/.polyman/agent/models`. */
  dir?: string;
  /** Home folder. Defaults to `HOME`, then `USERPROFILE`, then the OS one. */
  home?: string;
  /** The `fetch` to use. Defaults to the global one. */
  fetch?: typeof fetch;
  /** The clock, in ms. Defaults to `Date.now`. */
  now?: () => number;
  /** How long a cached list is fresh. Defaults to {@link CATALOG_TTL_MS}. */
  ttlMs?: number;
  /** Time limit of the live fetch. Defaults to {@link CATALOG_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/** A model list and where it came from. */
export interface ModelList {
  models: ModelInfo[];
  /**
   * `live` was just fetched, `cache` is a fresh cache, `stale-cache` is an
   * old cache used because the fetch failed.
   */
  source: 'live' | 'cache' | 'stale-cache';
  /** When the list was fetched, in ms. */
  fetchedAt: number;
}

/** What the catalog knows about one model. */
export type ModelLookup =
  /** No list: the provider has none, or it could not be fetched. */
  | { listed: false }
  /** There is a list; `model` is missing when the id is not in it. */
  | { listed: true; model?: ModelInfo; source: ModelList['source'] };

/** Options of one {@link ModelCatalog.list} call. */
export interface ListOptions {
  /** Stops the fetch. */
  signal?: AbortSignal;
  /** Fetch even when the cache is fresh. */
  refresh?: boolean;
}

/** The file format of a cache. */
interface CacheFile {
  version: 1;
  provider: string;
  baseUrl: string;
  fetchedAt: number;
  models: ModelInfo[];
}

/** Live model lists, cached on disk. */
export class ModelCatalog {
  /** Folder of the cache files. */
  readonly dir: string;
  private readonly fetchFn: typeof fetch | undefined;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly timeoutMs: number;

  constructor(opts: ModelCatalogOptions = {}) {
    const home =
      opts.home ??
      (process.env['HOME'] || process.env['USERPROFILE'] || homedir());
    this.dir = opts.dir ?? join(home, '.polyman', 'agent', 'models');
    this.fetchFn = opts.fetch;
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? CATALOG_TTL_MS;
    this.timeoutMs = opts.timeoutMs ?? CATALOG_TIMEOUT_MS;
  }

  /**
   * A catalog next to `ai.json`: `<.polyman folder>/agent/models`, so a
   * KeyStore with another home also gets its own cache.
   */
  static nextTo(polymanDir: string): ModelCatalog {
    return new ModelCatalog({ dir: join(polymanDir, 'agent', 'models') });
  }

  /** Whether the provider has a live model list. */
  supports(providerId: string): boolean {
    return LIVE_MODEL_PROVIDERS.includes(providerId);
  }

  /** The cache file of a provider. */
  cacheFile(providerId: string): string {
    return join(this.dir, `${providerId}.json`);
  }

  /**
   * The model list of a provider: the cache when it is fresh, else the live
   * list (saved to the cache), else the old cache. Returns `undefined` when
   * the provider has no list or nothing works. It never throws.
   */
  async list(
    providerId: string,
    opts: ListOptions = {}
  ): Promise<ModelList | undefined> {
    const preset = getPreset(providerId);
    if (!preset || !this.supports(providerId) || preset.baseUrl === '') {
      return undefined;
    }
    const cached = this.readCache(providerId, preset.baseUrl);
    if (cached && !opts.refresh && this.isFresh(cached.fetchedAt)) {
      return {
        models: cached.models,
        source: 'cache',
        fetchedAt: cached.fetchedAt,
      };
    }
    try {
      // No apiKey on purpose: the list is public, so no key is ever sent.
      const provider = new OpenAICompatibleProvider({
        id: preset.id,
        baseUrl: preset.baseUrl,
        ...(preset.headers ? { headers: { ...preset.headers } } : {}),
        ...(this.fetchFn ? { fetch: this.fetchFn } : {}),
      });
      const models = await provider.listModels(this.signal(opts.signal));
      const fetchedAt = this.now();
      this.writeCache({
        version: 1,
        provider: preset.id,
        baseUrl: preset.baseUrl,
        fetchedAt,
        models,
      });
      return { models, source: 'live', fetchedAt };
    } catch {
      // Offline, slow or broken: the old cache is better than nothing.
      if (!cached) return undefined;
      return {
        models: cached.models,
        source: 'stale-cache',
        fetchedAt: cached.fetchedAt,
      };
    }
  }

  /** What the list says about one model. It never throws. */
  async find(
    providerId: string,
    modelId: string,
    opts: ListOptions = {}
  ): Promise<ModelLookup> {
    const list = await this.list(providerId, opts);
    if (!list) return { listed: false };
    const model = list.models.find(m => m.id === modelId);
    return model
      ? { listed: true, model, source: list.source }
      : { listed: true, source: list.source };
  }

  private isFresh(fetchedAt: number): boolean {
    const age = this.now() - fetchedAt;
    return age >= 0 && age < this.ttlMs;
  }

  /** The caller's signal plus the time limit. */
  private signal(signal: AbortSignal | undefined): AbortSignal {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  /** Reads a cache. A missing, broken or foreign cache gives `undefined`. */
  private readCache(
    providerId: string,
    baseUrl: string
  ): CacheFile | undefined {
    const file = this.cacheFile(providerId);
    if (!existsSync(file)) return undefined;
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(file, 'utf-8'));
    } catch {
      return undefined;
    }
    if (typeof raw !== 'object' || raw === null) return undefined;
    const cache = raw as Partial<CacheFile>;
    if (
      cache.version !== 1 ||
      cache.provider !== providerId ||
      cache.baseUrl !== baseUrl ||
      typeof cache.fetchedAt !== 'number' ||
      !Array.isArray(cache.models)
    ) {
      return undefined;
    }
    const models = cache.models
      .map(cleanModel)
      .filter((m): m is ModelInfo => m !== undefined);
    return { ...(cache as CacheFile), models };
  }

  /** Writes a cache: temp file, then rename. Errors are ignored. */
  private writeCache(cache: CacheFile): void {
    const file = this.cacheFile(cache.provider);
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    try {
      if (!existsSync(this.dir)) {
        mkdirSync(this.dir, { recursive: true, mode: 0o700 });
        chmodSync(this.dir, 0o700);
      }
      writeFileSync(tmp, `${JSON.stringify(cache)}\n`, { mode: 0o600 });
      renameSync(tmp, file);
    } catch {
      // A cache that cannot be written only means a fetch next time.
      try {
        rmSync(tmp, { force: true });
      } catch {
        // Nothing to clean up.
      }
    }
  }
}

/** Checks one cached model, field by field: the file can be edited. */
function cleanModel(raw: unknown): ModelInfo | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const m = raw as Record<string, unknown>;
  const id = m['id'];
  if (typeof id !== 'string' || id === '') return undefined;
  const info: ModelInfo = { id };
  const count = (v: unknown): v is number =>
    typeof v === 'number' && Number.isInteger(v) && v > 0;
  const price = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0;
  if (count(m['contextWindow'])) info.contextWindow = m['contextWindow'];
  if (count(m['maxOutput'])) info.maxOutput = m['maxOutput'];
  if (typeof m['supportsTools'] === 'boolean') {
    info.supportsTools = m['supportsTools'];
  }
  if (m['reasoning'] === true) info.reasoning = true;
  if (price(m['pricePerMTokIn']) && price(m['pricePerMTokOut'])) {
    info.pricePerMTokIn = m['pricePerMTokIn'];
    info.pricePerMTokOut = m['pricePerMTokOut'];
  }
  return info;
}
