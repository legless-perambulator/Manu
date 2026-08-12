import { ModelError } from "./errors";
import type {
  GenerateRequest,
  GenerateResult,
  ModelCapabilities,
  OutputSchema,
  RequestOptions,
  StreamEvent,
  StructuredRequest,
  ToolCallRequest,
  ToolCallResult,
} from "./types";

/**
 * The single abstraction every model provider implements. Application code,
 * agents and the Context Compiler depend only on this interface — never on a
 * concrete provider SDK (docs/MODEL_ROUTER.md).
 *
 * A provider need not support every capability; unsupported calls fail with a
 * typed `ModelError` of code `"unsupported"`. Inspect {@link capabilities}
 * before calling optional methods.
 */
export interface LanguageModel {
  /** Stable identifier for logging / cost attribution, e.g. "anthropic:claude-x". */
  readonly id: string;

  readonly capabilities: ModelCapabilities;

  /** Single-shot text generation. */
  generateText(request: GenerateRequest, options?: RequestOptions): Promise<GenerateResult>;

  /** Token/event-level streaming. */
  streamText(request: GenerateRequest, options?: RequestOptions): AsyncIterable<StreamEvent>;

  /** Generate and schema-validate structured output. */
  generateStructured<T>(request: StructuredRequest<T>, options?: RequestOptions): Promise<T>;

  /** A tool-calling turn. */
  runWithTools(request: ToolCallRequest, options?: RequestOptions): Promise<ToolCallResult>;
}

/**
 * Parse-and-validate raw model text as structured output of type `T`.
 *
 * The reusable guard between a model and the project: malformed JSON or schema
 * violations become a `ModelError("invalid_output")` rather than corrupt data,
 * so malformed output can never mutate project state (AGENTS.md — "Structured
 * LLM Output"). Reuse it in every `generateStructured` implementation.
 */
export function parseModelJson<T>(schema: OutputSchema<T>, rawText: string): T {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch (cause) {
    throw new ModelError(
      "invalid_output",
      `Model output for "${schema.name}" was not valid JSON.`,
      {
        cause,
        details: { rawText },
      },
    );
  }
  try {
    return schema.parse(json);
  } catch (cause) {
    throw new ModelError(
      "invalid_output",
      `Model output for "${schema.name}" failed schema validation.`,
      { cause, details: { json } },
    );
  }
}
