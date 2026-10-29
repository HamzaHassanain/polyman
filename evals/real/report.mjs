#!/usr/bin/env node
/**
 * Builds report.md of one real run from its run.json and events.jsonl.
 * run.mjs calls it after each case. It also works alone, to build the
 * report again after a change here:
 *
 *   node evals/real/report.mjs evals/real/results/pairs-sum-<time>
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** The boxes of plan section 9, in order. */
export const BOXES = [
  {
    id: 'broken_json',
    title: 'Broken tool JSON, tool call as text',
    fix: '`parseToolArgs` in `providers/openai-compatible.ts`, `core/text-tool-call.ts`',
    owner: 'Hamza',
  },
  {
    id: 'wrong_tool',
    title: 'Wrong tool picked, wrong args',
    fix: 'tool descriptions in `cli-tools.ts` / `fs-tools.ts`, worker prompts',
    owner: 'Hamza',
  },
  {
    id: 'plan_invalid',
    title: 'Plan invalid',
    fix: 'manager prompt in `workflow/prompts.ts`, plan checks in `recipes.ts`',
    owner: 'Faraj',
  },
  {
    id: 'unclear_digest',
    title: 'Checkpoint fails with an unclear digest',
    fix: 'digests in `workflow/checkpoints.ts`',
    owner: 'Faraj',
  },
  {
    id: 'same_mistake',
    title: 'Same mistake on every retry',
    fix: 'retry note and the hint text in `scheduler.ts`',
    owner: 'Faraj',
  },
  {
    id: 'out_of_steps',
    title: 'Runs out of steps',
    fix: 'budgets in `providers/chat-provider.ts`',
    owner: 'Hamza',
  },
  {
    id: 'other',
    title: 'Not in a box (sort by hand)',
    fix: 'see the line',
    owner: 'Mazen',
  },
];

/** Tool errors that mean the model called the tool the wrong way. */
const WRONG_CALL =
  /^Unknown tool|missing required property|unknown property|: expected |must be one of|must have at least|must be at least|must be at most|is not one of the files this task owns|is outside the problem folder|is not a valid path|old_text not found|You already called|There is no problem folder yet/;

function firstLine(text, max = 160) {
  const line =
    String(text ?? '')
      .trim()
      .split('\n')[0] ?? '';
  return line.length > max ? `${line.slice(0, max)}...` : line;
}

function attemptName(a) {
  return `attempt ${a.attempt}${a.redo ? ' (after redo)' : ''}`;
}

function cell(text) {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, ' ');
}

function money(x) {
  return `$${(x ?? 0).toFixed(4)}`;
}

function secs(ms) {
  return `${Math.round((ms ?? 0) / 1000)} s`;
}

/** Task attempts from the bus events, in order. */
export function taskHistory(events) {
  const tasks = new Map();
  const get = id => {
    if (!tasks.has(id)) tasks.set(id, { id, attempts: [], result: null });
    return tasks.get(id);
  };
  for (const e of events) {
    if (e.source !== 'bus') continue;
    if (e.type === 'task_started') {
      const t = get(e.taskId);
      const last = t.attempts.at(-1);
      const redo = last !== undefined && e.attempt <= last.attempt;
      t.attempts.push({ attempt: e.attempt, checkpoint: null, redo });
    } else if (e.type === 'task_checkpoint') {
      const t = get(e.taskId);
      let a = t.attempts.at(-1);
      if (!a || a.checkpoint) {
        a = { attempt: t.attempts.length + 1, checkpoint: null, redo: false };
        t.attempts.push(a);
      }
      a.checkpoint = { name: e.name, ok: e.ok, digest: e.digest };
    } else if (e.type === 'task_done') {
      get(e.taskId).result = e.result;
    }
  }
  return [...tasks.values()];
}

/** The first line of a tool result, plus the first CLI error under it. */
function withReason(e) {
  const line = firstLine(e.summary, 200);
  if (!line.endsWith(':')) return line;
  try {
    const report = JSON.parse(e.data?.stdoutTail ?? '');
    const why = report.errors?.[0];
    if (why) return `${line} ${firstLine(why, 160)}`;
  } catch {
    // Not a JSON report, keep the line.
  }
  return line;
}

