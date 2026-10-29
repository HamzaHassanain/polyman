/**
 * Knows every tool and runs each call through the same checks (doc 04):
 *
 * 1. the tool exists,
 * 2. the arguments were valid JSON,
 * 3. the arguments match the schema,
 * 4. there is a problem folder when the tool needs one,
 * 5. the permission gate allows it,
 * 6. the tool runs with a time limit,
 * 7. the content is cut to a size the model can read.
 *
 * A failure is an error output the model reads. The only throw is an abort
 * (the user cancelled), so the session can end the turn.
 */

import type { ToolSpec } from '../providers/types';
import { abortReason } from './permissions';
import { validate } from './schema';
import type {
  PermissionGate,
  Risk,
  Tool,
  ToolCall,
  ToolContext,
  ToolOutput,
  ToolRegistry,
} from './types';

/** Options of a {@link DefaultToolRegistry}. */
export interface ToolRegistryOptions {
  permissions: PermissionGate;
  /** Most bytes of `content` the model reads. 8192 by default. */
  capBytes?: number;
  /** Time limit of a tool without its own `timeoutMs`. 120000 by default. */
  defaultTimeoutMs?: number;
}

/** Bytes kept from the start of a long content. */
const HEAD_BYTES = 2048;

/** The reason we abort a tool with when its time is up. */
class ToolTimeout extends Error {
  constructor() {
    super('tool timed out');
    this.name = 'ToolTimeout';
  }
}

/** The {@link ToolRegistry} of a session. */
export class DefaultToolRegistry implements ToolRegistry {
  private readonly tools = new Map<string, Tool>();
  private readonly permissions: PermissionGate;
  private readonly capBytes: number;
  private readonly defaultTimeoutMs: number;

  constructor(opts: ToolRegistryOptions) {
    this.permissions = opts.permissions;
    this.capBytes = opts.capBytes ?? 8192;
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 120000;
  }

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  specs(): ToolSpec[] {
    return [...this.tools.values()].map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  riskOf(name: string): Risk | undefined {
    return this.tools.get(name)?.risk;
  }

  async run(call: ToolCall, ctx: ToolContext): Promise<ToolOutput> {
    const tool = this.tools.get(call.name);
    if (tool === undefined) {
      const names = [...this.tools.keys()].join(', ');
      return error(`Unknown tool "${call.name}". Tools you can use: ${names}`);
    }

    if (call.argsError !== undefined) {
      return error(
        `Your arguments were not valid JSON: ${call.argsError}. ` +
          `Call ${tool.name} again with a JSON object.`
      );
    }

    const problems = validate(tool.parameters, call.args);
    if (problems.length > 0) return error(problems.join('\n'));

    if (tool.needsProblem && ctx.problemDir === null) {
      return error(
        'There is no problem folder yet. Call create_problem first.'
      );
    }

    let verdict: Awaited<ReturnType<PermissionGate['check']>>;
    try {
      verdict = await this.permissions.check(tool, call.args, ctx.signal);
    } catch (err) {
      if (ctx.signal.aborted) throw abortReason(ctx.signal);
      return error(messageOf(err));
    }
    if (!verdict.allowed) {
      return { content: `The user denied this: ${verdict.reason}` };
    }

    const output = await this.runWithTimeout(tool, call.args, ctx);
    return { ...output, content: capContent(output.content, this.capBytes) };
  }

  private async runWithTimeout(
    tool: Tool,
    args: unknown,
    ctx: ToolContext
  ): Promise<ToolOutput> {
    const timeoutMs = tool.timeoutMs ?? this.defaultTimeoutMs;
    const controller = new AbortController();
    const onOuterAbort = (): void => controller.abort(abortReason(ctx.signal));
    if (ctx.signal.aborted) throw abortReason(ctx.signal);
    ctx.signal.addEventListener('abort', onOuterAbort, { once: true });

    // Rejects when the tool must stop, also when the tool ignores the signal.
    const stopped = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => reject(abortReason(controller.signal)),
        { once: true }
      );
    });
    stopped.catch(() => {});
    const timer = setTimeout(
      () => controller.abort(new ToolTimeout()),
      timeoutMs
    );

    const toolCtx: ToolContext = {
      problemDir: ctx.problemDir,
      signal: controller.signal,
      runner: ctx.runner,
      sandbox: ctx.sandbox,
      progress: line => ctx.progress(line),
      setProblemDir: dir => ctx.setProblemDir(dir),
    };

    try {
      const running = Promise.resolve().then(() => tool.run(args, toolCtx));
      running.catch(() => {});
      const output = await Promise.race([running, stopped]);
      return {
        ...output,
        content: typeof output.content === 'string' ? output.content : '',
      };
    } catch (err) {
      if (ctx.signal.aborted) throw abortReason(ctx.signal);
      if (controller.signal.reason instanceof ToolTimeout) {
        return error(`${tool.name} timed out after ${timeoutMs / 1000}s`);
      }
      return error(messageOf(err));
    } finally {
      clearTimeout(timer);
      ctx.signal.removeEventListener('abort', onOuterAbort);
    }
  }
}

/**
 * Cuts `content` to at most `capBytes` UTF-8 bytes. Keeps the first 2 KB and
 * the end, with `[... <n> bytes cut ...]` between them. Never splits a
 * character.
 */
export function capContent(content: string, capBytes: number): string {
  const buf = Buffer.from(content, 'utf8');
  if (buf.length <= capBytes) return content;

  const markerBytes = Buffer.byteLength(marker(buf.length));
  let headEnd = Math.min(HEAD_BYTES, Math.floor(capBytes / 2));
  let tailStart = buf.length - Math.max(0, capBytes - headEnd - markerBytes);

  while (headEnd > 0 && isContinuation(buf[headEnd])) headEnd--;
  while (tailStart < buf.length && isContinuation(buf[tailStart])) tailStart++;

  return (
    buf.subarray(0, headEnd).toString('utf8') +
    marker(tailStart - headEnd) +
    buf.subarray(tailStart).toString('utf8')
  );
}

function marker(cut: number): string {
  return `\n[... ${cut} bytes cut ...]\n`;
}

/** True for the 2nd, 3rd or 4th byte of a UTF-8 character. */
function isContinuation(byte: number | undefined): boolean {
  return byte !== undefined && (byte & 0xc0) === 0x80;
}

function error(content: string): ToolOutput {
  return { content, isError: true };
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
