import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as actions from '../src/actions';

vi.mock('../src/actions');

describe('cli.ts', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.argv = [...originalArgv]; // Reset argv
  });

  afterEach(() => {
    process.argv = originalArgv;
  });

  it('should register new command', async () => {
    process.argv = ['node', 'polyman', 'new', 'prob'];
    await import('../src/cli');
    // We need to wait for the command to be parsed and action to be called
    // Since actions are async, we might need to wait a tick
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(actions.createTemplateAction).toHaveBeenCalledWith(
      'prob',
      expect.anything(),
      expect.anything()
    );
  });

  it('should register generate command', async () => {
    process.argv = ['node', 'polyman', 'generate', '--all'];
    await import('../src/cli');
    await new Promise(resolve => setTimeout(resolve, 10));
    // Commander passes arguments. generatedTestsAction takes (target, modifier)?
    // In cli.ts: .action(async (options) => { ... })
    // The action handler calls generateTestsAction.
    // Wait, the action handler IS NOT generateTestsAction directly.
    // It's an anonymous async function calling generateTestsAction.
    // We can't spy on anonymous function easily, but we can spy on generateTestsAction calls.

    // Since we import cli, it executes.
    // We verify generateTestsAction is called
    expect(actions.generateTestsAction).toHaveBeenCalledWith('all', undefined);
  });

  it('should register list checkers command', async () => {
    process.argv = ['node', 'polyman', 'list', 'checkers'];
    await import('../src/cli');
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(actions.listAvailableCheckersAction).toHaveBeenCalled();
  });
});
