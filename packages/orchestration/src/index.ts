/**
 * @jellytind/orchestration — controlled multi-agent orchestration.
 *
 * Specialists cooperate by passing **artifacts**, not by talking. The workflow
 * engine decides who runs next, validates every handoff before it becomes one,
 * keeps disagreement whole instead of letting the last agent win, stops at
 * approval gates, and writes nothing to the manuscript without a checkpoint and
 * the writer's word (docs/ORCHESTRATION.md).
 */

export {
  parseArtifact,
  renderArtifact,
  isReviewKind,
  ALL_ARTIFACT_KINDS,
  ARTIFACT_FORMATS,
} from "./artifacts";
export type {
  BuildResult,
  ChapterBrief,
  Draft,
  MergedReview,
  PlannedScene,
  ReviewArtifact,
  RevisionProposal,
  ScenePlan,
} from "./artifacts";

export {
  detectDisagreements,
  mergeReviews,
  resolveDisagreement,
  openDisagreements,
  describeDisagreement,
} from "./conflicts";

export {
  CONDITIONS,
  conditionById,
  conditionMap,
  nodeById,
  surfaceOf,
  validateWorkflowGraph,
  walkNodes,
} from "./graph";

export { DESCRIBE_CLASS, EMPTY_COST, addCost, describeCost, planCost, route } from "./routing";
export type { RoutingDecision, RoutingTable } from "./routing";

export { WorkflowRunner } from "./runner";
export type {
  ApprovalDecision,
  WorkflowProgress,
  WorkflowRunOptions,
  WorkflowRunnerOptions,
} from "./runner";

export {
  CHAPTER_WORKFLOW,
  CHAPTER_REVIEW_WORKFLOW,
  WORKFLOWS,
  defineWorkflow,
  workflowById,
} from "./workflows";

export { OrchestrationError } from "./types";
export type {
  AgentNode,
  AgentWorkExecutor,
  AgentWorkRequest,
  AgentWorkResult,
  ApplyNode,
  ApprovalNode,
  BuildNode,
  CheckpointNode,
  ConditionalNode,
  MergeNode,
  OrchestrationErrorCode,
  ParallelNode,
  WorkflowCondition,
  WorkflowDefinition,
  WorkflowInput,
  WorkflowNode,
  WorkflowRunStoreLike,
} from "./types";
