import { LEGACY_OBJECT_STATUSES, OBJECT_STATUSES, type ObjectStatus } from "@jellytind/domain";
import type { AcquisitionSource, KnowledgeRecord, KnowledgeState } from "./knowledge";
import { LEGACY_TRANSITION_KINDS, type StateTransition, type TransitionKind } from "./types";

/**
 * Read a stored object status in current terms.
 *
 * `intact` became `exists`, and `transformed` — which conflated status with
 * condition — becomes `exists` too: a melted candlestick has not left the story,
 * it has changed condition, and there is now a field that says so
 * (docs/OBJECTS_LOCATIONS.md). Anything unrecognised reads as `unknown`, which
 * is the honest answer for a value this version cannot interpret.
 */
export function normaliseObjectStatus(value: string): ObjectStatus {
  if ((OBJECT_STATUSES as readonly string[]).includes(value)) return value as ObjectStatus;
  return LEGACY_OBJECT_STATUSES[value] ?? "unknown";
}

/**
 * Read a stored transition in current terms.
 *
 * The format grew: knowledge used to be a single `knowledge_gained` kind with a
 * three-value `howLearned`. Rather than rewriting every project's file, older
 * records are interpreted on read — `knowledge_gained` means "now knows", and
 * `howLearned` is an acquisition source. Writes always use the current shape, so
 * a project migrates itself as it is edited.
 */
export function normaliseTransition(t: StateTransition): StateTransition {
  const kind: TransitionKind = LEGACY_TRANSITION_KINDS[t.kind] ?? t.kind;
  if (kind !== "knowledge_changed") return t.kind === kind ? t : { ...t, kind };

  return {
    ...t,
    kind,
    knowledgeState: t.knowledgeState ?? "known",
    sourceType: t.sourceType ?? (t.howLearned as AcquisitionSource | undefined) ?? "unknown",
  };
}

/**
 * Fold one transition into a character's running position on a proposition.
 *
 * A change that only revises the position — a suspicion hardening into
 * knowledge — keeps the scene where the character first took it up, so
 * "when did Elias first learn about the vault?" survives later refinements.
 * Giving the position up records where, and taking it up again starts fresh.
 */
export function foldKnowledge(
  previous: KnowledgeRecord | undefined,
  t: StateTransition,
  characterId: string,
): KnowledgeRecord {
  const state: KnowledgeState = t.knowledgeState ?? "known";
  const sourceType: AcquisitionSource = t.sourceType ?? "unknown";
  const heldBefore = previous !== undefined && previous.state !== "unknown";

  const acquiredAtSceneId =
    state === "unknown"
      ? previous?.acquiredAtSceneId
      : heldBefore
        ? previous.acquiredAtSceneId
        : t.sceneId;

  return {
    id: `${characterId}:${t.value}`,
    characterId,
    factId: t.value,
    state,
    ...(t.certainty !== undefined ? { certainty: t.certainty } : {}),
    sourceType,
    ...(t.sourceEntityId !== undefined ? { sourceEntityId: t.sourceEntityId } : {}),
    ...(acquiredAtSceneId !== undefined ? { acquiredAtSceneId } : {}),
    ...(state === "unknown" ? { lostAtSceneId: t.sceneId } : {}),
    ...(t.note !== undefined ? { notes: t.note } : {}),
  };
}
