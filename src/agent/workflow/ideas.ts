/**
 * The idea workflow (`find_ideas`): finds problem ideas for a topic before
 * there is a spec. A few ideas are written in parallel, each from its own
 * angle. Our code checks each one (its fields, and its complexity against
 * its own constraints), a critic reviews each one, and our code ranks them.
 * It reports the same events as the build workflow, so the chat shows the
 * same task tree.
 */

import type { EventBus } from '../core/events';
import type { Provider, ToolSpec } from '../providers/types';
import { ModelManager } from './manager';
import type { Checkpoint, Plan, PlanTask, TaskResult } from './types';

/** One problem idea, as the ideate call gives it. */
export interface Idea {
  title: string;
  /** The task in 2 to 4 plain lines. */
  task: string;
  input: string;
  output: string;
  /** Plain lines, like `1 <= n <= 200000`. */
  constraints: string;
  /** The intended solution in 1 to 3 lines. */
  solution: string;
  /** Like `O(n log n)`. */
  complexity: string;
  /** Why it is not a plain classic, one line. */
  twist: string;
}

/** The critic's review of one idea. */
export interface IdeaReview {
  /** 1 (unclear) to 4 (very clear). */
  clarity: number;
  /** A Codeforces rating guess, like 1600. */
  rating: number;
  /** '' when the idea looks new, else the known problem or classic. */
  known: string;
  issues: string[];
}

/** An idea with its checks, review and score. */
export interface RankedIdea {
  idea: Idea;
  /** The complexity check, or why the idea was dropped. */
  check: Checkpoint;
  review?: IdeaReview;
  score: number;
}

/** What one run of {@link IdeaWorkflow} returns. */
export interface IdeasResult {
  ok: boolean;
  /** Ideas that passed their check, best first, then the dropped ones. */
  ideas: RankedIdea[];
  results: TaskResult[];
  summary: string;
}

/** The angles of the ideas, one idea each. */
export const IDEA_ANGLES = [
  'a classic technique of the topic, with one new twist in the task itself',
  'a short real story where the topic is hidden: the solver must see it',
  'a counting or optimization version that needs one clever observation',
];

/** Steps more than this do not run in about 1 second. */
export const STEP_LIMIT = 1e9;

/** Steps more than this are tight for 1 second. */
export const TIGHT_STEPS = 3e8;

/** Ideate calls of one idea: the first try and one fix. */
const IDEATE_ATTEMPTS = 2;

const IDEA_FIELDS: (keyof Idea)[] = [
  'title',
  'task',
  'input',
  'output',
  'constraints',
  'solution',
  'complexity',
  'twist',
];

const SUBMIT_IDEA: ToolSpec = {
  name: 'submit_idea',
  description: 'Submit your problem idea. Call it exactly once.',
  parameters: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'A short name, 2 to 5 words.' },
      task: {
        type: 'string',
        description:
          'The task in 2 to 4 plain lines: what is given, what to find.',
      },
      input: { type: 'string', description: 'The input format.' },
      output: { type: 'string', description: 'The output format.' },
      constraints: {
        type: 'string',
        description: 'One per line, plain text, like "1 <= n <= 200000".',
      },
      solution: {
        type: 'string',
        description: 'The intended solution in 1 to 3 lines.',
      },
      complexity: {
        type: 'string',
        description: 'The time complexity, like "O(n log n)".',
      },
      twist: {
        type: 'string',
        description: 'One line: why this is not a plain classic.',
      },
    },
    required: IDEA_FIELDS,
    additionalProperties: false,
  },
};

const SUBMIT_REVIEW: ToolSpec = {
  name: 'submit_review',
  description: 'Submit your review of the idea. Call it exactly once.',
  parameters: {
    type: 'object',
    properties: {
      clarity: {
        type: 'integer',
        description:
          '1 to 4. 4: the task is exact and short. 1: it is vague or has two readings.',
      },
      rating: {
        type: 'integer',
        description: 'Your guess of its Codeforces rating, 800 to 3500.',
      },
      known: {
        type: 'string',
        description:
          'Empty when you do not know this problem. Else the known problem or the classic it is, like "CF 1352C" or "plain two sum".',
      },
      issues: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Short lines: a wrong solution, a missing constraint, an unclear rule. Empty when none.',
      },
    },
    required: ['clarity', 'rating', 'known', 'issues'],
    additionalProperties: false,
  },
};

