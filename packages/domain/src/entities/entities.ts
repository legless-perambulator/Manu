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

export type ObjectStatus = "intact" | "lost" | "destroyed" | "transformed" | "unknown";
export const OBJECT_STATUSES: readonly ObjectStatus[] = [
  "intact",
  "lost",
  "destroyed",
  "transformed",
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

/** A timeline-worthy story event. */
export interface StoryEvent {
  readonly id: EventId;
  readonly name: string;
  readonly description: string;
  /** Free-form story-world time, e.g. "1997", "Day 3, evening". */
  readonly storyTime?: string;
  readonly sceneId?: SceneId;
  readonly locationId?: LocationId;
  readonly characterIds: readonly CharacterId[];
}

/** Identity of a relationship between two characters. No numeric state yet. */
export interface Relationship {
  readonly id: RelationshipId;
  readonly characterAId: CharacterId;
  readonly characterBId: CharacterId;
  /** Free-form relationship type, e.g. "sibling", "rival", "mentor". */
  readonly type: string;
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
}
