#!/usr/bin/env node
/**
 * The precompiled <bits/stdc++.h> (src/helpers/pch.ts, #113) judged on a real
 * corpus problem: one main solution that starts with `#include <bits/stdc++.h>`
 * is compiled and run on the problem's tests five times, by `polyman run`
 * with POLYMAN_DEBUG=1:
 *
 *   no-pch       --no-cache, so no PCH            expects "pch: off"
 *   pch-build    PCH on, empty PCH folder         expects "built key K" and "using key K"
 *   pch-reuse    PCH on, the same folder          expects "using key K", nothing built
 *   other-flags  compiler.flags ["-O1"]           expects a new key built and used, not K
 *   clang        POLYMAN_CXX=clang++, c++20       expects "skipped, ... is not g++"
 *
 * Each run gets a fresh copy of the problem (so polyman's compile cache never
 * skips the compile) with the same tests, generated once without the PCH. It
 * fails when a run took another path, when a compile failed with the PCH (and
 * polyman retried without it), or when the verdicts or any output file differ
 * from the no-pch run.
 *
 * Usage:
 *   node corpus/pch-check.mjs [--polyman dist/cli.js] [--problem <name>]
 *                             [--clang clang++] [--keep]
 *
 * Needs g++ and clang++. Without --problem it takes the first corpus problem
 * whose main solution starts with `#include <bits/stdc++.h>`.
 */

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CORPUS = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(CORPUS);
const PROBLEMS = path.join(CORPUS, 'problems');
const TESTLIB = path.join(CORPUS, 'vendor', 'testlib.h');
const RUN_TIMEOUT_MS = 10 * 60 * 1000;

/** The value after a flag, or a clear error when it's missing. */
function valueOf(argv, i, flag) {
  const value = argv[i];
  if (value === undefined || value.startsWith('--'))
    throw new Error(`${flag} needs a value`);
  return value;
}

