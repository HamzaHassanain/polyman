import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import chalk from 'chalk';
import { Box } from 'ink';
import { render, cleanup } from 'ink-testing-library';
import {
  Welcome,
  WORDMARK,
  shortPath,
} from '../../../src/agent/tui/components/Welcome.js';
import { StatusLine } from '../../../src/agent/tui/components/StatusLine.js';
import { ToolBlock } from '../../../src/agent/tui/components/ToolBlock.js';
import {
  CodeBlock,
  Markdown,
} from '../../../src/agent/tui/components/Markdown.js';
import { MessageView } from '../../../src/agent/tui/components/MessageView.js';
import {
  ProgressBar,
  progressCells,
} from '../../../src/agent/tui/components/PlanView.js';
import {
  StarSpinner,
  STAR_FRAMES,
} from '../../../src/agent/tui/components/Spinner.js';
import {
  activityWord,
  formatSeconds,
} from '../../../src/agent/tui/activity.js';
import {
  GRADIENT,
  gradient,
  gradientStops,
  verdictStyle,
} from '../../../src/agent/tui/theme.js';

const ESC = '\u001B';
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

/** The 24-bit color code chalk writes for `#rrggbb`. */
function fgCode(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `${ESC}[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`;
}

const oldNoColor = process.env['NO_COLOR'];
const oldLevel = chalk.level;

beforeEach(() => {
  delete process.env['NO_COLOR'];
});

afterEach(() => {
  cleanup();
  chalk.level = oldLevel;
  if (oldNoColor === undefined) delete process.env['NO_COLOR'];
  else process.env['NO_COLOR'] = oldNoColor;
});

const status = {
  problem: 'pairs-sum',
  model: 'google/gemma-4-31b-it',
  mode: 'ask' as const,
  tokens: 12345,
  costUsd: 0.0123,
  busy: false,
};

describe('gradient', () => {
  it('goes from blue to violet', () => {
    const stops = gradientStops(5);
    expect(stops[0]).toBe(GRADIENT[0]);
    expect(stops[4]).toBe(GRADIENT[1]);
    expect(stops).toHaveLength(5);
    expect(new Set(stops).size).toBe(5);
    expect(gradientStops(1)).toHaveLength(1);
  });

  it('colors each visible character, and nothing with NO_COLOR', () => {
    chalk.level = 3;
    const text = gradient('ab c');
    expect(text).toContain(fgCode(GRADIENT[0]));
    expect(text).toContain(fgCode(GRADIENT[1]));
    expect(text.replace(ANSI, '')).toBe('ab c');
    process.env['NO_COLOR'] = '1';
    expect(gradient('ab c')).toBe('ab c');
  });

  it('gives each verdict its color, MA bold', () => {
    expect(verdictStyle('OK')).toEqual({ color: 'green' });
    expect(verdictStyle('MA')).toEqual({ color: 'green', bold: true });
    expect(verdictStyle('WA')).toEqual({ color: 'red' });
    expect(verdictStyle('TL')).toEqual({ color: '#f5a623' });
    expect(verdictStyle('TO')).toEqual({ color: 'cyan' });
    process.env['NO_COLOR'] = '1';
    expect(verdictStyle('MA')).toEqual({ bold: true });
  });
});

