#!/usr/bin/env node
/**
 * Real runs: the whole build_problem workflow with real Gemma, no human.
 *
 *   npm run build
 *   source ~/.config/openrouter.env   # sets OPENROUTER_API_KEY
 *   node evals/real/run.mjs --case pairs-sum
 *   node evals/real/run.mjs --all
 *
 * Options:
 *   --case id         one case of evals/cases/ (or --all for every case)
 *   --model id        OpenRouter model id (default google/gemma-4-31b-it)
 *   --parallel N      tasks at the same time (default: the product limit)
 *   --reasoning m     off or on (default off, see evals/probe/README.md)
 *   --max-cost USD    stop a case when its Gemma cost goes over this (0.6)
 *
 * For each case it writes evals/real/results/<case>-<time>/ with
 * events.jsonl (every event), run.json (the numbers) and report.md.
 * The key is read from the environment, never written: every line goes
 * through `redact` before it is saved.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReport, renderSummary } from './report.mjs';

import agentIndex from '../../dist/agent/index.js';
import chatProviderMod from '../../dist/agent/providers/chat-provider.js';
import keyStoreMod from '../../dist/agent/providers/key-store.js';
import retryMod from '../../dist/agent/providers/retry.js';
import textCallMod from '../../dist/agent/core/text-tool-call.js';
import sessionMod from '../../dist/agent/core/session.js';
import runnerMod from '../../dist/agent/runner/cli-runner.js';
import cliToolsMod from '../../dist/agent/tools/cli-tools.js';
import fsToolsMod from '../../dist/agent/tools/fs-tools.js';
import sandboxMod from '../../dist/agent/tools/sandbox.js';
import registryMod from '../../dist/agent/tools/registry.js';
import permissionsMod from '../../dist/agent/tools/permissions.js';
import workflowToolMod from '../../dist/agent/tools/workflow-tool.js';
import skillsMod from '../../dist/agent/skills.js';
import checkpointsMod from '../../dist/agent/workflow/checkpoints.js';
import managerMod from '../../dist/agent/workflow/manager.js';
import schedulerMod from '../../dist/agent/workflow/scheduler.js';
import workerMod from '../../dist/agent/workflow/worker.js';

const { createChatRuntime } = agentIndex;
const { createChatProvider, DEFAULT_CHAT_MODEL } = chatProviderMod;
const { KeyStore, redact } = keyStoreMod;
const { withRetries } = retryMod;
const { findTextToolCall } = textCallMod;
const { AgentSession } = sessionMod;
const { NodeCliRunner } = runnerMod;
const { cliTools } = cliToolsMod;
const { fsTools } = fsToolsMod;
const { FolderSandbox } = sandboxMod;
const { DefaultToolRegistry } = registryMod;
const { DefaultPermissionGate } = permissionsMod;
const { workflowTool, WORKFLOW_TIMEOUT_MS } = workflowToolMod;
const { skillTools } = skillsMod;
const { CliCheckpoints, MemoCheckpoints } = checkpointsMod;
const { ModelManager } = managerMod;
const { WorkflowScheduler } = schedulerMod;
const { ModelWorker, checkpointPrecheck } = workerMod;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const CASES_DIR = path.join(REPO, 'evals', 'cases');
const BROKEN_DIR = path.join(REPO, 'evals', 'broken');
const CLI = path.join(REPO, 'dist', 'cli.js');
const TESTLIB = path.join(REPO, 'corpus', 'vendor', 'testlib.h');
const MAX_ARG_CHARS = 1500;

// ---------------------------------------------------------------------------
// Arguments.

function parseArgs(argv) {
  const opts = {
    cases: [],
    broken: [],
    recipe: 'fix_verify',
    model: DEFAULT_CHAT_MODEL,
    parallel: undefined,
    reasoning: 'off',
    maxCost: 0.6,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => String(argv[++i] ?? '');
    if (a === '--case') opts.cases.push(next());
    else if (a === '--all') opts.cases = allCases();
    else if (a === '--broken') opts.broken.push(next());
    else if (a === '--broken-all') opts.broken = allBroken();
    else if (a === '--recipe') opts.recipe = next();
    else if (a === '--model') opts.model = next();
    else if (a === '--parallel') opts.parallel = Number(next());
    else if (a === '--reasoning') opts.reasoning = next();
    else if (a === '--max-cost') opts.maxCost = Number(next());
    else throw new Error(`unknown option ${a}`);
  }
  if (opts.cases.length === 0 && opts.broken.length === 0)
    throw new Error('give --case <id>, --all, --broken <id> or --broken-all');
  if (!['off', 'on'].includes(opts.reasoning))
    throw new Error('--reasoning must be off or on');
  return opts;
}

function allCases() {
  return fs
    .readdirSync(CASES_DIR)
    .filter(d => fs.existsSync(path.join(CASES_DIR, d, 'case.json')))
    .sort();
}

function allBroken() {
  return fs
    .readdirSync(BROKEN_DIR)
    .filter(d => fs.existsSync(path.join(BROKEN_DIR, d, 'Config.json')))
    .sort();
}

// ---------------------------------------------------------------------------
// Secrets: every saved line goes through `clean`.

function makeCleaner(secrets) {
  return text =>
    redact(String(text), secrets).replace(
      /sk-or-v1-[A-Za-z0-9]+/g,
      'sk-or-v1-[redacted]'
    );
}

/** Cuts long strings inside tool args (file contents) for events.jsonl. */
function shortArgs(value) {
  if (typeof value === 'string') {
    return value.length > MAX_ARG_CHARS
      ? `${value.slice(0, MAX_ARG_CHARS)}... (${value.length} chars)`
      : value;
  }
  if (Array.isArray(value)) return value.map(shortArgs);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, shortArgs(v)])
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// The recorder: events.jsonl, plus the lists the report needs.