/** The system prompt of an ideate call. */
export function ideatePrompt(): string {
  return [
    'You invent competitive programming problems for a problem setter.',
    '',
    'Rules:',
    '- Write one problem idea from the angle you get. Call submit_idea once. Do not answer with text.',
    '- The task must be exact: one reading only, a clear input and output.',
    '- The intended solution must be correct and fast enough for your own constraints (about 10^8 simple steps in 1 second).',
    '- Plain text only: write n <= 2*10^5, a_i. No LaTeX and no $ signs.',
    '- Avoid the plain classics everyone knows (two sum, longest subarray with sum <= k). Add a real twist.',
  ].join('\n');
}

/** The system prompt of a critic call. */
export function criticPrompt(): string {
  return [
    'You review a competitive programming problem idea for a problem setter. Be honest and strict.',
    '',
    'Rules:',
    '- Call submit_review once. Do not answer with text.',
    '- clarity: is the task exact, with one reading only?',
    '- rating: your honest Codeforces rating guess.',
    '- known: name the known problem or classic when it is one. Leave it empty only when you do not know it.',
    '- issues: check the intended solution. Is it correct? Is it fast enough for the constraints? Is a constraint missing?',
  ].join('\n');
}

/** The idea as plain lines, for the critic, the chat and the spec. */
export function ideaText(idea: Idea): string {
  return [
    `Title: ${idea.title}`,
    `Task: ${idea.task}`,
    `Input: ${idea.input}`,
    `Output: ${idea.output}`,
    `Constraints: ${idea.constraints}`,
    `Intended solution: ${idea.solution}`,
    `Complexity: ${idea.complexity}`,
    `Twist: ${idea.twist}`,
  ].join('\n');
}

/** Removes LaTeX money signs, which Gemma writes even when told not to. */
function plain(text: string): string {
  return text
    .replace(/\$/g, '')
    .replace(/\\(le|leq)\b/g, '<=')
    .replace(/\\(ge|geq)\b/g, '>=')
    .replace(/\\cdot\b/g, '*')
    .trim();
}

/** Checks the shape of `submit_idea` arguments. */
export function parseIdea(args: unknown): Idea | string {
  if (typeof args !== 'object' || args === null) {
    return 'The arguments must be an object with the idea fields.';
  }
  const record = args as Record<string, unknown>;
  const missing = IDEA_FIELDS.filter(
    f => typeof record[f] !== 'string' || record[f].trim() === ''
  );
  if (missing.length > 0) {
    return `Missing or empty fields: ${missing.join(', ')}. Call submit_idea again with every field.`;
  }
  const idea = {} as Idea;
  for (const f of IDEA_FIELDS) idea[f] = plain(String(record[f]));
  return idea;
}

/** Checks the shape of `submit_review` arguments. */
export function parseReview(args: unknown): IdeaReview | string {
  if (typeof args !== 'object' || args === null) {
    return 'The arguments must be an object.';
  }
  const r = args as Record<string, unknown>;
  const clarity = Number(r['clarity']);
  const rating = Number(r['rating']);
  if (!Number.isFinite(clarity) || !Number.isFinite(rating)) {
    return 'clarity and rating must be numbers. Call submit_review again.';
  }
  const issues = Array.isArray(r['issues'])
    ? r['issues']
        .filter((i): i is string => typeof i === 'string' && i.trim() !== '')
        .map(plain)
    : [];
  const known = typeof r['known'] === 'string' ? plain(r['known']) : '';
  return {
    clarity: Math.min(4, Math.max(1, Math.round(clarity))),
    rating: Math.min(3500, Math.max(800, Math.round(rating / 100) * 100)),
    known: /^(none|no|fresh|new|unknown|-)?$/i.test(known) ? '' : known,
    issues,
  };
}

/** Reads `2*10^5`, `200000`, `2e5`, `10^9`. NaN when it is not a number. */
export function parseNumber(text: string): number {
  const t = text.replace(/[\s,]/g, '').replace(/[·×x]/g, '*');
  const power = /^(?:(\d+(?:\.\d+)?)\*)?10\^(\d+)$/.exec(t);
  if (power) return Number(power[1] ?? 1) * 10 ** Number(power[2]);
  return /^\d+(?:\.\d+)?(?:e\d+)?$/i.test(t) ? Number(t) : NaN;
}

/** The upper bound of `n` in the constraints, or null. */
export function maxN(constraints: string): number | null {
  const m = /\bn\s*(?:<=|≤|<)\s*([0-9][0-9.*·×x^e ]*)/i.exec(constraints);
  if (!m?.[1]) return null;
  const value = parseNumber(m[1].trim());
  return Number.isFinite(value) ? value : null;
}

