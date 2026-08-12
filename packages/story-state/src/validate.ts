import { entityKindOf, OBJECT_STATUSES, OBJECT_VISIBILITIES } from "@jellytind/domain";
import { AppError } from "@jellytind/shared";
import {
  ACQUISITION_SOURCES,
  KNOWLEDGE_STATES,
  isTransfer,
  type AcquisitionSource,
  type KnowledgeState,
} from "./knowledge";
import {
  isQualitativeLevel,
  isRelationshipDimension,
  isRelationshipEventKind,
  RELATIONSHIP_EVENT_KINDS,
  type QualitativeLevel,
  type RelationshipDimension,
} from "./relationships";
import { normaliseObjectStatus } from "./normalise";
import {
  LEGACY_TRANSITION_KINDS,
  LOCATION_CHANGE_KINDS,
  TRANSITION_KINDS,
  type LocationChangeKind,
  type StateTransition,
  type TransitionKind,
} from "./types";

export class TransitionError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("invalid_transition", message, details === undefined ? undefined : { details });
  }
}

/** The entity kind each transition's subject and value must be. */
const SHAPE: Readonly<Record<TransitionKind, { subject: string; value: string | null }>> = {
  character_location: { subject: "character", value: "location" },
  character_status: { subject: "character", value: null },
  object_owner: { subject: "object", value: "character" },
  object_holder: { subject: "object", value: "character" },
  object_location: { subject: "object", value: "location" },
  object_condition: { subject: "object", value: null },
  object_status: { subject: "object", value: null },
  object_visibility: { subject: "object", value: null },
  fact_established: { subject: "fact", value: null },
  knowledge_changed: { subject: "character", value: "fact" },
  relationship_type: { subject: "relationship", value: null },
  relationship_status: { subject: "relationship", value: null },
  relationship_dimension: { subject: "relationship", value: null },
  relationship_event: { subject: "relationship", value: null },
};

const STATUSES = new Set(["active", "inactive", "deceased", "unknown"]);

/** Kinds whose value may be `""`, and what the blank means. */
const BLANK_MEANS: Readonly<Record<string, string>> = {
  object_owner: "unowned",
  object_holder: "held by nobody",
  character_location: "nowhere recorded",
};

export interface TransitionDraft {
  readonly sceneId: string;
  readonly kind: TransitionKind;
  readonly subjectId: string;
  readonly value: string;
  readonly certainty?: number;
  /** For `knowledge_changed`: the position now held. Defaults to `known`. */
  readonly knowledgeState?: KnowledgeState;
  readonly sourceType?: AcquisitionSource;
  /** Who or what the information came from. */
  readonly sourceEntityId?: string;
  /** @deprecated Use `sourceType`. */
  readonly howLearned?: StateTransition["howLearned"];
  /** For `character_location`: arrival, departure, travel or unknown. */
  readonly movement?: LocationChangeKind;
  /** For `relationship_dimension`. */
  readonly dimension?: RelationshipDimension;
  readonly level?: QualitativeLevel;
  readonly magnitude?: number;
  readonly note?: string;
}

/**
 * Validate a transition's shape before it is stored.
 *
 * This is the guard that keeps a model from inventing state: a transition whose
 * subject is not a real entity of the right kind, or whose value does not match
 * the kind it claims, is rejected outright. Referential existence is checked by
 * the caller, which holds the project; the kinds are checked here, where the
 * rules live.
 */
