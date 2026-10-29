import { describe, it, expect } from 'vitest';
import {
  RECIPES,
  addRecipeDependencies,
  buildProblemSkeleton,
  checkPlan,
  dependentsOf,
} from '../../../src/agent/workflow/recipes';
import {
  parseSpec,
  wrongSolutionApproaches,
} from '../../../src/agent/workflow/spec';
import type { Plan, PlanTask } from '../../../src/agent/workflow/types';

const FENCE = '```';

/** The example from design/agent/briefs/SPEC-FORMAT.md. */
const SPEC = `# Idea
Count pairs i < j with a_i + a_j = k.

# Constraints
- 1 <= n <= 200000
- 1 <= a_i <= 1000000000
- 1 <= k <= 1000000000

# Input
The first line has n and k. The second line has n integers a_1 .. a_n.

# Output
One integer: the number of pairs.

# Intended solution
Count values with a hash map while scanning, add cnt[k - a_i] before inserting a_i. O(n). The answer can be up to about 2e10, use 64-bit.

# Wrong approaches
- answer kept in int (overflow) -> WA
- a_i = k/2 counted wrong (counts pairs of the same index) -> WA
- O(n^2) brute force -> TL

# Edge cases
- n = 1
- all values equal and k = 2 * value, n = 200000 (max answer)
- no pair at all

# Samples
## Input 1
${FENCE}
4 6
1 5 3 3
${FENCE}
## Output 1
${FENCE}
2
${FENCE}

# Decisions
- Time limit 1 second, memory limit 256 MB.
- Checker: ncmp.
`;

function task(
  id: string,
  kind: PlanTask['kind'],
  dependsOn: string[] = [],
  ownsFiles: string[] = []
): PlanTask {
  return { id, kind, title: id, dependsOn, brief: '', ownsFiles };
}

/** A small valid build_problem plan for {@link SPEC} (2 wrong solutions). */
function goodPlan(): Plan {
  return {
    recipe: 'build_problem',
    tasks: [
      task('s', 'scaffold'),
      task('st', 'statement', ['s'], ['statements/english/legend.tex']),
      task('cr', 'statement_critic', ['st']),
      task('ma', 'main_solution', ['s'], ['solutions/main.cpp']),
      task('bf', 'brute_force', ['s'], ['solutions/brute.cpp']),
      task('val', 'validator', ['s'], ['validator/val.cpp']),
      task('gen', 'generators', ['s'], ['generators/gen.cpp']),
      task('chk', 'checker', ['s']),
      task('w1', 'wrong_solution', ['s'], ['solutions/wa-1.cpp']),
      task('w2', 'wrong_solution', ['s'], ['solutions/wa-2.cpp']),
      task('gv', 'generate_validate', ['val', 'gen']),
      task('ver', 'verify', ['cr', 'ma', 'bf', 'chk', 'w1', 'w2', 'gv']),
    ],
  };
}

function withTasks(edit: (tasks: PlanTask[]) => void): Plan {
  const plan = goodPlan();
  edit(plan.tasks);
  return plan;
}

