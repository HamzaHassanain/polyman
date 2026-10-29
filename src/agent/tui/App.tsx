import path from 'node:path';
import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import type { ApprovalDecision, EventBus } from '../core/events.js';
import type { AgentSessionApi } from '../core/session-types.js';
import { looksLikePolygonKey, PASTED_KEY_NOTICE } from '../core/pasted-key.js';
import type { PermissionMode } from '../tools/types.js';
import { initialState, pickTask, reduce } from './store.js';
import { EMPTY_EDITOR, History, type EditorState } from './editor.js';
import {
  appKeyOf,
  AUTO_EDIT_NOTICE,
  BUSY_HINT,
  CTRL_C_HINT,
  CTRL_C_WINDOW_MS,
  CtrlCTracker,
  HELP_TEXT,
  nextMode,
  parseCommand,
} from './keybindings.js';
import { ApprovalPrompt } from './components/ApprovalPrompt.js';
import { Composer } from './components/Composer.js';
import { LiveArea } from './components/LiveArea.js';
import { EDIT_PLAN_REASON, PlanApproval } from './components/PlanApproval.js';
import { PlanView, TaskDetails } from './components/PlanView.js';
import { StatusLine } from './components/StatusLine.js';
import { Transcript } from './components/Transcript.js';
import { fg } from './theme.js';
import { liveBudget, sizeOf, visualLines } from './layout.js';

/** The terminal size, updated when the window is resized. */
function useTerminalSize(): { columns: number; rows: number } {
  const { stdout } = useStdout();
  const [size, setSize] = useState(() => sizeOf(stdout));
  useEffect(() => {
    const onResize = () => setSize(sizeOf(stdout));
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);
  return size;
}

/** What the chat shows about itself in the header and the status line. */
export interface TuiInfo {
  /** The problem folder name, or null for a new problem. */
  problem: string | null;
  /** The model id, like `google/gemma-4-31b-it`. */
  model: string;
  /** The provider name shown next to the model, `OpenRouter` by default. */
  provider?: string;
  /** The permission mode at start, `ask` by default. */
  mode?: PermissionMode;
  /** Called when the user switches the mode (shift+tab). */
  setMode?: (mode: PermissionMode) => void;
}

export interface AppProps {
  session: AgentSessionApi;
  bus: EventBus;
  info: TuiInfo;
  /** Called on ctrl+z, before the app exits, so the caller can force it. */
  onForceExit?: () => void;
}

/** Clears the screen and the scrollback, and moves the cursor home. */
export const CLEAR_TERMINAL = '\u001B[2J\u001B[3J\u001B[H';

/** How long the width must stay the same before we draw everything again. */
export const RESIZE_SETTLE_MS = 150;

/**
 * A number that grows when the terminal width changed and stayed for
 * {@link RESIZE_SETTLE_MS}. The screen is cleared at the same time.
 *
 * When the width gets smaller, the terminal wraps the old wide lines into
 * more lines than Ink erases, and the lines in the scrollback keep the old
 * width. So, like Claude Code, we clear everything and print the transcript
 * again (the caller remounts `<Static>` with this number as its key).
 */
function useRedrawOnResize(columns: number): number {
  const { stdout } = useStdout();
  const [generation, setGeneration] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => {
      if (stdout.isTTY) stdout.write(CLEAR_TERMINAL);
      setGeneration(g => g + 1);
    }, RESIZE_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [columns, stdout]);
  return generation;
}