/** Every tool call that came back with an error, inside workers. */
export function toolErrors(events) {
  const calls = new Map();
  const out = [];
  for (const e of events) {
    if (e.source !== 'worker') continue;
    const key = `${e.task}\u0000${e.callId}`;
    if (e.type === 'tool_call') calls.set(key, e);
    if (e.type === 'tool_result' && !e.ok) {
      const call = calls.get(key);
      out.push({
        task: e.task,
        tool: call?.name ?? '?',
        args: call?.args,
        line: withReason(e),
      });
    }
  }
  return out;
}

/** Sorts every problem of the run into the boxes. */
export function sortIntoBoxes(run, events) {
  const boxes = Object.fromEntries(BOXES.map(b => [b.id, []]));
  const calls = events.filter(e => e.type === 'gemma_call');
  const tasks = taskHistory(events);
  const errors = toolErrors(events);

  // Broken JSON and calls as text.
  for (const c of calls) {
    for (const tc of c.toolCalls) {
      if (tc.argsError) {
        boxes.broken_json.push(
          `${c.label}: ${tc.name} args are not JSON (${firstLine(tc.argsError, 80)}), raw: \`${cell(firstLine(tc.rawArgs, 80))}\``
        );
      }
    }
    if (c.textToolCall) {
      boxes.broken_json.push(
        `${c.label}: wrote the ${c.textToolCall} call as text: \`${cell(firstLine(c.text, 100))}\``
      );
    }
  }

  // Wrong tool or wrong args.
  for (const e of errors) {
    if (/^Your arguments were not valid JSON/.test(e.line)) continue;
    if (WRONG_CALL.test(e.line)) {
      const what = e.args?.path ? ` ${e.args.path}` : '';
      boxes.wrong_tool.push(`${e.task}: ${e.tool}${what} -> ${e.line}`);
    }
  }
  const lastResult = new Map();
  const callNames = new Map();
  for (const e of events) {
    if (e.source !== 'worker') continue;
    if (e.type === 'tool_call') {
      callNames.set(`${e.task}\u0000${e.callId}`, e.name);
      const prev = lastResult.get(e.task);
      if (e.name === 'finish_task' && prev && !prev.ok) {
        boxes.wrong_tool.push(
          `${e.task}: called finish_task right after a failed ${prev.name} (${prev.line})`
        );
      }
    } else if (e.type === 'tool_result') {
      lastResult.set(e.task, {
        ok: e.ok,
        name: callNames.get(`${e.task}\u0000${e.callId}`) ?? '?',
        line: firstLine(e.summary, 100),
      });
    }
  }
  for (const c of calls) {
    if (!c.label.startsWith('manager')) continue;
    const want = c.label === 'manager:plan' ? 'submit_plan' : 'decide';
    if (!c.error && !c.toolCalls.some(t => t.name === want)) {
      const box = c.label === 'manager:plan' ? 'plan_invalid' : 'wrong_tool';
      boxes[box].push(
        `${c.label}: no ${want} call (stop ${c.stopReason}), text: \`${cell(firstLine(c.text, 100))}\``
      );
    }
  }

  // Plan invalid.
  for (const c of calls) {
    const errs = [];
    for (const line of c.planErrors ?? []) {
      if (!line.startsWith('- ')) break;
      errs.push(line.slice(2));
    }
    if (
      errs.length > 0 &&
      !errs.every(e => e.startsWith('the manager failed'))
    ) {
      boxes.plan_invalid.push(`first plan was refused: ${errs.join('; ')}`);
    }
  }
  const notice = /notice: the manager plan was invalid twice[^\n]*/.exec(
    run.workflow?.summary ?? ''
  );
  if (notice) {
    const box = /the manager failed/.test(notice[0]) ? 'other' : 'plan_invalid';
    boxes[box].push(notice[0]);
  }

  // Checkpoints: unclear digests and the same mistake again.
  for (const t of tasks) {
    const failedAttempts = t.attempts.filter(
      a => a.checkpoint && !a.checkpoint.ok
    );
    for (const a of failedAttempts) {
      const d = a.checkpoint.digest.trim();
      if (a.checkpoint.name === 'config patch') {
        boxes.wrong_tool.push(
          `${t.id} ${attemptName(a)}: bad configPatch -> ${firstLine(d, 140)}`
        );
        continue;
      }
      const vague =
        d.length < 40 ||
        (!d.includes('\n') &&
          /^(failed|error|unknown error|cancelled)\b/i.test(d)) ||
        /ended without finish_task: no answer/.test(d);
      if (vague) {
        boxes.unclear_digest.push(
          `${t.id} ${attemptName(a)} (${a.checkpoint.name}): "${cell(firstLine(d, 120)) || '(empty)'}"`
        );
      }
    }
    const norm = d =>
      firstLine(d, 400).replace(/\d+/g, 'N').replace(/\s+/g, ' ').toLowerCase();
    for (let i = 1; i < failedAttempts.length; i++) {
      const a = failedAttempts[i - 1];
      const b = failedAttempts[i];
      if (norm(a.checkpoint.digest) === norm(b.checkpoint.digest)) {
        boxes.same_mistake.push(
          `${t.id} ${attemptName(a)} and ${attemptName(b)}: "${cell(firstLine(b.checkpoint.digest, 120))}"`
        );
      }
    }
  }

  // Out of steps, and out of output tokens.
  for (const e of events) {
    if (
      e.source === 'worker' &&
      e.type === 'turn_end' &&
      e.reason === 'max_steps'
    ) {
      boxes.out_of_steps.push(
        `${e.task}: the worker hit its step limit without finish_task`
      );
    }
  }
  for (const c of calls) {
    if (c.stopReason === 'max_tokens') {
      boxes.out_of_steps.push(
        `${c.label}: the answer was cut at the output token limit`
      );
    }
  }

  // The rest.
  for (const c of calls) {
    if (c.error)
      boxes.other.push(
        `${c.label}: model call failed: ${firstLine(c.error, 120)}`
      );
  }
  for (const e of events) {
    if (e.type === 'budget_stop') {
      boxes.other.push(
        `the run was stopped at the cost budget (${money(e.spent)} > ${money(e.max)})`
      );
    }
    if (
      e.source === 'worker' &&
      e.type === 'turn_end' &&
      e.reason === 'error' &&
      !calls.some(c => c.error && c.error === e.error)
    ) {
      boxes.other.push(
        `${e.task}: worker turn ended on an error: ${firstLine(e.error, 120)}`
      );
    }
  }
  for (const t of tasks) {
    if (t.result && t.result.status === 'failed') {
      const listed = Object.values(boxes)
        .flat()
        .some(
          line => line.startsWith(`${t.id} `) || line.startsWith(`${t.id}:`)
        );
      if (!listed) {
        boxes.other.push(
          `${t.id} failed after ${t.result.attempts} attempt(s): ${firstLine(t.result.checkpoint.digest, 140)}`
        );
      }
    }
  }
  const written = filesWritten(events);
  const withWorker = new Set(
    calls.filter(c => !c.label.includes(':')).map(c => c.label.split(' ')[0])
  );
  const plan = events.find(e => e.type === 'plan_created')?.plan;
  const owns = new Map((plan?.tasks ?? []).map(t => [t.id, t.ownsFiles]));
  for (const t of tasks) {
    if (
      t.result?.status === 'passed' &&
      withWorker.has(t.id) &&
      (owns.get(t.id) ?? []).length > 0 &&
      !written.has(t.id)
    ) {
      boxes.other.push(
        `${t.id}: passed, but its worker wrote no file (is the checkpoint too weak? \`workflow/checkpoints.ts\`)`
      );
    }
  }
  for (const line of run.leftovers ?? []) {
    boxes.other.push(
      `${line} (nobody owns it in the plan, closest: scaffold in \`recipes.ts\` / \`checkpoints.ts\`)`
    );
  }
  if (run.verify && !run.verify.ok) {
    boxes.other.push(
      `final verify failed at ${run.verify.failedStep}: ${firstLine(run.verify.errors?.[0] ?? '', 140)}`
    );
  }
  for (const [name, check] of Object.entries(run.hidden ?? {})) {
    if (!check.ok)
      boxes.other.push(`hidden check ${name} failed: ${check.detail}`);
  }
  for (const id of Object.keys(boxes)) boxes[id] = countSame(boxes[id]);
  return boxes;
}

