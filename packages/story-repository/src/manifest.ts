import { ok, err, type Result } from "@jellytind/shared";
import {
  SCHEMA_VERSION,
  APP_FORMAT_VERSION,
  isStoryProjectId,
  type ProjectManifest,
  type StoryProjectId,
} from "@jellytind/domain";
import { RepositoryError } from "./errors";

export interface NewManifestInput {
  readonly id: StoryProjectId;
  readonly title: string;
  readonly now: string;
}

export function buildManifest(input: NewManifestInput): ProjectManifest {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: input.id,
    title: input.title,
    createdAt: input.now,
    updatedAt: input.now,
    appFormatVersion: APP_FORMAT_VERSION,
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * Parse and validate raw manifest text (or an already-parsed object). Unknown
 * extra fields are tolerated for forward compatibility; required fields must be
 * present and well-typed. A manifest whose schemaVersion is newer than this build
 * supports is rejected with an `unsupported_schema` error.
 */
export function validateManifest(raw: string | unknown): Result<ProjectManifest, RepositoryError> {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (cause) {
      return err(new RepositoryError("invalid_manifest", "Manifest is not valid JSON.", { cause }));
    }
  }

  if (typeof value !== "object" || value === null) {
    return err(new RepositoryError("invalid_manifest", "Manifest must be a JSON object."));
  }
  const m = value as Record<string, unknown>;

  if (typeof m.schemaVersion !== "number" || !Number.isInteger(m.schemaVersion)) {
    return err(
      new RepositoryError("invalid_manifest", "Manifest is missing an integer schemaVersion."),
    );
  }
  if (m.schemaVersion > SCHEMA_VERSION) {
    return err(
      new RepositoryError(
        "unsupported_schema",
        `Project schemaVersion ${m.schemaVersion} is newer than this app supports (${SCHEMA_VERSION}). Please update JellyTind.`,
        { details: { found: m.schemaVersion, supported: SCHEMA_VERSION } },
      ),
    );
  }
  if (!isNonEmptyString(m.id) || !isStoryProjectId(m.id)) {
    return err(
      new RepositoryError("invalid_manifest", "Manifest has a missing or invalid project id."),
    );
  }
  if (!isNonEmptyString(m.title)) {
    return err(new RepositoryError("invalid_manifest", "Manifest is missing a title."));
  }
  if (!isNonEmptyString(m.createdAt) || !isNonEmptyString(m.updatedAt)) {
    return err(new RepositoryError("invalid_manifest", "Manifest is missing timestamps."));
  }
  if (!isNonEmptyString(m.appFormatVersion)) {
    return err(new RepositoryError("invalid_manifest", "Manifest is missing appFormatVersion."));
  }

  return ok({
    schemaVersion: m.schemaVersion,
    id: m.id,
    title: m.title,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    appFormatVersion: m.appFormatVersion,
  });
}
