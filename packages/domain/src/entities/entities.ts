import type { StoryProjectId, ChapterId, CharacterId, LocationId, PlotThreadId } from "../ids/ids";

/**
 * Phase-1 domain entities.
 *
 * These are deliberately minimal — the identity + basic metadata needed to
 * create, list and open real projects. Richer modelling (scenes, knowledge,
 * relationships, world rules, …) arrives in later slices (docs/DOMAIN_MODEL.md).
 * `filePath` values are always project-relative, POSIX-style paths into the
 * Story Repository; the file is the authoritative content, these records index
 * it.
 */

export type ChapterStatus = "outline" | "drafting" | "drafted" | "revised" | "final";

export type PlotThreadStatus =
  "planned" | "introduced" | "active" | "escalating" | "dormant" | "resolved" | "abandoned";

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
  readonly filePath: string;
}

export interface Location {
  readonly id: LocationId;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly filePath: string;
}

export interface PlotThread {
  readonly id: PlotThreadId;
  readonly name: string;
  readonly status: PlotThreadStatus;
  /** Chapter (or scene) ID where the thread is introduced, if known. */
  readonly introducedAt?: string;
  /** Chapter (or scene) ID where the thread is resolved, if known. */
  readonly resolvedAt?: string;
}

export const CHAPTER_STATUSES: readonly ChapterStatus[] = [
  "outline",
  "drafting",
  "drafted",
  "revised",
  "final",
];

export const PLOT_THREAD_STATUSES: readonly PlotThreadStatus[] = [
  "planned",
  "introduced",
  "active",
  "escalating",
  "dormant",
  "resolved",
  "abandoned",
];
