export { StoryRepository } from "./story-repository";
export type {
  CreateProjectOptions,
  OpenProjectOptions,
  ProjectValidation,
  DeleteMode,
  DeleteResult,
  TransactionMeta,
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
  AiProvenance,
  ChangeStatus,
  FileChange,
  EntityChange,
  ChangeSet,
  ChangeSetSummary,
  Checkpoint,
} from "./history";
export { StagedTransaction } from "./transaction";
export type { StagedFileOp } from "./transaction";
export { computeLineDiff, diffStat, buildHunks, applyHunks } from "./diff";
export type { DiffLine, DiffOp, DiffStat, DiffHunk } from "./diff";

export {
  sceneMarker,
  listSceneSpans,
  findSceneSpan,
  resolveSceneRange,
  bodyOffset,
} from "./scene-text";
export type { SceneSpan, SpanResolution, ResolveOptions } from "./scene-text";

export { parseFrontmatter, serializeFrontmatter } from "./frontmatter";

export type { CatalogEntity } from "./catalog";

export { RepositoryAgentStore } from "./agent-store";

export { TransitionStore } from "./state-store";
export { TimelineStore } from "./timeline-store";
export { BuildStore } from "./build-store";
export { TestStore } from "./test-store";
export { DebugStore } from "./debug-store";
export { SkillRunStore } from "./skill-run-store";
export { WorkflowRunStore } from "./workflow-run-store";
export { ChapterBuildStore } from "./chapter-build-store";
export { ChapterPlanStore } from "./chapter-plan-store";
export { ReaderSimulationStore } from "./reader-sim-store";
export { PersonalityStore } from "./personality-store";
export { MysteryStore } from "./mystery-store";
export { ExtensionStore } from "./extension-store";
export { migrateProject, MIGRATIONS, MIN_READABLE_SCHEMA } from "./migrations";
export type { Migration, MigrationOutcome } from "./migrations";
export { projectFolderName, availableFolderName } from "./project-folder";
export { ProjectBackups } from "./backups";
export type { BackupEntry } from "./backups";
export { ModuleStore } from "./module-store";
export type { ModuleSettings } from "./module-store";
export type { ModuleRuntime } from "./module-runtime";
export { DependencyStore } from "./dependency-store";
export { RefactorStore } from "./refactor-store";

export { BranchStore } from "./branch-store";
export {
  openBranch,
  createBranch,
  switchBranch,
  compareBranches,
  mergeBranch,
  deleteBranch,
} from "./branches";
export type {
  BranchComparison,
  FileDifference,
  RecordDifference,
  MergeConflict,
  MergeResult,
} from "./branches";

export { VoiceStore, checkVoiceRules } from "./voice-store";
export type { RuleHit, VoiceCheckResult } from "./voice-store";

export { CharacterVoiceStore } from "./character-voice-store";
export {
  measureDialogue,
  compareVoices,
  checkCharacterVoice,
  representativeLines,
} from "./character-voice";
export type {
  VoiceMetrics,
  VoiceSimilarity,
  MetricComparison,
  CharacterVoiceCheck,
  VoiceCheckFinding,
} from "./character-voice";

/**
 * A story with a reveal, shared by the temporal-leakage guards in this package,
 * `@jellytind/reader-sim` and `@jellytind/character-sim` — exported for the same
 * reason the Story Compiler exports its broken novel: three guards checking
 * three different stories would drift apart.
 */
export { leakageFixture, REVEAL_TOKEN } from "./leakage-fixture";
