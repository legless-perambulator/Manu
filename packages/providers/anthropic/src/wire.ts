/**
 * Anthropic Messages API wire shapes.
 *
 * These interfaces describe Anthropic's HTTP request/response bodies. They are
 * PRIVATE to this adapter and must never be re-exported: no Anthropic-specific
 * object may leak past the adapter boundary (AGENTS.md — "Provider
 * Independence"). Defining them locally (rather than importing a vendor SDK)
 * keeps the dependency graph clean and the mapping explicit and testable.
 */

export interface AnthropicRequestBody {
  model: string;
  max_tokens: number;
  system?: string;
  temperature?: number;
  stop_sequences?: string[];
  messages: AnthropicWireMessage[];
}

export interface AnthropicWireMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AnthropicResponseBody {
  content: Array<{ type: string; text?: string }>;
  stop_reason: string | null;
  usage: { input_tokens: number; output_tokens: number };
}
