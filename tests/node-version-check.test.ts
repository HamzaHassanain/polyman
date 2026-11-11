import { describe, it, expect, vi } from 'vitest';
import { isSupportedNodeVersion } from '../src/node-version-check';

describe('isSupportedNodeVersion', () => {
  it.each([
    ['20.18.0', false],
    ['20.19.0', false],
    ['21.7.0', false],
    ['22.11.0', false],
    ['22.12.0', true],
    ['24.0.0', true],
    ['18.20.4', false],
    ['20.20.1', false],
    ['22.23.3', true],
    ['v22.12.0', true],
    ['v20.18.1', false],
  ])('%s -> %s', (version, expected) => {
    expect(isSupportedNodeVersion(version)).toBe(expected);
  });
});

describe('on load', () => {
  /** Loads the module again as if Node.js reported `node` as its version. */
  const loadWithNode = async (node: string) => {
    const original = Object.getOwnPropertyDescriptor(process, 'versions')!;
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as typeof process.exit);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    Object.defineProperty(process, 'versions', {
      ...original,
      value: { ...process.versions, node },
    });
    try {
      vi.resetModules();
      await import('../src/node-version-check');
      return {
        exitCalls: exitSpy.mock.calls.map(call => call[0]),
        printed: errorSpy.mock.calls.map(call => String(call[0])).join('\n'),
      };
    } finally {
      Object.defineProperty(process, 'versions', original);
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    }
  };

  it('exits with code 3 (environment error) on an unsupported Node.js', async () => {
    const { exitCalls, printed } = await loadWithNode('18.20.4');
    expect(exitCalls).toEqual([3]);
    expect(printed).toContain('found 18.20.4');
  });

  it('exits on Node.js 20, which Ink 8 does not support', async () => {
    const { exitCalls, printed } = await loadWithNode('20.19.0');
    expect(exitCalls).toEqual([3]);
    expect(printed).toContain('>=22.12.0');
  });

  it('does not exit on a supported Node.js', async () => {
    const { exitCalls } = await loadWithNode('22.12.0');
    expect(exitCalls).toEqual([]);
  });
});
