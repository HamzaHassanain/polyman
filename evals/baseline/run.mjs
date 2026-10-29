#!/usr/bin/env node
// W13: the single-loop baseline. One long Gemma chat loop with all the tools
// and no workflow builds a T1 problem from its spec, so we can compare it to
// the workflow runs of W11.
//
//   npm run build
//   source ~/.config/openrouter.env   # sets OPENROUTER_API_KEY
//   node evals/baseline/run.mjs --case pairs-sum
//
// Options:
//   --case <id>         a case of evals/cases/ (or --all)
//   --model <id>        OpenRouter model (default google/gemma-4-31b-it)
//   --max-steps <n>     model calls in the one turn (default 80)
//   --max-cost <usd>    the runner cancels the turn above this cost (default 0.6)
//   --max-minutes <n>   the runner cancels the turn after this (default 40)
//   --rerender <dir>    only write report.md/json again from a result folder
//
// Writes evals/baseline/results/<case>-<time>/: events.jsonl, messages.json,
// verify.json, report.md, report.json and problem/ (the agent's files).
// The key is read from the environment only, and scrubbed from every file.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeScrub, renderReport, reportJson, summarize } from './report.mjs';

import eventBusMod from '../../dist/agent/core/event-bus.js';
import promptMod from '../../dist/agent/core/prompt.js';
import sessionMod from '../../dist/agent/core/session.js';
import gemmaMod from '../../dist/agent/providers/gemma.js';
import openaiMod from '../../dist/agent/providers/openai-compatible.js';
import presetsMod from '../../dist/agent/providers/presets.js';
import retryMod from '../../dist/agent/providers/retry.js';
import runnerMod from '../../dist/agent/runner/cli-runner.js';
import skillsMod from '../../dist/agent/skills.js';
import cliToolsMod from '../../dist/agent/tools/cli-tools.js';
import fsToolsMod from '../../dist/agent/tools/fs-tools.js';
import notesMod from '../../dist/agent/tools/notes-tools.js';
import permissionsMod from '../../dist/agent/tools/permissions.js';
import registryMod from '../../dist/agent/tools/registry.js';
import sandboxMod from '../../dist/agent/tools/sandbox.js';

const { SimpleEventBus } = eventBusMod;
const { ChatPromptBuilder, NOTES_PATH } = promptMod;
const { AgentSession } = sessionMod;
const { GEMMA_BUDGETS, GEMMA_DEFAULT_MODEL } = gemmaMod;
const { OpenAICompatibleProvider } = openaiMod;
const { getPreset } = presetsMod;
const { withRetries } = retryMod;
const { NodeCliRunner } = runnerMod;
const { skillTools } = skillsMod;
const { cliTools } = cliToolsMod;
const { fsTools } = fsToolsMod;
const { NotesStore, notesTools } = notesMod;
const { DefaultPermissionGate } = permissionsMod;
const { DefaultToolRegistry } = registryMod;
const { FolderSandbox } = sandboxMod;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const CLI = path.join(REPO, 'dist', 'cli.js');
const TESTLIB = path.join(REPO, 'corpus', 'vendor', 'testlib.h');
const CASES = path.join(REPO, 'evals', 'cases');

/** The one user message (W13 brief). */
export const MESSAGE =
  'Build the whole problem from .polyman/agent/notes.md: statement, main ' +
  'solution, brute force, wrong solutions, validator, generators, checker, ' +
  'Config.json. Run verify at the end and fix it until it passes.';

/** Added to the chat prompt: the baseline has no workflow tool. */
const NO_WORKFLOW =
  'In this session there is no start_workflow tool. Do every step yourself ' +
  'with the other tools.';

// ---------------------------------------------------------------------------
// Arguments.

