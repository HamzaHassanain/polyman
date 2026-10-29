import { describe, expect, it } from 'vitest';
import {
  asList,
  asMap,
  asString,
  globToRegExp,
  jobOf,
  readWorkflow,
  runsOf,
  strings,
} from './workflow-yaml';

// Pins when the mutation jobs run (.github/workflows/mutation.yml): a pull
// request that changes the verdict code or its tests runs Stryker only; a push
// to the default branch runs everything, but only when something the survivors
// read changed; the weekly schedule and workflow_dispatch always run everything.
const mutation = readWorkflow('mutation.yml');
const on = asMap(mutation['on'], 'on');

const NOT_PR = "github.event_name != 'pull_request'";

/** What the survivors read: polyman, its tests, the corpus, the configs, the CI. */
const SURVIVORS_INPUTS = [
  'src/**',
  'tests/**',
  'corpus/**',
  'template/**',
  'assets/**',
  'package.json',
  'package-lock.json',
  'tsconfig*.json',
  'vitest.config.ts',
  '.github/workflows/mutation.yml',
];

describe('mutation workflow triggers', () => {
  const push = asMap(on['push'], 'push');
  const pr = asMap(on['pull_request'], 'pull_request');

  it('runs a push to the default branch only when inputs changed', () => {
    expect(strings(push['branches'])).toEqual(['main', 'master']);
    expect(strings(push['paths'])).toEqual(SURVIVORS_INPUTS);
  });

  it('always runs on the weekly schedule and by hand', () => {
    const crons = asList(on['schedule'], 'schedule').map(s =>
      asString(asMap(s, 'schedule entry')['cron'], 'cron')
    );
    expect(crons).toHaveLength(1);
    // minute hour * * weekday: once a week
    expect(crons[0]).toMatch(/^\d+ \d+ \* \* \d$/);
    expect(on).toHaveProperty('workflow_dispatch');
  });

  it('has a pull request rule for the verdict code', () => {
    const paths = strings(pr['paths']);
    expect(paths).toContain('src/helpers/solution.ts');
    expect(paths).toContain('.github/workflows/mutation.yml');
    // every pull request path is also an input of the push rule
    const globs = SURVIVORS_INPUTS.map(globToRegExp);
    for (const p of paths)
      expect(
        globs.some(g => g.test(p)),
        `${p} is matched by a push pattern`
      ).toBe(true);
  });
});

describe('mutation jobs', () => {
  const stryker = jobOf(mutation, 'mutation');
  const shards = jobOf(mutation, 'survivors');
  const report = jobOf(mutation, 'survivors-report');

  it('runs Stryker on every trigger, pull requests included', () => {
    expect(stryker['if']).toBeUndefined();
    expect(asMap(stryker['env'], 'env')['TZ']).toBe('Asia/Kolkata');
    expect(runsOf(stryker)).toEqual(
      expect.arrayContaining([
        './node_modules/.bin/stryker run corpus/stryker.config.json',
      ])
    );
  });

  it('puts the score in the run summary', () => {
    const summary = runsOf(stryker).find(r =>
      r.includes('corpus/mutation-metrics.mjs')
    );
    expect(summary).toContain('corpus/out/mutation/mutation.json');
    expect(summary).toMatch(/>> "\$GITHUB_STEP_SUMMARY"/);
  });

  it('judges the survivors on every trigger but pull requests', () => {
    expect(shards['if']).toBe(NOT_PR);
    expect(asString(report['if'])).toContain(NOT_PR);
    expect(shards['needs']).toBe('mutation');
    expect(report['needs']).toBe('survivors');
  });

  it('is a measurement: never fails the run', () => {
    expect(shards['continue-on-error']).toBe('true');
    expect(report['continue-on-error']).toBe('true');
    expect(stryker['continue-on-error']).toBeUndefined();
  });

  it('splits the mutants in as many shards as the report sums', () => {
    const matrix = asMap(asMap(shards['strategy'])['matrix']);
    const list = strings(matrix['shard']);
    expect(list).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    const total = String(list.length);
    expect(runsOf(shards)).toContain(
      `node corpus/survivors.mjs --report corpus/out/mutation/mutation.json --shard "\${{ matrix.shard }}/${total}"`
    );
    expect(runsOf(report).join('\n')).toContain(
      `node corpus/survivors.mjs report --shards ${total}`
    );
  });
});
