/**
 * File tools: list, read, write and edit files of the problem folder.
 * Every path goes through `ctx.sandbox.resolve`, so a tool never touches a
 * file outside the problem folder.
 */

import fs from 'fs';
import path from 'path';
import type { Tool, ToolContext, ToolOutput } from './types';

/** Most lines `read_file` returns in one call. */
export const MAX_READ_LINES = 2000;
/** A longer line is cut in `read_file`. */
const MAX_LINE_CHARS = 2000;
/** Test files longer than this show only their start and end. */
const TEST_FILE_LINES = 60;
const TEST_FILE_HEAD = 30;
const TEST_FILE_TAIL = 10;
/** Most entries `list_files` shows. */
const MAX_LIST_ENTRIES = 500;
/** Folders `list_files` goes into. */
const LIST_DEPTH = 2;

/** Folder names `list_files` never shows. */
const SKIPPED_DIRS = new Set(['node_modules', '.git']);
/** Folder names whose files `list_files` only counts. */
const COUNTED_DIRS = new Set(['testsets']);

interface ListArgs {
  path?: string;
}
interface ReadArgs {
  path: string;
  offset?: number;
  limit?: number;
}
interface WriteArgs {
  path: string;
  content: string;
}
interface EditArgs {
  path: string;
  old_text: string;
  new_text: string;
}

/** The path as the model should write it: relative to the problem folder. */
function shown(ctx: ToolContext, real: string): string {
  const rel = path.relative(ctx.sandbox.root, real);
  return rel === '' ? '.' : rel.split(path.sep).join('/');
}

function errorOutput(content: string): ToolOutput {
  return { content, isError: true };
}

/** A friendly message for common file errors, or null to rethrow. */
function fileError(error: unknown, userPath: string): ToolOutput | null {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') return errorOutput(`File not found: ${userPath}`);
  if (code === 'EISDIR') {
    return errorOutput(`${userPath} is a folder, use list_files`);
  }
  if (code === 'ENOTDIR') return errorOutput(`${userPath} is not a folder`);
  return null;
}

/** Counts the files under a folder, at any depth. */
async function countFiles(dir: string): Promise<number> {
  let count = 0;
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      count += await countFiles(path.join(dir, entry.name));
    } else {
      count += 1;
    }
  }
  return count;
}

/** Whether `rel` (relative, with `/`) is `.polyman/cache` or inside it. */
function isCache(rel: string): boolean {
  return rel === '.polyman/cache' || rel.startsWith('.polyman/cache/');
}

async function listTree(ctx: ToolContext, root: string): Promise<string[]> {
  const lines: string[] = [];
  let more = 0;

  const walk = async (dir: string, depth: number): Promise<void> => {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = shown(ctx, full);
      const indent = '  '.repeat(depth - 1);
      if (entry.isDirectory()) {
        if (SKIPPED_DIRS.has(entry.name) || isCache(rel)) continue;
        if (lines.length >= MAX_LIST_ENTRIES) {
          more += 1;
          continue;
        }
        if (COUNTED_DIRS.has(entry.name)) {
          const count = await countFiles(full);
          lines.push(`${indent}${rel}/ (${count} files, not listed)`);
          continue;
        }
        lines.push(`${indent}${rel}/`);
        if (depth < LIST_DEPTH) await walk(full, depth + 1);
      } else {
        if (lines.length >= MAX_LIST_ENTRIES) {
          more += 1;
          continue;
        }
        lines.push(`${indent}${rel}`);
      }
    }
  };

  await walk(root, 1);
  if (more > 0) lines.push(`... ${more} more entries not shown`);
  return lines;
}

/** Whether a file is a test input or output: inside `tests/` or `testsets/`. */
function isTestFile(rel: string): boolean {
  const folders = rel.split('/').slice(0, -1);
  return folders.some(name => name === 'tests' || name === 'testsets');
}

function numbered(lines: string[], first: number, width: number): string[] {
  return lines.map((line, i) => {
    const text =
      line.length > MAX_LINE_CHARS
        ? `${line.slice(0, MAX_LINE_CHARS)} ... (line cut, ${line.length} characters)`
        : line;
    return `${String(first + i).padStart(width)}| ${text}`;
  });
}