describe('parseSpec', () => {
  it('reads the example spec', () => {
    const parsed = parseSpec(SPEC);
    expect(parsed.wrongApproaches).toHaveLength(3);
    expect(parsed.wrongApproaches.map(a => a.verdict)).toEqual([
      'WA',
      'WA',
      'TL',
    ]);
    expect(parsed.wrongApproaches[0]?.text).toBe(
      'answer kept in int (overflow)'
    );
    expect(parsed.wrongApproaches.map(a => a.isBruteForce)).toEqual([
      false,
      false,
      true,
    ]);
    expect(wrongSolutionApproaches(parsed)).toHaveLength(2);
    expect(parsed.samples).toEqual([
      { index: 1, input: '4 6\n1 5 3 3', output: '2' },
    ]);
    expect(parsed.timeLimitMs).toBe(1000);
    expect(parsed.memoryLimitMb).toBe(256);
    expect(parsed.checker).toBe('ncmp');
    expect(parsed.sections['Output']).toBe('One integer: the number of pairs.');
  });

  it('keeps a TL line that is not the brute force', () => {
    const parsed = parseSpec(
      '# Wrong approaches\n- O(n log^2 n) with a set -> TL\n- recursion too deep -> RE\n- no arrow here\n'
    );
    expect(
      parsed.wrongApproaches.map(a => [a.verdict, a.isBruteForce])
    ).toEqual([
      ['TL', false],
      ['RE', false],
      ['WA', false],
    ]);
  });

  it('reads milliseconds and many samples, and ignores headings in fences', () => {
    const parsed = parseSpec(
      [
        '# Samples',
        '## Input 2',
        FENCE,
        '# not a heading',
        FENCE,
        '## Output 2',
        FENCE,
        'b',
        FENCE,
        '## Input 1',
        FENCE,
        'a',
        FENCE,
        '## Output 1',
        FENCE,
        'x',
        FENCE,
        '# Decisions',
        '- Time limit 1500 ms, memory limit 64 MB.',
      ].join('\n')
    );
    expect(parsed.samples.map(s => [s.index, s.input, s.output])).toEqual([
      [1, 'a', 'x'],
      [2, '# not a heading', 'b'],
    ]);
    expect(parsed.timeLimitMs).toBe(1500);
    expect(parsed.memoryLimitMb).toBe(64);
    expect(parsed.checker).toBeUndefined();
  });
});

describe('checkPlan', () => {
  it('accepts a good plan', () => {
    expect(checkPlan(goodPlan(), SPEC)).toEqual([]);
  });

  it('refuses an unknown recipe', () => {
    const plan = { ...goodPlan(), recipe: 'cook' } as unknown as Plan;
    expect(checkPlan(plan, SPEC)).toEqual(['unknown recipe: cook']);
  });

  it('refuses duplicate ids', () => {
    const plan = withTasks(t => {
      t[9].id = 'w1';
    });
    expect(checkPlan(plan, SPEC)).toContain('duplicate task id: w1');
  });

  it('refuses an unknown dependency', () => {
    const plan = withTasks(t => t[1].dependsOn.push('nope'));
    expect(checkPlan(plan, SPEC)).toContain(
      'task st depends on unknown task nope'
    );
  });

  it('names the ids of a cycle', () => {
    const plan = withTasks(t => t[1].dependsOn.push('cr'));
    const errors = checkPlan(plan, SPEC);
    expect(errors.some(e => /dependency cycle: .*st.*cr|cr.*st/.test(e))).toBe(
      true
    );
  });

  it('refuses a kind the recipe does not allow', () => {
    const plan = withTasks(t => t.push(task('fx', 'fix', ['s'])));
    expect(checkPlan(plan, SPEC)).toContain(
      'task fx: kind fix is not allowed in build_problem'
    );
  });

  it('needs exactly one main solution', () => {
    const none = withTasks(t => t.splice(3, 1));
    expect(checkPlan(none, SPEC)).toContain(
      'need exactly one main_solution task, found 0'
    );
    const two = withTasks(t =>
      t.push(task('ma2', 'main_solution', ['s'], ['solutions/main2.cpp']))
    );
    expect(checkPlan(two, SPEC)).toContain(
      'need exactly one main_solution task, found 2'
    );
  });

  it('refuses a file owned by two tasks', () => {
    const plan = withTasks(t => {
      t[4].ownsFiles = ['./solutions/main.cpp'];
    });
    expect(checkPlan(plan, SPEC)).toContain(
      'file ./solutions/main.cpp is owned by both ma and bf'
    );
  });

  it('refuses files on a no-model task', () => {
    const plan = withTasks(t => {
      t[7].ownsFiles = ['checker/chk.cpp'];
    });
    expect(checkPlan(plan, SPEC)).toContain(
      'task chk (checker) runs without a model and must own no files'
    );
  });

  it('a task that writes files must own at least one', () => {
    const plan = withTasks(t => {
      const val = t.find(x => x.kind === 'validator')!;
      val.ownsFiles = [];
    });
    expect(checkPlan(plan, SPEC).join('\n')).toMatch(
      /task \S+ \(validator\) writes files and must own at least one/
    );
  });

  it('needs one wrong_solution per wrong approach, without the brute force', () => {
    const plan = withTasks(t => t.splice(9, 1));
    expect(checkPlan(plan, SPEC).join('\n')).toContain(
      'the spec has 2 wrong approaches (without the brute force), the plan has 1 wrong_solution tasks'
    );
  });

  it('checks the order rules', () => {
    const plan = withTasks(t => {
      t[10].dependsOn = ['val'];
    });
    expect(checkPlan(plan, SPEC)).toContain(
      'task gv (generate_validate) must come after gen'
    );
  });

  it('needs the fixed tasks of the recipe', () => {
    const plan = withTasks(t => t.splice(7, 1));
    expect(checkPlan(plan, SPEC)).toContain('missing a checker task');
  });

  it('allows a small fix_verify plan', () => {
    const plan: Plan = {
      recipe: 'fix_verify',
      tasks: [
        task('v', 'verify'),
        task('f', 'fix', ['v'], ['solutions/a.cpp']),
      ],
    };
    expect(checkPlan(plan, SPEC)).toEqual([]);
    expect(RECIPES.fix_verify.kinds).toEqual(['verify', 'fix']);
  });
});

