// Checks the T1 test problems in evals/cases/<id>/.
//
// For every case:
//   1- main.cpp output matches reference/answers/ on every test
//   2- brute.cpp agrees with main.cpp on every test
//   3- every wa-*.cpp fails at least one test (its first line says
//      `// expected: WA` or `// expected: TL`)
//   4- a temp polyman problem built from the reference passes `polyman verify`
//
// Usage (after `npm run build`):
//   node evals/cases/check.mjs                  all cases
//   node evals/cases/check.mjs --case pairs-sum one case
//   node evals/cases/check.mjs --write-answers  (re)write answers/ from main
//   node evals/cases/check.mjs --no-verify      skip the polyman verify step
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const casesDir = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(casesDir, '..', '..');
const cli = path.join(repoDir, 'dist', 'cli.js');
const testlib = path.join(repoDir, 'corpus', 'vendor', 'testlib.h');

const args = process.argv.slice(2);
const writeAnswers = args.includes('--write-answers');
const skipVerify = args.includes('--no-verify');
const caseArg = args.indexOf('--case');
const onlyCase = caseArg >= 0 ? args[caseArg + 1] : null;

function tokens(text) {
  return text.split(/\s+/).filter(Boolean);
}

function sameOutput(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  return x.length === y.length && x.every((t, i) => t === y[i]);
}

function parseSpec(text) {
  const timeMatch = /Time limit\s+([\d.]+)\s+second/i.exec(text);
  const memMatch = /memory limit\s+(\d+)\s*MB/i.exec(text);
  const checkerMatch = /Checker:\s*([a-z0-9]+)/i.exec(text);
  return {
    timeLimitMs: timeMatch ? Math.round(Number(timeMatch[1]) * 1000) : 1000,
    memoryLimitMb: memMatch ? Number(memMatch[1]) : 256,
    checker: checkerMatch ? checkerMatch[1] : 'ncmp',
  };
}

function expectedVerdict(source) {
  const m = /^\/\/\s*expected:\s*(WA|TL|ML|RE)\b/m.exec(source);
  if (!m) throw new Error('missing "// expected: <verdict>" line');
  return m[1];
}

function compile(src, out) {
  const r = spawnSync('g++', ['-O2', '-std=c++17', '-o', out, src], {
    encoding: 'utf8',
  });
  if (r.status !== 0) throw new Error(`compile failed: ${src}\n${r.stderr}`);
}

