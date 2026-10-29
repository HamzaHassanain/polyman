/**
 * The contract of the workflow manager. The manager (the model) makes a plan,
 * the scheduler (our code) runs it, workers (the model) do one task each, and
 * checkpoints (our code) decide if a task passed.
 */

import type { SolutionTag } from '../../types';

/** The kinds of tasks a plan can have. */
export type TaskKind =
  | 'scaffold'
  | 'statement'
  | 'statement_critic'
  | 'main_solution'
  | 'brute_force'
  | 'wrong_solution'
  | 'validator'
  | 'generators'
  | 'checker'
  | 'generate_validate'
  | 'verify'
  | 'fix'
  | 'proto_brute'
  | 'proto_main'
  | 'proto_gen'
  | 'proto_wrong'
  | 'stress'
  | 'sample_check'
  | 'max_test'
  | 'kill_wrong'
  | 'ideate'
  | 'idea_critic'
  | 'idea_rank';

/** One task of a plan. */
export interface PlanTask {
  /** Like 't3'. */
  id: string;
  kind: TaskKind;
  /** Shown in the UI, like "Main solution: sort + two pointers". */
  title: string;
  /** Ids of the tasks that must pass first. */
  dependsOn: string[];
  /** What the manager wants, 1 to 5 lines. */
  brief: string;
  /** The only files this worker may write. */
  ownsFiles: string[];
  /** Extra details, like `{ approach: 'int overflow', tag: 'WA' }`. */
  params?: Record<string, string>;
}

/** A recipe filled in by the manager. */
export interface Plan {
  recipe:
    | 'build_problem'
    | 'fix_verify'
    | 'strengthen_tests'
    | 'prove_idea'
    | 'find_ideas';
  tasks: PlanTask[];
}

/** The problem spec: the text of `notes.md` (see SPEC-FORMAT.md). */
export type Spec = string;

/**
 * The only way workers change `Config.json`. The scheduler applies it, a
 * worker never writes `Config.json` itself. Names follow the template.
 */
export interface ConfigPatch {
  set?: { name?: string; timeLimit?: number; memoryLimit?: number };
  /** The scheduler fills `sourceType` from the file extension. */
  addSolutions?: { name: string; source: string; tag: SolutionTag }[];
  validator?: { name: string; source: string; testsFilePath?: string };
  generators?: { name: string; source: string }[];
  checker?:
    | { name: string; isStandard: true }
    | {
        name: string;
        isStandard: false;
        source: string;
        testsFilePath?: string;
      };
  statements?: Record<
    string,
    {
      encoding: 'UTF-8';
      name: string;
      legend: string;
      input: string;
      output: string;
      notes?: string;
    }
  >;
  generatorScript?: { testset: string; scriptFile: string };
  manualTests?: {
    testset: string;
    input: string;
    group?: string;
    useInStatements?: boolean;
  }[];
}

/** The outcome of a checkpoint: a real check run by our code. */
export interface Checkpoint {
  name: string;
  ok: boolean;
  /** A short error digest, the part the model reads. */
  digest: string;
}

/** The final state of one task. */
export interface TaskResult {
  taskId: string;
  status: 'passed' | 'failed' | 'skipped';
  attempts: number;
  /** 1 to 3 lines, this is all the manager reads. */
  summary: string;
  /** Applied by the scheduler, never by the worker. */
  configPatch?: ConfigPatch;
  checkpoint: Checkpoint;
}

/** What the manager decides when a task failed twice. */
export type ManagerDecision =
  | { action: 'retry_with_hint'; taskId: string; hint: string }
  | { action: 'redo_task'; taskId: string; redoTaskId: string; hint: string }
  | { action: 'ask_user'; taskId: string; question: string };

/** The model side of the workflow that plans and decides. */
export interface Manager {
  makePlan(
    spec: Spec,
    recipe: Plan['recipe'],
    signal: AbortSignal
  ): Promise<Plan>;
  decide(
    input: {
      spec: Spec;
      plan: Plan;
      failed: TaskResult;
      results: TaskResult[];
    },
    signal: AbortSignal
  ): Promise<ManagerDecision>;
}

/** What a worker reports when it is done with a task. */
export interface WorkerOutcome {
  summary: string;
  configPatch?: ConfigPatch;
  filesWritten: string[];
}

/** Does one task in a small session of its own. */
export interface Worker {
  run(
    input: {
      task: PlanTask;
      spec: Spec;
      attempt: number;
      /** What failed before, or the manager hint. */
      note?: string;
      /** True for a new session, false to continue the last one. */
      fresh: boolean;
    },
    signal: AbortSignal
  ): Promise<WorkerOutcome>;
}

/** Runs the real checks of each task kind. */
export interface Checkpoints {
  check(
    task: PlanTask,
    spec: Spec,
    problemDir: string,
    signal: AbortSignal
  ): Promise<Checkpoint>;
  /** Runs a task that needs no model, like `scaffold` or `verify`. */
  runNoModelTask(
    task: PlanTask,
    spec: Spec,
    problemDir: string,
    signal: AbortSignal
  ): Promise<{ checkpoint: Checkpoint; configPatch?: ConfigPatch }>;
}

/** Limits of one workflow run. */
export const WORKFLOW_LIMITS = {
  /** Tasks that run at the same time. */
  parallel: 4,
  /** Model calls of a worker on a simple task. */
  workerStepsSimple: 8,
  /** Model calls of a worker on a hard task. */
  workerStepsHard: 12,
  /** Fix rounds before the workflow gives up. */
  fixRounds: 3,
} as const;
