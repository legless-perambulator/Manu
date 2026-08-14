import type { ActGoalReport } from "./act-plan";
import type { RoutingClass, RunCost } from "./orchestration";

/**
 * A book build: Manu's novel-scale production pipeline (Phase 34).
 *
 * The defining difference stays what it has been since Phase 31 (§32):
 *
 * ```
 * Traditional AI:  prompt → novel-sized completion attempt
 * Manu:            plan → context → scene → validate → state → checkpoint → continue
 * ```
 *
 * A book build never asks a model for a book, an act, or even a chapter in
 * one call. It coordinates act builds, which coordinate chapter builds, which
 * draft one scene at a time from freshly compiled context — hundreds of small
 * operations, every transition decided by the harness, every step persisted
 * so hours-long work survives restarts, provider failures and rate limits
 * (§12, §14). **The harness creates scale.**
 */

export const BOOK_BUILD_STATUSES = [
  "pending",
  "planning",
  "building",
  "awaiting_approval",
  "validating",
  "paused",
  "failed",
  "completed",
  "cancelled",
] as const;
export type BookBuildStatus = (typeof BOOK_BUILD_STATUSES)[number];

export const BOOK_RESUMABLE_STATUSES: readonly BookBuildStatus[] = ["paused", "failed"];

/**
 * How much of the book the writer wants to see before it proceeds (§10).
 *
 * Every gate anywhere in the hierarchy is answered at the book level: chapter
 * builders raise scene gates, act builders raise chapter gates, and the book
 * builder surfaces whichever one is open — one conversation with the writer,
 * not three.
 *
 * `autonomous` (§11) is not "ignore the writer". It is `auto_until_error`
 * plus arriving with proposals: stale plans are re-proposed rather than
 * merely reported, and missing chapter plans are drafted for review. It still
 * stops for every plan approval (always the writer's), every error, every
 * failed gate — with audit, checkpoints and cancellation intact.
 */
export const BOOK_APPROVAL_POLICIES = [
  /** Every drafted scene is held for the writer before it lands. */
  "every_scene",
  /** Pause after each chapter is built. */
  "every_chapter",
  /** Pause after each act is built, and once at the end. */
  "every_act",
  /** Run the whole book; stop only for errors, failures and stale plans. */
  "auto_until_error",
  /** As auto, arriving with proposals where plans are missing or stale. */
  "autonomous",
] as const;
export type BookApprovalPolicy = (typeof BOOK_APPROVAL_POLICIES)[number];

/**
 * The build's kind (§26). Only `first_draft` exists today; the field is on
 * the record so a future rewrite or editing pass is a variant of the same
 * architecture, not a new one — a book build never assumes a blank page
 * (existing prose is always kept, and only empty scenes are drafted).
 */
export const BOOK_BUILD_VARIANTS = ["first_draft", "rewrite", "editing_pass"] as const;
export type BookBuildVariant = (typeof BOOK_BUILD_VARIANTS)[number];

/**
 * Configurable quality gates (§18). A failed gate pauses the build; warnings
 * never do. Bounded repair (§19) lives below: `maxSceneRepairs` becomes each
 * chapter build's revision bound, after which the build pauses and surfaces
 * the issue rather than looping.
 */
export interface BookQualityGates {
  /** Pause when an act finishes with Story Compiler errors. Default on. */
  readonly requireCleanCompile: boolean;
  /** Pause when an error-severity story test fails after an act. Default on. */
  readonly requireHardTestsPass: boolean;
  /** Automatic scene repair attempts before pausing (§19). Default 2. */
  readonly maxSceneRepairs: number;
}

export const DEFAULT_QUALITY_GATES: BookQualityGates = {
  requireCleanCompile: true,
  requireHardTestsPass: true,
  maxSceneRepairs: 2,
};

export const BOOK_ACT_STATUSES = ["pending", "building", "completed", "failed"] as const;
export type BookActStatus = (typeof BOOK_ACT_STATUSES)[number];

