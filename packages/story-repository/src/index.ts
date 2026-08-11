import type { StoryProjectId } from "@jellytind/domain";
import type { ProjectStore } from "@jellytind/persistence";

/**
 * @jellytind/story-repository — the authoritative view of a writing project.
 *
 * The Story Repository is the source of truth (AGENTS.md). This package will sit
 * above {@link ProjectStore}, parsing the portable Markdown/YAML/JSON files into
 * typed domain entities and mediating all mutations through the versioning
 * layer. Phase 0 defines the interface only; the implementation is delivered in
 * the V1 slice (docs/STORY_REPOSITORY.md, docs/ROADMAP.md).
 *
 * @remarks PLANNED — entity read/write methods are added per vertical slice.
 */
export interface ProjectMetadata {
  readonly id: StoryProjectId;
  readonly name: string;
  readonly createdAt: string;
}

export interface StoryRepository {
  readonly metadata: ProjectMetadata;
  /** The underlying portable file store. */
  readonly files: ProjectStore;
  // Typed entity accessors (getScene, getCharacter, …) are PLANNED (V1+).
}
