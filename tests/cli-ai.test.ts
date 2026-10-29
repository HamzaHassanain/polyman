import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as actions from '../src/actions';

vi.mock('../src/actions');
vi.mock('../src/helpers/compile-cache');
vi.mock('../src/help', () => ({ printComprehensiveHelp: vi.fn() }));

/** Counts how often the ai commands module is loaded. */
const ai = vi.hoisted(() => ({
  loads: 0,
  aiLoginAction: vi.fn(),
  aiLogoutAction: vi.fn(),
  aiListAction: vi.fn(),
  aiModelsAction: vi.fn(),
  aiUseAction: vi.fn(),
}));

vi.mock('../src/agent/ai-commands', () => {
  ai.loads += 1;
  return {
    aiLoginAction: ai.aiLoginAction,
    aiLogoutAction: ai.aiLogoutAction,
    aiListAction: ai.aiListAction,
    aiModelsAction: ai.aiModelsAction,
    aiUseAction: ai.aiUseAction,
  };
});

const tick = () => new Promise(resolve => setTimeout(resolve, 10));

const loadCli = async (argv: string[]) => {
  process.argv = ['node', 'polyman', ...argv];
  vi.resetModules();
  await import('../src/cli');
  await tick();
};

describe('cli.ts ai commands', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.clearAllMocks();
    ai.loads = 0;
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('does not load the agent code for other commands', async () => {
    await loadCli(['new', 'prob']);
    expect(actions.createTemplateAction).toHaveBeenCalled();
    expect(ai.loads).toBe(0);
  });

  it('loads the agent code only when an ai command runs', async () => {
    await loadCli(['ai', 'list']);
    expect(ai.loads).toBe(1);
    expect(ai.aiListAction).toHaveBeenCalledWith();
  });

  it('has no static import of the agent code', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'cli.ts'), 'utf8');
    expect(source).not.toMatch(/^import[^;]*['"]\.\/agent\//m);
    expect(source).toContain("import('./agent/ai-commands.js')");
  });

  it('passes login options through, with no way to give the key in argv', async () => {
    await loadCli(['ai', 'login', 'deepseek']);
    expect(ai.aiLoginAction).toHaveBeenCalledWith('deepseek', {
      keyStdin: false,
      model: [],
    });
  });

  it('passes --key-stdin, --base-url and repeated --model', async () => {
    await loadCli([
      'ai',
      'login',
      'custom',
      '--key-stdin',
      '--base-url',
      'https://my.server/v1',
      '--model',
      'a',
      '--model',
      'b',
    ]);
    expect(ai.aiLoginAction).toHaveBeenCalledWith('custom', {
      keyStdin: true,
      baseUrl: 'https://my.server/v1',
      model: ['a', 'b'],
    });
  });

  it('refuses a key given as an extra argument', async () => {
    // The first exit (from commander) stops parsing, like the real one.
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation(() => undefined as never)
      .mockImplementationOnce(() => {
        throw new Error('exit');
      });
    const errSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await loadCli(['ai', 'login', 'deepseek', 'sk-in-argv-123456']);
    expect(ai.aiLoginAction).not.toHaveBeenCalled();
    expect(ai.loads).toBe(0);
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining('too many arguments')
    );
    exitSpy.mockRestore();
    errSpy.mockRestore();
    logSpy.mockRestore();
  });

  it.each([
    [['ai', 'logout', 'groq'], 'aiLogoutAction', ['groq']],
    [['ai', 'models'], 'aiModelsAction', [undefined, {}]],
    [['ai', 'models', 'groq'], 'aiModelsAction', ['groq', {}]],
    [
      ['ai', 'use', 'deepseek/deepseek-flash'],
      'aiUseAction',
      ['deepseek/deepseek-flash'],
    ],
  ] as const)('runs %j', async (argv, fn, args) => {
    await loadCli([...argv]);
    expect(ai[fn]).toHaveBeenCalledWith(...args);
  });
});
