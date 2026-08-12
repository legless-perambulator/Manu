import {
  indexLocations,
  locationTreeFaults,
  locationsCompatible,
  type Location,
  type LocationIndex,
  type Scene,
} from "@jellytind/domain";
import { isGone } from "./objects";
import type { StoryTimeline } from "./timeline";
import type { StateTransition, TimelineView } from "./types";

/**
 * Deterministic physical-continuity checks.
 *
 * The acceptance test for this module is that a project can find basic physical
 * continuity problems **without a model re-reading the manuscript**. A revolver
 * left in a flat in chapter 19 and fired at the manor in chapter 22 is sixty
 * thousand words apart on the page and two recorded states apart here, so the
 * answer is arithmetic rather than interpretation (docs/OBJECTS_LOCATIONS.md).
 *
 * Two disciplines keep it from crying wolf:
 *
 * - **Containment is honoured.** Someone in the Hidden Vault is at Blackthorn
 *   Manor. A check that could not see that would report a contradiction between
 *   two true statements, which is worse than no check.
 * - **Silence is not a claim.** An object with no recorded location makes no
 *   assertion to contradict. Nothing here infers state that was never recorded.
 */
export type ContinuityViolationKind =
  /** A scene uses an object the recorded state puts somewhere else. */
  | "impossible_object_appearance"
  /** An object is used or moved after it was destroyed. */
  | "destroyed_object_reused"
  /** One scene records two different owners, or two different holders. */
  | "conflicting_object_ownership"
  /** An object moved on its own: nobody was carrying it and nothing carried it. */
  | "unexplained_object_relocation"
  /** A character is put in two places that cannot both be true. */
  | "conflicting_character_location"
  /** The location tree is malformed: a cycle, a self-parent, a missing parent. */
  | "invalid_nested_location"
  /** A character appears in a scene after the story recorded them dead. */
  | "dead_character_appears";

/**
 * How confident the finding is.
 *
 * An `error` is a contradiction the recorded data cannot support. A `warning` is
 * a discrepancy that is often just incomplete tracking — a scene set somewhere
 * the character was not last recorded is usually an unrecorded walk, not a
 * mistake — so it is surfaced without being called wrong.
 */
export type ContinuitySeverity = "error" | "warning";

export interface ContinuityViolation {
  readonly kind: ContinuityViolationKind;
  readonly severity: ContinuitySeverity;
  readonly sceneId?: string;
  readonly objectId?: string;
  readonly characterId?: string;
  readonly locationIds?: readonly string[];
  readonly message: string;
}

export interface ContinuityCheckInput {
  readonly timeline: StoryTimeline;
  readonly scenes: readonly Scene[];
  readonly locations: readonly Location[];
  readonly view?: TimelineView;
}

/**
 * Check the project's physical continuity.
 *
 * Reusable and UI-free, like the knowledge and timeline checks: the Story
 * Compiler, the repository and the Objects panel all call this one function.
 */
export function checkContinuity(input: ContinuityCheckInput): ContinuityViolation[] {
  const locations = indexLocations(input.locations);
  return [
    ...checkLocationTree(locations),
    ...checkObjects(input, locations),
    ...checkCharacterLocations(input, locations),
    ...checkTheDead(input),
  ];
}

// ── The location tree itself ─────────────────────────────────────────────────

function checkLocationTree(locations: LocationIndex): ContinuityViolation[] {
  return locationTreeFaults(locations).map((fault) => ({
    kind: "invalid_nested_location" as const,
    severity: "error" as const,
    locationIds: [fault.locationId],
    message:
      fault.problem === "self_parent"
        ? `${fault.locationId} is inside itself.`
        : fault.problem === "missing_parent"
          ? `${fault.locationId} is inside ${String(fault.parentLocationId)}, which does not exist in this project.`
          : `${fault.locationId} is part of a containment loop (${(fault.path ?? []).join(" → ")}).`,
  }));
}

// ── Objects ──────────────────────────────────────────────────────────────────

