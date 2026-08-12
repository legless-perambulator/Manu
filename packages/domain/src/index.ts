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
