import { entityKindOf } from "@jellytind/domain";
import { AppError } from "@jellytind/shared";
import {
  ACQUISITION_SOURCES,
  KNOWLEDGE_STATES,
  isTransfer,
  type AcquisitionSource,
  type KnowledgeState,
} from "./knowledge";
import {
  LEGACY_TRANSITION_KINDS,
  TRANSITION_KINDS,
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
  object_location: { subject: "object", value: "location" },
  fact_established: { subject: "fact", value: null },
  knowledge_changed: { subject: "character", value: "fact" },
};

const STATUSES = new Set(["active", "inactive", "deceased", "unknown"]);

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
  } else if (shape.value !== null) {
    // `object_owner` accepts "" to mean the object is unowned.
    const unowned = draft.kind === "object_owner" && draft.value === "";
    const valueKind = entityKindOf(draft.value);
    if (!unowned && valueKind !== shape.value) {
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
  t: Pick<StateTransition, "kind" | "subjectId" | "value" | "knowledgeState">,
): string {
  switch (t.kind) {
    case "character_location":
      return `${t.subjectId} is at ${t.value}`;
    case "character_status":
      return `${t.subjectId} becomes ${t.value}`;
    case "object_owner":
      return t.value === ""
        ? `${t.subjectId} has no owner`
        : `${t.value} takes possession of ${t.subjectId}`;
    case "object_location":
      return `${t.subjectId} is at ${t.value}`;
    case "fact_established":
      return `${t.value} becomes true`;
    case "knowledge_changed":
      return `${t.subjectId} ${STATE_VERBS[t.knowledgeState ?? "known"]} ${t.value}`;
  }
}