/** Splits file text into lines, without an empty line after a final `\n`. */
function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function countOccurrences(text: string, part: string): number {
  let count = 0;
  let at = text.indexOf(part);
  while (at !== -1) {
    count += 1;
    at = text.indexOf(part, at + part.length);
  }
  return count;
}

const listFiles: Tool<ListArgs> = {
  name: 'list_files',
  description:
    'List the files of the problem folder (or of one folder in it), 2 levels ' +
    'deep. Test folders (testsets/) only show how many files they have.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description:
          'Folder to list, relative to the problem folder. Default "."',
      },
    },
    additionalProperties: false,
  },
  risk: 'read',
  needsProblem: true,
  describe: args => ({ title: `List ${args.path ?? '.'}` }),
  async run(args, ctx) {
    const userPath = args.path ?? '.';
    const real = await ctx.sandbox.resolve(userPath, 'read');
    try {
      const lines = await listTree(ctx, real);
      if (lines.length === 0) return { content: `${userPath} is empty` };
      return { content: lines.join('\n') };
    } catch (error) {
      const known = fileError(error, userPath);
      if (known) return known;
      throw error;
    }
  },
};

const readFile: Tool<ReadArgs> = {
  name: 'read_file',
  description:
    'Read a text file of the problem, with line numbers. At most 2000 lines ' +
    'per call: use offset (first line, from 1) and limit to read more. Long ' +
    'test files show only their first and last lines.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File to read, relative to the problem folder',
      },
      offset: {
        type: 'integer',
        minimum: 1,
        description: 'First line to read, from 1. Default 1',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_READ_LINES,
        description: 'How many lines to read. Default and max 2000',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
  risk: 'read',
  needsProblem: true,
  describe: args => ({ title: `Read ${args.path}` }),
  async run(args, ctx) {
    const real = await ctx.sandbox.resolve(args.path, 'read');
    const rel = shown(ctx, real);
    let buffer: Buffer;
    try {
      buffer = await fs.promises.readFile(real);
    } catch (error) {
      const known = fileError(error, args.path);
      if (known) return known;
      throw error;
    }
    if (buffer.includes(0)) {
      return errorOutput(
        `${rel} is a binary file (${buffer.length} bytes), it cannot be shown`
      );
    }
    const lines = splitLines(buffer.toString('utf8'));
    const total = lines.length;
    if (total === 0) return { content: `${rel} is empty` };
    const width = String(total).length;

    const ranged = args.offset !== undefined || args.limit !== undefined;
    if (!ranged && isTestFile(rel) && total > TEST_FILE_LINES) {
      const head = numbered(lines.slice(0, TEST_FILE_HEAD), 1, width);
      const tailStart = total - TEST_FILE_TAIL;
      const tail = numbered(lines.slice(tailStart), tailStart + 1, width);
      const cut = tailStart - TEST_FILE_HEAD;
      return {
        content: [
          ...head,
          `... (${cut} lines cut, test file has ${total} lines; use offset and limit to read them)`,
          ...tail,
        ].join('\n'),
      };
    }

    const offset = args.offset ?? 1;
    if (offset > total) {
      return errorOutput(
        `${rel} has only ${total} lines, offset ${offset} is past the end`
      );
    }
    const limit = Math.min(args.limit ?? MAX_READ_LINES, MAX_READ_LINES);
    const last = Math.min(total, offset - 1 + limit);
    const out = numbered(lines.slice(offset - 1, last), offset, width);
    if (offset > 1 || last < total) {
      const next = last < total ? `, use offset=${last + 1} to read more` : '';
      out.push(`... (lines ${offset}-${last} of ${total} shown${next})`);
    }
    return { content: out.join('\n') };
  },
};

const writeFile: Tool<WriteArgs> = {
  name: 'write_file',
  description:
    'Create a file or replace all of it. Creates missing folders. For a ' +
    'small change in an existing file use edit_file.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File to write, relative to the problem folder',
      },
      content: { type: 'string', description: 'The whole new file content' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  risk: 'write',
  needsProblem: true,
  describe: args => ({ title: `Write ${args.path}` }),
  async run(args, ctx) {
    const real = await ctx.sandbox.resolve(args.path, 'write');
    await fs.promises.mkdir(path.dirname(real), { recursive: true });
    try {
      await fs.promises.writeFile(real, args.content);
    } catch (error) {
      const known = fileError(error, args.path);
      if (known) return known;
      throw error;
    }
    const lines = splitLines(args.content).length;
    return { content: `wrote ${shown(ctx, real)} (${lines} lines)` };
  },
};

