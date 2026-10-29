/**
 * The Gemma probe cases. Each case is one model call: a system prompt, a user
 * message, the tools the model sees, and a check that says if the answer is
 * correct. Tool names and shapes follow design/agent/04-harness.md ("First
 * tool list") and src/agent/workflow/types.ts.
 */

// ---------------------------------------------------------------------------
// Tool specs, as the model sees them.

const tool = (name, description, properties = {}, required = []) => ({
  name,
  description,
  parameters: {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  },
});

const T = {
  list_files: tool('list_files', 'List the files in a folder of the problem.', {
    path: { type: 'string', description: 'Folder, relative to the problem.' },
  }),
  read_file: tool(
    'read_file',
    'Read a file of the problem. Returns at most 2000 lines.',
    {
      path: { type: 'string', description: 'File, relative to the problem.' },
      offset: { type: 'integer', description: 'First line, 1-based.' },
      limit: { type: 'integer', description: 'Number of lines.' },
    },
    ['path']
  ),
  write_file: tool(
    'write_file',
    'Write a whole file of the problem. Creates or replaces it.',
    {
      path: { type: 'string', description: 'File, relative to the problem.' },
      content: { type: 'string', description: 'The full file content.' },
    },
    ['path', 'content']
  ),
  edit_file: tool(
    'edit_file',
    'Replace one exact piece of text in a file. old_text must match once.',
    {
      path: { type: 'string' },
      old_text: { type: 'string', description: 'Exact text to replace.' },
      new_text: { type: 'string', description: 'The new text.' },
    },
    ['path', 'old_text', 'new_text']
  ),
  read_config: tool('read_config', 'Read Config.json of the problem.'),
  generate: tool(
    'generate',
    'Run the generators and write the tests (polyman generate).',
    {
      all: { type: 'boolean', description: 'All testsets.' },
      testset: { type: 'string' },
    }
  ),
  run_solution: tool(
    'run_solution',
    'Compile a solution and run it on the tests (polyman run).',
    {
      name: { type: 'string', description: 'Solution name from Config.json.' },
      all: { type: 'boolean', description: 'Run on all tests.' },
      testset: { type: 'string' },
    },
    ['name']
  ),
  test_target: tool(
    'test_target',
    'Run the self tests of the validator, the checker or a solution.',
    {
      target: { type: 'string', enum: ['validator', 'checker', 'solution'] },
      name: { type: 'string', description: 'Solution name, for solution.' },
    },
    ['target']
  ),
  verify: tool(
    'verify',
    'Run the whole pipeline: generate, validate, run every solution, ' +
      'compare verdicts with tags (polyman verify).'
  ),
  submit_plan: tool(
    'submit_plan',
    'Submit the filled recipe as a plan of tasks.',
    {
      recipe: {
        type: 'string',
        enum: ['build_problem', 'fix_verify', 'strengthen_tests'],
      },
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: "Like 't3'." },
            kind: {
              type: 'string',
              enum: [
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
                'fix',
              ],
            },
            title: { type: 'string' },
            dependsOn: { type: 'array', items: { type: 'string' } },
            brief: { type: 'string', description: '1 to 5 lines.' },
            ownsFiles: { type: 'array', items: { type: 'string' } },
            params: {
              type: 'object',
              additionalProperties: { type: 'string' },
            },
          },
          required: ['id', 'kind', 'title', 'dependsOn', 'brief', 'ownsFiles'],
        },
      },
    },
    ['recipe', 'tasks']
  ),
  decide: tool(
    'decide',
    'Decide what to do with a task that failed twice.',
    {
      action: {
        type: 'string',
        enum: ['retry_with_hint', 'redo_task', 'ask_user'],
      },
      taskId: { type: 'string' },
      redoTaskId: { type: 'string', description: 'For redo_task.' },
      hint: { type: 'string', description: 'For retry_with_hint, redo_task.' },
      question: { type: 'string', description: 'For ask_user.' },
    },
    ['action', 'taskId']
  ),
};

/** Every tool name, for the "call written as text" check. */
export const TOOL_NAMES = Object.keys(T);

// ---------------------------------------------------------------------------
// Prompts.

const CHAT_SYSTEM = `You are polyman's agent. You help a Codeforces problem setter build and test one competitive programming problem in the current folder, using the tools.
Folder layout: Config.json, solutions/, generators/, validator/, checker/, statements/, manual/.
Solution tags: MA main correct, OK correct, WA wrong answer, TL time limit, TO TLE or OK, ML memory limit, RE runtime error, PE presentation error, RJ rejected.
Rules:
- Use the tools to act. Never write a tool call as text.
- Paths are relative to the problem folder.
- Validators, generators and checkers use testlib.h.
- Answer questions with text when no tool is needed. Be short.`;

