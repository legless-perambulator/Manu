export { StoryRepository } from "./story-repository";
export type {
  CreateProjectOptions,
  OpenProjectOptions,
  ProjectValidation,
  DeleteMode,
  DeleteResult,
} from "./story-repository";

export { RepositoryError } from "./errors";
export type { RepositoryErrorCode } from "./errors";

export { validateManifest, buildManifest } from "./manifest";

export {
  PROJECT_DIRECTORIES,
  EXPLORER_ROOTS,
  ENTITY_DIRS,
  PATHS,
  chapterFilePath,
  characterFilePath,
  locationFilePath,
  objectFilePath,
} from "./paths";

export { buildProjectTree } from "./tree";
export type { TreeNode } from "./tree";

export { EntityGraph } from "./graph";
export type { GraphKind, ReferenceEdge, IntegrityReport } from "./graph";

export { ProjectSearch } from "./project-search";
export type {
  SearchHit,
  SearchQuery,
  SearchFilters,
  SearchMeta,
  ResultKind,
} from "@jellytind/search";

export type {
  Actor,
  ChangeStatus,
  FileChange,
  EntityChange,
  ChangeSet,
  ChangeSetSummary,
  Checkpoint,
} from "./history";
export { StagedTransaction } from "./transaction";
export type { StagedFileOp } from "./transaction";
export { computeLineDiff, diffStat } from "./diff";
export type { DiffLine, DiffOp, DiffStat } from "./diff";

export { parseFrontmatter, serializeFrontmatter } from "./frontmatter";

export type { CatalogEntity } from "./catalog";

export { RepositoryAgentStore } from "./agent-store";