function runBinary(bin, inputFile, timeoutMs) {
  const start = Date.now();
  const r = spawnSync(bin, [], {
    input: fs.readFileSync(inputFile),
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  const ms = Date.now() - start;
  const timedOut = r.error !== undefined && r.error.code === 'ETIMEDOUT';
  return {
    out: r.stdout ?? '',
    ms,
    timedOut,
    crashed: !timedOut && r.status !== 0,
  };
}

function verifyWithPolyman(id, caseDir, tests, spec, wrong, work) {
  const problem = path.join(work, 'problem');
  const r = spawnSync('node', [cli, 'new', problem], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`polyman new failed\n${r.stderr}`);
  const ref = path.join(caseDir, 'reference');
  fs.copyFileSync(testlib, path.join(problem, 'testlib.h'));
  fs.copyFileSync(
    path.join(ref, 'val.cpp'),
    path.join(problem, 'validator', 'val.cpp')
  );
  fs.rmSync(path.join(problem, 'solutions'), { recursive: true, force: true });
  fs.mkdirSync(path.join(problem, 'solutions'));
  const solutions = [
    { name: 'main', file: 'main.cpp', tag: 'MA' },
    { name: 'brute', file: 'brute.cpp', tag: 'TO' },
    ...wrong.map(w => ({ name: w.name, file: w.file, tag: w.expected })),
  ];
  for (const s of solutions) {
    fs.copyFileSync(
      path.join(ref, s.file),
      path.join(problem, 'solutions', s.file)
    );
  }
  const manualDir = path.join(problem, 'manual', 'tests');
  fs.rmSync(manualDir, { recursive: true, force: true });
  fs.mkdirSync(manualDir, { recursive: true });
  const manualTests = tests.map((t, i) => {
    const name = `m-${String(i + 1).padStart(2, '0')}.in`;
    fs.copyFileSync(path.join(ref, 'tests', t), path.join(manualDir, name));
    return { input: `./manual/tests/${name}`, index: i + 1 };
  });
  const config = JSON.parse(
    fs.readFileSync(path.join(problem, 'Config.json'), 'utf8')
  );
  config.name = id;
  config.timeLimit = spec.timeLimitMs;
  config.memoryLimit = spec.memoryLimitMb;
  config.solutions = solutions.map(s => ({
    name: s.name,
    source: `./solutions/${s.file}`,
    tag: s.tag,
    sourceType: 'cpp.g++17',
  }));
  config.generators = [];
  config.checker = {
    name: spec.checker,
    source: `${spec.checker}.cpp`,
    isStandard: true,
  };
  config.validator = { name: 'validator', source: './validator/val.cpp' };
  config.testsets = [{ name: 'tests', manualTests, groupsEnabled: false }];
  fs.writeFileSync(
    path.join(problem, 'Config.json'),
    JSON.stringify(config, null, 2)
  );
  const v = spawnSync('node', [cli, 'verify', '--json'], {
    cwd: problem,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  let report;
  try {
    report = JSON.parse(v.stdout);
  } catch {
    report = null;
  }
  if (v.status !== 0 || !report || !report.ok) {
    const why = report
      ? `failed step ${report.failedStep}: ${JSON.stringify(report.steps.at(-1)?.errors ?? [])}`
      : v.stderr.slice(-2000);
    throw new Error(`polyman verify failed (${problem})\n${why}`);
  }
  return report;
}

function checkCase(id) {
  const caseDir = path.join(casesDir, id);
  const ref = path.join(caseDir, 'reference');
  const spec = parseSpec(
    fs.readFileSync(path.join(caseDir, 'spec.md'), 'utf8')
  );
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `polyman-case-${id}-`));
  const tests = fs
    .readdirSync(path.join(ref, 'tests'))
    .filter(f => f.endsWith('.txt'))
    .sort();
  const wrong = fs
    .readdirSync(ref)
    .filter(f => /^wa-.*\.cpp$/.test(f))
    .sort()
    .map(file => ({
      file,
      name: file.replace(/\.cpp$/, ''),
      expected: expectedVerdict(fs.readFileSync(path.join(ref, file), 'utf8')),
    }));
  const problems = [];
  console.log(
    `\n== ${id}: ${tests.length} tests, TL ${spec.timeLimitMs} ms, checker ${spec.checker}`
  );

  const bin = name => path.join(work, name);
  for (const f of ['main.cpp', 'brute.cpp', ...wrong.map(w => w.file)]) {
    compile(path.join(ref, f), bin(f.replace(/\.cpp$/, '')));
  }

  const answersDir = path.join(ref, 'answers');
  fs.mkdirSync(answersDir, { recursive: true });
  const mainOut = {};
  for (const t of tests) {
    const input = path.join(ref, 'tests', t);
    const m = runBinary(bin('main'), input, 10000);
    if (m.timedOut || m.crashed) problems.push(`main failed on ${t}`);
    if (m.ms > spec.timeLimitMs / 2)
      problems.push(`main is slow on ${t}: ${m.ms} ms`);
    mainOut[t] = m.out;
    const answerFile = path.join(answersDir, t);
    if (writeAnswers) fs.writeFileSync(answerFile, m.out);
    else if (!fs.existsSync(answerFile)) problems.push(`missing answers/${t}`);
    else if (!sameOutput(fs.readFileSync(answerFile, 'utf8'), m.out))
      problems.push(`main output differs from answers/${t}`);
    const b = runBinary(bin('brute'), input, 120000);
    if (b.timedOut || b.crashed) problems.push(`brute failed on ${t}`);
    else if (!sameOutput(b.out, m.out))
      problems.push(`brute and main differ on ${t}`);
    console.log(
      `  ${t}: main ${m.ms} ms, brute ${b.ms} ms, answer ${tokens(m.out).join(' ').slice(0, 40)}`
    );
  }

  for (const w of wrong) {
    const failed = [];
    for (const t of tests) {
      const r = runBinary(
        bin(w.name),
        path.join(ref, 'tests', t),
        spec.timeLimitMs * 3
      );
      let verdict = 'OK';
      if (r.timedOut || r.ms > spec.timeLimitMs) verdict = 'TL';
      else if (r.crashed) verdict = 'RE';
      else if (!sameOutput(r.out, mainOut[t])) verdict = 'WA';
      if (verdict !== 'OK') failed.push(`${t} ${verdict}`);
    }
    const matches = failed.some(f => f.endsWith(` ${w.expected}`));
    console.log(
      `  ${w.name} (expected ${w.expected}): fails on ${failed.join(', ') || 'nothing'}`
    );
    if (!matches) problems.push(`${w.name} never gets ${w.expected}`);
  }

  if (!skipVerify && problems.length === 0) {
    try {
      const report = verifyWithPolyman(id, caseDir, tests, spec, wrong, work);
      const tags = report.solutions.map(s => `${s.name}:${s.tag}`).join(' ');
      console.log(`  polyman verify: ok (${tags})`);
    } catch (e) {
      problems.push(e.message);
    }
  }

  if (problems.length === 0) fs.rmSync(work, { recursive: true, force: true });
  else console.log(`  work folder kept: ${work}`);
  return problems;
}

const ids = onlyCase
  ? [onlyCase]
  : fs
      .readdirSync(casesDir)
      .filter(d => fs.existsSync(path.join(casesDir, d, 'case.json')))
      .sort();

let bad = 0;
for (const id of ids) {
  const problems = checkCase(id);
  if (problems.length > 0) {
    bad++;
    for (const p of problems) console.log(`  FAIL ${p}`);
  } else {
    console.log(`  PASS ${id}`);
  }
}
process.exit(bad === 0 ? 0 : 1);
