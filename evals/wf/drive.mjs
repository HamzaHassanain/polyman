// Runs the real build_problem workflow with real Gemma on one eval case,
// then `polyman verify --json` on the problem it built.
//
// Usage (key only from the env, never written anywhere):
//   source ~/.config/openrouter.env && node evals/wf/drive.mjs [--case pairs-sum] [--out <dir>] [--max-cost 1.0]
import { createRequire } from 'module';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..'
);
const dist = p => require(path.join(ROOT, 'dist', p));

const { SimpleEventBus } = dist('agent/core/event-bus.js');
const { AgentSession } = dist('agent/core/session.js');
const { createChatProvider } = dist('agent/providers/gemma.js');
const { withRetries } = dist('agent/providers/retry.js');
const { NodeCliRunner } = dist('agent/runner/cli-runner.js');
const { skillTools } = dist('agent/skills.js');
const { cliTools } = dist('agent/tools/cli-tools.js');
const { fsTools } = dist('agent/tools/fs-tools.js');
const { DefaultPermissionGate } = dist('agent/tools/permissions.js');
const { DefaultToolRegistry } = dist('agent/tools/registry.js');
const { FolderSandbox } = dist('agent/tools/sandbox.js');
const { CliCheckpoints } = dist('agent/workflow/checkpoints.js');
const { GemmaManager } = dist('agent/workflow/manager.js');
const { WorkflowScheduler } = dist('agent/workflow/scheduler.js');
const { GemmaWorker, checkpointPrecheck } = dist('agent/workflow/worker.js');

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const caseId = opt('case', 'pairs-sum');
const maxCost = Number(opt('max-cost', '1.0'));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.resolve(
  opt('out', path.join(os.tmpdir(), `polyman-wf-${stamp}`))
);
fs.mkdirSync(outDir, { recursive: true });
const problemDir = path.join(outDir, caseId);
const logFile = path.join(outDir, 'events.log');
const log = fs.createWriteStream(logFile);
const t0 = Date.now();
const clock = () => `${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s`;
let cost = 0;
let calls = 0;
let inTok = 0;
let outTok = 0;
const out = line => {
  const text = `[${clock()} $${cost.toFixed(4)}] ${line}`;
  console.log(text);
  log.write(`${text}\n`);
};
const short = (v, n = 300) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  const flat = (s ?? '').replace(/\s+/g, ' ');
  return flat.length > n ? `${flat.slice(0, n)}...` : flat;
};

// 1. A fresh problem folder, testlib from the vendor copy (no network).
const cli = path.join(ROOT, 'dist', 'cli.js');
const made = spawnSync(process.execPath, [cli, 'new', problemDir], {
  encoding: 'utf-8',
});
if (made.status !== 0) {
  console.error(made.stdout, made.stderr);
  process.exit(1);
}
fs.copyFileSync(
  path.join(ROOT, 'corpus', 'vendor', 'testlib.h'),
  path.join(problemDir, 'testlib.h')
);
const spec = fs.readFileSync(
  path.join(ROOT, 'evals', 'cases', caseId, 'spec.md'),
  'utf-8'
);
out(`problem folder: ${problemDir}`);

// 2. The provider, wrapped like index.ts does.
const prov = await createChatProvider({
  model: opt('model', 'google/gemma-4-31b-it'),
});
if ('error' in prov) {
  console.error(prov.error);
  process.exit(2);
}
const provider = withRetries(prov.provider, { secrets: prov.secrets });
const redact = s => {
  let t = String(s);
  for (const k of prov.secrets) if (k) t = t.split(k).join('<key>');
  return t;
};

const controller = new AbortController();
const bus = new SimpleEventBus();
const gate = new DefaultPermissionGate(bus, 'ask');

