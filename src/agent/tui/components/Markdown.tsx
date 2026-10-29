import type { ReactNode } from 'react';
import { Box, Text, useStdout } from 'ink';
import { lexer, type Token, type Tokens } from 'marked';
import { fg, gradient } from '../theme.js';

/** Draws inline tokens (bold, code, links, ...) as nested `<Text>`. */
function inline(tokens: Token[] | undefined, keyBase: string): ReactNode[] {
  if (!tokens) return [];
  return tokens.map((t, i) => {
    const key = `${keyBase}.${i}`;
    switch (t.type) {
      case 'strong':
        return (
          <Text key={key} bold>
            {inline((t as Tokens.Strong).tokens, key)}
          </Text>
        );
      case 'em':
        return (
          <Text key={key} italic>
            {inline((t as Tokens.Em).tokens, key)}
          </Text>
        );
      case 'del':
        return (
          <Text key={key} strikethrough>
            {inline((t as Tokens.Del).tokens, key)}
          </Text>
        );
      case 'codespan':
        return (
          <Text key={key} {...fg('code')}>
            {(t as Tokens.Codespan).text}
          </Text>
        );
      case 'link': {
        const link = t as Tokens.Link;
        return (
          <Text key={key} underline>
            {inline(link.tokens, key)}
          </Text>
        );
      }
      case 'image':
        return <Text key={key}>{(t as Tokens.Image).text}</Text>;
      case 'br':
        return <Text key={key}>{'\n'}</Text>;
      case 'text': {
        const text = t as Tokens.Text;
        return (
          <Text key={key}>
            {text.tokens ? inline(text.tokens, key) : text.text}
          </Text>
        );
      }
      default:
        return <Text key={key}>{'text' in t ? String(t.text) : t.raw}</Text>;
    }
  });
}

/**
 * A code block in a round box, the language in the top border:
 * `╭─ cpp ───╮`. As wide as its longest line, at most `width`.
 */
export function CodeBlock({
  code,
  lang,
  width,
}: {
  code: string;
  lang: string;
  width: number;
}) {
  const label = lang.trim().split(/\s+/)[0] ?? '';
  const longest = Math.max(0, ...code.split('\n').map(l => [...l].length));
  const w = Math.max(
    6,
    Math.min(width, Math.max(longest + 4, label.length + 8))
  );
  const top =
    label.length > 0
      ? `╭─ ${label} ${'─'.repeat(Math.max(0, w - 5 - label.length))}╮`
      : `╭${'─'.repeat(w - 2)}╮`;
  return (
    <Box flexDirection="column" width={w}>
      <Text dimColor>{top}</Text>
      <Box
        borderStyle="round"
        borderTop={false}
        borderDimColor
        paddingX={1}
        width={w}
      >
        <Text {...fg('code')}>{code}</Text>
      </Box>
    </Box>
  );
}

/** Draws one block token (heading, paragraph, list, code, ...). */
function block(t: Token, key: string, width: number): ReactNode {
  switch (t.type) {
    case 'space':
      return null;
    case 'heading': {
      const heading = t as Tokens.Heading;
      // The first level in the gradient, the others in one color.
      if (heading.depth === 1) {
        return (
          <Text key={key}>
            {gradient(heading.text.replace(/[*_`~]/g, ''), { bold: true })}
          </Text>
        );
      }
      return (
        <Text key={key} bold {...fg('heading')}>
          {inline(heading.tokens, key)}
        </Text>
      );
    }
    case 'paragraph':
      return (
        <Text key={key}>{inline((t as Tokens.Paragraph).tokens, key)}</Text>
      );
    case 'text': {
      const text = t as Tokens.Text;
      return (
        <Text key={key}>
          {text.tokens ? inline(text.tokens, key) : text.text}
        </Text>
      );
    }
    case 'code': {
      const code = t as Tokens.Code;
      return (
        <CodeBlock
          key={key}
          code={code.text}
          lang={code.lang ?? ''}
          width={width}
        />
      );
    }
    case 'list': {
      const list = t as Tokens.List;
      const start = typeof list.start === 'number' ? list.start : 1;
      return (
        <Box key={key} flexDirection="column">
          {list.items.map((item, i) => (
            <Box key={`${key}.${i}`}>
              {/* The marker must not shrink, or the text gets its column. */}
              <Box flexShrink={0}>
                <Text>{list.ordered ? `${start + i}. ` : '- '}</Text>
              </Box>
              <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                {item.tokens.map((child, j) =>
                  block(child, `${key}.${i}.${j}`, width - 3)
                )}
              </Box>
            </Box>
          ))}
        </Box>
      );
    }
    case 'blockquote':
      return (
        <Box key={key} flexDirection="column" paddingLeft={2}>
          <Text dimColor>{(t as Tokens.Blockquote).text}</Text>
        </Box>
      );
    case 'hr':
      return (
        <Text key={key} dimColor>
          ────────
        </Text>
      );
    default:
      return <Text key={key}>{t.raw.replace(/\n+$/, '')}</Text>;
  }
}

/**
 * A small terminal markdown renderer on the `marked` lexer: bold colored
 * headings, lists, inline code and code blocks in a box. No highlighting.
 */
export function Markdown({
  text,
  width,
}: {
  text: string;
  /** Columns for the code boxes. The terminal width minus the bullet. */
  width?: number;
}) {
  const { stdout } = useStdout();
  const columns = width ?? Math.max(10, (stdout.columns || 80) - 2);
  // Ink counts a tab as one column but the terminal moves to the next tab
  // stop, so lines get longer than Ink thinks and the redraw breaks.
  const blocks = lexer(text.replace(/\t/g, '    ')).filter(
    t => t.type !== 'space'
  );
  return (
    <Box flexDirection="column" gap={1}>
      {blocks.map((t, i) => block(t, String(i), columns))}
    </Box>
  );
}
