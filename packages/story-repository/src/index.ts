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

export { parseFrontmatter, serializeFrontmatter } from "./frontmatter";

export type { CatalogEntity } from "./catalog";
