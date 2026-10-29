import { describe, it, expect } from 'vitest';
import * as events from '../../src/agent/core/events';
import * as session from '../../src/agent/core/session-types';
import * as runner from '../../src/agent/runner/types';
import * as tools from '../../src/agent/tools/types';
import * as workflow from '../../src/agent/workflow/types';

describe('agent contracts', () => {
  it('load without errors', () => {
    for (const mod of [events, session, runner, tools, workflow]) {
      expect(mod).toBeTypeOf('object');
    }
  });

  it('has the workflow limits', () => {
    expect(workflow.WORKFLOW_LIMITS).toEqual({
      parallel: 4,
      workerStepsSimple: 8,
      workerStepsHard: 12,
      fixRounds: 3,
    });
  });

  it('has a named SandboxError', () => {
    const error = new tools.SandboxError('outside the problem folder');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SandboxError');
    expect(error.message).toBe('outside the problem folder');
  });
});
