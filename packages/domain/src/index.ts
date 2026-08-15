/**
 * @jellytind/domain — the authoritative fiction domain model.
 *
 * Phase 0 establishes only the identity foundation: stable, branded entity IDs
 * and their generation. Phase 1 adds the minimal entity + manifest types needed
 * to create and open real projects. Richer entity modelling arrives per vertical
 * slice (see docs/DOMAIN_MODEL.md and docs/ROADMAP.md). Nothing in the UI or a
 * model response may become the authoritative representation of this data.
 */
export * from "./ids";
export * from "./entities";

export {
  DEPENDENCY_KINDS,
  DEPENDENCY_KIND_INFO,
  DEPENDENCY_NODE_KINDS,
  DEPENDENCY_STATUSES,
  DEPENDENCY_SOURCES,
  isDependencyNode,
  isDependencyKind,
  influenceOf,
  describeDependency,
} from "./causality";
export type {
  Dependency,
  DependencyKind,
  DependencyKindInfo,
  DependencySource,
  DependencyStatus,
  Influence,
} from "./causality";

export {
  MAIN_BRANCH_NAME,
  BRANCH_STATUSES,
  isMainBranch,
  normaliseBranchName,
  describeBranch,
} from "./branching";
export type { Branch, BranchId, BranchStatus } from "./branching";

export {
  VOICE_CATEGORIES,
  VOICE_SCOPES,
  SCOPE_PRECEDENCE,
  RULE_KINDS,
  SAMPLE_STANCES,
  POSITIVE_STANCES,
  NEGATIVE_STANCES,
  TENDENCY_STATUSES,
  CATEGORIES_FOR_OPERATION,
  isPositiveEvidence,
  isNegativeEvidence,
  isEvidence,
  categoriesFor,
  describeRule,
  scopeRank,
} from "./voice";

export {
  VOICE_ATTRIBUTES,
  SIMILARITY_BANDS,
  voiceAt,
  statedAttributes,
  describeBand,
} from "./character-voice";
export type {
  CharacterVoiceProfile,
  CharacterVoiceExample,
  CharacterVoiceShift,
  VoiceAttribute,
  VoiceAttributeValue,
  VoiceAttributes,
  VoiceExampleId,
  VoiceShiftId,
  SimilarityBand,
} from "./character-voice";
export type {
  AuthorVoiceProfile,
  VoiceCategory,
  VoiceScope,
  VoiceRule,
  VoiceRuleId,
  VoiceSample,
  VoiceSampleId,
  VoiceTendency,
  VoiceTendencyId,
  SampleStance,
  RuleKind,
  TendencyStatus,
} from "./voice";

export {
  orderChapters,
  orderScenes,
  adjacentChapters,
  adjacentScenes,
  scenesOfChapter,
} from "./story-order";
export type { Neighbours } from "./story-order";

export {
  STORY_TIME_KINDS,
  TEMPORAL_RELATIONS,
  RELATION_VERBS,
  isTemporalRelation,
  durationMs,
  describeDuration,
  boundsOf,
  isAnchored,
  parseInstant,
  describeStoryTime,
  normaliseStoryTime,
  normaliseDuration,
} from "./story-time";
export {
  indexLocations,
  locationPath,
  locationAncestors,
  locationDescendants,
  locationDepth,
  locationTreeFaults,
  describeLocationPath,
  isWithin,
  locationsCompatible,
  rootLocation,
} from "./location-tree";
export type { LocationIndex, LocationTreeFault, LocationTreeProblem } from "./location-tree";

export {
  TEST_SEVERITIES,
  SCOPE_KINDS,
  DETERMINISTIC_ASSERTION_KINDS,
  SEMANTIC_ASSERTION_KINDS,
  DEFAULT_TEST_SEVERITY,
  ALIVE_STATUSES,
  isDeterministicAssertion,
  assertionEntities,
  describeTest,
} from "./story-tests";
export type {
  Assertion,
  DeterministicAssertion,
  SemanticAssertion,
  StoryTest,
  TestScope,
  TestSeverity,
  TestType,
} from "./story-tests";

