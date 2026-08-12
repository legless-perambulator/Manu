/**
 * Character knowledge and belief.
 *
 * Three representations that must never collapse into one
 * (MASTER_BUILD.md §9, docs/STORY_STATE.md):
 *
 * ```
 * FACT_VAULT_CONTENTS   objectiveTruth: financial records   ← the world
 * MARA    knows     FACT_VAULT_EXISTS      witnessed SC41    ← what she knows
 * ELIAS   believes  FACT_VAULT_HAS_PAPERS  told by Mara SC42 ← what he believes
 * ```
 *
 * A character's belief lives here; the world's truth lives on the `Fact` entity
 * (`objectiveTruth`). A false belief is a character holding a false proposition
 * as true — it never mutates the fact.
 *
 * Knowledge is **state**, so it is carried by the same scene-anchored
 * transitions as location and possessions rather than a parallel database. That
 * is what keeps it time-aware and what makes "who knew what when" answerable.
 */

/**
 * What a character holds about a proposition.
 *
 * Ordered from no position to a firm one, with `disbelieved` as its own stance:
 * actively rejecting a proposition is not the same as never having met it.
 */
export type KnowledgeState = "unknown" | "suspected" | "believed" | "known" | "disbelieved";

export const KNOWLEDGE_STATES: readonly KnowledgeState[] = [
  "unknown",
  "suspected",
  "believed",
  "known",
  "disbelieved",
];

/** States in which the character treats the proposition as true. */
export const HOLDS_AS_TRUE: readonly KnowledgeState[] = ["believed", "known"];

/** True when the character would act on the proposition as though it holds. */
export function holdsAsTrue(state: KnowledgeState): boolean {
  return HOLDS_AS_TRUE.includes(state);
}

/** True when the character has any position at all on the proposition. */
export function hasPosition(state: KnowledgeState): boolean {
  return state !== "unknown";
}

/** How a character came by their position. */
export type AcquisitionSource =
  "witnessed" | "told" | "read" | "inferred" | "remembered" | "assumed" | "deceived" | "unknown";

export const ACQUISITION_SOURCES: readonly AcquisitionSource[] = [
  "witnessed",
  "told",
  "read",
  "inferred",
  "remembered",
  "assumed",
  "deceived",
  "unknown",
];

/** Sources that name another party the information came from. */
export const TRANSFER_SOURCES: readonly AcquisitionSource[] = ["told", "read", "deceived"];

export function isTransfer(source: AcquisitionSource): boolean {
  return TRANSFER_SOURCES.includes(source);
}

/**
 * Transfers where the source must themselves hold the information.
 *
 * `told` qualifies: you cannot pass on in good faith what you do not hold.
 * `deceived` deliberately does **not** — a liar conveying something they know to
 * be false is the whole point of deception, and flagging it as a continuity
 * error would make the system unable to represent the genre it exists for.
 * `read` names a document rather than a mind, so there is nothing to check.
 */
export const HONEST_TRANSFER_SOURCES: readonly AcquisitionSource[] = ["told"];

export function requiresSourceKnowledge(source: AcquisitionSource): boolean {
  return HONEST_TRANSFER_SOURCES.includes(source);
}

/**
 * A character's position on one proposition at one point in the story.
 *
 * Reconstructed, never stored: `acquiredAtSceneId` and `lostAtSceneId` are read
 * off the sequence of transitions rather than maintained by hand.
 */
export interface KnowledgeRecord {
  /** Stable within a reconstruction: `<characterId>:<factId>`. */
  readonly id: string;
  readonly characterId: string;
  readonly factId: string;
  readonly state: KnowledgeState;
  /**
   * Optional analytical metadata, 0–1. **Not** objective psychology: it records
   * how firmly the author wants the position held, for analysis and drafting
   * guidance, and nothing depends on its exact value.
   */
  readonly certainty?: number;
  readonly sourceType: AcquisitionSource;
  /** Who or what it came from — a character, object or location. */
  readonly sourceEntityId?: string;
  /** Where they first took this position. */
  readonly acquiredAtSceneId?: string;
  /** Where they last gave it up, when they have. */
  readonly lostAtSceneId?: string;
  readonly notes?: string;
}

/** One step in how a character came by a position, for tracing chains. */
export interface AcquisitionStep {
  readonly characterId: string;
  readonly factId: string;
  readonly state: KnowledgeState;
  readonly sourceType: AcquisitionSource;
  readonly sourceEntityId?: string;
  readonly sceneId: string;
}

/** A character's position on a fact, as seen in the knowledge graph. */
export interface KnowledgeHolder {
  readonly characterId: string;
  readonly state: KnowledgeState;
  readonly sourceType: AcquisitionSource;
  readonly sourceEntityId?: string;
  readonly acquiredAtSceneId?: string;
  readonly certainty?: number;
  /** True when this character holds a proposition the world says is false. */
  readonly isFalseBelief: boolean;
}

/**
 * Everyone's position on one fact at a boundary — the inspectable graph:
 *
 * ```
 * FACT_VAULT_EXISTS  (true)
 *   ├── Mara   — known     — witnessed SCENE_0041
 *   ├── Elias  — believed  — told by Mara, SCENE_0042
 *   └── Marcus — unknown
 * ```
 */
export interface FactKnowledgeGraph {
  readonly factId: string;
  readonly objectiveTruth: boolean;
  readonly holders: readonly KnowledgeHolder[];
}

/** Where two characters differ on the same proposition. */
export interface InformationAsymmetry {
  readonly factId: string;
  /** Characters who hold it as true. */
  readonly holders: readonly string[];
  /** Characters present who do not. */
  readonly outsiders: readonly string[];
}

/** A one-line rendering of a position, for context and the inspector. */
export function describeKnowledge(record: KnowledgeRecord): string {
  const via =
    record.sourceEntityId === undefined
      ? record.sourceType
      : `${record.sourceType} by ${record.sourceEntityId}`;
  const where = record.acquiredAtSceneId === undefined ? "" : ` in ${record.acquiredAtSceneId}`;
  const certainty = record.certainty === undefined ? "" : `, certainty ${String(record.certainty)}`;
  return `${record.state} ${record.factId} (${via}${where}${certainty})`;
}
