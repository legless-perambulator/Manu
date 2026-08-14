import type { RoutingClass, RunCost } from "./orchestration";

/**
 * A chapter build: Manu's first long-form production pipeline.
 *
 * «Build Chapter 17 from the approved plan» is not one model completion. It is
 * a sequence of small operations — compile context, draft one scene, extract
 * what it changed, validate, commit, checkpoint, move on — and **the harness
 * controls the progression**, not the model (AGENTS.md — "Deterministic
 * Orchestration"; docs/CHAPTER_BUILDER.md).
 *
 * This record is the whole of the build's memory. It is persisted after every
 * step, which is what makes a build something that can be paused, survive Manu
 * being closed, and resume at Scene 3 rather than starting again at Scene 1.
 */

export const CHAPTER_BUILD_STATUSES = [
  /** Created, nothing run yet. */
  "pending",
  /** Reading the chapter, checking prerequisites, fixing the scene sequence. */
  "planning",
  /** Stopped at a gate. `pending` says what the writer is being asked. */
  "awaiting_approval",
  /** A scene is being drafted or continued. */
  "drafting",
  /** Deterministic checks are running over what was just committed. */
  "validating",
  /** A drafted scene is being revised against its plan. */
  "revising",
  /** Every scene committed, chapter-level checks recorded. */
  "completed",
  /** Stopped by an error. `failureReason` says which step and why. */
  "failed",
  /** Stopped by the writer. Committed work is kept; staged work is gone. */
  "cancelled",
  /** Stopped deliberately — by the writer, or by a validation finding. */
  "paused",
] as const;
export type ChapterBuildStatus = (typeof CHAPTER_BUILD_STATUSES)[number];

/** Statuses a build can be resumed from. Everything else is over or running. */
export const RESUMABLE_STATUSES: readonly ChapterBuildStatus[] = ["paused", "failed"];

/**
 * How much of the build the writer wants to see before it lands.
 *
 * The policy is itself the human decision: choosing `auto_until_error` when
 * starting the build is standing approval for its commits, every one of which
 * is checkpointed, attributed and revertible. It widens nothing an approval
 * gate protects — it is the writer exercising the gate in advance, once,
 * explicitly (docs/AI_EDITING.md; §6, §10 of the phase spec).
 */
export const APPROVAL_POLICIES = [
  /** Pause after drafting each scene; nothing commits until the writer says. */
  "every_scene",
  /** Run the whole chapter, then pause once for the writer's verdict. */
  "every_chapter",
  /** Commit as it goes; stop only for errors and unmet plans. */
  "auto_until_error",
] as const;
export type ApprovalPolicy = (typeof APPROVAL_POLICIES)[number];

export const SCENE_BUILD_STATUSES = [
  "pending",
  "drafting",
  /** Drafted and held in the build record, waiting for the writer. */
  "awaiting_approval",
  "extracting",
  "validating",
  "revising",
  /** Prose committed to the chapter file as an ordinary change set. */
  "committed",
  "failed",
] as const;
export type SceneBuildStatus = (typeof SCENE_BUILD_STATUSES)[number];

/**
 * One planned beat, and whether the drafted scene met it.
 *
 * This is a model's reading of prose against a plan — semantic judgement, and
 * labelled as such (`source: "model"`). It is never converted into canon and
 * never treated as a deterministic check result (docs/STORY_COMPILER.md —
 * "measurement is not judgement").
 */
export interface PlanCoverageItem {
  readonly beat: string;
  readonly met: boolean;
  readonly note: string;
  readonly source: "model";
}

/** A length target for one scene, when the plan supplies one. */
export interface SceneLengthTarget {
  readonly minWords?: number;
  readonly maxWords?: number;
}