describe('Welcome', () => {
  it('shows the wordmark, the Gemma line, the folder, the model and 3 tips', () => {
    const { lastFrame } = render(
      <Welcome
        folder="/work/pairs-sum"
        model="google/gemma-4-31b-it"
        columns={100}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('╭');
    expect(frame).toContain(WORDMARK[0]);
    expect(frame).toContain(WORDMARK[1]);
    expect(frame).toContain('✦ polyman chat · powered by Gemma 4');
    expect(frame).toContain('folder /work/pairs-sum');
    expect(frame).toContain('model  gemma-4-31b (OpenRouter)');
    expect(frame).toContain('1. Describe a problem');
    expect(frame).toContain('3. /help');
  });

  it('fits 80 columns', () => {
    const { lastFrame } = render(
      <Welcome folder="/w/x" model="m" columns={80} />
    );
    for (const line of (lastFrame() ?? '').split('\n')) {
      expect([...line].length).toBeLessThanOrEqual(80);
    }
  });

  it('hides the wordmark under 60 columns and stays in the width', () => {
    const { lastFrame } = render(
      <Welcome
        folder="/a/very/long/folder/name/pairs-sum"
        model="m"
        columns={50}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).not.toContain(WORDMARK[0]);
    expect(frame).toContain('✦ polyman chat');
    // The end of the folder is the part to keep.
    expect(frame).toContain('pairs-sum');
    for (const line of frame.split('\n')) {
      expect([...line].length).toBeLessThanOrEqual(50);
    }
  });

  it('draws the wordmark in the gradient', () => {
    chalk.level = 3;
    const { lastFrame } = render(
      <Welcome folder="/w" model="m" columns={80} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain(fgCode(GRADIENT[0]));
    expect(frame).toContain(fgCode(GRADIENT[1]));
  });

  it('shortens the home folder to ~', () => {
    expect(shortPath('/home/me/p/x', '/home/me')).toBe('~/p/x');
    expect(shortPath('/home/meme/x', '/home/me')).toBe('/home/meme/x');
    expect(shortPath('/opt/x', '/home/me')).toBe('/opt/x');
  });
});

describe('StatusLine colors', () => {
  it('gives each mode its own pill color', () => {
    chalk.level = 3;
    const ask = render(<StatusLine status={status} />).lastFrame() ?? '';
    const auto =
      render(
        <StatusLine status={{ ...status, mode: 'auto-edit' }} />
      ).lastFrame() ?? '';
    const bg = (s: string) => new RegExp(`${ESC}\\[48;2;[0-9;]+m`).exec(s)?.[0];
    expect(bg(ask)).toBeDefined();
    expect(bg(auto)).toBeDefined();
    expect(bg(ask)).not.toBe(bg(auto));
  });

  it('is plain text joined with · under NO_COLOR', () => {
    process.env['NO_COLOR'] = '1';
    chalk.level = 3;
    const frame = render(<StatusLine status={status} />).lastFrame() ?? '';
    expect(frame.replace(ANSI, '')).toBe(
      ' pairs-sum · ask mode (shift+tab) · gemma-4-31b · 12.3k tok · $0.01'
    );
    expect(frame).not.toContain(`${ESC}[38;`);
    expect(frame).not.toContain(`${ESC}[48;`);
  });
});

describe('ToolBlock look', () => {
  it('colors the verdicts of a result', () => {
    chalk.level = 3;
    const { lastFrame } = render(
      <ToolBlock
        state="done"
        name="verify"
        args="all"
        ok
        summary="main MA ok, brute OK, wa WA, tl TL, slow TO"
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame.replace(ANSI, '')).toBe(
      '● verify(all)\n  ⎿ ✔ main MA ok, brute OK, wa WA, tl TL, slow TO'
    );
    expect(frame).toContain(`${ESC}[1m`);
    expect(frame).toContain(`${ESC}[32mOK`);
    expect(frame).toContain(`${ESC}[31mWA`);
    expect(frame).toContain(`${fgCode('#f5a623')}TL`);
    expect(frame).toContain(`${ESC}[36mTO`);
  });

  it('keeps a wrapped result line under its ⎿', () => {
    const { lastFrame } = render(
      <ToolBlock
        state="done"
        name="verify"
        args=""
        ok
        summary={'word '.repeat(30).trim()}
      />
    );
    const lines = (lastFrame() ?? '').split('\n').slice(2);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line.startsWith('      ')).toBe(true);
  });
});

describe('Markdown look', () => {
  it('puts the language in the top border of a code box', () => {
    const { lastFrame } = render(
      <CodeBlock code={'int main() {}\nreturn 0;'} lang="cpp" width={40} />
    );
    expect(lastFrame()).toBe(
      [
        '╭─ cpp ─────────╮',
        '│ int main() {} │',
        '│ return 0;     │',
        '╰───────────────╯',
      ].join('\n')
    );
  });

  it('draws a box without a label, at most the width', () => {
    const { lastFrame } = render(
      <CodeBlock code={'x'.repeat(50)} lang="" width={20} />
    );
    const lines = (lastFrame() ?? '').split('\n');
    expect(lines[0]).toBe(`╭${'─'.repeat(18)}╮`);
    for (const line of lines) expect([...line].length).toBeLessThanOrEqual(20);
  });
});

describe('Markdown lists', () => {
  it('never get wider than their box', () => {
    const text =
      '3. What are the limits on k? I guess |k| <= 2e9, so the sum needs long long.';
    const { lastFrame } = render(
      <Box width={58}>
        <Markdown text={text} width={58} />
      </Box>
    );
    const lines = (lastFrame() ?? '').split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) expect([...line].length).toBeLessThanOrEqual(58);
    expect(lines[1]?.startsWith('   ')).toBe(true);
  });
});