function checkObjects(
  input: ContinuityCheckInput,
  locations: LocationIndex,
): ContinuityViolation[] {
  const { timeline } = input;
  const view = input.view ?? {};
  const out: ContinuityViolation[] = [];
  const bySceneId = new Map(input.scenes.map((s) => [s.id as string, s]));

  for (const sceneId of timeline.sceneOrder) {
    const scene = bySceneId.get(sceneId);
    const steps = timeline
      .transitionsAtScene(sceneId)
      .filter((t) => t.confirmationStatus !== "rejected");
    const entering = { sceneId, position: "before" } as const;

    out.push(...conflictingWrites(steps, sceneId));

    // Objects the scene puts on the page, plus any it changes.
    const touched = new Set<string>([
      ...((scene?.objectIds ?? []) as readonly string[]),
      ...steps.filter((t) => t.kind.startsWith("object_")).map((t) => t.subjectId),
    ]);

    for (const objectId of [...touched].sort()) {
      const before = timeline.objectStateAt(objectId, entering, view);
      const changesHere = steps.filter((t) => t.subjectId === objectId);
      const restated = changesHere.some((t) => t.kind === "object_status");

      // ── Destroyed and used again ────────────────────────────────────────
      // A scene that explicitly restates the status is the writer handling it
      // — resurrection, reconstruction, a twin — and is not a finding.
      if (isGone(before.status) && !restated) {
        const onThePage = scene !== undefined && objectsOf(scene).includes(objectId);
        out.push({
          kind: "destroyed_object_reused",
          severity: "error",
          sceneId,
          objectId,
          message: `${objectId} was destroyed before ${sceneId}, but ${sceneId} ${
            onThePage ? "uses it" : "changes it"
          }.`,
        });
        continue;
      }

      // ── Somewhere it cannot be ──────────────────────────────────────────
      if (scene?.locationId === undefined) continue;
      if (!objectsOf(scene).includes(objectId)) continue;
      // A transition in this very scene brings it here; nothing to explain.
      if (changesHere.some((t) => t.kind === "object_location" || t.kind === "object_holder")) {
        continue;
      }

      const held = before.placement === "held" && before.holderId !== undefined;
      if (held) {
        // Carried objects arrive with whoever carries them. The holder being
        // elsewhere is a *character* location question, checked as one.
        const holderHere = involves(scene, before.holderId as string);
        if (!holderHere) {
          out.push({
            kind: "impossible_object_appearance",
            severity: "warning",
            sceneId,
            objectId,
            characterId: before.holderId as string,
            message: `${sceneId} uses ${objectId}, but it is being carried by ${String(before.holderId)}, who is not in the scene.`,
          });
        }
        continue;
      }

      const where = before.locationId;
      if (where === undefined) continue;
      if (locationsCompatible(locations, where, scene.locationId as string)) continue;

      out.push({
        kind: "impossible_object_appearance",
        severity: "error",
        sceneId,
        objectId,
        locationIds: [where, scene.locationId as string],
        message: `${sceneId} takes place at ${String(scene.locationId)} and uses ${objectId}, but ${objectId} was last recorded at ${where}, and nothing moves it.`,
      });
    }
  }

  out.push(...unexplainedRelocations(input, locations));
  return out;
}

/**
 * Two writes at one scene that cannot both be true.
 *
 * Owner and holder disagreeing is *not* a conflict — a stolen revolver still
 * belongs to its owner, and separating the two is the point of having both. Two
 * owners, or two holders, at the same moment is the contradiction.
 */
function conflictingWrites(
  steps: readonly StateTransition[],
  sceneId: string,
): ContinuityViolation[] {
  const out: ContinuityViolation[] = [];
  for (const kind of ["object_owner", "object_holder"] as const) {
    const seen = new Map<string, string>();
    for (const t of steps) {
      if (t.kind !== kind) continue;
      const previous = seen.get(t.subjectId);
      if (previous !== undefined && previous !== t.value) {
        out.push({
          kind: "conflicting_object_ownership",
          severity: "error",
          sceneId,
          objectId: t.subjectId,
          message: `${sceneId} records ${t.subjectId} as ${
            kind === "object_owner" ? "owned" : "held"
          } by both ${previous === "" ? "nobody" : previous} and ${t.value === "" ? "nobody" : t.value}.`,
        });
      }
      seen.set(t.subjectId, t.value);
    }
  }
  return out;
}

/**
 * Objects that moved themselves.
 *
 * An object put down in one place and later recorded in another, with nobody
 * having picked it up in between, went somewhere on its own. That is usually an
 * unrecorded carry rather than a mistake, so it is a warning — but it is exactly
 * the "no transition explains the movement" case the system exists to surface.
 */
function unexplainedRelocations(
  input: ContinuityCheckInput,
  locations: LocationIndex,
): ContinuityViolation[] {
  const { timeline } = input;
  const view = input.view ?? {};
  const out: ContinuityViolation[] = [];

  for (const objectId of timeline.knownObjectIds(view)) {
    let placedAt: string | undefined;
    let carried = false;

    for (const change of timeline.objectHistory(objectId, view)) {
      if (change.kind === "holder") {
        carried = change.to !== "";
        continue;
      }
      if (change.kind !== "location") continue;

      if (
        placedAt !== undefined &&
        !carried &&
        !locationsCompatible(locations, placedAt, change.to)
      ) {
        out.push({
          kind: "unexplained_object_relocation",
          severity: "warning",
          sceneId: change.sceneId,
          objectId,
          locationIds: [placedAt, change.to],
          message: `${objectId} moves from ${placedAt} to ${change.to} at ${change.sceneId}, but nobody is recorded as carrying it.`,
        });
      }
      placedAt = change.to;
      carried = false;
    }
  }

  return out;
}

