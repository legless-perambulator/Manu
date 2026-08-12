import { AppError } from "@jellytind/shared";

export type CompileErrorCode = "unknown_recipe" | "unknown_target" | "invalid_budget";

/** A compile that could not proceed — a missing target, or an unusable budget. */
export class CompileError extends AppError {
  readonly compileCode: CompileErrorCode;

  constructor(
    compileCode: CompileErrorCode,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(`context_${compileCode}`, message, options);
    this.compileCode = compileCode;
  }
}
