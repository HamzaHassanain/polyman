#!/usr/bin/env node
/**
 * The Gemma probe: real numbers on how Gemma 4 behaves with polyman's tools.
 *
 *   source ~/.config/openrouter.env   # sets OPENROUTER_API_KEY
 *   node evals/probe/probe.mjs --models google/gemma-4-31b-it --runs 3
 *
 * Options:
 *   --models a,b      OpenRouter model ids (default google/gemma-4-31b-it)
 *   --runs N          calls per case, model and reasoning mode (default 1)
 *   --reasoning m,m   off, on, or both: off,on (default off,on)
 *   --cases id,id     only these cases (default all)
 *
 * Writes evals/probe/results/<date>.json (all raw data) and <date>.md.
 * The key is read from the environment and never written anywhere.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CASES, TOOL_NAMES } from './cases.mjs';

const URL = 'https://openrouter.ai/api/v1/chat/completions';
const PARALLEL = 4;
const TIMEOUT_MS = 180_000;
const HERE = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Arguments.

function parseArgs(argv) {
  const opts = {
    models: ['google/gemma-4-31b-it'],
    runs: 1,
    reasoning: ['off', 'on'],
    cases: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const list = () =>
      String(argv[++i] ?? '')
        .split(',')
        .filter(Boolean);
    switch (argv[i]) {
      case '--models':
        opts.models = list();
        break;
      case '--runs':
        opts.runs = Number(argv[++i]);
        break;
      case '--reasoning':
        opts.reasoning = list();
        break;
      case '--cases':
        opts.cases = list();
        break;
      default:
        throw new Error(`unknown option ${argv[i]}`);
    }
  }
  if (!Number.isInteger(opts.runs) || opts.runs < 1) {
    throw new Error('--runs must be a positive integer');
  }
  for (const m of opts.reasoning) {
    if (m !== 'on' && m !== 'off') throw new Error(`bad reasoning mode ${m}`);
  }
  return opts;
}

// ---------------------------------------------------------------------------
// JSON parsing, strict and with the simple repairs.

function tryParse(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** Index just after the first balanced JSON object or array, if any. */
function jsonEnd(text) {
  const start = text.search(/[{[]/);
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return undefined;
}

/** Strip code fences, then cut after the last balanced `}`. */
export function parseWithRepair(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') return { ok: true, value: {} };
  const first = tryParse(text);
  if (first.ok) return first;
  const unfenced = text
    .replace(/^```[a-zA-Z]*\s*/, '')
    .replace(/\s*```$/, '')
    .trim();
  const second = tryParse(unfenced);
  if (second.ok) return second;
  const end = jsonEnd(unfenced);
  if (end !== undefined) {
    const third = tryParse(unfenced.slice(0, end));
    if (third.ok) return third;
  }
  return first;
}

const TEXT_CALL = new RegExp(
  `\\b(${TOOL_NAMES.join('|')})\\s*\\(|"name"\\s*:\\s*"(${TOOL_NAMES.join('|')})"`
);

// ---------------------------------------------------------------------------
// One call.

function requestBody(model, kase, reasoning) {
  return {
    model,
    messages: [
      { role: 'system', content: kase.system },
      { role: 'user', content: kase.user },
    ],
    tools: kase.tools.map(t => ({ type: 'function', function: t })),
    temperature: 0.3,
    max_tokens: kase.maxTokens ?? 4000,
    reasoning: { enabled: reasoning === 'on' },
    provider: { require_parameters: true },
    usage: { include: true },
  };
}

async function post(body, key) {
  const started = Date.now();
  const res = await fetch(URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/HamzaHassanain/polyman',
      'X-Title': 'polyman',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  return { status: res.status, text, latencyMs: Date.now() - started };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function runOne(job, key) {
  const { model, kase, reasoning, run } = job;
  const record = {
    model,
    reasoning,
    caseId: kase.id,
    run,
    ok: false,
    error: null,
    httpStatus: null,
    retried: false,
    latencyMs: null,
    provider: null,
    finishReason: null,
    content: '',
    reasoningPresent: false,
    reasoningChars: 0,
    toolCalls: [],
    validJson: null,
    validAfterRepair: null,
    callAsText: false,
    parallel: false,
    correct: false,
    tokens: null,
    cost: 0,
  };
  const body = requestBody(model, kase, reasoning);
  let res;
  try {
    res = await post(body, key);
    if (res.status === 429 || res.status >= 500) {
      record.retried = true;
      await sleep(3000);
      res = await post(body, key);
    }
  } catch (e) {
    record.error = `fetch failed: ${e.message}`;
    return record;
  }
  record.httpStatus = res.status;
  record.latencyMs = res.latencyMs;
  const parsed = tryParse(res.text);
  const data = parsed.ok ? parsed.value : null;
  if (res.status !== 200 || !data || data.error || !data.choices?.length) {
    const msg = data?.error?.message ?? res.text.slice(0, 300);
    record.error = `HTTP ${res.status}: ${msg}`;
    return record;
  }

  const choice = data.choices[0];
  const message = choice.message ?? {};
  record.ok = true;
  record.provider = data.provider ?? null;
  record.finishReason = choice.finish_reason ?? null;
  record.content = message.content ?? '';
  const reasoningText =
    message.reasoning ??
    (message.reasoning_details ?? []).map(d => d.text ?? '').join('');
  record.reasoningPresent = Boolean(reasoningText);
  record.reasoningChars = reasoningText ? reasoningText.length : 0;
  record.tokens = {
    prompt: data.usage?.prompt_tokens ?? null,
    completion: data.usage?.completion_tokens ?? null,
    reasoning: data.usage?.completion_tokens_details?.reasoning_tokens ?? null,
  };
  record.cost = Number(data.usage?.cost ?? 0);

  record.toolCalls = (message.tool_calls ?? []).map(tc => {
    const raw = tc.function?.arguments ?? '';
    const strict = raw.trim() === '' ? { ok: true } : tryParse(raw);
    const repaired = parseWithRepair(raw);
    return {
      name: tc.function?.name ?? '',
      rawArgs: raw,
      validJson: strict.ok,
      validAfterRepair: repaired.ok,
      args: repaired.ok ? repaired.value : null,
    };
  });
  if (record.toolCalls.length > 0) {
    record.validJson = record.toolCalls.every(c => c.validJson);
    record.validAfterRepair = record.toolCalls.every(c => c.validAfterRepair);
  }
  record.parallel = record.toolCalls.length >= 2;
  record.callAsText = TEXT_CALL.test(record.content);
  try {
    record.correct = Boolean(
      kase.check({ calls: record.toolCalls, content: record.content })
    );
  } catch (e) {
    record.error = `check threw: ${e.message}`;
  }
  return record;
}

async function pool(jobs, limit, fn) {
  const out = new Array(jobs.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < jobs.length) {
      const i = next++;
      out[i] = await fn(jobs[i]);
      done++;
      const r = out[i];
      const mark = r.error ? 'ERR' : r.correct ? 'ok ' : 'bad';
      process.stdout.write(
        `[${done}/${jobs.length}] ${mark} ${r.model} ${r.reasoning} ` +
          `${r.caseId} #${r.run} ${r.latencyMs ?? '-'}ms $${r.cost.toFixed(6)}\n`
      );
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return out;
}

// ---------------------------------------------------------------------------
// Report.

function median(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

const frac = (a, b) => `${a}/${b}`;
const oneLine = s =>
  String(s).replace(/\s+/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|');

function summaryRows(records, opts) {
  const rows = [];
  for (const model of opts.models) {
    for (const reasoning of opts.reasoning) {
      const rs = records.filter(
        r => r.model === model && r.reasoning === reasoning
      );
      const withCalls = rs.filter(r => r.toolCalls.length > 0);
      const cost = rs.reduce((s, r) => s + r.cost, 0);
      rows.push({
        model,
        reasoning,
        calls: rs.length,
        errors: rs.filter(r => r.error).length,
        correct: rs.filter(r => r.correct).length,
        withCalls: withCalls.length,
        validJson: withCalls.filter(r => r.validJson).length,
        validAfterRepair: withCalls.filter(r => r.validAfterRepair).length,
        callAsText: rs.filter(r => r.callAsText).length,
        parallel: rs.filter(r => r.parallel).length,
        reasoningPresent: rs.filter(r => r.reasoningPresent).length,
        p50: median(rs.filter(r => r.ok).map(r => r.latencyMs)),
        cost,
      });
    }
  }
  return rows;
}

export function markdownReport(records, opts, date) {
  const rows = summaryRows(records, opts);
  const total = records.reduce((s, r) => s + r.cost, 0);
  const out = [];
  out.push(`# Gemma probe, ${date}`);
  out.push('');
  out.push(
    `${CASES.filter(c => !opts.cases || opts.cases.includes(c.id)).length} ` +
      `cases, ${opts.runs} run(s) each, temperature 0.3. ` +
      `${records.length} calls, total cost $${total.toFixed(4)}.`
  );
  out.push('');
  out.push(
    '| model | reasoning | correct | valid JSON | valid after repair | ' +
      'call as text | parallel calls | p50 latency | cost |'
  );
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    out.push(
      `| ${r.model} | ${r.reasoning} | ${frac(r.correct, r.calls)} | ` +
        `${frac(r.validJson, r.withCalls)} | ` +
        `${frac(r.validAfterRepair, r.withCalls)} | ${r.callAsText} | ` +
        `${r.parallel} | ${r.p50 ?? '-'} ms | $${r.cost.toFixed(4)} |`
    );
  }
  out.push('');
  out.push(
    'Errors (HTTP or check): ' +
      rows.map(r => `${r.model} ${r.reasoning}: ${r.errors}`).join(', ') +
      '. Reasoning text returned: ' +
      rows
        .map(r => `${r.model} ${r.reasoning}: ${r.reasoningPresent}`)
        .join(', ') +
      '.'
  );
  out.push('');

  out.push('## Correct per case');
  out.push('');
  const cols = rows.map(
    r => `${r.model.replace('google/', '')} ${r.reasoning}`
  );
  out.push(`| case | ${cols.join(' | ')} |`);
  out.push(`| --- | ${cols.map(() => '---').join(' | ')} |`);
  for (const c of CASES) {
    if (opts.cases && !opts.cases.includes(c.id)) continue;
    const cells = rows.map(r => {
      const rs = records.filter(
        x =>
          x.caseId === c.id &&
          x.model === r.model &&
          x.reasoning === r.reasoning
      );
      return frac(rs.filter(x => x.correct).length, rs.length);
    });
    out.push(`| ${c.id} | ${cells.join(' | ')} |`);
  }
  out.push('');

  out.push('## Failed cases');
  out.push('');
  const failed = records.filter(r => !r.correct);
  if (failed.length === 0) out.push('None.');
  for (const r of failed) {
    const raw = r.error
      ? r.error
      : r.toolCalls.length > 0
        ? r.toolCalls.map(c => `${c.name}(${c.rawArgs})`).join(' ; ')
        : `text: ${r.content}`;
    out.push(
      `- ${r.model} ${r.reasoning} ${r.caseId} #${r.run}: ` +
        `\`${oneLine(raw).slice(0, 200).replace(/`/g, "'")}\``
    );
  }
  out.push('');
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Main.

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    console.error('OPENROUTER_API_KEY is not set.');
    process.exit(1);
  }
  const cases = CASES.filter(c => !opts.cases || opts.cases.includes(c.id));
  const jobs = [];
  for (const model of opts.models) {
    for (const reasoning of opts.reasoning) {
      for (const kase of cases) {
        for (let run = 1; run <= opts.runs; run++) {
          jobs.push({ model, kase, reasoning, run });
        }
      }
    }
  }
  console.log(`${jobs.length} calls, ${PARALLEL} at a time`);
  const records = await pool(jobs, PARALLEL, job => runOne(job, key));

  const date = new Date().toISOString().slice(0, 10);
  const dir = path.join(HERE, 'results');
  fs.mkdirSync(dir, { recursive: true });
  const json = { date, options: opts, records };
  fs.writeFileSync(
    path.join(dir, `${date}.json`),
    JSON.stringify(json, null, 2) + '\n'
  );
  const md = markdownReport(records, opts, date);
  fs.writeFileSync(path.join(dir, `${date}.md`), md);
  console.log('\n' + md);
  console.log(`Wrote ${path.join(dir, date)}.{json,md}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => {
    console.error(e);
    process.exit(1);
  });
}
