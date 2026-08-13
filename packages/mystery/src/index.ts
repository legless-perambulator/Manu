/**
 * @jellytind/mystery — the Mystery Engine.
 *
 * A mystery's information architecture, held as records rather than inferred
 * from prose: which clue reaches the reader when, which reasoning rests on
 * which clue, and whether a careful reader could fairly get there before the
 * reveal (docs/MYSTERY_ENGINE.md).
 */

export { loadArchitecture, resolveChain, solutionStep, renderChain } from "./architecture";
export type { ChainStep, MysteryArchitecture } from "./architecture";

export { auditFairness, earliestSolvable, detectObviousness, checkAlibis } from "./fairness";

export { MysteryError } from "./types";
export type { MysteryErrorCode } from "./types";