const WORKER_SYSTEM = `You are a polyman worker. You do one task in a Codeforces problem folder, using the tools, then stop.
Validators and generators are C++17 and use testlib.h (registerValidation, registerGen, inf.readInt, rnd.next, ensuref).
Never write a tool call as text. Paths are relative to the problem folder.`;

const MANAGER_SYSTEM = `You are the polyman workflow manager. You never write code. You only call submit_plan or decide.
Task kinds: scaffold, statement, statement_critic, main_solution, brute_force, wrong_solution, validator, generators, checker, generate_validate, verify, fix.
Plan rules: exactly one main_solution, no dependency cycles, every file owned by at most one task, one wrong_solution task per wrong approach in the spec, workers never own Config.json.`;

const SPEC = `# pairs-sum
Idea: given n numbers and k, count pairs i < j with a_i + a_j = k.
Constraints: 1 <= n <= 2e5, 1 <= a_i <= 1e9, 1 <= k <= 2e9. Time 1 s, memory 256 MB.
Intended solution: hash map of counts, O(n). Answer fits in 64-bit.
Wrong approaches: (1) O(n^2) double loop (TL), (2) answer in 32-bit int (WA).
Output: one integer. Checker: ncmp.
Sample: input "4 5\\n1 4 2 3" output "2".`;

const VAL_CPP = `#include "testlib.h"

int main(int argc, char* argv[]) {
    registerValidation(argc, argv);
    int n = inf.readInt(1, 200000, "n");
    inf.readEoln();
    for (int i = 0; i < n; i++) {
        inf.readInt(0, 1000000000, "a_i");
        if (i + 1 < n) inf.readSpace();
    }
    inf.readEoln();
    inf.readEof();
}
`;

// ---------------------------------------------------------------------------
// Small helpers for the checks.

