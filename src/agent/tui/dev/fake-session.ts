/**
 * A fake session for building the UI without the real agent. On `send` it
 * replays a scripted demo with small delays: the Think step, notes, a write
 * approval with a diff, and a verify that fails and then passes. A message
 * with the word "workflow" runs a scripted workflow: the plan approval, the
 * live task tree with a retried validator, and the final summary. A
 * message with the word "prove" runs a scripted prove_idea workflow that
 * finds a wrong sample, and one with "idea" runs a scripted find_ideas.
 */

import type {
  AgentEvent,
  ApprovalDecision,
  EventBus,
  SeqEvent,
} from '../../core/events.js';
import type { Message } from '../../core/messages.js';
import type { AgentSessionApi } from '../../core/session-types.js';
import type { PermissionMode } from '../../tools/types.js';
import type { Plan, PlanTask, TaskResult } from '../../workflow/types.js';

type TurnEnd = 'done' | 'cancelled' | 'max_steps' | 'error';

/** A small event bus, enough for the fake session and the tests. */
export class FakeBus implements EventBus {
  private seq = 0;
  private readonly listeners = new Set<(e: SeqEvent) => void>();
  /** Every event sent so far. */
  readonly events: SeqEvent[] = [];

  emit(e: AgentEvent): void {
    const event = { ...e, seq: ++this.seq };
    this.events.push(event);
    for (const fn of [...this.listeners]) fn(event);
  }

  on(fn: (e: SeqEvent) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }
}

class Cancelled extends Error {}

const VALIDATOR_PREVIEW = [
  '+ #include "testlib.h"',
  '+',
  '+ int main(int argc, char* argv[]) {',
  '+     registerValidation(argc, argv);',
  '+     int n = inf.readInt(1, 200000, "n");',
  '+     inf.readSpace();',
  '+     long long k = inf.readLong(-2000000000LL, 2000000000LL, "k");',
  '+     inf.readEoln();',
  '+     inf.readInts(n, -1000000000, 1000000000, "a");',
  '+     inf.readEoln();',
  '+     inf.readEof();',
  '+ }',
].join('\n');

/** A task of the demo plan. */
function task(
  id: string,
  kind: PlanTask['kind'],
  title: string,
  dependsOn: string[],
  ownsFiles: string[],
  tag?: string
): PlanTask {
  return {
    id,
    kind,
    title,
    dependsOn,
    brief: `Do the ${title} of pairs-sum, as the notes say.`,
    ownsFiles,
    ...(tag ? { params: { tag } } : {}),
  };
}

/** The plan of the scripted workflow: build pairs-sum in 12 tasks. */
export const DEMO_PLAN: Plan = {
  recipe: 'build_problem',
  tasks: [
    task('t1', 'scaffold', 'scaffold', [], ['Config.json', 'testlib.h']),
    task(
      't2',
      'statement',
      'statement',
      ['t1'],
      [
        'statements/english/legend.tex',
        'statements/english/input.tex',
        'statements/english/output.tex',
      ]
    ),
    task('t3', 'statement_critic', 'statement critic', ['t2'], []),
    task(
      't4',
      'main_solution',
      'main solution',
      ['t1'],
      ['solutions/main.cpp'],
      'MA'
    ),
    task(
      't5',
      'brute_force',
      'brute force',
      ['t1'],
      ['solutions/brute.cpp'],
      'TO'
    ),
    task(
      't6',
      'wrong_solution',
      'wrong solution: int overflow',
      ['t4'],
      ['solutions/wa-overflow.cpp'],
      'WA'
    ),
    task(
      't7',
      'wrong_solution',
      'wrong solution: O(n^2)',
      ['t4'],
      ['solutions/tl-n2.cpp'],
      'TL'
    ),
    task(
      't8',
      'validator',
      'validator',
      ['t1'],
      ['validator/val.cpp', 'validator/val_tests.json']
    ),
    task(
      't9',
      'generators',
      'generators',
      ['t1'],
      [
        'generators/gen-random.cpp',
        'generators/gen-big.cpp',
        'generators/script.txt',
      ]
    ),
    task('t10', 'checker', 'checker: standard ncmp', ['t1'], []),
    task('t11', 'generate_validate', 'generate + validate', ['t8', 't9'], []),
    task(
      't12',
      'verify',
      'verify',
      ['t3', 't4', 't5', 't6', 't7', 't10', 't11'],
      []
    ),
  ],
};