/** Joins the same lines into one, with the count. */
function countSame(lines) {
  const counts = new Map();
  for (const line of lines) counts.set(line, (counts.get(line) ?? 0) + 1);
  return [...counts].map(([line, n]) => (n > 1 ? `${line} (x${n})` : line));
}

/** Task ids whose worker wrote at least one file. */
function filesWritten(events) {
  const calls = new Map();
  const out = new Set();
  for (const e of events) {
    if (e.source !== 'worker') continue;
    const key = `${e.task}\u0000${e.callId}`;
    if (e.type === 'tool_call') calls.set(key, e.name);
    if (e.type === 'tool_result' && e.ok) {
      const name = calls.get(key);
      if (name === 'write_file' || name === 'edit_file') {
        out.add(e.task.split(' ')[0]);
      }
    }
  }
  return out;
}

/** The full report.md of one run. */
export function renderReport(run, events) {
  const L = [];
  const yes = ok => (ok ? 'PASS' : 'FAIL');
  const calls = events.filter(e => e.type === 'gemma_call');
  const plan = events.find(e => e.type === 'plan_created')?.plan;
  const tasks = taskHistory(events);
  const errors = toolErrors(events);
  const boxes = sortIntoBoxes(run, events);

  L.push(`# Real run: ${run.case}`, '');
  L.push(
    `Model \`${run.model}\`, reasoning ${run.reasoning}, started ${run.startedAt}.`,
    `Work folder (kept): \`${run.work}\``,
    ''
  );

  L.push('## Result', '');
  L.push('| what | result |', '| --- | --- |');
  L.push(`| workflow | ${yes(run.workflow?.ok)} |`);
  L.push(
    `| verify | ${yes(run.verify?.ok)}${run.verify?.ok ? '' : ` (failed step: ${cell(run.verify?.failedStep)})`} |`
  );
  for (const [name, check] of Object.entries(run.hidden ?? {})) {
    L.push(
      `| hidden: ${HIDDEN_NAMES[name] ?? name} | ${yes(check?.ok)}: ${cell(check?.detail)} |`
    );
  }
  L.push(
    `| time | workflow ${secs(run.workflowMs)}, total ${secs(run.totalMs)} |`
  );
  L.push(`| Gemma calls | ${run.calls} |`);
  L.push(`| tokens | ${run.inputTokens} in, ${run.outputTokens} out |`);
  L.push(`| cost | ${money(run.costUsd)} |`, '');

  L.push(
    'Workflow summary:',
    '',
    '```',
    run.workflow?.summary ?? '',
    '```',
    ''
  );
  if (run.verify && !run.verify.ok && run.verify.errors?.length) {
    L.push('Verify errors:', '');
    for (const e of run.verify.errors) L.push(`- ${firstLine(e, 200)}`);
    L.push('');
  }
  if (run.verify?.solutions?.length) {
    L.push('Solutions in the final verify:', '');
    for (const s of run.verify.solutions) {
      L.push(
        `- ${s.name} (${s.tag}): ${s.matchesTag ? 'matches its tag' : `does not match: ${firstLine(s.reason, 140)}`}`
      );
    }
    L.push('');
  }

  L.push('## Plan', '');
  if (!plan) L.push('No plan was made.', '');
  else {
    L.push(
      '| id | kind | title | depends on | owns |',
      '| --- | --- | --- | --- | --- |'
    );
    for (const t of plan.tasks) {
      L.push(
        `| ${t.id} | ${t.kind} | ${cell(t.title)} | ${t.dependsOn.join(', ')} | ${cell(t.ownsFiles.join(', '))} |`
      );
    }
    L.push('');
  }

  L.push('## Tasks', '');
  L.push(
    '| task | status | attempts | last checkpoint |',
    '| --- | --- | --- | --- |'
  );
  for (const t of tasks) {
    const r = t.result;
    L.push(
      `| ${t.id} | ${r?.status ?? 'not done'} | ${r?.attempts ?? t.attempts.length} | ${r ? `${r.checkpoint.name} ${r.checkpoint.ok ? 'ok' : 'failed'}` : ''} |`
    );
  }
  L.push('');
  const failedDigests = tasks.flatMap(t =>
    t.attempts
      .filter(a => a.checkpoint && !a.checkpoint.ok)
      .map(a => ({ id: t.id, ...a }))
  );
  if (failedDigests.length > 0) {
    L.push('Digests of the failed attempts:', '');
    for (const a of failedDigests) {
      L.push(`- ${a.id} ${attemptName(a)} (${a.checkpoint.name}):`);
      L.push('  ```');
      for (const line of a.checkpoint.digest.trim().split('\n').slice(0, 8))
        L.push(`  ${line}`);
      L.push('  ```');
    }
    L.push('');
  }

  L.push('## Gemma calls', '');
  const byLabel = new Map();
  for (const c of calls) {
    const s = byLabel.get(c.label) ?? {
      n: 0,
      inT: 0,
      outT: 0,
      cost: 0,
      ms: 0,
      cut: 0,
    };
    s.n++;
    s.inT += c.inputTokens;
    s.outT += c.outputTokens;
    s.cost += c.costUsd;
    s.ms += c.ms;
    if (c.stopReason === 'max_tokens') s.cut++;
    byLabel.set(c.label, s);
  }
  L.push(
    '| who | calls | tokens in | tokens out | cost | time | cut at max tokens |',
    '| --- | --- | --- | --- | --- | --- | --- |'
  );
  for (const [label, s] of byLabel) {
    L.push(
      `| ${label} | ${s.n} | ${s.inT} | ${s.outT} | ${money(s.cost)} | ${secs(s.ms)} | ${s.cut} |`
    );
  }
  L.push('');

  L.push('## Tool errors', '');
  if (errors.length === 0) L.push('None.', '');
  else {
    L.push('| task | tool | first line |', '| --- | --- | --- |');
    for (const e of errors)
      L.push(`| ${e.task} | ${e.tool} | ${cell(e.line)} |`);
    L.push('');
  }

  L.push('## Failure boxes', '');
  L.push(
    'Sorted by rules in `evals/real/report.mjs`. Check them by eye before sending them to the owner.',
    ''
  );
  for (const b of BOXES) {
    const items = boxes[b.id];
    L.push(`### ${b.title} (${b.owner}, ${b.fix}): ${items.length}`, '');
    for (const item of items) L.push(`- ${item}`);
    if (items.length > 0) L.push('');
  }
  return `${L.join('\n').trimEnd()}\n`;
}