const norm = p => String(p ?? '').replace(/^\.\//, '');
const named = (calls, name) => calls.filter(c => c.name === name);
const args = c => (c.args && typeof c.args === 'object' ? c.args : {});
const lines = s => String(s ?? '').split('\n').length;

/**
 * Each check gets `{ calls, content }`: `calls` are the tool calls with
 * `args` parsed (after repair, or null when they do not parse), `content`
 * is the text of the answer. It returns true when the answer is correct.
 */
export const CASES = [
  {
    id: 'c01-verify',
    title: 'Run verify, with 6 tools',
    system: CHAT_SYSTEM,
    user: 'Run verify.',
    tools: [
      T.list_files,
      T.read_file,
      T.write_file,
      T.generate,
      T.run_solution,
      T.verify,
    ],
    check: ({ calls }) => calls.length === 1 && calls[0].name === 'verify',
  },
  {
    id: 'c02-read',
    title: 'Read one file',
    system: CHAT_SYSTEM,
    user: 'Read solutions/main.cpp',
    tools: [T.list_files, T.read_file, T.write_file, T.edit_file, T.verify],
    check: ({ calls }) =>
      calls.length === 1 &&
      calls[0].name === 'read_file' &&
      norm(args(calls[0]).path) === 'solutions/main.cpp',
  },
  {
    id: 'c03-write-validator',
    title: 'Write a validator',
    system: WORKER_SYSTEM,
    user:
      'Task: write the validator in validator/val.cpp. The input is n ' +
      '(1 <= n <= 2e5) on the first line, then n integers (1 <= a_i <= 1e9) ' +
      'on the second line, separated by spaces.',
    tools: [T.read_file, T.write_file, T.test_target],
    check: ({ calls }) =>
      named(calls, 'write_file').some(
        c =>
          norm(args(c).path) === 'validator/val.cpp' &&
          String(args(c).content ?? '').includes('registerValidation')
      ),
  },
  {
    id: 'c04-edit',
    title: 'Exact edit_file',
    system: WORKER_SYSTEM,
    user:
      'Fix the off by one: replace `readInt(0,` with `readInt(1,` in ' +
      'validator/val.cpp. This is the file now:\n\n```cpp\n' +
      VAL_CPP +
      '```',
    tools: [T.read_file, T.write_file, T.edit_file, T.test_target],
    check: ({ calls }) =>
      named(calls, 'edit_file').some(c => {
        const a = args(c);
        const oldText = String(a.old_text ?? '');
        if (norm(a.path) !== 'validator/val.cpp' || oldText === '') {
          return false;
        }
        if (VAL_CPP.split(oldText).length !== 2) return false; // matches once
        const after = VAL_CPP.replace(oldText, String(a.new_text ?? ''));
        return !after.includes('readInt(0,') && after.includes('readInt(1,');
      }),
  },
  {
    id: 'c05-two-reads',
    title: 'Two independent reads',
    system: CHAT_SYSTEM,
    user: 'Read solutions/main.cpp and validator/val.cpp, I want to see both.',
    tools: [T.list_files, T.read_file, T.write_file, T.verify],
    check: ({ calls }) => {
      const paths = named(calls, 'read_file').map(c => norm(args(c).path));
      const want = ['solutions/main.cpp', 'validator/val.cpp'];
      if (calls.length !== paths.length) return false;
      // Both at once (parallel), or one now and the other on the next step.
      if (paths.length === 2) return want.every(p => paths.includes(p));
      return paths.length === 1 && want.includes(paths[0]);
    },
  },
  {
    id: 'c06-plan',
    title: 'submit_plan for a small spec',
    system: MANAGER_SYSTEM,
    user:
      'Fill the build_problem recipe for this spec and submit the plan.\n\n' +
      SPEC,
    tools: [T.submit_plan, T.decide],
    check: ({ calls }) => {
      const c = named(calls, 'submit_plan')[0];
      const tasks = c && args(c).tasks;
      return (
        Array.isArray(tasks) &&
        tasks.length > 0 &&
        tasks.every(
          t =>
            t &&
            typeof t.kind === 'string' &&
            Array.isArray(t.dependsOn) &&
            Array.isArray(t.ownsFiles)
        )
      );
    },
  },
  {
    id: 'c07-decide',
    title: 'decide after a validator failed 3 times',
    system: MANAGER_SYSTEM,
    user: `The validator task failed 3 times. Decide what to do.

Plan: t1 scaffold, t2 statement, t3 main_solution, t4 brute_force, t5 validator (validator/val.cpp), t6 generators (generators/gen.cpp), t7 generate_validate.

Failed task result:
{"taskId":"t5","status":"failed","attempts":3,"summary":"Validator rejects the sample test.","checkpoint":{"name":"test validator","ok":false,"digest":"test 1 (sample '4 5\\n1 4 2 3'): expected VALID, got INVALID: Expected EOLN (line 1)"}}

Spec:
${SPEC}`,
    tools: [T.submit_plan, T.decide],
    check: ({ calls }) =>
      calls.length === 1 &&
      calls[0].name === 'decide' &&
      ['retry_with_hint', 'redo_task', 'ask_user'].includes(
        args(calls[0]).action
      ),
  },
  {
    id: 'c08-long-generator',
    title: 'Write a 150-line generator (long JSON)',
    system: WORKER_SYSTEM,
    user:
      'Task: write generators/gen.cpp, a testlib generator for pairs-sum, ' +
      'about 150 lines. Input: n and k on the first line, then n integers. ' +
      'Constraints: 1 <= n <= 2e5, 1 <= a_i <= 1e9, 1 <= k <= 2e9. Support ' +
      'these modes by the first argument: random, all-equal, many-pairs, ' +
      'no-pairs, max-answer (all a_i = k/2), small, and big values near 1e9. ' +
      'Add a helper function per mode and comments. Write the whole file ' +
      'with one write_file call.',
    tools: [T.read_file, T.write_file, T.generate],
    maxTokens: 8000,
    check: ({ calls }) =>
      named(calls, 'write_file').some(
        c =>
          norm(args(c).path) === 'generators/gen.cpp' &&
          String(args(c).content ?? '').includes('registerGen') &&
          lines(args(c).content) >= 80
      ),
  },
  {
    id: 'c09-no-tool',
    title: 'Trap: a question that needs no tool',
    system: CHAT_SYSTEM,
    user: 'what does TO mean?',
    tools: [T.list_files, T.read_file, T.read_config, T.verify],
    check: ({ calls, content }) =>
      calls.length === 0 && /TLE|time limit/i.test(content ?? ''),
  },
  {
    id: 'c10-call-as-text',
    title: 'Trap: asks for "the exact tool call"',
    system: CHAT_SYSTEM,
    user:
      'Run main.cpp on all the tests. Give me the exact tool call you use ' +
      'for it.',
    tools: [T.list_files, T.read_file, T.run_solution, T.verify],
    // Correct only as a real tool call, not as text in the answer.
    check: ({ calls }) =>
      named(calls, 'run_solution').length === 1 &&
      /main/.test(String(args(named(calls, 'run_solution')[0]).name ?? '')),
  },
];
