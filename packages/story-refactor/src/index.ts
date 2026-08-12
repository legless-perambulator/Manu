/**
 * @jellytind/story-refactor — the fiction equivalent of a code refactor.
 *
 * "Make Marcus Elias's childhood friend instead of his brother" is a change to
 * a story's architecture, not to a paragraph. It reaches a character record, a
 * relationship, the facts and threads that rested on the sibling bond, every
 * scene that says the word, and the knowledge those scenes moved. Done by
 * hand, the last consequence surfaces six months later.
 *
 * ```
 * analyse → plan → checkpoint → stage → validate → present → commit or discard
 * ```
 *
 * Dependency discovery runs through the structured systems and manuscript
 * discovery through the search index — a model is never asked *what is
 * affected*, because the project already knows. Validation runs against a
 * shadow copy of the project, so "commit only after approval" is literally
 * true (docs/STORY_REFACTOR.md).
 */

export { analyseRefactor, describeRequest, occurrencePattern } from "./analyse";
export { planRefactor, locate, applyReplacement } from "./plan";
export { stageRefactor, introducedBy, failedValidation } from "./execute";
export type { RefactorOptions, StagedRefactor } from "./execute";
export { renderAnalysis, renderValidation } from "./present";
export { refactorAccess } from "./access";
export { RefactorPlanner } from "./planner";
export type { EnrichedPlan, RefactorPlannerOptions, RejectedRewrite } from "./planner";

export {
  REFACTOR_KINDS,
  REFACTOR_KIND_LABEL,
  REFACTOR_STATUSES,
  RISK_LEVELS,
  RefactorError,
  snapshot,
} from "./types";
export type {
  AffectedEntityRef,
  ChangeAttributeRequest,
  ChangeRelationshipRequest,
  ManuscriptReference,
  MoveEventRequest,
  PlanStep,
  RefactorAnalysis,
  RefactorErrorCode,
  RefactorKind,
  RefactorPlan,
  RefactorRequest,
  RefactorRisk,
  RefactorRun,
  RefactorRunSummary,
  RefactorStatus,
  RenameEntityRequest,
  RiskLevel,
  TextOccurrence,
  ValidationSnapshot,
} from "./types";