const started = (taskId: string, attempt = 1): AgentEvent => ({
  type: 'task_started',
  taskId,
  attempt,
});

const checkpoint = (
  taskId: string,
  name: string,
  ok: boolean,
  digest: string
): AgentEvent => ({ type: 'task_checkpoint', taskId, name, ok, digest });

const done = (
  taskId: string,
  attempts: number,
  summary: string,
  check: TaskResult['checkpoint']
): AgentEvent => ({
  type: 'task_done',
  taskId,
  result: { taskId, status: 'passed', attempts, summary, checkpoint: check },
});

/** A checkpoint that passed, and the task done with it. */
const passed = (
  taskId: string,
  name: string,
  digest: string,
  summary: string,
  attempts = 1
): AgentEvent[] => [
  checkpoint(taskId, name, true, digest),
  done(taskId, attempts, summary, { name, ok: true, digest }),
];

const workerUsage = (costUsd: number): AgentEvent => ({
  type: 'usage',
  inputTokens: 3000,
  outputTokens: 400,
  costUsd,
});

/**
 * The scripted workflow run: [delay in ms, events]. The validator fails
 * twice and passes on attempt 3, the other tasks pass.
 */
const DEMO_RUN: [number, AgentEvent[]][] = [
  [300, [started('t1')]],
  [
    700,
    passed(
      't1',
      'scaffold',
      'Config.json and testlib.h are ready',
      'scaffold done'
    ),
  ],
  [300, [started('t2'), started('t4'), started('t8'), started('t9')]],
  [800, [workerUsage(0.004)]],
  [
    900,
    [
      ...passed(
        't2',
        'statement checks',
        'legend, input, output and 2 samples',
        'statement written'
      ),
      started('t3'),
    ],
  ],
  [
    1000,
    [
      workerUsage(0.005),
      checkpoint(
        't8',
        'test validator',
        false,
        '5 of 6 ok\ntest 4: n = 0 was accepted, expected FAIL\nthe notes say 1 <= n'
      ),
    ],
  ],
  [800, [started('t8', 2)]],
  [
    600,
    [
      ...passed('t3', 'critic', 'critic ok', 'the statement matches the notes'),
      started('t5'),
    ],
  ],
  [
    1000,
    [
      workerUsage(0.006),
      ...passed(
        't4',
        'run_solution on samples',
        '2 of 2 samples ok',
        'main.cpp: sort + two pointers, O(n log n)'
      ),
      started('t6'),
    ],
  ],
  [
    900,
    [
      ...passed(
        't9',
        'generators',
        'gen-random and gen-big compile, the script makes 24 tests',
        'two generators and the script'
      ),
      started('t7'),
    ],
  ],
  [
    1200,
    [
      workerUsage(0.004),
      checkpoint(
        't8',
        'test validator',
        false,
        '5 of 6 ok\ntest 6: a value of 1000000001 was accepted, expected FAIL'
      ),
    ],
  ],
  [1500, [workerUsage(0.002), started('t8', 3)]],
  [
    900,
    [
      ...passed(
        't5',
        'run_solution on samples',
        '2 of 2 samples ok',
        'brute.cpp: two loops, O(n^2)'
      ),
      started('t10'),
    ],
  ],
  [
    1000,
    [
      workerUsage(0.005),
      ...passed(
        't8',
        'test validator',
        '6 of 6 ok',
        'val.cpp checks n, k and every a[i]',
        3
      ),
      started('t11'),
    ],
  ],
  [800, passed('t6', 'compile', 'wa-overflow.cpp compiles', 'sums in int')],
  [600, passed('t10', 'checker', 'standard checker ncmp', 'uses ncmp')],
  [
    1000,
    passed(
      't11',
      'generate + validate',
      '24 tests generated, 24 of 24 valid',
      '24 tests'
    ),
  ],
  [
    800,
    [
      workerUsage(0.003),
      ...passed('t7', 'compile', 'tl-n2.cpp compiles', 'two loops'),
    ],
  ],
  [300, [started('t12')]],
  [
    2000,
    passed(
      't12',
      'verify',
      'verify passed: 4 solutions, 25 tests, every verdict matches its tag',
      'verify passed'
    ),
  ],
];

