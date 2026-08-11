import type { AnyId } from "@jellytind/domain";

/**
 * Explicit, persisted agent tasks. Task state lives independently of chat
 * history (AGENTS.md — chat is not the source of truth; MASTER_BUILD.md §48).
 * Phase 0 defines the shape; the orchestration engine that decomposes and runs
 * tasks is implemented in V3 (docs/AGENT_RUNTIME.md, docs/ROADMAP.md).
 */
export type TaskStatus = "pending" | "in_progress" | "blocked" | "completed" | "cancelled";

export type ApprovalPolicy =
  "autonomous" | "approve_destructive" | "approve_manuscript_edits" | "approve_every_edit";

export interface AgentTask {
  readonly id: string;
  readonly goal: string;
  readonly status: TaskStatus;
  /** Entities/files this task is permitted to touch. */
  readonly scope: readonly AnyId[];
  readonly acceptanceCriteria: readonly string[];
  readonly approvalPolicy: ApprovalPolicy;
  readonly dependsOn: readonly string[];
}