class Recorder {
  constructor(file, clean) {
    this.file = file;
    this.clean = clean;
    this.start = Date.now();
    this.events = [];
    fs.writeFileSync(file, '');
  }

  add(source, event) {
    const e = { t: Date.now() - this.start, source, ...event };
    if (e.args !== undefined) e.args = shortArgs(e.args);
    const line = this.clean(JSON.stringify(e));
    this.events.push(JSON.parse(line));
    fs.appendFileSync(this.file, `${line}\n`);
  }
}

// ---------------------------------------------------------------------------
// The provider observer: sees every Gemma call (manager and workers).

function firstUserText(req) {
  for (const m of req.messages) {
    if (m.role !== 'user') continue;
    for (const p of m.parts) if (p.type === 'text') return p.text;
  }
  return '';
}

function labelOf(req) {
  const names = req.tools.map(t => t.name);
  if (names.includes('submit_plan')) return 'manager:plan';
  if (names.includes('decide')) return 'manager:decide';
  const m = /Your task: ([^,\s]+), ([a-z_]+)/.exec(firstUserText(req));
  return m ? `${m[1]} ${m[2]}` : 'worker:?';
}

function observe(provider, rec, budget) {
  return {
    id: provider.id,
    async *stream(req, signal) {
      const call = {
        type: 'gemma_call',
        label: labelOf(req),
        ms: 0,
        stopReason: null,
        toolCalls: [],
        text: '',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        error: null,
      };
      if (call.label === 'manager:plan') {
        const user = firstUserText(req);
        const at = user.indexOf('# Plan errors to fix');
        if (at >= 0) call.planErrors = user.slice(at).split('\n').slice(1, 9);
      }
      const start = Date.now();
      try {
        for await (const ev of provider.stream(req, signal)) {
          if (ev.type === 'text_delta') call.text += ev.text;
          else if (ev.type === 'tool_call') {
            const tc = { name: ev.name };
            if (ev.argsError !== undefined) {
              tc.argsError = ev.argsError;
              tc.rawArgs = String(ev.args).slice(0, 300);
            }
            call.toolCalls.push(tc);
          } else if (ev.type === 'usage') {
            call.inputTokens = ev.inputTokens;
            call.outputTokens = ev.outputTokens;
            call.costUsd = ev.costUsd ?? 0;
          } else if (ev.type === 'done') call.stopReason = ev.stopReason;
          yield ev;
        }
      } catch (error) {
        call.error = error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        call.ms = Date.now() - start;
        if (call.toolCalls.length === 0 && call.text !== '') {
          call.textToolCall = findTextToolCall(
            call.text,
            req.tools.map(t => t.name)
          );
        }
        call.text = call.text.slice(0, 300);
        rec.add('gemma', call);
        budget.spent += call.costUsd;
        if (budget.spent > budget.max && !budget.stopped) {
          budget.stopped = true;
          rec.add('runner', {
            type: 'budget_stop',
            spent: budget.spent,
            max: budget.max,
          });
          budget.abort();
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The scheduler: the same classes as `modelSchedulerFactory`, plus a tap on
// each worker session (its events stay on a local bus in the product) and
// an auto answer for approvals inside workers.

function schedulerFactory({
  provider,
  model,
  bus,
  gate,
  secrets,
  rec,
  limits,
}) {
  return (problemDir, runner) => {
    const checkpoints = new MemoCheckpoints(new CliCheckpoints(runner));
    return new WorkflowScheduler({
      manager: new ModelManager({ provider, model, bus }),
      worker: new ModelWorker({
        provider,
        model,
        problemDir,
        runner,
        bus,
        tools: [...fsTools(), ...cliTools(), ...skillTools()],
        createSession: deps => {
          const holder = { label: 'worker:?' };
          const tap = {
            emit(e) {
              if (
                e.type === 'tool_call' ||
                e.type === 'tool_result' ||
                e.type === 'turn_end' ||
                e.type === 'approval_needed'
              ) {
                rec.add('worker', { task: holder.label, ...e });
              }
              deps.bus.emit(e);
            },
            on: fn => deps.bus.on(fn),
          };
          const session = new AgentSession({ ...deps, bus: tap });
          const send = session.send.bind(session);
          session.send = text => {
            const m = /Your task: ([^,\s]+), ([a-z_]+)/.exec(text);
            if (m) holder.label = `${m[1]} ${m[2]}`;
            return send(text);
          };
          return session;
        },
        createRegistry: permissions => new DefaultToolRegistry({ permissions }),
        createSandbox: (root, allowWrite) =>
          new FolderSandbox(root, { allowWrite }),
        createGate: (localBus, mode) => {
          const g = new DefaultPermissionGate(localBus, mode);
          localBus.on(e => {
            if (e.type === 'approval_needed') {
              g.resolve(e.approvalId, {
                kind: 'deny',
                reason: 'no human in this eval run',
              });
            }
          });
          return g;
        },
        secrets,
        // The same precheck as modelSchedulerFactory: finish_task runs the
        // real check before the task ends.
        precheck: checkpointPrecheck(checkpoints, problemDir),
      }),
      checkpoints,
      permissions: gate,
      bus,
      problemDir,
      ...(limits ? { limits } : {}),
    });
  };
}

// ---------------------------------------------------------------------------
// Polyman commands and the hidden checks.

function polyman(args, cwd) {
  const r = spawnSync('node', [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 15 * 60 * 1000,
  });
  let report;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    report = null;
  }
  return { status: r.status, report, stderr: (r.stderr ?? '').slice(-3000) };
}

function tokens(text) {
  return text.split(/\s+/).filter(Boolean);
}

function specLimits(text) {
  const t = /Time limit\s+([\d.]+)\s+second/i.exec(text);
  return { timeLimitMs: t ? Math.round(Number(t[1]) * 1000) : 1000 };
}

function readConfig(problemDir) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(problemDir, 'Config.json'), 'utf8')
    );
  } catch {
    return null;
  }
}

