import { describe, expect, it } from 'vitest';
import {
  asList,
  asMap,
  asString,
  jobOf,
  readWorkflow,
  runsOf,
  stepsOf,
  strings,
  type Workflow,
} from './workflow-yaml';

// Pins which corpus lanes block a pull request (.github/workflows/corpus.yml):
// `corpus` and the node-20.19 toolchain lane block, the no-python-alias lane is
// reported, not yet blocking. And the Windows and macOS lanes in ci.yml are
// reported, never blocking, and not run on every pull request.
const corpus = readWorkflow('corpus.yml');
const on = asMap(corpus['on'], 'on');

/** The polyman inputs the corpus judges: a change to one runs the corpus. */
const INPUTS = [
  'src/**',
  'corpus/**',
  'template/**',
  'assets/**',
  'package.json',
  'package-lock.json',
  '.github/workflows/corpus.yml',
];

const lanes = (job: Workflow) =>
  asMap(asMap(job['strategy'], 'strategy')['matrix'], 'matrix')['include'];

describe('corpus lanes on pull requests', () => {
  it('runs on every push to the default branch', () => {
    const push = asMap(on['push'], 'push');
    expect(strings(push['branches'])).toEqual(['main', 'master']);
    expect(push['paths']).toBeUndefined();
  });

  it('runs on pull requests that change what it judges', () => {
    const pr = asMap(on['pull_request'], 'pull_request');
    expect(strings(pr['paths'])).toEqual(INPUTS);
  });

  it('runs every corpus job on the same events', () => {
    for (const id of ['corpus', 'toolchain', 'pch', 'truth'])
      expect(jobOf(corpus, id)['if'], id).toBeUndefined();
  });

  it('gives every compile 60 s (#88)', () => {
    expect(asMap(corpus['env'], 'env')['POLYMAN_COMPILE_TIMEOUT_MS']).toBe(
      '60000'
    );
  });

  it('corpus is blocking', () => {
    expect(jobOf(corpus, 'corpus')['continue-on-error']).toBeUndefined();
  });

  it('judges with g++, Java and python', () => {
    const job = jobOf(corpus, 'corpus');
    expect(job['container']).toBe('node:20');
    const runs = stepsOf(job);
    expect(runs.map(s => s['run'])).toEqual(
      expect.arrayContaining([
        'apt-get update -qq && apt-get install -y -qq default-jdk-headless python-is-python3 >/dev/null',
        'npm run build',
        'node corpus/run.mjs',
      ])
    );
  });

  it('lets only no-python-alias fail', () => {
    const toolchain = jobOf(corpus, 'toolchain');
    expect(toolchain['continue-on-error']).toBe('${{ matrix.allow-failure }}');
    expect(toolchain['container']).toBe('${{ matrix.image }}');
    const byLane = Object.fromEntries(
      asList(lanes(toolchain), 'lanes')
        .map(l => asMap(l))
        .map(l => [asString(l['lane']), l])
    );
    expect(Object.keys(byLane)).toEqual(['node-20.19', 'no-python-alias']);
    expect(byLane['node-20.19']).toEqual({
      lane: 'node-20.19',
      image: 'node:20.19',
      'python-alias': 'yes',
      'allow-failure': 'false',
    });
    expect(byLane['no-python-alias']).toEqual({
      lane: 'no-python-alias',
      image: 'node:22',
      'python-alias': 'no',
      'allow-failure': 'true',
    });
  });
});

describe('Windows and macOS lanes (ci.yml)', () => {
  const ci = readWorkflow('ci.yml');

  it('can be started by hand on any branch', () => {
    expect(asMap(ci['on'], 'on')).toHaveProperty('workflow_dispatch');
  });

  for (const id of ['windows', 'macos'])
    it(`${id} is reported, not blocking, and skips pull requests`, () => {
      const job = jobOf(ci, id);
      expect(job['continue-on-error']).toBe('true');
      expect(job['if']).toBe("github.event_name != 'pull_request'");
    });

  it('runs the unit tests on Windows with Node 22', () => {
    const job = jobOf(ci, 'windows');
    expect(job['runs-on']).toBe('windows-latest');
    const steps = stepsOf(job);
    const node = steps.find(s => s['uses'] === 'actions/setup-node@v7');
    expect(asMap(node?.['with'])['node-version']).toBe('22.x');
    expect(steps.map(s => s['run'])).toContain(
      'npx vitest run --reporter=default --reporter=junit --outputFile.junit=junit-windows.xml'
    );
  });

  it('runs the corpus on macOS with GNU g++ first on PATH', () => {
    const job = jobOf(ci, 'macos');
    expect(asMap(job['env'])['POLYMAN_COMPILE_TIMEOUT_MS']).toBe('60000');
    const runs = runsOf(job);
    expect(runs.join('\n')).toMatch(/brew install gcc/);
    expect(runs.join('\n')).toMatch(/"\$GITHUB_PATH"/);
    expect(runs).toContain(
      'node corpus/run.mjs --junit corpus/out/junit-macos.xml'
    );
  });
});
