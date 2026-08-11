import type { AnyId } from "@jellytind/domain";

/**
 * Story-check severity. The compiler must never present subjective literary
 * judgement as deterministic fact (docs/STORY_COMPILER.md):
 *
 * - `error`      — a hard, deterministic violation (dead character speaks, etc.)
 * - `warning`    — a likely problem, deterministic or semantic
 * - `suggestion` — a subjective, model-informed recommendation
 */
export type Severity = "error" | "warning" | "suggestion";

/** How a finding was produced — kept explicit so the UI can label it honestly. */
export type FindingSource = "deterministic" | "semantic";

export interface Finding {
  readonly checkId: string;
  readonly severity: Severity;
  readonly source: FindingSource;
  readonly message: string;
  /** Human-readable justification; required for semantic findings. */
  readonly evidence?: string;
  readonly entities?: readonly AnyId[];
}

/**
 * Context passed to every check. Phase 0 is a placeholder; it will carry the
 * Story Repository, compiled Story State and project rules as those slices land
 * (docs/ROADMAP.md, V2).
 */
export interface CheckContext {
  readonly projectRoot?: string;
}

export interface StoryCheck {
  readonly id: string;
  readonly name: string;
  run(context: CheckContext): Finding[] | Promise<Finding[]>;
}

export interface BuildReport {
  readonly findings: readonly Finding[];
  readonly counts: Readonly<Record<Severity, number>>;
  /** A build "passes" when it produced no `error`-severity findings. */
  readonly ok: boolean;
}