export function parseArgs(argv) {
  const args = {
    polyman: path.join(ROOT, 'dist', 'cli.js'),
    problem: null,
    clang: 'clang++',
    keep: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--keep') args.keep = true;
    else if (arg === '--polyman')
      args.polyman = path.resolve(valueOf(argv, ++i, arg));
    else if (arg === '--problem') args.problem = valueOf(argv, ++i, arg);
    else if (arg === '--clang') args.clang = valueOf(argv, ++i, arg);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

/**
 * Whether a source's first directive, after blank lines and comments, is
 * `#include <bits/stdc++.h>`. The same rule as startsWithBitsStdcpp in
 * src/helpers/pch.ts, kept here so the check doesn't trust polyman's.
 */
export function startsWithBitsStdcpp(text) {
  const rest = text.replace(/^(?:\s+|\/\/[^\n]*|\/\*[\s\S]*?\*\/)*/, '');
  return /^#\s*include\s*<bits\/stdc\+\+\.h>/.test(rest);
}

/** The MA solution of a Config.json, or null. */
export function mainSolution(config) {
  return (config.solutions ?? []).find(s => s.tag === 'MA') ?? null;
}

/**
 * The paths the PCH took for `source` in one polyman run, from its
 * POLYMAN_DEBUG lines (debugLog in src/helpers/compile-cache.ts and pch.ts).
 * Keys are the 12-character prefixes polyman logs. The retry (utils.ts) and
 * "marked unsupported" (pch.ts) lines name no source, so any of them counts:
 * the fallback compile works, so without them a broken PCH would pass.
 */
export function pchPathOf(stderr, source) {
  const lines = String(stderr ?? '')
    .split(/\r?\n/)
    .filter(l => l.startsWith('[polyman debug] '))
    .map(l => l.slice('[polyman debug] '.length));
  const result = {
    off: false,
    builtKey: null,
    buildMs: null,
    usedKey: null,
    notGxx: false,
    cacheHit: false,
    noneKey: null,
    retried: false,
    markedUnsupported: null,
    lines: lines.filter(l => l.startsWith('pch:') || l.startsWith('cache:')),
  };
  for (const line of lines) {
    let m;
    if (line === `pch: off, normal compile: ${source}`) result.off = true;
    else if ((m = /^pch: built key (\w+) in (\d+)ms/.exec(line))) {
      result.builtKey = m[1];
      result.buildMs = Number(m[2]);
    } else if ((m = /^pch: using key (\w+) for (.+)$/.exec(line))) {
      if (m[2] === source) result.usedKey = m[1];
    } else if (
      (m = /^pch: none for key (\w+), normal compile: (.+)$/.exec(line))
    ) {
      if (m[2] === source) result.noneKey = m[1];
    } else if (
      /^pch: skipped, .* is not g\+\+ /.test(line) &&
      line.endsWith(`normal compile: ${source}`)
    )
      result.notGxx = true;
    else if (line === `cache: hit, no compile: ${source}`)
      result.cacheHit = true;
    else if (line === 'pch: compile failed with the PCH, retrying without it')
      result.retried = true;
    else if ((m = /^pch: key (\w+) marked unsupported/.exec(line)))
      result.markedUnsupported = m[1];
  }
  return result;
}

/** One line saying which path a run took, for the log. */
export function describePath(p) {
  if (p.cacheHit) return 'compile cache hit, not compiled';
  if (p.retried) return 'compile failed with the PCH, retried without it';
  if (p.markedUnsupported)
    return `key ${p.markedUnsupported} marked unsupported`;
  if (p.off) return 'PCH off, normal compile';
  if (p.notGxx) return 'skipped: not g++, normal compile';
  if (p.builtKey && p.usedKey)
    return `built key ${p.builtKey} in ${p.buildMs} ms, then used it`;
  if (p.usedKey) return `used key ${p.usedKey}`;
  if (p.noneKey) return `no PCH for key ${p.noneKey}, normal compile`;
  return 'no PCH line for the solution';
}

/**
 * The runs, in order. `expect(path, keys)` lists what is wrong with the path
 * a run took; `keys` holds the keys earlier runs built.
 */
export const RUNS = [
  {
    name: 'no-pch',
    args: ['--no-cache'],
    expect: p => (p.off ? [] : ['expected "pch: off" (--no-cache)']),
  },
  {
    name: 'pch-build',
    expect: (p, keys) => {
      if (!p.builtKey) return ['expected a PCH built on an empty PCH folder'];
      keys.first = p.builtKey;
      return p.usedKey === p.builtKey
        ? []
        : [`expected the solution to use the built key ${p.builtKey}`];
    },
  },
  {
    name: 'pch-reuse',
    expect: (p, keys) => {
      const problems = [];
      if (p.builtKey) problems.push(`expected no build, built ${p.builtKey}`);
      if (!keys.first || p.usedKey !== keys.first)
        problems.push(`expected the key built before (${keys.first}) used`);
      return problems;
    },
  },
  {
    name: 'other-flags',
    flags: ['-O1'],
    expect: (p, keys) => {
      if (!p.builtKey) return ['expected a PCH of its own for other flags'];
      if (p.builtKey === keys.first)
        return [`expected a key other than ${keys.first}`];
      return p.usedKey === p.builtKey
        ? []
        : [`expected the solution to use the new key ${p.builtKey}`];
    },
  },
  {
    name: 'clang',
    clang: true,
    // clang 14 on the node:22 image does not know c++23, the default
    cppStandard: 'c++20',
    expect: p => {
      const problems = [];
      if (!p.notGxx) problems.push('expected "skipped, ... is not g++"');
      if (p.usedKey || p.builtKey) problems.push('clang must not use a PCH');
      return problems;
    },
  },
];

/**
 * Every run must compile the solution: a compile cache hit proves nothing.
 * And no compile may fail with the PCH, whatever the run expects.
 */
export function pathProblems(run, p, keys) {
  const problems = [];
  if (p.cacheHit)
    problems.push(
      'the compile cache restored the binary, nothing was compiled'
    );
  if (p.retried)
    problems.push('a compile failed with the PCH and was retried without it');
  if (p.markedUnsupported)
    problems.push(`the PCH key ${p.markedUnsupported} was marked unsupported`);
  return [...problems, ...run.expect(p, keys)];
}

/**
 * What a run produced: the verdict of every test in a `polyman run --json`
 * report (timing left out) and a hash of every output file.
 */
export function outcomeOf(report, outputs) {
  const tests = (report?.tests ?? [])
    .map(t => `${t.testset}#${t.index}:${t.verdict}`)
    .sort();
  return { ok: report?.ok === true, tests, outputs };
}

/**
 * A `polyman run --json` result judged on its own: its outcome, and what is
 * wrong with it. Stdout that is not JSON counts as a failed run with no tests.
 */
export function judgeResult(result, outputs) {
  let report = null;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    // judged below as a failed run
  }
  const outcome = outcomeOf(report, outputs);
  const problems = [];
  if (!outcome.ok || result.status !== 0)
    problems.push(`polyman run exited ${result.status}`);
  if (outcome.tests.length === 0) problems.push('no test ran');
  return { outcome, problems };
}

/** Differences between a run's outcome and the no-pch one. */
export function compareOutcomes(reference, actual) {
  const diffs = [];
  if (!actual.ok) diffs.push('polyman run did not succeed');
  if (actual.tests.join(' ') !== reference.tests.join(' '))
    diffs.push(
      `verdicts differ: ${actual.tests.join(' ')} vs ${reference.tests.join(' ')}`
    );
  const names = new Set([
    ...Object.keys(reference.outputs),
    ...Object.keys(actual.outputs),
  ]);
  for (const name of [...names].sort()) {
    if (!(name in actual.outputs)) diffs.push(`output ${name} missing`);
    else if (!(name in reference.outputs)) diffs.push(`extra output ${name}`);
    else if (actual.outputs[name] !== reference.outputs[name])
      diffs.push(`output ${name} differs`);
  }
  return diffs;
}

/** sha256 of every file under dir, by path relative to it. */
export function hashTree(dir) {
  const hashes = {};
  if (!fs.existsSync(dir)) return hashes;
  for (const entry of fs.readdirSync(dir, { recursive: true })) {
    const file = path.join(dir, entry);
    if (!fs.statSync(file).isFile()) continue;
    hashes[entry.split(path.sep).join('/')] = crypto
      .createHash('sha256')
      .update(fs.readFileSync(file))
      .digest('hex');
  }
  return hashes;
}

/** First line of `<tool> --version`, or null when the tool is missing. */
function toolVersion(command) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  if (result.error || result.status !== 0) return null;
  return `${result.stdout}${result.stderr}`.trim().split('\n')[0];
}

