/**
 * @jellytind/story-causality — cause and effect between story elements.
 *
 * A manuscript records sequence. This records **consequence**, which is what a
 * writer actually needs when they ask "if I cut this scene, what breaks?" —
 * because nothing in the prose says that the confrontation in chapter 19 only
 * happens because of the letter in chapter 4 (docs/STORY_REFACTOR.md).
 *
 * Edges are stored as the writer phrased them and traversed along one
 * normalised arrow, so `A requires B` and `B enables A` behave identically.
 * Every traversal is cycle-safe: a causal loop is a mistake a writer can make,
 * and a graph that crashed on one would fail in the moment it was needed.
 *
 * Nothing here writes, and nothing here decides whether a registered dependency
 * is *true*. That is the author's claim.
 */

export { CausalityGraph, describePath } from "./graph";
export type {
  AffectedEntity,
  BlastRadius,
  DependencyPath,
  DependencyStep,
  TraversalOptions,
} from "./graph";

export { checkDependencies } from "./checks";
export type { DependencyCheckInput, DependencyFinding, DependencyFindingKind } from "./checks";
