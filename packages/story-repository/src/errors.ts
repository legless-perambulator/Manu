import { AppError } from "@jellytind/shared";

export type RepositoryErrorCode =
  | "not_a_project"
  | "invalid_manifest"
  | "unsupported_schema"
  | "already_exists"
  | "entity_not_found"
  | "invalid_reference"
  | "has_references"
  | "branch_not_found"
  | "invalid_branch_operation";

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