/**
 * About how many steps the complexity makes for this `n`, or null when the
 * complexity is not one we read. The biggest term decides.
 */
export function estimateSteps(complexity: string, n: number): number | null {
  const c = complexity
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/²/g, '^2')
    .replace(/³/g, '^3')
    .replace(/√/g, 'sqrt');
  const lg = Math.log2(Math.max(n, 2));
  const log = /log/.test(c) ? lg : 1;
  if (/2\^n|n!/.test(c)) return n <= 60 ? 2 ** n : Infinity;
  if (/n\^3|n\*n\*n/.test(c)) return n ** 3 * log;
  if (/n\^2|n\*n/.test(c)) return n * n * log;
  if (/sqrt|n\^1\.5/.test(c)) return n * Math.sqrt(n) * log;
  if (/log\^2|log\(n\)\^2|logn\)\^2|log²/.test(c)) return n * lg * lg;
  if (/n/.test(c)) return n * log;
  if (/log/.test(c)) return lg;
  if (/^o\(1\)$/.test(c)) return 1;
  return null;
}

/** `3.5e6`. */
function steps(value: number): string {
  if (!Number.isFinite(value)) return 'too many';
  return value < 1000 ? String(Math.round(value)) : value.toExponential(1);
}

/**
 * The real check of an idea: its complexity against its own constraints.
 * Fails only when it clearly does not fit; an idea we cannot read passes
 * with a note, the critic still looks at it.
 */
export function complexityCheck(idea: Idea): Checkpoint {
  const n = maxN(idea.constraints);
  if (n === null) {
    return {
      name: 'complexity',
      ok: true,
      digest: `${idea.complexity}, no bound on n to check`,
    };
  }
  const value = estimateSteps(idea.complexity, n);
  if (value === null) {
    return {
      name: 'complexity',
      ok: true,
      digest: `${idea.complexity} with n <= ${n}: not checked`,
    };
  }
  if (value > STEP_LIMIT) {
    return {
      name: 'complexity',
      ok: false,
      digest: `${idea.complexity} with n <= ${n} is about ${steps(value)} steps, too slow for 1 second`,
    };
  }
  return {
    name: 'complexity',
    ok: true,
    digest: `${idea.complexity} with n <= ${n}: about ${steps(value)} steps${value > TIGHT_STEPS ? ', tight' : ', fits'}`,
  };
}

/** `●●●○`, the clarity as dots. */
export function clarityDots(clarity: number): string {
  return '●'.repeat(clarity) + '○'.repeat(Math.max(0, 4 - clarity));
}

/** The review on one line: `●●●○ clear · ~1700 · fresh`. */
export function reviewLine(review: IdeaReview): string {
  const known = review.known ? `known: ${review.known}` : 'fresh';
  const issues =
    review.issues.length > 0
      ? ` · ${review.issues.length} issue${review.issues.length === 1 ? '' : 's'}`
      : '';
  return `${clarityDots(review.clarity)} · ~${review.rating} · ${known}${issues}`;
}

/**
 * The score of an idea: clear and new first, close to the asked rating,
 * fewer issues. A dropped idea has no score.
 */
export function scoreIdea(review: IdeaReview, targetRating?: number): number {
  let score = review.clarity * 2 + (review.known ? 0 : 3);
  score -= review.issues.length * 0.5;
  if (targetRating !== undefined) {
    score -= Math.abs(review.rating - targetRating) / 400;
  }
  return Math.round(score * 10) / 10;
}

/**
 * The plan the tree shows: ideas, a critic after each, the ranking, then
 * a polish of the best idea with its issues and a second review.
 */
export function ideasPlan(count: number): Plan {
  const tasks: PlanTask[] = [];
  for (let i = 1; i <= count; i++) {
    tasks.push({
      id: `idea-${i}`,
      kind: 'ideate',
      title: `Idea ${i}: ${shortAngle(i - 1)}`,
      dependsOn: [],
      brief: IDEA_ANGLES[(i - 1) % IDEA_ANGLES.length] ?? '',
      ownsFiles: [],
    });
  }
  for (let i = 1; i <= count; i++) {
    tasks.push({
      id: `critic-${i}`,
      kind: 'idea_critic',
      title: `Critic ${i}`,
      dependsOn: [`idea-${i}`],
      brief: 'Review the idea.',
      ownsFiles: [],
    });
  }
  tasks.push(
    {
      id: 'rank',
      kind: 'idea_rank',
      title: 'Rank the ideas',
      dependsOn: tasks.map(t => t.id),
      brief: 'Order the ideas by the reviews.',
      ownsFiles: [],
    },
    {
      id: 'polish',
      kind: 'ideate',
      title: 'Polish the best idea',
      dependsOn: ['rank'],
      brief: 'Fix the issues the critic found in the best idea.',
      ownsFiles: [],
    },
    {
      id: 'recheck',
      kind: 'idea_critic',
      title: 'Recheck it',
      dependsOn: ['polish'],
      brief: 'Review the polished idea again.',
      ownsFiles: [],
    }
  );
  return { recipe: 'find_ideas', tasks };
}

