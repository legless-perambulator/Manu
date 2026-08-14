import type { ActGoalReport } from "./act-plan";
import type { ApprovalPolicy } from "./chapter-build";
import type { RoutingClass, RunCost } from "./orchestration";

/**
 * An act build: coordinating multiple chapter builds toward a persistent
 * act-level plan (Phase 33).
 *
 * «Build Act II» is not `for chapter in act: buildChapter(chapter)`. Between
 * every two chapters the harness evaluates the act as a whole — goal progress,
 * plot-thread movement, whether later chapter plans still hold against what
 * was actually written — and adapts or stops before continuing. Every
 * transition is decided by deterministic code; models are only ever invoked
 * inside the child chapter builds and, when configured, to *propose* updated
 * plans a human then reviews (AGENTS.md — "Deterministic Orchestration").
 *
 * Like a chapter build, this record is the build's whole memory, persisted
 * after every step: chapters 6–8 built, Manu closed, reopened, resumed at 9 —
 * never rebuilt from 6 (§12).
 */

export const ACT_BUILD_STATUSES = [
  /** Created, nothing run yet. */
  "pending",
  /** Reading the act plan, checking prerequisites, inspecting opening state. */
  "planning",
  /** A chapter is being built (a child chapter build is running). */
  "building",
  /** Stopped at a gate. `pending` says what the writer is being asked. */
  "awaiting_approval",
  /** Act-level checks are running. */
  "validating",
  /** Stopped deliberately — by the writer, a failed chapter, or a stale plan. */
  "paused",
  /** Stopped by an error. `failureReason` says which step and why. */
  "failed",
  /** Every chapter built, act-level checks recorded. */
  "completed",
  /** Stopped by the writer. Completed chapters are kept — they are history. */
  "cancelled",
] as const;
export type ActBuildStatus = (typeof ACT_BUILD_STATUSES)[number];

export const ACT_RESUMABLE_STATUSES: readonly ActBuildStatus[] = ["paused", "failed"];

/**
 * How much of the act the writer wants to see before it proceeds (§11).
 *
 * Chapter-level gates belong to the act builder; the child chapter builds run
 * hands-off and stop only for errors — one gate keeper, not two arguing.
 */
export const ACT_APPROVAL_POLICIES = [
  /** Pause after each chapter is built, and once more at the end. */
  "every_chapter",
  /** Approve the act plan up front, then pause once for the finished act. */
  "plan_and_final",
  /** Run the whole act; stop only for errors, failures and stale plans. */
  "auto_until_error",
] as const;
export type ActApprovalPolicy = (typeof ACT_APPROVAL_POLICIES)[number];

/**
 * What happens when an earlier chapter's outcome invalidates a later chapter's
 * plan (§6). Either way the build stops — a stale plan is never built from.
 * The difference is whether Manu arrives with a proposal.
 */
export const ACT_AUTONOMY_MODES = [
  /** Stop and name the dependency; the writer takes it from there. */
  "pause",
  /** Draft an updated plan for the affected chapter, then stop for review. */
  "propose",
] as const;
export type ActAutonomyMode = (typeof ACT_AUTONOMY_MODES)[number];

export const ACT_CHAPTER_STATUSES = ["pending", "building", "completed", "failed"] as const;
export type ActChapterStatus = (typeof ACT_CHAPTER_STATUSES)[number];

