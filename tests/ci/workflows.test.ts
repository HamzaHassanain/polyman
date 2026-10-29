import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  asList,
  asMap,
  asString,
  jobOf,
  parseYaml,
  readWorkflow,
  runsOf,
  stepsOf,
  strings,
  type Workflow,
} from './workflow-yaml';

// Pins the release and security workflows, and checks every workflow
// for what GitHub only reports when it runs: a `needs` to a missing job, an
// action on another major version, no least-privilege permissions.
const DIR = resolve(__dirname, '../../.github/workflows');
const FILES = readdirSync(DIR).filter(f => /\.ya?ml$/.test(f));

const ALLOWED_ACTIONS = new Set([
  'actions/checkout@v7',
  'actions/setup-node@v7',
  'actions/setup-java@v6',
  'actions/setup-python@v7',
  'actions/upload-artifact@v7',
  'actions/download-artifact@v8',
  'actions/upload-pages-artifact@v5',
  'actions/deploy-pages@v5',
  'codecov/codecov-action@v7',
  'github/codeql-action/init@v4',
  'github/codeql-action/analyze@v4',
]);

const jobs = (wf: Workflow) => asMap(wf['jobs'], 'jobs');
const needsOf = (job: Workflow): string[] =>
  job['needs'] === undefined
    ? []
    : typeof job['needs'] === 'string'
      ? [job['needs']]
      : strings(job['needs']);

describe('every workflow', () => {
  for (const file of FILES) {
    const wf = readWorkflow(file);

    it(`${file}: needs only jobs that exist`, () => {
      const ids = Object.keys(jobs(wf));
      for (const id of ids)
        for (const need of needsOf(asMap(jobs(wf)[id])))
          expect(ids, `${id} needs ${need}`).toContain(need);
    });

    it(`${file}: uses actions on the pinned major versions`, () => {
      for (const id of Object.keys(jobs(wf)))
        for (const step of stepsOf(asMap(jobs(wf)[id])))
          if (step['uses'] !== undefined)
            expect(
              ALLOWED_ACTIONS,
              `${id}: ${asString(step['uses'])}`
            ).toContain(step['uses']);
    });

    it(`${file}: sets the token's permissions`, () => {
      expect(wf['permissions'], file).toBeDefined();
    });
  }
});

describe('release.yml', () => {
  const wf = readWorkflow('release.yml');
  const publish = jobOf(wf, 'publish');
  const check = jobOf(wf, 'next-check');
  const promote = jobOf(wf, 'promote');
  const release = jobOf(wf, 'github-release');

  it('runs on version tags only', () => {
    expect(Object.keys(asMap(wf['on']))).toEqual(['push']);
    const push = asMap(asMap(wf['on'])['push']);
    expect(strings(push['tags'])).toEqual(['v*']);
    expect(push['branches']).toBeUndefined();
  });

  it('publishes to next only when the tag is package.json version', () => {
    const runs = runsOf(publish);
    const tag = runs.findIndex(r => r.includes('"v$VERSION"'));
    const npm = runs.indexOf(
      'npm publish --provenance --access public --tag next'
    );
    expect(tag).toBeGreaterThanOrEqual(0);
    expect(runs[tag]).toContain('$GITHUB_REF_NAME');
    expect(runs[tag]).toContain('exit 1');
    expect(npm).toBeGreaterThan(tag);
    expect(asMap(publish['permissions'])).toEqual({
      contents: 'read',
      'id-token': 'write',
    });
    const step = stepsOf(publish).find(s => s['run'] === runs[npm])!;
    expect(asMap(step['env'])['NODE_AUTH_TOKEN']).toBe(
      '${{ secrets.NPM_TOKEN }}'
    );
  });

  it('gates latest on no regression against the previous latest', () => {
    expect(needsOf(check)).toEqual(['publish']);
    const runs = runsOf(check).join('\n');
    expect(runs).toContain('polyman-cli@latest');
    expect(runs).toContain('polyman-cli@$RELEASE_VERSION');
    expect(runsOf(check)).toContain(
      'node corpus/regressions.mjs corpus/out/latest/summary.json corpus/out/next/summary.json'
    );
  });

  it('promotes only after the check, with a reviewer of npm-latest', () => {
    expect(needsOf(promote)).toEqual(['publish', 'next-check']);
    expect(asMap(promote['environment'])['name']).toBe('npm-latest');
    expect(promote['if']).toBeUndefined();
    expect(runsOf(promote)).toEqual([
      'npm dist-tag add "polyman-cli@$RELEASE_VERSION" latest',
    ]);
  });

  it('makes the GitHub Release only after the promote', () => {
    expect(needsOf(release)).toContain('promote');
    expect(release['if']).toBe(
      "${{ !cancelled() && needs.promote.result == 'success' }}"
    );
    expect(asMap(release['permissions'])).toEqual({ contents: 'write' });
    const runs = runsOf(release).join('\n');
    expect(runs).toContain('CHANGELOG.md');
    expect(runs).toContain('gh release create "v$RELEASE_VERSION"');
    expect(runs).not.toMatch(/CI_PIPELINE|CI_JOB|GITLAB/);
  });

  it('gives write access only to the jobs that need it', () => {
    expect(asMap(wf['permissions'])).toEqual({ contents: 'read' });
    for (const [id, job] of Object.entries(jobs(wf)))
      if (!['publish', 'github-release'].includes(id))
        expect(asMap(job)['permissions'], id).toBeUndefined();
  });
});

describe('security scanning', () => {
  it('runs CodeQL on javascript-typescript on push, pull request and weekly', () => {
    const wf = readWorkflow('codeql.yml');
    expect(Object.keys(asMap(wf['on']))).toEqual(
      expect.arrayContaining(['push', 'pull_request', 'schedule'])
    );
    const init = stepsOf(jobOf(wf, 'analyze')).find(
      s => s['uses'] === 'github/codeql-action/init@v4'
    );
    expect(asMap(init?.['with'])['languages']).toBe('javascript-typescript');
    expect(asMap(jobOf(wf, 'analyze')['permissions'])['security-events']).toBe(
      'write'
    );
  });

  it('has Dependabot updates for npm and the actions, weekly', () => {
    const config = asMap(
      parseYaml(readFileSync(resolve(DIR, '../dependabot.yml'), 'utf8')),
      'dependabot.yml'
    );
    const updates = asList(config['updates']).map(u => asMap(u));
    expect(
      updates.map(u => [
        u['package-ecosystem'],
        asMap(u['schedule'])['interval'],
      ])
    ).toEqual([
      ['npm', 'weekly'],
      ['github-actions', 'weekly'],
    ]);
  });
});
