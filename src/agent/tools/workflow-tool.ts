/**
 * The `start_workflow` tool: the chat agent hands the spec to the workflow
 * manager (doc 10). It reads the spec from the notes, builds a
 * {@link WorkflowScheduler} with the chat model as manager and workers, and runs it
 * inside the chat turn, so esc stops the whole workflow.
 */

import { AgentSession } from '../core/session';
import type { EventBus } from '../core/events';
import type { Provider } from '../providers/types';
import type { CliRunner } from '../runner/types';
import { skillTools } from '../skills';
import { CliCheckpoints, MemoCheckpoints } from '../workflow/checkpoints';
import { ModelManager } from '../workflow/manager';
import {
  WorkflowScheduler,
  type WorkflowRunResult,
} from '../workflow/scheduler';
import { parseSpec } from '../workflow/spec';
import type { Plan, Spec, TaskResult } from '../workflow/types';
import {
  checkpointPrecheck,
  ModelWorker,
  WORKER_CONTEXT_TOKENS,
} from '../workflow/worker';
import type { ChatBudgets } from '../providers/chat-provider';
import { cliTools } from './cli-tools';
import { fsTools } from './fs-tools';
import { specProblems } from './notes-tools';
import { DefaultPermissionGate } from './permissions';
import { DefaultToolRegistry } from './registry';
import { FolderSandbox } from './sandbox';
import type { PermissionGate, PermissionMode, Tool, ToolOutput } from './types';

/** Time limit of one whole workflow. */
export const WORKFLOW_TIMEOUT_MS = 30 * 60 * 1000;

/** The error when the spec is not ready. */
export const NO_SPEC_ERROR =
  'Write the spec first with write_notes (see the format in your instructions).';

/** Sections a spec must have before any workflow can start. */
const REQUIRED_SECTIONS = ['Idea', 'Constraints', 'Samples'] as const;

/** What the model is told after a workflow ends. */
export const AFTER_WORKFLOW =
  'The workflow is over. Tell the user the result in 2 or 3 lines. Do not write or fix problem files yourself: if something failed, ask the user if you should run start_workflow with recipe fix_verify.';

/** What the model is told after `prove_idea` passed. */
export const AFTER_PROOF_OK =
  'Every check passed: the idea is proven. If the user asked to build, call start_workflow with recipe build_problem now. Otherwise ask: "Should I build the problem?"';

/** What the model is told after `prove_idea` failed. */
export const AFTER_PROOF_FAILED =
  'Some checks failed: do not build. Tell the user what failed in 2 or 3 lines, with the counterexample. If a sample looks wrong and brute and main agree, fix the sample with write_notes. Then ask the user what to change.';

/** Most digest lines per task in the proof report. */
const REPORT_LINES = 8;

/** Each task of a proof, its status and its digest, for the model. */
export function proofReport(results: TaskResult[]): string {
  const icon = { passed: '✔', failed: '✗', skipped: '-' } as const;
  return results
    .map(r => {
      const digest = (r.checkpoint.digest.trim() || r.summary)
        .split('\n')
        .slice(0, REPORT_LINES);
      const [first = '', ...rest] = digest;
      return [
        `${icon[r.status]} ${r.taskId}: ${first}`,
        ...rest.map(l => `    ${l}`),
      ].join('\n');
    })
    .join('\n');
}

/** What the tool runs. `WorkflowScheduler` in the real chat. */
export interface WorkflowRunner {
  run(
    spec: Spec,
    recipe: Plan['recipe'],
    signal: AbortSignal
  ): Promise<WorkflowRunResult>;
}

/** What {@link workflowTool} needs. */
export interface WorkflowToolOptions {
  /** The spec text, '' when there is none. */
  readSpec(): Promise<string>;
  /** Builds the scheduler for one run in `problemDir`. */
  createScheduler(problemDir: string, runner: CliRunner): WorkflowRunner;
  /**
   * The chat gate. Approving the plan puts it in `plan-approved` mode; the
   * tool puts the old mode back when the workflow ends.
   */
  gate?: Pick<PermissionGate, 'mode' | 'setMode'>;
}

/** True when the spec has a non-empty Idea, Constraints and Samples. */
export function specIsReady(spec: string): boolean {
  const { sections } = parseSpec(spec);
  return REQUIRED_SECTIONS.every(name => (sections[name] ?? '').trim() !== '');
}

/**
 * Why the spec cannot start `recipe`, as lines for the model. build_problem
 * and prove_idea need the whole spec; the other recipes work on an existing
 * problem and need only the Idea, the Constraints and the Samples.
 */
export function workflowSpecProblems(
  spec: string,
  recipe: Plan['recipe']
): string[] {
  return recipe === 'build_problem' || recipe === 'prove_idea'
    ? specProblems(spec)
    : specProblems(spec, REQUIRED_SECTIONS).filter(p =>
        p.startsWith('missing')
      );
}

/** Runs `fn` and puts the gate's mode back after it, even on an error. */
async function keepingMode<T>(
  gate: WorkflowToolOptions['gate'],
  fn: () => Promise<T>
): Promise<T> {
  if (gate === undefined) return fn();
  const before: PermissionMode = gate.mode;
  try {
    return await fn();
  } finally {
    gate.setMode(before);
  }
}

