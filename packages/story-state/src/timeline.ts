import type { CharacterStatus } from "@jellytind/domain";
import { AppError } from "@jellytind/shared";
import type {
  CharacterState,
  KnowledgeEntry,
  ObjectState,
  StateBoundary,
  StateTransition,
  TimelineView,
  WorldState,
} from "./types";

export class TimelineError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super("timeline_error", message, details === undefined ? undefined : { details });
  }
}

/** A character with no recorded status transition is assumed alive and present. */
const DEFAULT_STATUS: CharacterStatus = "active";

/**
 * Time-aware story state.
 *
 * Given the story's scene order and the set of scene-anchored transitions, this
 * reconstructs what was true at any boundary by replaying every transition up to
 * that point. It stores no snapshots: "the state after Scene 42" is always
 * derived, so correcting one transition corrects every later answer at once.
 *
 * Reconstruction is deterministic — transitions replay in scene order, then in
 * transition-ID order within a scene — so the same timeline always yields the
 * same state.
 */
export class StoryTimeline {
  private readonly order: Map<string, number>;
  private readonly transitions: readonly StateTransition[];

  /**
   * @param sceneOrder Scene IDs in story order (see `orderScenes` in the domain).
   * @param transitions Every recorded transition, in any order.
   */
  constructor(sceneOrder: readonly string[], transitions: readonly StateTransition[]) {
    this.order = new Map(sceneOrder.map((id, i) => [id, i]));
    this.transitions = [...transitions].sort(
      (a, b) =>
        (this.order.get(a.sceneId) ?? Number.MAX_SAFE_INTEGER) -
          (this.order.get(b.sceneId) ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id),
    );
  }

  /** Scene IDs in story order. */
  get sceneOrder(): string[] {
    return [...this.order.keys()];
  }

  positionOf(sceneId: string): number {
    const at = this.order.get(sceneId);
    if (at === undefined) {
      throw new TimelineError(`Scene "${sceneId}" is not in the story order.`, { sceneId });
    }
    return at;
  }

  /**
   * Transitions in effect at a boundary: everything up to and including the
   * scene (`after`), or everything strictly before it (`before`).
   */
  private inEffect(boundary: StateBoundary, view: TimelineView): StateTransition[] {
    const at = this.positionOf(boundary.sceneId);
    const limit = boundary.position === "after" ? at : at - 1;
    const allowProposed = view.include === "with_proposed";
    return this.transitions.filter((t) => {
      if (t.confirmationStatus === "rejected") return false;
      if (t.confirmationStatus === "proposed" && !allowProposed) return false;
      const pos = this.order.get(t.sceneId);
      return pos !== undefined && pos <= limit;
    });
  }

  /** Every transition recorded at one scene, in replay order. */
  transitionsAtScene(sceneId: string): StateTransition[] {
    return this.transitions.filter((t) => t.sceneId === sceneId);
  }

  // ── Character state ──────────────────────────────────────────────────────

  characterStateAfterScene(
    characterId: string,
    sceneId: string,
    view: TimelineView = {},
  ): CharacterState {
    return this.characterStateAt(characterId, { sceneId, position: "after" }, view);
  }

  characterStateBeforeScene(
    characterId: string,
    sceneId: string,
    view: TimelineView = {},
  ): CharacterState {
    return this.characterStateAt(characterId, { sceneId, position: "before" }, view);
  }

  characterStateAt(
    characterId: string,
    asOf: StateBoundary,
    view: TimelineView = {},
  ): CharacterState {
    const effective = this.inEffect(asOf, view);
    let locationId: string | undefined;
    let status: CharacterStatus = DEFAULT_STATUS;
    const knowledge = new Map<string, KnowledgeEntry>();
    const owned = new Map<string, string>(); // objectId -> owner

    for (const t of effective) {
      switch (t.kind) {
        case "character_location":
          if (t.subjectId === characterId) locationId = t.value;
          break;
        case "character_status":
          if (t.subjectId === characterId) status = t.value as CharacterStatus;
          break;
        case "knowledge_gained":
          if (t.subjectId === characterId) {
            knowledge.set(t.value, {
              factId: t.value,
              certainty: t.certainty ?? 1,
              howLearned: t.howLearned ?? "witnessed",
              learnedInSceneId: t.sceneId,
            });
          }
          break;
        case "object_owner":
          owned.set(t.subjectId, t.value);
          break;
        default:
          break;
      }
    }

    return {
      characterId,
      ...(locationId !== undefined ? { locationId } : {}),
      status,
      inventory: [...owned.entries()]
        .filter(([, owner]) => owner === characterId)
        .map(([objectId]) => objectId)
        .sort(),
      knowledge: [...knowledge.values()].sort((a, b) => a.factId.localeCompare(b.factId)),
      asOf,
    };
  }

