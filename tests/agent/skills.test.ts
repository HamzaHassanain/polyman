import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  SKILLS_DIR,
  listSkills,
  loadSkill,
  skillNames,
  skillTools,
  skillsIndex,
} from '../../src/agent/skills';
import type { ToolContext } from '../../src/agent/tools/types';

const ctx = {} as ToolContext;

describe('skills', () => {
  it('reads from the real template/instructions folder', () => {
    expect(existsSync(join(SKILLS_DIR, 'validator.md'))).toBe(true);
  });

  it('lists the real template files with a title and a line', async () => {
    const skills = await listSkills();
    const names = skills.map(s => s.name);
    expect(names).toContain('validator');
    expect(names).toContain('generators');
    expect(names).toContain('solutions');
    expect(names).toContain('commands/verify');
    const validator = skills.find(s => s.name === 'validator');
    expect(validator?.title).toMatch(/^validator\.md/);
    expect(validator?.line).toMatch(/validator/i);
    expect(validator?.line.startsWith('#')).toBe(false);
    for (const s of skills) {
      expect(s.title).not.toBe('');
      expect(s.line).not.toBe('');
    }
  });

  it('loads one skill', async () => {
    const text = await loadSkill('validator');
    expect(text).toContain('registerValidation');
    expect(await loadSkill('commands/verify')).toContain('polyman verify');
  });

  it('errors on an unknown name and lists the names', async () => {
    await expect(loadSkill('nope')).rejects.toThrow(
      /Unknown skill "nope".*validator/
    );
    await expect(loadSkill('../../package')).rejects.toThrow(/Unknown skill/);
  });

  it('builds an index with one line per skill', async () => {
    const index = await skillsIndex();
    expect(index.split('\n')).toHaveLength(skillNames().length);
    expect(index).toMatch(/^- checker: /m);
  });

  it('gives list_skills and load_skill tools that only read', async () => {
    const tools = skillTools();
    expect(tools.map(t => t.name)).toEqual(['list_skills', 'load_skill']);
    expect(tools.every(t => t.risk === 'read' && !t.needsProblem)).toBe(true);

    const load = tools[1];
    const props = load.parameters['properties'] as {
      name: { enum: string[] };
    };
    expect(props.name.enum).toEqual(skillNames());

    const ok = await load.run({ name: 'statements' }, ctx);
    expect(ok.isError).toBeUndefined();
    expect(ok.content).toContain('statements');

    const bad = await load.run({ name: 'nope' }, ctx);
    expect(bad.isError).toBe(true);

    const list = await tools[0].run({}, ctx);
    expect(list.content).toContain('- validator: ');
  });
});
