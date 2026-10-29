/**
 * Polygon tools: push, commit, package and view, each one runs a
 * `polyman remote ...` command in the problem folder with `--json`, like the
 * CLI tools.
 *
 * Credentials never go through the chat: there is no register tool. Every
 * tool checks first that `polyman remote register` was run, and else tells
 * the model to ask the user to run it in their own terminal.
 */

import fs from 'fs';
import path from 'path';
import { readCredentials } from '../../helpers/remote/utils';
import type { RunResult } from '../runner/types';
import type { RemoteAction, RemoteReport } from '../../types';
import {
  commonDigest,
  finish,
  isOutput,
  oneLine,
  problemDirOf,
  reportOf,
  runForTool,
} from './cli-tools';
import type { Tool, ToolContext, ToolOutput } from './types';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const PUSH_TIMEOUT_MS = 10 * MINUTE;
const COMMIT_TIMEOUT_MS = 2 * MINUTE;
const VIEW_TIMEOUT_MS = 2 * MINUTE;
/** Polygon builds a package in up to ~30 minutes, polyman waits for it. */
const PACKAGE_TIMEOUT_MS = 35 * MINUTE;
/** Extra time over the CLI timeout, see `cli-tools.ts`. */
const TOOL_SLACK_MS = 15 * SECOND;

/** Most failed actions a digest lists. */
const MAX_ITEMS = 15;
/** Most lines of a digest. */
const MAX_REPORT_LINES = 40;
/** Lines of the `remote view` display shown to the model. */
const VIEW_LINES = 35;

/** A Polygon problem name, the same rule as `polyman remote push --name`. */
export const POLYGON_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** What `remote_push` can push, and the CLI flag of each part. */
const COMPONENT_FLAGS = {
  solutions: '-s',
  checker: '-c',
  validator: '-v',
  generators: '-g',
  statements: '-S',
  tests: '-t',
  metadata: '-m',
  info: '-i',
} as const;

type Component = keyof typeof COMPONENT_FLAGS;

const COMPONENTS = Object.keys(COMPONENT_FLAGS) as Component[];

/** Package types the chat may build. `full` is left out: it is long. */
const PACKAGE_TYPES = ['standard', 'linux', 'windows'] as const;

type PackageType = (typeof PACKAGE_TYPES)[number];

/** The message when `polyman remote register` was not run. */
export const NOT_SET_UP =
  'Polygon is not set up. Ask the user to run `polyman remote register <api-key> <secret>` in their own terminal, not in this chat.';

/** The Polygon API key and secret from `~/.polyman`. */
export interface PolygonCredentials {
  apiKey: string;
  secret: string;
}

/** Reads the registered credentials, or null when they are missing. */
export function readPolygonCredentials(): PolygonCredentials | null {
  try {
    return readCredentials();
  } catch {
    return null;
  }
}

/** What {@link remoteTools} needs. */
export interface RemoteToolsOptions {
  /** Defaults to {@link readPolygonCredentials}. */
  credentials?: () => PolygonCredentials | null;
}

interface PushArgs {
  components?: Component[];
  newProblemName?: string;
}

/** The Polygon problem id in Config.json, or null when there is none. */
export function polygonProblemId(problemDir: string): number | null {
  try {
    const text = fs.readFileSync(path.join(problemDir, 'Config.json'), 'utf8');
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const id = (parsed as Record<string, unknown>)['problemId'];
    return typeof id === 'number' && id > 0 ? id : null;
  } catch {
    return null;
  }
}

/** The `-s -c ...` flags of `remote push`. No components means all. */
export function pushFlags(components: Component[] | undefined): string[] {
  if (components === undefined || components.length === 0) return [];
  return COMPONENTS.filter(c => components.includes(c)).map(
    c => COMPONENT_FLAGS[c]
  );
}

function error(content: string): ToolOutput {
  return { content, isError: true };
}

const NOT_ON_POLYGON =
  'This problem is not on Polygon yet. Push it first with remote_push.';

function actionLine(a: RemoteAction): string {
  const why = a.error ? `: ${oneLine(a.error)}` : '';
  return `  ${a.component} ${a.name} (${a.action}) FAILED${why}`;
}

/** The failed actions, errors and warnings of a remote report. */
function detailLines(report: RemoteReport): string[] {
  const actions = Array.isArray(report.actions) ? report.actions : [];
  const failed = actions.filter(a => !a.ok);
  const lines = failed.slice(0, MAX_ITEMS).map(actionLine);
  if (failed.length > MAX_ITEMS) {
    lines.push(`  ... ${failed.length - MAX_ITEMS} more`);
  }
  const errors = Array.isArray(report.errors) ? report.errors : [];
  if (failed.length === 0 && !report.ok) {
    lines.push(...errors.slice(0, MAX_ITEMS).map(e => `  ${oneLine(e)}`));
  }
  const warnings = Array.isArray(report.warnings) ? report.warnings : [];
  if (warnings.length > 0) {
    lines.push(
      `Warnings: ${warnings
        .slice(0, 3)
        .map(w => oneLine(w, 150))
        .join(' | ')}`
    );
  }
  return lines;
}

