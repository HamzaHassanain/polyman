import { describe, expect, it } from 'vitest';
import {
  looksLikePolygonKey,
  PASTED_KEY_NOTICE,
} from '../../../src/agent/core/pasted-key';

/** Obviously fake 40-hex tokens, never real keys. */
const KEY = 'a'.repeat(40);
const SECRET = 'b'.repeat(40);
const SHA = '453a701c0ffee453a701c0ffee453a701c0ffee4';

describe('looksLikePolygonKey', () => {
  it('matches a pasted key and secret', () => {
    expect(
      looksLikePolygonKey(`My API key is ${KEY} and my secret is ${SECRET}`)
    ).toBe(true);
  });

  it('matches two hex tokens alone', () => {
    expect(looksLikePolygonKey(`${KEY} ${SECRET}`)).toBe(true);
    expect(looksLikePolygonKey(`remote register ${KEY} ${SECRET}`)).toBe(true);
  });

  it('matches one token next to key, secret or api', () => {
    expect(looksLikePolygonKey(`here is the KEY: ${KEY}`)).toBe(true);
    expect(looksLikePolygonKey(`secret=${SECRET}`)).toBe(true);
    expect(looksLikePolygonKey(`Api ${KEY.toUpperCase()}`)).toBe(true);
  });

  it('does not match normal text or one git sha alone', () => {
    expect(looksLikePolygonKey('push the problem to Polygon')).toBe(false);
    expect(looksLikePolygonKey('what is a good key for this map?')).toBe(false);
    expect(looksLikePolygonKey(`the bug came in ${SHA}`)).toBe(false);
    expect(looksLikePolygonKey(SHA)).toBe(false);
  });

  it('does not match a shorter or longer hex run', () => {
    expect(looksLikePolygonKey(`api key ${'a'.repeat(39)}`)).toBe(false);
    expect(looksLikePolygonKey(`api key ${'a'.repeat(41)}`)).toBe(false);
  });

  it('has a notice that points to the terminal', () => {
    expect(PASTED_KEY_NOTICE).toContain('polyman remote register');
    expect(PASTED_KEY_NOTICE).toContain('Do not paste keys');
  });
});