/**
 * The problem to check: `only`, or the first one by name whose main solution
 * starts with `#include <bits/stdc++.h>`.
 */
export function pickProblem(only, problems = PROBLEMS) {
  const names = only ? [only] : fs.readdirSync(problems).sort();
  for (const name of names) {
    const dir = path.join(problems, name);
    const configFile = path.join(dir, 'Config.json');
    if (!fs.existsSync(configFile)) {
      if (only) throw new Error(`no corpus problem ${only}`);
      continue;
    }
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    const main = mainSolution(config);
    if (!main || !main.source.endsWith('.cpp')) continue;
    if (
      startsWithBitsStdcpp(fs.readFileSync(path.join(dir, main.source), 'utf8'))
    )
      return { name, dir, config, main };
  }
  throw new Error(
    only
      ? `${only}: its main solution does not start with #include <bits/stdc++.h>`
      : 'no corpus problem has a main solution that starts with #include <bits/stdc++.h>'
  );
}

/**
 * The Config.json of a run: other compiler flags and C++ standard when the
 * run sets them, or null when it keeps the problem's.
 */
export function rewriteConfig(config, run) {
  if (!run.flags && !run.cppStandard) return null;
  const rewritten = { ...config };
  if (run.flags) rewritten.compiler = { ...config.compiler, flags: run.flags };
  if (run.cppStandard) rewritten.cppStandard = run.cppStandard;
  return rewritten;
}

/** A fresh copy of base at dir, with the run's Config.json. */
export function prepareRunDir(base, dir, run) {
  fs.cpSync(base, dir, { recursive: true });
  const configFile = path.join(dir, 'Config.json');
  const config = rewriteConfig(
    JSON.parse(fs.readFileSync(configFile, 'utf8')),
    run
  );
  if (config) fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
}

/** 0 when every run passed, 1 when some did not, 2 on a setup error. */
export function exitCodeOf(failures, setupFailed = false) {
  if (setupFailed) return 2;
  return failures.length ? 1 : 0;
}

