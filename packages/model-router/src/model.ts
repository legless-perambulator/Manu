import { ValidationError } from "@jellytind/shared";
import type {
  GenerateRequest,
  GenerateResult,
  OutputSchema,
  StreamEvent,
  StructuredRequest,
  ToolCallRequest,
  ToolCallResult,
} from "./types";

/**
 * The single abstraction every model provider implements. Application code,
 * agents and the Context Compiler depend only on this interface — never on a
 * concrete provider SDK (docs/MODEL_ROUTER.md).
 */
export interface LanguageModel {
  /** Stable identifier for logging / cost attribution, e.g. "anthropic:claude-x". */
  readonly id: string;

  /** Single-shot generation. */
  generate(request: GenerateRequest): Promise<GenerateResult>;

  /** Token/'event'-level streaming. */
  stream(request: GenerateRequest): AsyncIterable<StreamEvent>;

  /** Generate and validate structured output against a schema. */
  generateStructured<T>(request: StructuredRequest<T>): Promise<T>;

  /** Tool-calling turn. Planned; Phase-0 stubs may throw NotImplementedError. */
  generateWithTools(request: ToolCallRequest): Promise<ToolCallResult>;
}

/**
 * Parse-and-validate raw model text as structured output of type `T`.
 *
 * This is the reusable guard that stands between a model and the project:
 * malformed JSON or schema violations become a {@link ValidationError} rather
 * than corrupt data. Reuse it in every `generateStructured` implementation.
 */
export function parseModelJson<T>(schema: OutputSchema<T>, rawText: string): T {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch (cause) {
    throw new ValidationError(`Model output for "${schema.name}" was not valid JSON.`, {
      cause,
      details: { rawText },
    });
  }
  try {
    return schema.parse(json);
  } catch (cause) {
    throw new ValidationError(`Model output for "${schema.name}" failed schema validation.`, {
      cause,
      details: { json },
    });
  }
}