describe('buildProblemSkeleton', () => {
  it('passes checkPlan for a spec with 2 wrong approaches', () => {
    const plan = buildProblemSkeleton(SPEC);
    expect(checkPlan(plan, SPEC)).toEqual([]);
    const files = plan.tasks.flatMap(t => t.ownsFiles);
    expect(files).toContain('solutions/main.cpp');
    expect(files).toContain('solutions/brute.cpp');
    expect(files).toContain('solutions/wa-1.cpp');
    expect(files).toContain('solutions/wa-2.cpp');
    expect(files).toContain('validator/val.cpp');
    expect(files.some(f => /^generators\/gen-.*\.cpp$/.test(f))).toBe(true);
    expect(files.some(f => f.startsWith('statements/english/'))).toBe(true);
    expect(plan.tasks.at(-1)?.kind).toBe('verify');
  });

  it('works with no wrong approaches', () => {
    const spec = '# Idea\nx\n';
    expect(checkPlan(buildProblemSkeleton(spec), spec)).toEqual([]);
  });
});

describe('dependentsOf', () => {
  it('finds the dependents through other tasks', () => {
    const deps = dependentsOf(goodPlan().tasks, 'val');
    expect([...deps].sort()).toEqual(['gv', 'ver']);
  });
});

describe('addRecipeDependencies', () => {
  it('adds the order dependencies the manager left out', () => {
    const full = buildProblemSkeleton(SPEC);
    expect(checkPlan(full, SPEC)).toEqual([]);
    const verify = full.tasks.find(t => t.kind === 'verify')!;
    const critic = full.tasks.find(t => t.kind === 'statement_critic')!;
    const broken: Plan = {
      ...full,
      tasks: full.tasks.map(t =>
        t.id === verify.id
          ? { ...t, dependsOn: [t.dependsOn[0]] }
          : t.id === critic.id
            ? { ...t, dependsOn: [] }
            : t
      ),
    };
    expect(checkPlan(broken, SPEC).length).toBeGreaterThan(0);
    const fixed = addRecipeDependencies(broken);
    expect(checkPlan(fixed, SPEC)).toEqual([]);
    expect(
      new Set(fixed.tasks.find(t => t.id === verify.id)!.dependsOn)
    ).toEqual(
      new Set(full.tasks.filter(t => t.id !== verify.id).map(t => t.id))
    );
    // The input plan is not changed.
    expect(broken.tasks.find(t => t.id === critic.id)!.dependsOn).toEqual([]);
  });

  it('leaves a plan of an unknown recipe as it is', () => {
    const plan = { recipe: 'nope', tasks: [] } as unknown as Plan;
    expect(addRecipeDependencies(plan)).toBe(plan);
  });
});
