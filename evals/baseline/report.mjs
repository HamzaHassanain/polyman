// Report helpers of the single-loop baseline (W13).
//
// - summarize(): numbers from the bus events of one run
// - renderReport(): report.md, with the same result fields as the W11 brief
// - readReport(): reads a result folder (report.json, else report.md), from
//   the baseline or from W11 (evals/real/), into one shape for compare.mjs

import fs from 'node:fs';
import path from 'node:path';

/** USD per million tokens of google/gemma-4-31b-it (presets.ts), a fallback. */
const PRICE_IN = 0.2;
const PRICE_OUT = 0.4;

/** Replaces the key, and anything that looks like an OpenRouter key. */
export function makeScrub(secrets) {
  const list = secrets.filter(s => typeof s === 'string' && s.length >= 8);
  return text => {
    let out = String(text);
    for (const s of list) out = out.split(s).join('[redacted]');
    return out.replace(/sk-or-v1-[A-Za-z0-9]+/g, '[redacted]');
  };
}

function firstLine(text) {
  return (
    String(text ?? '')
      .split(/\r?\n/)
      .find(l => l.trim() !== '') ?? ''
  ).slice(0, 200);
}

/**
 * Numbers of one run from its events. `messages` (the session messages) give
 * the full text of each tool result, for the first line of every error.
 */
export function summarize(events, messages = []) {
  const s = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    costKnown: true,
    reasoningEvents: 0,
    compactions: 0,
    toolCalls: 0,
    repeatBlocked: [],
    verifyRuns: 0,
    verifyFails: 0,
    byTool: {},
    toolErrors: [],
    endReason: null,
    endError: null,
  };
  const nameOf = new Map();
  const fullResult = new Map();
  const askedName = new Map();
  for (const m of messages) {
    for (const p of m.parts ?? m.content ?? []) {
      if (p.type === 'tool_call') askedName.set(p.id ?? p.callId, p.name);
      if (p.type !== 'tool_result') continue;
      fullResult.set(p.callId, p.content);
      // The session's repeat guard answers the 3rd identical call itself,
      // without a tool_call event on the bus.
      if (/^You already called /.test(p.content ?? '')) {
        s.repeatBlocked.push({
          tool: askedName.get(p.callId) ?? '?',
          line: firstLine(p.content).slice(0, 120),
        });
      }
    }
  }
  for (const e of events) {
    switch (e.type) {
      case 'usage':
        s.calls++;
        s.inputTokens += e.inputTokens ?? 0;
        s.outputTokens += e.outputTokens ?? 0;
        if (typeof e.costUsd === 'number') s.costUsd += e.costUsd;
        else {
          s.costKnown = false;
          s.costUsd +=
            ((e.inputTokens ?? 0) * PRICE_IN +
              (e.outputTokens ?? 0) * PRICE_OUT) /
            1e6;
        }
        break;
      case 'reasoning_delta':
        s.reasoningEvents++;
        break;
      case 'compacted':
        s.compactions++;
        break;
      case 'tool_call': {
        s.toolCalls++;
        nameOf.set(e.callId, e.name);
        const t = (s.byTool[e.name] ??= { calls: 0, errors: 0 });
        t.calls++;
        break;
      }
      case 'tool_result':
        if (nameOf.get(e.callId) === 'verify') {
          s.verifyRuns++;
          if (!e.ok || /FAILED/.test(e.summary ?? '')) s.verifyFails++;
        }
        if (!e.ok) {
          const name = nameOf.get(e.callId) ?? '?';
          if (s.byTool[name]) s.byTool[name].errors++;
          s.toolErrors.push({
            tool: name,
            line: firstLine(fullResult.get(e.callId) ?? e.summary),
          });
        }
        break;
      case 'turn_end':
        s.endReason = e.reason;
        s.endError = e.error ?? null;
        break;
    }
  }
  s.tokens = s.inputTokens + s.outputTokens;
  return s;
}

