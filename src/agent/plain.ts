/**
 * The plain chat: a line-mode `polyman chat` with `readline`, no Ink. Every
 * event is one line, approvals are y/N questions. It is the way to test the
 * agent without the terminal UI, and the fallback when the UI breaks.
 *
 * Lines from stdin go into a queue. When no turn runs, the next line is a
 * message. When a turn waits for an approval, the next line is the answer.
 * So piped input like "build it\ny\n" works too.
 */

import * as readline from 'readline';
import { looksLikePolygonKey, PASTED_KEY_NOTICE } from './core/pasted-key';
import type { AgentSessionApi } from './core/session-types';
import type { ApprovalDecision, EventBus, SeqEvent } from './core/events';
import type { Plan } from './workflow/types';

/** Options of {@link runPlain}. */
export interface PlainOptions {
  /** The problem folder, or null in "new problem" mode. */
  problem: string | null;
  model: string;
  /** Defaults to `process.stdin`. */
  input?: NodeJS.ReadableStream;
  /** Defaults to `process.stdout`. */
  output?: NodeJS.WritableStream;
}

/** Longest args shown in a `> tool(args)` line. */
const ARGS_MAX = 100;

/** Longest summary shown in one event line. */
const LINE_MAX = 160;

/** Longest summary shown for a tool call of a workflow worker. */
const TASK_LINE_MAX = 100;

/** How long to wait for a cancelled turn to end before we leave. */
const CANCEL_WAIT_MS = 5000;

/** A question the turn waits on. */
type Asking =
  { kind: 'tool'; approvalId: string } | { kind: 'plan'; approvalId: string };

/**
 * Runs the plain chat until the user leaves: ctrl+d (end of input), or
 * ctrl+c twice. Resolves when it is over; a running turn is cancelled first.
 */
