/**
 * Skills are the instruction files in `template/instructions/`. They are read
 * from the installed polyman package, never from the problem folder, so they
 * work before the problem exists and always match the CLI version.
 *
 * Names are the file names without `.md`: `validator`, `generators`, and
 * `commands/verify` for the files in `commands/`.
 */

import { readdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import type { Tool, ToolOutput } from './tools/types';

/** One line of the skills index. */
export interface SkillInfo {
  /** Like `validator` or `commands/verify`. */
  name: string;
  /** The first `#` heading of the file. */
  title: string;
  /** The first line of the first paragraph after the heading. */
  line: string;
}

/**
 * The instructions folder of the installed package. The same path works from
 * `src/agent/` (tests) and from `dist/agent/` (after the build).
 */
export const SKILLS_DIR = join(
  __dirname,
  '..',
  '..',
  'template',
  'instructions'
);

/** The skill names, sorted: the top files first, then `commands/*`. */
export function skillNames(dir = SKILLS_DIR): string[] {
  const mdNames = (folder: string): string[] => {
    try {
      return readdirSync(folder, { withFileTypes: true })
        .filter(e => e.isFile() && e.name.endsWith('.md'))
        .map(e => e.name.slice(0, -3))
        .sort();
    } catch {
      return [];
    }
  };
  return [
    ...mdNames(dir),
    ...mdNames(join(dir, 'commands')).map(n => `commands/${n}`),
  ];
}

/** Lists every skill with its title and one line. */
export async function listSkills(dir = SKILLS_DIR): Promise<SkillInfo[]> {
  const out: SkillInfo[] = [];
  for (const name of skillNames(dir)) {
    const text = await readFile(join(dir, `${name}.md`), 'utf8');
    out.push({ name, ...headOf(text, name) });
  }
  return out;
}

/** Returns the text of one skill. Throws for an unknown name. */
export async function loadSkill(
  name: string,
  dir = SKILLS_DIR
): Promise<string> {
  const names = skillNames(dir);
  const clean = name.trim().replace(/\.md$/, '');
  if (!names.includes(clean)) {
    throw new Error(
      `Unknown skill "${name}". Skills you can load: ${names.join(', ')}`
    );
  }
  return readFile(join(dir, `${clean}.md`), 'utf8');
}

/** The skills index for a system prompt: one `- name: line` per skill. */
export async function skillsIndex(dir = SKILLS_DIR): Promise<string> {
  const skills = await listSkills(dir);
  return skills.map(s => `- ${s.name}: ${s.line || s.title}`).join('\n');
}

/** The `list_skills` and `load_skill` tools. Both only read. */
export function skillTools(dir = SKILLS_DIR): Tool[] {
  const names = skillNames(dir);
  const listTool: Tool<Record<string, never>> = {
    name: 'list_skills',
    description:
      'List the skill files (polyman instructions) with one line each. Load one with load_skill before you start a step.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    risk: 'read',
    needsProblem: false,
    describe: () => ({ title: 'List skills' }),
    async run(): Promise<ToolOutput> {
      return { content: await skillsIndex(dir) };
    },
  };
  const loadTool: Tool<{ name: string }> = {
    name: 'load_skill',
    description:
      'Read one skill file (polyman instructions for a step, like validator or generators). Read it before you write that kind of file.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', enum: names, description: 'The skill name.' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    risk: 'read',
    needsProblem: false,
    describe: args => ({ title: `Load skill ${args.name}` }),
    async run(args): Promise<ToolOutput> {
      try {
        return { content: await loadSkill(args.name, dir) };
      } catch (err) {
        return { content: (err as Error).message, isError: true };
      }
    },
  };
  return [listTool, loadTool];
}

/** The first heading and the first paragraph line of a markdown file. */
function headOf(text: string, name: string): { title: string; line: string } {
  const lines = text.split(/\r?\n/);
  let title = name;
  let i = 0;
  for (; i < lines.length; i++) {
    const m = /^#\s+(.*)$/.exec(lines[i] ?? '');
    if (m) {
      title = (m[1] ?? '').trim();
      i++;
      break;
    }
  }
  if (i >= lines.length) i = 0;
  let line = '';
  for (; i < lines.length; i++) {
    const l = (lines[i] ?? '').trim();
    if (l === '' || l.startsWith('#')) continue;
    line = l;
    break;
  }
  return { title, line };
}
