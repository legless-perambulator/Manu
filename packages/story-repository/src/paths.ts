import { WRITER_DIR, MANIFEST_PATH } from "@jellytind/domain";
import type { ChapterId, CharacterId, LocationId } from "@jellytind/domain";

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

export const PATHS = {
  manifest: MANIFEST_PATH,
  idSequences: `${WRITER_DIR}/state/id-sequences.json`,
  entitiesCatalog: `${WRITER_DIR}/index/entities.json`,
  derivedDb: `${WRITER_DIR}/index/derived.sqlite`,
  plotThreads: "plot/plot_threads.json",
} as const;

export function chapterFilePath(id: ChapterId): string {
  return `manuscript/${id}.md`;
}
export function characterFilePath(id: CharacterId): string {
  return `characters/${id}.md`;
}
export function locationFilePath(id: LocationId): string {
  return `world/locations/${id}.md`;
}
