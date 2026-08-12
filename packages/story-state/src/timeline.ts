import type { CharacterStatus } from "@jellytind/domain";
import { AppError } from "@jellytind/shared";
import { holdsAsTrue, type AcquisitionStep, type KnowledgeRecord } from "./knowledge";
import { foldKnowledge, normaliseTransition } from "./normalise";
import type {
  CharacterState,
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
    this.transitions = transitions
      .map(normaliseTransition)
      .sort(
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
    const knowledge = new Map<string, KnowledgeRecord>();
    const owned = new Map<string, string>(); // objectId -> owner

    for (const t of effective) {
      switch (t.kind) {
        case "character_location":
          if (t.subjectId === characterId) locationId = t.value;
          break;
        case "character_status":
          if (t.subjectId === characterId) status = t.value as CharacterStatus;
          break;
        case "knowledge_changed":
          if (t.subjectId === characterId) {
            knowledge.set(t.value, foldKnowledge(knowledge.get(t.value), t, characterId));
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
      // A position of `unknown` is the absence of a position, not a record.
      knowledge: [...knowledge.values()]
        .filter((record) => record.state !== "unknown")
        .sort((a, b) => a.factId.localeCompare(b.factId)),
      asOf,
    };
  }

  // ── Knowledge and belief ─────────────────────────────────────────────────

  /** Every position a character holds entering a scene. */
  characterKnowledgeBeforeScene(
    characterId: string,
    sceneId: string,
    view: TimelineView = {},
  ): KnowledgeRecord[] {
    return [...this.characterStateBeforeScene(characterId, sceneId, view).knowledge];
  }

  characterKnowledgeAfterScene(
    characterId: string,
    sceneId: string,
    view: TimelineView = {},
  ): KnowledgeRecord[] {
    return [...this.characterStateAfterScene(characterId, sceneId, view).knowledge];
  }

  /**
   * A character's position on one proposition at a boundary, or `null` if they
   * have none. Returns the record rather than a boolean, because "does Mara
   * know?" and "what does Mara think, and how did she come to?" are the same
   * question asked at different depths.
   */
  knows(
    characterId: string,
    factId: string,
    asOf: StateBoundary,
    view: TimelineView = {},
  ): KnowledgeRecord | null {
    return (
      this.characterStateAt(characterId, asOf, view).knowledge.find((k) => k.factId === factId) ??
      null
    );
  }

  /** Whether the character treats the proposition as true at that point. */
  doesCharacterKnowFactAtScene(
    characterId: string,
    factId: string,
    asOf: StateBoundary,
    view: TimelineView = {},
  ): boolean {
    const record = this.knows(characterId, factId, asOf, view);
    return record !== null && holdsAsTrue(record.state);
  }

  /** Everyone who has ever held a position on any proposition. */
  knownCharacterIds(view: TimelineView = {}): string[] {
    const ids = new Set<string>();
    for (const t of this.visible(view)) {
      if (t.kind === "knowledge_changed") ids.add(t.subjectId);
      if (t.kind === "character_location" || t.kind === "character_status") ids.add(t.subjectId);
    }
    return [...ids].sort();
  }

  /** Every proposition anyone has ever held a position on. */
  knownFactIds(view: TimelineView = {}): string[] {
    const ids = new Set<string>();
    for (const t of this.visible(view)) {
      if (t.kind === "knowledge_changed") ids.add(t.value);
      if (t.kind === "fact_established") ids.add(t.value);
    }
    return [...ids].sort();
  }

  /** Characters holding a proposition as true at a boundary. */
  charactersWhoKnowFactAtScene(
    factId: string,
    asOf: StateBoundary,
    view: TimelineView = {},
  ): KnowledgeRecord[] {
    return this.knownCharacterIds(view)
      .map((characterId) => this.knows(characterId, factId, asOf, view))
      .filter((record): record is KnowledgeRecord => record !== null && holdsAsTrue(record.state));
  }

  /**
   * Every change to one character's position on one proposition, in story
   * order — the answer to "when did Elias first learn about the vault, and has
   * he ever doubted it since?".
   */
  knowledgeHistory(
    characterId: string,
    factId: string,
    view: TimelineView = {},
  ): AcquisitionStep[] {
    return this.visible(view)
      .filter(
        (t) => t.kind === "knowledge_changed" && t.subjectId === characterId && t.value === factId,
      )
      .map((t) => this.stepOf(t));
  }

  /** Every change to anyone's position on one proposition, in story order. */
  factKnowledgeTimeline(factId: string, view: TimelineView = {}): AcquisitionStep[] {
    return this.visible(view)
      .filter((t) => t.kind === "knowledge_changed" && t.value === factId)
      .map((t) => this.stepOf(t));
  }

  /**
   * Follow a position back through whoever passed it on.
   *
   * Elias believes the vault exists because Mara told him in SCENE_0042; Mara
   * knows because she witnessed it in SCENE_0041. Chains stop at a first-hand
   * source, an unknown one, or a cycle.
   */
  traceAcquisition(
    characterId: string,
    factId: string,
    asOf: StateBoundary,
    view: TimelineView = {},
  ): AcquisitionStep[] {
    const chain: AcquisitionStep[] = [];
    const seen = new Set<string>();
    let current = characterId;
    let boundary = asOf;

    for (;;) {
      if (seen.has(current)) break;
      seen.add(current);
      const record = this.knows(current, factId, boundary, view);
      if (record === null) break;

      chain.push({
        characterId: current,
        factId,
        state: record.state,
        sourceType: record.sourceType,
        ...(record.sourceEntityId !== undefined ? { sourceEntityId: record.sourceEntityId } : {}),
        sceneId: record.acquiredAtSceneId ?? boundary.sceneId,
      });

      const from = record.sourceEntityId;
      if (
        from === undefined ||
        !from.startsWith("CHAR_") ||
        record.acquiredAtSceneId === undefined
      ) {
        break;
      }
      // The teller must have held it entering the scene where they told it.
      current = from;
      boundary = { sceneId: record.acquiredAtSceneId, position: "before" };
    }
    return chain;
  }

  private stepOf(t: StateTransition): AcquisitionStep {
    return {
      characterId: t.subjectId,
      factId: t.value,
      state: t.knowledgeState ?? "known",
      sourceType: t.sourceType ?? "unknown",
      ...(t.sourceEntityId !== undefined ? { sourceEntityId: t.sourceEntityId } : {}),
      sceneId: t.sceneId,
    };
  }

  /** Transitions honoured under a view, regardless of boundary. */
  private visible(view: TimelineView): StateTransition[] {
    const allowProposed = view.include === "with_proposed";
    return this.transitions.filter(
      (t) =>
        t.confirmationStatus !== "rejected" &&
        (t.confirmationStatus !== "proposed" || allowProposed) &&
        this.order.has(t.sceneId),
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
      if (t.kind === "knowledge_changed") characterIds.add(t.subjectId);
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