/**
 * Files of the template that are still in the problem after the workflow,
 * byte for byte: template solutions and manual tests.
 */
function templateLeftovers(problemDir) {
  const config = readConfig(problemDir);
  if (!config) return [];
  const template = path.join(REPO, 'template');
  const same = rel => {
    const a = path.join(problemDir, rel);
    const b = path.join(template, rel);
    return (
      fs.existsSync(a) &&
      fs.existsSync(b) &&
      fs.readFileSync(a).equals(fs.readFileSync(b))
    );
  };
  const out = [];
  for (const s of config.solutions ?? []) {
    if (same(s.source)) {
      out.push(
        `solution ${s.name} (${s.source}, ${s.tag}) is the template file`
      );
    }
  }
  for (const ts of config.testsets ?? []) {
    for (const t of ts.manualTests ?? []) {
      if (same(t.input)) {
        out.push(`manual test ${t.input} of ${ts.name} is the template sample`);
      }
    }
  }
  return out;
}

/** Check A: the reference main passes the agent's tests (`polyman run`). */
function refOnAgentTests(caseDir, problemDir) {
  const config = readConfig(problemDir);
  if (!config) return { ok: false, detail: 'Config.json is missing or broken' };
  const name = 'ref-main';
  fs.copyFileSync(
    path.join(caseDir, 'reference', 'main.cpp'),
    path.join(problemDir, 'solutions', `${name}.cpp`)
  );
  config.solutions = (config.solutions ?? []).filter(s => s.name !== name);
  config.solutions.push({
    name,
    source: `./solutions/${name}.cpp`,
    tag: 'OK',
    sourceType: 'cpp.g++17',
  });
  fs.writeFileSync(
    path.join(problemDir, 'Config.json'),
    JSON.stringify(config, null, 2)
  );
  const r = polyman(['run', name, '--all', '--json'], problemDir);
  if (!r.report) {
    return { ok: false, detail: `run failed: ${r.stderr.split('\n')[0]}` };
  }
  const tests = r.report.tests ?? [];
  const bad = tests.filter(t => t.verdict !== 'OK');
  const ok = r.report.ok && tests.length > 0 && bad.length === 0;
  const detail =
    tests.length === 0
      ? `no tests ran (${(r.report.errors ?? []).join('; ') || 'no errors'})`
      : bad.length === 0
        ? `${tests.length} tests, all OK`
        : `${bad.length} of ${tests.length} tests not OK: ${bad
            .slice(0, 4)
            .map(t =>
              `${t.testset}#${t.index} ${t.verdict} ${t.message ?? ''}`.trim()
            )
            .join('; ')}`;
  return { ok, detail };
}

/** Check B: the agent's main solution passes the reference tests. */
function agentMainOnRefTests(caseDir, problemDir, work, spec) {
  const config = readConfig(problemDir);
  const main = config?.solutions?.find(s => s.tag === 'MA');
  if (!main) return { ok: false, detail: 'no MA solution in Config.json' };
  const src = path.resolve(problemDir, main.source);
  if (!fs.existsSync(src)) {
    return { ok: false, detail: `${main.source} does not exist` };
  }
  const bin = path.join(work, 'agent-main');
  const c = spawnSync('g++', ['-O2', '-std=c++17', '-o', bin, src], {
    encoding: 'utf8',
  });
  if (c.status !== 0) {
    return { ok: false, detail: `compile failed: ${c.stderr.split('\n')[0]}` };
  }
  const ref = path.join(caseDir, 'reference');
  const tests = fs
    .readdirSync(path.join(ref, 'tests'))
    .filter(f => f.endsWith('.txt'))
    .sort();
  const { timeLimitMs } = specLimits(spec);
  const bad = [];
  let maxMs = 0;
  for (const t of tests) {
    const start = Date.now();
    const r = spawnSync(bin, [], {
      input: fs.readFileSync(path.join(ref, 'tests', t)),
      encoding: 'utf8',
      timeout: timeLimitMs * 3,
      maxBuffer: 64 * 1024 * 1024,
    });
    const ms = Date.now() - start;
    maxMs = Math.max(maxMs, ms);
    const expected = fs.readFileSync(path.join(ref, 'answers', t), 'utf8');
    const got = tokens(r.stdout ?? '');
    const want = tokens(expected);
    if (r.error?.code === 'ETIMEDOUT' || ms > timeLimitMs) bad.push(`${t} TL`);
    else if (r.status !== 0) bad.push(`${t} RE`);
    else if (got.length !== want.length || got.some((x, i) => x !== want[i]))
      bad.push(`${t} WA`);
  }
  const ok = bad.length === 0;
  return {
    ok,
    detail: ok
      ? `${tests.length} tests, all OK, max ${maxMs} ms`
      : `${bad.length} of ${tests.length} wrong: ${bad.slice(0, 6).join(', ')}`,
  };
}

/**
 * Checks for a broken case after a fix: the files the agent changed, and
 * that it did not take a wrong fix (a retag, a removed solution, a changed
 * validator test). The wrong fixes are in each `expected.md`.
 */
function brokenChecks(caseDir, problemDir) {
  const changed = [];
  const walk = rel => {
    for (const name of fs.readdirSync(path.join(caseDir, rel))) {
      const r = path.join(rel, name);
      if (name === 'expected.md') continue;
      const a = path.join(caseDir, r);
      if (fs.statSync(a).isDirectory()) {
        walk(r);
        continue;
      }
      const b = path.join(problemDir, r);
      if (!fs.existsSync(b)) changed.push(`${r} (removed)`);
      else if (!fs.readFileSync(a).equals(fs.readFileSync(b))) changed.push(r);
    }
  };
  walk('.');
  const before = JSON.parse(
    fs.readFileSync(path.join(caseDir, 'Config.json'), 'utf8')
  );
  const after = readConfig(problemDir) ?? {};
  const tags = s => Object.fromEntries((s ?? []).map(x => [x.name, x.tag]));
  const t0 = tags(before.solutions);
  const t1 = tags(after.solutions);
  const retagged = Object.keys(t0).filter(n => t1[n] !== t0[n]);
  const wrong = [];
  if (retagged.length > 0)
    wrong.push(`retagged or removed: ${retagged.join(', ')}`);
  if (changed.includes('validator/validator_tests.json'))
    wrong.push('changed validator_tests.json');
  if (changed.some(c => /wa-|brute/.test(c)))
    wrong.push('changed a wrong or brute solution');
  return {
    changedFiles: {
      ok: changed.length > 0,
      detail: changed.length > 0 ? changed.join(', ') : 'nothing changed',
    },
    noWrongFix: {
      ok: wrong.length === 0,
      detail: wrong.length === 0 ? 'no wrong fix' : wrong.join('; '),
    },
  };
}

// ---------------------------------------------------------------------------
// One case.

async function runCase(id, opts, broken = false) {
  const caseDir = broken ? path.join(BROKEN_DIR, id) : path.join(CASES_DIR, id);
  const specFile = fs.existsSync(path.join(caseDir, 'spec.md'))
    ? path.join(caseDir, 'spec.md')
    : path.join(CASES_DIR, 'pairs-sum', 'spec.md');
  const spec = fs.readFileSync(specFile, 'utf8');
  const recipe = broken ? opts.recipe : 'build_problem';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(
    HERE,
    'results',
    `${broken ? `broken-${id}-${recipe}` : id}-${stamp}-${process.pid}`
  );
  fs.mkdirSync(outDir, { recursive: true });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), `polyman-real-${id}-`));
  const home = path.join(work, 'home');
  fs.mkdirSync(home);

  // An empty home: ~/.polyman/ai.json of this machine must not pick the model.
  const made = await createChatProvider({
    model: opts.model,
    keyStore: new KeyStore({ home, env: process.env }),
  });
  if ('error' in made) throw new Error(made.error);
  const secrets = [
    ...made.secrets,
    process.env.OPENROUTER_API_KEY ?? '',
  ].filter(s => s.length >= 8);
  const clean = makeCleaner(secrets);
  const rec = new Recorder(path.join(outDir, 'events.jsonl'), clean);

  // The product sends no reasoning field; the probe showed off is better.
  const base = made.provider;
  if (base.quirks && typeof base.quirks.extraBody === 'function') {
    const extra = base.quirks.extraBody;
    base.quirks.extraBody = req => ({
      ...extra(req),
      reasoning: { enabled: opts.reasoning === 'on' },
    });
  }

  const controller = new AbortController();
  const budget = {
    spent: 0,
    max: opts.maxCost,
    stopped: false,
    abort: () => controller.abort(new Error('cost budget reached')),
  };
  const provider = observe(
    withRetries(base, { secrets: made.secrets }),
    rec,
    budget
  );
  const runner = new NodeCliRunner();
  const started = Date.now();
  const run = {
    case: broken ? `broken/${id}` : id,
    recipe,
    model: made.model,
    reasoning: opts.reasoning,
    parallel: opts.parallel ?? null,
    work,
    startedAt: new Date(started).toISOString(),
  };
  console.log(`== ${id}: work folder ${work}`);

  let problemDir = null;
  if (broken) {
    // 1- a copy of the broken problem, without build files.
    problemDir = path.join(work, id);
    fs.cpSync(caseDir, problemDir, {
      recursive: true,
      filter: src => !/(testsets|solutions-outputs|\.polyman)$/.test(src),
    });
    fs.rmSync(path.join(problemDir, 'expected.md'), { force: true });
    fs.copyFileSync(TESTLIB, path.join(problemDir, 'testlib.h'));
    rec.add('runner', { type: 'copy_broken', from: caseDir });
  } else {
    // 1- create the problem with the real tool, then the spec in the notes.
    const create = cliTools().find(t => t.name === 'create_problem');
    const created = await create.run(
      { name: id },
      {
        problemDir: work,
        signal: controller.signal,
        runner,
        sandbox: new FolderSandbox(work),
        progress: () => {},
        setProblemDir: d => {
          problemDir = path.resolve(d);
        },
      }
    );
    rec.add('runner', {
      type: 'create_problem',
      ok: !created.isError,
      summary: created.content.split('\n')[0],
    });
    if (problemDir === null)
      throw new Error(`create_problem: ${created.content}`);
    if (!fs.existsSync(path.join(problemDir, 'testlib.h'))) {
      fs.copyFileSync(TESTLIB, path.join(problemDir, 'testlib.h'));
      rec.add('runner', { type: 'testlib_fallback' });
    }
  }
  const notesDir = path.join(problemDir, '.polyman', 'agent');
  fs.mkdirSync(notesDir, { recursive: true });
  fs.writeFileSync(path.join(notesDir, 'notes.md'), spec);

  // 2- the chat runtime, with the plan approved by the runner.
  const runtime = createChatRuntime({
    dir: problemDir,
    provider,
    model: made.model,
    secrets,
  });
  runtime.gate.setMode('plan-approved');
  runtime.bus.on(e => {
    if (e.type === 'text_delta' || e.type === 'reasoning_delta') return;
    rec.add('bus', e);
    if (e.type === 'plan_approval_needed') {
      runtime.gate.resolve(e.approvalId, { kind: 'allow_once' });
    } else if (e.type === 'approval_needed') {
      runtime.gate.resolve(e.approvalId, {
        kind: 'deny',
        reason: 'no human in this eval run',
      });
    } else if (e.type === 'task_done') {
      const r = e.result;
      console.log(
        `  ${r.taskId}: ${r.status} after ${r.attempts} attempt(s)` +
          (r.checkpoint.ok ? '' : ` | ${r.checkpoint.digest.split('\n')[0]}`)
      );
    }
  });

  // 3- start_workflow build_problem, called directly.
  const limits = opts.parallel ? { parallel: opts.parallel } : undefined;
  const tool = workflowTool({
    readSpec: () => runtime.notes.read(),
    createScheduler: schedulerFactory({
      provider,
      model: made.model,
      bus: runtime.bus,
      gate: runtime.gate,
      secrets: () => secrets,
      rec,
      limits,
    }),
  });
  const timer = setTimeout(
    () => controller.abort(new Error('workflow timeout')),
    WORKFLOW_TIMEOUT_MS
  );
  let output;
  try {
    output = await tool.run(
      { recipe },
      {
        problemDir,
        signal: controller.signal,
        runner,
        sandbox: new FolderSandbox(problemDir),
        progress: () => {},
        setProblemDir: () => {},
      }
    );
  } catch (error) {
    output = {
      content: `start_workflow threw: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  } finally {
    clearTimeout(timer);
  }
  run.workflowMs = Date.now() - started;
  run.workflow = { ok: !output.isError, summary: clean(output.content) };
  rec.add('runner', { type: 'workflow_output', ...run.workflow });

  // 4- verify and the hidden checks.
  console.log('  verify and hidden checks...');
  const v = polyman(['verify', '--json'], problemDir);
  run.verify = v.report
    ? {
        ok: v.report.ok === true,
        failedStep: v.report.failedStep ?? null,
        errors: (v.report.steps ?? [])
          .filter(s => !s.ok)
          .flatMap(s => s.errors.map(e => `${s.name}: ${e}`))
          .slice(0, 8),
        solutions: (v.report.solutions ?? []).map(s => ({
          name: s.name,
          tag: s.tag,
          matchesTag: s.matchesTag,
          reason: s.reason,
        })),
      }
    : {
        ok: false,
        failedStep: 'no report',
        errors: [v.stderr.split('\n')[0]],
        solutions: [],
      };
  fs.writeFileSync(
    path.join(outDir, 'verify.json'),
    clean(JSON.stringify(v.report ?? { stderr: v.stderr }, null, 2))
  );
  if (broken) {
    run.leftovers = [];
    run.hidden = brokenChecks(caseDir, problemDir);
  } else {
    run.leftovers = templateLeftovers(problemDir);
    run.hidden = {
      refOnAgentTests: refOnAgentTests(caseDir, problemDir),
      agentMainOnRefTests: agentMainOnRefTests(caseDir, problemDir, work, spec),
    };
  }
  run.totalMs = Date.now() - started;
  run.budgetStopped = budget.stopped;

  const calls = rec.events.filter(e => e.type === 'gemma_call');
  run.calls = calls.length;
  run.inputTokens = calls.reduce((s, c) => s + c.inputTokens, 0);
  run.outputTokens = calls.reduce((s, c) => s + c.outputTokens, 0);
  run.costUsd = calls.reduce((s, c) => s + c.costUsd, 0);

  fs.writeFileSync(
    path.join(outDir, 'run.json'),
    clean(JSON.stringify(run, null, 2))
  );
  const report = clean(renderReport(run, rec.events));
  fs.writeFileSync(path.join(outDir, 'report.md'), report);
  console.log(
    `  verify ${run.verify.ok ? 'PASS' : 'FAIL'}, hidden ${Object.values(
      run.hidden
    )
      .map(h => (h.ok ? 'ok' : 'FAIL'))
      .join('/')}, ` +
      `${Math.round(run.totalMs / 1000)} s, ${run.calls} calls, $${run.costUsd.toFixed(4)}`
  );
  console.log(`  report: ${path.join(outDir, 'report.md')}`);
  return { ...run, outDir };
}

// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!process.env.OPENROUTER_API_KEY) {
    console.error(
      'Set OPENROUTER_API_KEY first: source ~/.config/openrouter.env'
    );
    process.exit(2);
  }
  if (!fs.existsSync(CLI)) {
    console.error('Run npm run build first.');
    process.exit(2);
  }
  const runs = [];
  const jobs = [
    ...opts.cases.map(id => [id, false]),
    ...opts.broken.map(id => [id, true]),
  ];
  for (const [id, broken] of jobs) {
    try {
      runs.push(await runCase(id, opts, broken));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`  ${id} crashed: ${msg.split('\n')[0]}`);
      runs.push({ case: id, crashed: msg.split('\n')[0] });
    }
  }
  if (runs.length > 1) {
    const secrets = [process.env.OPENROUTER_API_KEY ?? ''];
    const table = makeCleaner(secrets)(renderSummary(runs));
    const file = path.join(
      HERE,
      'results',
      `summary-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.md`
    );
    fs.writeFileSync(file, table);
    console.log(`\n${table}\nsummary: ${file}`);
  }
}

await main();
process.exit(0);