/**
 * Sorts the problems of a baseline run into the boxes of plan section 9
 * that make sense without a workflow.
 */
export function failureBoxes(summary, stop) {
  const boxes = {
    'broken JSON': [],
    'wrong tool': [],
    'same mistake on retry': [],
    'out of steps': [],
    'out of budget (cost or time cap)': [],
  };
  let last = null;
  for (const err of summary.repeatBlocked) {
    boxes['same mistake on retry'].push(err);
  }
  for (const err of summary.toolErrors) {
    if (/not valid JSON/i.test(err.line)) boxes['broken JSON'].push(err);
    if (/Unknown tool/i.test(err.line)) boxes['wrong tool'].push(err);
    const key = `${err.tool}: ${err.line}`;
    if (key === last) boxes['same mistake on retry'].push(err);
    last = key;
  }
  if (summary.endReason === 'max_steps') {
    boxes['out of steps'].push({ tool: '-', line: 'hit the step limit' });
  }
  if (stop)
    boxes['out of budget (cost or time cap)'].push({ tool: '-', line: stop });
  return boxes;
}

const yes = b => (b ? 'yes' : 'no');
const secs = ms => `${Math.round(ms / 1000)} s`;
const money = usd => `$${usd.toFixed(4)}`;

/** report.md of one baseline run. */
export function renderReport(r) {
  const s = r.summary;
  const h = r.hidden;
  const lines = [
    `# Baseline run: ${r.caseId}`,
    '',
    `One AgentSession with every chat tool except start_workflow, model ${r.model}, reasoning off, ${r.maxSteps} max steps, ${r.contextBudget} context tokens. Started ${r.startedAt}.`,
    '',
    '## Result',
    '',
    `- verify passed: ${yes(r.verifyPassed)}`,
    `- hidden checks passed: ${h.passed}/${h.total}`,
    `  - reference main passes the agent's tests: ${yes(h.refMainOnAgentTests.ok)} (${h.refMainOnAgentTests.detail})`,
    `  - agent main passes the reference tests: ${yes(h.agentMainOnRefTests.ok)} (${h.agentMainOnRefTests.detail})`,
    `- time: ${secs(r.agentMs)} (agent loop; ${secs(r.totalMs)} with the checks)`,
    `- Gemma calls: ${s.calls}`,
    `- tokens: ${s.tokens} (input ${s.inputTokens}, output ${s.outputTokens})`,
    `- cost: ${money(s.costUsd)}${s.costKnown ? '' : ' (part estimated from token prices)'}`,
    `- wrong solutions caught by tests: ${h.wrongCaught.caught}/${h.wrongCaught.total} (reference wrong solutions run on the agent's tests)`,
    '',
    '## Session',
    '',
    `- end reason: ${s.endReason ?? 'none'}${s.endError ? ` (${s.endError})` : ''}${r.stop ? `, stopped by the runner: ${r.stop}` : ''}`,
    `- verify run by the agent: ${s.verifyRuns} times, failed ${s.verifyFails}`,
    `- tool calls run: ${s.toolCalls}, calls blocked by the repeat guard: ${s.repeatBlocked.length}, tool errors: ${s.toolErrors.length}, context compactions: ${s.compactions}, reasoning chunks: ${s.reasoningEvents}`,
    '',
    '| tool | calls | errors |',
    '| --- | --- | --- |',
    ...Object.entries(s.byTool)
      .sort((a, b) => b[1].calls - a[1].calls)
      .map(([name, t]) => `| ${name} | ${t.calls} | ${t.errors} |`),
    '',
    '## Verify (run by the eval after the session)',
    '',
  ];
  const v = r.verify;
  if (!v) lines.push('No JSON report from verify.');
  else {
    lines.push(
      `- ok: ${yes(v.ok)}${v.failedStep ? `, failed step: ${v.failedStep}` : ''}`
    );
    const bad = (v.steps ?? []).filter(st => !st.ok);
    for (const st of bad) {
      for (const e of (st.errors ?? []).slice(0, 5)) {
        lines.push(`  - ${st.name}: ${firstLine(e)}`);
      }
    }
    for (const sol of v.solutions ?? []) {
      lines.push(
        `- ${sol.name} (${sol.tag}): ${sol.matchesTag ? 'matches its tag' : 'does NOT match its tag'}, ${firstLine(sol.reason)}`
      );
    }
  }
  lines.push('', '## Hidden checks', '');
  for (const w of h.wrongCaught.items) {
    lines.push(
      `- ${w.name} (expected ${w.expected}): ${w.caught ? 'caught' : 'NOT caught'}${w.detail ? `, ${w.detail}` : ''}`
    );
  }
  for (const note of h.notes) lines.push(`- ${note}`);

  lines.push('', '## Failure boxes', '');
  for (const [box, items] of Object.entries(failureBoxes(s, r.stop))) {
    lines.push(`- ${box}: ${items.length}`);
    for (const it of items.slice(0, 5))
      lines.push(`  - ${it.tool}: ${it.line}`);
  }

  lines.push('', '## Tool errors', '');
  if (s.toolErrors.length === 0) lines.push('None.');
  for (const err of s.toolErrors) lines.push(`- \`${err.tool}\`: ${err.line}`);

  lines.push('', '## Last message of the agent', '', '```');
  lines.push((r.lastText || '(none)').slice(0, 1500));
  lines.push('```', '');
  return lines.join('\n');
}

