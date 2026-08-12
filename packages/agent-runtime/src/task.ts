import { AgentError } from "./errors";

/**
 * Explicit, persisted agent tasks.
 *
 * Task state lives in the project, independently of chat history — chat is not
 * the task system and is not the source of truth (AGENTS.md; MASTER_BUILD.md
 * §48; docs/AGENT_RUNTIME.md).
 */
export type TaskStatus =
  "pending" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";

export type ApprovalPolicy =
  "autonomous" | "approve_destructive" | "approve_manuscript_edits" | "approve_every_edit";

export interface AgentTask {
  readonly id: string;
  readonly goal: string;
  readonly status: TaskStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * Entity IDs and/or project paths this task may touch. An empty scope means
   * "the whole project", which is meaningful for read-only investigation and
   * will be narrowed by write tools in a later phase.
   */
  readonly scope: readonly string[];
  /** The tools this task may call — the task half of the permission check. */
  readonly allowedTools: readonly string[];
  readonly approvalPolicy: ApprovalPolicy;
  /** Optional planning fields carried from docs/AGENT_RUNTIME.md. */
  readonly acceptanceCriteria?: readonly string[];
  readonly dependsOn?: readonly string[];
  /** Set when the task ends in `failed`, for display and debugging. */
  readonly failureReason?: string;
}

/** Statuses from which a task can no longer move. */
export const TERMINAL_STATUSES: readonly TaskStatus[] = ["completed", "failed", "cancelled"];

export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/**
 * The legal task lifecycle. Encoded as data so illegal transitions (a completed
 * task silently restarting, a cancelled task reporting success) are impossible
 * rather than merely discouraged.
 */
const TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: ["running", "cancelled", "failed"],
  running: ["awaiting_approval", "completed", "failed", "cancelled"],
  // Approval can either resume work or be the last step, as it is for a
  // manuscript edit whose only remaining action is the commit itself.
  awaiting_approval: ["running", "completed", "cancelled", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface CreateTaskInput {
  readonly id: string;
  readonly goal: string;
  readonly now: string;
  readonly scope?: readonly string[];
  readonly allowedTools: readonly string[];
  readonly approvalPolicy?: ApprovalPolicy;
  readonly acceptanceCriteria?: readonly string[];
  readonly dependsOn?: readonly string[];
}

export function createTask(input: CreateTaskInput): AgentTask {
  const goal = input.goal.trim();
  if (goal === "") {
    throw new AgentError("invalid_arguments", "A task needs a goal.");
  }
  return {
    id: input.id,
    goal,
    status: "pending",
    createdAt: input.now,
    updatedAt: input.now,
    scope: input.scope ?? [],
    allowedTools: input.allowedTools,
    approvalPolicy: input.approvalPolicy ?? "approve_every_edit",
    ...(input.acceptanceCriteria !== undefined
      ? { acceptanceCriteria: input.acceptanceCriteria }
      : {}),
    ...(input.dependsOn !== undefined ? { dependsOn: input.dependsOn } : {}),
  };
}

/**
 * Move a task to a new status, or throw. Returns a new task — task records are
 * immutable values so a caller cannot mutate one in place and lose the audit
 * trail.
 */
export function transition(
  task: AgentTask,
  to: TaskStatus,
  options: { now: string; failureReason?: string },
): AgentTask {
  if (!canTransition(task.status, to)) {
    throw new AgentError("invalid_transition", `A ${task.status} task cannot become ${to}.`, {
      details: { taskId: task.id, from: task.status, to },
    });
  }
  return {
    ...task,
    status: to,
    updatedAt: options.now,
    ...(options.failureReason !== undefined ? { failureReason: options.failureReason } : {}),
  };
}
