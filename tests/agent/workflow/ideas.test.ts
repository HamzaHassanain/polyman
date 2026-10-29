import { describe, it, expect } from 'vitest';
import type {
  AgentEvent,
  EventBus,
  SeqEvent,
} from '../../../src/agent/core/events';
import type {
  ChatRequest,
  Provider,
  StreamEvent,
} from '../../../src/agent/providers/types';
import { ideasTool } from '../../../src/agent/tools/ideas-tool';
import {
  IDEA_ANGLES,
  IdeaWorkflow,
  complexityCheck,
  estimateSteps,
  ideasPlan,
  ideasReport,
  maxN,
  parseIdea,
  parseNumber,
  parseReview,
  reviewLine,
  scoreIdea,
  type Idea,
} from '../../../src/agent/workflow/ideas';
import type { ToolContext } from '../../../src/agent/tools/types';

const idea = (over: Partial<Idea> = {}): Idea => ({
  title: 'Mirror Window',
  task: 'Count the subarrays where every value appears as often in the left half as in the right half.',
  input: 'n, then n integers',
  output: 'One integer',
  constraints: '1 <= n <= 2*10^5\n1 <= a_i <= 10^9',
  solution: 'Two pointers with a hash of the counts.',
  complexity: 'O(n log n)',
  twist: 'The halves move with the window.',
  ...over,
});

class Bus implements EventBus {
  events: SeqEvent[] = [];
  private seq = 0;
  private readonly fns = new Set<(e: SeqEvent) => void>();
  emit(e: AgentEvent): void {
    const se = { ...e, seq: this.seq++ };
    this.events.push(se);
    for (const fn of this.fns) fn(se);
  }
  on(fn: (e: SeqEvent) => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }
  /** The tree events as short strings. */
  trace(): string[] {
    return this.events.flatMap(e => {
      if (e.type === 'task_started') return [`start ${e.taskId} ${e.attempt}`];
      if (e.type === 'task_done') return [`${e.result.status} ${e.taskId}`];
      if (e.type === 'workflow_done') return [`done ${e.ok}`];
      return [];
    });
  }
}

type Reply = { name: string; args: unknown };

/**
 * A model that answers by the request: `ideate(angle, call)` for an idea,
 * `critic(user text)` for a review.
 */
class FakeModel implements Provider {
  id = 'fake';
  readonly requests: ChatRequest[] = [];
  private calls = new Map<string, number>();
  constructor(
    private readonly ideate: (angle: string, call: number) => Reply,
    private readonly critic: (text: string) => Reply
  ) {}
  async *stream(req: ChatRequest): AsyncIterable<StreamEvent> {
    this.requests.push(req);
    const first = req.messages[0]?.parts[0];
    const text = first?.type === 'text' ? first.text : '';
    let reply: Reply;
    if (req.tools?.[0]?.name === 'submit_idea') {
      const angle = /Your angle: (.*)/.exec(text)?.[1] ?? '';
      const n = (this.calls.get(angle) ?? 0) + 1;
      this.calls.set(angle, n);
      reply = this.ideate(angle, n);
    } else {
      reply = this.critic(text);
    }
    await Promise.resolve();
    yield { type: 'usage', inputTokens: 100, outputTokens: 50, costUsd: 0.001 };
    yield { type: 'tool_call', id: `c${this.requests.length}`, ...reply };
    yield { type: 'done', stopReason: 'tool_calls' };
  }
}

const review = (clarity: number, known = '', rating = 1600) => ({
  name: 'submit_review',
  args: { clarity, rating, known, issues: [] },
});