function polyman(args, cwd, env, argv) {
  return spawnSync(process.execPath, [args.polyman, ...argv], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: RUN_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** The failures of every run; throws on a setup error. */
function main(argv) {
  const args = parseArgs(argv);
  const gxx = toolVersion('g++');
  const clang = toolVersion(args.clang);
  console.log(`g++: ${gxx ?? 'missing'}`);
  console.log(`${args.clang}: ${clang ?? 'missing'}`);
  if (!gxx || !clang)
    throw new Error('needs g++ and clang++: the check compiles with both');

  const problem = pickProblem(args.problem);
  const source = path.basename(problem.main.source);
  console.log(
    `problem: ${problem.name}, solution ${problem.main.name} (${problem.main.source})`
  );

  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'polyman-pch-check-'));
  const env = {
    ...process.env,
    POLYMAN_DEBUG: '1',
    // the PCH folder of these runs only, empty at the start
    POLYMAN_CACHE_DIR: path.join(work, 'user-cache'),
  };
  // polyman turns the PCH off when it is set (pch.ts)
  delete env.CPLUS_INCLUDE_PATH;
  delete env.POLYMAN_PCH;
  delete env.POLYMAN_CXX;

  const failures = [];
  try {
    // The tests, generated once without the PCH, the same for every run.
    const base = path.join(work, 'base');
    fs.cpSync(problem.dir, base, { recursive: true });
    fs.copyFileSync(TESTLIB, path.join(base, 'testlib.h'));
    const generated = polyman(args, base, { ...env, POLYMAN_PCH: '0' }, [
      'generate',
      '--all',
    ]);
    if (generated.status !== 0)
      throw new Error(
        `polyman generate --all failed:\n${generated.stdout}\n${generated.stderr}`
      );
    fs.rmSync(path.join(base, '.polyman'), { recursive: true, force: true });

    const keys = {};
    let reference = null;
    for (const run of RUNS) {
      const dir = path.join(work, run.name);
      prepareRunDir(base, dir, run);
      const runEnv = run.clang ? { ...env, POLYMAN_CXX: args.clang } : env;
      const started = Date.now();
      const result = polyman(args, dir, runEnv, [
        'run',
        problem.main.name,
        '--all',
        '--json',
        ...(run.args ?? []),
      ]);
      const seconds = ((Date.now() - started) / 1000).toFixed(1);

      const taken = pchPathOf(result.stderr, source);
      const judged = judgeResult(
        result,
        hashTree(path.join(dir, 'solutions-outputs', problem.main.name))
      );
      const outcome = judged.outcome;
      const problems = pathProblems(run, taken, keys);
      if (!reference) reference = outcome;
      else problems.push(...compareOutcomes(reference, outcome));
      problems.push(...judged.problems);

      console.log(
        `\n${problems.length ? 'FAIL' : 'ok  '} ${run.name} (${seconds} s): ${describePath(taken)}`
      );
      for (const line of taken.lines) console.log(`       ${line}`);
      console.log(
        `       ${outcome.tests.length} tests, ${Object.keys(outcome.outputs).length} output files`
      );
      for (const problem of problems) {
        console.log(`       - ${problem}`);
        failures.push(`${run.name}: ${problem}`);
      }
      if (problems.length && result.status !== 0)
        console.log(stderrTail(result.stderr));
    }
  } finally {
    if (args.keep) console.log(`\nkept ${work}`);
    else fs.rmSync(work, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(
      `\nFAIL: the PCH check on ${problem.name} has ${failures.length} problem(s):`
    );
    for (const failure of failures) console.error(`  ${failure}`);
    return failures;
  }
  console.log(
    `\nok: ${RUNS.length} runs of ${problem.name}/${source} took the expected paths and gave identical verdicts and outputs`
  );
  return failures;
}

/**
 * The last lines of a run's stderr. spawnSync gives null when the process
 * did not start, and that must not hide the real failure.
 */
export function stderrTail(stderr, lines = 20) {
  return String(stderr ?? '')
    .split('\n')
    .slice(-lines)
    .join('\n');
}

/**
 * Whether this file is the script node started. Both sides go through
 * realpath, so a symlinked path still runs the check instead of exiting 0.
 */
export function isEntry(argv1, moduleUrl = import.meta.url) {
  if (!argv1) return false;
  try {
    return fs.realpathSync(argv1) === fs.realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

/** Runs the check on argv and gives its exit code. */
export function runMain(argv) {
  try {
    return exitCodeOf(main(argv));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return exitCodeOf([], true);
  }
}

if (isEntry(process.argv[1])) process.exitCode = runMain(process.argv.slice(2));
