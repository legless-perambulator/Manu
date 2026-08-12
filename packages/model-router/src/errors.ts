import { AppError } from "@jellytind/shared";

/**
 * Typed failure categories for model operations. Callers switch on the code
 * rather than parsing provider-specific error strings, keeping core code free of
 * any provider's SDK (docs/MODEL_ROUTER.md).
 */
export type ModelErrorCode =
  | "network"
  | "rate_limit"
  | "auth"
  | "invalid_output"
  | "timeout"
  | "cancelled"
  | "unsupported"
  | "provider_error";

export class ModelError extends AppError {
  readonly modelCode: ModelErrorCode;

  constructor(
    modelCode: ModelErrorCode,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(`model_${modelCode}`, message, options);
    this.modelCode = modelCode;
  }

  /** Whether retrying the same request could plausibly succeed. */
  get retryable(): boolean {
    return (
      this.modelCode === "rate_limit" ||
      this.modelCode === "network" ||
      this.modelCode === "timeout"
    );
  }
}

/** A capability (streaming / structured / tools) the model does not support. */
export function unsupportedCapability(modelId: string, capability: string): ModelError {
  return new ModelError("unsupported", `Model "${modelId}" does not support ${capability}.`, {
    details: { modelId, capability },
  });
}