const proveFile = (name: string): string[] => [`.polyman/agent/prove/${name}`];

/** The plan of the scripted proof, like `proveIdeaPlan` makes it. */
export const PROVE_PLAN: Plan = {
  recipe: 'prove_idea',
  tasks: [
    task('brute', 'proto_brute', 'Brute force', [], proveFile('brute.cpp')),
    task('main', 'proto_main', 'Intended solution', [], proveFile('main.cpp')),
    task('gen', 'proto_gen', 'Random tests', [], proveFile('gen.cpp')),
    task(
      'wrong-1',
      'proto_wrong',
      'Wrong: int overflow',
      [],
      proveFile('wrong-1.cpp'),
      'WA'
    ),
    task(
      'wrong-2',
      'proto_wrong',
      'Wrong: counts (i, i) as a pair',
      [],
      proveFile('wrong-2.cpp'),
      'WA'
    ),
    task(
      'stress',
      'stress',
      'Stress: brute = main',
      ['brute', 'main', 'gen'],
      []
    ),
    task('samples', 'sample_check', 'Samples', ['brute', 'main'], []),
    task(
      'max-test',
      'max_test',
      'Max test in the time limit',
      ['main', 'gen'],
      []
    ),
    task(
      'kill-brute',
      'kill_wrong',
      'Kill: O(n^2) brute force',
      ['brute', 'main', 'gen', 'stress'],
      [],
      'TL'
    ),
    task(
      'kill-1',
      'kill_wrong',
      'Kill: int overflow',
      ['wrong-1', 'main', 'gen', 'stress'],
      [],
      'WA'
    ),
    task(
      'kill-2',
      'kill_wrong',
      'Kill: counts (i, i) as a pair',
      ['wrong-2', 'main', 'gen', 'stress'],
      [],
      'WA'
    ),
  ],
};

/** A check that failed, and the task done with it. */
const failedCheck = (
  taskId: string,
  name: string,
  digest: string
): AgentEvent[] => [
  checkpoint(taskId, name, false, digest),
  {
    type: 'task_done',
    taskId,
    result: {
      taskId,
      status: 'failed',
      attempts: 1,
      summary: `failed after 1 attempt: ${digest.split('\n')[0] ?? ''}`,
      checkpoint: { name, ok: false, digest },
    },
  },
];

/** The scripted proof: every check passes but sample 2 is wrong. */
const PROVE_RUN: [number, AgentEvent[]][] = [
  [
    300,
    [started('brute'), started('main'), started('gen'), started('wrong-1')],
  ],
  [900, [workerUsage(0.003)]],
  [
    800,
    [
      ...passed('brute', 'samples', 'compiles, runs on 2 samples', 'two loops'),
      started('wrong-2'),
    ],
  ],
  [
    900,
    [
      workerUsage(0.004),
      ...passed('gen', 'generator', 'small and max tests, one per seed', 'gen'),
    ],
  ],
  [
    700,
    passed(
      'wrong-1',
      'compile',
      'compiles',
      'sums in int instead of long long'
    ),
  ],
  [
    900,
    [
      workerUsage(0.005),
      ...passed(
        'main',
        'samples',
        'compiles, runs on 2 samples',
        'sort + two pointers'
      ),
      started('stress'),
      started('samples'),
      started('max-test'),
    ],
  ],
  [
    700,
    failedCheck(
      'samples',
      'samples',
      'sample 2 looks wrong: the spec says 3, brute and main say 2'
    ),
  ],
  [600, passed('wrong-2', 'compile', 'compiles', 'j starts at i')],
  [
    900,
    passed(
      'max-test',
      'max test',
      'slowest max test 0.09 s of 1.00 s',
      'fast enough'
    ),
  ],
  [
    1500,
    [
      ...passed(
        'stress',
        'stress',
        '300 random small tests: brute = main',
        'brute = main'
      ),
      started('kill-brute'),
      started('kill-1'),
      started('kill-2'),
    ],
  ],
  [
    800,
    passed(
      'kill-2',
      'kill',
      'killed by small test 1: main says 1, it says 3',
      'killed'
    ),
  ],
  [
    700,
    passed(
      'kill-1',
      'kill',
      'killed by max test 1: main says 19999999900000, it says -1474836480',
      'killed'
    ),
  ],
  [
    1200,
    passed(
      'kill-brute',
      'kill',
      'killed: max test 1 ran over 3.00 s, the limit is 1.00 s',
      'killed'
    ),
  ],
];

