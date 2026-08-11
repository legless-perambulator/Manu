import type { ContextSectionName, Provenance } from "./types";

/**
 * One thing a recipe proposes for inclusion, before the budget has decided.
 *
 * A candidate carries both renderings up front, so budget resolution is a pure
 * arithmetic step over already-materialised text — no recipe logic runs twice
 * and nothing is re-fetched under budget pressure.
 */
export interface Candidate {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly section: ContextSectionName;
  /** Lower survives budget pressure longer. Set by the recipe. */
  readonly priority: number;
  readonly provenance: Provenance;
  readonly full: string;
  /** Deterministic shorter form, when one exists for this kind. */
  readonly summary?: string;
  /** Included regardless of budget (the task and its target). */
  readonly required?: boolean;
}

/**
 * Priority bands. Naming them keeps recipes readable and makes the ordering a
 * declared policy rather than a scatter of magic numbers.
 */
export const PRIORITY = {
  /** The instruction and the target entity — never dropped. */
  essential: 0,
  /** The prose being worked on. */
  primary: 10,
  /** Immediate narrative neighbours. */
  adjacent: 20,
  /** People and places the target directly involves. */
  involved: 30,
  /** Threads the target carries. */
  threads: 40,
  /** Rules that constrain the work. */
  rules: 50,
  /** Style and voice material. */
  style: 60,
  /** Retrieved extras — first to go. */
  retrieved: 70,
} as const;

/** Drop later candidates that repeat an ID already proposed at higher priority. */
export function dedupe(candidates: readonly Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.section}:${candidate.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}