/** Long names of the hidden checks for the report. */
const HIDDEN_NAMES = {
  refOnAgentTests: "reference main on the agent's tests",
  agentMainOnRefTests: "agent's main on the reference tests",
  changedFiles: 'files the agent changed',
  noWrongFix: 'no wrong fix (retag, test change, wrong solution change)',
};

/** The short table after `--all`. */
export function renderSummary(runs) {
  const L = [
    '| case | workflow | verify | hidden checks | time | calls | tokens in/out | cost |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  let total = 0;
  for (const r of runs) {
    if (r.crashed) {
      L.push(`| ${r.case} | crashed: ${cell(r.crashed)} | | | | | | |`);
      continue;
    }
    total += r.costUsd ?? 0;
    const ok = x => (x ? 'pass' : 'FAIL');
    L.push(
      `| ${r.case} | ${ok(r.workflow?.ok)} | ${ok(r.verify?.ok)} | ${Object.values(
        r.hidden ?? {}
      )
        .map(h => ok(h?.ok))
        .join(
          ' / '
        )} | ${secs(r.totalMs)} | ${r.calls} | ${r.inputTokens}/${r.outputTokens} | ${money(r.costUsd)} |`
    );
  }
  L.push('', `Total cost: ${money(total)}`);
  return `${L.join('\n')}\n`;
}

function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node evals/real/report.mjs <results folder>');
    process.exit(2);
  }
  const run = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
  const events = fs
    .readFileSync(path.join(dir, 'events.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));
  fs.writeFileSync(path.join(dir, 'report.md'), renderReport(run, events));
  console.log(path.join(dir, 'report.md'));
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
