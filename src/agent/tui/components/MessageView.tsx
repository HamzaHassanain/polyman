import { Box, Text } from 'ink';
import type { Item } from '../store.js';
import { fg, gradient, noColor, userLine } from '../theme.js';
import { Markdown } from './Markdown.js';
import { WorkflowSummary } from './PlanView.js';
import { ToolBlock } from './ToolBlock.js';

/** An assistant message: the agent `✦` and the markdown text. */
export function AssistantText({ text }: { text: string }) {
  return (
    <Box>
      <Box width={2} flexShrink={0}>
        <Text>{gradient('✦')}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Markdown text={text} />
      </Box>
    </Box>
  );
}

/** One finished item of the transcript. */
export function MessageView({ item }: { item: Item }) {
  switch (item.kind) {
    case 'user':
      // A dim background; bold text when there are no colors.
      return (
        <Box>
          <Box width={2} flexShrink={0}>
            <Text {...userLine()} bold>
              {'> '}
            </Text>
          </Box>
          <Text {...userLine()} bold={noColor()}>
            {item.text}{' '}
          </Text>
        </Box>
      );
    case 'assistant':
      return <AssistantText text={item.text} />;
    case 'tool':
      return (
        <ToolBlock
          state="done"
          name={item.name}
          args={item.args}
          ok={item.ok}
          summary={item.summary}
        />
      );
    case 'workflow':
      return <WorkflowSummary item={item} />;
    case 'notice': {
      const color =
        item.level === 'error'
          ? fg('error')
          : item.level === 'warn'
            ? fg('warn')
            : {};
      return (
        <Text dimColor={item.level === 'info'} {...color}>
          {item.text}
        </Text>
      );
    }
  }
}