/** The per-chapter ledger. One entry per act chapter, in act order. */
export interface ActChapterRecord {
  readonly chapterId: string;
  readonly title: string;
  readonly role?: string;
  readonly status: ActChapterStatus;
  /** The child chapter build, once one has started. */
  readonly chapterBuildId?: string;
  /** The chapter plan consumed, when an approved one existed at build time. */
  readonly planId?: string;
  readonly planVersion?: number;
  /**
   * Set when a completed chapter's outcome left this (future) chapter's plan
   * failing validation — the §6 dependency signal. Cleared when the plan is
   * revised and approved again.
   */
  readonly planStale?: boolean;
  readonly checkpointId?: string;
  readonly words?: number;
  readonly reason?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

/**
 * Something the act pipeline found (§10).
 *
 * Three severities the spec names, plus `info`: an `error` is a violated hard
 * constraint or a broken build; a `warning` is an unmet requirement the writer
 * should look at; a `semantic_concern` is a judgement question no deterministic
 * check can settle — labelled as such, and never dressed up as either of the
 * other two.
 */
export interface ActDiagnostic {
  readonly severity: "error" | "warning" | "semantic_concern" | "info";
  readonly step: string;
  readonly chapterId?: string;
  readonly message: string;
  readonly at: string;
}

/** What a paused-for-approval act build is asking, and of what kind. */
export interface ActPending {
  readonly question: string;
  readonly chapterId?: string;
  /**
   * What the answer means:
   * - `chapter_plan`: approve the chapter's draft plan, or build without one.
   * - `stale_plan`: approve the proposed updated plan, or stop and review.
   * - `chapter_review`: keep the built chapter and continue, or stop.
   * - `chapter_gate`: a child chapter build's own gate (a held scene, under
   *   a pass-through scene policy), forwarded verbatim; the answer travels
   *   back down to the chapter build (Phase 34).
   * - `final`: accept the finished act.
   */
  readonly kind: "chapter_plan" | "stale_plan" | "chapter_review" | "chapter_gate" | "final";
  readonly raisedAt: string;
}

/** The steps of the act pipeline, as persisted progress (§5). */
export const ACT_BUILD_STEPS = [
  "validate_prerequisites",
  "inspect_opening",
  "confirm_chapter_plan",
  "build_chapter",
  "evaluate_progress",
  "adapt_future_plans",
  "approve_chapter",
  "chapter_checkpoint",
  "act_validation",
  "final_build",
  "evaluate_goals",
  "done",
] as const;
export type ActBuildStep = (typeof ACT_BUILD_STEPS)[number];

export interface ActBuild {
  readonly id: string;
  readonly actId: string;
  readonly title: string;
  /** The approved act plan this build works toward, pinned at start (§4). */
  readonly planId: string;
  readonly planVersion: number;
  readonly branchId: string;
  readonly status: ActBuildStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly requestedBy: "human";
  readonly taskId: string;
  readonly approvalPolicy: ActApprovalPolicy;
  readonly autonomy: ActAutonomyMode;
  /** Passed through to every child chapter build. */
  readonly autoConfirmObjective: boolean;
  /** Generate a draft plan (for review) for chapters that have none. */
  readonly generateMissingPlans: boolean;
  /**
   * The policy each child chapter build runs under. Defaults to
   * `auto_until_error` (the act is the gatekeeper). A book build may pass
   * `every_scene` through, in which case the children's own gates are
   * **forwarded** as `chapter_gate` pendings rather than treated as stops
   * (Phase 34).
   */
  readonly chapterApprovalPolicy?: ApprovalPolicy;
  /** Scene revision bound passed to every child build (bounded repair). */
  readonly maxSceneRevisions?: number;
  readonly modelAssignments: Readonly<Partial<Record<RoutingClass, string>>>;
  /** Checkpoint taken before anything was written. The whole act reverts here. */
  readonly checkpointId?: string;
  readonly currentStep: ActBuildStep;
  readonly currentChapterId?: string;
  readonly chapters: readonly ActChapterRecord[];
  /** Where things stood entering the act, read deterministically at start. */
  readonly openingNotes: readonly string[];
  readonly diagnostics: readonly ActDiagnostic[];
  /** Accumulated across every child chapter build (§18). */
  readonly usage: RunCost;
  readonly pending?: ActPending;
  /** The latest act-goal evaluation (§8). Refreshed after every chapter. */
  readonly goalReport?: ActGoalReport;
  readonly finalBuildId?: string;
  readonly finalBuildErrors?: number;
  readonly finalTestFailures?: number;
  /** Failures among the story tests relevant to this act (§9). */
  readonly actTestFailures?: number;
  readonly failureReason?: string;
  readonly resumeCount: number;
}

export interface ActBuildSummary {
  readonly id: string;
  readonly actId: string;
  readonly title: string;
  readonly status: ActBuildStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly chaptersCompleted: number;
  readonly chaptersTotal: number;
  readonly goalsSatisfied?: number;
  readonly goalsTotal?: number;
  readonly currentChapterId?: string;
}

export function summariseActBuild(build: ActBuild): ActBuildSummary {
  return {
    id: build.id,
    actId: build.actId,
    title: build.title,
    status: build.status,
    createdAt: build.createdAt,
    updatedAt: build.updatedAt,
    chaptersCompleted: build.chapters.filter((c) => c.status === "completed").length,
    chaptersTotal: build.chapters.length,
    ...(build.goalReport !== undefined
      ? {
          goalsSatisfied: build.goalReport.satisfied,
          goalsTotal: build.goalReport.results.length,
        }
      : {}),
    ...(build.currentChapterId !== undefined ? { currentChapterId: build.currentChapterId } : {}),
  };
}

export function isActBuildResumable(status: ActBuildStatus): boolean {
  return ACT_RESUMABLE_STATUSES.includes(status);
}

/** Terminal statuses: the build will never run again. */
export function isActBuildFinished(status: ActBuildStatus): boolean {
  return status === "completed" || status === "cancelled";
}

/** Sum two usage records — how child chapter-build costs roll up (§18). */
export function addRunCost(a: RunCost, b: RunCost): RunCost {
  const byClass: Record<string, { calls: number; inputTokens: number; outputTokens: number }> = {};
  for (const source of [a.byClass, b.byClass]) {
    for (const [cls, entry] of Object.entries(source)) {
      const held = byClass[cls] ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
      byClass[cls] = {
        calls: held.calls + entry.calls,
        inputTokens: held.inputTokens + entry.inputTokens,
        outputTokens: held.outputTokens + entry.outputTokens,
      };
    }
  }
  return {
    byClass,
    calls: a.calls + b.calls,
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
  };
}