/** The plan of the scripted idea search, like `ideasPlan(3)` makes it. */
export const IDEAS_PLAN: Plan = {
  recipe: 'find_ideas',
  tasks: [
    task('idea-1', 'ideate', 'Idea 1: a twist on a classic', [], []),
    task('idea-2', 'ideate', 'Idea 2: a hidden story', [], []),
    task('idea-3', 'ideate', 'Idea 3: one clever observation', [], []),
    task('critic-1', 'idea_critic', 'Critic 1', ['idea-1'], []),
    task('critic-2', 'idea_critic', 'Critic 2', ['idea-2'], []),
    task('critic-3', 'idea_critic', 'Critic 3', ['idea-3'], []),
    task(
      'rank',
      'idea_rank',
      'Rank the ideas',
      ['idea-1', 'idea-2', 'idea-3', 'critic-1', 'critic-2', 'critic-3'],
      []
    ),
    task('polish', 'ideate', 'Polish the best idea', ['rank'], []),
    task('recheck', 'idea_critic', 'Recheck it', ['polish'], []),
  ],
};

/** The scripted idea search: one idea is too slow and is fixed. */
const IDEAS_RUN: [number, AgentEvent[]][] = [
  [300, [started('idea-1'), started('idea-2'), started('idea-3')]],
  [1200, [workerUsage(0.001)]],
  [
    700,
    [
      checkpoint(
        'idea-2',
        'complexity',
        false,
        'Courier Window: O(n^2) with n <= 200000 is about 4.0e+10 steps, too slow for 1 second'
      ),
      started('idea-2', 2),
    ],
  ],
  [
    600,
    [
      ...passed(
        'idea-1',
        'complexity',
        'Mirror Window: O(n log n) with n <= 200000: about 3.5e+6 steps, fits',
        'Mirror Window'
      ),
      started('critic-1'),
    ],
  ],
  [
    900,
    [
      workerUsage(0.001),
      ...passed(
        'idea-3',
        'complexity',
        'Heavy Start: O(n) with n <= 200000: about 2.0e+5 steps, fits',
        'Heavy Start'
      ),
      started('critic-3'),
    ],
  ],
  [
    900,
    [
      ...passed(
        'critic-1',
        'critic',
        '●●●○ · ~1700 · fresh · 1 issue',
        'reviewed'
      ),
      ...passed(
        'idea-2',
        'complexity',
        'Courier Window: O(n) with n <= 200000: about 2.0e+5 steps, fits',
        'Courier Window',
        2
      ),
      started('critic-2'),
    ],
  ],
  [
    800,
    passed(
      'critic-3',
      'critic',
      '●●●● · ~1200 · known: plain sliding window',
      'reviewed'
    ),
  ],
  [
    900,
    [
      workerUsage(0.001),
      ...passed('critic-2', 'critic', '●●●● · ~1500 · fresh', 'reviewed'),
      started('rank'),
    ],
  ],
  [
    300,
    [
      ...passed(
        'rank',
        'rank',
        'best: Mirror Window, then Courier Window, Heavy Start',
        'ranked'
      ),
      started('polish'),
    ],
  ],
  [
    1100,
    [
      ...passed(
        'polish',
        'polish',
        'Mirror Window: rewritten for 1 issue',
        'polished'
      ),
      started('recheck'),
    ],
  ],
  [
    900,
    [
      workerUsage(0.001),
      ...passed(
        'recheck',
        'critic',
        '●●●● · ~1700 · fresh (was 1 issue)',
        'reviewed'
      ),
    ],
  ],
];

