/**
 * Recipes are the fixed plan shapes of the workflow manager (doc 10). The
 * manager fills a recipe into a plan, {@link checkPlan} checks it before the
 * user sees it, and {@link buildProblemSkeleton} is the default plan when
 * the manager fails twice.
 */

import { parseSpec, wrongSolutionApproaches } from './spec';
import type { Plan, PlanTask, Spec, TaskKind } from './types';

/** The shape of one recipe. */
export interface Recipe {
  /** Task kinds a plan of this recipe may have. */
  kinds: TaskKind[];
  /** Kinds the plan must have at least once. */
  required: TaskKind[];
  /**
   * For a kind, the kinds that must come before it (directly or through
   * other tasks). `'*'` means every other task of the plan.
   */
  after: Partial<Record<TaskKind, TaskKind[] | '*'>>;
}

/** Kinds our code runs without a model. They own no files. */
export const NO_MODEL_KINDS: readonly TaskKind[] = [
  'scaffold',
  'checker',
  'generate_validate',
  'verify',
  'stress',
  'sample_check',
  'max_test',
  'kill_wrong',
  'idea_rank',
];

/**
 * The checks of `prove_idea`. Their result is the answer, not an error to
 * fix: a failed one ends at once, with no retry and no manager.
 */
export const PROVE_CHECK_KINDS: readonly TaskKind[] = [
  'stress',
  'sample_check',
  'max_test',
  'kill_wrong',
];

/** True for a check of `prove_idea`. */
export function isProveCheck(kind: TaskKind): boolean {
  return PROVE_CHECK_KINDS.includes(kind);
}

/** Where `prove_idea` writes its quick programs, inside the problem. */
export const PROVE_DIR = '.polyman/agent/prove';

/**
 * Kinds whose worker must write a file: with no owned file it cannot, and
 * its check would run the template's files.
 */
export const MUST_OWN_FILES: readonly TaskKind[] = [
  'statement',
  'main_solution',
  'brute_force',
  'wrong_solution',
  'validator',
  'generators',
  'proto_brute',
  'proto_main',
  'proto_gen',
  'proto_wrong',
];

/** True when our code runs the task, not a worker. */
export function isNoModelKind(kind: TaskKind): boolean {
  return NO_MODEL_KINDS.includes(kind);
}

/** The recipes, by name. */
export const RECIPES: Record<Plan['recipe'], Recipe> = {
  build_problem: {
    kinds: [
      'scaffold',
      'statement',
      'statement_critic',
      'main_solution',
      'brute_force',
      'wrong_solution',
      'validator',
      'generators',
      'checker',
      'generate_validate',
      'verify',
    ],
    required: [
      'scaffold',
      'statement',
      'main_solution',
      'brute_force',
      'validator',
      'generators',
      'checker',
      'generate_validate',
      'verify',
    ],
    after: {
      statement: ['scaffold'],
      main_solution: ['scaffold'],
      brute_force: ['scaffold'],
      validator: ['scaffold'],
      generators: ['scaffold'],
      wrong_solution: ['scaffold'],
      checker: ['scaffold'],
      statement_critic: ['statement'],
      generate_validate: ['validator', 'generators'],
      verify: '*',
    },
  },
  fix_verify: {
    kinds: ['verify', 'fix'],
    required: ['verify'],
    after: {},
  },
  strengthen_tests: {
    kinds: ['generators', 'generate_validate', 'verify'],
    required: ['verify'],
    after: {
      generate_validate: ['generators'],
      verify: '*',
    },
  },
  prove_idea: {
    kinds: [
      'proto_brute',
      'proto_main',
      'proto_gen',
      'proto_wrong',
      'stress',
      'sample_check',
      'max_test',
      'kill_wrong',
    ],
    required: ['proto_brute', 'proto_main', 'proto_gen', 'stress'],
    after: {
      stress: ['proto_brute', 'proto_main', 'proto_gen'],
      sample_check: ['proto_brute', 'proto_main'],
      max_test: ['proto_main', 'proto_gen'],
      kill_wrong: ['stress'],
    },
  },
  find_ideas: {
    kinds: ['ideate', 'idea_critic', 'idea_rank'],
    required: ['ideate', 'idea_critic', 'idea_rank'],
    after: { idea_critic: ['ideate'], idea_rank: '*' },
  },
};