export type {
  StoryTime,
  StoryTimeKind,
  StoryDuration,
  TemporalRelation,
  TemporalLink,
  TimeBounds,
  TravelRule,
} from "./story-time";

export {
  SKILL_RUN_STATUSES,
  SKILL_STEP_STATUSES,
  SKILL_FINDING_KINDS,
  FINDING_SOURCES,
  summariseRun,
  isResumable,
  describeStep,
} from "./skills";
export type {
  FindingSource,
  SkillFinding,
  SkillFindingKind,
  SkillMeasurement,
  SkillRun,
  SkillRunStatus,
  SkillRunSummary,
  SkillStepRecord,
  SkillStepStatus,
} from "./skills";

export {
  ARTIFACT_KINDS,
  REVIEW_STANCES,
  ROUTING_CLASSES,
  WORKFLOW_RUN_STATUSES,
  WORKFLOW_NODE_STATUSES,
  EMPTY_COST,
  flattenNodes,
  summariseWorkflowRun,
  isAwaitingApproval,
  isWorkflowResumable,
  describeWorkflowNode,
} from "./orchestration";
export type {
  ArtifactKind,
  Disagreement,
  PendingApproval,
  ReviewNote,
  ReviewStance,
  RoutingClass,
  RunCost,
  WorkflowArtifact,
  WorkflowNodeRecord,
  WorkflowNodeStatus,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowRunSummary,
} from "./orchestration";

export {
  READER_LEVELS,
  LEVEL_INDEX,
  READER_QUESTIONS,
  SIMULATION_STATUSES,
  SIMULATION_CAVEAT,
  EMPTY_READER_STATE,
  levelOf,
  levelFor,
  currentState,
  summariseSimulation,
} from "./reader";
export type {
  ReaderAttitude,
  ReaderExposure,
  ReaderLevel,
  ReaderProfile,
  ReaderReading,
  ReaderSeries,
  ReaderSimulation,
  ReaderSimulationSummary,
  ReaderState,
  SimulationStatus,
} from "./reader";

export {
  PERSONALITY_DIMENSIONS,
  TRAIT_STATUSES,
  PLAUSIBILITY_BANDS,
  AGENCY_CAVEAT,
  SIMULATION_ADVISORY,
  describePlausibility,
  heuristicBand,
} from "./character-sim";
export type {
  AgencyFinding,
  BehaviourFactor,
  BehaviourTest,
  CharacterJudgement,
  Contradiction,
  Counterfactual,
  NarrativeCondition,
  PersonalityDimension,
  PersonalityTrait,
  PlausibilityBand,
  TraitStatus,
} from "./character-sim";

export {
  EVIDENCE_KINDS,
  CLUE_SOURCES,
  CLUE_STATUSES,
  CLUE_VISIBILITY,
  DEDUCTION_DIFFICULTIES,
  MYSTERY_STATUSES,
  FAIRNESS_PROBLEMS,
  FAIRNESS_VERDICTS,
  MYSTERY_CAVEAT,
  describeFairness,
} from "./mystery";
export type {
  AlibiFinding,
  Clue,
  ClueDiscovery,
  ClueSource,
  ClueStatus,
  ClueVisibility,
  Deduction,
  DeductionDifficulty,
  EvidenceKind,
  FairnessFinding,
  FairnessProblem,
  FairnessReport,
  FairnessVerdict,
  Mystery,
  MysteryStatus,
  ObviousnessFinding,
  Solvability,
  Suspect,
} from "./mystery";

// ── Genre module extensions (Phase 30) ──────────────────────────────────────
export { describeExtension, renderValue } from "./extensions";
export type { ExtensionRecord, ExtensionValue } from "./extensions";