/** The cost of the scripted workflow: the sum of its usage events. */
const DEMO_COST = runCost(DEMO_RUN);

function runCost(run: [number, AgentEvent[]][]): number {
  return run
    .flatMap(([, events]) => events)
    .reduce((sum, e) => sum + (e.type === 'usage' ? (e.costUsd ?? 0) : 0), 0);
}

/** Options of the fake session. */
export interface FakeSessionOptions {
  /** Multiplies every delay. 0 for tests. Default 1. */
  delayScale?: number;
  /** The mode at start. Default `ask`. */
  mode?: PermissionMode;
}

/** Implements {@link AgentSessionApi} with scripted turns. */
export class FakeSession implements AgentSessionApi {
  private readonly history: Message[] = [];
  private readonly scale: number;
  private mode: PermissionMode;
  private turn = 0;
  private ids = 0;
  private abort: AbortController | null = null;
  private readonly waiting = new Map<
    string,
    (decision: ApprovalDecision) => void
  >();

  constructor(
    private readonly bus: EventBus,
    opts: FakeSessionOptions = {}
  ) {
    this.scale = opts.delayScale ?? 1;
    this.mode = opts.mode ?? 'ask';
  }

  get messages(): readonly Message[] {
    return this.history;
  }

  /** Changes the permission mode. `auto-edit` skips the write approval. */
  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  async send(text: string): Promise<TurnEnd> {
    if (this.abort) throw new Error('a turn is already running');
    const abort = new AbortController();
    this.abort = abort;
    const turnId = `turn-${++this.turn}`;
    this.history.push(this.message('user', text));
    this.bus.emit({ type: 'turn_start', turnId });
    let reason: TurnEnd = 'done';
    let error: string | undefined;
    try {
      const answer = await this.script(this.turn, text, abort.signal);
      this.history.push(this.message('assistant', answer));
    } catch (err) {
      if (err instanceof Cancelled) {
        reason = 'cancelled';
      } else {
        reason = 'error';
        error = err instanceof Error ? err.message : String(err);
      }
    } finally {
      this.abort = null;
      this.waiting.clear();
    }
    this.bus.emit(
      error === undefined
        ? { type: 'turn_end', turnId, reason }
        : { type: 'turn_end', turnId, reason, error }
    );
    return reason;
  }

  cancel(): void {
    this.abort?.abort();
  }

  resolveApproval(approvalId: string, decision: ApprovalDecision): void {
    const resolve = this.waiting.get(approvalId);
    if (!resolve) return;
    this.waiting.delete(approvalId);
    this.bus.emit({ type: 'approval_resolved', approvalId, decision });
    resolve(decision);
  }

  private message(role: 'user' | 'assistant', text: string): Message {
    return {
      id: `m${++this.ids}`,
      role,
      parts: [{ type: 'text', text }],
      createdAt: new Date().toISOString(),
    };
  }