export function runPlain(
  session: AgentSessionApi,
  bus: EventBus,
  opts: PlainOptions
): Promise<void> {
  const input = opts.input ?? process.stdin;
  const output = opts.output ?? process.stdout;
  const terminal = (input as { isTTY?: boolean }).isTTY === true;
  const rl = readline.createInterface({ input, output, terminal });
  rl.setPrompt('you> ');

  const write = (text: string): void => {
    output.write(text);
  };
  let atLineStart = true;
  /** Prints one full line, after a newline when streamed text is open. */
  const line = (text: string): void => {
    if (!atLineStart) write('\n');
    write(`${text}\n`);
    atLineStart = true;
  };

  const queue: string[] = [];
  let inputClosed = false;
  let turn: Promise<unknown> | null = null;
  let asking: Asking | null = null;
  let ctrlC = 0;
  let leaving = false;
  const attempts = new Map<string, number>();
  let usage = { input: 0, output: 0, cost: 0 };

  let done!: () => void;
  const finished = new Promise<void>(resolve => {
    done = resolve;
  });

  const showPrompt = (): void => {
    if (terminal && !leaving) rl.prompt();
  };

  const answer = (decision: ApprovalDecision): void => {
    if (asking === null) return;
    const { approvalId } = asking;
    asking = null;
    session.resolveApproval(approvalId, decision);
  };

  /** Takes queued lines while something waits for one. */
  const pump = (): void => {
    if (leaving) return;
    if (asking !== null) {
      const next = queue.shift();
      if (next !== undefined) {
        answer(parseAnswer(next, asking.kind));
      } else if (inputClosed) {
        line('(no answer, end of input: denied)');
        answer({ kind: 'deny', reason: 'no answer' });
      }
      return;
    }
    if (turn !== null) return;
    while (queue.length > 0) {
      const text = (queue.shift() ?? '').trim();
      if (text === '') continue;
      if (looksLikePolygonKey(text)) {
        // Not sent to the model and not echoed.
        line(`[${PASTED_KEY_NOTICE}]`);
        if (queue.length === 0) showPrompt();
        continue;
      }
      startTurn(text);
      return;
    }
    if (inputClosed) void leave();
  };

  const startTurn = (text: string): void => {
    ctrlC = 0;
    usage = { input: 0, output: 0, cost: 0 };
    if (!terminal) line(`you> ${text}`);
    turn = session
      .send(text)
      .catch((err: unknown) => {
        line(`[error: ${err instanceof Error ? err.message : String(err)}]`);
      })
      .finally(() => {
        turn = null;
        asking = null;
        if (!leaving) {
          showPrompt();
          pump();
        }
      });
  };

  const leave = async (): Promise<void> => {
    if (leaving) return;
    leaving = true;
    const running = turn;
    if (running !== null) {
      session.cancel();
      await Promise.race([
        running,
        new Promise(resolve => setTimeout(resolve, CANCEL_WAIT_MS).unref()),
      ]);
    }
    off();
    rl.close();
    done();
  };

  const onEvent = (e: SeqEvent): void => {
    switch (e.type) {
      case 'text_delta':
        write(e.text);
        atLineStart = e.text.endsWith('\n');
        break;
      case 'tool_call':
        if (e.taskId !== undefined) {
          line(`  [${e.taskId}] > ${e.name}(${shortArgs(e.args)})`);
        } else {
          line(`> ${e.name}(${shortArgs(e.args)})`);
        }
        break;
      case 'tool_result':
        if (e.taskId !== undefined) {
          line(
            `  [${e.taskId}]   = ${e.ok ? '' : 'error: '}${short(firstLine(e.summary), TASK_LINE_MAX)}`
          );
        } else {
          line(`  = ${e.ok ? '' : 'error: '}${short(e.summary)}`);
        }
        break;
      case 'approval_needed': {
        if (e.command !== undefined) line(`  $ ${short(e.command)}`);
        line(`Allow ${e.title}? [y/N/a(lways)]`);
        asking = { kind: 'tool', approvalId: e.approvalId };
        pump();
        break;
      }
      case 'plan_created':
        for (const l of planLines(e.plan)) line(l);
        break;
      case 'plan_approval_needed':
        line('Run this plan? [y/N]');
        asking = { kind: 'plan', approvalId: e.approvalId };
        pump();
        break;
      case 'task_started':
        attempts.set(e.taskId, e.attempt);
        line(
          e.attempt === 1
            ? `[task ${e.taskId}] started`
            : `[task ${e.taskId}] attempt ${e.attempt}`
        );
        break;
      case 'task_checkpoint':
        line(
          e.ok
            ? `[task ${e.taskId}] checkpoint ${e.name} ok`
            : `[task ${e.taskId}] attempt ${attempts.get(e.taskId) ?? 1}: checkpoint failed: ${short(firstLine(e.digest))}`
        );
        break;
      case 'task_done':
        line(
          `[task ${e.taskId}] ${e.result.status}: ${short(firstLine(e.result.summary))}`
        );
        break;
      case 'workflow_done':
        line(
          `[workflow ${e.ok ? 'done' : 'failed'}, $${e.costUsd.toFixed(4)}]`
        );
        for (const l of e.summary.split('\n')) line(`  ${l}`);
        break;
      case 'usage':
        usage.input += e.inputTokens;
        usage.output += e.outputTokens;
        usage.cost += e.costUsd ?? 0;
        break;
      case 'notes_updated':
        line('[notes updated]');
        break;
      case 'problem_dir_changed':
        line(`[problem folder: ${e.problemDir}]`);
        break;
      case 'compacted':
        line(`[compacted ${e.removedMessages} old messages]`);
        break;
      case 'turn_end':
        if (e.reason === 'cancelled') line('[cancelled]');
        else if (e.reason === 'max_steps') line('[stopped at the step limit]');
        else if (e.reason === 'error') line(`[error: ${e.error ?? 'unknown'}]`);
        else if (!atLineStart) {
          write('\n');
          atLineStart = true;
        }
        line(
          `[${usage.input} in / ${usage.output} out tokens${usage.cost > 0 ? `, $${usage.cost.toFixed(4)}` : ''}]`
        );
        break;
      case 'turn_start':
      case 'reasoning_delta':
      case 'tool_progress':
      case 'approval_resolved':
        break;
    }
  };
  const off = bus.on(onEvent);

  const onInterrupt = (): void => {
    ctrlC += 1;
    if (ctrlC >= 2) {
      line('');
      void leave();
      return;
    }
    if (turn !== null) {
      session.cancel();
      line('(cancelling, press ctrl+c again to exit)');
    } else {
      line('(press ctrl+c again to exit, or ctrl+d)');
      showPrompt();
    }
  };

  rl.on('line', text => {
    queue.push(text);
    pump();
  });
  rl.on('close', () => {
    inputClosed = true;
    pump();
  });
  rl.on('SIGINT', onInterrupt);

  line(
    `polyman chat (plain), model ${opts.model}, problem: ${opts.problem ?? 'none yet'}`
  );
  line('ctrl+c cancels the answer, ctrl+c twice or ctrl+d exits.');
  showPrompt();

  return finished;
}

/** Reads a y/N/a answer. */
export function parseAnswer(
  text: string,
  kind: 'tool' | 'plan'
): ApprovalDecision {
  const a = text.trim().toLowerCase();
  if (a === 'y' || a === 'yes') return { kind: 'allow_once' };
  if (kind === 'tool' && (a === 'a' || a === 'always')) {
    return { kind: 'allow_session' };
  }
  return {
    kind: 'deny',
    reason:
      a === '' || a === 'n' || a === 'no' ? 'the user said no' : text.trim(),
  };
}

/** The plan as a numbered list. */
export function planLines(plan: Plan): string[] {
  const lines = [`Plan (${plan.recipe}, ${plan.tasks.length} tasks):`];
  plan.tasks.forEach((t, i) => {
    const after =
      t.dependsOn.length > 0 ? ` (after ${t.dependsOn.join(', ')})` : '';
    lines.push(`  ${i + 1}. [${t.id}] ${t.title}${after}`);
  });
  return lines;
}

function shortArgs(args: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(args) ?? '';
  } catch {
    json = String(args);
  }
  if (json === '{}') return '';
  return json.length > ARGS_MAX ? `${json.slice(0, ARGS_MAX - 3)}...` : json;
}

function short(text: string, max = LINE_MAX): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? '';
}