/** The machine-readable part, in report.json. */
export function reportJson(r) {
  return {
    kind: 'baseline',
    case: r.caseId,
    model: r.model,
    startedAt: r.startedAt,
    verifyPassed: r.verifyPassed,
    hiddenChecks: { passed: r.hidden.passed, total: r.hidden.total },
    timeMs: r.agentMs,
    totalMs: r.totalMs,
    calls: r.summary.calls,
    tokens: {
      input: r.summary.inputTokens,
      output: r.summary.outputTokens,
      total: r.summary.tokens,
    },
    costUsd: r.summary.costUsd,
    wrongCaught: {
      caught: r.hidden.wrongCaught.caught,
      total: r.hidden.wrongCaught.total,
    },
    endReason: r.summary.endReason,
    stop: r.stop,
    toolCalls: r.summary.toolCalls,
    toolErrors: r.summary.toolErrors.length,
    repeatBlocked: r.summary.repeatBlocked.length,
  };
}

// ---------------------------------------------------------------------------
// Reading reports for compare.mjs.

/** The number in "1,234" or "1234". */
function num(text) {
  return Number(String(text).replace(/[,_\s]/g, ''));
}

function toMs(value, unit) {
  const n = Number(value);
  if (/^ms/i.test(unit)) return n;
  if (/^m(in)?/i.test(unit) && !/^ms/i.test(unit)) return n * 60000;
  return n * 1000;
}

/**
 * Reads the result fields from a report.md. Works with "- name: value" lines
 * and "| name | value |" table rows, using the W11 brief names: verify
 * passed, hidden checks, time, Gemma calls, tokens, cost.
 */
