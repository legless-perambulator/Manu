import { AppError } from "@jellytind/shared";

export type MysteryErrorCode = "unknown_mystery" | "unknown_clue" | "invalid_chain";

export class MysteryError extends AppError {
  constructor(
    code: MysteryErrorCode,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(code, message, options);
  }
}