/** The chat: transcript, live area, approval, input and status line. */
export function App({ session, bus, info, onForceExit }: AppProps) {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();
  const generation = useRedrawOnResize(columns);
  const [state, dispatch] = useReducer(reduce, info, initialState);
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR);
  const [hint, setHint] = useState<string | null>(null);
  // On exit the live part is drawn empty first, so the input box and the
  // status line do not stay in the scrollback above "Bye.".
  const [exiting, setExiting] = useState(false);
  // The task whose details are open (ctrl+o), an index into the plan tasks.
  const [details, setDetailsState] = useState<number | null>(null);
  const detailsRef = useRef<number | null>(null);
  const setDetails = (next: number | null) => {
    detailsRef.current = next;
    setDetailsState(next);
  };
  const history = useRef(new History()).current;
  const ctrlC = useRef(new CtrlCTracker()).current;
  // Keys can come faster than React renders: handlers read the newest state.
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => bus.on(e => dispatch(e)), [bus]);

  useEffect(() => {
    if (exiting) exit();
  }, [exiting, exit]);

  // The details close with the workflow.
  const hasWorkflow = state.workflow !== null;
  useEffect(() => {
    if (!hasWorkflow) {
      detailsRef.current = null;
      setDetailsState(null);
    }
  }, [hasWorkflow]);

  // The busy hint is gone when the turn is over.
  const busy = state.status.busy;
  useEffect(() => {
    if (!busy) setHint(h => (h === BUSY_HINT ? null : h));
  }, [busy]);

  // The ctrl+c hint is true for one second only.
  useEffect(() => {
    if (hint !== CTRL_C_HINT) return;
    const timer = setTimeout(() => setHint(null), CTRL_C_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [hint]);

  const changeEditor = (next: EditorState) => {
    setHint(null);
    setEditor(next);
  };

  const submit = (raw: string) => {
    const text = raw.trim();
    if (text.length === 0) return;
    const command = parseCommand(text);
    if (command) {
      setEditor(EMPTY_EDITOR);
      history.add(raw);
      if (command.name === 'help') {
        dispatch({ type: 'notice', text: HELP_TEXT });
      } else {
        dispatch({
          type: 'notice',
          level: 'warn',
          text: `Unknown command /${command.name}. Type /help for the commands.`,
        });
      }
      return;
    }
    if (looksLikePolygonKey(text)) {
      // Not sent to the model and not kept in the history.
      setEditor(EMPTY_EDITOR);
      dispatch({ type: 'notice', level: 'warn', text: PASTED_KEY_NOTICE });
      return;
    }
    if (stateRef.current.status.busy) {
      setHint(BUSY_HINT);
      return;
    }
    setEditor(EMPTY_EDITOR);
    setHint(null);
    history.add(raw);
    // Mark busy now, so a second enter cannot send before turn_start.
    stateRef.current = reduce(stateRef.current, { type: 'user_message', text });
    dispatch({ type: 'user_message', text });
    void session
      .send(text)
      .catch((err: unknown) => {
        dispatch({
          type: 'notice',
          level: 'error',
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        });
      })
      .finally(() => dispatch({ type: 'turn_settled' }));
  };

  const switchMode = () => {
    const mode = nextMode(stateRef.current.status.mode);
    stateRef.current = reduce(stateRef.current, { type: 'set_mode', mode });
    dispatch({ type: 'set_mode', mode });
    info.setMode?.(mode);
    if (mode === 'auto-edit') {
      dispatch({ type: 'notice', level: 'warn', text: AUTO_EDIT_NOTICE });
    }
  };

  const interrupt = () => {
    if (stateRef.current.status.busy) session.cancel();
  };

  const toggleDetails = () => {
    const s = stateRef.current;
    if (detailsRef.current !== null) {
      setDetails(null);
    } else if (s.workflow && !s.planApproval && !s.approval) {
      setDetails(pickTask(s.workflow));
    }
  };

  const moveDetails = (step: number) => {
    const wf = stateRef.current.workflow;
    const at = detailsRef.current;
    if (!wf || at === null) return;
    const n = wf.plan.tasks.length;
    setDetails((at + step + n) % n);
  };

  useInput((input, key) => {
    const action = appKeyOf(input, key);
    if (action === 'ctrl_c') {
      if (ctrlC.press(Date.now()) === 'exit') {
        if (stateRef.current.status.busy) session.cancel();
        setExiting(true);
        return;
      }
      setEditor(EMPTY_EDITOR);
      setHint(CTRL_C_HINT);
    } else if (action === 'force_exit') {
      session.cancel();
      onForceExit?.();
      setExiting(true);
    } else if (action === 'toggle_mode') {
      switchMode();
    } else if (action === 'toggle_details') {
      toggleDetails();
    } else if (action === 'interrupt') {
      const s = stateRef.current;
      // With an approval box open, the box handles esc.
      if (s.approval || s.planApproval) return;
      if (detailsRef.current !== null) {
        setDetails(null);
      } else {
        interrupt();
      }
    } else if (detailsRef.current !== null && !stateRef.current.approval) {
      if (key.upArrow) moveDetails(-1);
      else if (key.downArrow) moveDetails(1);
    }
  });

  const answer = (approvalId: string, decision: ApprovalDecision) => {
    session.resolveApproval(approvalId, decision);
    dispatch({ type: 'approval_answered', approvalId, decision });
  };

  const answerPlan = (approvalId: string, decision: ApprovalDecision) => {
    answer(approvalId, decision);
    if (decision.reason === EDIT_PLAN_REASON) {
      dispatch({
        type: 'notice',
        text: 'The plan did not run. Type what to change, and the agent makes a new plan.',
      });
    }
  };

  const showPlan = state.workflow !== null && state.planApproval === null;
  const promptKind = state.approval
    ? 'approval'
    : state.planApproval
      ? 'plan'
      : details !== null && state.workflow
        ? 'details'
        : null;
  const running = state.live.runningTools;
  const budget = liveBudget({
    rows,
    toolLines: running.reduce((n, t) => n + (t.lastLine === null ? 2 : 3), 0),
    workingLines: state.status.busy ? 2 : 0,
    hintLines: hint === BUSY_HINT ? 1 : 0,
    inputLines:
      promptKind === null ? visualLines(editor.text, columns - 3) : null,
    prompt: promptKind,
    treeTasks:
      showPlan && state.workflow ? state.workflow.plan.tasks.length : 0,
  });

  let prompt: ReactNode = null;
  if (state.approval) {
    prompt = (
      <ApprovalPrompt
        key={state.approval.approvalId}
        approval={state.approval}
        resolveApproval={answer}
        onCancel={interrupt}
        maxPreviewLines={budget.preview}
      />
    );
  } else if (state.planApproval) {
    prompt = (
      <PlanApproval
        key={state.planApproval.approvalId}
        approvalId={state.planApproval.approvalId}
        plan={state.planApproval.plan}
        problem={state.status.problem}
        resolveApproval={answerPlan}
        maxRows={budget.planRows}
      />
    );
  } else if (details !== null && state.workflow) {
    prompt = (
      <TaskDetails
        workflow={state.workflow}
        index={details}
        maxLines={budget.details}
      />
    );
  }

  return (
    <Box flexDirection="column">
      <Transcript
        key={generation}
        items={state.finished}
        folder={path.resolve(info.problem ?? process.cwd())}
        model={info.model}
        {...(info.provider !== undefined ? { provider: info.provider } : {})}
        columns={columns}
      />
      {!exiting && (
        <>
          <LiveArea
            live={state.live}
            busy={state.status.busy}
            maxLines={budget.streaming}
            width={columns}
            context={{
              waiting: state.approval !== null || state.planApproval !== null,
              workflow: showPlan,
              ...(state.workflow ? { recipe: state.workflow.plan.recipe } : {}),
            }}
          />
          {showPlan && state.workflow && (
            <PlanView
              workflow={state.workflow}
              problem={state.status.problem}
              costUsd={state.status.costUsd}
              selected={state.approval ? null : details}
              maxRows={budget.tree}
            />
          )}
          {prompt}
          {prompt === null && (
            <Composer
              value={editor}
              onChange={changeEditor}
              onSubmit={submit}
              history={history}
              maxLines={budget.input}
            />
          )}
          {hint === BUSY_HINT && <Text {...fg('warn')}> {hint}</Text>}
          <StatusLine
            status={state.status}
            hint={hint === CTRL_C_HINT ? hint : null}
          />
        </>
      )}
    </Box>
  );
}