export function parseReportMd(text) {
  const out = {};
  const value = re => {
    for (const line of text.split(/\r?\n/)) {
      const clean = line.replace(/[*`]/g, '');
      const m = re.exec(clean);
      if (m) return m;
    }
    return null;
  };
  let m = value(
    /verify\s+(?:passed|ok)\W*?\b(yes|no|true|false|pass(?:ed)?|fail(?:ed)?)\b/i
  );
  if (m) out.verifyPassed = /^(yes|true|pass)/i.test(m[1]);
  m = value(/hidden checks?(?: passed)?\W*?(\d+)\s*\/\s*(\d+)/i);
  if (m) out.hiddenChecks = { passed: num(m[1]), total: num(m[2]) };
  m = value(/^\W*(?:wall\s+)?time\W*?([\d.]+)\s*(ms|s|sec|min|m)\b/i);
  if (m) out.timeMs = toMs(m[1], m[2]);
  m = value(/(?:gemma|model)\s+calls\W*?([\d,]+)/i);
  if (m) out.calls = num(m[1]);
  m = value(/^\W*(?:total\s+)?tokens\W*?([\d,]+)/i);
  if (m) out.tokens = { total: num(m[1]) };
  m = value(/^\W*(?:total\s+)?cost\W*?\$?\s*([\d.]+)/i);
  if (m) out.costUsd = Number(m[1]);
  m = value(/wrong solutions caught[^\d]*(\d+)\s*\/\s*(\d+)/i);
  if (m) out.wrongCaught = { caught: num(m[1]), total: num(m[2]) };
  return out;
}

/**
 * Reads one result: a folder with report.json or report.md, or one of those
 * files. Returns the fields compare.mjs shows, with `source` set.
 */
export function readReport(target) {
  const stat = fs.statSync(target);
  const dir = stat.isDirectory() ? target : path.dirname(target);
  const jsonFile = stat.isDirectory()
    ? path.join(dir, 'report.json')
    : target.endsWith('.json')
      ? target
      : path.join(dir, 'report.json');
  const mdFile = stat.isDirectory()
    ? path.join(dir, 'report.md')
    : target.endsWith('.md')
      ? target
      : path.join(dir, 'report.md');
  let fromMd = {};
  if (fs.existsSync(mdFile)) {
    fromMd = parseReportMd(fs.readFileSync(mdFile, 'utf8'));
  }
  let fromJson = {};
  if (fs.existsSync(jsonFile)) {
    try {
      fromJson = normalizeJson(JSON.parse(fs.readFileSync(jsonFile, 'utf8')));
    } catch {
      fromJson = {};
    }
  }
  // report.json wins field by field; report.md fills the gaps.
  return { source: dir, ...fromMd, ...fromJson };
}

/** Accepts a few spellings of the same fields, for W11's report.json. */
function normalizeJson(j) {
  const out = {};
  const pick = (...keys) => {
    for (const k of keys) {
      const v = k.split('.').reduce((o, p) => (o == null ? o : o[p]), j);
      if (v !== undefined && v !== null) return v;
    }
    return undefined;
  };
  const verify = pick(
    'verifyPassed',
    'verify.ok',
    'verify.passed',
    'result.verifyPassed'
  );
  if (typeof verify === 'boolean') out.verifyPassed = verify;
  const hidden = pick('hiddenChecks', 'hidden', 'result.hiddenChecks');
  if (hidden && typeof hidden === 'object') {
    if (typeof hidden.passed === 'number' && typeof hidden.total === 'number') {
      out.hiddenChecks = { passed: hidden.passed, total: hidden.total };
    } else if (Array.isArray(hidden)) {
      out.hiddenChecks = {
        passed: hidden.filter(c => c && (c.ok || c.passed)).length,
        total: hidden.length,
      };
    }
  }
  const time = pick('timeMs', 'durationMs', 'elapsedMs');
  if (typeof time === 'number') out.timeMs = time;
  const calls = pick('calls', 'gemmaCalls', 'modelCalls');
  if (typeof calls === 'number') out.calls = calls;
  const tokens = pick('tokens');
  if (typeof tokens === 'number') out.tokens = { total: tokens };
  else if (tokens && typeof tokens.total === 'number') out.tokens = tokens;
  else {
    const i = pick('inputTokens');
    const o = pick('outputTokens');
    if (typeof i === 'number' && typeof o === 'number') {
      out.tokens = { input: i, output: o, total: i + o };
    }
  }
  const cost = pick('costUsd', 'cost');
  if (typeof cost === 'number') out.costUsd = cost;
  const wrong = pick('wrongCaught');
  if (wrong && typeof wrong.caught === 'number') out.wrongCaught = wrong;
  return out;
}
