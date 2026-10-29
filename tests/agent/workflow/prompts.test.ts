import { describe, it, expect } from 'vitest';
import {
  NO_MODEL_KINDS,
  TASK_KINDS,
  chatSystemPrompt,
  managerDecidePrompt,
  managerPlanPrompt,
  recipeDescription,
  workerPrompt,
  workerSkills,
  wrongSolutionList,
} from '../../../src/agent/workflow/prompts';
import { skillNames } from '../../../src/agent/skills';
import type { TaskKind } from '../../../src/agent/workflow/types';

// Every kind of the contract, so a new kind fails here until it has a prompt.
const ALL_KINDS: Record<TaskKind, true> = {
  scaffold: true,
  statement: true,
  statement_critic: true,
  main_solution: true,
  brute_force: true,
  wrong_solution: true,
  validator: true,
  generators: true,
  checker: true,
  generate_validate: true,
  verify: true,
  fix: true,
  proto_brute: true,
  proto_main: true,
  proto_gen: true,
  proto_wrong: true,
  stress: true,
  sample_check: true,
  max_test: true,
  kill_wrong: true,
  ideate: true,
  idea_critic: true,
  idea_rank: true,
};

describe('worker prompts', () => {
  it('has the same kinds as the contract', () => {
    expect([...TASK_KINDS].sort()).toEqual(Object.keys(ALL_KINDS).sort());
  });

  it.each(TASK_KINDS)(
    '%s has a prompt with its check and the end tool',
    kind => {
      const p = workerPrompt(kind);
      expect(p).toMatch(/^You are a polyman worker/);
      expect(p).toMatch(/^Check: .+/m);
      expect(p).toMatch(/^Task: .+/m);
      expect(p).toMatch(/^Files you may write: .+/m);
      if (kind === 'statement_critic') {
        expect(p).toContain('review');
      } else {
        expect(p).toContain('finish_task');
      }
    }
  );

  it('names the skills to read first, and they exist', () => {
    const names = skillNames();
    expect(workerSkills('validator')).toEqual(['validator']);
    expect(workerSkills('generators')).toEqual([
      'generators',
      'generator-script',
    ]);
    expect(workerSkills('main_solution')).toEqual([
      'solutions',
      'cpp-performance',
    ]);
    expect(workerSkills('statement')).toEqual(['statements']);
    for (const kind of TASK_KINDS) {
      for (const s of workerSkills(kind)) {
        expect(names).toContain(s);
        expect(workerPrompt(kind)).toContain(`"name": "${s}"`);
      }
    }
  });

  it('has the hard rules of each kind', () => {
    expect(workerPrompt('main_solution')).toMatch(/C\+\+17/);
    expect(workerPrompt('main_solution')).not.toMatch(/run_solution/);
    expect(workerPrompt('main_solution')).toMatch(/call finish_task again/);
    expect(workerPrompt('main_solution')).toMatch(/64-bit/);
    expect(workerPrompt('brute_force')).toMatch(/simplest correct/);
    expect(workerPrompt('brute_force')).toMatch(/do not see the main/);
    expect(workerPrompt('wrong_solution')).toMatch(/params\.approach/);
    expect(workerPrompt('validator')).toMatch(/registerValidation/);
    expect(workerPrompt('validator')).toMatch(/readEoln/);
    expect(workerPrompt('validator')).toMatch(/readEof/);
    expect(workerPrompt('validator')).toMatch(/test validator/);
    expect(workerPrompt('generators')).toMatch(/registerGen/);
    expect(workerPrompt('generators')).toMatch(/max tests/);
    expect(workerPrompt('statement')).toMatch(/legend/);
    expect(workerPrompt('statement_critic')).toMatch(
      /review\(\{ ok, issues \}\)/
    );
    expect(workerPrompt('fix')).toMatch(/Never weaken a test/);
    expect(workerPrompt('proto_brute')).toMatch(/Never use the idea/);
    expect(workerPrompt('proto_main')).toMatch(/exactly the intended solution/);
    expect(workerPrompt('proto_gen')).toMatch(/argv\[1\] is the seed/);
    expect(workerPrompt('proto_gen')).toMatch(/Do not use testlib/);
    expect(workerPrompt('proto_wrong')).toMatch(/params\.approach/);
    for (const kind of NO_MODEL_KINDS) {
      expect(workerPrompt(kind)).toMatch(/polyman does this task itself/);
    }
  });
});

