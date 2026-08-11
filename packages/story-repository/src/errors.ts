import { AppError } from "@jellytind/shared";

export type RepositoryErrorCode =
  | "not_a_project"
  | "invalid_manifest"
  | "unsupported_schema"
  | "already_exists"
  | "entity_not_found";

/** A Story Repository operation failure with a stable, machine-readable code. */
export class RepositoryError extends AppError {
  constructor(
    code: RepositoryErrorCode,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(code, message, options);
  }
}