/** Finds a cycle and returns its ids in order, like `[t1, t2, t1]`. */
function findCycle(tasks: PlanTask[]): string[] | null {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  const visit = (id: string): string[] | null => {
    if (state.get(id) === 'done') return null;
    if (state.get(id) === 'visiting') {
      return [...stack.slice(stack.indexOf(id)), id];
    }
    state.set(id, 'visiting');
    stack.push(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (!byId.has(dep)) continue;
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  };

  for (const task of tasks) {
    const cycle = visit(task.id);
    if (cycle) return cycle;
  }
  return null;
}

/** Every task id the given task depends on, directly or not. */
export function ancestorsOf(tasks: PlanTask[], id: string): Set<string> {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const seen = new Set<string>();
  const todo = [...(byId.get(id)?.dependsOn ?? [])];
  while (todo.length > 0) {
    const next = todo.pop()!;
    if (seen.has(next)) continue;
    seen.add(next);
    todo.push(...(byId.get(next)?.dependsOn ?? []));
  }
  return seen;
}

/** Every task id that depends on the given task, directly or not. */
export function dependentsOf(tasks: PlanTask[], id: string): Set<string> {
  const seen = new Set<string>();
  const todo = [id];
  while (todo.length > 0) {
    const current = todo.pop()!;
    for (const task of tasks) {
      if (task.dependsOn.includes(current) && !seen.has(task.id)) {
        seen.add(task.id);
        todo.push(task.id);
      }
    }
  }
  return seen;
}

/**
 * Adds the order dependencies the recipe asks for when the manager left them
 * out (like verify not depending on every task). These are fixed rules, so
 * there is nothing for the model to decide; the other plan checks still run.
 * Returns a new plan.
 */
export function addRecipeDependencies(plan: Plan): Plan {
  const recipe = (RECIPES as Partial<Record<string, Recipe>>)[plan.recipe];
  if (!recipe) return plan;
  const tasks = plan.tasks.map(t => ({ ...t, dependsOn: [...t.dependsOn] }));
  for (const task of tasks) {
    const rule = recipe.after[task.kind];
    if (!rule) continue;
    for (const other of tasks) {
      if (other.id === task.id) continue;
      const needed =
        rule === '*' ? other.kind !== task.kind : rule.includes(other.kind);
      if (needed && !task.dependsOn.includes(other.id)) {
        task.dependsOn.push(other.id);
      }
    }
  }
  return { ...plan, tasks };
}

/**
 * Checks a plan against its recipe and the spec. Returns the errors, an
 * empty list means the plan is ok. The errors are short and exact, the
 * manager reads them on its second try.
 */
export function checkPlan(plan: Plan, spec: Spec): string[] {
  const recipe = (RECIPES as Partial<Record<string, Recipe>>)[plan.recipe];
  if (!recipe) return [`unknown recipe: ${String(plan.recipe)}`];
  const errors: string[] = [];
  const tasks = plan.tasks;

  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) errors.push(`duplicate task id: ${task.id}`);
    ids.add(task.id);
  }

  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (!ids.has(dep)) {
        errors.push(`task ${task.id} depends on unknown task ${dep}`);
      }
    }
  }

  const cycle = findCycle(tasks);
  if (cycle) errors.push(`dependency cycle: ${cycle.join(' -> ')}`);

  for (const task of tasks) {
    if (!recipe.kinds.includes(task.kind)) {
      errors.push(
        `task ${task.id}: kind ${task.kind} is not allowed in ${plan.recipe}`
      );
    }
  }

  for (const kind of recipe.required) {
    if (!tasks.some(t => t.kind === kind)) {
      errors.push(`missing a ${kind} task`);
    }
  }

  if (recipe.kinds.includes('main_solution')) {
    const mains = tasks.filter(t => t.kind === 'main_solution').length;
    if (mains !== 1) {
      errors.push(`need exactly one main_solution task, found ${mains}`);
    }
  }

  for (const task of tasks) {
    if (MUST_OWN_FILES.includes(task.kind) && task.ownsFiles.length === 0) {
      errors.push(
        `task ${task.id} (${task.kind}) writes files and must own at least one`
      );
    }
  }

  const owners = new Map<string, string>();
  for (const task of tasks) {
    if (isNoModelKind(task.kind) && task.ownsFiles.length > 0) {
      errors.push(
        `task ${task.id} (${task.kind}) runs without a model and must own no files`
      );
    }
    for (const file of task.ownsFiles) {
      const key = normalizePath(file);
      const owner = owners.get(key);
      if (owner !== undefined && owner !== task.id) {
        errors.push(`file ${file} is owned by both ${owner} and ${task.id}`);
      } else {
        owners.set(key, task.id);
      }
    }
  }

  // Order rules only make sense on a graph without a cycle.
  if (!cycle) {
    for (const task of tasks) {
      const rule = recipe.after[task.kind];
      if (!rule) continue;
      const ancestors = ancestorsOf(tasks, task.id);
      const needed = tasks.filter(
        other =>
          other.id !== task.id &&
          (rule === '*' ? other.kind !== task.kind : rule.includes(other.kind))
      );
      const missing = needed.filter(other => !ancestors.has(other.id));
      if (missing.length > 0) {
        errors.push(
          `task ${task.id} (${task.kind}) must come after ${missing.map(m => m.id).join(', ')}`
        );
      }
    }
  }

  if (plan.recipe === 'build_problem') {
    const expected = wrongSolutionApproaches(parseSpec(spec)).length;
    const found = tasks.filter(t => t.kind === 'wrong_solution').length;
    if (found !== expected) {
      errors.push(
        `the spec has ${expected} wrong approaches (without the brute force), the plan has ${found} wrong_solution tasks`
      );
    }
  }

  return errors;
}

