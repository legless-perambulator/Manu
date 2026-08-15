import type {
  Chapter,
  Character,
  Dependency,
  Decision,
  Fact,
  Location,
  PlotThread,
  Relationship,
  Scene,
  StoryEvent,
  StoryTest,
} from "@jellytind/domain";
import type { StateTransition, StoryChronology, StoryTimeline } from "@jellytind/story-state";

/**
 * The Story Map (Phase 38): one canonical story, many views.
 *
 * Nothing here is a parallel graph model (§3). Every node, lane, edge and
 * milestone refers to an existing stable entity ID — the Character clicked in
 * the Timeline is the Character used everywhere else — and every view model
 * is a pure projection of the same {@link StoryMapContext}, which is simply
 * the slice of the repository's build context the views read. The map layer
 * computes; it never stores, and manual visual arrangement is never canon
 * (§19).
 */
export interface StoryMapContext {
  readonly scenes: readonly Scene[];
  readonly chapters: readonly Chapter[];
  readonly characters: readonly Character[];
  readonly locations: readonly Location[];
  readonly events: readonly StoryEvent[];
  readonly threads: readonly PlotThread[];
  readonly facts: readonly Fact[];
  readonly relationships: readonly Relationship[];
  readonly dependencies: readonly Dependency[];
  readonly decisions: readonly Decision[];
  readonly storyTests: readonly StoryTest[];
  readonly transitions: readonly StateTransition[];
  readonly timeline: StoryTimeline;
  readonly chronology: StoryChronology;
}

/**
 * A Story Point (§4): a precise moment in the telling — before or after one
 * scene. Chapter and act anchors resolve to scene boundaries, so "before
 * chapter 10" is exactly "before chapter 10's first scene". The shape is the
 * story-state `StateBoundary`, so every reconstruction query takes it as is.
 */
export interface StoryPoint {
  readonly sceneId: string;
  readonly position: "before" | "after";
}

/** One stop on the time scrubber: a scene boundary with its labelling. */
export interface StoryPointStop {
  readonly sceneId: string;
  readonly sceneTitle: string;
  readonly chapterId?: string;
  readonly chapterTitle?: string;
  /** 0-based presentation index of the scene. */
  readonly index: number;
}

/** Filters (§11). Absent = everything; defaults stay clean. */
export interface StoryMapFilters {
  readonly characterIds?: readonly string[];
  readonly locationIds?: readonly string[];
  readonly threadIds?: readonly string[];
  readonly chapterIds?: readonly string[];
  /** Presentation-index range, inclusive. */
  readonly range?: { readonly from: number; readonly to: number };
  readonly showEvents?: boolean;
}

// ── Timeline (§10) ───────────────────────────────────────────────────────────

export interface TimelineSceneModel {
  readonly sceneId: string;
  readonly title: string;
  readonly chapterId?: string;
  readonly chapterTitle?: string;
  /** Where it sits in the telling. */
  readonly presentationIndex: number;
  /** Where it sits in story-world time, when the chronology can say. */
  readonly chronologicalIndex?: number;
  /** Told later than things that happen after it (§10 — flashbacks). */
  readonly isFlashback: boolean;
  readonly characterIds: readonly string[];
  readonly locationId?: string;
  readonly threadIds: readonly string[];
}

export interface TimelineEventModel {
  readonly eventId: string;
  readonly name: string;
  /** The scene that puts it on the page; off-page events have none. */
  readonly sceneId?: string;
  readonly chronologicalIndex?: number;
  /** True when it precedes every scene — backstory / historical events. */
  readonly isHistorical: boolean;
}

/** One character's presence across the story — the parallel-activity lanes. */
export interface TimelineLane {
  readonly characterId: string;
  readonly name: string;
  readonly stops: ReadonlyArray<{
    readonly sceneId: string;
    readonly presentationIndex: number;
    readonly locationId?: string;
  }>;
}

export interface TimelineViewModel {
  readonly scenes: readonly TimelineSceneModel[];
  readonly events: readonly TimelineEventModel[];
  readonly lanes: readonly TimelineLane[];
  /** Node ids the chronology could not place. Shown, never hidden. */
  readonly unresolvable: readonly string[];
}

// ── Knowledge (§5) ───────────────────────────────────────────────────────────

