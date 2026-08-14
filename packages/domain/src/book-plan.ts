import type { ActArcGoal, ActRelationshipGoal, ActThreadGoal } from "./act-plan";
import type { PlanStatus } from "./planning";

/**
 * The book plan: the top of the planning hierarchy (Phase 34).
 *
 * ```
 * Book intent → Act intent → Chapter intent → Scene intent → Prose
 * ```
 *
 * A book plan does not contain the acts' contents — it *names* the acts, in
 * order, exactly as an act plan names its chapters. Each level of the
 * hierarchy owns its own intent and is planned, validated and versioned at
 * its own level; nothing here flattens the book into one giant outline (§5).
 *
 * The same properties as every other plan: a proposal until the writer
 * approves it, progressively structured (a premise and an ordered act list
 * make a complete book plan), versioned in place with bounded snapshots,
 * journaled like any project file.
 */

/** One act's membership in the book, in telling order. */
export interface BookAct {
  /** The act plan's key (`ACT_XXXX`) — the act *is* its plan. */
  readonly actId: string;
  /** The act's dramatic job in the whole, in the writer's words. */
  readonly intent?: string;
  readonly note?: string;
}

/** A bounded snapshot of an earlier book-plan version. */
export interface BookPlanRevision {
  readonly version: number;
  readonly savedAt: string;
  readonly note?: string;
  readonly premise?: string;
  readonly acts: readonly BookAct[];
}

/**
 * Book-level goals reuse the act-goal vocabulary: the author's words first,
 * with optional deterministic hooks — a thread's target status by the ending,
 * a fact a character must hold, a relationship dimension's direction across
 * the whole book. Evaluation spans every chapter of every act.
 */
export interface BookPlan {
  readonly id: string;
  readonly projectId: string;
  readonly version: number;
  readonly status: PlanStatus;
  readonly approvedVersion?: number;
  /** The book in a breath, in the author's words. */
  readonly premise?: string;
  /** What the whole book must accomplish. */
  readonly storyGoal?: string;
  readonly genre?: string;
  /** Guidance, never a quota: prose is not padded to hit it (§23). */
  readonly targetWords?: number;
  readonly openingState?: string;
  readonly targetEndingState?: string;
  /** The acts, in telling order. This list defines the book's shape. */
  readonly acts: readonly BookAct[];
  readonly majorPlotThreads: readonly ActThreadGoal[];
  readonly characterArcGoals: readonly ActArcGoal[];
  readonly relationshipArcGoals: readonly ActRelationshipGoal[];
  /** Mystery ids this book turns on, when the mystery module is in play. */
  readonly mysteryIds: readonly string[];
  readonly themes: readonly string[];
  /** Promises made to the reader, in the author's words. */
  readonly promises: readonly string[];
  readonly constraints: readonly string[];
  readonly notes: readonly string[];
  /** Story tests the writer tied to the whole book (§9). */
  readonly storyTestIds: readonly string[];
  readonly source: "author" | "model" | "mixed";
  readonly modelId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revisions: readonly BookPlanRevision[];
}

/** An empty book plan for manual planning. Everything beyond identity is optional. */
export function emptyBookPlan(
  projectId: string,
): Omit<BookPlan, "version" | "revisions" | "createdAt" | "updatedAt"> {
  return {
    id: "BOOKPLAN",
    projectId,
    status: "draft",
    acts: [],
    majorPlotThreads: [],
    characterArcGoals: [],
    relationshipArcGoals: [],
    mysteryIds: [],
    themes: [],
    promises: [],
    constraints: [],
    notes: [],
    storyTestIds: [],
    source: "author",
  };
}

export interface BookPlanFinding {
  readonly severity: "error" | "warning" | "info";
  readonly code:
    | "empty_book"
    | "unknown_act"
    | "duplicate_act"
    | "act_not_approved"
    | "act_without_chapters"
    | "chapter_in_two_acts"
    | "unknown_reference";
  readonly message: string;
  readonly actId?: string;
}