describe('the complexity check', () => {
  it('reads numbers and the bound on n', () => {
    expect(parseNumber('2*10^5')).toBe(200000);
    expect(parseNumber('2 · 10^5')).toBe(200000);
    expect(parseNumber('10^9')).toBe(1e9);
    expect(parseNumber('2e5')).toBe(200000);
    expect(parseNumber('5000')).toBe(5000);
    expect(parseNumber('k')).toBeNaN();
    expect(maxN('1 <= n <= 2*10^5\n1 <= a_i <= 10^9')).toBe(200000);
    expect(maxN('1 ≤ n ≤ 5000, k <= n')).toBe(5000);
    expect(maxN('1 <= a_i <= 10^9')).toBeNull();
  });

  it('estimates the steps of a complexity', () => {
    expect(estimateSteps('O(n)', 1e5)).toBe(1e5);
    expect(estimateSteps('O(n log n)', 1024)).toBe(1024 * 10);
    expect(estimateSteps('O(n log^2 n)', 1024)).toBe(1024 * 100);
    expect(estimateSteps('O((n + q) log n)', 1024)).toBe(1024 * 10);
    expect(estimateSteps('O(n^2)', 1000)).toBe(1e6);
    expect(estimateSteps('O(n²)', 1000)).toBe(1e6);
    expect(estimateSteps('O(n sqrt n)', 10000)).toBe(1e6);
    expect(estimateSteps('O(2^n)', 20)).toBe(2 ** 20);
    expect(estimateSteps('O(1)', 5)).toBe(1);
    expect(estimateSteps('fast', 5)).toBeNull();
  });

  it('fails an idea that is too slow for its own constraints', () => {
    expect(complexityCheck(idea())).toEqual({
      name: 'complexity',
      ok: true,
      digest: 'O(n log n) with n <= 200000: about 3.5e+6 steps, fits',
    });
    expect(complexityCheck(idea({ complexity: 'O(n^2)' }))).toMatchObject({
      ok: false,
      digest:
        'O(n^2) with n <= 200000 is about 4.0e+10 steps, too slow for 1 second',
    });
    expect(
      complexityCheck(
        idea({ complexity: 'O(n^2)', constraints: '1 <= n <= 5000' })
      ).ok
    ).toBe(true);
    expect(complexityCheck(idea({ constraints: '1 <= a_i <= 10' }))).toEqual({
      name: 'complexity',
      ok: true,
      digest: 'O(n log n), no bound on n to check',
    });
  });
});

describe('parsing the model answers', () => {
  it('needs every idea field and removes LaTeX', () => {
    expect(parseIdea({ title: 'x' })).toMatch(/^Missing or empty fields: task/);
    const parsed = parseIdea({
      ...idea(),
      constraints: '$1 \\le n \\le 2 \\cdot 10^5$',
    });
    expect(parsed).toMatchObject({ constraints: '1 <= n <= 2 * 10^5' });
  });

  it('clamps a review and reads "none" as fresh', () => {
    expect(
      parseReview({
        clarity: 9,
        rating: 1730,
        known: 'none',
        issues: ['', 'x'],
      })
    ).toEqual({ clarity: 4, rating: 1700, known: '', issues: ['x'] });
    expect(parseReview({ clarity: 'a', rating: 1 })).toMatch(/must be numbers/);
  });

  it('scores clear and fresh ideas first, close to the asked rating', () => {
    const fresh = { clarity: 4, rating: 1600, known: '', issues: [] };
    const known = { ...fresh, known: 'CF 1352C' };
    expect(scoreIdea(fresh)).toBeGreaterThan(scoreIdea(known));
    expect(scoreIdea(fresh, 1600)).toBeGreaterThan(
      scoreIdea({ ...fresh, rating: 2400 }, 1600)
    );
    expect(reviewLine(fresh)).toBe('●●●● · ~1600 · fresh');
    expect(reviewLine({ ...known, clarity: 2, issues: ['a'] })).toBe(
      '●●○○ · ~1600 · known: CF 1352C · 1 issue'
    );
  });
});

