/**
 * Builds the chat agent's system prompt before each model call: the rules,
 * the skills index, the environment and the state of the problem folder.
 */

import { execFile } from 'child_process';
import { readdirSync, readFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { platform, release } from 'os';
import { join } from 'path';
import { skillsIndex } from '../skills';
import { chatSystemPrompt } from '../workflow/prompts';

/** Where the spec lives inside the problem folder. */
export const NOTES_PATH = join('.polyman', 'agent', 'notes.md');

/** What the builder needs. */
export interface ChatPromptBuilderOptions {
  /** The problem folder now, or null before `create_problem`. */
  problemDir(): string | null;
  /**
   * The spec when it is not in the folder yet (notes kept in memory before
   * `create_problem`). Return null to read `.polyman/agent/notes.md`.
   */
  notes?(): Promise<string | null>;
  /** The first line of `g++ --version`, or null when g++ is missing. */
  gppVersion?(): Promise<string | null>;
  /** The skills index. Defaults to the installed `template/instructions`. */
  skillsIndex?(): Promise<string>;
}

/** The chat agent's system prompt. */
export class ChatPromptBuilder {
  private readonly opts: ChatPromptBuilderOptions;
  private envCache: Promise<string> | null = null;
  private skillsCache: Promise<string> | null = null;

  constructor(opts: ChatPromptBuilderOptions) {
    this.opts = opts;
  }

  async build(): Promise<string> {
    const dir = this.opts.problemDir();
    this.envCache ??= this.environment();
    this.skillsCache ??= (this.opts.skillsIndex ?? (() => skillsIndex()))();
    const [env, skills, state] = await Promise.all([
      this.envCache,
      this.skillsCache,
      this.problemState(dir),
    ]);
    return [
      chatSystemPrompt({ problemDir: dir }),
      '',
      'Skills (load one with load_skill):',
      skills,
      '',
      `Environment: ${env}`,
      '',
      state,
    ].join('\n');
  }

  /** OS, g++ and polyman version. Computed once. */
  private async environment(): Promise<string> {
    const gpp = await (this.opts.gppVersion ?? defaultGppVersion)();
    return `${platform()} ${release()}, g++: ${gpp ?? 'missing'}, polyman ${polymanVersion()}`;
  }

  /** Notes, the Config.json summary and the file names. */
  private async problemState(dir: string | null): Promise<string> {
    const memNotes = this.opts.notes ? await this.opts.notes() : null;
    if (dir === null) {
      return [
        'Problem: none yet.',
        `Notes:\n${memNotes?.trim() || '(empty, write the spec with write_notes)'}`,
      ].join('\n');
    }
    const notes = memNotes ?? (await readText(join(dir, NOTES_PATH)));
    const config = await readText(join(dir, 'Config.json'));
    return [
      `Problem: ${dir}`,
      `Notes:\n${notes?.trim() || '(empty, write the spec with write_notes)'}`,
      '',
      `Config summary:\n${config === null ? '(no Config.json)' : configSummary(config)}`,
      '',
      `Files:\n${listFiles(dir).join('\n') || '(none)'}`,
    ].join('\n');
  }
}

/** A short summary of `Config.json`: name, limits, solutions, and the rest. */
export function configSummary(text: string): string {
  let c: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) {
      return '(Config.json is not an object)';
    }
    c = parsed as Record<string, unknown>;
  } catch (err) {
    return `(Config.json is not valid JSON: ${(err as Error).message})`;
  }
  const arr = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v)
      ? v.filter(
          (x): x is Record<string, unknown> =>
            typeof x === 'object' && x !== null
        )
      : [];
  const str = (v: unknown): string =>
    typeof v === 'string' || typeof v === 'number' ? String(v) : '?';

  const lines = [
    `- name: ${str(c['name'])}`,
    `- limits: ${str(c['timeLimit'])} ms, ${str(c['memoryLimit'])} MB`,
  ];
  const sols = arr(c['solutions']);
  lines.push(
    `- solutions: ${sols.length > 0 ? sols.map(s => `${str(s['name'])} (${str(s['tag'])}, ${str(s['source'])})`).join(', ') : 'none'}`
  );
  const val = c['validator'];
  lines.push(
    `- validator: ${typeof val === 'object' && val !== null ? str((val as Record<string, unknown>)['source']) : 'none'}`
  );
  const chk = c['checker'];
  if (typeof chk === 'object' && chk !== null) {
    const k = chk as Record<string, unknown>;
    lines.push(
      `- checker: ${str(k['name'])}${k['isStandard'] === true ? ' (standard)' : ` (${str(k['source'])})`}`
    );
  } else {
    lines.push('- checker: none');
  }
  const gens = arr(c['generators']);
  lines.push(
    `- generators: ${gens.length > 0 ? gens.map(g => str(g['name'])).join(', ') : 'none'}`
  );
  const sets = arr(c['testsets']);
  lines.push(
    `- testsets: ${sets.length > 0 ? sets.map(t => str(t['name'])).join(', ') : 'none'}`
  );
  const st = c['statements'];
  lines.push(
    `- statements: ${typeof st === 'object' && st !== null ? Object.keys(st).join(', ') || 'none' : 'none'}`
  );
  const id = c['problemId'];
  lines.push(
    `- polygon: ${typeof id === 'number' && id > 0 ? `problem ${id}` : 'not pushed yet (remote_push needs newProblemName)'}`
  );
  return lines.join('\n');
}

const SKIP = new Set(['node_modules', '.git', '.polyman', 'testsets']);

/** File names 2 levels deep, folders end with `/`. */
export function listFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string, depth: number): void => {
    let entries;
    try {
      entries = readdirSync(join(dir, rel), { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const name = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        out.push(`${name}/`);
        if (depth < 2 && !SKIP.has(e.name)) walk(name, depth + 1);
      } else {
        out.push(name);
      }
    }
  };
  walk('', 1);
  return out;
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

function defaultGppVersion(): Promise<string | null> {
  return new Promise(resolve => {
    execFile('g++', ['--version'], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(String(stdout).split(/\r?\n/)[0]?.trim() || null);
    });
  });
}

/** The version in polyman's own `package.json`. */
function polymanVersion(): string {
  // From src/agent/core/ or dist/agent/core/, the package root is 3 up.
  const file = join(__dirname, '..', '..', '..', 'package.json');
  try {
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as { version?: unknown };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}
