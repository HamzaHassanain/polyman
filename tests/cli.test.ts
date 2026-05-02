import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as actions from '../src/actions';
import * as help from '../src/help';

vi.mock('../src/actions');
vi.mock('../src/help', () => ({
  printComprehensiveHelp: vi.fn(),
}));

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
    expect(actions.createTemplateAction).toHaveBeenCalledWith(
      'prob',
      expect.anything(),
      expect.anything()
    );
  });

  it('should register generate command', async () => {
    await loadCli(['generate', '--all']);
    expect(actions.generateTestsAction).toHaveBeenCalledWith('all', undefined);
  });

  it('should register list checkers command', async () => {
    await loadCli(['list', 'checkers']);
    expect(actions.listAvailableCheckersAction).toHaveBeenCalled();
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
    expect(actions.generateTestsAction).toHaveBeenCalledWith('main', 'samples');
  });

  it('should pass testset and index to generate', async () => {
    await loadCli(['generate', '--testset', 'main', '--index', '5']);
    expect(actions.generateTestsAction).toHaveBeenCalledWith('main', '5');
  });

  it('should pass only testset to generate when no modifier', async () => {
    await loadCli(['generate', '--testset', 'main']);
    expect(actions.generateTestsAction).toHaveBeenCalledWith('main', undefined);
  });

  it('should default generate target to all when nothing provided', async () => {
    await loadCli(['generate']);
    expect(actions.generateTestsAction).toHaveBeenCalledWith('all', undefined);
  });

  it('should register validate --all command', async () => {
    await loadCli(['validate', '--all']);
    expect(actions.validateTestsAction).toHaveBeenCalledWith('all', undefined);
  });

  it('should pass testset and group to validate', async () => {
    await loadCli(['validate', '--testset', 'pretest', '--group', 'g1']);
    expect(actions.validateTestsAction).toHaveBeenCalledWith('pretest', 'g1');
  });

  it('should pass testset and index to validate', async () => {
    await loadCli(['validate', '--testset', 'pretest', '--index', '3']);
    expect(actions.validateTestsAction).toHaveBeenCalledWith('pretest', '3');
  });

  it('should pass only testset to validate when no modifier', async () => {
    await loadCli(['validate', '--testset', 'pretest']);
    expect(actions.validateTestsAction).toHaveBeenCalledWith(
      'pretest',
      undefined
    );
  });

  it('should register run command with --all', async () => {
    await loadCli(['run', 'main', '--all']);
    expect(actions.runSolutionAction).toHaveBeenCalledWith(
      'main',
      'all',
      undefined
    );
  });

  it('should pass testset and group to run', async () => {
    await loadCli(['run', 'sol', '--testset', 'ts', '--group', 'gp']);
    expect(actions.runSolutionAction).toHaveBeenCalledWith('sol', 'ts', 'gp');
  });

  it('should pass testset and index to run', async () => {
    await loadCli(['run', 'sol', '--testset', 'ts', '--index', '7']);
    expect(actions.runSolutionAction).toHaveBeenCalledWith('sol', 'ts', '7');
  });

  it('should pass only testset to run when no modifier', async () => {
    await loadCli(['run', 'sol', '--testset', 'ts']);
    expect(actions.runSolutionAction).toHaveBeenCalledWith(
      'sol',
      'ts',
      undefined
    );
  });

  it('should default run target to all when nothing provided', async () => {
    await loadCli(['run', 'sol']);
    expect(actions.runSolutionAction).toHaveBeenCalledWith(
      'sol',
      'all',
      undefined
    );
  });

  it('should register test command', async () => {
    await loadCli(['test', 'validator']);
    expect(actions.testWhatAction).toHaveBeenCalledWith(
      'validator',
      expect.anything(),
      expect.anything()
    );
  });

  it('should register verify command', async () => {
    await loadCli(['verify']);
    expect(actions.fullVerificationAction).toHaveBeenCalled();
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

  it('should register remote view command', async () => {
    await loadCli(['remote', 'view', '42']);
    expect(actions.remoteViewProblemAction).toHaveBeenCalledWith(
      '42',
      expect.anything(),
      expect.anything()
    );
  });

  it('should register remote commit command', async () => {
    await loadCli(['remote', 'commit', '42', 'msg']);
    expect(actions.remoteCommitProblemAction).toHaveBeenCalledWith(
      '42',
      'msg',
      expect.anything(),
      expect.anything()
    );
  });

  it('should register remote package command', async () => {
    await loadCli(['remote', 'package', '42', 'standard']);
    expect(actions.remotePackageProblemAction).toHaveBeenCalledWith(
      '42',
      'standard',
      expect.anything(),
      expect.anything()
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
});