describe('ideasPlan', () => {
  it('has the ideas, a critic after each, and the ranking last', () => {
    const plan = ideasPlan(3);
    expect(plan.recipe).toBe('find_ideas');
    expect(plan.tasks.map(t => t.id)).toEqual([
      'idea-1',
      'idea-2',
      'idea-3',
      'critic-1',
      'critic-2',
      'critic-3',
      'rank',
      'polish',
      'recheck',
    ]);
    expect(plan.tasks.find(t => t.id === 'critic-2')?.dependsOn).toEqual([
      'idea-2',
    ]);
    expect(plan.tasks.find(t => t.id === 'rank')?.dependsOn).toHaveLength(6);
    expect(plan.tasks.at(-1)?.dependsOn).toEqual(['polish']);
  });
});

describe('IdeaWorkflow', () => {
  it('writes, checks, reviews and ranks the ideas, with a retry for a slow one', async () => {
    const [a, b, c] = IDEA_ANGLES;
    const model = new FakeModel(
      (angle, call) => {
        if (angle === a)
          return { name: 'submit_idea', args: idea({ title: 'Known One' }) };
        if (angle === b) {
          // Too slow first, fixed on the second try.
          return {
            name: 'submit_idea',
            args: idea({
              title: 'Hidden Story',
              complexity: call === 1 ? 'O(n^2)' : 'O(n)',
            }),
          };
        }
        return {
          name: 'submit_idea',
          args: idea({ title: 'Always Slow', complexity: 'O(n^3)' }),
        };
      },
      text =>
        text.includes('Known One') ? review(4, 'plain two sum') : review(3)
    );
    expect(c).toBeDefined();
    const bus = new Bus();
    const flow = new IdeaWorkflow({ provider: model, model: 'm', bus });
    const out = await flow.run(
      { topic: 'two pointers', wish: 'more novel', avoid: ['Old Idea'] },
      new AbortController().signal
    );

    expect(out.ok).toBe(true);
    // Fresh beats known; the slow idea is dropped and comes last.
    expect(out.ideas.map(i => i.idea.title)).toEqual([
      'Hidden Story',
      'Known One',
      'Always Slow',
    ]);
    expect(out.summary).toBe(
      'find_ideas: 2 of 3 ideas passed, best: Hidden Story'
    );
    const trace = bus.trace();
    expect(trace).toContain('start idea-2 2');
    expect(trace).toContain('passed idea-2');
    expect(trace).toContain('failed idea-3');
    expect(trace).toContain('skipped critic-3');
    expect(trace.slice(-4)).toEqual([
      'passed rank',
      'skipped polish',
      'skipped recheck',
      'done true',
    ]);
    // 5 idea calls (2 retries) and 2 reviews.
    const done = bus.events.find(e => e.type === 'workflow_done');
    expect(done?.type === 'workflow_done' && done.costUsd).toBeCloseTo(
      0.007,
      6
    );
    expect(bus.events[0]).toMatchObject({ type: 'plan_created' });

    // The retry gets the failed check; the wish and the old ideas go along.
    const ideateTexts = model.requests
      .filter(r => r.tools?.[0]?.name === 'submit_idea')
      .map(r => (r.messages[0]?.parts[0] as { text: string }).text);
    expect(
      ideateTexts.some(t =>
        t.includes('Your last idea failed a check: Hidden Story: O(n^2)')
      )
    ).toBe(true);
    expect(
      ideateTexts.every(t => t.includes('The setter wants: more novel'))
    ).toBe(true);
    expect(
      ideateTexts.every(t => t.includes('Do not repeat these ideas: Old Idea'))
    ).toBe(true);

    const report = ideasReport(out);
    expect(report).toMatch(
      /^1\. Hidden Story \(●●●○ · ~1600 · fresh\)\n {3}Task: /
    );
    expect(report).toContain(
      '2. Known One (●●●● · ~1600 · known: plain two sum)'
    );
    expect(report).toContain('dropped: Always Slow (Always Slow: O(n^3)');
  });

  it('polishes the best idea with the issues of its critic', async () => {
    const model = new FakeModel(
      angle =>
        angle === ''
          ? { name: 'submit_idea', args: idea({ title: 'Fixed Window' }) }
          : {
              name: 'submit_idea',
              args: idea({ title: `Idea ${angle.length}` }),
            },
      text =>
        text.includes('Fixed Window')
          ? review(4)
          : {
              name: 'submit_review',
              args: {
                clarity: 3,
                rating: 1600,
                known: '',
                issues: ['two readings of "half"'],
              },
            }
    );
    const bus = new Bus();
    const out = await new IdeaWorkflow({
      provider: model,
      model: 'm',
      bus,
      count: 1,
    }).run({ topic: 'x' }, new AbortController().signal);
    expect(out.ideas[0]?.idea.title).toBe('Fixed Window');
    expect(out.summary).toBe(
      'find_ideas: 1 of 1 ideas passed, best: Fixed Window'
    );
    const polishText = model.requests
      .map(r => (r.messages[0]?.parts[0] as { text: string }).text)
      .find(t => t.includes('A critic found these issues'));
    expect(polishText).toContain('- two readings of "half"');
    const recheck = bus.events.find(
      e => e.type === 'task_done' && e.taskId === 'recheck'
    );
    expect(
      recheck?.type === 'task_done' && recheck.result.checkpoint.digest
    ).toBe('●●●● · ~1600 · fresh (was 1 issue)');
  });

  it('keeps the first version when the polished one is worse', async () => {
    const model = new FakeModel(
      angle =>
        angle === ''
          ? {
              name: 'submit_idea',
              args: idea({ title: 'Worse', complexity: 'O(n^3)' }),
            }
          : { name: 'submit_idea', args: idea({ title: 'First' }) },
      () => ({
        name: 'submit_review',
        args: { clarity: 3, rating: 1600, known: '', issues: ['vague'] },
      })
    );
    const bus = new Bus();
    const out = await new IdeaWorkflow({
      provider: model,
      model: 'm',
      bus,
      count: 1,
    }).run({ topic: 'x' }, new AbortController().signal);
    expect(out.ideas[0]?.idea.title).toBe('First');
    expect(bus.trace().slice(-3)).toEqual([
      'failed polish',
      'skipped recheck',
      'done true',
    ]);
  });

  it('is not ok when no idea passes', async () => {
    const model = new FakeModel(
      () => ({ name: 'submit_idea', args: idea({ complexity: 'O(n^3)' }) }),
      () => review(3)
    );
    const bus = new Bus();
    const out = await new IdeaWorkflow({
      provider: model,
      model: 'm',
      bus,
    }).run({ topic: 'x' }, new AbortController().signal);
    expect(out.ok).toBe(false);
    expect(out.summary).toBe('find_ideas: no idea passed its checks');
    expect(bus.trace()).toContain('failed rank');
  });
});

describe('find_ideas tool', () => {
  it('passes the request on and gives the report and the next step', async () => {
    const seen: unknown[] = [];
    const tool = ideasTool({
      createRunner: () => ({
        run: request => {
          seen.push(request);
          return Promise.resolve({
            ok: true,
            ideas: [],
            results: [],
            summary: 'find_ideas: 0 of 3 ideas passed',
          });
        },
      }),
    });
    expect(tool.needsProblem).toBe(false);
    expect(tool.risk).toBe('read');
    const out = await tool.run(
      { topic: ' two pointers ', rating: 1600, wish: 'novel', avoid: ['A'] },
      { signal: new AbortController().signal } as ToolContext
    );
    expect(seen).toEqual([
      { topic: 'two pointers', rating: 1600, wish: 'novel', avoid: ['A'] },
    ]);
    expect(out.content).toMatch(
      /^find_ideas: 0 of 3 ideas passed\n\nNo idea was written\.\n\nShow the ideas/
    );
    const empty = await tool.run({ topic: ' ' }, {
      signal: new AbortController().signal,
    } as ToolContext);
    expect(empty.isError).toBe(true);
  });
});
