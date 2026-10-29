/**
 * The contract of the agent session: the loop that asks the model, runs the
 * tools it asks for and repeats. The chat and every workflow worker use it.
 */

import type { ApprovalDecision, EventBus } from './events';
import type { Message } from './messages';
import type { Provider } from '../providers/types';
import type { PermissionGate, ToolContext, ToolRegistry } from '../tools/types';

/** Everything a session needs. */
export interface AgentSessionDeps {
  provider: Provider;
  /** Model id, 'google/gemma-4-31b-it' by default. */
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
