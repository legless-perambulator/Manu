// Browser-safe barrel. Must not import `node:*` (the renderer bundles this).
// Node-only filesystem/SQLite adapters live in "@jellytind/persistence/node".
export type { ProjectStore } from "./project-store";
export { InMemoryProjectStore } from "./project-store";

export type { StateStore } from "./state-store";
export { InMemoryStateStore } from "./state-store";

export type { RevisionStore, RevisionEntry, RevisionAuthor } from "./revision-store";

export { PathEscapeError, normalizeProjectPath, isSafeProjectPath } from "./path-safety";

export type { SqlDatabase, SqlValue, Migration, EntityRecord } from "./sql";
export {
  MIGRATIONS,
  runMigrations,
  latestSchemaVersion,
  currentSchemaVersion,
  ProjectIndex,
} from "./sql";
