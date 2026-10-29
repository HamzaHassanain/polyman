import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  CATALOG_TTL_MS,
  ModelCatalog,
  type ModelCatalogOptions,
} from '../../../src/agent/providers/model-catalog';
import { fixtureResponse, readModelsFixture } from '../../fixtures/agent';

type FetchArgs = Parameters<typeof fetch>;

const T0 = 1_793_000_000_000;

let home: string;
let clock: number;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'polyman-catalog-'));
  clock = T0;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** A fetch that plays the recorded OpenRouter list. */
function liveFetch() {
  return vi.fn((..._args: FetchArgs) =>
    Promise.resolve(fixtureResponse(readModelsFixture('openrouter-models')))
  );
}

/** A fetch that fails like a machine with no network. */
function offlineFetch() {
  return vi.fn((..._args: FetchArgs) =>
    Promise.reject(new TypeError('fetch failed'))
  );
}

function catalog(
  fetchFn: typeof fetch,
  over: Partial<ModelCatalogOptions> = {}
): ModelCatalog {
  return new ModelCatalog({ home, fetch: fetchFn, now: () => clock, ...over });
}

describe('ModelCatalog', () => {
  it('keeps its cache under ~/.polyman/agent/models', () => {
    const c = catalog(liveFetch());
    expect(c.dir).toBe(join(home, '.polyman', 'agent', 'models'));
    expect(c.cacheFile('openrouter')).toBe(
      join(home, '.polyman', 'agent', 'models', 'openrouter.json')
    );
  });

  it('takes another cache folder', () => {
    const dir = join(home, 'elsewhere');
    expect(catalog(liveFetch(), { dir }).dir).toBe(dir);
  });

  it('only has a live list for OpenRouter', async () => {
    const fetchFn = liveFetch();
    const c = catalog(fetchFn);
    expect(c.supports('openrouter')).toBe(true);
    expect(c.supports('openai')).toBe(false);
    expect(await c.list('openai')).toBeUndefined();
    expect(await c.list('nope')).toBeUndefined();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fetches the list with no key, from the preset base URL', async () => {
    const fetchFn = liveFetch();
    const list = await catalog(fetchFn).list('openrouter');
    expect(list?.source).toBe('live');
    expect(list?.fetchedAt).toBe(T0);
    expect(list?.models).toHaveLength(5);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('https://openrouter.ai/api/v1/models');
    const headers = init?.headers as Record<string, string>;
    expect(headers['authorization']).toBeUndefined();
    expect(headers['X-Title']).toBe('polyman');
  });

  it('saves the list and uses the cache for 24 hours', async () => {
    const first = catalog(liveFetch());
    await first.list('openrouter');
    const file = first.cacheFile('openrouter');
    expect(existsSync(file)).toBe(true);
    const saved = JSON.parse(readFileSync(file, 'utf-8')) as {
      fetchedAt: number;
      baseUrl: string;
    };
    expect(saved.fetchedAt).toBe(T0);
    expect(saved.baseUrl).toBe('https://openrouter.ai/api/v1');

    clock = T0 + CATALOG_TTL_MS - 1;
    const fetchFn = liveFetch();
    const list = await catalog(fetchFn).list('openrouter');
    expect(list?.source).toBe('cache');
    expect(list?.models).toHaveLength(5);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fetches again after the TTL', async () => {
    await catalog(liveFetch()).list('openrouter');
    clock = T0 + CATALOG_TTL_MS;
    const fetchFn = liveFetch();
    const list = await catalog(fetchFn).list('openrouter');
    expect(list?.source).toBe('live');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('fetches again with refresh, even with a fresh cache', async () => {
    await catalog(liveFetch()).list('openrouter');
    const fetchFn = liveFetch();
    await catalog(fetchFn).list('openrouter', { refresh: true });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('uses the old cache when offline', async () => {
    await catalog(liveFetch()).list('openrouter');
    clock = T0 + 3 * CATALOG_TTL_MS;
    const list = await catalog(offlineFetch()).list('openrouter');
    expect(list?.source).toBe('stale-cache');
    expect(list?.fetchedAt).toBe(T0);
    expect(list?.models).toHaveLength(5);
  });

  it('gives nothing, and never throws, when offline with no cache', async () => {
    expect(await catalog(offlineFetch()).list('openrouter')).toBeUndefined();
  });

  it('gives nothing for an HTTP error', async () => {
    const fetchFn = vi.fn((..._args: FetchArgs) =>
      Promise.resolve(new Response('busy', { status: 503 }))
    );
    expect(await catalog(fetchFn).list('openrouter')).toBeUndefined();
  });

  it('gives up after the time limit', async () => {
    const hang = vi.fn(
      (_url: FetchArgs[0], init?: FetchArgs[1]) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted'))
          );
        })
    );
    const list = await catalog(hang, { timeoutMs: 20 }).list('openrouter');
    expect(list).toBeUndefined();
  });

  it('treats a cache from the future as old', async () => {
    await catalog(liveFetch()).list('openrouter');
    clock = T0 - 1000;
    const fetchFn = liveFetch();
    expect((await catalog(fetchFn).list('openrouter'))?.source).toBe('live');
  });

  it('ignores a broken cache file', async () => {
    const c = catalog(liveFetch());
    mkdirSync(c.dir, { recursive: true });
    writeFileSync(c.cacheFile('openrouter'), '{ not json');
    expect((await c.list('openrouter'))?.source).toBe('live');
  });

  it('ignores a cache of another base URL', async () => {
    const c = catalog(liveFetch());
    mkdirSync(c.dir, { recursive: true });
    writeFileSync(
      c.cacheFile('openrouter'),
      JSON.stringify({
        version: 1,
        provider: 'openrouter',
        baseUrl: 'https://evil.example/api/v1',
        fetchedAt: T0,
        models: [{ id: 'evil/model' }],
      })
    );
    const list = await c.list('openrouter');
    expect(list?.source).toBe('live');
    expect(list?.models.some(m => m.id === 'evil/model')).toBe(false);
  });

  it('drops cached fields with a wrong type', async () => {
    const c = catalog(offlineFetch());
    mkdirSync(c.dir, { recursive: true });
    writeFileSync(
      c.cacheFile('openrouter'),
      JSON.stringify({
        version: 1,
        provider: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        fetchedAt: T0,
        models: [
          {
            id: 'a/b',
            contextWindow: 'big',
            maxOutput: 4096,
            supportsTools: 'yes',
            reasoning: true,
            pricePerMTokIn: 1,
            pricePerMTokOut: -2,
          },
          { id: 42 },
          null,
        ],
      })
    );
    expect((await c.list('openrouter'))?.models).toEqual([
      { id: 'a/b', maxOutput: 4096, reasoning: true },
    ]);
  });

  it('still works when the cache cannot be written', async () => {
    // A file where the cache folder should be.
    const dir = join(home, 'blocked');
    writeFileSync(dir, 'x');
    const list = await catalog(liveFetch(), { dir }).list('openrouter');
    expect(list?.source).toBe('live');
  });

  describe('find', () => {
    it('finds a listed model', async () => {
      const found = await catalog(liveFetch()).find(
        'openrouter',
        'google/gemma-3-4b-it'
      );
      expect(found).toMatchObject({
        listed: true,
        source: 'live',
        model: { id: 'google/gemma-3-4b-it', supportsTools: false },
      });
    });

    it('says when the id is not in the list', async () => {
      const found = await catalog(liveFetch()).find('openrouter', 'x/y');
      expect(found).toEqual({ listed: true, source: 'live' });
    });

    it('says when there is no list', async () => {
      expect(await catalog(offlineFetch()).find('openrouter', 'x/y')).toEqual({
        listed: false,
      });
    });
  });
});