bus.on(e => {
  switch (e.type) {
    case 'plan_created':
      out('plan:');
      for (const t of e.plan.tasks) {
        out(
          `  ${t.id} ${t.kind} "${t.title}" deps=[${t.dependsOn}] owns=[${t.ownsFiles}]${t.params ? ` params=${JSON.stringify(t.params)}` : ''}`
        );
        out(`     brief: ${short(t.brief, 400)}`);
      }
      return;
    case 'plan_approval_needed':
      out('plan approval: allow_once (auto)');
      gate.resolve(e.approvalId, { kind: 'allow_once' });
      return;
    case 'task_started':
      out(`task_started ${e.taskId} attempt ${e.attempt}`);
      return;
    case 'task_checkpoint':
      out(
        `task_checkpoint ${e.taskId} ${e.name} ${e.ok ? 'OK' : 'FAIL'}: ${short(e.digest, 1500)}`
      );
      return;
    case 'task_done':
      out(
        `task_done ${e.taskId} ${e.result.status} (${e.result.attempts} attempts): ${short(e.result.summary, 400)}${e.result.configPatch ? ` patch=${short(e.result.configPatch, 400)}` : ''}`
      );
      return;
    case 'usage':
      calls++;
      inTok += e.inputTokens;
      outTok += e.outputTokens;
      cost += e.costUsd ?? 0;
      log.write(
        `[${clock()}] usage in=${e.inputTokens} out=${e.outputTokens} cost=${e.costUsd ?? '?'} total=$${cost.toFixed(4)}\n`
      );
      if (cost > maxCost && !controller.signal.aborted) {
        out(`cost cap $${maxCost} reached, aborting`);
        controller.abort();
      }
      return;
    case 'workflow_done':
      out(
        `workflow_done ok=${e.ok} cost=$${e.costUsd.toFixed(4)}\n${e.summary}`
      );
      return;
    default:
      return;
  }
});

// Worker sessions keep their events local; tap them for the log.
const createSession = deps => {
  const session = new AgentSession(deps);
  let label = '?';
  const send = session.send.bind(session);
  session.send = text => {
    const m = /Your task: (\S+), (\S+):/.exec(text);
    if (m) label = `${m[1]}/${m[2]}`;
    return send(text);
  };
  deps.bus.on(e => {
    if (e.type === 'tool_call')
      log.write(
        `[${clock()}]   ${label} call ${e.name} ${redact(short(e.args, 2000))}\n`
      );
    else if (e.type === 'tool_result')
      log.write(
        `[${clock()}]   ${label} result ${e.ok ? 'ok' : 'ERR'} ${redact(short(e.content ?? e.summary ?? '', 1500))}\n`
      );
    else if (e.type === 'turn_end')
      log.write(
        `[${clock()}]   ${label} turn_end ${e.reason ?? ''} ${e.error ? redact(e.error) : ''}\n`
      );
    else if (e.type === 'text_delta') log.write(e.text);
  });
  return session;
};

const runner = new NodeCliRunner();
const checkpoints = new CliCheckpoints(runner);
const scheduler = new WorkflowScheduler({
  manager: new GemmaManager({ provider, model: prov.model, bus }),
  worker: new GemmaWorker({
    provider,
    model: prov.model,
    problemDir,
    runner,
    bus,
    tools: [...fsTools(), ...cliTools(), ...skillTools()],
    createSession,
    createRegistry: permissions => new DefaultToolRegistry({ permissions }),
    createSandbox: (root, allowWrite) =>
      new FolderSandbox(root, { allowWrite }),
    createGate: (b, mode) => new DefaultPermissionGate(b, mode),
    secrets: () => prov.secrets,
    precheck: checkpointPrecheck(checkpoints, problemDir),
  }),
  checkpoints,
  permissions: gate,
  bus,
  problemDir,
});

process.on('SIGINT', () => controller.abort());
const result = await scheduler.run(spec, 'build_problem', controller.signal);
out(`scheduler ok=${result.ok}`);

// 3. verify on what Gemma built.
const ver = spawnSync(process.execPath, [cli, 'verify', '--json'], {
  cwd: problemDir,
  encoding: 'utf-8',
  maxBuffer: 64 * 1024 * 1024,
});
let verdict = `exit ${ver.status}`;
try {
  const j = JSON.parse(ver.stdout);
  verdict += ` ok=${j.ok} failedStep=${j.failedStep ?? '-'}`;
  for (const s of j.solutions ?? [])
    verdict += `\n  ${s.name} ${s.tag} matches=${s.matchesTag} ${short(s.reason, 200)}`;
  for (const st of j.steps ?? [])
    if (!st.ok) verdict += `\n  step ${st.name}: ${short(st.errors, 600)}`;
} catch {
  verdict += ` (no JSON) ${short(ver.stdout + ver.stderr, 800)}`;
}
out(`verify: ${verdict}`);
out(
  `totals: time ${((Date.now() - t0) / 1000).toFixed(0)}s, calls ${calls}, tokens in ${inTok} out ${outTok}, cost $${cost.toFixed(4)}`
);
log.end();
