import { WRITER_DIR, MANIFEST_PATH } from "@jellytind/domain";
import type { ChapterId, CharacterId, LocationId, ObjectId } from "@jellytind/domain";

/**
 * Canonical project layout. All paths are project-relative, POSIX-style.
 * See docs/STORY_REPOSITORY.md for the rationale behind each area.
 */

/** Directories created for a fresh project. */
export const PROJECT_DIRECTORIES: readonly string[] = [
  "manuscript",
  "scenes",
  "story",
  "characters",
  "world",
  "world/locations",
  "world/factions",
  "world/history",
  "world/objects",
  "world/glossary",
  "plot",
  "style",
  "style/examples",
  "research",
  "notes",
  WRITER_DIR,
  `${WRITER_DIR}/state`,
  `${WRITER_DIR}/revisions`,
  `${WRITER_DIR}/index`,
  `${WRITER_DIR}/agents`,
  `${WRITER_DIR}/skills`,
  `${WRITER_DIR}/tests`,
  `${WRITER_DIR}/simulations`,
];

/** Top-level content areas shown in the project explorer. */
export const EXPLORER_ROOTS: readonly string[] = [
  "manuscript",
  "scenes",
  "characters",
  "world",
  "plot",
  "style",
  "research",
  "notes",
];

/** Directories holding per-entity Markdown files (one file per entity). */
export const ENTITY_DIRS = {
  chapter: "manuscript",
  character: "characters",
  location: "world/locations",
  object: "world/objects",
} as const;

export const PATHS = {
  manifest: MANIFEST_PATH,
  idSequences: `${WRITER_DIR}/state/id-sequences.json`,
  entitiesCatalog: `${WRITER_DIR}/index/entities.json`,
  derivedDb: `${WRITER_DIR}/index/derived.sqlite`,
  scenes: "scenes/scenes.json",
  plotThreads: "plot/plot_threads.json",
  facts: "story/facts.json",
  worldRules: "story/world_rules.json",
  events: "plot/events.json",
  relationships: "story/relationships.json",
  setups: "plot/setups.json",
  decisions: "plot/decisions.json",
  dependencies: "plot/dependencies.json",
} as const;

export function chapterFilePath(id: ChapterId): string {
  return `${ENTITY_DIRS.chapter}/${id}.md`;
}
export function characterFilePath(id: CharacterId): string {
  return `${ENTITY_DIRS.character}/${id}.md`;
}
export function locationFilePath(id: LocationId): string {
  return `${ENTITY_DIRS.location}/${id}.md`;
}
export function objectFilePath(id: ObjectId): string {
  return `${ENTITY_DIRS.object}/${id}.md`;
}
