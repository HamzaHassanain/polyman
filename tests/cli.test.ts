import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as actions from '../src/actions';
import * as help from '../src/help';
import { setCacheEnabled } from '../src/helpers/compile-cache';
import { createTheme } from '../src/theme';
import { Chalk } from 'chalk';

vi.mock('../src/actions');
vi.mock('../src/helpers/compile-cache');
vi.mock('../src/help', () => ({
  printComprehensiveHelp: vi.fn(),
}));
const chat = vi.hoisted(() => ({ startChat: vi.fn() }));
vi.mock('../src/agent/index', () => chat);
vi.mock('../src/theme', async importOriginal => {
  const original = await importOriginal<typeof import('../src/theme')>();
  const { Chalk } = await import('chalk');
  const detected = original.createTheme('light', new Chalk({ level: 3 }));
  return { ...original, resolveTheme: vi.fn(() => Promise.resolve(detected)) };
});

const tick = () => new Promise(resolve => setTimeout(resolve, 10));

const loadCli = async (argv: string[]) => {
  process.argv = ['node', 'polyman', ...argv];
  vi.resetModules();
  await import('../src/cli');
  await tick();
};

describe('cli.ts', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.argv = [...originalArgv];
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('should register new command', async () => {
    await loadCli(['new', 'prob']);
    expect(actions.createTemplateAction).toHaveBeenCalledWith('prob', {
      json: false,
    });
  });

  it('should pass --json to new', async () => {
    await loadCli(['new', 'prob', '--json']);
    expect(actions.createTemplateAction).toHaveBeenCalledWith('prob', {
      json: true,
    });
  });

  it('should pass --json to download-testlib', async () => {
    await loadCli(['download-testlib', '--json']);
    expect(actions.downloadTestlibAction).toHaveBeenCalledWith({ json: true });
  });

  it.each([
    ['checkers', 'listAvailableCheckersAction'],
    ['testsets', 'listTestsetsAction'],
    ['solutions', 'listSolutionsAction'],
    ['generators', 'listGeneratorsAction'],
  ] as const)('should pass --json to list %s', async (what, action) => {
    await loadCli(['list', what, '--json']);
    expect(actions[action]).toHaveBeenCalledWith({ json: true });
  });

  it('should register generate command', async () => {
    await loadCli(['generate', '--all']);
    expect(actions.generateTestsAction).toHaveBeenCalledWith('all', undefined, {
      json: false,
    });
  });

  it('should register list checkers command', async () => {
    await loadCli(['list', 'checkers']);
    expect(actions.listAvailableCheckersAction).toHaveBeenCalledWith({
      json: false,
    });
  });

  it('should register download-testlib command', async () => {
    await loadCli(['download-testlib']);
    expect(actions.downloadTestlibAction).toHaveBeenCalled();
  });

  it('should register list testsets command', async () => {
    await loadCli(['list', 'testsets']);
    expect(actions.listTestsetsAction).toHaveBeenCalled();
  });

  it('should register list solutions command', async () => {
    await loadCli(['list', 'solutions']);
    expect(actions.listSolutionsAction).toHaveBeenCalled();
  });

  it('should register list generators command', async () => {
    await loadCli(['list', 'generators']);
    expect(actions.listGeneratorsAction).toHaveBeenCalled();
  });

  it('should pass testset and group to generate', async () => {
    await loadCli(['generate', '--testset', 'main', '--group', 'samples']);
    expect(actions.generateTestsAction).toHaveBeenCalledWith(
      'main',
      'samples',
      { json: false }
    );
  });

  it('should pass testset and index to generate', async () => {
    await loadCli(['generate', '--testset', 'main', '--index', '5']);
    expect(actions.generateTestsAction).toHaveBeenCalledWith('main', '5', {
      json: false,
    });
  });

  it('should pass only testset to generate when no modifier', async () => {
    await loadCli(['generate', '--testset', 'main']);
    expect(actions.generateTestsAction).toHaveBeenCalledWith(
      'main',
      undefined,
      { json: false }
    );
  });

  it('should default generate target to all when nothing provided', async () => {
    await loadCli(['generate']);
    expect(actions.generateTestsAction).toHaveBeenCalledWith('all', undefined, {
      json: false,
    });
  });

  it.each(['generate', 'validate'] as const)(
    'should pass --json to %s',
    async command => {
      await loadCli([command, '--all', '--json']);
      const action =
        command === 'generate'
          ? actions.generateTestsAction
          : actions.validateTestsAction;
      expect(action).toHaveBeenCalledWith('all', undefined, { json: true });
    }
  );

  it('should register validate --all command', async () => {
    await loadCli(['validate', '--all']);
    expect(actions.validateTestsAction).toHaveBeenCalledWith('all', undefined, {
      json: false,
    });
  });

  it('should pass testset and group to validate', async () => {
    await loadCli(['validate', '--testset', 'pretest', '--group', 'g1']);
    expect(actions.validateTestsAction).toHaveBeenCalledWith('pretest', 'g1', {
      json: false,
    });
  });

  it('should pass testset and index to validate', async () => {
    await loadCli(['validate', '--testset', 'pretest', '--index', '3']);
    expect(actions.validateTestsAction).toHaveBeenCalledWith('pretest', '3', {
      json: false,
    });
  });

  it('should pass only testset to validate when no modifier', async () => {
    await loadCli(['validate', '--testset', 'pretest']);
    expect(actions.validateTestsAction).toHaveBeenCalledWith(
      'pretest',
      undefined,
      { json: false }
    );
  });

  it('should register run command with --all', async () => {
    await loadCli(['run', 'main', '--all']);
    expect(actions.runSolutionAction).toHaveBeenCalledWith(
      'main',
      'all',
      undefined,
      { json: false }
    );
  });

  it('should pass testset and group to run', async () => {
    await loadCli(['run', 'sol', '--testset', 'ts', '--group', 'gp']);
    expect(actions.runSolutionAction).toHaveBeenCalledWith('sol', 'ts', 'gp', {
      json: false,
    });
  });

  it('should pass testset and index to run', async () => {
    await loadCli(['run', 'sol', '--testset', 'ts', '--index', '7']);
    expect(actions.runSolutionAction).toHaveBeenCalledWith('sol', 'ts', '7', {
      json: false,
    });
  });

  it('should pass only testset to run when no modifier', async () => {
    await loadCli(['run', 'sol', '--testset', 'ts']);
    expect(actions.runSolutionAction).toHaveBeenCalledWith(
      'sol',
      'ts',
      undefined,
      { json: false }
    );
  });

  it('should default run target to all when nothing provided', async () => {
    await loadCli(['run', 'sol']);
    expect(actions.runSolutionAction).toHaveBeenCalledWith(
      'sol',
      'all',
      undefined,
      { json: false }
    );
  });

  it('should pass --json through to run', async () => {
    await loadCli(['run', 'sol', '--all', '--json']);
    expect(actions.runSolutionAction).toHaveBeenCalledWith(
      'sol',
      'all',
      undefined,
      { json: true }
    );
  });

  it('should register test command', async () => {
    await loadCli(['test', 'validator']);
    expect(actions.testWhatAction).toHaveBeenCalledWith('validator', {
      json: false,
    });
  });

  it.each(['validator', 'checker', 'wa-solution'])(
    'should pass --json through to test %s',
    async what => {
      await loadCli(['test', what, '--json']);
      expect(actions.testWhatAction).toHaveBeenCalledWith(what, {
        json: true,
      });
    }
  );

  it('should register verify command', async () => {
    await loadCli(['verify']);
    expect(actions.fullVerificationAction).toHaveBeenCalledWith({
      json: false,
    });
  });

  it('should pass --json through to verify', async () => {
    await loadCli(['verify', '--json']);
    expect(actions.fullVerificationAction).toHaveBeenCalledWith({
      json: true,
    });
  });

  it('should register chat command', async () => {
    await loadCli(['chat']);
    expect(chat.startChat).toHaveBeenCalledWith({});
  });

  it('should pass the folder and --model to chat', async () => {
    await loadCli(['chat', 'prob', '--model', 'google/gemma-4-31b-it']);
    expect(chat.startChat).toHaveBeenCalledWith({
      dir: 'prob',
      model: 'google/gemma-4-31b-it',
    });
  });

  it('should register cache status command', async () => {
    await loadCli(['cache', 'status']);
    expect(actions.cacheStatusAction).toHaveBeenCalled();
  });

  it('should register cache clear command', async () => {
    await loadCli(['cache', 'clear']);
    expect(actions.cacheClearAction).toHaveBeenCalled();
  });

  it('should enable the compilation cache by default', async () => {
    await loadCli(['verify']);
    expect(setCacheEnabled).toHaveBeenCalledWith(true);
  });

  it.each([
    ['verify'],
    ['generate', '--all'],
    ['validate', '--all'],
    ['run', 'main', '--all'],
    ['test', 'checker'],
  ])(
    'should disable the compilation cache for %s --no-cache',
    async (...argv) => {
      await loadCli([...argv, '--no-cache']);
      expect(setCacheEnabled).toHaveBeenCalledWith(false);
    }
  );

  it('should still pass --json to verify alongside --no-cache', async () => {
    await loadCli(['verify', '--json', '--no-cache']);
    expect(actions.fullVerificationAction).toHaveBeenCalledWith({
      json: true,
    });
  });

  it('should print a completion script for the given shell', async () => {
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    try {
      await loadCli(['completion', 'bash']);
      const output = write.mock.calls.map(call => String(call[0])).join('');
      expect(output).toContain('complete -o default -F _polyman_complete');
      expect(output).toContain('generate');
      expect(output).toContain('--testset');
      expect(output).toContain('--solutions');
      expect(output).not.toContain("'__complete'");
    } finally {
      write.mockRestore();
    }
  });

  it('should reject an unsupported shell for completion', async () => {
    const write = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    try {
      try {
        await loadCli(['completion', 'tcsh']);
      } catch {
        // commander may throw when exit is stubbed
      }
      expect(exitSpy).toHaveBeenCalledWith(1);
      expect(write.mock.calls.map(call => String(call[0])).join('')).toContain(
        'tcsh'
      );
    } finally {
      write.mockRestore();
      exitSpy.mockRestore();
    }
  });

  it('should print names from Config.json for __complete', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'polyman-cli-complete-'));
    writeFileSync(
      join(dir, 'Config.json'),
      JSON.stringify({ solutions: [{ name: 'main' }, { name: 'wa' }] })
    );
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(dir);
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    try {
      await loadCli(['__complete', 'solutions']);
      expect(write.mock.calls.map(call => String(call[0])).join('')).toBe(
        'main\nwa\n'
      );
    } finally {
      write.mockRestore();
      cwd.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    [['groups', 'tests'], 'samples\nmain\n'],
    [['groups', '--', 'tests'], 'samples\nmain\n'],
    [['groups', '--', '-t'], 'dash\n'],
    [['groups', '--', '--help'], 'help-group\n'],
  ])('should print the groups for __complete %j', async (argv, expected) => {
    const dir = mkdtempSync(join(tmpdir(), 'polyman-cli-complete-'));
    writeFileSync(
      join(dir, 'Config.json'),
      JSON.stringify({
        testsets: [
          { name: 'tests', groups: [{ name: 'samples' }, { name: 'main' }] },
          { name: '-t', groups: [{ name: 'dash' }] },
          { name: '--help', groups: [{ name: 'help-group' }] },
        ],
      })
    );
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(dir);
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    try {
      await loadCli(['__complete', ...argv]);
      expect(write.mock.calls.map(call => String(call[0])).join('')).toBe(
        expected
      );
    } finally {
      write.mockRestore();
      cwd.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should print nothing for __complete without a Config.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'polyman-cli-complete-'));
    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(dir);
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    try {
      await loadCli(['__complete', 'testsets']);
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
      cwd.mockRestore();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('should register remote register command', async () => {
    await loadCli(['remote', 'register', 'KEY', 'SECRET']);
    expect(actions.registerApiKeyAndSecretAction).toHaveBeenCalledWith(
      'KEY',
      'SECRET',
      expect.anything(),
      expect.anything()
    );
  });

  it('should register remote list command without owner', async () => {
    await loadCli(['remote', 'list']);
    expect(actions.remoteListProblemsAction).toHaveBeenCalledWith(undefined);
  });

  it('should register remote list command with owner', async () => {
    await loadCli(['remote', 'list', '--owner', 'tourist']);
    expect(actions.remoteListProblemsAction).toHaveBeenCalledWith('tourist');
  });

  it('should register remote pull command with options', async () => {
    await loadCli([
      'remote',
      'pull',
      '123',
      './out',
      '--solutions',
      '--checker',
    ]);
    expect(actions.remotePullProblemAction).toHaveBeenCalledWith(
      '123',
      './out',
      expect.objectContaining({ solutions: true, checker: true })
    );
  });

  it('should register remote pull command with --all', async () => {
    await loadCli(['remote', 'pull', '999', './dir', '--all']);
    expect(actions.remotePullProblemAction).toHaveBeenCalledWith(
      '999',
      './dir',
      expect.objectContaining({ all: true })
    );
  });

  it('should register remote pull with tests value', async () => {
    await loadCli(['remote', 'pull', '1', './x', '--tests', 'pretests,main']);
    expect(actions.remotePullProblemAction).toHaveBeenCalledWith(
      '1',
      './x',
      expect.objectContaining({ tests: 'pretests,main' })
    );
  });

  it('should register remote push command with options', async () => {
    await loadCli([
      'remote',
      'push',
      './prob',
      '--solutions',
      '--validator',
      '--metadata',
    ]);
    expect(actions.remotePushProblemAction).toHaveBeenCalledWith(
      './prob',
      expect.objectContaining({
        solutions: true,
        validator: true,
        metadata: true,
      })
    );
  });

  it('should register remote push command with --all', async () => {
    await loadCli(['remote', 'push', './p', '--all']);
    expect(actions.remotePushProblemAction).toHaveBeenCalledWith(
      './p',
      expect.objectContaining({ all: true })
    );
  });

  it('should pass --yes and --name through to remote push', async () => {
    await loadCli(['remote', 'push', './p', '--yes', '--name', 'two-sum']);
    expect(actions.remotePushProblemAction).toHaveBeenCalledWith(
      './p',
      expect.objectContaining({ yes: true, name: 'two-sum' })
    );
  });

  it('should accept the short -y and -n push flags', async () => {
    await loadCli(['remote', 'push', './p', '-y', '-n', 'max-flow']);
    expect(actions.remotePushProblemAction).toHaveBeenCalledWith(
      './p',
      expect.objectContaining({ yes: true, name: 'max-flow' })
    );
  });

  it('should accept the documented push form with -s -c', async () => {
    await loadCli(['remote', 'push', './my-problem', '-s', '-c']);
    expect(actions.remotePushProblemAction).toHaveBeenCalledWith(
      './my-problem',
      expect.objectContaining({ solutions: true, checker: true })
    );
  });

  it('should reject push with a problem id and a directory', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    const errSpy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(() => true);
    try {
      await loadCli(['remote', 'push', '123456', './my-problem']);
    } catch {
      // commander may throw when exit is stubbed
    }
    const stderr = errSpy.mock.calls.map(c => String(c[0])).join('');
    expect(stderr).toContain('too many arguments');
    // exit is stubbed, so commander carries on after reporting the error
    expect(exitSpy).toHaveBeenCalledWith(1);
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('should register remote view command', async () => {
    await loadCli(['remote', 'view', '42']);
    expect(actions.remoteViewProblemAction).toHaveBeenCalledWith('42', {
      json: false,
    });
  });

  it('should register remote commit command', async () => {
    await loadCli(['remote', 'commit', '42', 'msg']);
    expect(actions.remoteCommitProblemAction).toHaveBeenCalledWith(
      '42',
      'msg',
      { json: false }
    );
  });

  it('should register remote package command', async () => {
    await loadCli(['remote', 'package', '42', 'standard']);
    expect(actions.remotePackageProblemAction).toHaveBeenCalledWith(
      '42',
      'standard',
      { json: false }
    );
  });

  it('should pass --json to remote view, commit and package', async () => {
    await loadCli(['remote', 'view', '42', '--json']);
    expect(actions.remoteViewProblemAction).toHaveBeenCalledWith('42', {
      json: true,
    });
    await loadCli(['remote', 'commit', '42', 'msg', '--json']);
    expect(actions.remoteCommitProblemAction).toHaveBeenCalledWith(
      '42',
      'msg',
      { json: true }
    );
    await loadCli(['remote', 'package', '42', 'full', '--json']);
    expect(actions.remotePackageProblemAction).toHaveBeenCalledWith(
      '42',
      'full',
      { json: true }
    );
  });

  it('should pass --json to remote pull and push', async () => {
    await loadCli(['remote', 'pull', '42', './out', '--json']);
    expect(actions.remotePullProblemAction).toHaveBeenCalledWith(
      '42',
      './out',
      expect.objectContaining({ json: true })
    );
    await loadCli(['remote', 'push', '.', '--yes', '--json']);
    expect(actions.remotePushProblemAction).toHaveBeenCalledWith(
      '.',
      expect.objectContaining({ json: true, yes: true })
    );
  });

  it('should invoke custom help when --help is passed', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    try {
      await loadCli(['--help']);
    } catch {
      // commander may throw when exit is stubbed
    }
    expect(help.printComprehensiveHelp).toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  it('applies the detected theme to fmt and to help', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    try {
      await loadCli(['--help']);
    } catch {
      // commander may throw when exit is stubbed
    }
    const { fmt } =
      (await import('../src/formatter')) as typeof import('../src/formatter');
    const theme = vi.mocked(help.printComprehensiveHelp).mock.calls[0]?.[1];
    const light = createTheme('light', new Chalk({ level: 3 }));
    expect(theme?.name).toBe('light');
    expect(theme?.primary('p')).toBe(light.primary('p'));
    expect(fmt.primary('p')).toBe(light.primary('p'));
    exitSpy.mockRestore();
  });

  it('should invoke custom help when -h is passed', async () => {
    const exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => undefined) as never);
    try {
      await loadCli(['-h']);
    } catch {
      // commander may throw when exit is stubbed
    }
    expect(help.printComprehensiveHelp).toHaveBeenCalled();
    exitSpy.mockRestore();
  });

  describe('exit codes', () => {
    /**
     * Runs `generate --all` with the action rejecting. The errors module is
     * loaded after the module reset so `instanceof` in cli.ts sees the same
     * class the test throws.
     */
    const runFailing = async (
      makeError: (errors: typeof import('../src/errors')) => unknown
    ) => {
      vi.resetModules();
      const errors =
        (await import('../src/errors')) as typeof import('../src/errors');
      vi.mocked(actions.generateTestsAction).mockRejectedValueOnce(
        makeError(errors)
      );
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => undefined) as never);
      const log = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        process.argv = ['node', 'polyman', 'generate', '--all'];
        await import('../src/cli');
        await tick();
        return {
          exitCalls: exitSpy.mock.calls.map(call => call[0]),
          output: log.mock.calls.map(call => call.map(String).join(' ')),
        };
      } finally {
        exitSpy.mockRestore();
        log.mockRestore();
      }
    };

    it('should print a PolymanError with its hint and exit with its code', async () => {
      const { exitCalls, output } = await runFailing(
        ({ PolymanError }) =>
          new PolymanError('No validator defined', 2, 'Add one to Config.json')
      );
      expect(exitCalls).toEqual([2]);
      expect(output.join('\n')).toContain('No validator defined');
      expect(output.join('\n')).toContain('Add one to Config.json');
    });

    it.each([1, 2, 3, 4] as const)(
      'should exit with code %i when the PolymanError carries it',
      async code => {
        const { exitCalls } = await runFailing(
          ({ PolymanError }) => new PolymanError('failed', code)
        );
        expect(exitCalls).toEqual([code]);
      }
    );

    it('should print a thrown value that is not an Error and exit with 1', async () => {
      const { exitCalls, output } = await runFailing(() => 'plain string');
      expect(exitCalls).toEqual([1]);
      expect(output.join('\n')).toContain('plain string');
    });

    it('should not print a hint line when the error has none', async () => {
      const { exitCalls, output } = await runFailing(
        ({ PolymanError }) => new PolymanError('Some tests failed', 1)
      );
      expect(exitCalls).toEqual([1]);
      expect(output.join('\n')).toContain('Some tests failed');
      expect(output.join('\n')).not.toContain('Hint');
    });

    it('should exit with 1 for an unknown error', async () => {
      const { exitCalls, output } = await runFailing(
        () => new Error('something unexpected')
      );
      expect(exitCalls).toEqual([1]);
      expect(output.join('\n')).toContain('something unexpected');
    });

    it('should not exit when the action succeeds', async () => {
      const exitSpy = vi
        .spyOn(process, 'exit')
        .mockImplementation((() => undefined) as never);
      try {
        await loadCli(['generate', '--all']);
        expect(exitSpy).not.toHaveBeenCalled();
      } finally {
        exitSpy.mockRestore();
      }
    });
  });
});
