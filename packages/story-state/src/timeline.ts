import {
  STATUS_IMPLIED_BY_INTERACTION,
  type CharacterStatus,
  type ObjectStatus,
  type ObjectVisibility,
  type PlotThreadStatus,
  type ThreadInteraction,
} from "@jellytind/domain";
import { AppError } from "@jellytind/shared";
import { holdsAsTrue, type AcquisitionStep, type KnowledgeRecord } from "./knowledge";
import {
  DEFAULT_OBJECT_STATUS,
  DEFAULT_OBJECT_VISIBILITY,
  isObjectTransition,
  objectChangeKind,
  type ObjectChange,
  type ObjectChangeKind,
  type ObjectTransfer,
} from "./objects";
import type {
  DimensionValue,
  RelationshipChange,
  RelationshipDimension,
  RelationshipEventRecord,
  RelationshipState,
} from "./relationships";
import type { ThreadDormancy, ThreadState, ThreadStep } from "./threads";
import { foldKnowledge, normaliseObjectStatus, normaliseTransition } from "./normalise";
import type {
  CharacterState,
  ObjectPlacement,
  ObjectState,
  Presence,
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
 * Manuscript shape, for measures this package cannot derive on its own.
 *
 * Scene order is enough for "how many scenes ago"; chapters and word counts come
 * from the project, so the caller supplies them. Optional throughout: a metric
 * that cannot be computed is reported as absent rather than guessed.
 */
export interface ManuscriptMetrics {
  readonly chapterBySceneId?: ReadonlyMap<string, string>;
  readonly wordsBySceneId?: ReadonlyMap<string, number>;
}

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
    let lastKnownLocationId: string | undefined;
    let travellingTo: string | undefined;
    let presence: Presence = "unknown";
    let status: CharacterStatus = DEFAULT_STATUS;
    const knowledge = new Map<string, KnowledgeRecord>();
    const owned = new Map<string, string>(); // objectId -> owner
    const held = new Map<string, string>(); // objectId -> holder

    for (const t of effective) {
      switch (t.kind) {
        case "character_location": {
          if (t.subjectId !== characterId) break;
          // An absent `movement` means arrival: that is what every transition
          // written before Phase 14 meant, and it stays true on read.
          const movement = t.movement ?? "arrival";
          travellingTo = undefined;
          if (t.value !== "") lastKnownLocationId = t.value;
          if (movement === "arrival") {
            locationId = t.value;
            presence = "present";
          } else if (movement === "departure") {
            locationId = undefined;
            presence = "departed";
          } else if (movement === "travel") {
            locationId = undefined;
            presence = "travelling";
            if (t.value !== "") travellingTo = t.value;
          } else {
            locationId = undefined;
            presence = "unknown";
          }
          break;
        }
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
        case "object_holder":
          held.set(t.subjectId, t.value);
          break;
        default:
          break;
      }
    }

    // What a character is *carrying* is what they hold; anything they own but
    // have not got on them is property, not inventory. With no holder recorded
    // the owner is the best available answer, which keeps projects that never
    // use `object_holder` working exactly as before.
    const carrying = new Set<string>();
    for (const [objectId, owner] of owned) {
      if (owner === characterId && !held.has(objectId)) carrying.add(objectId);
    }
    for (const [objectId, holder] of held) {
      if (holder === characterId) carrying.add(objectId);
      else carrying.delete(objectId);
    }

    return {
      characterId,
      ...(locationId !== undefined ? { locationId } : {}),
      presence,
      ...(travellingTo !== undefined ? { travellingTo } : {}),
      ...(lastKnownLocationId !== undefined ? { lastKnownLocationId } : {}),
      status,
      inventory: [...carrying].sort(),
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

  /**
   * An object's full state at a boundary.
   *
   * `placement` records which of holder and location was set most recently,
   * because that is what decides where the object actually is: a held object
   * travels with whoever holds it, a placed one stays where it was left. Getting
   * this wrong is precisely how "the revolver was in the flat" survives into a
   * scene at the manor (docs/OBJECTS_LOCATIONS.md).
   */
  objectStateAt(objectId: string, asOf: StateBoundary, view: TimelineView = {}): ObjectState {
    let ownerId: string | undefined;
    let holderId: string | undefined;
    let locationId: string | undefined;
    let condition: string | undefined;
    let status: ObjectStatus = DEFAULT_OBJECT_STATUS;
    let visibility: ObjectVisibility = DEFAULT_OBJECT_VISIBILITY;
    let placement: ObjectPlacement = "unplaced";

    for (const t of this.inEffect(asOf, view)) {
      if (t.subjectId !== objectId) continue;
      switch (t.kind) {
        case "object_owner":
          ownerId = t.value === "" ? undefined : t.value;
          break;
        case "object_holder":
          holderId = t.value === "" ? undefined : t.value;
          // Picking something up moves it; putting it down leaves it where the
          // holder was, which only a later `object_location` can state.
          placement = holderId === undefined ? "unplaced" : "held";
          break;
        case "object_location":
          locationId = t.value;
          placement = "placed";
          // Setting something down ends anyone's hold on it. Saying otherwise
          // would let one object be both in a drawer and in a pocket.
          holderId = undefined;
          break;
        case "object_condition":
          condition = t.value;
          break;
        case "object_status":
          status = normaliseObjectStatus(t.value);
          break;
        case "object_visibility":
          visibility = t.value as ObjectVisibility;
          break;
        default:
          break;
      }
    }

    return {
      objectId,
      ...(ownerId !== undefined ? { ownerId } : {}),
      ...(holderId !== undefined ? { holderId } : {}),
      ...(locationId !== undefined ? { locationId } : {}),
      ...(condition !== undefined ? { condition } : {}),
      status,
      visibility,
      placement,
      asOf,
    };
  }

  /**
   * Where an object effectively is, following whoever holds it.
   *
   * A held object is wherever its holder is, which is the only reading that
   * makes "Elias carries the revolver to the manor" work without a second
   * transition restating the obvious.
   */
  objectLocationAt(
    objectId: string,
    asOf: StateBoundary,
    view: TimelineView = {},
  ): string | undefined {
    const state = this.objectStateAt(objectId, asOf, view);
    if (state.placement === "held" && state.holderId !== undefined) {
      return this.characterStateAt(state.holderId, asOf, view).locationId;
    }
    return state.locationId;
  }

  /** Every object with any recorded change. */
  knownObjectIds(view: TimelineView = {}): string[] {
    return [
      ...new Set(
        this.visible(view)
          .filter(isObjectTransition)
          .map((t) => t.subjectId),
      ),
    ].sort();
  }

  /**
   * Every recorded step in one object's life, in story order, each carrying what
   * it changed *from* — the data behind an object history a writer can read.
   */
  objectHistory(objectId: string, view: TimelineView = {}): ObjectChange[] {
    const running = new Map<ObjectChangeKind, string>();
    const out: ObjectChange[] = [];

    for (const t of this.visible(view)) {
      if (t.subjectId !== objectId) continue;
      const kind = objectChangeKind(t.kind);
      if (kind === null) continue;
      const from = running.get(kind);
      running.set(kind, t.value);
      out.push({
        objectId,
        sceneId: t.sceneId,
        kind,
        ...(from !== undefined ? { from } : {}),
        to: t.value,
        ...(t.note !== undefined ? { reason: t.note } : {}),
      });
    }
    return out;
  }

  /**
   * Changes of hands and of place, as transfers.
   *
   * Derived from the same transitions the state is, so a transfer can never
   * disagree with the timeline. Holder and location changes recorded at one
   * scene are folded into a single transfer, because "Mara takes the key from
   * the drawer" is one event however many fields it touches.
   */
  objectTransfers(objectId: string, view: TimelineView = {}): ObjectTransfer[] {
    const bySceneId = new Map<string, Record<string, string>>();
    let holder: string | undefined;
    let location: string | undefined;

    for (const t of this.visible(view)) {
      if (t.subjectId !== objectId) continue;
      if (t.kind !== "object_holder" && t.kind !== "object_location") continue;

      const at = bySceneId.get(t.sceneId) ?? {};
      // The "from" of a transfer is whatever was true entering this scene, so it
      // is captured once and never overwritten by a second write at the scene.
      if (holder !== undefined) at.fromCharacterId ??= holder;
      if (location !== undefined) at.fromLocationId ??= location;
      if (t.note !== undefined) at.reason = t.note;

      if (t.kind === "object_holder") {
        holder = t.value === "" ? undefined : t.value;
        if (holder !== undefined) {
          at.toCharacterId = holder;
          // Picking something up takes it away from where it lay, so the next
          // hand-off is from a person, not from a place it left long ago.
          location = undefined;
        }
      } else {
        at.toLocationId = t.value;
        location = t.value;
        // Putting something down ends the hold — the same rule state replay
        // uses, so a transfer can never disagree with the state it describes.
        holder = undefined;
      }
      bySceneId.set(t.sceneId, at);
    }

    const rank = (sceneId: string): number => this.order.get(sceneId) ?? Number.MAX_SAFE_INTEGER;
    return [...bySceneId.entries()]
      .map(([sceneId, fields]) => ({ objectId, sceneId, ...fields }) as ObjectTransfer)
      .sort((a, b) => rank(a.sceneId) - rank(b.sceneId));
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

  // ── Relationships ────────────────────────────────────────────────────────

  /**
   * A relationship as it stood at a boundary.
   *
   * The identity — who the pair are — comes from the entity and never changes.
   * Everything mutable is replayed from transitions up to that point, so asking
   * about Chapter 3 gives Chapter 3's answer even after Chapter 20 has been
   * written. That is the whole point: **future state must never leak backwards**.
   */
  relationshipStateAt(
    identity: {
      id: string;
      characterAId: string;
      characterBId: string;
      type: string;
      status?: string;
      description?: string;
    },
    asOf: StateBoundary,
    view: TimelineView = {},
  ): RelationshipState {
    let type = identity.type;
    let status = identity.status ?? "";
    const dimensions: Partial<Record<RelationshipDimension, DimensionValue>> = {};
    const events: RelationshipEventRecord[] = [];

    for (const t of this.inEffect(asOf, view)) {
      if (t.subjectId !== identity.id) continue;
      switch (t.kind) {
        case "relationship_type":
          type = t.value;
          break;
        case "relationship_status":
          status = t.value;
          break;
        case "relationship_dimension": {
          if (t.dimension === undefined) break;
          const previous = dimensions[t.dimension];
          dimensions[t.dimension] = {
            dimension: t.dimension,
            ...(t.magnitude !== undefined ? { magnitude: t.magnitude } : {}),
            ...(t.level !== undefined ? { level: t.level } : {}),
            ...(t.note !== undefined ? { reason: t.note } : {}),
            changedAtSceneId: t.sceneId,
            ...(previous !== undefined
              ? {
                  previous: {
                    ...(previous.magnitude !== undefined ? { magnitude: previous.magnitude } : {}),
                    ...(previous.level !== undefined ? { level: previous.level } : {}),
                  },
                }
              : {}),
          };
          break;
        }
        case "relationship_event":
          events.push({
            kind: t.value as RelationshipEventRecord["kind"],
            sceneId: t.sceneId,
            ...(t.note !== undefined ? { reason: t.note } : {}),
          });
          break;
        default:
          break;
      }
    }

    return {
      relationshipId: identity.id,
      characterAId: identity.characterAId,
      characterBId: identity.characterBId,
      type,
      status,
      description: identity.description ?? "",
      dimensions,
      events,
      asOf,
    };
  }

  relationshipBeforeScene(
    identity: Parameters<StoryTimeline["relationshipStateAt"]>[0],
    sceneId: string,
    view: TimelineView = {},
  ): RelationshipState {
    return this.relationshipStateAt(identity, { sceneId, position: "before" }, view);
  }

  relationshipAfterScene(
    identity: Parameters<StoryTimeline["relationshipStateAt"]>[0],
    sceneId: string,
    view: TimelineView = {},
  ): RelationshipState {
    return this.relationshipStateAt(identity, { sceneId, position: "after" }, view);
  }

  /** Every recorded change to one relationship, in story order. */
  relationshipHistory(relationshipId: string, view: TimelineView = {}): RelationshipChange[] {
    const running = new Map<string, string>();
    const out: RelationshipChange[] = [];

    for (const t of this.visible(view)) {
      if (t.subjectId !== relationshipId) continue;
      const change = this.asRelationshipChange(t, running);
      if (change !== null) out.push(change);
    }
    return out;
  }

  /** Relationship changes recorded across a set of scenes — e.g. one chapter. */
  relationshipChangesInScenes(
    sceneIds: readonly string[],
    view: TimelineView = {},
  ): RelationshipChange[] {
    const wanted = new Set(sceneIds);
    const running = new Map<string, string>();
    const out: RelationshipChange[] = [];

    for (const t of this.visible(view)) {
      const change = this.asRelationshipChange(t, running);
      if (change !== null && wanted.has(t.sceneId)) out.push(change);
    }
    return out;
  }

  /**
   * Turn a transition into a change record, threading the running value so the
   * history reads `0.48 → 0.31` rather than only the destination. Returns null
   * for transitions that are not relationship changes.
   */
  private asRelationshipChange(
    t: StateTransition,
    running: Map<string, string>,
  ): RelationshipChange | null {
    const base = {
      relationshipId: t.subjectId,
      sceneId: t.sceneId,
      ...(t.note !== undefined ? { reason: t.note } : {}),
    };

    const track = (key: string, to: string): { from?: string; to: string } => {
      const from = running.get(key);
      running.set(key, to);
      return { ...(from !== undefined ? { from } : {}), to };
    };

    switch (t.kind) {
      case "relationship_type":
        return { ...base, kind: "type", label: "type", ...track(`${t.subjectId}:type`, t.value) };
      case "relationship_status":
        return {
          ...base,
          kind: "status",
          label: "status",
          ...track(`${t.subjectId}:status`, t.value),
        };
      case "relationship_dimension": {
        if (t.dimension === undefined) return null;
        const to =
          t.level !== undefined && t.magnitude !== undefined
            ? `${t.level} (${String(t.magnitude)})`
            : (t.level ?? String(t.magnitude ?? ""));
        return {
          ...base,
          kind: "dimension",
          label: t.dimension,
          ...track(`${t.subjectId}:${t.dimension}`, to),
        };
      }
      case "relationship_event":
        return { ...base, kind: "event", label: t.value, to: t.value };
      default:
        return null;
    }
  }

  /** Relationship IDs that have any recorded change. */
  knownRelationshipIds(view: TimelineView = {}): string[] {
    return [
      ...new Set(
        this.visible(view)
          .filter((t) => t.kind.startsWith("relationship_"))
          .map((t) => t.subjectId),
      ),
    ].sort();
  }

  // ── Plot threads ─────────────────────────────────────────────────────────

  /** Thread IDs with any recorded lifecycle change or appearance. */
  knownThreadIds(view: TimelineView = {}): string[] {
    return [
      ...new Set(
        this.visible(view)
          .filter((t) => t.kind === "thread_status" || t.kind === "thread_appearance")
          .map((t) => t.subjectId),
      ),
    ].sort();
  }

  /**
   * A thread's state at a boundary.
   *
   * The entity supplies identity and the *starting* status; everything that
   * moves is replayed. An appearance implies a status where the interaction has
   * an obvious meaning — `escalates` means escalating — but an explicit
   * `thread_status` always wins, because a writer overriding the obvious reading
   * is exactly the case worth honouring.
   */
  threadStateAt(
    identity: {
      id: string;
      name?: string;
      status?: PlotThreadStatus;
      introducedSceneId?: string;
      resolvedSceneId?: string;
    },
    asOf: StateBoundary,
    view: TimelineView = {},
  ): ThreadState {
    let status: PlotThreadStatus = identity.status ?? "planned";
    let introducedSceneId = identity.introducedSceneId;
    let resolvedSceneId = identity.resolvedSceneId;
    let lastInteraction: ThreadInteraction | undefined;
    const appearances: string[] = [];

    for (const t of this.inEffect(asOf, view)) {
      if (t.subjectId !== identity.id) continue;
      if (t.kind === "thread_status") {
        status = t.value as PlotThreadStatus;
        if (status === "resolved") resolvedSceneId ??= t.sceneId;
        if (status === "introduced") introducedSceneId ??= t.sceneId;
      } else if (t.kind === "thread_appearance") {
        const interaction = t.value as ThreadInteraction;
        lastInteraction = interaction;
        if (!appearances.includes(t.sceneId)) appearances.push(t.sceneId);
        const implied = STATUS_IMPLIED_BY_INTERACTION[interaction];
        if (implied !== undefined) status = implied;
        if (interaction === "introduces") introducedSceneId ??= t.sceneId;
        if (interaction === "resolves") resolvedSceneId ??= t.sceneId;
      }
    }

    return {
      threadId: identity.id,
      name: identity.name ?? identity.id,
      status,
      ...(introducedSceneId !== undefined ? { introducedSceneId } : {}),
      ...(resolvedSceneId !== undefined ? { resolvedSceneId } : {}),
      appearanceSceneIds: appearances,
      ...(lastInteraction !== undefined ? { lastInteraction } : {}),
      asOf,
    };
  }

  /**
   * Every recorded step in a thread's life, in story order, each carrying the
   * status it left behind — the data behind a lifecycle a writer can read.
   */
  threadHistory(
    threadId: string,
    startingStatus: PlotThreadStatus = "planned",
    view: TimelineView = {},
  ): ThreadStep[] {
    let status = startingStatus;
    const out: ThreadStep[] = [];

    for (const t of this.visible(view)) {
      if (t.subjectId !== threadId) continue;
      const previousStatus = status;

      if (t.kind === "thread_status") {
        status = t.value as PlotThreadStatus;
        out.push({
          threadId,
          sceneId: t.sceneId,
          status,
          ...(status === previousStatus ? {} : { previousStatus }),
          statusSource: status === previousStatus ? "unchanged" : "explicit",
          ...(t.note !== undefined ? { reason: t.note } : {}),
        });
      } else if (t.kind === "thread_appearance") {
        const interaction = t.value as ThreadInteraction;
        const implied = STATUS_IMPLIED_BY_INTERACTION[interaction];
        if (implied !== undefined) status = implied;
        out.push({
          threadId,
          sceneId: t.sceneId,
          interaction,
          status,
          ...(status === previousStatus ? {} : { previousStatus }),
          statusSource:
            status === previousStatus
              ? "unchanged"
              : implied === undefined
                ? "explicit"
                : "implied",
          ...(t.note !== undefined ? { reason: t.note } : {}),
        });
      }
    }
    return out;
  }

  /** Every scene that touched a thread, in story order. */
  threadAppearances(threadId: string, view: TimelineView = {}): string[] {
    const seen: string[] = [];
    for (const t of this.visible(view)) {
      if (t.subjectId !== threadId || t.kind !== "thread_appearance") continue;
      if (!seen.includes(t.sceneId)) seen.push(t.sceneId);
    }
    return seen;
  }

  /**
   * How long a thread has been off the page at a boundary.
   *
   * Every figure is a measurement. Nothing here decides whether a gap is too
   * long — that judgement belongs to the writer, and a system that made it for
   * them would be wrong about half the books ever written.
   *
   * Word distance needs the manuscript, which this package cannot read, so
   * counts are supplied by the caller (`@jellytind/story-repository` derives them
   * from chapter prose). Without them the other measures still work.
   */
  threadDormancy(
    threadId: string,
    asOf: StateBoundary,
    metrics: ManuscriptMetrics = {},
    view: TimelineView = {},
  ): ThreadDormancy {
    const here = this.positionOf(asOf.sceneId);
    const limit = asOf.position === "after" ? here : here - 1;

    let lastSceneId: string | undefined;
    let lastInteraction: ThreadInteraction | undefined;
    for (const t of this.visible(view)) {
      if (t.subjectId !== threadId || t.kind !== "thread_appearance") continue;
      const at = this.order.get(t.sceneId);
      if (at === undefined || at > limit) continue;
      lastSceneId = t.sceneId;
      lastInteraction = t.value as ThreadInteraction;
    }

    if (lastSceneId === undefined) {
      return { threadId, neverAppeared: true, asOf };
    }

    const from = this.positionOf(lastSceneId);
    const between = this.sceneOrder.slice(from + 1, limit + 1);

    const chapters = metrics.chapterBySceneId;
    const chaptersSince =
      chapters === undefined
        ? undefined
        : new Set(
            [lastSceneId, ...between]
              .map((id) => chapters.get(id))
              .filter((id): id is string => id !== undefined),
          ).size - 1;

    const words = metrics.wordsBySceneId;
    const wordsSince =
      words === undefined
        ? undefined
        : between.reduce((total, id) => total + (words.get(id) ?? 0), 0);

    return {
      threadId,
      lastAppearanceSceneId: lastSceneId,
      ...(lastInteraction !== undefined ? { lastInteraction } : {}),
      scenesSinceAppearance: between.length,
      ...(chaptersSince !== undefined && chaptersSince >= 0
        ? { chaptersSinceAppearance: chaptersSince }
        : {}),
      ...(wordsSince !== undefined ? { wordsSinceAppearance: wordsSince } : {}),
      neverAppeared: false,
      asOf,
    };
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
