/**
 * The vocabulary of a multi-agent workflow run.
 *
 * Specialists cooperate by passing **artifacts** — a chapter brief, a scene
 * plan, a draft, a continuity report — not by talking to each other. The
 * workflow engine decides who runs next, and every handoff is a typed record
 * the writer can read (docs/ORCHESTRATION.md).
 */

/**
 * What one agent hands the next.
 *
 * Each is a structured record with its own shape. A transcript is not a handoff:
 * it cannot be validated, cannot be compared with another agent's, and cannot
 * be shown to a writer as *the thing that was decided*.
 */
export const ARTIFACT_KINDS = [
  "chapter_brief",
  "scene_plan",
  "draft",
  "character_notes",
  "continuity_report",
  "prose_notes",
  "merged_review",
  "revision_proposal",
  "build_result",
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export interface WorkflowArtifact<T = unknown> {
  readonly id: string;
  readonly kind: ArtifactKind;
  /** The node that produced it, and the specialist that ran there. */
  readonly nodeId: string;
  readonly producedBy: string;
  readonly createdAt: string;
  /** The model that produced it, when one did. Absent for deterministic nodes. */
  readonly modelId?: string;
  readonly payload: T;
}

/**
 * What a reviewing agent thinks should happen to something.
 *
 * A small closed set, because disagreement has to be **detectable**: two agents
 * holding different stances on the same target is a fact a program can find,
 * where two paragraphs of prose disagreeing is not.
 */
export const REVIEW_STANCES = ["keep", "revise", "cut", "flag"] as const;
export type ReviewStance = (typeof REVIEW_STANCES)[number];

export interface ReviewNote {
  /** What the note is about: a scene, a character, a line range, a thread. */
  readonly target: string;
  readonly stance: ReviewStance;
  readonly statement: string;
  readonly detail?: string;
  /** Why this is believed — a record, a measurement, or a model's reading. */
  readonly basis?: string;
}

/**
 * Two agents wanting different things for the same target.
 *
 * Kept whole, with both positions and who holds them. **Nothing resolves this
 * automatically**: the agent that happened to run last does not win, and the
 * merge step does not average two opinions into a third nobody holds.
 */
export interface Disagreement {
  readonly target: string;
  readonly positions: ReadonlyArray<{
    readonly agent: string;
    readonly stance: ReviewStance;
    readonly statement: string;
  }>;
  /** Set when the writer settles it. */
  readonly resolution?: {
    readonly chose: string;
    readonly note?: string;
    readonly decidedAt: string;
  };
}

/**
 * What kind of model a step wants, and what that costs in kind.
 *
 * The routing table maps these to configured models; a step never names a
 * provider or a version (docs/MODEL_ROUTER.md).
 */
export const ROUTING_CLASSES = [
  /** Structure, causality, diagnosis. The expensive thinking. */
  "premium_reasoning",
  /** Prose the writer will read. The expensive writing. */
  "premium_prose",
  /** Bulk reading where a smaller model is enough. */
  "cheap_analysis",
  /** No model at all: the project answers it. */
  "local_metadata",
] as const;
export type RoutingClass = (typeof ROUTING_CLASSES)[number];

/** What a run actually spent, counted rather than estimated in money. */
export interface RunCost {
  readonly byClass: Readonly<
    Record<string, { calls: number; inputTokens: number; outputTokens: number }>
  >;
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export const WORKFLOW_RUN_STATUSES = [
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "cancelled",
  "rejected",
] as const;
export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

export const WORKFLOW_NODE_STATUSES = [
  "pending",
  "running",
  "awaiting_approval",
  "ok",
  "skipped",
  "failed",
] as const;
export type WorkflowNodeStatus = (typeof WORKFLOW_NODE_STATUSES)[number];

export interface WorkflowNodeRecord {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  /** The specialist that runs here, for agent steps. */
  readonly agent?: string;
  readonly routingClass?: RoutingClass;
  readonly status: WorkflowNodeStatus;
  readonly summary?: string;
  /** Why it was skipped, or why it failed. Never left implicit. */
  readonly reason?: string;
  /** How many attempts it took. A retried step says so. */
  readonly attempts?: number;
  readonly artifactId?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly durationMs?: number;
  /** Nested steps, for parallel analysis. */
  readonly children?: readonly WorkflowNodeRecord[];
}

/** What the run is waiting for a human to say. */
export interface PendingApproval {
  readonly nodeId: string;
  readonly question: string;
  /** Artifacts the writer should read before answering. */
  readonly artifactIds: readonly string[];
  /** Disagreements that must be settled, if any. */
  readonly disagreements: readonly Disagreement[];
  readonly raisedAt: string;
}

export interface WorkflowRun {
  readonly id: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly goal: string;
  readonly inputs: Readonly<Record<string, string>>;
  readonly status: WorkflowRunStatus;
  readonly nodes: readonly WorkflowNodeRecord[];
  readonly artifacts: readonly WorkflowArtifact[];
  readonly disagreements: readonly Disagreement[];
  /** Checkpoints taken during the run, so the whole thing is revertible. */
  readonly checkpoints: readonly string[];
  /** Change sets the run committed. The audit trail, by ID. */
  readonly changeSets: readonly string[];
  readonly cost: RunCost;
  readonly pending?: PendingApproval;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly failureReason?: string;
  readonly resumeCount: number;
}

export interface WorkflowRunSummary {
  readonly id: string;
  readonly workflowId: string;
  readonly workflowName: string;
  readonly goal: string;
  readonly status: WorkflowRunStatus;
  readonly startedAt: string;
  readonly nodesDone: number;
  readonly nodesTotal: number;
  readonly openDisagreements: number;
}

export const EMPTY_COST: RunCost = { byClass: {}, calls: 0, inputTokens: 0, outputTokens: 0 };

/** Every node in a run, including the children of parallel steps. */
export function flattenNodes(nodes: readonly WorkflowNodeRecord[]): WorkflowNodeRecord[] {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children ?? [])]);
}

export function summariseWorkflowRun(run: WorkflowRun): WorkflowRunSummary {
  const all = flattenNodes(run.nodes);
  return {
    id: run.id,
    workflowId: run.workflowId,
    workflowName: run.workflowName,
    goal: run.goal,
    status: run.status,
    startedAt: run.startedAt,
    nodesDone: all.filter((node) => node.status === "ok" || node.status === "skipped").length,
    nodesTotal: all.length,
    openDisagreements: run.disagreements.filter((item) => item.resolution === undefined).length,
  };
}

export function isAwaitingApproval(run: WorkflowRun): boolean {
  return run.status === "awaiting_approval" && run.pending !== undefined;
}

/** True when a run stopped part-way and has nodes left to do. */
export function isWorkflowResumable(run: WorkflowRun): boolean {
  if (run.status === "awaiting_approval") return true;
  return (
    (run.status === "failed" || run.status === "cancelled") &&
    flattenNodes(run.nodes).some((node) => node.status === "pending" || node.status === "failed")
  );
}

/** The line the activity display shows for a node. */
export function describeWorkflowNode(node: WorkflowNodeRecord): string {
  const name = node.agent === undefined ? node.title : `${node.title} — ${node.agent}`;
  switch (node.status) {
    case "ok":
      return `✓ ${node.summary ?? name}`;
    case "skipped":
      return `− ${name} — ${node.reason ?? "skipped"}`;
    case "failed":
      return `✗ ${name} — ${node.reason ?? "failed"}`;
    case "running":
      return `→ ${name}`;
    case "awaiting_approval":
      return `⏸ ${name} — waiting for you`;
    case "pending":
      return `○ ${name}`;
  }
}