// ── Chapter builds (Phase 31) ───────────────────────────────────────────────
export {
  APPROVAL_POLICIES,
  CHAPTER_BUILD_STATUSES,
  CHAPTER_BUILD_STEPS,
  RESUMABLE_STATUSES,
  SCENE_BUILD_STATUSES,
  isBuildFinished,
  isBuildResumable,
  summariseChapterBuild,
} from "./chapter-build";
export type {
  ApprovalPolicy,
  BuildDiagnostic,
  BuildPending,
  ChapterBuild,
  ChapterBuildStatus,
  ChapterBuildStep,
  ChapterBuildSummary,
  ModelRouteNote,
  PlanCoverageItem,
  SceneBuildRecord,
  SceneBuildStatus,
  SceneLengthTarget,
} from "./chapter-build";

// ── Chapter and scene planning (Phase 32) ───────────────────────────────────
export { PLAN_STATUSES, comparePlanVersions, emptyPlannedScene, planImpact } from "./planning";
export type {
  ChapterPlan,
  FactConstraint,
  KnowledgeChangePlan,
  PlanComparison,
  PlanFinding,
  PlanImpact,
  PlanRevision,
  PlanStatus,
  PlannedKnowledgeState,
  PlannedScene,
  RelationshipChangePlan,
  WordRange,
} from "./planning";

// ── Act planning and act builds (Phase 33) ──────────────────────────────────
export {
  CHAPTER_ROLE_SUGGESTIONS,
  actTestScope,
  compareActPlanVersions,
  emptyActPlan,
  summariseGoalReport,
  testAppliesToAct,
} from "./act-plan";
export type {
  ActArcGoal,
  ActChapter,
  ActGoalReport,
  ActGoalResult,
  ActPlan,
  ActPlanComparison,
  ActPlanFinding,
  ActPlanRevision,
  ActRelationshipGoal,
  ActThreadGoal,
} from "./act-plan";
export {
  ACT_APPROVAL_POLICIES,
  ACT_AUTONOMY_MODES,
  ACT_BUILD_STATUSES,
  ACT_BUILD_STEPS,
  ACT_CHAPTER_STATUSES,
  ACT_RESUMABLE_STATUSES,
  addRunCost,
  isActBuildFinished,
  isActBuildResumable,
  summariseActBuild,
} from "./act-build";
export type {
  ActApprovalPolicy,
  ActAutonomyMode,
  ActBuild,
  ActBuildStatus,
  ActBuildStep,
  ActBuildSummary,
  ActChapterRecord,
  ActChapterStatus,
  ActDiagnostic,
  ActPending,
} from "./act-build";

// ── Research (Phase 35) ─────────────────────────────────────────────────────
export {
  RESEARCH_PLACEHOLDER_PATTERN,
  RESEARCH_STATUSES,
  RESEARCH_TASK_STATUSES,
  RESEARCH_TYPES,
  emptyResearchItem,
  findResearchPlaceholders,
} from "./research";
export type {
  ResearchFact,
  ResearchGap,
  ResearchItem,
  ResearchProvenance,
  ResearchScope,
  ResearchStatus,
  ResearchTask,
  ResearchTaskStatus,
  ResearchType,
} from "./research";

// ── Book planning and book builds (Phase 34) ────────────────────────────────
export { emptyBookPlan } from "./book-plan";
export type { BookAct, BookPlan, BookPlanFinding, BookPlanRevision } from "./book-plan";
export {
  BOOK_ACT_STATUSES,
  BOOK_APPROVAL_POLICIES,
  BOOK_BUILD_STATUSES,
  BOOK_BUILD_STEPS,
  BOOK_BUILD_VARIANTS,
  BOOK_RESUMABLE_STATUSES,
  DEFAULT_QUALITY_GATES,
  describeBookProgress,
  isBookBuildFinished,
  isBookBuildResumable,
  summariseBookBuild,
} from "./book-build";
export type {
  BookActRecord,
  BookActStatus,
  BookApprovalPolicy,
  BookBuild,
  BookBuildReport,
  BookBuildStatus,
  BookBuildStep,
  BookBuildSummary,
  BookBuildVariant,
  BookDiagnostic,
  BookPending,
  BookProgress,
  BookQualityGates,
} from "./book-build";
