import { describe, expect, it } from 'vitest';
import { jobOf, readWorkflow, runsOf } from './workflow-yaml';

// Pins the corpus PCH job (.github/workflows/corpus.yml, #113): it runs
// corpus/pch-check.mjs with clang installed, on the same events as the other
// corpus jobs.
const corpus = readWorkflow('corpus.yml');

describe('corpus pch', () => {
  const pch = jobOf(corpus, 'pch');

  it('runs the PCH check after a build, with clang installed', () => {
    expect(pch['container']).toBe('node:20');
    expect(runsOf(pch)).toEqual([
      'npm ci --no-audit --no-fund',
      'apt-get update -qq && apt-get install -y -qq clang >/dev/null',
      'npm run build',
      'node corpus/pch-check.mjs',
    ]);
  });

  it('runs on the same events as the corpus job', () => {
    expect(pch['if']).toBeUndefined();
    expect(jobOf(corpus, 'corpus')['if']).toBeUndefined();
  });

  it('is blocking', () => {
    expect(pch['continue-on-error']).toBeUndefined();
  });
});
