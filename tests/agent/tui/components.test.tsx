import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, cleanup } from 'ink-testing-library';
import { ToolBlock } from '../../../src/agent/tui/components/ToolBlock.js';
import { ApprovalPrompt } from '../../../src/agent/tui/components/ApprovalPrompt.js';
import { StatusLine } from '../../../src/agent/tui/components/StatusLine.js';
import { Markdown } from '../../../src/agent/tui/components/Markdown.js';
import { LiveArea } from '../../../src/agent/tui/components/LiveArea.js';
import { Transcript } from '../../../src/agent/tui/components/Transcript.js';
import type { ApprovalView } from '../../../src/agent/tui/store.js';

const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

// The pills show only with colors: do not take NO_COLOR from the shell.
beforeEach(() => {
  vi.stubEnv('NO_COLOR', '');
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('ToolBlock', () => {
  it('shows an ok tool as a call line and a result line', () => {
    const { lastFrame } = render(
      <ToolBlock
        state="done"
        name="update_notes"
        args="Constraints"
        ok
        summary="notes updated"
      />
    );
    expect(lastFrame()).toBe(
      '● update_notes(Constraints)\n  ⎿ ✔ notes updated'
    );
  });

  it('shows an error tool with every summary line, cut after 4', () => {
    const { lastFrame } = render(
      <ToolBlock
        state="done"
        name="verify"
        args=""
        ok={false}
        summary={'verify failed\nline 2\nline 3\nline 4\nline 5\nline 6'}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('● verify\n  ⎿ ✗ verify failed\n      line 2');
    expect(frame).toContain('line 4');
    expect(frame).not.toContain('line 5');
    expect(frame).toContain('… +2 lines');
  });

  it('shows a running tool with its last progress line', () => {
    const { lastFrame } = render(
      <ToolBlock
        state="running"
        name="verify"
        args=""
        lastLine="Running wa.cpp on tests ... (12/24)"
      />
    );
    expect(lastFrame()).toContain('verify');
    expect(lastFrame()).toContain('⎿ Running wa.cpp on tests ... (12/24)');
  });
});

describe('ApprovalPrompt', () => {
  const approval: ApprovalView = {
    approvalId: 'a1',
    callId: 'c1',
    toolName: 'write_file',
    title: 'Write validator/val.cpp?',
    preview: '+ #include "testlib.h"\n+ int main() {}',
  };

  it('shows the title, the preview and the 3 options', () => {
    const { lastFrame } = render(
      <ApprovalPrompt approval={approval} resolveApproval={vi.fn()} />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Write validator/val.cpp?');
    expect(frame).toContain('+ #include "testlib.h"');
    expect(frame).toContain('❯ 1. Yes');
    expect(frame).toContain(
      '2. Yes, and do not ask again for write_file in this session'
    );
    expect(frame).toContain('3. No, and tell the agent what to do differently');
    expect(frame).toContain('╭');
  });

  it('number key 1 calls resolveApproval with allow_once', async () => {
    const resolveApproval = vi.fn();
    const { stdin } = render(
      <ApprovalPrompt approval={approval} resolveApproval={resolveApproval} />
    );
    await tick();
    // Two keys before React draws again: only the first one answers.
    stdin.write('1');
    stdin.write('2');
    await tick();
    expect(resolveApproval).toHaveBeenCalledTimes(1);
    expect(resolveApproval).toHaveBeenCalledWith('a1', { kind: 'allow_once' });
    stdin.write('2');
    await tick();
    expect(resolveApproval).toHaveBeenCalledTimes(1);
  });

  it('arrow down and enter choose allow_session', async () => {
    const resolveApproval = vi.fn();
    const { stdin, lastFrame } = render(
      <ApprovalPrompt approval={approval} resolveApproval={resolveApproval} />
    );
    await tick();
    stdin.write('\u001B[B');
    await tick();
    expect(lastFrame()).toContain('❯ 2. Yes, and do not ask again');
    stdin.write('\r');
    await tick();
    expect(resolveApproval).toHaveBeenCalledWith('a1', {
      kind: 'allow_session',
    });
  });

  it('enter right after arrow down, before React draws, uses the arrow', async () => {
    const resolveApproval = vi.fn();
    const { stdin } = render(
      <ApprovalPrompt approval={approval} resolveApproval={resolveApproval} />
    );
    await tick();
    stdin.write('\u001B[B');
    stdin.write('\r');
    await tick();
    expect(resolveApproval).toHaveBeenCalledWith('a1', {
      kind: 'allow_session',
    });
  });

  it('option 3 asks for a reason and denies with it', async () => {
    const resolveApproval = vi.fn();
    const { stdin, lastFrame } = render(
      <ApprovalPrompt approval={approval} resolveApproval={resolveApproval} />
    );
    await tick();
    stdin.write('3');
    await tick();
    expect(lastFrame()).toContain('reason:');
    stdin.write('use long long');
    await tick();
    expect(lastFrame()).toContain('reason: use long long');
    stdin.write('\r');
    await tick();
    expect(resolveApproval).toHaveBeenCalledWith('a1', {
      kind: 'deny',
      reason: 'use long long',
    });
  });

  it('shows a command instead of a preview', () => {
    const { lastFrame } = render(
      <ApprovalPrompt
        approval={{
          approvalId: 'a2',
          callId: 'c2',
          toolName: 'run_solution',
          title: 'Run a solution?',
          command: 'polyman run main --all',
        }}
        resolveApproval={vi.fn()}
      />
    );
    expect(lastFrame()).toContain('polyman run main --all');
  });
});

describe('StatusLine', () => {
  const status = {
    problem: 'pairs-sum',
    model: 'google/gemma-4-31b-it',
    mode: 'ask' as const,
    tokens: 12345,
    costUsd: 0.0123,
    busy: true,
  };

  it('shows the problem and the mode, model, tokens and cost pills', () => {
    const { lastFrame } = render(<StatusLine status={status} />);
    expect(lastFrame()).toBe(
      ' pairs-sum  ask  shift+tab  gemma-4-31b   12.3k tok   $0.01'
    );
  });

  it('shows "new problem" and the ctrl+c hint', () => {
    const { lastFrame } = render(
      <StatusLine
        status={{ ...status, problem: null, busy: false }}
        hint="press ctrl+c again to exit"
      />
    );
    expect(lastFrame()).toBe(
      ' new problem  ask  shift+tab  gemma-4-31b   12.3k tok   $0.01   press ctrl+c again to exit'
    );
  });
});

describe('Markdown', () => {
  it('draws headings, lists, inline code and code blocks', () => {
    const { lastFrame } = render(
      <Markdown
        text={[
          '# Plan',
          '',
          '1. read `n`',
          '2. **sort**',
          '- nested',
          '',
          '```cpp',
          'int main() {}',
          '```',
        ].join('\n')}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Plan');
    expect(frame).not.toContain('#');
    expect(frame).toContain('1. read n');
    expect(frame).toContain('2. sort');
    expect(frame).toContain('- nested');
    expect(frame).toContain('╭─ cpp ');
    expect(frame).toContain('│ int main() {} │');
    expect(frame).not.toContain('```');
  });
});

describe('LiveArea', () => {
  it('shows the streaming text and the running tools', () => {
    const { lastFrame } = render(
      <LiveArea
        busy
        live={{
          streamingText: 'Now let us run **verify**.',
          reasoning: '',
          runningTools: [
            { callId: 'c1', name: 'verify', args: '', lastLine: 'Generating' },
          ],
        }}
      />
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('✦ Now let us run verify.');
    expect(frame).toContain('⎿ Generating');
    expect(frame).toMatch(/Generating tests… \(0s · esc to interrupt\)/);
  });

  it('shows a working line while the agent thinks', () => {
    const { lastFrame } = render(
      <LiveArea
        busy
        live={{
          streamingText: '',
          reasoning: 'a\nask about k',
          runningTools: [],
        }}
      />
    );
    expect(lastFrame()).toMatch(
      /Thinking… \(0s · esc to interrupt\) ask about k/
    );
  });
});

describe('Transcript', () => {
  it('wraps long messages to the terminal width', () => {
    const text =
      'The wrong solution `wa-overflow.cpp` passed every test, so the tests are weak. I will add a test with big values near `1e9`.';
    const { lastFrame } = render(
      <Transcript
        folder="/tmp/pairs-sum"
        model="m"
        columns={100}
        items={[{ kind: 'assistant', id: 1, text }]}
      />
    );
    const lines = (lastFrame() ?? '').split('\n');
    expect(lines.some(l => l.startsWith('✦ The wrong solution'))).toBe(true);
    for (const line of lines) {
      expect(line.length).toBeLessThanOrEqual(100);
    }
  });
});
