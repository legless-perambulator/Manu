import {
  ModelError,
  type GenerateRequest,
  type GenerateResult,
  type StopReason,
  type StreamEvent,
  type ToolCall,
  type ToolCallResult,
  type ToolDefinition,
} from "@jellytind/model-router";
import type {
  AnthropicContentBlock,
  AnthropicRequestBody,
  AnthropicResponseBody,
  AnthropicStreamData,
  AnthropicToolWire,
} from "./wire";

/** Default max output tokens when a request does not specify one. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

/** Map our provider-independent tool definitions onto Anthropic's tool wire shape. */
function toAnthropicTools(tools: readonly ToolDefinition[]): AnthropicToolWire[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: { ...tool.inputSchema },
  }));
}

/**
 * Translate a provider-independent {@link GenerateRequest} into an Anthropic
 * request body. Pure and fully unit-testable — no network, no SDK. When `stream`
 * is set or the request carries `tools`, the corresponding wire fields are added.
 */
export function toAnthropicRequest(
  model: string,
  request: GenerateRequest,
  extras?: { stream?: boolean; tools?: readonly ToolDefinition[] },
): AnthropicRequestBody {
  const body: AnthropicRequestBody = {
    model,
    max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (request.system !== undefined) body.system = request.system;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.stopSequences !== undefined) body.stop_sequences = [...request.stopSequences];
  if (extras?.stream === true) body.stream = true;
  if (extras?.tools !== undefined && extras.tools.length > 0) {
    body.tools = toAnthropicTools(extras.tools);
  }
  return body;
}

/** Map Anthropic's `stop_reason` strings onto our normalised {@link StopReason}. */
export function mapStopReason(reason: string | null): StopReason {
  switch (reason) {
    case "end_turn":
      return "stop";
    case "max_tokens":
      return "max_tokens";
    case "stop_sequence":
      return "stop_sequence";
    case "tool_use":
      return "tool_use";
    default:
      return "other";
  }
}

/** Concatenate the `text` blocks of a content array. */
function joinText(content: readonly AnthropicContentBlock[]): string {
  return content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

/** Extract `tool_use` blocks as provider-independent {@link ToolCall}s. */
function extractToolCalls(content: readonly AnthropicContentBlock[]): ToolCall[] {
  return content
    .filter((block) => block.type === "tool_use")
    .map((block) => ({
      id: block.id ?? "",
      name: block.name ?? "",
      input: block.input,
    }));
}

/**
 * Translate an Anthropic response body into a provider-independent
 * {@link GenerateResult}. Concatenates text blocks and normalises usage.
 */
export function fromAnthropicResponse(body: AnthropicResponseBody): GenerateResult {
  return {
    text: joinText(body.content),
    usage: {
      inputTokens: body.usage.input_tokens,
      outputTokens: body.usage.output_tokens,
    },
    stopReason: mapStopReason(body.stop_reason),
  };
}

/** Translate an Anthropic tool-calling response into a {@link ToolCallResult}. */
export function fromAnthropicToolResponse(body: AnthropicResponseBody): ToolCallResult {
  return {
    text: joinText(body.content),
    toolCalls: extractToolCalls(body.content),
    usage: {
      inputTokens: body.usage.input_tokens,
      outputTokens: body.usage.output_tokens,
    },
    stopReason: mapStopReason(body.stop_reason),
  };
}

/**
 * Translate a single decoded Anthropic stream frame into a provider-independent
 * {@link StreamEvent}, or `null` for frames that carry no user-visible event.
 * The adapter threads running usage/stop-reason state so a terminal `done`
 * event can report totals.
 */
export function mapStreamData(
  data: AnthropicStreamData,
  state: { outputTokens: number; stopReason: StopReason; inputTokens: number },
): StreamEvent | null {
  switch (data.type) {
    case "message_start": {
      const usage = data.message?.usage;
      if (usage?.input_tokens !== undefined) state.inputTokens = usage.input_tokens;
      if (usage?.output_tokens !== undefined) state.outputTokens = usage.output_tokens;
      return null;
    }
    case "content_block_delta": {
      const delta = data.delta?.text;
      if (delta !== undefined && delta !== "") return { type: "text-delta", delta };
      return null;
    }
    case "message_delta": {
      if (data.delta?.stop_reason !== undefined && data.delta.stop_reason !== null) {
        state.stopReason = mapStopReason(data.delta.stop_reason);
      }
      if (data.usage?.output_tokens !== undefined) state.outputTokens = data.usage.output_tokens;
      return null;
    }
    case "message_stop":
      return {
        type: "done",
        usage: { inputTokens: state.inputTokens, outputTokens: state.outputTokens },
        stopReason: state.stopReason,
      };
    default:
      return null;
  }
}

/**
 * Map a non-ok HTTP status to a typed {@link ModelError}. Keeps provider status
 * codes from leaking past the adapter: callers switch on `modelCode` instead
 * (docs/MODEL_ROUTER.md — "Failure Handling").
 */
export function errorFromStatus(status: number, body: string): ModelError {
  const details = { status, body };
  if (status === 401 || status === 403) {
    return new ModelError("auth", "Anthropic authentication failed.", { details });
  }
  if (status === 429) {
    return new ModelError("rate_limit", "Anthropic rate limit exceeded.", { details });
  }
  if (status >= 500) {
    return new ModelError("provider_error", `Anthropic server error (${status}).`, { details });
  }
  return new ModelError("provider_error", `Anthropic request failed (${status}).`, { details });
}

/**
 * Normalise an exception thrown while performing the request (network failure,
 * abort, timeout) into a typed {@link ModelError}. An already-typed error passes
 * through unchanged.
 */
export function errorFromThrown(cause: unknown): ModelError {
  if (cause instanceof ModelError) return cause;
  const name = cause instanceof Error ? cause.name : "";
  if (name === "AbortError") {
    return new ModelError("cancelled", "Request was cancelled.", { cause });
  }
  if (name === "TimeoutError") {
    return new ModelError("timeout", "Request timed out.", { cause });
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  return new ModelError("network", `Network request to Anthropic failed: ${message}`, { cause });
}