/** The per-scene ledger. One entry per planned scene, in build order. */
export interface SceneBuildRecord {
  readonly sceneId: string;
  readonly title: string;
  readonly status: SceneBuildStatus;
  /** The plan the scene is drafted against: its recorded purpose lines. */
  readonly beats: readonly string[];
  readonly target?: SceneLengthTarget;
  /** Drafting attempts, including revisions. */
  readonly attempts: number;
  /** Model calls used to reach the committed text (draft + continuations + revisions). */
  readonly calls: number;
  /**
   * Prose drafted but not yet committed, held here so an `every_scene` build
   * survives a restart with its pending draft intact. Cleared on commit or
   * discard — committed prose lives in the chapter file, never here.
   */
  readonly draft?: string;
  readonly words?: number;
  readonly changeSetId?: string;
  readonly checkpointId?: string;
  readonly coverage?: readonly PlanCoverageItem[];
  /** State transitions proposed from this scene, and how many were auto-confirmed. */
  readonly transitionsProposed?: number;
  readonly transitionsConfirmed?: number;
  readonly reason?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

/** Something the pipeline found and wants the writer to know. */
export interface BuildDiagnostic {
  readonly severity: "error" | "warning" | "info";
  readonly step: string;
  readonly sceneId?: string;
  readonly message: string;
  readonly at: string;
}

/** What a paused-for-approval build is asking. */
export interface BuildPending {
  readonly question: string;
  readonly sceneId?: string;
  readonly raisedAt: string;
}

/** The steps of the pipeline, as persisted progress. */
export const CHAPTER_BUILD_STEPS = [
  "validate_prerequisites",
  "plan_scenes",
  "approve_plan",
  "draft_scene",
  "approve_scene",
  "extract_state",
  "validate_scene",
  "check_coverage",
  "revise_scene",
  "commit_scene",
  "checkpoint",
  "assemble_chapter",
  "final_build",
  "done",
] as const;
export type ChapterBuildStep = (typeof CHAPTER_BUILD_STEPS)[number];

export interface ChapterBuild {
  readonly id: string;
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly branchId: string;
  readonly status: ChapterBuildStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly requestedBy: "human";
  /** The agent task the build's activity is logged under. */
  readonly taskId: string;
  /**
   * The approved chapter plan this build consumes, pinned at start (Phase 32
   * §15, §17). The build works from the scene records that plan materialised
   * and the constraints below; a plan edited after the pin does not move a
   * running build.
   */
  readonly planId?: string;
  readonly planVersion?: number;
  /**
   * Constraints carried from the plan into every drafting instruction —
   * forbidden knowledge above all, resolved to sentences at pin time.
   */
  readonly planConstraints?: readonly string[];
  readonly approvalPolicy: ApprovalPolicy;
  /**
   * Auto-confirm objective, high-confidence state transitions (locations,
   * holders, statuses) as scenes commit. Interpretive transitions — knowledge,
   * relationships — always stay `proposed` (AGENTS.md — "Canon vs Inference").
   */
  readonly autoConfirmObjective: boolean;
  /** Which configured model each class of work resolved to, when it ran. */
  readonly modelAssignments: Readonly<Partial<Record<RoutingClass, string>>>;
  /**
   * Bounds the pipeline honours, kept on the record so a build resumed after a
   * restart behaves identically to an uninterrupted one (§11).
   */
  readonly maxRevisions: number;
  readonly maxContinuations: number;
  /**
   * What an unresolved `[RESEARCH: …]` placeholder in the chapter does to the
   * build (Phase 35 §20): `pause` stops before drafting so the research can
   * happen first; `proceed` (the default) builds with the placeholders in
   * place and says so. Nothing is ever researched automatically.
   */
  readonly researchGapPolicy?: "pause" | "proceed";
  /** Length targets per scene, where the plan supplied one. */
  readonly targets: Readonly<Record<string, SceneLengthTarget>>;
  /** Checkpoint taken before anything was written. The whole build reverts here. */
  readonly checkpointId?: string;
  readonly currentStep: ChapterBuildStep;
  readonly currentSceneId?: string;
  readonly scenes: readonly SceneBuildRecord[];
  readonly diagnostics: readonly BuildDiagnostic[];
  readonly usage: RunCost;
  readonly pending?: BuildPending;
  /** The final Story Build run over the finished chapter, when one ran. */
  readonly finalBuildId?: string;
  readonly finalBuildErrors?: number;
  readonly finalTestFailures?: number;
  readonly failureReason?: string;
  readonly resumeCount: number;
}

export interface ChapterBuildSummary {
  readonly id: string;
  readonly chapterId: string;
  readonly chapterTitle: string;
  readonly status: ChapterBuildStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly scenesCommitted: number;
  readonly scenesTotal: number;
  readonly currentSceneId?: string;
}

export function summariseChapterBuild(build: ChapterBuild): ChapterBuildSummary {
  return {
    id: build.id,
    chapterId: build.chapterId,
    chapterTitle: build.chapterTitle,
    status: build.status,
    createdAt: build.createdAt,
    updatedAt: build.updatedAt,
    scenesCommitted: build.scenes.filter((scene) => scene.status === "committed").length,
    scenesTotal: build.scenes.length,
    ...(build.currentSceneId !== undefined ? { currentSceneId: build.currentSceneId } : {}),
  };
}

export function isBuildResumable(status: ChapterBuildStatus): boolean {
  return RESUMABLE_STATUSES.includes(status);
}

/** Terminal statuses: the build will never run again. */
export function isBuildFinished(status: ChapterBuildStatus): boolean {
  return status === "completed" || status === "cancelled";
}
