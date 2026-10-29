import { describe, it, expect } from 'vitest';
import { findTextToolCall } from '../../../src/agent/core/text-tool-call';

const TOOLS = ['verify', 'read_file'];

describe('findTextToolCall', () => {
  it('finds a JSON object with a known tool name', () => {
    expect(
      findTextToolCall(
        '```json\n{"name": "verify", "arguments": {}}\n```',
        TOOLS
      )
    ).toBe('verify');
    expect(
      findTextToolCall('{ "arguments": {"path": "a"}, "name":"read_file" }', [
        ...TOOLS,
      ])
    ).toBe('read_file');
  });

  it('finds a line like verify({...})', () => {
    expect(findTextToolCall('I will run:\nverify({"all": true})', TOOLS)).toBe(
      'verify'
    );
    expect(findTextToolCall('  `read_file({ path: "a" })`', TOOLS)).toBe(
      'read_file'
    );
  });

  it('ignores unknown names and plain text', () => {
    expect(findTextToolCall('{"name": "deploy"}', TOOLS)).toBeNull();
    expect(findTextToolCall('deploy({})', TOOLS)).toBeNull();
    expect(
      findTextToolCall('I will verify the problem now.', TOOLS)
    ).toBeNull();
    expect(findTextToolCall('{"name": "verify"}', [])).toBeNull();
  });
});