/** The per-act ledger. One entry per book act, in telling order. */
export interface BookActRecord {
  readonly actId: string;
  readonly title: string;
  readonly intent?: string;
  readonly status: BookActStatus;
  /** The child act build, once one has started. */
  readonly actBuildId?: string;
  readonly planId?: string;
  readonly planVersion?: number;
  /** Set when this future act's plan stopped holding against actual state. */
  readonly planStale?: boolean;
  readonly checkpointId?: string;
  readonly words?: number;
  readonly chaptersCompleted?: number;
  readonly chaptersTotal?: number;
  readonly reason?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

export interface BookDiagnostic {
  readonly severity: "error" | "warning" | "semantic_concern" | "info";
  readonly step: string;
  readonly actId?: string;
  readonly chapterId?: string;
  readonly message: string;
  readonly at: string;
}

/**
 * What a paused-for-approval book build is asking.
 *
 * `act_gate` is a **forwarded** gate: the question was raised by a child act
 * or chapter build (a held scene, a chapter review, a chapter plan), surfaced
 * verbatim; the answer travels back down the same chain.
 */
export interface BookPending {
  readonly question: string;
  /**
   * - `act_plan`: approve the act's plan so the act can build.
   * - `act_gate`: a child build's gate, forwarded up.
   * - `act_review`: keep the built act and continue (every_act).
   * - `final`: accept the finished draft build.
   */
  readonly kind: "act_plan" | "act_gate" | "act_review" | "final";
  readonly actId?: string;
  readonly chapterId?: string;
  readonly raisedAt: string;
}

export const BOOK_BUILD_STEPS = [
  "validate_prerequisites",
  "inspect_opening",
  "confirm_act_plan",
  "build_act",
  "evaluate_progress",
  "adapt_future_plans",
  "approve_act",
  "act_checkpoint",
  "assemble_book",
  "final_build",
  "book_tests",
  "coverage",
  "present",
  "done",
] as const;
export type BookBuildStep = (typeof BOOK_BUILD_STEPS)[number];

/**
 * The completion report (§24–25). It describes a **draft build** — the
 * pipeline finishing is a technical fact about prose existing, never a claim
 * that the book is ready. Polished and final states belong to future editing
 * workflows, which is why the label is on the record.
 */
export interface BookBuildReport {
  readonly label: "Draft build complete";
  readonly words: number;
  readonly actsCompleted: number;
  readonly actsTotal: number;
  readonly chaptersCompleted: number;
  readonly chaptersTotal: number;
  readonly scenes: number;
  readonly compilerErrors: number;
  readonly compilerWarnings: number;
  readonly testsPassed: number;
  readonly testsTotal: number;
  /** Failing tests, as sentences, so the report navigates to every issue. */
  readonly failingTests: readonly { testId: string; statement: string }[];
  readonly unresolvedThreads: readonly { threadId: string; name: string }[];
  readonly semanticConcerns: number;
  readonly generatedAt: string;
}

export interface BookBuild {
  readonly id: string;
  readonly projectId: string;
  readonly branchId: string;
  /** The approved book plan this build works toward, pinned at start. */
  readonly planId: string;
  readonly planVersion: number;
  readonly variant: BookBuildVariant;
  readonly status: BookBuildStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly requestedBy: "human";
  readonly taskId: string;
  readonly approvalPolicy: BookApprovalPolicy;
  readonly autoConfirmObjective: boolean;
  readonly gates: BookQualityGates;
  /** Unresolved [RESEARCH: …] policy passed down to every chapter build (Phase 35 §20). */
  readonly researchGapPolicy?: "pause" | "proceed";
  /**
   * The models each class of work resolves to. Refreshed on resume so a model
   * changed mid-build is used for future operations only — earlier chapters
   * keep their provenance and are never regenerated for it (§15).
   */
  readonly modelAssignments: Readonly<Partial<Record<RoutingClass, string>>>;
  /** Checkpoint taken before anything was written. */
  readonly checkpointId?: string;
  readonly currentStep: BookBuildStep;
  readonly currentActId?: string;
  /** Where the running act stands, mirrored for the dashboard (§20, §13). */
  readonly currentChapterId?: string;
  readonly currentSceneId?: string;
  readonly acts: readonly BookActRecord[];
  readonly openingNotes: readonly string[];
  readonly diagnostics: readonly BookDiagnostic[];
  /** Accumulated across every act's chapter builds (§27). */
  readonly usage: RunCost;
  readonly pending?: BookPending;
  /** The latest book-goal evaluation (§8). Refreshed after every act. */
  readonly goalReport?: ActGoalReport;
  readonly finalBuildId?: string;
  readonly report?: BookBuildReport;
  readonly failureReason?: string;
  readonly resumeCount: number;
}

export interface BookBuildSummary {
  readonly id: string;
  readonly status: BookBuildStatus;
  readonly variant: BookBuildVariant;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly actsCompleted: number;
  readonly actsTotal: number;
  readonly words?: number;
  readonly currentActId?: string;
}

export function summariseBookBuild(build: BookBuild): BookBuildSummary {
  const words = build.acts.reduce((sum, act) => sum + (act.words ?? 0), 0);
  return {
    id: build.id,
    status: build.status,
    variant: build.variant,
    createdAt: build.createdAt,
    updatedAt: build.updatedAt,
    actsCompleted: build.acts.filter((act) => act.status === "completed").length,
    actsTotal: build.acts.length,
    ...(words > 0 ? { words } : {}),
    ...(build.currentActId !== undefined ? { currentActId: build.currentActId } : {}),
  };
}

export function isBookBuildResumable(status: BookBuildStatus): boolean {
  return BOOK_RESUMABLE_STATUSES.includes(status);
}

export function isBookBuildFinished(status: BookBuildStatus): boolean {
  return status === "completed" || status === "cancelled";
}

/**
 * Real progress, where knowable (§22): positions in a known sequence, never a
 * percentage invented for subjective creative work.
 */
export interface BookProgress {
  readonly act?: { at: number; of: number };
  readonly chapter?: { at: number; of: number };
  readonly scene?: { at: number; of: number };
}

export function describeBookProgress(progress: BookProgress): string {
  const parts: string[] = [];
  if (progress.act !== undefined) {
    parts.push(`Act ${String(progress.act.at)} / ${String(progress.act.of)}`);
  }
  if (progress.chapter !== undefined) {
    parts.push(`Chapter ${String(progress.chapter.at)} / ${String(progress.chapter.of)}`);
  }
  if (progress.scene !== undefined) {
    parts.push(`Scene ${String(progress.scene.at)} / ${String(progress.scene.of)}`);
  }
  return parts.join(" · ");
}
