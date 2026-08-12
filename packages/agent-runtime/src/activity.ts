/**
 * The agent activity log.
 *
 * The user must be able to understand what an agent did without being shown
 * hidden model reasoning (MASTER_BUILD.md §5 — "The user should be able to
 * understand the agent's actions without needing hidden chain-of-thought").
 *
 * Activity records **actions**, not thoughts: which tool ran, a short summary of
 * its arguments, a short summary of its result, when, and whether it succeeded.
 * Model reasoning text is never written here and is never persisted.
 */
export type ActivityStatus = "ok" | "denied" | "failed" | "cancelled";

export interface AgentActivityEvent {
  readonly id: string;
  readonly taskId: string;
  readonly timestamp: string;
  readonly tool: string;
  /** Short human-readable rendering of the arguments, e.g. `id=SCENE_0012`. */
  readonly argumentsSummary: string;
  /** Short human-readable rendering of the result, e.g. `3 scenes`. */
  readonly resultSummary: string;
  readonly status: ActivityStatus;
  readonly durationMs?: number;
}

const MAX_SUMMARY = 120;

function clamp(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= MAX_SUMMARY ? flat : `${flat.slice(0, MAX_SUMMARY - 1)}…`;
}

/** Render tool arguments as a compact `key=value` list. */
export function summarizeArguments(input: unknown): string {
  if (typeof input !== "object" || input === null) return clamp(String(input ?? ""));
  const parts: string[] = [];
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === undefined) continue;
    parts.push(`${key}=${Array.isArray(value) ? `[${value.length}]` : String(value)}`);
  }
  return parts.length === 0 ? "no arguments" : clamp(parts.join(", "));
}

/**
 * Render a tool result as a short shape description. Deliberately does not
 * include the retrieved prose: the activity log is a record of what happened,
 * not a second copy of the manuscript.
 */
export function summarizeResult(output: unknown): string {
  if (output === null || output === undefined) return "no result";
  if (Array.isArray(output)) return `${output.length} items`;
  if (typeof output !== "object") return clamp(String(output));

  const parts: string[] = [];
  for (const [key, value] of Object.entries(output as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) parts.push(`${value.length} ${key}`);
    else if (typeof value === "string") parts.push(`${key}: ${value.length} chars`);
    else if (typeof value === "object") parts.push(key);
    else parts.push(`${key}=${String(value)}`);
  }
  return parts.length === 0 ? "empty result" : clamp(parts.join(", "));
}

/** A one-line, present-tense description of a call, for the live activity feed. */
export function describeActivity(event: AgentActivityEvent): string {
  const target = event.argumentsSummary === "no arguments" ? "" : ` ${event.argumentsSummary}`;
  switch (event.status) {
    case "denied":
      return `Blocked: ${event.tool}${target} — ${event.resultSummary}`;
    case "failed":
      return `Failed: ${event.tool}${target} — ${event.resultSummary}`;
    case "cancelled":
      return `Cancelled: ${event.tool}${target}`;
    default:
      return `${event.tool}${target} → ${event.resultSummary}`;
  }
}
