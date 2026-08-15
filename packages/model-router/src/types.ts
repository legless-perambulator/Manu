/**
 * Provider-independent language-model types.
 *
 * No provider-specific object (Anthropic, OpenAI, …) may appear in these types
 * or cross this boundary; adapters translate to and from their own wire formats
 * internally (AGENTS.md — "Provider Independence"; docs/MODEL_ROUTER.md).
 */

/** What a model can do. Providers need not support every capability. */
export interface ModelCapabilities {
  readonly streaming: boolean;
  readonly structuredOutput: boolean;
  readonly tools: boolean;
}

/** Per-call controls, provider-independent. */
export interface RequestOptions {
  /** Abort the request (maps to a `cancelled` failure). */
  readonly signal?: AbortSignal;
  /** Client-side timeout in milliseconds (maps to a `timeout` failure). */
  readonly timeoutMs?: number;
  /**
   * Told the provider-reported token usage of every completed call, including
   * calls whose method does not return usage in its result (notably
   * `generateStructured`). Every adapter MUST invoke this once per billed
   * round trip, so cost accounting sees actual usage rather than estimates
   * (Phase 36 §10).
   */
  readonly onUsage?: (usage: TokenUsage) => void;
}

export type MessageRole = "user" | "assistant";

export interface ModelMessage {
  readonly role: MessageRole;
  /** Plain text for Phase 0. Multimodal/content-parts are planned. */
  readonly content: string;
}

export interface GenerateRequest {
  /** System instruction, kept separate from the message list. */
  readonly system?: string;
  readonly messages: readonly ModelMessage[];
  readonly maxOutputTokens?: number;
  readonly temperature?: number;
  readonly stopSequences?: readonly string[];
}

export type StopReason = "stop" | "max_tokens" | "stop_sequence" | "tool_use" | "other";

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  /** Input tokens served from the provider's cache, when it said (§10). */
  readonly cachedInputTokens?: number;
}

export interface GenerateResult {
  readonly text: string;
  readonly usage: TokenUsage;
  readonly stopReason: StopReason;
}

/** Streaming events. Adapters normalise provider streams into these. */
export type StreamEvent =
  | { readonly type: "text-delta"; readonly delta: string }
  | { readonly type: "done"; readonly usage: TokenUsage; readonly stopReason: StopReason };

/**
 * A provider-independent validating schema for structured output. A concrete
 * schema library (e.g. Zod) implements this in an adapter; core code depends
 * only on `parse`, which MUST throw on invalid input so malformed model output
 * can never mutate the project (AGENTS.md — "Structured LLM Output").
 */
export interface OutputSchema<T> {
  readonly name: string;
  parse(value: unknown): T;
}

export interface StructuredRequest<T> extends GenerateRequest {
  readonly schema: OutputSchema<T>;
}

/** Minimal JSON-schema-ish description of a tool's input (tool calling: planned). */
export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
}

export interface ToolCallRequest extends GenerateRequest {
  readonly tools: readonly ToolDefinition[];
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
}

export interface ToolCallResult {
  readonly text: string;
  readonly toolCalls: readonly ToolCall[];
  readonly usage: TokenUsage;
  readonly stopReason: StopReason;
}