function shortAngle(i: number): string {
  return ['a twist on a classic', 'a hidden story', 'one clever observation'][
    i % 3
  ];
}

/** Output tokens of one ideator call. */
export const IDEATOR_OUTPUT_TOKENS = 3000;

/** Output tokens of one critic call. */
export const CRITIC_OUTPUT_TOKENS = 2000;

/** What {@link IdeaWorkflow} needs. */
export interface IdeaWorkflowOptions {
  provider: Provider;
  model: string;
  /** The chat bus: the plan, task and usage events go to the UI. */
  bus: EventBus;
  /** Ideas per run, 3 by default. */
  count?: number;
  /**
   * The most output tokens the model may give in one call. The ideator asks
   * for 3000 and the critic for 2000, never more than this.
   */
  maxOutputTokens?: number;
}

/** What one run looks for. */
export interface IdeaRequest {
  topic: string;
  /** A Codeforces rating, like 1600. */
  rating?: number;
  /** What the setter wants more of, like "more novel, no centroid". */
  wish?: string;
  /** Titles of ideas shown before, not to repeat. */
  avoid?: string[];
}

/** Finds ideas. One instance can run many times, one at a time. */
export class IdeaWorkflow {
  private readonly ideator: ModelManager;
  private readonly critic: ModelManager;

  constructor(private readonly opts: IdeaWorkflowOptions) {
    // A higher temperature for new ideas, a low one for honest reviews.
    const cap = opts.maxOutputTokens ?? Infinity;
    this.ideator = new ModelManager({
      provider: opts.provider,
      model: opts.model,
      bus: opts.bus,
      temperature: 0.9,
      maxOutputTokens: Math.min(IDEATOR_OUTPUT_TOKENS, cap),
    });
    this.critic = new ModelManager({
      provider: opts.provider,
      model: opts.model,
      bus: opts.bus,
      temperature: 0.2,
      maxOutputTokens: Math.min(CRITIC_OUTPUT_TOKENS, cap),
    });
  }

  async run(request: IdeaRequest, signal: AbortSignal): Promise<IdeasResult> {
    const bus = this.opts.bus;
    const count = this.opts.count ?? IDEA_ANGLES.length;
    let cost = 0;
    const off = bus.on(e => {
      if (e.type === 'usage' && typeof e.costUsd === 'number')
        cost += e.costUsd;
    });
    const results: TaskResult[] = [];
    const finish = (taskId: string, attempts: number, check: Checkpoint) => {
      const result: TaskResult = {
        taskId,
        status: check.ok ? 'passed' : 'failed',
        attempts,
        summary: check.digest.split('\n')[0] ?? '',
        checkpoint: check,
      };
      results.push(result);
      bus.emit({ type: 'task_done', taskId, result });
    };
    const skip = (taskId: string, why: string) => {
      const result: TaskResult = {
        taskId,
        status: 'skipped',
        attempts: 0,
        summary: why,
        checkpoint: { name: 'skipped', ok: false, digest: why },
      };
      results.push(result);
      bus.emit({ type: 'task_done', taskId, result });
    };

    try {
      bus.emit({ type: 'plan_created', plan: ideasPlan(count) });
      const found = await Promise.all(
        Array.from({ length: count }, (_, i) =>
          this.oneIdea(i + 1, request, signal, finish, skip)
        )
      );

      bus.emit({ type: 'task_started', taskId: 'rank', attempt: 1 });
      const kept = found
        .filter((f): f is RankedIdea => f !== null && f.check.ok)
        .sort((a, b) => b.score - a.score);
      const dropped = found.filter(
        (f): f is RankedIdea => f !== null && !f.check.ok
      );
      const best = kept[0];
      const rank: Checkpoint = best
        ? {
            name: 'rank',
            ok: true,
            digest: `best: ${best.idea.title}${
              kept.length > 1
                ? `, then ${kept
                    .slice(1)
                    .map(k => k.idea.title)
                    .join(', ')}`
                : ''
            }`,
          }
        : {
            name: 'rank',
            ok: false,
            digest: signal.aborted ? 'cancelled' : 'no idea passed its checks',
          };
      bus.emit({
        type: 'task_checkpoint',
        taskId: 'rank',
        name: rank.name,
        ok: rank.ok,
        digest: rank.digest,
      });
      finish('rank', 1, rank);

      if (best) {
        const polished = await this.polish(best, request, signal, finish, skip);
        if (polished) kept[0] = polished;
      } else {
        skip('polish', 'no idea to polish');
        skip('recheck', 'no idea to polish');
      }

      const ok = best !== undefined && !signal.aborted;
      const summary = ok
        ? `find_ideas: ${kept.length} of ${count} ideas passed, best: ${kept[0]?.idea.title ?? best.idea.title}`
        : `find_ideas: ${signal.aborted ? 'cancelled' : 'no idea passed its checks'}`;
      bus.emit({ type: 'workflow_done', ok, summary, costUsd: cost });
      return { ok, ideas: [...kept, ...dropped], results, summary };
    } finally {
      off();
    }
  }

