/**
 * @jellytind/story-state — deterministic, time-aware story state.
 *
 * State is a set of scene-anchored transitions, not a snapshot: the state at any
 * point is reconstructed by replaying them, so the system answers *what was true
 * immediately before Scene 42?* rather than only *what is true now*
 * (MASTER_BUILD.md §8, docs/STORY_STATE.md).
 */
export { StoryTimeline, TimelineError } from "./timeline";
export { validateTransition, describeTransition, TransitionError } from "./validate";
export type { TransitionDraft } from "./validate";

export { TRANSITION_KINDS, LEGACY_TRANSITION_KINDS } from "./types";

export {
  KNOWLEDGE_STATES,
  HOLDS_AS_TRUE,
  ACQUISITION_SOURCES,
  TRANSFER_SOURCES,
  HONEST_TRANSFER_SOURCES,
  requiresSourceKnowledge,
  holdsAsTrue,
  hasPosition,
  isTransfer,
  describeKnowledge,
} from "./knowledge";
export type {
  AcquisitionSource,
  AcquisitionStep,
  FactKnowledgeGraph,
  InformationAsymmetry,
  KnowledgeHolder,
  KnowledgeRecord,
  KnowledgeState,
} from "./knowledge";

export { factKnowledgeGraph, falseBeliefsAt, informationAsymmetriesAt } from "./graph";

export {
  RELATIONSHIP_DIMENSIONS,
  RELATIONSHIP_EVENT_KINDS,
  QUALITATIVE_LEVELS,
  isRelationshipDimension,
  isRelationshipEventKind,
  isQualitativeLevel,
  qualitativeOf,
  describeDimensionChange,
  describeRelationship,
} from "./relationships";
export type {
  DimensionValue,
  QualitativeLevel,
  RelationshipChange,
  RelationshipDimension,
  RelationshipEventKind,
  RelationshipEventRecord,
  RelationshipState,
} from "./relationships";

export { checkKnowledgeViolations } from "./violations";
export type {
  CheckInput,
  KnowledgeViolation,
  ViolationKind,
  ViolationSeverity,
} from "./violations";

export { normaliseTransition, foldKnowledge } from "./normalise";
export type {
  CharacterState,
  ConfirmationStatus,
  KnowledgeSource,
  ObjectState,
  StateBoundary,
  StateTransition,
  TimelineView,
  TransitionKind,
  TransitionSource,
  WorldState,
} from "./types";
