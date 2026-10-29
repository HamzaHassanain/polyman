/**
 * The contract of the agent session: the loop that asks the model, runs the
 * tools it asks for and repeats. The chat and every workflow worker use it.
 */

import type { ApprovalDecision, EventBus } from './events';
import type { Message } from './messages';
import type { Provider } from '../providers/types';
import type { PermissionGate, ToolContext, ToolRegistry } from '../tools/types';

/**
 * Tells the session when the model can only chat (no tool support). The
 * chat builds it from `Capabilities`; workers have none.
 */
export interface ChatOnlySwitch {
  /** True when the model can only chat: no tools are offered to it. */
  active(): boolean;
  /** The message for the user, like `chatOnlyNotice()`. */
  notice(): string;
  /**
   * Looks at a failed model call. Returns true when it says the model has
   * no tool support: tools are now off. Else the error ends the turn.
   */
  noteError(error: unknown): boolean;
}

/** Everything a session needs. */
export interface AgentSessionDeps {
  provider: Provider;
  /** Model id, like 'google/gemma-4-31b-it'. */
  model: string;
  tools: ToolRegistry;
  permissions: PermissionGate;
  bus: EventBus;
  /** Builds the system prompt before each model call. */
  buildSystemPrompt(): Promise<string>;
  /** Makes the context for one tool call. */
  makeToolContext(signal: AbortSignal): ToolContext;
  /** Keys to redact from errors (`KeyStore.knownKeys`). */
  secrets(): string[];
  /** Model calls per turn: 20 for chat, 8 or 12 for workers. */
  maxSteps: number;
  /** Context budget: 32000 for chat, 16000 for workers. */
  contextBudgetTokens: number;
  /** Upper bound on generated tokens per call, 8000. */
  maxOutputTokens: number;
  /** Sampling temperature, 0.3. */
  temperature: number;
  /**
   * Chat-only mode. When it is active the model gets no tools, and the user
   * sees its notice once. Without it the session always offers the tools.
   */
  chatOnly?: ChatOnlySwitch;
}

/** What the UI and the workflow use of a session. */
export interface AgentSessionApi {
  /** The conversation so far. */
  readonly messages: readonly Message[];
  /** Runs one turn for a user message, and says how it ended. */
  send(text: string): Promise<'done' | 'cancelled' | 'max_steps' | 'error'>;
  /** Stops the running turn. */
  cancel(): void;
  /** Answers a waiting tool approval. */
  resolveApproval(approvalId: string, decision: ApprovalDecision): void;
}