function indentOf(line: string): string {
  return /^[ \t]*/.exec(line)?.[0] ?? '';
}

/**
 * Replaces `oldText` when it matches whole lines of `text` once, comparing
 * each line without the spaces at its start and end. `newText` gets the
 * indent of the file: the difference between the file's first matched line
 * and the first line of `oldText` is added to (or removed from) each line.
 * Returns the new text, or how many places matched (0 or more than 1).
 */
export function looseReplace(
  text: string,
  oldText: string,
  newText: string
): string | { matches: number } {
  const strip = (t: string): string => (t.endsWith('\n') ? t.slice(0, -1) : t);
  const want = strip(oldText).split('\n');
  if (want.every(l => l.trim() === '')) return { matches: 0 };
  const lines = text.split('\n');
  const hits: number[] = [];
  for (let i = 0; i + want.length <= lines.length; i++) {
    if (want.every((w, j) => (lines[i + j] ?? '').trim() === w.trim())) {
      hits.push(i);
    }
  }
  if (hits.length !== 1) return { matches: hits.length };
  const at = hits[0] ?? 0;
  const first = want.findIndex(l => l.trim() !== '');
  const fileIndent = indentOf(lines[at + first] ?? '');
  const oldIndent = indentOf(want[first] ?? '');
  const delta = fileIndent.length - oldIndent.length;
  const pad = (fileIndent[0] ?? ' ').repeat(Math.max(delta, 0));
  const replaced = strip(newText)
    .split('\n')
    .map(line => {
      if (line.trim() === '' || delta === 0) return line;
      if (delta > 0) return pad + line;
      const cut = Math.min(-delta, indentOf(line).length);
      return line.slice(cut);
    });
  return [
    ...lines.slice(0, at),
    ...replaced,
    ...lines.slice(at + want.length),
  ].join('\n');
}

const editFile: Tool<EditArgs> = {
  name: 'edit_file',
  description:
    'Replace one exact piece of text in a file. old_text must appear exactly ' +
    'once in the file: copy it with its spaces and add more lines around it ' +
    'when it is not unique.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'File to edit, relative to the problem folder',
      },
      old_text: {
        type: 'string',
        description: 'The exact text to replace',
      },
      new_text: { type: 'string', description: 'The text to put instead' },
    },
    required: ['path', 'old_text', 'new_text'],
    additionalProperties: false,
  },
  risk: 'write',
  needsProblem: true,
  describe: args => ({ title: `Edit ${args.path}` }),
  async run(args, ctx) {
    const real = await ctx.sandbox.resolve(args.path, 'write');
    const rel = shown(ctx, real);
    if (args.old_text === '') return errorOutput('old_text is empty');
    let text: string;
    try {
      text = await fs.promises.readFile(real, 'utf8');
    } catch (error) {
      const known = fileError(error, args.path);
      if (known) return known;
      throw error;
    }
    const count = countOccurrences(text, args.old_text);
    if (count === 0) {
      // Gemma often copies one space too many from the `12| ` of read_file.
      const loose = looseReplace(text, args.old_text, args.new_text);
      if (typeof loose === 'string') {
        await fs.promises.writeFile(real, loose);
        return {
          content: `edited ${rel} (old_text matched with other spaces at the line starts)`,
        };
      }
      if (loose.matches > 1) {
        return errorOutput(
          `old_text found ${loose.matches} times (ignoring spaces at the line starts), add more context so it appears once in ${rel}`
        );
      }
      return errorOutput(
        `old_text not found in ${rel}. Read the file again and copy the text exactly`
      );
    }
    if (count > 1) {
      return errorOutput(
        `old_text found ${count} times, add more context so it appears once in ${rel}`
      );
    }
    const at = text.indexOf(args.old_text);
    const next =
      text.slice(0, at) + args.new_text + text.slice(at + args.old_text.length);
    await fs.promises.writeFile(real, next);
    return { content: `edited ${rel}` };
  },
};

/** The file tools, for the registry. */
export function fsTools(): Tool[] {
  return [listFiles, readFile, writeFile, editFile] as Tool[];
}
