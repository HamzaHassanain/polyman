/**
 * @fileoverview Fails fast with a readable message on an unsupported Node.js version.
 * Must be the first import of cli.ts and must not import anything else: the
 * compiled CommonJS output loads chalk (ESM-only) with `require`, which throws
 * ERR_REQUIRE_ESM on Node 22.0 to 22.11 before any other code runs. Ink 8 (the
 * chat UI) needs Node 22 too.
 */

/**
 * Whether a Node.js version supports `require()` of ESM (needed for chalk).
 * Supported: >=22.12.0.
 *
 * @param version - Node.js version string, e.g. `process.versions.node`
 * @returns true if the version is supported
 */
export function isSupportedNodeVersion(version: string): boolean {
  // accept process.version too ("v22.12.0"), not only process.versions.node
  const [major = 0, minor = 0] = version
    .replace(/^v/, '')
    .split('.')
    .map(Number);
  return (major === 22 && minor >= 12) || major > 22;
}

if (!isSupportedNodeVersion(process.versions.node)) {
  console.error(
    `polyman requires Node.js >=22.12.0 (found ${process.versions.node}).\n` +
      'Please upgrade Node.js: https://nodejs.org/'
  );
  // An old Node.js is an environment error (code 3, as PolymanError uses).
  // This file runs before anything else loads, so it exits on its own.
  process.exit(3);
}