function pushDigest(report: RemoteReport, known: number | null): string[] {
  const actions = Array.isArray(report.actions) ? report.actions : [];
  const id = report.problemId ?? known;
  const created = actions.some(
    a => a.component === 'problem' && a.action === 'create' && a.ok
  );
  const failed = actions.filter(a => !a.ok).length;
  const where = id === null ? 'Polygon' : `Polygon problem ${id}`;
  const head = report.ok
    ? `pushed to ${where}${created ? ' (new problem)' : ''}, ${actions.length} uploads`
    : `push to ${where} FAILED, ${failed} of ${actions.length} uploads failed`;
  const lines = [head, ...detailLines(report)];
  if (report.ok) {
    lines.push('Polygon has no new revision yet: call remote_commit next.');
  }
  return lines;
}

type RemoteDigest = (report: RemoteReport, result: RunResult) => string[];

/**
 * Checks the credentials, runs one `polyman remote` command in the problem
 * folder and builds the digest from its remote report.
 */
async function runRemote(
  name: string,
  ctx: ToolContext,
  opts: RemoteToolsOptions,
  args: string[],
  timeoutMs: number,
  digest: RemoteDigest
): Promise<ToolOutput> {
  const credentials = (opts.credentials ?? readPolygonCredentials)();
  if (credentials === null) return error(NOT_SET_UP);
  const ran = await runForTool(name, ctx, args, problemDirOf(ctx), timeoutMs);
  if (isOutput(ran)) return ran;
  const common = commonDigest(name, ran);
  if (common) return common;
  const report = reportOf<RemoteReport>(ran)!;
  const output: ToolOutput = {
    content: finish(digest(report, ran), ran, MAX_REPORT_LINES),
    data: ran,
  };
  if (!report.ok) output.isError = true;
  return output;
}

function remotePush(opts: RemoteToolsOptions): Tool<PushArgs> {
  return {
    name: 'remote_push',
    description:
      'Push the problem to Polygon (polyman remote push). Leave components ' +
      'out to push everything. When the problem is not on Polygon yet, it ' +
      'creates it: then newProblemName is needed, ask the user for it. Call ' +
      'remote_commit after a push.',
    parameters: {
      type: 'object',
      properties: {
        components: {
          type: 'array',
          items: { type: 'string', enum: COMPONENTS },
          description: 'Parts to push. Leave it out for all of them',
        },
        newProblemName: {
          type: 'string',
          pattern: POLYGON_NAME_PATTERN.source,
          description:
            'Polygon name for a new problem, like "pairs-sum". Only used when the problem is not on Polygon yet',
        },
      },
      additionalProperties: false,
    },
    risk: 'remote',
    needsProblem: true,
    timeoutMs: PUSH_TIMEOUT_MS + TOOL_SLACK_MS,
    describe: args => {
      const name =
        args.newProblemName !== undefined
          ? ['--yes', '--name', args.newProblemName]
          : [];
      return {
        title: 'Push the problem to Polygon',
        command: [
          'polyman remote push .',
          ...pushFlags(args.components),
          ...name,
          '--json',
        ].join(' '),
      };
    },
    run(args, ctx) {
      const dir = problemDirOf(ctx);
      const unknown = (args.components ?? []).filter(
        c => !COMPONENTS.includes(c)
      );
      if (unknown.length > 0) {
        return Promise.resolve(
          error(
            `Unknown components: ${unknown.join(', ')}. Use: ${COMPONENTS.join(', ')}`
          )
        );
      }
      const id = polygonProblemId(dir);
      const create: string[] = [];
      if (id === null) {
        if (args.newProblemName === undefined) {
          return Promise.resolve(
            error(
              'This problem is not on Polygon yet, so remote_push will create it. Ask the user for the Polygon problem name (like "pairs-sum") and call remote_push again with newProblemName.'
            )
          );
        }
        if (!POLYGON_NAME_PATTERN.test(args.newProblemName)) {
          return Promise.resolve(
            error(
              `Invalid Polygon problem name "${args.newProblemName}": use lowercase letters and digits, with single "-" between them, like "pairs-sum"`
            )
          );
        }
        create.push('--yes', '--name', args.newProblemName);
      }
      return runRemote(
        'remote_push',
        ctx,
        opts,
        [
          'remote',
          'push',
          '.',
          ...pushFlags(args.components),
          ...create,
          '--json',
        ],
        PUSH_TIMEOUT_MS,
        report => pushDigest(report, id)
      );
    },
  };
}