export function validateTransition(draft: TransitionDraft): TransitionDraft {
  const kind = LEGACY_TRANSITION_KINDS[draft.kind] ?? draft.kind;
  if (!TRANSITION_KINDS.includes(kind)) {
    throw new TransitionError(`Unknown transition kind "${draft.kind}".`, { kind: draft.kind });
  }
  draft = draft.kind === kind ? draft : { ...draft, kind };
  if (entityKindOf(draft.sceneId) !== "scene") {
    throw new TransitionError(`A transition must be anchored to a scene, got "${draft.sceneId}".`, {
      sceneId: draft.sceneId,
    });
  }

  const shape = SHAPE[draft.kind];
  const subjectKind = entityKindOf(draft.subjectId);
  if (subjectKind !== shape.subject) {
    throw new TransitionError(
      `"${draft.kind}" needs a ${shape.subject} subject, but "${draft.subjectId}" is ${
        subjectKind ?? "not a valid ID"
      }.`,
      { subjectId: draft.subjectId, expected: shape.subject },
    );
  }

  if (draft.kind === "character_status") {
    if (!STATUSES.has(draft.value)) {
      throw new TransitionError(
        `"${draft.value}" is not a character status (${[...STATUSES].join(", ")}).`,
        { value: draft.value },
      );
    }
  } else if (draft.kind === "fact_established") {
    if (entityKindOf(draft.value) !== "fact") {
      throw new TransitionError(`"fact_established" needs a fact ID, got "${draft.value}".`, {
        value: draft.value,
      });
    }
  } else if (draft.kind === "object_status") {
    if (!OBJECT_STATUSES.includes(normaliseObjectStatus(draft.value))) {
      throw new TransitionError(
        `"${draft.value}" is not an object status (${OBJECT_STATUSES.join(", ")}).`,
        { value: draft.value },
      );
    }
  } else if (draft.kind === "object_visibility") {
    if (!OBJECT_VISIBILITIES.includes(draft.value as (typeof OBJECT_VISIBILITIES)[number])) {
      throw new TransitionError(
        `"${draft.value}" is not an object visibility (${OBJECT_VISIBILITIES.join(", ")}).`,
        { value: draft.value },
      );
    }
  } else if (draft.kind === "object_condition") {
    if (draft.value.trim() === "") {
      throw new TransitionError("An object condition needs a description.", { kind: draft.kind });
    }
  } else if (shape.value !== null) {
    // A blank value is meaningful for a few kinds — unowned, held by nobody,
    // whereabouts unrecorded — and nonsense for the rest.
    const blank = draft.value === "" && BLANK_MEANS[draft.kind] !== undefined;
    const valueKind = entityKindOf(draft.value);
    if (!blank && valueKind !== shape.value) {
      throw new TransitionError(
        `"${draft.kind}" needs a ${shape.value} value, but "${draft.value}" is ${
          valueKind ?? "not a valid ID"
        }.`,
        { value: draft.value, expected: shape.value },
      );
    }
  }

  if (draft.certainty !== undefined && (draft.certainty < 0 || draft.certainty > 1)) {
    throw new TransitionError("Certainty must be between 0 and 1.", {
      certainty: draft.certainty,
    });
  }

  if (draft.kind === "knowledge_changed") {
    if (draft.knowledgeState !== undefined && !KNOWLEDGE_STATES.includes(draft.knowledgeState)) {
      throw new TransitionError(
        `"${draft.knowledgeState}" is not a knowledge state (${KNOWLEDGE_STATES.join(", ")}).`,
        { knowledgeState: draft.knowledgeState },
      );
    }
    if (draft.sourceType !== undefined && !ACQUISITION_SOURCES.includes(draft.sourceType)) {
      throw new TransitionError(
        `"${draft.sourceType}" is not an acquisition source (${ACQUISITION_SOURCES.join(", ")}).`,
        { sourceType: draft.sourceType },
      );
    }
    if (draft.sourceEntityId !== undefined && entityKindOf(draft.sourceEntityId) === null) {
      throw new TransitionError(
        `"${draft.sourceEntityId}" is not a valid entity ID for an information source.`,
        { sourceEntityId: draft.sourceEntityId },
      );
    }
    // A character cannot be told something by themselves.
    if (draft.sourceEntityId === draft.subjectId && isTransfer(draft.sourceType ?? "unknown")) {
      throw new TransitionError(
        `${draft.subjectId} cannot be the source of their own information.`,
        { subjectId: draft.subjectId },
      );
    }
  } else if (draft.knowledgeState !== undefined || draft.sourceEntityId !== undefined) {
    throw new TransitionError(`"${draft.kind}" does not take knowledge fields.`, {
      kind: draft.kind,
    });
  }

  if (draft.kind === "character_location") {
    if (draft.movement !== undefined && !LOCATION_CHANGE_KINDS.includes(draft.movement)) {
      throw new TransitionError(
        `"${draft.movement}" is not a movement (${LOCATION_CHANGE_KINDS.join(", ")}).`,
        { movement: draft.movement },
      );
    }
    // Arriving somewhere means arriving *somewhere*. Departing, travelling and
    // going unrecorded may all leave the destination blank.
    if ((draft.movement ?? "arrival") === "arrival" && draft.value === "") {
      throw new TransitionError("An arrival needs a location.", { kind: draft.kind });
    }
  } else if (draft.movement !== undefined) {
    throw new TransitionError(`"${draft.kind}" does not take a movement.`, { kind: draft.kind });
  }

  if (draft.kind === "relationship_dimension") {
    if (!isRelationshipDimension(draft.dimension)) {
      throw new TransitionError(`"${String(draft.dimension)}" is not a relationship dimension.`, {
        dimension: draft.dimension,
      });
    }
    // Dimensions are optional for a project, but a recorded change must say
    // something: a qualitative level, a magnitude, or both.
    if (draft.level === undefined && draft.magnitude === undefined) {
      throw new TransitionError(
        "A relationship dimension change needs a level, a magnitude, or both.",
        { dimension: draft.dimension },
      );
    }
    if (draft.level !== undefined && !isQualitativeLevel(draft.level)) {
      throw new TransitionError(`"${String(draft.level)}" is not a qualitative level.`, {
        level: draft.level,
      });
    }
    if (draft.magnitude !== undefined && (draft.magnitude < 0 || draft.magnitude > 1)) {
      throw new TransitionError("A relationship magnitude must be between 0 and 1.", {
        magnitude: draft.magnitude,
      });
    }
  } else if (
    draft.dimension !== undefined ||
    draft.level !== undefined ||
    draft.magnitude !== undefined
  ) {
    throw new TransitionError(`"${draft.kind}" does not take relationship dimension fields.`, {
      kind: draft.kind,
    });
  }

  if (draft.kind === "relationship_event" && !isRelationshipEventKind(draft.value)) {
    throw new TransitionError(
      `"${draft.value}" is not a relationship event (${RELATIONSHIP_EVENT_KINDS.join(", ")}).`,
      { value: draft.value },
    );
  }

  if (
    (draft.kind === "relationship_type" || draft.kind === "relationship_status") &&
    draft.value.trim() === ""
  ) {
    throw new TransitionError(`"${draft.kind}" needs a non-empty value.`, { kind: draft.kind });
  }

  return draft;
}

