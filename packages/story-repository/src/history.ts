/**
 * Revision-history types. Every significant project mutation is captured as a
 * {@link ChangeSet} so it is reviewable and reversible (AGENTS.md — "AI Mutation
 * Rules"; docs/VERSIONING.md). This is the safety layer that must exist before
 * unrestricted AI manuscript editing.
 */

export type Actor = "human" | "agent" | "system" | "import";

export type ChangeStatus = "committed" | "reverted" | "failed";

/**
 * A single file's before/after content. `before === null` means the file was
 * created; `after === null` means it was deleted.
 */
export interface FileChange {
  readonly path: string;
  readonly before: string | null;
  readonly after: string | null;
}

export interface EntityChange {
  readonly id: string;
  readonly kind: string;
  readonly change: "created" | "updated" | "deleted";
}

/**
 * Audit trail for a change an AI proposed and a human approved.
 *
 * Recorded on the change set itself, so the answer to "which model changed this,
 * under what instruction, with what context, and who approved it?" lives beside
 * the before/after text rather than in a separate log that can drift
 * (AGENTS.md — "AI Mutation Rules"; docs/VERSIONING.md).
 */
export interface AiProvenance {
  /** The editing operation, e.g. "rewrite_selection". */
  readonly operation: string;
  /** Scene or chapter the operation targeted. */
  readonly targetId: string;
  /** What the user asked for. */
  readonly instruction: string;
  /** Optional shaping directive, e.g. "increase_tension". */
  readonly directive?: string;
  /** Which Context Compiler recipe supplied the model's working context. */
  readonly contextRecipe: string;
  readonly contextTokens: number;
  readonly modelId: string;
  readonly taskId: string;
  readonly approval: "accepted" | "partially_accepted";
  readonly approvedAt: string;
  /** Hunks the reviewer took, out of those offered. */
  readonly acceptedHunks?: number;
  readonly offeredHunks?: number;
}

export interface ChangeSet {
  readonly id: string;
  readonly timestamp: string;
  readonly actor: Actor;
  /** Machine-readable operation, e.g. "add_character", "edit_file", "revert". */
  readonly operation: string;
  readonly taskId?: string;
  readonly modelId?: string;
  readonly filesChanged: readonly FileChange[];
  readonly entitiesChanged: readonly EntityChange[];
  readonly summary: string;
  readonly status: ChangeStatus;
  /** If this change reverts another, the id of the change it reverts. */
  readonly revertsChangeSetId?: string;
  /** Present when an AI proposed this change and a human approved it. */
  readonly ai?: AiProvenance;
}

/** Compact history-log entry (no file content) for fast listing. */
export interface ChangeSetSummary {
  readonly id: string;
  readonly timestamp: string;
  readonly actor: Actor;
  readonly operation: string;
  readonly summary: string;
  readonly status: ChangeStatus;
  readonly fileCount: number;
  readonly entityCount: number;
  readonly revertsChangeSetId?: string;
  /** The AI operation behind this change, when there was one. */
  readonly aiOperation?: string;
}

export interface Checkpoint {
  readonly id: string;
  readonly label: string;
  readonly createdAt: string;
  /** The most recent change set at the time the checkpoint was taken. */
  readonly atChangeSetId?: string;
  readonly fileCount: number;
}

export function summarize(change: ChangeSet): ChangeSetSummary {
  return {
    id: change.id,
    timestamp: change.timestamp,
    actor: change.actor,
    operation: change.operation,
    summary: change.summary,
    status: change.status,
    fileCount: change.filesChanged.length,
    entityCount: change.entitiesChanged.length,
    ...(change.revertsChangeSetId !== undefined
      ? { revertsChangeSetId: change.revertsChangeSetId }
      : {}),
    ...(change.ai !== undefined ? { aiOperation: change.ai.operation } : {}),
  };
}