describe('manager prompts', () => {
  it('the plan prompt names submit_plan and the rules', () => {
    const p = managerPlanPrompt(
      'build_problem',
      recipeDescription('build_problem')
    );
    expect(p).toContain('submit_plan');
    expect(p).toMatch(/Do not invent task kinds/);
    expect(p).toMatch(/Each line gets exactly one wrong_solution task/);
    expect(p).toMatch(/verify dependsOn every other task id/);
    expect(p).toContain('solutions/main.cpp');
    expect(p).toContain('validator/val.cpp');
    expect(p).toContain('build_problem');
  });

  it('describes every recipe', () => {
    for (const r of [
      'build_problem',
      'fix_verify',
      'strengthen_tests',
      'prove_idea',
      'find_ideas',
    ] as const) {
      expect(recipeDescription(r)).toContain(`Recipe ${r}`);
    }
  });

  it('the decide prompt names decide and each action', () => {
    const p = managerDecidePrompt();
    expect(p).toContain('decide');
    expect(p).toContain('retry_with_hint');
    expect(p).toContain('redo_task');
    expect(p).toContain('ask_user');
  });
});

describe('chat prompt', () => {
  it('has the Think step, the spec format and the build rule', () => {
    const p = chatSystemPrompt({ problemDir: null });
    expect(p).toMatch(/^You are polyman/);
    expect(p).toContain('Think step');
    for (const h of [
      '# Idea',
      '# Constraints',
      '# Input',
      '# Output',
      '# Intended solution',
      '# Wrong approaches',
      '# Edge cases',
      '# Samples',
      '## Input 1',
      '## Output 1',
      '# Decisions',
    ]) {
      expect(p).toContain(h);
    }
    expect(p).toContain('.polyman/agent/notes.md');
    expect(p).toMatch(/create_problem.*start_workflow with recipe prove_idea/);
    expect(p).toMatch(
      /every check of it passed, call start_workflow with recipe build_problem/
    );
    expect(p).toMatch(/When prove_idea fails, do not build/);
    expect(p).toMatch(/problem ideas .* call find_ideas/);
    expect(p).toMatch(/Never think out loud/);
    expect(p).toContain('none yet');
    expect(chatSystemPrompt({ problemDir: '/x/pairs' })).toContain(
      'Problem folder: /x/pairs'
    );
  });

  it('sends Polygon work to the remote tools and keeps keys out', () => {
    const p = chatSystemPrompt({ problemDir: null });
    expect(p).toContain('remote_push');
    expect(p).toContain('remote_commit');
    expect(p).toContain('Never ask for, write or repeat API keys or secrets');
    expect(p).toContain('polyman remote register');
  });
});

describe('wrongSolutionList', () => {
  it('lists every wrong approach but the brute force, with its tag', () => {
    const spec = [
      '# Wrong approaches',
      '- sums kept in int (overflow) -> WA',
      '- brute force over all pairs -> TL',
      '- O(n^2) over all subarrays with prefix sums -> TL',
      '',
    ].join('\n');
    expect(wrongSolutionList(spec)).toBe(
      [
        'The plan needs exactly 2 wrong_solution tasks, one for each line here (the brute force is not in this list, brute_force covers it):',
        '1- params { approach: "sums kept in int (overflow)", tag: "WA" }',
        '2- params { approach: "O(n^2) over all subarrays with prefix sums", tag: "TL" }',
      ].join('\n')
    );
  });

  it('says when no wrong_solution task is needed', () => {
    expect(wrongSolutionList('# Idea\nsum\n')).toContain(
      'no wrong_solution task'
    );
  });
});