function remoteCommit(opts: RemoteToolsOptions): Tool<{ message: string }> {
  return {
    name: 'remote_commit',
    description:
      'Commit the pushed changes on Polygon as a new revision (polyman ' +
      'remote commit). Call it after remote_push, with a short message that ' +
      'says what changed.',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          minLength: 1,
          maxLength: 500,
          description: 'What changed, like "Added tests for n = 1"',
        },
      },
      required: ['message'],
      additionalProperties: false,
    },
    risk: 'remote',
    needsProblem: true,
    timeoutMs: COMMIT_TIMEOUT_MS + TOOL_SLACK_MS,
    describe: args => ({
      title: 'Commit the changes on Polygon',
      command: `polyman remote commit . ${JSON.stringify(args.message)} --json`,
    }),
    run(args, ctx) {
      const message = args.message.trim();
      if (message === '') {
        return Promise.resolve(error('The commit message is empty.'));
      }
      const id = polygonProblemId(problemDirOf(ctx));
      if (id === null) return Promise.resolve(error(NOT_ON_POLYGON));
      return runRemote(
        'remote_commit',
        ctx,
        opts,
        ['remote', 'commit', '.', message, '--json'],
        COMMIT_TIMEOUT_MS,
        report => [
          report.ok
            ? `committed Polygon problem ${report.problemId ?? id}`
            : `commit on Polygon problem ${report.problemId ?? id} FAILED`,
          ...detailLines(report),
        ]
      );
    },
  };
}

function remotePackage(opts: RemoteToolsOptions): Tool<{ type: PackageType }> {
  return {
    name: 'remote_package',
    description:
      'Build a package on Polygon (polyman remote package) and wait until ' +
      'it is ready, it can take many minutes. Call it after remote_commit. ' +
      'Use "standard" unless the user asks for another type.',
    parameters: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: [...PACKAGE_TYPES],
          description: 'Package type, usually "standard"',
        },
      },
      required: ['type'],
      additionalProperties: false,
    },
    risk: 'remote',
    needsProblem: true,
    timeoutMs: PACKAGE_TIMEOUT_MS + TOOL_SLACK_MS,
    describe: args => ({
      title: `Build a ${args.type} package on Polygon`,
      command: `polyman remote package . ${args.type} --json`,
    }),
    run(args, ctx) {
      if (!(PACKAGE_TYPES as readonly string[]).includes(args.type)) {
        return Promise.resolve(
          error(
            `Invalid package type "${String(args.type)}". Use: ${PACKAGE_TYPES.join(', ')}`
          )
        );
      }
      const id = polygonProblemId(problemDirOf(ctx));
      if (id === null) return Promise.resolve(error(NOT_ON_POLYGON));
      return runRemote(
        'remote_package',
        ctx,
        opts,
        ['remote', 'package', '.', args.type, '--json'],
        PACKAGE_TIMEOUT_MS,
        (report, result) => {
          const where = `Polygon problem ${report.problemId ?? id}`;
          // The CLI exits 0 when Polygon says the build failed.
          const failed =
            !report.ok || /PACKAGE BUILD FAILED/.test(result.stderrTail);
          return [
            failed
              ? `${args.type} package build FAILED on ${where}`
              : `${args.type} package is ready on ${where}`,
            ...detailLines(report),
          ];
        }
      ).then(out =>
        / package build FAILED /.test(out.content)
          ? { ...out, isError: true }
          : out
      );
    },
  };
}

function remoteView(opts: RemoteToolsOptions): Tool<Record<string, never>> {
  return {
    name: 'remote_view',
    description:
      'Show the problem as it is on Polygon now (polyman remote view): ' +
      'info, solutions, files, packages. It changes nothing.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    // It only reads from Polygon, so it does not ask the user.
    risk: 'read',
    needsProblem: true,
    timeoutMs: VIEW_TIMEOUT_MS + TOOL_SLACK_MS,
    describe: () => ({
      title: 'View the problem on Polygon',
      command: 'polyman remote view . --json',
    }),
    run(_args, ctx) {
      const id = polygonProblemId(problemDirOf(ctx));
      if (id === null) return Promise.resolve(error(NOT_ON_POLYGON));
      return runRemote(
        'remote_view',
        ctx,
        opts,
        ['remote', 'view', '.', '--json'],
        VIEW_TIMEOUT_MS,
        (report, result) => {
          // The JSON report has no problem data, the display is on stderr.
          const shown = result.stderrTail
            .split(/\r?\n/)
            .map(line => line.trimEnd())
            .filter(line => line.trim() !== '')
            .slice(-VIEW_LINES);
          return [
            report.ok
              ? `Polygon problem ${report.problemId ?? id}:`
              : `view of Polygon problem ${report.problemId ?? id} FAILED`,
            ...(report.ok ? shown : []),
            ...detailLines(report),
          ];
        }
      );
    },
  };
}

/** The Polygon tools, for the chat's registry. */
export function remoteTools(opts: RemoteToolsOptions = {}): Tool[] {
  return [
    remotePush(opts),
    remoteCommit(opts),
    remotePackage(opts),
    remoteView(opts),
  ] as Tool[];
}
