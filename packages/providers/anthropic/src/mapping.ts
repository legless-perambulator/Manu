import type { GenerateRequest, GenerateResult, StopReason } from "@jellytind/model-router";
import type { AnthropicRequestBody, AnthropicResponseBody } from "./wire";

/** Default max output tokens when a request does not specify one. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 1024;

/**
 * Translate a provider-independent {@link GenerateRequest} into an Anthropic
 * request body. Pure and fully unit-testable — no network, no SDK.
 */
export function toAnthropicRequest(model: string, request: GenerateRequest): AnthropicRequestBody {
  const body: AnthropicRequestBody = {
    model,
    max_tokens: request.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
  };
  if (request.system !== undefined) body.system = request.system;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.stopSequences !== undefined) body.stop_sequences = [...request.stopSequences];
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

/**
 * Translate an Anthropic response body into a provider-independent
 * {@link GenerateResult}. Concatenates text blocks and normalises usage.
 */
export function fromAnthropicResponse(body: AnthropicResponseBody): GenerateResult {
  const text = body.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("");
  return {
    text,
    usage: {
      inputTokens: body.usage.input_tokens,
      outputTokens: body.usage.output_tokens,
    },
    stopReason: mapStopReason(body.stop_reason),
  };
}
