/**
 * Claims that carry their evidence.
 *
 * Several subsystems ask a model to interpret something the project already
 * retrieved deterministically: the Story Debugger interprets a trace, the
 * Story Refactor planner interprets a blast radius, an investigating agent
 * interprets tool results. In every case the same failure is available — the
 * model cites something that was never retrieved — and in every case the same
 * answer is right: keep the claim, mark it unsupported, and never present it
 * as though the project had said it.
 *
 * This is the one implementation of that, so the three cannot drift apart
 * (AGENTS.md — "Canon vs Inference").
 */

export interface GroundedClaim {
  /** What the model said. */
  readonly statement: string;
  /** Cited evidence IDs that resolved to something real. */
  readonly basis: readonly string[];
  /**
   * Cited evidence IDs that resolved to nothing.
   *
   * Kept rather than dropped. A claim resting on evidence that does not exist
   * is the failure worth showing, and silently trimming the citation would
   * leave the claim looking sound.
   */
  readonly unsupported: readonly string[];
  /** True only when something was cited and everything cited resolved. */
  readonly grounded: boolean;
}

/**
 * Check one claim's citations against the evidence that actually exists.
 *
 * An uncited claim is not grounded. It may be perfectly sensible — a model's
 * general reading often is — but it is not something the project said, and the
 * whole point of the distinction is that a reader can tell.
 */
export function groundClaim(
  statement: string,
  cited: readonly string[],
  known: ReadonlySet<string>,
): GroundedClaim {
  const basis = cited.filter((id) => known.has(id));
  const unsupported = cited.filter((id) => !known.has(id));
  return {
    statement,
    basis,
    unsupported,
    grounded: basis.length > 0 && unsupported.length === 0,
  };
}

/** Ground a list of claims against one evidence set. */
export function groundClaims(
  claims: ReadonlyArray<{ statement: string; cited: readonly string[] }>,
  known: ReadonlySet<string>,
): GroundedClaim[] {
  return claims.map((claim) => groundClaim(claim.statement, claim.cited, known));
}

/** How much of an interpretation rests on real evidence. */
export function groundingSummary(claims: readonly GroundedClaim[]): {
  total: number;
  grounded: number;
  unsupported: number;
} {
  return {
    total: claims.length,
    grounded: claims.filter((c) => c.grounded).length,
    unsupported: claims.filter((c) => c.unsupported.length > 0).length,
  };
}
