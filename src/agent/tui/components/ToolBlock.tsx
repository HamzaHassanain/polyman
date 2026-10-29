import { Box, Text } from 'ink';
import { fg } from '../theme.js';
import { VerdictLine } from './Verdict.js';

/** Most lines of a tool summary we show. */
const MAX_LINES = 4;

/** The tool name bold and colored, the arguments dim. */
function Call({ name, args }: { name: string; args: string }) {
  return (
    <Text wrap="truncate-end">
      <Text bold {...fg('tool')}>
        {name}
      </Text>
      {args.length > 0 && <Text dimColor>({args})</Text>}
    </Text>
  );
}

/**
 * One tool call: `● name(args)` and `  ⎿ ✔ summary` under it. While it
 * runs, its last progress line. The spinner line under the live area says
 * that it works.
 */
export function ToolBlock(
  props:
    | { state: 'running'; name: string; args: string; lastLine: string | null }
    | {
        state: 'done';
        name: string;
        args: string;
        ok: boolean;
        summary: string;
      }
) {
  if (props.state === 'running') {
    return (
      <Box flexDirection="column">
        <Box>
          <Text {...fg('agent')}>● </Text>
          <Call name={props.name} args={props.args} />
        </Box>
        {props.lastLine !== null && (
          <Box>
            <Box width={4} flexShrink={0}>
              <Text dimColor>{'  ⎿ '}</Text>
            </Box>
            <Text wrap="truncate-end">
              <VerdictLine text={props.lastLine} dim />
            </Text>
          </Box>
        )}
      </Box>
    );
  }
  const lines = props.summary.trimEnd().split('\n');
  const shown = lines.slice(0, MAX_LINES);
  const more = lines.length - shown.length;
  const mark = props.ok ? fg('ok') : fg('error');
  return (
    <Box flexDirection="column">
      <Box>
        <Text {...mark}>● </Text>
        <Call name={props.name} args={props.args} />
      </Box>
      {shown.map((line, i) => (
        <Box key={i}>
          <Box width={6} flexShrink={0}>
            <Text dimColor>{i === 0 ? '  ⎿ ' : '    '}</Text>
            {i === 0 && <Text {...mark}>{props.ok ? '✔' : '✗'}</Text>}
          </Box>
          <Text>
            {props.ok ? (
              <VerdictLine text={line} dim />
            ) : (
              <Text {...fg('error')}>
                <VerdictLine text={line} dim={false} />
              </Text>
            )}
          </Text>
        </Box>
      ))}
      {more > 0 && <Text dimColor>{`      … +${more} lines`}</Text>}
    </Box>
  );
}