// ── Characters ───────────────────────────────────────────────────────────────

function checkCharacterLocations(
  input: ContinuityCheckInput,
  locations: LocationIndex,
): ContinuityViolation[] {
  const { timeline } = input;
  const view = input.view ?? {};
  const out: ContinuityViolation[] = [];
  const bySceneId = new Map(input.scenes.map((s) => [s.id as string, s]));

  for (const sceneId of timeline.sceneOrder) {
    const scene = bySceneId.get(sceneId);
    const steps = timeline
      .transitionsAtScene(sceneId)
      .filter((t) => t.confirmationStatus !== "rejected" && t.kind === "character_location");

    // ── Two arrivals at one scene that cannot both hold ─────────────────────
    const arrivals = new Map<string, string>();
    for (const t of steps) {
      if ((t.movement ?? "arrival") !== "arrival") continue;
      const previous = arrivals.get(t.subjectId);
      if (previous !== undefined && !locationsCompatible(locations, previous, t.value)) {
        out.push({
          kind: "conflicting_character_location",
          severity: "error",
          sceneId,
          characterId: t.subjectId,
          locationIds: [previous, t.value],
          message: `${sceneId} places ${t.subjectId} at both ${previous} and ${t.value}, which do not contain each other.`,
        });
      }
      arrivals.set(t.subjectId, t.value);
    }

    // ── The scene's own setting versus where the character was ─────────────
    if (scene?.locationId === undefined) continue;
    for (const characterId of castOf(scene)) {
      if (arrivals.has(characterId)) continue;
      if (steps.some((t) => t.subjectId === characterId)) continue;

      const before = timeline.characterStateAt(characterId, { sceneId, position: "before" }, view);
      // Nothing recorded, or explicitly in transit or unrecorded, makes no
      // claim for the scene to contradict.
      if (before.presence !== "present" || before.locationId === undefined) continue;
      if (locationsCompatible(locations, before.locationId, scene.locationId as string)) continue;

      out.push({
        kind: "conflicting_character_location",
        severity: "warning",
        sceneId,
        characterId,
        locationIds: [before.locationId, scene.locationId as string],
        message: `${characterId} appears in ${sceneId} at ${String(scene.locationId)}, but was last recorded at ${before.locationId}, and nothing moves them.`,
      });
    }
  }

  return out;
}

/**
 * Characters on the page after the story has killed them.
 *
 * The one continuity error every reader catches and no writer means to make.
 * A scene that explicitly changes the character's status is the writer handling
 * it — a resurrection, a faked death, a body double — and is not a finding.
 */
function checkTheDead(input: ContinuityCheckInput): ContinuityViolation[] {
  const { timeline } = input;
  const view = input.view ?? {};
  const out: ContinuityViolation[] = [];
  const bySceneId = new Map(input.scenes.map((s) => [s.id as string, s]));

  for (const sceneId of timeline.sceneOrder) {
    const scene = bySceneId.get(sceneId);
    if (scene === undefined) continue;
    const restated = new Set(
      timeline
        .transitionsAtScene(sceneId)
        .filter((t) => t.kind === "character_status" && t.confirmationStatus !== "rejected")
        .map((t) => t.subjectId),
    );

    for (const characterId of castOf(scene)) {
      if (restated.has(characterId)) continue;
      const before = timeline.characterStateAt(characterId, { sceneId, position: "before" }, view);
      if (before.status !== "deceased") continue;
      out.push({
        kind: "dead_character_appears",
        severity: "error",
        sceneId,
        characterId,
        message: `${characterId} is recorded as deceased before ${sceneId}, but appears in it.`,
      });
    }
  }

  return out;
}

function castOf(scene: Scene): string[] {
  return [
    ...new Set([
      ...(scene.pov === undefined ? [] : [scene.pov as string]),
      ...(scene.characterIds as readonly string[]),
    ]),
  ];
}

function involves(scene: Scene, characterId: string): boolean {
  return castOf(scene).includes(characterId);
}

function objectsOf(scene: Scene): readonly string[] {
  return scene.objectIds as readonly string[];
}
