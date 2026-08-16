/**
 * Structured logging and diagnostics (Phase 46 §7–§9, §32).
 *
 * One logger, three rules:
 *
 * 1. **Redaction before storage.** Anything shaped like a credential is
 *    replaced before it ever enters the buffer, so no later export can leak
 *    what was never kept.
 * 2. **No manuscript text.** Nothing in this module reads prose; the bundle
 *    is built from metadata alone, and there is no flag that changes that.
 * 3. **Local only.** No telemetry, no remote crash reporting — the bundle
 *    exists as a file the writer exports and sends deliberately, or not at
 *    all. That is the conservative default §33 asks for; a remote channel,
 *    if one ever exists, would be a separate explicit opt-in.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  readonly at: string;
  readonly level: LogLevel;
  readonly area: string;
  readonly message: string;
}

const MAX_ENTRIES = 500;
const buffer: LogEntry[] = [];

const REDACTIONS: ReadonlyArray<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted-key]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[redacted-key]"],
  [/\b(Bearer)\s+[A-Za-z0-9._-]{8,}/gi, "$1 [redacted]"],
  [
    /("?(?:api[_-]?key|apikey|token|secret|password|authorization)"?\s*[:=]\s*)"[^"]*"/gi,
    '$1"[redacted]"',
  ],
];

/** Strip anything credential-shaped. Applied to every stored message. */
export function redact(text: string): string {
  let out = text;
  for (const [pattern, replacement] of REDACTIONS) out = out.replace(pattern, replacement);
  return out;
}

export function log(level: LogLevel, area: string, message: string): void {
  buffer.push({
    at: new Date().toISOString(),
    level,
    area,
    message: redact(message).slice(0, 500),
  });
  if (buffer.length > MAX_ENTRIES) buffer.splice(0, buffer.length - MAX_ENTRIES);
}

export function recentLogs(): readonly LogEntry[] {
  return [...buffer];
}

/** Wire unhandled errors into the buffer. Called once at startup. */
export function captureGlobalErrors(): void {
  window.addEventListener("error", (event) => {
    log(
      "error",
      "window",
      `${event.message} (${event.filename ?? "?"}:${String(event.lineno ?? 0)})`,
    );
  });
  window.addEventListener("unhandledrejection", (event) => {
    const reason =
      event.reason instanceof Error
        ? (event.reason.stack ?? event.reason.message)
        : String(event.reason);
    log("error", "promise", reason);
  });
}

export interface DiagnosticsBundle {
  readonly kind: "manu-diagnostics";
  readonly at: string;
  readonly appVersion: string;
  readonly os: string;
  /** Provider metadata without keys: which providers, which model ids. */
  readonly providers: ReadonlyArray<{
    readonly providerId: string;
    readonly models: readonly string[];
  }>;
  readonly extensions: ReadonlyArray<{
    readonly id: string;
    readonly version: string;
    readonly enabled: boolean;
  }>;
  readonly logs: readonly LogEntry[];
  /** The tester's report, front and centre (§32). */
  readonly report: { readonly whatHappened: string; readonly whatWasExpected: string };
}

export function buildDiagnosticsBundle(input: {
  readonly appVersion: string;
  readonly providers?: ReadonlyArray<{ providerId: string; models: readonly string[] }>;
  readonly extensions?: ReadonlyArray<{ id: string; version: string; enabled: boolean }>;
  readonly whatHappened?: string;
  readonly whatWasExpected?: string;
}): DiagnosticsBundle {
  return {
    kind: "manu-diagnostics",
    at: new Date().toISOString(),
    appVersion: input.appVersion,
    os: typeof navigator === "undefined" ? "unknown" : navigator.userAgent,
    providers: (input.providers ?? []).map((held) => ({
      providerId: held.providerId,
      models: [...held.models],
    })),
    extensions: (input.extensions ?? []).map((held) => ({ ...held })),
    logs: recentLogs(),
    report: {
      whatHappened: redact(input.whatHappened ?? ""),
      whatWasExpected: redact(input.whatWasExpected ?? ""),
    },
  };
}

/** Serialise for export — with a last-line redaction sweep over the whole body. */
export function renderDiagnostics(bundle: DiagnosticsBundle): string {
  return redact(JSON.stringify(bundle, null, 2));
}
