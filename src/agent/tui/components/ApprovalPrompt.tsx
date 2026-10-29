import { useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { ApprovalDecision } from '../../core/events.js';
import type { ApprovalView } from '../store.js';
import { border, fg } from '../theme.js';
import {
  backspace,
  EMPTY_EDITOR,
  insert,
  type EditorState,
} from '../editor.js';

/** Most preview lines we show in the box. */
const MAX_PREVIEW_LINES = 12;

interface Option {
  label: string;
  /** `null` opens the input for the reason. */
  decision: ApprovalDecision | null;
}

/** The options of a tool approval. */
export function optionsOf(toolName: string): Option[] {
  return [
    { label: 'Yes', decision: { kind: 'allow_once' } },
    {
      label: `Yes, and do not ask again for ${toolName} in this session`,
      decision: { kind: 'allow_session' },
    },
    {
      label: 'No, and tell the agent what to do differently',
      decision: null,
    },
  ];
}

/** One line of the preview, diff lines in green and red. */
function PreviewLine({ line }: { line: string }) {
  const color = line.startsWith('+')
    ? fg('added')
    : line.startsWith('-')
      ? fg('removed')
      : {};
  return (
    <Text {...color} wrap="truncate-end">
      {line.length > 0 ? line : ' '}
    </Text>
  );
}

/**
 * The inline approval box: title, the command or a short diff preview, and
 * the options. Arrow keys or number keys choose, option 3 asks for a reason.
 */
export function ApprovalPrompt({
  approval,
  resolveApproval,
  onCancel,
  isActive = true,
  maxPreviewLines = MAX_PREVIEW_LINES,
}: {
  approval: ApprovalView;
  resolveApproval: (approvalId: string, decision: ApprovalDecision) => void;
  /** esc on the options: interrupt the turn. */
  onCancel?: () => void;
  isActive?: boolean;
  /** Most preview lines, less than 12 when the terminal is short. */
  maxPreviewLines?: number;
}) {
  const options = optionsOf(approval.toolName);
  const [selected, setSelectedState] = useState(0);
  // Keys can come faster than React renders: enter must see the newest arrow.
  const selectedRef = useRef(0);
  const setSelected = (next: number) => {
    selectedRef.current = next;
    setSelectedState(next);
  };
  const [reason, setReasonState] = useState<EditorState | null>(null);
  // Keys can come faster than React renders: keep the newest reason here.
  const reasonRef = useRef<EditorState | null>(null);
  const setReason = (next: EditorState | null) => {
    reasonRef.current = next;
    setReasonState(next);
  };
  const [answered, setAnswered] = useState(false);
  // A ref, not only the state: keys can come before React draws again, and
  // the approval must be answered only once.
  const answeredRef = useRef(false);

  const answer = (decision: ApprovalDecision) => {
    if (answeredRef.current) return;
    answeredRef.current = true;
    setAnswered(true);
    resolveApproval(approval.approvalId, decision);
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option) return;
    if (option.decision === null) {
      setSelected(index);
      setReason(EMPTY_EDITOR);
    } else {
      answer(option.decision);
    }
  };

  useInput(
    (input, key) => {
      if (key.ctrl || answeredRef.current) return;
      const reason = reasonRef.current;
      if (reason !== null) {
        if (key.escape) {
          setReason(null);
        } else if (key.return) {
          const text = reason.text.trim();
          answer(
            text.length > 0 ? { kind: 'deny', reason: text } : { kind: 'deny' }
          );
        } else if (key.backspace || key.delete) {
          setReason(backspace(reason));
        } else if (input.length > 0 && !key.tab) {
          setReason(insert(reason, input.replace(/[\r\n]+/g, ' ')));
        }
        return;
      }
      if (key.escape) {
        onCancel?.();
      } else if (key.upArrow) {
        setSelected(
          (selectedRef.current + options.length - 1) % options.length
        );
      } else if (key.downArrow || (key.tab && !key.shift)) {
        setSelected((selectedRef.current + 1) % options.length);
      } else if (key.return) {
        choose(selectedRef.current);
      } else if (/^[1-9]$/.test(input)) {
        choose(Number(input) - 1);
      }
    },
    { isActive: isActive && !answered }
  );

  const body = approval.command ?? approval.preview;
  const lines = body === undefined ? [] : body.replace(/\n+$/, '').split('\n');
  const max = Math.max(1, Math.min(MAX_PREVIEW_LINES, maxPreviewLines));
  // The "more lines" line takes one of the lines.
  const shown =
    lines.length > max ? lines.slice(0, Math.max(1, max - 1)) : lines;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      {...border('agent')}
      paddingX={1}
      marginBottom={1}
    >
      <Text bold {...fg('agent')}>
        {approval.title}
      </Text>
      {shown.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {shown.map((line, i) =>
            approval.command !== undefined ? (
              <Text key={i}>{line}</Text>
            ) : (
              <PreviewLine key={i} line={line} />
            )
          )}
          {lines.length > shown.length && (
            <Text
              dimColor
            >{`... (${lines.length - shown.length} more lines)`}</Text>
          )}
        </Box>
      )}
      <Box flexDirection="column" marginTop={1}>
        {options.map((option, i) => (
          <Text key={i} {...(i === selected ? fg('agent') : {})}>
            {i === selected ? '❯ ' : '  '}
            {i + 1}. {option.label}
          </Text>
        ))}
      </Box>
      {reason !== null && (
        <Box marginTop={1}>
          <Text>
            <Text dimColor>reason: </Text>
            {reason.text}
            <Text inverse> </Text>
          </Text>
        </Box>
      )}
      {reason !== null && <Text dimColor>enter to send, esc to go back</Text>}
    </Box>
  );
}
