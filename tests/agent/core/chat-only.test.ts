import { describe, it, expect } from 'vitest';
import { AgentSession } from '../../../src/agent/core/session';
import type { ChatOnlySwitch } from '../../../src/agent/core/session-types';
import { Capabilities } from '../../../src/agent/providers/capabilities';
import { MockProvider } from '../../../src/agent/providers/mock';
import { ProviderError } from '../../../src/agent/providers/types';
import { FakeTools, makeDeps, textTool } from './fakes';

/** The chat's switch: a Capabilities table for one provider and model. */
function switchFor(
  caps: Capabilities,
  providerId = 'openrouter',
  modelId = 'x/y'
): ChatOnlySwitch {
  return {
    active: () => caps.isChatOnly(providerId, modelId),
    notice: () =>
      `${providerId}/${modelId} does not support tools. It can only chat.`,
    noteError: e => caps.noteError(providerId, modelId, e) !== undefined,
  };
}

const tools = () =>
  new FakeTools({ read_file: textTool('hi') }, { read_file: 'read' });

describe('AgentSession in chat-only mode', () => {
  it('offers no tools and shows the notice once when known up front', async () => {
    const provider = new MockProvider([{ text: 'hello' }, { text: 'again' }]);
    const caps = new Capabilities(
      {},
      { 'openrouter/x/y': { id: 'x/y', supportsTools: false } }
    );
    const deps = makeDeps(provider, tools(), { chatOnly: switchFor(caps) });
    const session = new AgentSession(deps);

    expect(await session.send('hi')).toBe('done');
    expect(await session.send('more')).toBe('done');

    expect(provider.requests.map(r => r.tools)).toEqual([[], []]);
    const notices = deps.events.filter(e => e.type === 'notice');
    expect(notices).toEqual([
      expect.objectContaining({
        type: 'notice',
        level: 'warn',
        text: expect.stringContaining('does not support tools') as string,
      }),
    ]);
    // The notice is for the user, never part of the conversation.
    expect(JSON.stringify(session.messages)).not.toContain('support tools');
  });

  it('turns tools off after tools_not_supported and asks again', async () => {
    const provider = new MockProvider([
      {
        error: new ProviderError(
          'tools_not_supported',
          'No endpoints found that support tool use.'
        ),
      },
      { text: 'I can only talk about it.' },
      { text: 'still talking' },
    ]);
    const caps = new Capabilities();
    const deps = makeDeps(provider, tools(), { chatOnly: switchFor(caps) });
    const session = new AgentSession(deps);

    expect(await session.send('build it')).toBe('done');
    expect(caps.isChatOnly('openrouter', 'x/y')).toBe(true);
    expect(provider.requests[0]?.tools.map(t => t.name)).toEqual(['read_file']);
    expect(provider.requests[1]?.tools).toEqual([]);
    expect(deps.events.filter(e => e.type === 'notice')).toHaveLength(1);
    expect(deps.events.some(e => e.type === 'turn_end' && e.error)).toBe(false);

    // The next turn has no tools and no second notice.
    expect(await session.send('and now?')).toBe('done');
    expect(provider.requests[2]?.tools).toEqual([]);
    expect(deps.events.filter(e => e.type === 'notice')).toHaveLength(1);
  });

  it('still ends with error for other provider errors', async () => {
    const provider = new MockProvider([
      { error: new ProviderError('bad_request', 'bad thing') },
    ]);
    const caps = new Capabilities();
    const deps = makeDeps(provider, tools(), { chatOnly: switchFor(caps) });
    expect(await new AgentSession(deps).send('hi')).toBe('error');
    expect(caps.isChatOnly('openrouter', 'x/y')).toBe(false);
    expect(deps.events.some(e => e.type === 'notice')).toBe(false);
  });

  it('ends with error on tools_not_supported without a switch', async () => {
    const provider = new MockProvider([
      { error: new ProviderError('tools_not_supported', 'no tools') },
    ]);
    const deps = makeDeps(provider, tools());
    expect(await new AgentSession(deps).send('hi')).toBe('error');
  });

  it('does not loop when the error comes with no tools offered', async () => {
    const provider = new MockProvider([
      { error: new ProviderError('tools_not_supported', 'no tools') },
    ]);
    const caps = new Capabilities(
      {},
      { 'openrouter/x/y': { id: 'x/y', supportsTools: false } }
    );
    const deps = makeDeps(provider, tools(), { chatOnly: switchFor(caps) });
    expect(await new AgentSession(deps).send('hi')).toBe('error');
    expect(provider.requests).toHaveLength(1);
  });
});