  /** The critic's review of an idea, or null when it gave none. */
  private async review(
    idea: Idea,
    signal: AbortSignal
  ): Promise<IdeaReview | null> {
    try {
      return await this.critic.callForTool(
        criticPrompt(),
        `${ideaText(idea)}\n\nCall submit_review now.`,
        SUBMIT_REVIEW,
        parseReview,
        signal
      );
    } catch {
      return null;
    }
  }

  /**
   * Fixes the issues the critic found in the best idea, checks the new
   * version and reviews it again. Returns it when it is not worse (no
   * more issues, still fits its constraints), else null: the first version
   * stays.
   */
  private async polish(
    best: RankedIdea,
    request: IdeaRequest,
    signal: AbortSignal,
    finish: (taskId: string, attempts: number, check: Checkpoint) => void,
    skip: (taskId: string, why: string) => void
  ): Promise<RankedIdea | null> {
    const bus = this.opts.bus;
    const issues = best.review?.issues ?? [];
    if (issues.length === 0 || signal.aborted) {
      const why = signal.aborted ? 'cancelled' : 'the critic found no issue';
      skip('polish', why);
      skip('recheck', why);
      return null;
    }

    bus.emit({ type: 'task_started', taskId: 'polish', attempt: 1 });
    const user = [
      ideaText(best.idea),
      '',
      'A critic found these issues:',
      ...issues.map(i => `- ${i}`),
      '',
      'Fix every issue: make the task exact, and fix the solution or the constraints. Keep the core idea and the title.',
      'Call submit_idea now with the whole fixed idea.',
    ].join('\n');
    let fixed: Idea | null;
    try {
      fixed = await this.ideator.callForTool(
        ideatePrompt(),
        user,
        SUBMIT_IDEA,
        parseIdea,
        signal
      );
    } catch {
      fixed = null;
    }
    const check = fixed ? complexityCheck(fixed) : null;
    const polishCheck: Checkpoint =
      fixed && check?.ok
        ? {
            name: 'polish',
            ok: true,
            digest: `${fixed.title}: rewritten for ${issues.length} issue${issues.length === 1 ? '' : 's'}`,
          }
        : {
            name: 'polish',
            ok: false,
            digest: fixed
              ? `the fix failed its check (${check?.digest ?? ''}), kept the first version`
              : 'no fixed idea, kept the first version',
          };
    emitCheck(bus, 'polish', polishCheck);
    finish('polish', 1, polishCheck);
    if (!fixed || !check?.ok) {
      skip('recheck', 'blocked by polish');
      return null;
    }

    bus.emit({ type: 'task_started', taskId: 'recheck', attempt: 1 });
    const review = await this.review(fixed, signal);
    const better = review !== null && review.issues.length <= issues.length;
    const recheck: Checkpoint = review
      ? {
          name: 'critic',
          ok: better,
          digest: [
            `${reviewLine(review)} (was ${issues.length} issue${issues.length === 1 ? '' : 's'})${better ? '' : ', kept the first version'}`,
            ...review.issues,
          ].join('\n'),
        }
      : {
          name: 'critic',
          ok: false,
          digest: 'no review, kept the first version',
        };
    emitCheck(bus, 'recheck', recheck);
    finish('recheck', 1, recheck);
    if (!review || !better) return null;
    return {
      idea: fixed,
      check: { ...check, digest: `${fixed.title}: ${check.digest}` },
      review,
      score: scoreIdea(review, request.rating),
    };
  }