/**
 * The `start_workflow` tool. Its risk is `run`: the user approves the plan
 * the manager makes, so asking for the tool call too would ask twice.
 */
export function workflowTool(
  opts: WorkflowToolOptions
): Tool<{ recipe: Plan['recipe'] }> {
  return {
    name: 'start_workflow',
    description:
      'Prove, build or fix the problem with a team of workers, from the spec in the notes. prove_idea checks the idea with quick programs (brute force against the intended solution on random tests, the samples, the time limit, the wrong approaches); build_problem builds every file (statement, solutions, validator, generators, checker, tests); fix_verify fixes a failing verify; strengthen_tests adds tests. Write the spec with write_notes and call create_problem first. The user approves the plan before any file is written.',
    parameters: {
      type: 'object',
      properties: {
        recipe: {
          type: 'string',
          enum: [
            'prove_idea',
            'build_problem',
            'fix_verify',
            'strengthen_tests',
          ],
          description: 'Which workflow to run.',
        },
      },
      required: ['recipe'],
      additionalProperties: false,
    },
    risk: 'run',
    needsProblem: true,
    timeoutMs: WORKFLOW_TIMEOUT_MS,
    describe: args => ({ title: `Start the ${args.recipe} workflow` }),
    async run(args, ctx): Promise<ToolOutput> {
      const spec = await opts.readSpec();
      const problems = workflowSpecProblems(spec, args.recipe);
      if (problems.length > 0) {
        return {
          content: [NO_SPEC_ERROR, ...problems.map(p => `- ${p}`)].join('\n'),
          isError: true,
        };
      }
      const problemDir = ctx.problemDir;
      if (problemDir === null) {
        return {
          content: 'There is no problem folder yet. Call create_problem first.',
          isError: true,
        };
      }
      const result = await keepingMode(opts.gate, () =>
        opts
          .createScheduler(problemDir, ctx.runner)
          .run(spec, args.recipe, ctx.signal)
      );
      if (args.recipe === 'prove_idea') {
        return {
          content: [
            result.summary,
            proofReport(result.results),
            result.ok ? AFTER_PROOF_OK : AFTER_PROOF_FAILED,
          ].join('\n'),
          ...(result.ok ? {} : { isError: true }),
          data: result.results,
        };
      }
      return {
        content: `${result.summary}\n${AFTER_WORKFLOW}`,
        ...(result.ok ? {} : { isError: true }),
        data: result.results,
      };
    },
  };
}

/** What the real scheduler needs from the chat. */
export interface ModelSchedulerOptions {
  provider: Provider;
  model: string;
  /** The chat bus: plan, task and usage events go to the UI. */
  bus: EventBus;
  /** The chat gate: it asks the user to approve the plan. */
  gate: PermissionGate;
  secrets(): string[];
  /**
   * The chat budgets for this model. The manager and the workers get its
   * max output; a worker gets its context budget when it is smaller than
   * {@link WORKER_CONTEXT_TOKENS}. Without it they use their defaults.
   */
  budgets?: Pick<ChatBudgets, 'maxOutputTokens' | 'contextBudgetTokens'>;
}

/**
 * The real {@link WorkflowToolOptions.createScheduler}: model manager and
 * workers, the real session, registry, sandbox and gate classes, and the
 * CLI checkpoints.
 */
export function modelSchedulerFactory(
  o: ModelSchedulerOptions
): WorkflowToolOptions['createScheduler'] {
  const budgets = o.budgets;
  return (problemDir, runner) => {
    // finish_task runs the check in the session; the memo skips the same
    // check in the scheduler when nothing changed since.
    const checkpoints = new MemoCheckpoints(new CliCheckpoints(runner));
    return new WorkflowScheduler({
      manager: new ModelManager({
        provider: o.provider,
        model: o.model,
        bus: o.bus,
        ...(budgets ? { maxOutputTokens: budgets.maxOutputTokens } : {}),
      }),
      worker: new ModelWorker({
        provider: o.provider,
        model: o.model,
        ...(budgets
          ? {
              maxOutputTokens: budgets.maxOutputTokens,
              contextBudgetTokens: Math.min(
                WORKER_CONTEXT_TOKENS,
                budgets.contextBudgetTokens
              ),
            }
          : {}),
        problemDir,
        runner,
        bus: o.bus,
        tools: [...fsTools(), ...cliTools(), ...skillTools()],
        createSession: deps => new AgentSession(deps),
        createRegistry: permissions => new DefaultToolRegistry({ permissions }),
        createSandbox: (root, allowWrite) =>
          new FolderSandbox(root, { allowWrite }),
        createGate: (bus, mode) => new DefaultPermissionGate(bus, mode),
        secrets: () => o.secrets(),
        precheck: checkpointPrecheck(checkpoints, problemDir),
      }),
      checkpoints,
      permissions: o.gate,
      bus: o.bus,
      problemDir,
    });
  };
}
