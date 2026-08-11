import type { CharacterStatus } from "@jellytind/domain";

/**
 * Story State V1.
 *
 * State is **not** a snapshot of "now". It is a set of changes, each anchored to
 * the scene where it happens, from which the state at any point in the story can
 * be reconstructed. That is what lets the system answer *where was Elias
 * immediately before Scene 42?* rather than only *where is Elias?*
 * (MASTER_BUILD.md §8; docs/STORY_STATE.md).
 *
 * V1 covers five dimensions deliberately: character location, alive/dead status,
 * object ownership and location, canonical facts, and simple character
 * knowledge. Emotional variables, relationship dynamics, goals and beliefs come
 * later; leaving them out keeps every dimension here deterministic.
 */
export type TransitionKind =
  /** A character moves. `value` is a location ID. */
  | "character_location"
  /** A character's life status changes. `value` is a {@link CharacterStatus}. */
  | "character_status"
  /** An object changes hands. `value` is a character ID, or `""` for unowned. */
  | "object_owner"
  /** An object is somewhere. `value` is a location ID. */
  | "object_location"
  /** A fact becomes true in the story world. `value` is the fact ID. */
  | "fact_established"
  /** A character learns a fact. `value` is the fact ID. */
  | "knowledge_gained";

export const TRANSITION_KINDS: readonly TransitionKind[] = [
  "character_location",
  "character_status",
  "object_owner",
  "object_location",
  "fact_established",
  "knowledge_gained",
];

/** How a character came by a piece of knowledge. */
export type KnowledgeSource = "witnessed" | "told" | "inferred";

/** Who proposed a transition. */
export type TransitionSource = "author" | "agent" | "import";

/**
 * Whether a transition counts as canon.
 *
 * Only `confirmed` transitions contribute to state. Model-proposed transitions
 * are persisted as `proposed` so they are inspectable and correctable, but they
 * never silently become canon (AGENTS.md — "Canon vs Inference").
 */
export type ConfirmationStatus = "confirmed" | "proposed" | "rejected";

export interface StateTransition {
  readonly id: string;
  /** The scene at which this change happens. Provenance and ordering both. */
  readonly sceneId: string;
  readonly kind: TransitionKind;
  /** Character, object or fact the change is about. */
  readonly subjectId: string;
  /** The new value: a location, status, owner or fact ID depending on `kind`. */
  readonly value: string;
  /** For knowledge: 0–1 confidence the character holds. */
  readonly certainty?: number;
  /** For knowledge: how they learned it. */
  readonly howLearned?: KnowledgeSource;
  readonly source: TransitionSource;
  readonly confirmationStatus: ConfirmationStatus;
  /** The model that proposed this, when `source` is `agent`. */
  readonly modelId?: string;
  /** Free-form justification — the sentence in the prose, an author's note. */
  readonly note?: string;
  readonly createdAt: string;
  readonly confirmedAt?: string;
}

// ── Reconstructed state ─────────────────────────────────────────────────────

export interface KnowledgeEntry {
  readonly factId: string;
  readonly certainty: number;
  readonly howLearned: KnowledgeSource;
  /** Where they learned it — the basis for "does she know this yet?". */
  readonly learnedInSceneId: string;
}

export interface CharacterState {
  readonly characterId: string;
  readonly locationId?: string;
  readonly status: CharacterStatus;
  /** Objects this character owns at this point. */
  readonly inventory: readonly string[];
  readonly knowledge: readonly KnowledgeEntry[];
  /** The boundary this state describes. */
  readonly asOf: StateBoundary;
}

export interface ObjectState {
  readonly objectId: string;
  readonly ownerId?: string;
  readonly locationId?: string;
  readonly asOf: StateBoundary;
}

export interface StateBoundary {
  readonly sceneId: string;
  readonly position: "before" | "after";
}

export interface WorldState {
  readonly asOf: StateBoundary;
  readonly characters: readonly CharacterState[];
  readonly objects: readonly ObjectState[];
  /** Facts that are true in the world at this point. */
  readonly establishedFacts: readonly string[];
}

/** Which transitions a query should honour. */
export interface TimelineView {
  /**
   * `confirmed` (the default) reconstructs canon. `with_proposed` previews what
   * state would look like if the pending proposals were accepted — useful for
   * review, never for canon.
   */
  readonly include?: "confirmed" | "with_proposed";
}