  /** One idea and its review. Null when the idea could not be written. */
  private async oneIdea(
    n: number,
    request: IdeaRequest,
    signal: AbortSignal,
    finish: (taskId: string, attempts: number, check: Checkpoint) => void,
    skip: (taskId: string, why: string) => void
  ): Promise<RankedIdea | null> {
    const bus = this.opts.bus;
    const ideaId = `idea-${n}`;
    const criticId = `critic-${n}`;
    const angle = IDEA_ANGLES[(n - 1) % IDEA_ANGLES.length] ?? '';

    let idea: Idea | null = null;
    let check: Checkpoint = {
      name: 'idea',
      ok: false,
      digest: 'no idea written',
    };
    let note = '';
    let attempt = 0;
    while (attempt < IDEATE_ATTEMPTS && !signal.aborted) {
      attempt++;
      bus.emit({ type: 'task_started', taskId: ideaId, attempt });
      const user = [
        `Topic: ${request.topic}`,
        request.rating
          ? `Difficulty: about ${request.rating} on Codeforces.`
          : '',
        request.wish ? `The setter wants: ${request.wish}` : '',
        request.avoid && request.avoid.length > 0
          ? `Do not repeat these ideas: ${request.avoid.join('; ')}`
          : '',
        `Your angle: ${angle}`,
        note
          ? `Your last idea failed a check: ${note}\nFix it: change the constraints or find a faster solution.`
          : '',
        'Call submit_idea now.',
      ]
        .filter(Boolean)
        .join('\n');
      try {
        idea = await this.ideator.callForTool(
          ideatePrompt(),
          user,
          SUBMIT_IDEA,
          parseIdea,
          signal
        );
      } catch (error) {
        idea = null;
        check = {
          name: 'idea',
          ok: false,
          digest: signal.aborted
            ? 'cancelled'
            : `model error: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      if (idea) {
        check = complexityCheck(idea);
        check = { ...check, digest: `${idea.title}: ${check.digest}` };
      } else if (check.digest === 'no idea written') {
        check = { ...check, digest: 'the model did not call submit_idea' };
      }
      bus.emit({
        type: 'task_checkpoint',
        taskId: ideaId,
        name: check.name,
        ok: check.ok,
        digest: check.digest,
      });
      if (check.ok) break;
      note = check.digest;
    }
    finish(ideaId, attempt, check);
    if (!idea || !check.ok) {
      skip(criticId, `blocked by ${ideaId}`);
      return idea ? { idea, check, score: -Infinity } : null;
    }

    bus.emit({ type: 'task_started', taskId: criticId, attempt: 1 });
    const review = await this.review(idea, signal);
    const reviewCheck: Checkpoint = review
      ? {
          name: 'critic',
          ok: true,
          digest: [reviewLine(review), ...review.issues].join('\n'),
        }
      : { name: 'critic', ok: false, digest: 'no review' };
    bus.emit({
      type: 'task_checkpoint',
      taskId: criticId,
      name: reviewCheck.name,
      ok: reviewCheck.ok,
      digest: reviewCheck.digest,
    });
    finish(criticId, 1, reviewCheck);
    const out: RankedIdea = {
      idea,
      check,
      score: review ? scoreIdea(review, request.rating) : 0,
    };
    if (review) out.review = review;
    return out;
  }
}

/** Emits the checkpoint event of a task. */
function emitCheck(bus: EventBus, taskId: string, check: Checkpoint): void {
  bus.emit({
    type: 'task_checkpoint',
    taskId,
    name: check.name,
    ok: check.ok,
    digest: check.digest,
  });
}

/** The ideas for the chat model: ranked, with their checks and reviews. */
export function ideasReport(result: IdeasResult): string {
  if (result.ideas.length === 0) return 'No idea was written.';
  return result.ideas
    .map((r, i) => {
      const head = r.check.ok
        ? `${i + 1}. ${r.idea.title} (${r.review ? reviewLine(r.review) : 'no review'})`
        : `dropped: ${r.idea.title} (${r.check.digest})`;
      return [
        head,
        ideaText(r.idea)
          .split('\n')
          .slice(1)
          .map(l => `   ${l}`)
          .join('\n'),
        ...(r.review?.issues ?? []).map(issue => `   Issue: ${issue}`),
      ].join('\n');
    })
    .join('\n\n');
}
