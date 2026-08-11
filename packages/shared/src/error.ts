/**
 * Base application error carrying a stable machine-readable `code` and optional
 * structured `details`. Subsystems extend this so that failures are inspectable
 * and attributable rather than opaque strings.
 */
export class AppError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(
    code: string,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.code = code;
    this.details = options?.details;
  }
}

/**
 * A structured-output / schema validation failure. Raised when model output (or
 * any external data) does not conform to an expected schema. Never allow such a
 * value to mutate the project (see AGENTS.md — "Structured LLM Output").
 */
export class ValidationError extends AppError {
  constructor(message: string, options?: { cause?: unknown; details?: Record<string, unknown> }) {
    super("validation_error", message, options);
  }
}

/**
 * A feature that is declared in the architecture but not yet implemented.
 * Used by intentional Phase-0 stubs so that "planned" surfaces fail loudly
 * rather than silently returning wrong data.
 */
export class NotImplementedError extends AppError {
  constructor(feature: string) {
    super("not_implemented", `Not implemented yet: ${feature}`);
  }
}