function parseArgs(argv) {
  const opts = {
    cases: [],
    model: GEMMA_DEFAULT_MODEL,
    maxSteps: 80,
    maxCost: 0.6,
    maxMinutes: 40,
  };
  for (let i = 0; i < argv.length; i++) {
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${argv[i - 1]} needs a value`);
      return v;
    };
    switch (argv[i]) {
      case '--case':
        opts.cases.push(next());
        break;
      case '--all':
        opts.cases = fs
          .readdirSync(CASES)
          .filter(d => fs.existsSync(path.join(CASES, d, 'case.json')))
          .sort();
        break;
      case '--model':
        opts.model = next();
        break;
      case '--max-steps':
        opts.maxSteps = Number(next());
        break;
      case '--max-cost':
        opts.maxCost = Number(next());
        break;
      case '--max-minutes':
        opts.maxMinutes = Number(next());
        break;
      default:
        throw new Error(`unknown option ${argv[i]}`);
    }
  }
  if (opts.cases.length === 0) throw new Error('give --case <id> or --all');
  return opts;
}

// ---------------------------------------------------------------------------
// Small helpers.

function stamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function polyman(args, cwd, timeoutMs = 600_000) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 64 * 1024 * 1024,
  });
  let json;
  try {
    json = JSON.parse(r.stdout);
  } catch {
    json = null;
  }
  return { status: r.status, json, stderr: r.stderr ?? '' };
}

function tokens(text) {
  return text.split(/\s+/).filter(Boolean);
}

function sameOutput(a, b) {
  const x = tokens(a);
  const y = tokens(b);
  return x.length === y.length && x.every((t, i) => t === y[i]);
}

function timeLimitMs(spec) {
  const m = /Time limit\s+([\d.]+)\s+second/i.exec(spec);
  return m ? Math.round(Number(m[1]) * 1000) : 1000;
}

function expectedVerdict(source) {
  const m = /^\/\/\s*expected:\s*(WA|TL|ML|RE)\b/m.exec(source);
  return m ? m[1] : 'WA';
}

/** Copies the agent's files, without tests, outputs and caches. */
function copyProblem(from, to) {
  const skip = new Set(['testsets', 'solutions-outputs', 'node_modules']);
  fs.cpSync(from, to, {
    recursive: true,
    filter: src => {
      const rel = path.relative(from, src);
      if (rel === '') return true;
      const parts = rel.split(path.sep);
      if (skip.has(parts[0])) return false;
      if (parts[0] === '.polyman' && parts[1] !== 'agent') return false;
      try {
        const st = fs.statSync(src);
        if (st.isDirectory()) return true;
        // Compiled binaries have no extension and the exec bit.
        if (path.extname(src) === '' && (st.mode & 0o111) !== 0) return false;
        return st.size < 1e6;
      } catch {
        return false;
      }
    },
  });
}

// ---------------------------------------------------------------------------
// The setup: a fresh problem folder with the spec as notes.

export function makeProblem(caseId) {
  const work = fs.mkdtempSync(
    path.join(os.tmpdir(), `polyman-baseline-${caseId}-`)
  );
  const problem = path.join(work, caseId);
  const r = polyman(['new', problem], work);
  if (r.status !== 0) throw new Error(`polyman new failed: ${r.stderr}`);
  // A local copy of testlib.h, so the run needs no network.
  fs.copyFileSync(TESTLIB, path.join(problem, 'testlib.h'));
  fs.mkdirSync(path.join(problem, '.polyman', 'agent'), { recursive: true });
  fs.copyFileSync(
    path.join(CASES, caseId, 'spec.md'),
    path.join(problem, NOTES_PATH)
  );
  return problem;
}

/** OpenRouter with the preset's quirks, plus reasoning off. */
function makeProvider(apiKey) {
  const preset = getPreset('openrouter');
  const quirks = { ...preset.quirks };
  const base = quirks.extraBody;
  quirks.extraBody = req => ({
    ...(base ? base(req) : {}),
    reasoning: { enabled: false },
  });
  return new OpenAICompatibleProvider({
    id: preset.id,
    baseUrl: preset.baseUrl,
    apiKey,
    headers: { ...preset.headers },
    quirks,
  });
}

/**
 * The chat of createChatRuntime (src/agent/index.ts), built from the same
 * parts, without start_workflow.
 */
function makeSession({ problem, provider, model, secrets, maxSteps }) {
  const bus = new SimpleEventBus();
  const gate = new DefaultPermissionGate(bus, 'auto-edit');
  const runner = new NodeCliRunner();
  let problemDir = problem;
  let sandbox = new FolderSandbox(problemDir);
  let lastCallId = '';
  bus.on(e => {
    if (e.type === 'tool_call') lastCallId = e.callId;
  });

  const notes = new NotesStore(bus, () => problemDir);
  const tools = new DefaultToolRegistry({
    permissions: gate,
    capBytes: GEMMA_BUDGETS.toolResultCapBytes,
  });
  for (const tool of [
    ...fsTools(),
    ...cliTools(),
    ...skillTools(),
    ...notesTools(notes),
  ]) {
    tools.register(tool);
  }

  const prompt = new ChatPromptBuilder({
    problemDir: () => problemDir,
    notes: () => Promise.resolve(notes.pending()),
  });

  const session = new AgentSession({
    provider,
    model,
    tools,
    permissions: gate,
    bus,
    async buildSystemPrompt() {
      return `${await prompt.build()}\n${NO_WORKFLOW}`;
    },
    makeToolContext: signal => ({
      problemDir,
      signal,
      runner,
      sandbox,
      progress: line => {
        bus.emit({ type: 'tool_progress', callId: lastCallId, line });
      },
      setProblemDir: dir => {
        problemDir = path.resolve(dir);
        sandbox = new FolderSandbox(problemDir);
        bus.emit({ type: 'problem_dir_changed', problemDir });
      },
    }),
    secrets: () => secrets,
    maxSteps,
    contextBudgetTokens: GEMMA_BUDGETS.contextBudgetTokens,
    maxOutputTokens: GEMMA_BUDGETS.maxOutputTokens,
    temperature: GEMMA_BUDGETS.temperature,
  });

  // Auto-approve every approval. Remote (Polygon) calls are denied: an eval
  // must never touch Polygon.
  const riskOf = new Map();
  bus.on(e => {
    if (e.type === 'tool_call') riskOf.set(e.callId, e.risk);
    if (e.type === 'approval_needed') {
      const remote = riskOf.get(e.callId) === 'remote';
      queueMicrotask(() =>
        gate.resolve(
          e.approvalId,
          remote
            ? { kind: 'deny', reason: 'no Polygon calls in this eval' }
            : { kind: 'allow_once' }
        )
      );
    }
  });

  return { session, bus, problemDir: () => problemDir };
}

// ---------------------------------------------------------------------------
// Hidden checks (T1): the truth the agent never saw.

function readConfig(problem) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(problem, 'Config.json'), 'utf8')
    );
  } catch {
    return null;
  }
}

/**
 * Runs the reference main and the reference wrong solutions on the agent's
 * tests with `polyman test` (against the agent's main and checker).
 */
function referenceOnAgentTests(problem, caseId, notes) {
  const ref = path.join(CASES, caseId, 'reference');
  const configFile = path.join(problem, 'Config.json');
  const original = fs.readFileSync(configFile, 'utf8');
  const config = readConfig(problem);
  const hiddenDir = path.join(problem, 'solutions', 'hidden-ref');
  const wrongFiles = fs
    .readdirSync(ref)
    .filter(f => /^wa-.*\.cpp$/.test(f))
    .sort();
  const entries = [
    { name: 'hidden_ref_main', file: 'main.cpp', tag: 'OK' },
    ...wrongFiles.map(f => ({
      name: `hidden_ref_${f.replace(/\.cpp$/, '').replace(/-/g, '_')}`,
      file: f,
      tag: expectedVerdict(fs.readFileSync(path.join(ref, f), 'utf8')),
      wrong: true,
    })),
  ];
  const results = {};
  if (!config || !Array.isArray(config.solutions)) {
    notes.push('Config.json is missing or has no solutions list.');
    for (const e of entries)
      results[e.name] = { ok: false, detail: 'no config' };
    return { entries, results };
  }
  try {
    fs.mkdirSync(hiddenDir, { recursive: true });
    for (const e of entries) {
      fs.copyFileSync(path.join(ref, e.file), path.join(hiddenDir, e.file));
    }
    config.solutions = [
      ...config.solutions,
      ...entries.map(e => ({
        name: e.name,
        source: `./solutions/hidden-ref/${e.file}`,
        tag: e.tag,
        sourceType: 'cpp.g++17',
      })),
    ];
    fs.writeFileSync(configFile, JSON.stringify(config, null, 2));
    const gen = polyman(['generate', '--all', '--json'], problem);
    if (!gen.json?.ok)
      notes.push("generate --all failed on the agent's problem.");
    for (const e of entries) {
      const r = polyman(['test', e.name, '--json'], problem);
      const total = r.json?.summary?.total ?? 0;
      const by = r.json?.summary?.byVerdict ?? {};
      const verdicts = Object.entries(by)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ');
      results[e.name] = {
        ok: r.json?.matchesTag === true && total > 0,
        detail:
          total > 0
            ? `${total} tests: ${verdicts}`
            : (r.json?.errors?.[0] ?? 'no tests ran').slice(0, 160),
      };
    }
  } finally {
    fs.writeFileSync(configFile, original);
    fs.rmSync(hiddenDir, { recursive: true, force: true });
  }
  return { entries, results };
}

/** Runs the agent's main solution on the reference tests. */
function agentMainOnRefTests(problem, caseId, tl, work) {
  const config = readConfig(problem);
  const main = config?.solutions?.find?.(s => s.tag === 'MA');
  if (!main) return { ok: false, detail: 'no MA solution in Config.json' };
  const src = path.resolve(problem, main.source ?? '');
  if (!fs.existsSync(src))
    return { ok: false, detail: `missing ${main.source}` };
  let cmd;
  let args = [];
  if (src.endsWith('.cpp')) {
    const bin = path.join(work, 'agent-main');
    const c = spawnSync('g++', ['-O2', '-std=c++17', '-o', bin, src], {
      encoding: 'utf8',
    });
    if (c.status !== 0) return { ok: false, detail: 'does not compile' };
    cmd = bin;
  } else if (src.endsWith('.py')) {
    cmd = 'python3';
    args = [src];
  } else {
    return { ok: false, detail: `cannot run ${path.extname(src)} here` };
  }
  const ref = path.join(CASES, caseId, 'reference');
  const tests = fs
    .readdirSync(path.join(ref, 'tests'))
    .filter(f => f.endsWith('.txt'))
    .sort();
  const failed = [];
  let maxMs = 0;
  for (const t of tests) {
    const start = Date.now();
    const r = spawnSync(cmd, args, {
      input: fs.readFileSync(path.join(ref, 'tests', t)),
      encoding: 'utf8',
      timeout: Math.max(3 * tl, 5000),
      maxBuffer: 64 * 1024 * 1024,
    });
    const ms = Date.now() - start;
    maxMs = Math.max(maxMs, ms);
    const answer = fs.readFileSync(path.join(ref, 'answers', t), 'utf8');
    if (r.error?.code === 'ETIMEDOUT' || ms > 2 * tl) failed.push(`${t} TL`);
    else if (r.status !== 0) failed.push(`${t} RE`);
    else if (!sameOutput(r.stdout ?? '', answer)) failed.push(`${t} WA`);
  }
  return {
    ok: failed.length === 0,
    detail:
      failed.length === 0
        ? `${tests.length}/${tests.length} tests, max ${maxMs} ms`
        : `fails ${failed.slice(0, 4).join(', ')}${failed.length > 4 ? ', ...' : ''}`,
  };
}

export function hiddenChecks(problem, caseId, work) {
  const spec = fs.readFileSync(path.join(CASES, caseId, 'spec.md'), 'utf8');
  const tl = timeLimitMs(spec);
  const notes = [];
  const { entries, results } = referenceOnAgentTests(problem, caseId, notes);
  const refMain = results['hidden_ref_main'];
  const agentMain = agentMainOnRefTests(problem, caseId, tl, work);
  const items = entries
    .filter(e => e.wrong)
    .map(e => ({
      name: e.file.replace(/\.cpp$/, ''),
      expected: e.tag,
      // A catch only counts when the agent's tests, main and checker agree
      // with the reference main, else every wrong solution "fails".
      caught: refMain.ok && results[e.name].ok,
      detail: refMain.ok
        ? results[e.name].detail
        : `not counted, the reference main fails these tests (${results[e.name].detail})`,
    }));
  return {
    passed: (refMain.ok ? 1 : 0) + (agentMain.ok ? 1 : 0),
    total: 2,
    refMainOnAgentTests: refMain,
    agentMainOnRefTests: agentMain,
    wrongCaught: {
      caught: items.filter(i => i.caught).length,
      total: items.length,
      items,
    },
    notes,
  };
}

// ---------------------------------------------------------------------------
// One run.

async function runCase(caseId, opts, apiKey) {
  const scrub = makeScrub([apiKey]);
  const startedAt = new Date();
  const outDir = path.join(HERE, 'results', `${caseId}-${stamp(startedAt)}`);
  fs.mkdirSync(outDir, { recursive: true });
  const problem = makeProblem(caseId);
  const work = path.dirname(problem);
  console.log(`== ${caseId}: problem ${problem}`);
  console.log(`   results ${path.relative(REPO, outDir)}`);

  const provider = withRetries(makeProvider(apiKey), { secrets: [apiKey] });
  const { session, bus } = makeSession({
    problem,
    provider,
    model: opts.model,
    secrets: [apiKey],
    maxSteps: opts.maxSteps,
  });

  const events = [];
  const log = fs.openSync(path.join(outDir, 'events.jsonl'), 'w');
  let cost = 0;
  let stop = null;
  bus.on(e => {
    const row = { t: Date.now() - startedAt.getTime(), ...e };
    events.push(row);
    fs.writeSync(log, scrub(JSON.stringify(row)) + '\n');
    if (e.type === 'tool_call') {
      console.log(
        `   [${events.filter(x => x.type === 'usage').length}] ${e.name} ${scrub(JSON.stringify(e.args)).slice(0, 100)}`
      );
    }
    if (e.type === 'tool_result' && !e.ok) {
      console.log(`      error: ${scrub(e.summary).slice(0, 120)}`);
    }
    if (e.type === 'usage') {
      cost += e.costUsd ?? (e.inputTokens * 0.2 + e.outputTokens * 0.4) / 1e6;
      if (cost > opts.maxCost && stop === null) {
        stop = `cost cap $${opts.maxCost}`;
        session.cancel();
      }
    }
  });
  const timer = setTimeout(() => {
    if (stop === null) stop = `time cap ${opts.maxMinutes} min`;
    session.cancel();
  }, opts.maxMinutes * 60_000);

  const t0 = Date.now();
  let reason;
  try {
    reason = await session.send(MESSAGE);
  } finally {
    clearTimeout(timer);
  }
  const agentMs = Date.now() - t0;
  console.log(
    `   turn ended: ${reason}${stop ? ` (${stop})` : ''}, ${Math.round(agentMs / 1000)} s`
  );

  const messages = session.messages;
  fs.writeFileSync(
    path.join(outDir, 'messages.json'),
    scrub(JSON.stringify(messages, null, 2))
  );
  let lastText = '';
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    const text = m.parts
      .filter(p => p.type === 'text')
      .map(p => p.text)
      .join('');
    if (text.trim() !== '') lastText = text;
  }

  console.log('   running verify and the hidden checks');
  const v = polyman(['verify', '--json'], problem);
  fs.writeFileSync(
    path.join(outDir, 'verify.json'),
    scrub(JSON.stringify(v.json, null, 2) ?? 'null')
  );
  const verifyPassed = v.status === 0 && v.json?.ok === true;
  const hidden = hiddenChecks(problem, caseId, work);
  copyProblem(problem, path.join(outDir, 'problem'));
  fs.closeSync(log);

  const data = {
    caseId,
    model: opts.model,
    maxSteps: opts.maxSteps,
    contextBudget: GEMMA_BUDGETS.contextBudgetTokens,
    startedAt: startedAt.toISOString(),
    summary: summarize(events, messages),
    verify: v.json,
    verifyPassed,
    hidden,
    agentMs,
    totalMs: Date.now() - t0,
    stop,
    lastText,
  };
  const raw = { ...data };
  delete raw.summary;
  fs.writeFileSync(path.join(outDir, 'data.json'), scrub(JSON.stringify(raw)));
  fs.writeFileSync(path.join(outDir, 'report.md'), scrub(renderReport(data)));
  fs.writeFileSync(
    path.join(outDir, 'report.json'),
    scrub(JSON.stringify(reportJson(data), null, 2))
  );
  fs.rmSync(work, { recursive: true, force: true });
  return { outDir, json: reportJson(data) };
}

/** Writes report.md and report.json again from the files of a result. */
function rerender(outDir) {
  const raw = JSON.parse(
    fs.readFileSync(path.join(outDir, 'data.json'), 'utf8')
  );
  const events = fs
    .readFileSync(path.join(outDir, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
  const messages = JSON.parse(
    fs.readFileSync(path.join(outDir, 'messages.json'), 'utf8')
  );
  const data = { ...raw, summary: summarize(events, messages) };
  fs.writeFileSync(path.join(outDir, 'report.md'), renderReport(data));
  fs.writeFileSync(
    path.join(outDir, 'report.json'),
    JSON.stringify(reportJson(data), null, 2)
  );
  console.log(`rewrote ${path.relative(REPO, outDir)}/report.md`);
}

async function main() {
  const rerenderAt = process.argv.indexOf('--rerender');
  if (rerenderAt >= 0) {
    rerender(path.resolve(process.argv[rerenderAt + 1]));
    return;
  }
  const opts = parseArgs(process.argv.slice(2));
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    console.error('Set OPENROUTER_API_KEY (source ~/.config/openrouter.env).');
    process.exit(2);
  }
  if (!fs.existsSync(CLI)) {
    console.error('Run npm run build first.');
    process.exit(2);
  }
  const rows = [];
  for (const caseId of opts.cases) {
    const { outDir, json } = await runCase(caseId, opts, apiKey);
    rows.push(json);
    console.log(
      fs
        .readFileSync(path.join(outDir, 'report.md'), 'utf8')
        .split('## Session')[0]
    );
  }
  if (rows.length > 1) {
    console.log('| case | verify | hidden | time | calls | tokens | cost |');
    console.log('| --- | --- | --- | --- | --- | --- | --- |');
    for (const r of rows) {
      console.log(
        `| ${r.case} | ${r.verifyPassed ? 'yes' : 'no'} | ${r.hiddenChecks.passed}/${r.hiddenChecks.total} | ${Math.round(r.timeMs / 1000)} s | ${r.calls} | ${r.tokens.total} | $${r.costUsd.toFixed(4)} |`
      );
    }
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch(err => {
    const key = process.env.OPENROUTER_API_KEY ?? '';
    console.error(makeScrub([key])(err?.stack ?? String(err)));
    process.exit(1);
  });
}
