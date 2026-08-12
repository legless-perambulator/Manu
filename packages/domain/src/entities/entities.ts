import type {
  StoryProjectId,
  ChapterId,
  SceneId,
  CharacterId,
  LocationId,
  PlotThreadId,
  FactId,
  ObjectId,
  EventId,
  WorldRuleId,
  RelationshipId,
} from "../ids/ids";
import type { StoryDuration, StoryTime } from "../story-time";

/**
 * Foundational fiction-domain entities (Phase 3).
 *
 * These are structured, first-class story-world objects — no AI interpretation.
 * References between entities are always by stable ID. `filePath` values (where
 * present) are project-relative, POSIX-style paths; the file is the
 * human-readable authoritative content and the record indexes it.
 * See docs/DOMAIN_MODEL.md.
 */

// ── Status vocabularies ──────────────────────────────────────────────────────

export type ChapterStatus = "outline" | "drafting" | "drafted" | "revised" | "final";
export const CHAPTER_STATUSES: readonly ChapterStatus[] = [
  "outline",
  "drafting",
  "drafted",
  "revised",
  "final",
];

export type SceneStatus = "planned" | "drafted" | "revised" | "final" | "cut";
export const SCENE_STATUSES: readonly SceneStatus[] = [
  "planned",
  "drafted",
  "revised",
  "final",
  "cut",
];

export type CharacterStatus = "active" | "inactive" | "deceased" | "unknown";
export const CHARACTER_STATUSES: readonly CharacterStatus[] = [
  "active",
  "inactive",
  "deceased",
  "unknown",
];

/**
 * Whether an object is still in the story world, and findable.
 *
 * `hidden` is not `lost`: someone put it there and, usually, someone knows
 * where. `lost` is nobody's knowledge. Both differ from `unknown`, which is the
 * project not having recorded an answer rather than the story giving one.
 */
export type ObjectStatus = "exists" | "lost" | "destroyed" | "hidden" | "unknown";
export const OBJECT_STATUSES: readonly ObjectStatus[] = [
  "exists",
  "lost",
  "destroyed",
  "hidden",
  "unknown",
];

/**
 * Statuses written before status and condition were separated, and what they
 * mean now.
 *
 * `transformed` conflated the two: a melted candlestick still exists, it is in a
 * different *condition*. Interpreted on read so no project is rewritten
 * (docs/OBJECTS_LOCATIONS.md).
 */
export const LEGACY_OBJECT_STATUSES: Readonly<Record<string, ObjectStatus>> = {
  intact: "exists",
  transformed: "exists",
};

/**
 * Whether an object can be seen for what it is.
 *
 * Distinct from status, and the distinction earns its place: a `concealed`
 * object is present but not found, a `disguised` one is in plain sight and not
 * recognised — which is a different scene, and often a different plot.
 */
export type ObjectVisibility = "visible" | "concealed" | "disguised" | "unknown";
export const OBJECT_VISIBILITIES: readonly ObjectVisibility[] = [
  "visible",
  "concealed",
  "disguised",
  "unknown",
];

export type PlotThreadStatus =
  "planned" | "introduced" | "active" | "escalating" | "dormant" | "resolved" | "abandoned";
export const PLOT_THREAD_STATUSES: readonly PlotThreadStatus[] = [
  "planned",
  "introduced",
  "active",
  "escalating",
  "dormant",
  "resolved",
  "abandoned",
];

export type FactStatus = "canonical" | "provisional" | "retconned";
export const FACT_STATUSES: readonly FactStatus[] = ["canonical", "provisional", "retconned"];

export type WorldRuleSeverity = "hard" | "soft" | "style";
export const WORLD_RULE_SEVERITIES: readonly WorldRuleSeverity[] = ["hard", "soft", "style"];

// ── Entities ─────────────────────────────────────────────────────────────────

export interface Project {
  readonly id: StoryProjectId;
  readonly title: string;
  /** Absolute path to the project root on disk (not persisted in the manifest). */
  readonly rootPath: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly schemaVersion: number;
}

export interface Chapter {
  readonly id: ChapterId;
  readonly title: string;
  /** Ordering key within the manuscript (0-based, gaps allowed). */
  readonly order: number;
  readonly filePath: string;
  readonly status: ChapterStatus;
}

export interface Character {
  readonly id: CharacterId;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly role: string;
  readonly notes: string;
  readonly status: CharacterStatus;
  readonly filePath: string;
}

export interface Location {
  readonly id: LocationId;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly parentLocationId?: LocationId;
  readonly notes: string;
  readonly filePath: string;
}

