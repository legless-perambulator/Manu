import type { StoryProjectId } from "../ids/ids";

/**
 * Story Repository schema version. Bump when the on-disk format changes in a way
 * that requires migration. Migration functions key off this value
 * (docs/STORY_REPOSITORY.md).
 */
export const SCHEMA_VERSION = 1 as const;

/**
 * Application format version — the semantic version of the writer app that last
 * wrote the project. Independent of {@link SCHEMA_VERSION}: it is informational
 * / diagnostic, whereas schemaVersion drives migrations.
 */
export const APP_FORMAT_VERSION = "0.1.0" as const;

/** Directory holding all app-managed (non-manuscript) project state. */
export const WRITER_DIR = ".writer";

/** Project manifest path, relative to the project root. */
export const MANIFEST_PATH = `${WRITER_DIR}/project.json`;

/**
 * Contents of `.writer/project.json`.
 *
 * This is the identity record of a project. It is intentionally small and
 * forward-compatible: readers must tolerate unknown extra fields, and the
 * `schemaVersion` lets future versions migrate older manifests.
 */
export interface ProjectManifest {
  readonly schemaVersion: number;
  readonly id: StoryProjectId;
  readonly title: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly appFormatVersion: string;
}
