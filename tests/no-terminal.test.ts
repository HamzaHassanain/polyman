/**
 * Runs the real CLI the way an agent does: stdin closed, stdout a pipe.
 * Every command must end by itself and print no ANSI escapes. Nothing here
 * reaches the network: remote commands run without registered credentials,
 * and `remote push` stops at the prompt before it talks to Polygon.
 * `download-testlib` is left out because it needs GitHub; it has no prompt.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';

const ROOT = resolve(__dirname, '..');
const CLI = join(ROOT, 'src', 'cli.ts');
const TS_NODE = require.resolve('ts-node/register/transpile-only');
const ESCAPE = String.fromCharCode(27);
const TIMEOUT_MS = 90_000;

let work: string;
let home: string;
let problem: string;

const polyman = (args: string[], cwd: string, homeDir = home) => {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: homeDir,
    USERPROFILE: homeDir,
    TS_NODE_PROJECT: join(ROOT, 'tsconfig.json'),
    TS_NODE_TRANSPILE_ONLY: '1',
    // chalk would turn colors on with this; the CLI must still print none
    FORCE_COLOR: '1',
  };
  delete env['NO_COLOR'];
  delete env['POLYMAN_AGENT'];
  const result = spawnSync(process.execPath, ['-r', TS_NODE, CLI, ...args], {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: TIMEOUT_MS,
    encoding: 'utf8',
  });
  return {
    ...result,
    out: `${result.stdout}${result.stderr}`,
  };
};

beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'polyman-noterm-'));
  home = join(work, 'home');
  problem = join(work, 'prob');
  const created = polyman(['new', problem], work);
  expect(created.status).toBe(0);
}, TIMEOUT_MS);

afterAll(() => {
  rmSync(work, { recursive: true, force: true });
});

const commands: string[][] = [
  ['--help'],
  ['--version'],
  ['list', 'checkers'],
  ['list', 'testsets'],
  ['list', 'solutions'],
  ['list', 'generators'],
  ['generate', '--all'],
  ['validate', '--all'],
  ['run', 'main', '--all'],
  ['test', 'validator'],
  ['verify'],
  ['verify', '--json'],
  ['cache', 'status'],
  ['cache', 'clear'],
  ['completion', 'bash'],
  ['__complete', 'solutions'],
  ['remote', 'list'],
  ['remote', 'pull', '123', 'out'],
  ['remote', 'diff', '.'],
  ['remote', 'view', '123'],
  ['remote', 'commit', '123', 'msg'],
  ['remote', 'package', '123', 'standard'],
];

describe('commands without a terminal', () => {
  it.each(commands.map(args => [args.join(' '), args] as const))(
    'polyman %s ends by itself and prints no colors',
    (_name, args) => {
      const result = polyman(args, problem, join(work, 'bare-home'));
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.status).not.toBeNull();
      expect(result.out).not.toContain(ESCAPE);
    },
    TIMEOUT_MS + 5_000
  );

  it(
    'remote register ends by itself and prints no colors',
    () => {
      const result = polyman(['remote', 'register', 'key', 'secret'], work);
      expect(result.signal).toBeNull();
      expect(result.status).toBe(0);
      expect(result.out).not.toContain(ESCAPE);
    },
    TIMEOUT_MS + 5_000
  );

  it(
    'remote push without a problem id exits 2 and names --yes',
    () => {
      // register dummy credentials so the push reaches the prompt step
      polyman(['remote', 'register', 'key', 'secret'], work);
      const result = polyman(['remote', 'push', '.'], problem);
      expect(result.signal).toBeNull();
      expect(result.status).toBe(2);
      expect(result.out).toContain('--yes');
      expect(result.out).not.toContain(ESCAPE);
    },
    TIMEOUT_MS + 5_000
  );

  it(
    'remote push --dry-run creates no problem and uploads nothing',
    () => {
      // register dummy credentials so the dry run reaches the config step
      polyman(['remote', 'register', 'key', 'secret'], work);
      const result = polyman(['remote', 'push', '.', '--dry-run'], problem);
      expect(result.signal).toBeNull();
      expect(result.status).toBe(0);
      expect(result.out).toContain('not on Polygon yet');
      expect(result.out).toContain('nothing was created or uploaded');
      expect(result.out).not.toContain(ESCAPE);
      // A first push would write the new Polygon id back into Config.json.
      const config = JSON.parse(
        readFileSync(join(problem, 'Config.json'), 'utf8')
      ) as { problemId?: number };
      expect(config.problemId).toBeUndefined();
    },
    TIMEOUT_MS + 5_000
  );
});

describe('exit codes', () => {
  it(
    'exits 2 when there is no Config.json',
    () => {
      const result = polyman(['list', 'solutions'], work);
      expect(result.status).toBe(2);
      expect(result.out).toContain('polyman new');
    },
    TIMEOUT_MS + 5_000
  );

  it(
    'exits 2 for an unknown solution name',
    () => {
      const result = polyman(['test', 'no-such-solution'], problem);
      expect(result.status).toBe(2);
      expect(result.out).toContain('No solution named "no-such-solution"');
    },
    TIMEOUT_MS + 5_000
  );

  it(
    'exits 3 when Polygon credentials are not registered',
    () => {
      const result = polyman(['remote', 'list'], work, join(work, 'no-creds'));
      expect(result.status).toBe(3);
      expect(result.out).toContain('polyman remote register');
    },
    TIMEOUT_MS + 5_000
  );
});

describe('--help', () => {
  it.each([['--help'], ['-h']])(
    'polyman %s prints help and exits 0',
    flag => {
      const result = polyman([flag], work);
      expect(result.status).toBe(0);
      expect(result.out).toContain('polyman - ');
    },
    TIMEOUT_MS + 5_000
  );

  it(
    'new x --help prints help and does not create x',
    () => {
      const result = polyman(['new', 'help-target', '--help'], work);
      expect(result.status).toBe(0);
      expect(result.out).toContain('new <directory>');
      expect(existsSync(join(work, 'help-target'))).toBe(false);
    },
    TIMEOUT_MS + 5_000
  );

  it.each([['--help'], ['-h']])(
    'verify %s prints help and does not run verify',
    flag => {
      const result = polyman(['verify', flag], problem);
      expect(result.status).toBe(0);
      expect(result.out).toContain('polyman - ');
      expect(result.out).not.toContain('VERIFICATION');
    },
    TIMEOUT_MS + 5_000
  );
});
