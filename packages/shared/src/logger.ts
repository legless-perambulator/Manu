/**
 * Minimal structured logging interface. Application services and the agent
 * runtime log through this rather than calling `console` directly, so output
 * can later be routed to the activity panel, files, or telemetry.
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** A logger that discards everything. Handy default for tests and libraries. */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