describe('user line', () => {
  it('has a dim background, and is bold without colors', () => {
    chalk.level = 3;
    const item = { kind: 'user' as const, id: 1, text: 'hi' };
    const colored = render(<MessageView item={item} />).lastFrame() ?? '';
    expect(colored).toContain(`${ESC}[100m`);
    expect(colored.replace(ANSI, '')).toBe('> hi ');
    cleanup();
    process.env['NO_COLOR'] = '1';
    const plain = render(<MessageView item={item} />).lastFrame() ?? '';
    expect(plain).not.toContain(`${ESC}[100m`);
    expect(plain).not.toContain(`${ESC}[97m`);
    expect(plain.replace(ANSI, '')).toBe('> hi ');
  });
});

describe('workflow progress', () => {
  it('fills the bar by the finished tasks', () => {
    expect(progressCells(0, 12)).toBe(0);
    expect(progressCells(7, 12)).toBe(6);
    expect(progressCells(12, 12)).toBe(10);
    expect(progressCells(3, 0)).toBe(0);
    const { lastFrame } = render(<ProgressBar done={7} total={12} />);
    expect(lastFrame()).toBe('▰▰▰▰▰▰▱▱▱▱ 7/12');
  });
});

describe('spinner line', () => {
  const live = (p: Partial<Parameters<typeof activityWord>[0]> = {}) => ({
    streamingText: '',
    reasoning: '',
    runningTools: [],
    ...p,
  });
  const tool = (name: string, lastLine: string | null) => ({
    callId: 'c',
    name,
    args: '',
    lastLine,
  });

  it('takes its word from the running tool', () => {
    expect(activityWord(live())).toBe('Thinking…');
    expect(activityWord(live({ streamingText: 'hi' }))).toBe('Writing…');
    expect(
      activityWord(live({ runningTools: [tool('verify', 'Compiling 4 ...')] }))
    ).toBe('Compiling…');
    expect(
      activityWord(
        live({ runningTools: [tool('verify', 'Running main.cpp on tests')] })
      )
    ).toBe('Running tests…');
    expect(activityWord(live({ runningTools: [tool('verify', null)] }))).toBe(
      'Verifying…'
    );
    expect(activityWord(live({ runningTools: [tool('mystery', null)] }))).toBe(
      'Working…'
    );
    expect(activityWord(live(), { waiting: true })).toBe('Waiting for you…');
    expect(activityWord(live(), { workflow: true })).toBe(
      'Running the workflow…'
    );
    expect(activityWord(live(), { workflow: true, recipe: 'prove_idea' })).toBe(
      'Proving the idea…'
    );
    expect(formatSeconds(12_900)).toBe('12s');
  });

  it('draws a star frame', () => {
    const { lastFrame } = render(<StarSpinner />);
    expect(STAR_FRAMES).toContain(lastFrame());
  });
});
