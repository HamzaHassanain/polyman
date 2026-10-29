/**
 * Loads the agent provider fixtures: recorded-style HTTP responses, one per
 * file, under `openai/` (Chat Completions format) and `anthropic/` (Messages
 * format).
 *
 * File layout, close to what `curl -i` prints:
 *
 *   # source: <provider docs page>     (one or more)
 *   # <any other note>
 *   HTTP/1.1 200 OK
 *   <header>: <value>
 *
 *   <body, byte for byte>
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/** The wire format of a fixture. */
export type FixtureFormat = 'openai' | 'anthropic';

/** One recorded HTTP response. */
export interface Fixture {
  /** Provider docs pages the format comes from. */
  sources: string[];
  /** The other `#` lines, without the `# `. */
  notes: string[];
  /** HTTP status code. */
  status: number;
  /** Response headers, names in lower case. */
  headers: Record<string, string>;
  /** The response body, exactly as in the file. */
  body: string;
}

const ROOT = __dirname;

/** Names of the fixtures of a format, without `.http`, sorted. */
export function listFixtures(format: FixtureFormat): string[] {
  return readdirSync(join(ROOT, format))
    .filter(f => f.endsWith('.http'))
    .map(f => f.slice(0, -'.http'.length))
    .sort();
}

/** Reads and parses one fixture, like `readFixture('openai', 'text')`. */
export function readFixture(format: FixtureFormat, name: string): Fixture {
  const file = join(ROOT, format, `${name}.http`);
  return parseFixture(readFileSync(file, 'utf8'), file);
}

/**
 * Reads a recorded model list under `models/`, like
 * `readModelsFixture('openrouter-models')`. Same file layout, JSON body.
 */
export function readModelsFixture(name: string): Fixture {
  const file = join(ROOT, 'models', `${name}.http`);
  return parseFixture(readFileSync(file, 'utf8'), file);
}

/** Parses the text of a fixture file. `file` is only used in errors. */
export function parseFixture(text: string, file = 'fixture'): Fixture {
  const sources: string[] = [];
  const notes: string[] = [];
  let pos = 0;

  const nextLine = (): string | undefined => {
    if (pos >= text.length) return undefined;
    const end = text.indexOf('\n', pos);
    const line = end === -1 ? text.slice(pos) : text.slice(pos, end);
    pos = end === -1 ? text.length : end + 1;
    return line.replace(/\r$/, '');
  };

  let line = nextLine();
  while (line !== undefined && line.startsWith('#')) {
    const note = line.replace(/^#\s?/, '');
    const source = /^source:\s*(\S+)/.exec(note);
    if (source?.[1] !== undefined) sources.push(source[1]);
    else notes.push(note);
    line = nextLine();
  }

  const status = /^HTTP\/[\d.]+ (\d{3})\b/.exec(line ?? '');
  if (status?.[1] === undefined) {
    throw new Error(`${file}: expected an HTTP status line, got "${line}"`);
  }

  const headers: Record<string, string> = {};
  for (
    line = nextLine();
    line !== undefined && line !== '';
    line = nextLine()
  ) {
    const colon = line.indexOf(':');
    if (colon <= 0) throw new Error(`${file}: bad header line "${line}"`);
    headers[line.slice(0, colon).trim().toLowerCase()] = line
      .slice(colon + 1)
      .trim();
  }
  if (line === undefined) {
    throw new Error(`${file}: no blank line after the headers`);
  }

  return {
    sources,
    notes,
    status: Number(status[1]),
    headers,
    body: text.slice(pos),
  };
}

/**
 * A `Response` that plays the fixture, for a fake `fetch`. With `chunkSize`,
 * the body arrives in pieces of that many bytes, so a parser also sees lines
 * and events split across reads.
 */
export function fixtureResponse(
  fixture: Fixture,
  chunkSize?: number
): Response {
  const bytes = new TextEncoder().encode(fixture.body);
  const size = chunkSize ?? Math.max(bytes.length, 1);
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size) {
        controller.enqueue(bytes.slice(i, i + size));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status: fixture.status,
    headers: fixture.headers,
  });
}