  /** Just the knowledge, for the common "does she know this yet?" question. */
  characterKnowledgeBeforeScene(
    characterId: string,
    sceneId: string,
    view: TimelineView = {},
  ): KnowledgeEntry[] {
    return [...this.characterStateBeforeScene(characterId, sceneId, view).knowledge];
  }

  characterKnowledgeAfterScene(
    characterId: string,
    sceneId: string,
    view: TimelineView = {},
  ): KnowledgeEntry[] {
    return [...this.characterStateAfterScene(characterId, sceneId, view).knowledge];
  }

  /** Whether a character knows a fact at a boundary, and how they learned it. */
  knows(
    characterId: string,
    factId: string,
    asOf: StateBoundary,
    view: TimelineView = {},
  ): KnowledgeEntry | null {
    return (
      this.characterStateAt(characterId, asOf, view).knowledge.find((k) => k.factId === factId) ??
      null
    );
  }

  // ── Object state ─────────────────────────────────────────────────────────

  objectStateAfterScene(objectId: string, sceneId: string, view: TimelineView = {}): ObjectState {
    return this.objectStateAt(objectId, { sceneId, position: "after" }, view);
  }

  objectStateBeforeScene(objectId: string, sceneId: string, view: TimelineView = {}): ObjectState {
    return this.objectStateAt(objectId, { sceneId, position: "before" }, view);
  }

  objectStateAt(objectId: string, asOf: StateBoundary, view: TimelineView = {}): ObjectState {
    let ownerId: string | undefined;
    let locationId: string | undefined;
    for (const t of this.inEffect(asOf, view)) {
      if (t.subjectId !== objectId) continue;
      if (t.kind === "object_owner") ownerId = t.value === "" ? undefined : t.value;
      if (t.kind === "object_location") locationId = t.value;
    }
    return {
      objectId,
      ...(ownerId !== undefined ? { ownerId } : {}),
      ...(locationId !== undefined ? { locationId } : {}),
      asOf,
    };
  }

  // ── Facts ────────────────────────────────────────────────────────────────

  /** Facts that are true in the story world at a boundary. */
  establishedFactsAt(asOf: StateBoundary, view: TimelineView = {}): string[] {
    return [
      ...new Set(
        this.inEffect(asOf, view)
          .filter((t) => t.kind === "fact_established")
          .map((t) => t.value),
      ),
    ].sort();
  }

  establishedFactsBeforeScene(sceneId: string, view: TimelineView = {}): string[] {
    return this.establishedFactsAt({ sceneId, position: "before" }, view);
  }

  // ── Whole world ──────────────────────────────────────────────────────────

  /** Everything known at a boundary, for the state inspector. */
  worldStateAt(asOf: StateBoundary, view: TimelineView = {}): WorldState {
    const effective = this.inEffect(asOf, view);
    const characterIds = new Set<string>();
    const objectIds = new Set<string>();

    for (const t of effective) {
      if (t.kind === "character_location" || t.kind === "character_status") {
        characterIds.add(t.subjectId);
      }
      if (t.kind === "knowledge_gained") characterIds.add(t.subjectId);
      if (t.kind === "object_owner") {
        objectIds.add(t.subjectId);
        if (t.value !== "") characterIds.add(t.value);
      }
      if (t.kind === "object_location") objectIds.add(t.subjectId);
    }

    return {
      asOf,
      characters: [...characterIds].sort().map((id) => this.characterStateAt(id, asOf, view)),
      objects: [...objectIds].sort().map((id) => this.objectStateAt(id, asOf, view)),
      establishedFacts: this.establishedFactsAt(asOf, view),
    };
  }
}