const STATE_VERBS: Readonly<Record<KnowledgeState, string>> = {
  unknown: "no longer holds",
  suspected: "suspects",
  believed: "believes",
  known: "learns",
  disbelieved: "rejects",
};

/** A one-line description of a transition, for logs and the inspector. */
export function describeTransition(
  t: Pick<
    StateTransition,
    | "kind"
    | "subjectId"
    | "value"
    | "knowledgeState"
    | "movement"
    | "dimension"
    | "level"
    | "magnitude"
  >,
): string {
  switch (t.kind) {
    case "character_location":
      switch (t.movement ?? "arrival") {
        case "departure":
          return `${t.subjectId} leaves ${t.value}`;
        case "travel":
          return t.value === ""
            ? `${t.subjectId} is travelling`
            : `${t.subjectId} is travelling to ${t.value}`;
        case "unknown":
          return `${t.subjectId} is somewhere unrecorded`;
        default:
          return `${t.subjectId} is at ${t.value}`;
      }
    case "character_status":
      return `${t.subjectId} becomes ${t.value}`;
    case "object_owner":
      return t.value === ""
        ? `${t.subjectId} has no owner`
        : `${t.value} takes possession of ${t.subjectId}`;
    case "object_holder":
      return t.value === ""
        ? `${t.subjectId} is put down`
        : `${t.value} is carrying ${t.subjectId}`;
    case "object_location":
      return `${t.subjectId} is at ${t.value}`;
    case "object_condition":
      return `${t.subjectId} is ${t.value}`;
    case "object_status":
      return `${t.subjectId} is ${t.value}`;
    case "object_visibility":
      return `${t.subjectId} is ${t.value}`;
    case "fact_established":
      return `${t.value} becomes true`;
    case "knowledge_changed":
      return `${t.subjectId} ${STATE_VERBS[t.knowledgeState ?? "known"]} ${t.value}`;
    case "relationship_type":
      return `${t.subjectId} becomes ${t.value}`;
    case "relationship_status":
      return `${t.subjectId} is ${t.value}`;
    case "relationship_dimension":
      return `${t.subjectId} ${String(t.dimension)} → ${t.level ?? String(t.magnitude ?? "")}`;
    case "relationship_event":
      return `${t.subjectId}: ${t.value.replace(/_/g, " ")}`;
  }
}
