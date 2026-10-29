import { useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ApprovalDecision } from '../../core/events.js';
import type { Plan, PlanTask, TaskKind } from '../../workflow/types.js';
import { WORKFLOW_LIMITS } from '../../workflow/types.js';
import { border, fg } from '../theme.js';
import { TaskTitle, titleWidth } from './PlanView.js';

/** Most task rows in the box. A bigger plan shows "+N more". */
const MAX_ROWS = 20;

/** Tasks our code runs without a model. */
const NO_MODEL: ReadonlySet<TaskKind> = new Set<TaskKind>([
  'scaffold',
  'generate_validate',
  'verify',
]);

/** The warning under the task rows. */
export const PLAN_WARNING =
  'Workers write only the files above, and the CLI runs the code they write.';

/** The deny reason of "Edit the plan", sent back to the model. */
export const EDIT_PLAN_REASON =
  'The user wants to change the plan. Ask what to change, then make a new plan.';

/** The options of the plan approval box. */
export const PLAN_OPTIONS: { label: string; decision: ApprovalDecision }[] = [
  { label: 'Run it', decision: { kind: 'allow_once' } },
  {
    label: 'Edit the plan',
    decision: { kind: 'deny', reason: EDIT_PLAN_REASON },
  },
  { label: 'Cancel', decision: { kind: 'deny' } },
];

/** The files column of a task row. */
export function filesOf(task: PlanTask): string {
  if (task.ownsFiles.length > 0) return task.ownsFiles.join(', ');
  return NO_MODEL.has(task.kind) ? 'no model, CLI only' : 'writes no files';
}

/**
 * The plan approval box (sample screen 2): recipe, problem, task count and
 * the parallel limit, one row per task with the files it may write, the
 * warning, and the options. Number keys, arrows and enter choose; esc
 * cancels.
 */
export function PlanApproval({
  approvalId,
  plan,
  problem,
  resolveApproval,
  isActive = true,
  maxRows = MAX_ROWS,
}: {
  approvalId: string;
  plan: Plan;
  problem: string | null;
  resolveApproval: (approvalId: string, decision: ApprovalDecision) => void;
  isActive?: boolean;
  /** Most task rows, less than 20 when the terminal is short. */
  maxRows?: number;
}) {
  const [selected, setSelectedState] = useState(0);
  // Keys can come faster than React renders: enter must see the newest arrow.
  const selectedRef = useRef(0);
  const setSelected = (next: number) => {
    selectedRef.current = next;
    setSelectedState(next);
  };
  const [answered, setAnswered] = useState(false);
  // Keys can come before React draws the answered box again, so a ref (not
  // the state) makes sure the plan is answered only once.
  const answeredRef = useRef(false);
  const count = PLAN_OPTIONS.length;

  const choose = (index: number) => {
    const option = PLAN_OPTIONS[index];
    if (!option || answeredRef.current) return;
    answeredRef.current = true;
    setAnswered(true);
    resolveApproval(approvalId, option.decision);
  };

  useInput(
    (input, key) => {
      if (key.ctrl || answeredRef.current) return;
      if (key.escape) {
        choose(count - 1);
      } else if (key.leftArrow || key.upArrow || (key.tab && key.shift)) {
        setSelected((selectedRef.current + count - 1) % count);
      } else if (key.rightArrow || key.downArrow || key.tab) {
        setSelected((selectedRef.current + 1) % count);
      } else if (key.return) {
        choose(selectedRef.current);
      } else if (/^[1-9]$/.test(input)) {
        choose(Number(input) - 1);
      }
    },
    { isActive: isActive && !answered }
  );

  const max = Math.max(1, Math.min(MAX_ROWS, maxRows));
  // The "+N more tasks" line takes one of the rows.
  const rows =
    plan.tasks.length > max
      ? plan.tasks.slice(0, Math.max(1, max - 1))
      : plan.tasks;
  const idWidth = Math.max(...plan.tasks.map(t => t.id.length), 2) + 2;
  const width = titleWidth(plan.tasks);
  const n = plan.tasks.length;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      {...border('agent')}
      paddingX={1}
      marginBottom={1}
    >
      <Text bold {...fg('agent')}>
        Run this plan?
      </Text>
      <Text wrap="truncate-end">
        {plan.recipe} · {problem ?? 'new problem'} · {n} task
        {n === 1 ? '' : 's'} · up to {WORKFLOW_LIMITS.parallel} in parallel
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {rows.map(task => (
          <Box key={task.id}>
            <Box width={idWidth} flexShrink={0}>
              <Text dimColor>{task.id}</Text>
            </Box>
            <Box width={width} flexShrink={0}>
              <TaskTitle task={task} />
            </Box>
            <Box flexGrow={1}>
              <Text dimColor wrap="truncate-end">
                {filesOf(task)}
              </Text>
            </Box>
          </Box>
        ))}
        {n > rows.length && (
          <Text dimColor>… +{n - rows.length} more tasks</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text {...fg('warn')}>{PLAN_WARNING}</Text>
      </Box>
      <Box marginTop={1}>
        {PLAN_OPTIONS.map((option, i) => (
          <Box key={i} marginRight={4}>
            <Text {...(i === selected ? fg('agent') : {})}>
              {i === selected ? '❯ ' : '  '}
              {i + 1}. {option.label}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
