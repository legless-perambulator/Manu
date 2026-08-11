/**
 * Anthropic Messages API wire shapes.
 *
 * These interfaces describe Anthropic's HTTP request/response bodies. They are
 * PRIVATE to this adapter and must never be re-exported: no Anthropic-specific
 * object may leak past the adapter boundary (AGENTS.md — "Provider
 * Independence"). Defining them locally (rather than importing a vendor SDK)
 * keeps the dependency graph clean and the mapping explicit and testable.
 */

export interface AnthropicToolWire {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicRequestBody {
  model: string;
  max_tokens: number;
  system?: string;
  temperature?: number;
  stop_sequences?: string[];
  stream?: boolean;
  tools?: AnthropicToolWire[];
  messages: AnthropicWireMessage[];
}

export interface AnthropicWireMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AnthropicContentBlock {
  type: string;
  text?: string;
  // tool_use blocks:
  id?: string;
  name?: string;
  input?: unknown;
}

export interface AnthropicResponseBody {
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

/** Shape of a streaming SSE `data:` payload (only the fields we consume). */
export interface AnthropicStreamData {
  type: string;
  delta?: { type?: string; text?: string; stop_reason?: string };
  content_block?: { type?: string; text?: string };
  message?: { stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } };
  usage?: { output_tokens?: number };
}
