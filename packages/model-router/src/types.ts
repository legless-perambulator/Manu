/**
 * Provider-independent language-model types.
 *
 * No provider-specific object (Anthropic, OpenAI, …) may appear in these types
 * or cross this boundary; adapters translate to and from their own wire formats
 * internally (AGENTS.md — "Provider Independence"; docs/MODEL_ROUTER.md).
 */

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