/** An important tracked object. Not every object mentioned in prose is an entity. */
export interface StoryObject {
  readonly id: ObjectId;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly status: ObjectStatus;
  readonly filePath: string;
}

export interface PlotThread {
  readonly id: PlotThreadId;
  readonly name: string;
  readonly description: string;
  readonly status: PlotThreadStatus;
  readonly introducedSceneId?: SceneId;
  readonly resolvedSceneId?: SceneId;
  readonly relatedSceneIds: readonly SceneId[];
}

/**
 * A proposition about the story world, e.g. "The vault exists beneath Blackthorn
 * Manor."
 *
 * A fact is a *statement*, not a truth: `objectiveTruth` says whether it holds in
 * the fictional world. A false proposition is still a first-class entity, because
 * characters can believe it — `FACT_KILLER_IS_MARCUS` with `objectiveTruth: false`
 * is exactly what a false belief points at. Never mutate a fact to represent what
 * a character thinks (docs/STORY_STATE.md — "Truth, belief and knowledge").
 */
export interface Fact {
  readonly id: FactId;
  readonly statement: string;
  readonly status: FactStatus;
  /** Whether the statement is true in the story world. Defaults to true. */
  readonly objectiveTruth: boolean;
  readonly source?: string;
  readonly notes?: string;
}

export interface WorldRule {
  readonly id: WorldRuleId;
  readonly name: string;
  readonly description: string;
  readonly severity: WorldRuleSeverity;
  /** Free-form area the rule governs, e.g. "magic", "travel", "global". */
  readonly scope: string;
}

/**
 * A timeline-worthy story event.
 *
 * An event is not tied to the manuscript. It may happen inside a scene, off the
 * page between two scenes, or decades before the book opens — which is why
 * `sceneId` is optional and story time is not (docs/TIMELINE.md).
 */
export interface StoryEvent {
  readonly id: EventId;
  readonly name: string;
  readonly description: string;
  /**
   * Where this sits in story-world time. Optional at every precision: an exact
   * instant, a date, a range, a position relative to another node, or a bare
   * ordinal marker like "Day 3, evening".
   */
  readonly storyTime?: StoryTime;
  /** How long it takes, when it matters. */
  readonly duration?: StoryDuration;
  /** The scene that puts it on the page, if any. Off-page events have none. */
  readonly sceneId?: SceneId;
  readonly locationId?: LocationId;
  readonly characterIds: readonly CharacterId[];
  /** Plot threads this event belongs to, for timeline filtering. */
  readonly plotThreadIds?: readonly PlotThreadId[];
}

/**
 * The **identity** of a relationship between two characters.
 *
 * Identity survives change: `REL_0012` is Elias↔Mara for the whole book, however
 * often the type or status changes. `type` and `status` here are the *starting*
 * values; how the relationship evolves lives in scene-anchored transitions and
 * is reconstructed at any story moment (docs/STORY_STATE.md).
 */
export interface Relationship {
  readonly id: RelationshipId;
  readonly characterAId: CharacterId;
  readonly characterBId: CharacterId;
  /** Starting relationship type, e.g. "sibling", "rival", "mentor". */
  readonly type: string;
  /** Starting free-form status, e.g. "warm", "strained". Optional to record. */
  readonly status: string;
  readonly description: string;
}

/** A scene: the structural unit that links story-world entities together. */
export interface Scene {
  readonly id: SceneId;
  readonly title: string;
  readonly chapterId?: ChapterId;
  /** Point-of-view character. */
  readonly pov?: CharacterId;
  readonly locationId?: LocationId;
  /** Participating characters. */
  readonly characterIds: readonly CharacterId[];
  readonly plotThreadIds: readonly PlotThreadId[];
  readonly objectIds: readonly ObjectId[];
  /**
   * Facts this scene puts on the page — stated, referenced or relied upon. The
   * deterministic signal behind "this character references information they have
   * not acquired" (docs/STORY_STATE.md — knowledge violations).
   */
  readonly factIds: readonly FactId[];
  /** What the scene is for (goals/beats), as short lines. */
  readonly purpose: readonly string[];
  readonly status: SceneStatus;
  /**
   * When this scene happens in the story world — which is **not** where it sits
   * in the manuscript. A scene presented third may happen first; leaving this
   * unset simply means the chronology falls back to ordering relations, or to
   * presentation order if there are none (docs/TIMELINE.md).
   */
  readonly storyTime?: StoryTime;
  /** How much story-world time the scene covers, when it matters. */
  readonly duration?: StoryDuration;
}