  /** Waits `ms` (times the scale), or throws when the turn is cancelled. */
  private sleep(ms: number, signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Cancelled());
        return;
      }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms * this.scale);
      const onAbort = () => {
        clearTimeout(timer);
        reject(new Cancelled());
      };
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  /** Streams text in small chunks, like a model. */
  private async stream(text: string, signal: AbortSignal): Promise<void> {
    const chunks = text.match(/\S+\s*|\s+/g) ?? [];
    for (const chunk of chunks) {
      await this.sleep(25, signal);
      this.bus.emit({ type: 'text_delta', text: chunk });
    }
  }

  /** Emits `approval_needed` (or the plan approval) and waits for the answer. */
  private ask(
    approval:
      | Extract<AgentEvent, { type: 'approval_needed' }>
      | Extract<AgentEvent, { type: 'plan_approval_needed' }>,
    signal: AbortSignal
  ): Promise<ApprovalDecision> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) {
        reject(new Cancelled());
        return;
      }
      signal.addEventListener('abort', () => reject(new Cancelled()), {
        once: true,
      });
      this.waiting.set(approval.approvalId, resolve);
      this.bus.emit(approval);
    });
  }

  private usage(input: number, output: number, costUsd: number): void {
    this.bus.emit({
      type: 'usage',
      inputTokens: input,
      outputTokens: output,
      costUsd,
    });
  }

  /** Runs the script of one turn and returns the last answer text. */
  private async script(
    turn: number,
    text: string,
    signal: AbortSignal
  ): Promise<string> {
    if (/workflow/i.test(text)) return this.workflowStep(signal);
    if (/prove/i.test(text)) return this.proveStep(signal);
    if (/\bideas?\b/i.test(text)) return this.ideasStep(signal);
    if (/markdown/i.test(text)) return this.markdownStep(signal);
    if (turn === 1) return this.thinkStep(signal);
    if (turn === 2) return this.buildStep(signal);
    const answer = `(fake session) You said: "${text}". The scripted demo is over, this turn only echoes.`;
    await this.stream(answer, signal);
    this.usage(900, 40, 0.0004);
    return answer;
  }

  /** An answer with headings and a code block, to see the markdown look. */
  private async markdownStep(signal: AbortSignal): Promise<string> {
    const answer = [
      '# Pairs with sum k',
      '',
      '## Idea',
      '',
      'Sort the array, then walk **two pointers** from both ends.',
      '',
      '```cpp',
      'sort(a.begin(), a.end());',
      'int i = 0, j = n - 1;',
      'while (i < j) {',
      '    long long s = 1LL * a[i] + a[j];',
      '    if (s == k) ans++, i++, j--;',
      '    else if (s < k) i++;',
      '    else j--;',
      '}',
      '```',
      '',
      '### Verdicts',
      '',
      '- `main.cpp` is MA, `brute.cpp` is TO',
      '- `wa-overflow.cpp` is WA, `tl-n2.cpp` is TL',
    ].join('\n');
    await this.stream(answer, signal);
    this.usage(1200, 160, 0.0006);
    return answer;
  }

  private async thinkStep(signal: AbortSignal): Promise<string> {
    for (const part of [
      'The user wants pairs with sum k. ',
      'I should ask about order and repeats first.',
    ]) {
      await this.sleep(300, signal);
      this.bus.emit({ type: 'reasoning_delta', text: part });
    }
    await this.stream(
      [
        'Nice. Before we build anything, let us fix the task:',
        '',
        '1. Are the pairs ordered (`i < j`)?',
        '2. Can values repeat?',
        '3. What are the limits on `k`? I guess `|k| <= 2e9`, so the sum needs `long long`.',
        '',
        'My idea: sort the array and use **two pointers**, `O(n log n)`.',
      ].join('\n'),
      signal
    );
    this.usage(2100, 160, 0.0011);
    this.bus.emit({
      type: 'tool_call',
      callId: 'c1',
      name: 'update_notes',
      args: { section: 'Constraints' },
      risk: 'write',
    });
    await this.sleep(400, signal);
    this.bus.emit({ type: 'notes_updated', notes: '# Idea\nCount pairs...' });
    this.bus.emit({
      type: 'tool_result',
      callId: 'c1',
      ok: true,
      summary: 'notes updated',
    });
    const answer =
      'I wrote the idea and the constraints in the notes. Answer the questions, then say **build**.';
    await this.stream(answer, signal);
    this.usage(2400, 30, 0.0009);
    return answer;
  }

  private async verify(
    callId: string,
    passed: boolean,
    signal: AbortSignal
  ): Promise<void> {
    this.bus.emit({
      type: 'tool_call',
      callId,
      name: 'verify',
      args: {},
      risk: 'run',
    });
    const lines = [
      'Compiling 4 solutions ...',
      'Generating tests ... (24/24)',
      'Validating tests ... (24/24)',
      'Running main.cpp on tests ... (24/24)',
      'Running brute.cpp on tests ... (24/24)',
      'Running wa-overflow.cpp on tests ... (12/24)',
      'Running wa-overflow.cpp on tests ... (24/24)',
    ];
    for (const line of lines) {
      await this.sleep(350, signal);
      this.bus.emit({ type: 'tool_progress', callId, line });
    }
    await this.sleep(300, signal);
    this.bus.emit(
      passed
        ? {
            type: 'tool_result',
            callId,
            ok: true,
            summary:
              'verify passed: 4 solutions, 25 tests, every verdict matches its tag',
          }
        : {
            type: 'tool_result',
            callId,
            ok: false,
            summary:
              'verify failed: wa-overflow.cpp (WA) passed all 24 tests\nno test has a sum above 2^31',
          }
    );
  }

  private async workflowStep(signal: AbortSignal): Promise<string> {
    await this.stream(
      'The notes are ready. I will build the problem as a workflow.',
      signal
    );
    this.usage(3200, 300, 0.0019);
    this.bus.emit({
      type: 'tool_call',
      callId: 'w1',
      name: 'start_workflow',
      args: { recipe: 'build_problem' },
      risk: 'write',
    });
    await this.sleep(400, signal);
    this.usage(4100, 900, 0.0031);
    this.bus.emit({ type: 'plan_created', plan: DEMO_PLAN });
    const decision = await this.ask(
      {
        type: 'plan_approval_needed',
        approvalId: `plan-${this.turn}`,
        plan: DEMO_PLAN,
      },
      signal
    );
    if (decision.kind === 'deny') {
      this.bus.emit({
        type: 'tool_result',
        callId: 'w1',
        ok: false,
        summary: 'the user did not run the plan',
      });
      const answer = decision.reason
        ? 'Ok, what should I change in the plan?'
        : 'Ok, I did not run the plan.';
      await this.stream(answer, signal);
      return answer;
    }
    for (const [ms, events] of DEMO_RUN) {
      await this.sleep(ms, signal);
      for (const e of events) this.bus.emit(e);
    }
    await this.sleep(300, signal);
    const summary =
      '12 of 12 tasks passed, the validator needed 3 attempts\nverify passes: 4 solutions, 25 tests, every verdict matches its tag';
    this.bus.emit({
      type: 'workflow_done',
      ok: true,
      summary,
      costUsd: DEMO_COST,
    });
    this.bus.emit({
      type: 'tool_result',
      callId: 'w1',
      ok: true,
      summary: 'workflow done: 12 of 12 tasks passed',
    });
    const answer =
      'The problem is built and `verify` passes. Say **push** to send it to Polygon.';
    await this.stream(answer, signal);
    this.usage(5200, 60, 0.0021);
    return answer;
  }

  /** The scripted prove_idea run: it finds a wrong sample. */
  private async proveStep(signal: AbortSignal): Promise<string> {
    await this.stream('I will prove the idea before the build.', signal);
    this.usage(3000, 200, 0.0015);
    this.bus.emit({
      type: 'tool_call',
      callId: 'p1',
      name: 'start_workflow',
      args: { recipe: 'prove_idea' },
      risk: 'run',
    });
    await this.sleep(300, signal);
    this.bus.emit({ type: 'plan_created', plan: PROVE_PLAN });
    const decision = await this.ask(
      {
        type: 'plan_approval_needed',
        approvalId: `plan-${this.turn}`,
        plan: PROVE_PLAN,
      },
      signal
    );
    if (decision.kind === 'deny') {
      this.bus.emit({
        type: 'tool_result',
        callId: 'p1',
        ok: false,
        summary: 'the user did not run the plan',
      });
      const answer = 'Ok, I did not prove the idea.';
      await this.stream(answer, signal);
      return answer;
    }
    for (const [ms, events] of PROVE_RUN) {
      await this.sleep(ms, signal);
      for (const e of events) this.bus.emit(e);
    }
    await this.sleep(300, signal);
    this.bus.emit({
      type: 'workflow_done',
      ok: false,
      summary: 'prove_idea: 10 of 11 tasks passed\nfailed: samples',
      costUsd: runCost(PROVE_RUN),
    });
    this.bus.emit({
      type: 'tool_result',
      callId: 'p1',
      ok: false,
      summary: 'prove_idea: 10 of 11 tasks passed, failed: samples',
    });
    const answer = [
      'The idea holds: brute and main agree on 300 random tests, main is fast, and every wrong approach fails.',
      'One problem: **sample 2** is wrong. The spec says 3, but brute and main both say 2. I fixed it in the notes.',
      'Should I build the problem?',
    ].join('\n');
    await this.stream(answer, signal);
    this.usage(4800, 90, 0.0024);
    return answer;
  }

  /** The scripted find_ideas run, with no approval: it only thinks. */
  private async ideasStep(signal: AbortSignal): Promise<string> {
    this.usage(2500, 80, 0.0009);
    this.bus.emit({
      type: 'tool_call',
      callId: 'i1',
      name: 'find_ideas',
      args: { topic: 'two pointers', wish: 'novel' },
      risk: 'read',
    });
    await this.sleep(300, signal);
    this.bus.emit({ type: 'plan_created', plan: IDEAS_PLAN });
    for (const [ms, events] of IDEAS_RUN) {
      await this.sleep(ms, signal);
      for (const e of events) this.bus.emit(e);
    }
    await this.sleep(300, signal);
    const summary = 'find_ideas: 3 of 3 ideas passed, best: Mirror Window';
    this.bus.emit({
      type: 'workflow_done',
      ok: true,
      summary,
      costUsd: runCost(IDEAS_RUN),
    });
    this.bus.emit({ type: 'tool_result', callId: 'i1', ok: true, summary });
    const answer = [
      'Three ideas, best first:',
      '',
      '1. **Mirror Window** (●●●● · ~1700 · fresh): count the subarrays where each value appears as often in the left half as in the right half.',
      '2. **Courier Window** (●●●● · ~1500 · fresh): the longest range of packages whose cost, with the first package counted twice, fits in k.',
      '3. **Heavy Start** (●●●● · ~1200 · known: plain sliding window): the classic, with a small twist.',
      '',
      'Which one should we take? Or should I look for other ones?',
    ].join('\n');
    await this.stream(answer, signal);
    this.usage(4100, 120, 0.0016);
    return answer;
  }

  private async buildStep(signal: AbortSignal): Promise<string> {
    await this.stream('Good. I will start with the validator.', signal);
    this.usage(3000, 420, 0.0021);
    this.bus.emit({
      type: 'tool_call',
      callId: 'c2',
      name: 'write_file',
      args: { path: 'validator/val.cpp', content: '...' },
      risk: 'write',
    });
    if (this.mode === 'ask') {
      const decision = await this.ask(
        {
          type: 'approval_needed',
          approvalId: 'a1',
          callId: 'c2',
          title: 'Write validator/val.cpp?',
          preview: VALIDATOR_PREVIEW,
        },
        signal
      );
      if (decision.kind === 'deny') {
        this.bus.emit({
          type: 'tool_result',
          callId: 'c2',
          ok: false,
          summary: `denied by the user${decision.reason ? `: ${decision.reason}` : ''}`,
        });
        const answer =
          'Ok, I did not write the file. Tell me what to change and I will try again.';
        await this.stream(answer, signal);
        return answer;
      }
    }
    await this.sleep(200, signal);
    this.bus.emit({
      type: 'tool_result',
      callId: 'c2',
      ok: true,
      summary: 'wrote validator/val.cpp (12 lines)',
    });

    await this.stream('Now let us run verify on the whole problem.', signal);
    this.usage(3600, 60, 0.0012);
    await this.verify('c3', false, signal);

    await this.stream(
      'The wrong solution `wa-overflow.cpp` passed every test, so the tests are weak. I will add a test with big values near `1e9`.',
      signal
    );
    this.usage(4200, 120, 0.0016);
    this.bus.emit({
      type: 'tool_call',
      callId: 'c4',
      name: 'generate',
      args: { testset: 'tests' },
      risk: 'run',
    });
    await this.sleep(500, signal);
    this.bus.emit({
      type: 'tool_progress',
      callId: 'c4',
      line: 'gen 25 1000000000 > test 25',
    });
    await this.sleep(300, signal);
    this.bus.emit({
      type: 'tool_result',
      callId: 'c4',
      ok: true,
      summary: 'generated 25 tests',
    });
    await this.verify('c5', true, signal);

    const answer = [
      'Done. `verify` passes now:',
      '',
      '- `main.cpp` and `brute.cpp` pass all 25 tests',
      '- `wa-overflow.cpp` fails test 25 with **WA**, as its tag says',
    ].join('\n');
    await this.stream(answer, signal);
    this.usage(4800, 90, 0.0018);
    return answer;
  }
}