export interface KnowledgeRowModel {
  readonly characterId: string;
  readonly name: string;
  /** known · believed · suspected · … · unknown (no record at this point). */
  readonly state: string;
  readonly acquiredAtSceneId?: string;
  readonly sourceType?: string;
  /** Who or what it came from, resolved to an entity ID. */
  readonly sourceEntityId?: string;
}

export interface FactKnowledgeModel {
  readonly factId: string;
  readonly statement: string;
  readonly at: StoryPoint;
  readonly rows: readonly KnowledgeRowModel[];
}

/** One character's information world at a point (§5). */
export interface CharacterKnowledgeModel {
  readonly characterId: string;
  readonly name: string;
  readonly at: StoryPoint;
  readonly holdings: ReadonlyArray<{
    readonly factId: string;
    readonly statement: string;
    readonly state: string;
    readonly acquiredAtSceneId?: string;
    readonly sourceEntityId?: string;
  }>;
}

// ── Relationships (§6) ───────────────────────────────────────────────────────

export interface RelationshipEdgeModel {
  readonly relationshipId: string;
  readonly characterAId: string;
  readonly characterBId: string;
  /** Qualitative, as recorded — "strained", "estranged". Never a number. */
  readonly status: string;
  readonly type: string;
  /** Tracked qualitative dimensions at this point, e.g. trust: low. */
  readonly dimensions: ReadonlyArray<{ readonly dimension: string; readonly value: string }>;
  /** The scenes where it changed — the writer's "key changes" list. */
  readonly keyChangeSceneIds: readonly string[];
}

export interface RelationshipViewModel {
  readonly at: StoryPoint;
  readonly nodes: ReadonlyArray<{ readonly characterId: string; readonly name: string }>;
  readonly edges: readonly RelationshipEdgeModel[];
}

// ── Causality (§7, §17) ──────────────────────────────────────────────────────

export interface CausalityNodeModel {
  readonly id: string;
  readonly label: string;
  /** The entity kind, read from the ID prefix — scene, character, thread… */
  readonly kind: string;
  /** Steps from the focus. Negative = prerequisite, positive = consequence. */
  readonly distance: number;
}

export interface CausalityEdgeModel {
  readonly causeId: string;
  readonly effectId: string;
  readonly kind: string;
  readonly description: string;
}

export interface CausalityViewModel {
  readonly focusId: string;
  readonly focusLabel: string;
  readonly nodes: readonly CausalityNodeModel[];
  readonly edges: readonly CausalityEdgeModel[];
  /** True when a traversal met a cycle. The view is still complete. */
  readonly cyclic: boolean;
}

// ── Plot threads (§8) ────────────────────────────────────────────────────────

export interface ThreadChapterModel {
  readonly chapterId: string;
  readonly title: string;
  readonly order: number;
  /** Scenes in this chapter that touch the thread. */
  readonly touchSceneIds: readonly string[];
  /** introduced · advanced · resolved · quiet for this chapter. */
  readonly marks: ReadonlyArray<{ readonly sceneId: string; readonly kind: string }>;
}

export interface ThreadViewModel {
  readonly threadId: string;
  readonly name: string;
  readonly status: string;
  readonly introducedSceneId?: string;
  readonly resolvedSceneId?: string;
  readonly chapters: readonly ThreadChapterModel[];
  /** Chapter spans with no touch between two touched chapters — dormancy. */
  readonly dormantSpans: ReadonlyArray<{
    readonly fromChapterId: string;
    readonly toChapterId: string;
    readonly chapters: number;
  }>;
}

// ── Character arc (§9) ───────────────────────────────────────────────────────

/**
 * A qualitative milestone (§9): something that changed, in words, anchored to
 * the scene where it changed. Deliberately not a numeric series.
 */
export interface ArcMilestone {
  readonly sceneId: string;
  readonly presentationIndex: number;
  readonly kind: "status" | "location" | "knowledge" | "relationship" | "decision" | "event";
  readonly label: string;
  /** The other entity involved, when there is one. */
  readonly aboutId?: string;
}

export interface CharacterArcModel {
  readonly characterId: string;
  readonly name: string;
  /** The character's stated goals, as authored context — not a chart. */
  readonly goals: readonly string[];
  readonly milestones: readonly ArcMilestone[];
}
