import type { ObjectStatus, ObjectVisibility } from "@jellytind/domain";
import type { ObjectPlacement, StateTransition } from "./types";

/**
 * Object continuity vocabulary.
 *
 * Objects are the most reliably broken thing in a long manuscript: a revolver
 * left in a flat in chapter 19 fires at the manor in chapter 22, and no amount
 * of re-reading catches it, because the two mentions are sixty thousand words
 * apart. Tracking them as state rather than prose is what makes the answer
 * deterministic (docs/OBJECTS_LOCATIONS.md).
 */

/** A character with no recorded status is assumed to still exist and be visible. */
export const DEFAULT_OBJECT_STATUS: ObjectStatus = "exists";
export const DEFAULT_OBJECT_VISIBILITY: ObjectVisibility = "visible";

/** Statuses under which an object can no longer be used or moved. */
export const GONE_STATUSES: readonly ObjectStatus[] = ["destroyed"];

/** Whether the story world still has this object to work with. */
export function isGone(status: ObjectStatus): boolean {
  return GONE_STATUSES.includes(status);
}

/**
 * One explicit change of hands or of place.
 *
 * Derived, never stored. A transfer is what two consecutive states *mean*, so
 * recording it separately would create a second version of the truth that could
 * drift from the transitions — exactly what the state-as-transitions design
 * exists to prevent. `from` is reconstructed from the state entering the scene,
 * so it cannot disagree with the timeline.
 */
export interface ObjectTransfer {
  readonly objectId: string;
  readonly sceneId: string;
  readonly fromCharacterId?: string;
  readonly toCharacterId?: string;
  readonly fromLocationId?: string;
  readonly toLocationId?: string;
  /** Why it moved — the author's note on the transition that recorded it. */
  readonly reason?: string;
}

/** What kind of change one step in an object's history was. */
export type ObjectChangeKind =
  "owner" | "holder" | "location" | "condition" | "status" | "visibility";

/**
 * One recorded step in an object's life, with what it changed from.
 *
 * The `from` half is what makes a history readable — *Mara → Elias* rather than
 * a bare list of destinations.
 */
export interface ObjectChange {
  readonly objectId: string;
  readonly sceneId: string;
  readonly kind: ObjectChangeKind;
  readonly from?: string;
  readonly to: string;
  readonly reason?: string;
}

const CHANGE_KINDS: Readonly<Record<string, ObjectChangeKind>> = {
  object_owner: "owner",
  object_holder: "holder",
  object_location: "location",
  object_condition: "condition",
  object_status: "status",
  object_visibility: "visibility",
};

/** The change kind a transition records, or `null` if it is not about an object. */
export function objectChangeKind(kind: string): ObjectChangeKind | null {
  return CHANGE_KINDS[kind] ?? null;
}

/** Whether a transition is about an object at all. */
export function isObjectTransition(t: StateTransition): boolean {
  return objectChangeKind(t.kind) !== null;
}

/** An object's state rendered as a sentence a writer reads. */
export function describeObjectState(state: {
  objectId: string;
  ownerId?: string;
  holderId?: string;
  locationId?: string;
  condition?: string;
  status: ObjectStatus;
  visibility: ObjectVisibility;
  placement: ObjectPlacement;
}): string {
  const where =
    state.placement === "held" && state.holderId !== undefined
      ? `carried by ${state.holderId}`
      : state.locationId !== undefined
        ? `at ${state.locationId}`
        : "nowhere recorded";
  const bits = [where, state.status];
  if (state.ownerId !== undefined) bits.push(`owned by ${state.ownerId}`);
  if (state.condition !== undefined) bits.push(state.condition);
  if (state.visibility !== "visible") bits.push(state.visibility);
  return `${state.objectId}: ${bits.join("; ")}`;
}
