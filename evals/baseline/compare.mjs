#!/usr/bin/env node
// W13: the workflow (W11) against the single loop (this folder), as a
// markdown table for the slide.
//
//   node evals/baseline/compare.mjs --case pairs-sum
//       every W11 result in evals/real/results/pairs-sum-* against every
//       baseline result in evals/baseline/results/pairs-sum-*
//   node evals/baseline/compare.mjs --case pairs-sum --latest
//       only the latest result of each side
//   node evals/baseline/compare.mjs --workflow <path> --baseline <path>
//       given results (a result folder, report.json or report.md), each
//       flag can be repeated
//
// A result is read from report.json when it has the fields, else from the
// "name: value" lines of report.md (see readReport in report.mjs). With more
// than one run on a side, verify and hidden checks are counted and the other
// rows are averages.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readReport } from './report.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

function parseArgs(argv) {
  const opts = { caseId: null, latest: false, workflow: [], baseline: [] };
  for (let i = 0; i < argv.length; i++) {
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${argv[i - 1]} needs a value`);
      return v;
    };
    switch (argv[i]) {
      case '--case':
        opts.caseId = next();
        break;
      case '--latest':
        opts.latest = true;
        break;
      case '--workflow':
        opts.workflow.push(path.resolve(next()));
        break;
      case '--baseline':
        opts.baseline.push(path.resolve(next()));
        break;
      default:
        throw new Error(`unknown option ${argv[i]}`);
    }
  }
  return opts;
}

/** Result folders of a case, oldest first (the names end with the time). */
export function findResults(resultsDir, caseId) {
  if (!fs.existsSync(resultsDir)) return [];
  return fs
    .readdirSync(resultsDir)
    .filter(d => d.startsWith(`${caseId}-`))
    .map(d => path.join(resultsDir, d))
    .filter(
      d =>
        fs.existsSync(path.join(d, 'report.md')) ||
        fs.existsSync(path.join(d, 'report.json'))
    )
    .sort();
}

/** A path inside the repo is shown relative to it. */
const shown = p => {
  const rel = path.relative(REPO, p);
  return rel.startsWith('..') ? p : rel;
};

const avg = xs => xs.reduce((a, b) => a + b, 0) / xs.length;

/** One column of the table from the reports of one side. */
export function column(reports) {
  if (reports.length === 0) return null;
  const many = reports.length > 1;
  const have = key => reports.filter(r => r[key] !== undefined);
  const cell = (key, show) => {
    const rs = have(key);
    if (rs.length === 0) return 'n/a';
    return show(rs);
  };
  const ratio = key => rs => {
    const p = rs.reduce((a, r) => a + r[key].passed, 0);
    const t = rs.reduce((a, r) => a + r[key].total, 0);
    return many ? `${p}/${t} (${rs.length} runs)` : `${p}/${t}`;
  };
  const mean = (get, fmt) => rs => {
    const v = avg(rs.map(get));
    return many ? `${fmt(v)} avg` : fmt(v);
  };
  return {
    runs: String(reports.length),
    verify: cell('verifyPassed', rs => {
      const ok = rs.filter(r => r.verifyPassed).length;
      return many ? `${ok}/${rs.length}` : ok === 1 ? 'yes' : 'no';
    }),
    hidden: cell('hiddenChecks', ratio('hiddenChecks')),
    time: cell(
      'timeMs',
      mean(
        r => r.timeMs,
        v => `${Math.round(v / 1000)} s`
      )
    ),
    calls: cell(
      'calls',
      mean(
        r => r.calls,
        v => String(Math.round(v))
      )
    ),
    tokens: cell(
      'tokens',
      mean(
        r => r.tokens.total,
        v => String(Math.round(v))
      )
    ),
    cost: cell(
      'costUsd',
      mean(
        r => r.costUsd,
        v => `$${v.toFixed(4)}`
      )
    ),
    wrong: cell('wrongCaught', rs => {
      const c = rs.reduce((a, r) => a + r.wrongCaught.caught, 0);
      const t = rs.reduce((a, r) => a + r.wrongCaught.total, 0);
      return `${c}/${t}`;
    }),
  };
}

/** The markdown table of the W13 brief. */
export function table(workflow, baseline) {
  const w = column(workflow) ?? {};
  const b = column(baseline) ?? {};
  const rows = [
    ['runs', 'runs'],
    ['verify passed', 'verify'],
    ['hidden checks passed', 'hidden'],
    ['time', 'time'],
    ['Gemma calls', 'calls'],
    ['tokens', 'tokens'],
    ['cost', 'cost'],
    ['wrong solutions caught by tests', 'wrong'],
  ];
  return [
    '| | Workflow | One loop |',
    '| --- | --- | --- |',
    ...rows.map(
      ([label, key]) => `| ${label} | ${w[key] ?? 'n/a'} | ${b[key] ?? 'n/a'} |`
    ),
  ].join('\n');
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  let workflow = opts.workflow;
  let baseline = opts.baseline;
  if (opts.caseId) {
    if (workflow.length === 0) {
      workflow = findResults(
        path.join(REPO, 'evals', 'real', 'results'),
        opts.caseId
      );
    }
    if (baseline.length === 0) {
      baseline = findResults(path.join(HERE, 'results'), opts.caseId);
    }
    if (opts.latest) {
      workflow = workflow.slice(-1);
      baseline = baseline.slice(-1);
    }
  }
  if (workflow.length === 0 && baseline.length === 0) {
    console.error('No results: give --case <id>, or --workflow / --baseline.');
    process.exit(2);
  }
  const w = workflow.map(readReport);
  const b = baseline.map(readReport);
  console.log(`## ${opts.caseId ?? 'comparison'}\n`);
  console.log(table(w, b));
  console.log('\nSources:');
  for (const r of w) console.log(`- workflow: ${shown(r.source)}`);
  for (const r of b) console.log(`- one loop: ${shown(r.source)}`);
  if (w.length === 0) console.log('- workflow: no result found');
  if (b.length === 0) console.log('- one loop: no result found');
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
