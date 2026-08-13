import { AppError } from "@jellytind/shared";
import type {
  ArtifactKind,
  RoutingClass,
  WorkflowArtifact,
  WorkflowRun,
  WorkflowRunSummary,
} from "@jellytind/domain";
import type { SpecialistId } from "@jellytind/agent-runtime";
import type { StoryRepository } from "@jellytind/story-repository";

export type OrchestrationErrorCode =
  | "unknown_workflow"
  | "unknown_node"
  | "invalid_workflow"
  | "missing_input"
  | "run_not_found"
  | "not_awaiting_approval"
  | "not_resumable"
  | "invalid_artifact"
  | "node_failed"
  | "unresolved_disagreement";

export class OrchestrationError extends AppError {
  constructor(
    code: OrchestrationErrorCode,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(code, message, options);
  }
}

export interface WorkflowInput {
  readonly key: string;
  readonly label: string;
  readonly entityKind?: "chapter" | "scene" | "character";
  readonly required: boolean;
}

/**
 * One specialist doing one piece of work.
 *
 * It reads the artifacts named in `reads` — the handoffs from earlier steps —
 * and produces exactly one. The specialist is named by id, so the agent's own
 * tool grant and permissions apply (docs/SPECIALIST_AGENTS.md); orchestration
 * cannot widen what an agent may reach.
 */
export interface AgentNode {
  readonly kind: "agent";
  readonly id: string;
  readonly title: string;
  readonly agent: SpecialistId;
  readonly instruction: string;
  readonly reads: readonly ArtifactKind[];
  readonly produces: ArtifactKind;
  readonly routingClass: RoutingClass;
  /** The Context Compiler recipe this step's work is compiled from. */
  readonly contextRecipe?: "scene_inspection" | "scene_rewrite" | "chapter_inspection";
  /** Attempts allowed, including the first. Defaults to 1 — no silent retries. */
  readonly maxAttempts?: number;
}

/** Independent analyses, run together. Their results are merged, never chained. */
export interface ParallelNode {
  readonly kind: "parallel";
  readonly id: string;
  readonly title: string;
  readonly branches: readonly AgentNode[];
}

/**
 * Combine several reviews into one, and **surface where they disagree**.
 *
 * The merge does not choose. Two agents holding different stances on the same
 * target become a `Disagreement` carrying both positions, which an approval
 * gate puts in front of the writer.
 */
export interface MergeNode {
  readonly kind: "merge";
  readonly id: string;
  readonly title: string;
  readonly reads: readonly ArtifactKind[];
  readonly produces: "merged_review";
}

/** A stop. The run persists and waits for a human. */
export interface ApprovalNode {
  readonly kind: "approval";
  readonly id: string;
  readonly title: string;
  readonly question: string;
  readonly reads: readonly ArtifactKind[];
  /** When true, every disagreement must be settled before approval is possible. */
  readonly requiresDisagreementsResolved?: boolean;
}

/** A revertible point in the project's history, before anything is written. */
export interface CheckpointNode {
  readonly kind: "checkpoint";
  readonly id: string;
  readonly title: string;
  readonly label: string;
}

/** Write an approved draft into the manuscript, as one recorded change set. */
export interface ApplyNode {
  readonly kind: "apply";
  readonly id: string;
  readonly title: string;
  readonly reads: readonly ArtifactKind[];
}

/** Run the Story Build. Deterministic; no model involved. */
export interface BuildNode {
  readonly kind: "build";
  readonly id: string;
  readonly title: string;
  readonly produces: "build_result";
}

/** Run the children only when a named, deterministic condition holds. */
export interface ConditionalNode {
  readonly kind: "conditional";
  readonly id: string;
  readonly title: string;
  readonly when: string;
  readonly children: readonly WorkflowNode[];
}

export type WorkflowNode =
  | AgentNode
  | ParallelNode
  | MergeNode
  | ApprovalNode
  | CheckpointNode
  | ApplyNode
  | BuildNode
  | ConditionalNode;

export interface WorkflowDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly inputs: readonly WorkflowInput[];
  readonly nodes: readonly WorkflowNode[];
  /** Every specialist the workflow uses, derived from its nodes. */
  readonly agents: readonly SpecialistId[];
  /** Every routing class it draws on, derived from its nodes. */
  readonly routingClasses: readonly RoutingClass[];
}

/**
 * The work a specialist actually does, as a port.
 *
 * Orchestration holds no provider knowledge and no prompts for producing
 * prose: it says which specialist, which instruction, and which handoffs to
 * work from. An implementation above it (`@jellytind/editing`) compiles the
 * context and calls the model under that specialist's own grant.
 *
 * With no executor, every agent step is **skipped with a stated reason** and
 * the deterministic nodes — checkpoint, build — still run.
 */
export interface AgentWorkRequest {
  readonly agent: SpecialistId;
  readonly nodeId: string;
  readonly instruction: string;
  readonly goal: string;
  readonly produces: ArtifactKind;
  readonly routingClass: RoutingClass;
  readonly contextRecipe?: "scene_inspection" | "scene_rewrite" | "chapter_inspection";
  readonly targetId?: string;
  /** The structured handoffs this step was given. */
  readonly inputs: readonly WorkflowArtifact[];
  readonly signal?: AbortSignal;
}

export interface AgentWorkResult {
  /** Validated against the artifact kind before it becomes a handoff. */
  readonly payload: unknown;
  readonly modelId?: string;
  readonly calls?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
}

export interface AgentWorkExecutor {
  run(request: AgentWorkRequest): Promise<AgentWorkResult>;
}

/** Persistence for runs, satisfied structurally by `repo.workflowRuns`. */
export interface WorkflowRunStoreLike {
  nextId(): Promise<string>;
  get(id: string): Promise<WorkflowRun | null>;
  save(run: WorkflowRun): Promise<WorkflowRun>;
  list(limit?: number): Promise<WorkflowRunSummary[]>;
}

/** A deterministic predicate over what the run has produced so far. */
export interface WorkflowCondition {
  readonly id: string;
  readonly description: string;
  holds(context: { repo: StoryRepository; run: WorkflowRun }): boolean;
}
