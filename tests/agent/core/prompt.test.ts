import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  ChatPromptBuilder,
  NOTES_PATH,
  configSummary,
} from '../../../src/agent/core/prompt';

const TEMPLATE = join(__dirname, '..', '..', '..', 'template');
const NOTES = '# Idea\nCount pairs i < j with a_i + a_j = k.\n';

let root: string;
let dir: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'polyman-prompt-'));
  dir = join(root, 'pairs-sum');
  cpSync(TEMPLATE, dir, { recursive: true });
  mkdirSync(join(dir, '.polyman', 'agent'), { recursive: true });
  writeFileSync(join(dir, NOTES_PATH), NOTES);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('ChatPromptBuilder', () => {
  it('includes the notes, the config summary and the files of the problem', async () => {
    const builder = new ChatPromptBuilder({
      problemDir: () => dir,
      gppVersion: () => Promise.resolve('g++ (Fake) 13.2.0'),
    });
    const p = await builder.build();
    expect(p).toMatch(/^You are polyman/);
    expect(p).toContain(`Problem: ${dir}`);
    expect(p).toContain('Count pairs i < j');
    expect(p).toContain('- name: my-problem-template');
    expect(p).toContain('- limits: 1000 ms, 256 MB');
    expect(p).toContain('main (MA, ./solutions/acc.cpp)');
    expect(p).toContain('- validator: ./validator/val.cpp');
    expect(p).toContain('Files:');
    expect(p).toContain('solutions/acc.cpp');
    expect(p).toContain('statements/english/');
    expect(p).not.toContain('statements/english/legend.tex');
    expect(p).toContain('g++: g++ (Fake) 13.2.0');
    expect(p).toMatch(/polyman \d+\.\d+\.\d+/);
    expect(p).toMatch(/^- validator: /m);
  });

  it('works before the problem folder exists, with in-memory notes', async () => {
    const builder = new ChatPromptBuilder({
      problemDir: () => null,
      notes: () => Promise.resolve('# Idea\nmemory notes'),
      gppVersion: () => Promise.resolve(null),
      skillsIndex: () => Promise.resolve('- validator: x'),
    });
    const p = await builder.build();
    expect(p).toContain('Problem: none yet.');
    expect(p).toContain('memory notes');
    expect(p).toContain('g++: missing');
    expect(p).toContain('- validator: x');
  });

  it('computes the environment once', async () => {
    let calls = 0;
    const builder = new ChatPromptBuilder({
      problemDir: () => dir,
      gppVersion: () => {
        calls += 1;
        return Promise.resolve('g++ 1');
      },
    });
    await builder.build();
    await builder.build();
    expect(calls).toBe(1);
  });

  it('follows a problem folder that changes', async () => {
    let current: string | null = null;
    const builder = new ChatPromptBuilder({
      problemDir: () => current,
      gppVersion: () => Promise.resolve(null),
    });
    expect(await builder.build()).toContain('Problem: none yet.');
    current = dir;
    expect(await builder.build()).toContain(`Problem: ${dir}`);
  });
});

describe('configSummary', () => {
  it('says when Config.json is broken', () => {
    expect(configSummary('{ nope')).toMatch(/not valid JSON/);
  });

  it('handles a near empty config', () => {
    const s = configSummary(
      '{"name":"x","checker":{"name":"ncmp","isStandard":true}}'
    );
    expect(s).toContain('- name: x');
    expect(s).toContain('- solutions: none');
    expect(s).toContain('- checker: ncmp (standard)');
    expect(s).toContain('- polygon: not pushed yet');
  });

  it('shows the Polygon problem id', () => {
    expect(configSummary('{"name":"x","problemId":123}')).toContain(
      '- polygon: problem 123'
    );
  });
});
