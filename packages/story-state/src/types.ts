import type { CharacterStatus, ObjectStatus, ObjectVisibility } from "@jellytind/domain";
import type { AcquisitionSource, KnowledgeRecord, KnowledgeState } from "./knowledge";
import type { QualitativeLevel, RelationshipDimension } from "./relationships";

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
  /**
   * Someone physically has the object now. `value` is a character ID, or `""`
   * for nobody. Deliberately not `object_owner`: a stolen revolver still belongs
   * to its owner, and continuity turns on which of the two you mean.
   */
  | "object_holder"
  /** An object is somewhere. `value` is a location ID. */
  | "object_location"
  /** An object's physical condition changes. `value` is free text: "cracked". */
  | "object_condition"
  /** An object's status changes. `value` is an {@link ObjectStatus}. */
  | "object_status"
  /** An object's visibility changes. `value` is an {@link ObjectVisibility}. */
  | "object_visibility"
  /** A fact becomes true in the story world. `value` is the fact ID. */
  | "fact_established"
  /**
   * A character's position on a fact changes. `value` is the fact ID and
   * `knowledgeState` says what they now hold — which covers learning it,
   * suspecting it, rejecting it, and forgetting it again.
   */
  | "knowledge_changed"
  /** A relationship's type changes. `subjectId` is a relationship, `value` the new type. */
  | "relationship_type"
  /** A relationship's free-form status changes, e.g. "strained". */
  | "relationship_status"
  /** One analytical dimension moves. `dimension` names it; `level`/`magnitude` carry it. */
  | "relationship_dimension"
  /** A relationship milestone. `value` is a {@link RelationshipEventKind}. */
  | "relationship_event";

export const TRANSITION_KINDS: readonly TransitionKind[] = [
  "character_location",
  "character_status",
  "object_owner",
  "object_holder",
  "object_location",
  "object_condition",
  "object_status",
  "object_visibility",
  "fact_established",
  "knowledge_changed",
  "relationship_type",
  "relationship_status",
  "relationship_dimension",
  "relationship_event",
];

/**
 * Transition kinds written by earlier versions of the format, and what they mean
 * now. `knowledge_gained` predates states: it always meant "now knows".
 * Normalised on read so existing projects keep working without a rewrite
 * (AGENTS.md — "add migration logic where required").
 */
export const LEGACY_TRANSITION_KINDS: Readonly<Record<string, TransitionKind>> = {
  knowledge_gained: "knowledge_changed",
};

/**
 * How a character came by a piece of knowledge.
 * @deprecated Superseded by `AcquisitionSource`, which this is a subset of.
 */
export type KnowledgeSource = "witnessed" | "told" | "inferred";

/**
 * What a `character_location` transition does.
 *
 * "Elias is at the manor" and "Elias leaves the manor" are different claims, and
 * a project that can only say the first has no way to record that someone is
 * *in transit* or that their whereabouts are deliberately unknown — which is
 * often the point of the chapter (docs/OBJECTS_LOCATIONS.md).
 */
export type LocationChangeKind =
  /** The character is now at `value`. The default reading. */
  | "arrival"
  /** The character has left `value`, and is not placed anywhere yet. */
  | "departure"
  /** The character is between places; `value` is the destination, or `""`. */
  | "travel"
  /** Their whereabouts are deliberately unrecorded. `value` may be `""`. */
  | "unknown";

export const LOCATION_CHANGE_KINDS: readonly LocationChangeKind[] = [
  "arrival",
  "departure",
  "travel",
  "unknown",
];

/** Where a character stands relative to being *somewhere*. */
export type Presence = "present" | "travelling" | "departed" | "unknown";

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
  /** For `knowledge_changed`: the position the character now holds. */
  readonly knowledgeState?: KnowledgeState;
  /** For knowledge: how they came by it. */
  readonly sourceType?: AcquisitionSource;
  /** For knowledge acquired from someone or something: which entity. */
  readonly sourceEntityId?: string;
  /**
   * Legacy field for how a character learned something.
   * @deprecated Use `sourceType`.
   */
  readonly howLearned?: KnowledgeSource;

  /**
   * For `character_location`: what kind of move this is. Absent means
   * `arrival`, which is what every transition written before Phase 14 meant.
   */
  readonly movement?: LocationChangeKind;

  /** For `relationship_dimension`: which dimension moved. */
  readonly dimension?: RelationshipDimension;
  /** For `relationship_dimension`: the qualitative level it moved to. */
  readonly level?: QualitativeLevel;
  /**
   * For `relationship_dimension`: the 0–1 analytical value it moved to.
   * An aid for analysis, never objective literary truth.
   */
  readonly magnitude?: number;

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

export interface CharacterState {
  readonly characterId: string;
  /** Where they are, when they are anywhere. Absent while travelling or unknown. */
  readonly locationId?: string;
  /**
   * Whether they are placed at all. A character who has departed is not "at"
   * their last location any more, and saying so is the difference between a
   * usable continuity check and a noisy one.
   */
  readonly presence: Presence;
  /** For `travelling`: where they are heading, when the story says. */
  readonly travellingTo?: string;
  /** The last location they were recorded at, whatever their presence now. */
  readonly lastKnownLocationId?: string;
  readonly status: CharacterStatus;
  /** Objects this character owns at this point. */
  readonly inventory: readonly string[];
  /**
   * Every proposition this character has a position on. Positions of `unknown`
   * are omitted — not having met an idea is the absence of a record, not a
   * record of absence.
   */
  readonly knowledge: readonly KnowledgeRecord[];
  /** The boundary this state describes. */
  readonly asOf: StateBoundary;
}

/**
 * How an object came to be where it is.
 *
 * A held object travels with whoever holds it; a placed one stays put until
 * something moves it. Which of the two applies decides whether "the revolver is
 * in the flat" is still true after its owner walks to the manor — so the
 * distinction is recorded rather than guessed.
 */
export type ObjectPlacement = "held" | "placed" | "unplaced";

export interface ObjectState {
  readonly objectId: string;
  /** Whose it is. Survives theft, loss and lending. */
  readonly ownerId?: string;
  /** Who physically has it. Often, but not always, the owner. */
  readonly holderId?: string;
  /** Where it was last put down. Meaningful when `placement` is `placed`. */
  readonly locationId?: string;
  /** Free-text physical condition: "cracked", "bloodstained". */
  readonly condition?: string;
  readonly status: ObjectStatus;
  readonly visibility: ObjectVisibility;
  readonly placement: ObjectPlacement;
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