/** `./solutions/a.cpp` and `solutions/a.cpp` are the same file. */
export function normalizePath(file: string): string {
  return file.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

/**
 * A valid `build_problem` plan made from the spec alone, used when the
 * manager fails twice.
 */
export function buildProblemSkeleton(spec: Spec): Plan {
  const wrong = wrongSolutionApproaches(parseSpec(spec));
  const tasks: PlanTask[] = [
    {
      id: 't1',
      kind: 'scaffold',
      title: 'Scaffold',
      dependsOn: [],
      brief: 'Check Config.json and set the limits from the spec.',
      ownsFiles: [],
    },
    {
      id: 't2',
      kind: 'statement',
      title: 'Statement',
      dependsOn: ['t1'],
      brief: 'Write the legend, input, output and notes from the spec.',
      ownsFiles: [
        'statements/english/legend.tex',
        'statements/english/input-format.tex',
        'statements/english/output-format.tex',
        'statements/english/notes.tex',
      ],
    },
    {
      id: 't3',
      kind: 'statement_critic',
      title: 'Statement critic',
      dependsOn: ['t2'],
      brief: 'Check the statement against the spec.',
      ownsFiles: [],
    },
    {
      id: 't4',
      kind: 'main_solution',
      title: 'Main solution',
      dependsOn: ['t1'],
      brief: 'Write the intended solution from the spec.',
      ownsFiles: ['solutions/main.cpp'],
      params: { tag: 'MA' },
    },
    {
      id: 't5',
      kind: 'brute_force',
      title: 'Brute force',
      dependsOn: ['t1'],
      brief: 'Write a simple brute force, correct but slow.',
      ownsFiles: ['solutions/brute.cpp'],
      params: { tag: 'TO' },
    },
    {
      id: 't6',
      kind: 'validator',
      title: 'Validator',
      dependsOn: ['t1'],
      brief: 'Write the validator from the constraints, with self-tests.',
      ownsFiles: ['validator/val.cpp', 'validator/validator_tests.json'],
    },
    {
      id: 't7',
      kind: 'generators',
      title: 'Generators',
      dependsOn: ['t1'],
      brief:
        'Write a random generator and a script that covers the edge cases.',
      ownsFiles: ['generators/gen-random.cpp', 'generators/gen-script.txt'],
    },
    {
      id: 't8',
      kind: 'checker',
      title: 'Checker',
      dependsOn: ['t1'],
      brief: 'Pick a standard checker from the output format.',
      ownsFiles: [],
    },
  ];

  wrong.forEach((approach, i) => {
    tasks.push({
      id: `t${9 + i}`,
      kind: 'wrong_solution',
      title: `Wrong solution: ${approach.text}`,
      dependsOn: ['t1'],
      brief: `Write a solution with this mistake: ${approach.text}. Expected verdict ${approach.verdict}.`,
      ownsFiles: [`solutions/wa-${i + 1}.cpp`],
      params: { approach: approach.text, tag: approach.verdict },
    });
  });

  const gvId = `t${9 + wrong.length}`;
  tasks.push({
    id: gvId,
    kind: 'generate_validate',
    title: 'Generate and validate tests',
    dependsOn: ['t6', 't7'],
    brief: 'Generate all tests and validate them.',
    ownsFiles: [],
  });
  tasks.push({
    id: `t${10 + wrong.length}`,
    kind: 'verify',
    title: 'Verify',
    dependsOn: tasks.map(t => t.id),
    brief: 'Run polyman verify.',
    ownsFiles: [],
  });

  return { recipe: 'build_problem', tasks };
}

/**
 * The plan of `fix_verify`: one verify task, the scheduler adds the fix
 * rounds. There is nothing for the manager to fill in (Gemma gave a whole
 * build_problem plan for it, twice, and the recipe failed).
 */
export function fixVerifyPlan(): Plan {
  return {
    recipe: 'fix_verify',
    tasks: [
      {
        id: 't1',
        kind: 'verify',
        title: 'Verify',
        dependsOn: [],
        brief: 'Run polyman verify. polyman fixes it when it fails.',
        ownsFiles: [],
      },
    ],
  };
}

/**
 * A valid `strengthen_tests` plan, used when the manager fails twice: one
 * generator task that may add a generator and change the script.
 */
export function strengthenTestsSkeleton(scriptFile: string): Plan {
  return {
    recipe: 'strengthen_tests',
    tasks: [
      {
        id: 't1',
        kind: 'generators',
        title: 'Stronger tests',
        dependsOn: [],
        brief:
          'verify shows wrong solutions that pass every test. Add a generator or script lines whose tests break them. Keep the old tests.',
        ownsFiles: ['generators/gen-strong.cpp', normalizePath(scriptFile)],
      },
      {
        id: 't2',
        kind: 'generate_validate',
        title: 'Generate and validate tests',
        dependsOn: ['t1'],
        brief: 'Generate all tests and validate them.',
        ownsFiles: [],
      },
      {
        id: 't3',
        kind: 'verify',
        title: 'Verify',
        dependsOn: ['t1', 't2'],
        brief: 'Run polyman verify.',
        ownsFiles: [],
      },
    ],
  };
}

/**
 * The plan of `prove_idea`, made from the spec with no model call. Quick
 * programs (a brute force, the intended solution, a random generator, one
 * per wrong approach), then the checks our code runs on them:
 * - stress: brute and main agree on many small random tests;
 * - sample_check: the samples of the spec match both;
 * - max_test: main runs a max test in the time limit;
 * - kill_wrong: each wrong approach really fails, after the stress test,
 *   so main can be trusted as the answer.
 * An ML approach gets no task: memory is not measured here.
 */
export function proveIdeaPlan(spec: Spec): Plan {
  const file = (name: string): string => `${PROVE_DIR}/${name}`;
  const tasks: PlanTask[] = [
    {
      id: 'brute',
      kind: 'proto_brute',
      title: 'Brute force',
      dependsOn: [],
      brief:
        'Write the simplest correct solution, it may be very slow. It is the judge of the intended solution.',
      ownsFiles: [file('brute.cpp')],
    },
    {
      id: 'main',
      kind: 'proto_main',
      title: 'Intended solution',
      dependsOn: [],
      brief: 'Write the intended solution of the spec, nothing else.',
      ownsFiles: [file('main.cpp')],
    },
    {
      id: 'gen',
      kind: 'proto_gen',
      title: 'Random tests',
      dependsOn: [],
      brief:
        'Write a random generator: "gen <seed> small" for tiny tests, "gen <seed> max" for the biggest ones.',
      ownsFiles: [file('gen.cpp')],
    },
  ];
  const kills: PlanTask[] = [];
  let n = 0;
  for (const approach of parseSpec(spec).wrongApproaches) {
    if (approach.verdict === 'ML') continue;
    const params = { approach: approach.text, tag: approach.verdict };
    if (approach.isBruteForce) {
      kills.push({
        id: 'kill-brute',
        kind: 'kill_wrong',
        title: `Kill: ${approach.text} (TL)`,
        dependsOn: ['brute', 'main', 'gen', 'stress'],
        brief: 'The brute force must be too slow on a max test.',
        ownsFiles: [],
        params: { ...params, file: file('brute.cpp') },
      });
      continue;
    }
    n++;
    tasks.push({
      id: `wrong-${n}`,
      kind: 'proto_wrong',
      title: `Wrong: ${approach.text} (${approach.verdict})`,
      dependsOn: [],
      brief: `Write a solution with only this mistake: ${approach.text}.`,
      ownsFiles: [file(`wrong-${n}.cpp`)],
      params,
    });
    kills.push({
      id: `kill-${n}`,
      kind: 'kill_wrong',
      title: `Kill: ${approach.text} (${approach.verdict})`,
      dependsOn: [`wrong-${n}`, 'main', 'gen', 'stress'],
      brief: `The tests must catch it with ${approach.verdict}.`,
      ownsFiles: [],
      params: { ...params, file: file(`wrong-${n}.cpp`) },
    });
  }
  tasks.push(
    {
      id: 'stress',
      kind: 'stress',
      title: 'Stress: brute = main',
      dependsOn: ['brute', 'main', 'gen'],
      brief: 'Brute and main must agree on every small random test.',
      ownsFiles: [],
    },
    {
      id: 'samples',
      kind: 'sample_check',
      title: 'Samples',
      dependsOn: ['brute', 'main'],
      brief: 'The samples of the spec must match brute and main.',
      ownsFiles: [],
    },
    {
      id: 'max-test',
      kind: 'max_test',
      title: 'Max test in the time limit',
      dependsOn: ['main', 'gen'],
      brief: 'Main must run the max tests in the time limit.',
      ownsFiles: [],
    },
    ...kills
  );
  return { recipe: 'prove_idea', tasks };
}
