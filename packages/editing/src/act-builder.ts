import {
  checkPermission,
  createTask,
  transition,
  type PermissionGrant,
} from "@jellytind/agent-runtime";
import {
  EMPTY_COST,
  addRunCost,
  isActBuildFinished,
  isActBuildResumable,
  isBuildResumable,
  testAppliesToAct,
  type ActBuild,
  type ActBuildStatus,
  type ActBuildStep,
  type ActBuildSummary,
  type ActChapterRecord,
  type ActDiagnostic,
  type ActPlan,
  type RoutingClass,
} from "@jellytind/domain";
import type { LanguageModel } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import { ChapterBuilder } from "./chapter-builder";
import { PlanArchitect } from "./plan-architect";
import { EditError } from "./types";

/**
 * The act builder (Phase 33): coordinating chapter builds toward an act plan.
 *
 * «Build Act II» is deliberately **not** `for chapter in act: buildChapter()`.
 * The loop body is: confirm the chapter's plan still holds → build it through
 * the Phase 31 pipeline → re-evaluate the act's goals from recorded state →
 * re-validate every *future* chapter's plan against what was actually written
 * → checkpoint — and only then move on. The act reasons about itself between
 * chapters, and every one of those decisions is deterministic code (AGENTS.md
 * — "Deterministic Orchestration").
 *
 * Boundaries carried over from the layers below, unchanged:
 *
 * - **One manuscript.** Prose lands through child chapter builds' ordinary
 *   change sets. Context is compiled from current project state at each draft,
 *   so a chapter the writer edited mid-act is what later chapters grow from
 *   (§13) — the act plan is direction, never a snapshot to build from.
 * - **Plan approval is the writer's alone.** The builder consumes approved
 *   chapter plans and *proposes* updated ones when they go stale (§6); it
 *   never approves anything itself. Gates answered by the writer are the only
 *   way a plan becomes an input.
 * - **A failed chapter pauses the act at that chapter** (§17). Nothing is
 *   skipped silently; resuming retries the same chapter from where it stopped.
 */

export interface ActBuildModels {
  /** Prose. Passed to every child chapter build; an act cannot start without it. */
  readonly drafting: LanguageModel;
  /** Extraction and coverage inside child builds. Omitted → skipped, and said so. */
  readonly analysis?: LanguageModel;
  /**
   * Structured plan proposals: missing chapter plans and `propose` autonomy.
   * Omitted → the act builder never generates a plan and `propose` degrades to
   * `pause`, with the reason recorded.
   */
  readonly planning?: LanguageModel;
}

export interface StartActBuildOptions {
  readonly actId: string;
  readonly branchId?: string;
  readonly approvalPolicy?: ActBuild["approvalPolicy"];
  /** What to do when a completed chapter invalidates a later plan (§6). */
  readonly autonomy?: ActBuild["autonomy"];
  readonly autoConfirmObjective?: boolean;
  /** Propose a draft plan (for review) for chapters that have none. */
  readonly generateMissingPlans?: boolean;
  /**
   * The policy each child chapter build runs under. Defaults to
   * `auto_until_error`; a pass-through scene policy makes the children's own
   * gates surface here as forwarded `chapter_gate` pendings (Phase 34).
   */
  readonly chapterApprovalPolicy?: ActBuild["chapterApprovalPolicy"];
  /** Scene revision bound for every child build (bounded repair, §19/34). */
  readonly maxSceneRevisions?: number;
  /** Unresolved [RESEARCH: …] policy for every child build (Phase 35 §20). */
  readonly researchGapPolicy?: ActBuild["researchGapPolicy"];
}

export interface ActBuilderOptions {
  readonly repo: StoryRepository;
  readonly models: ActBuildModels;
  readonly grant: PermissionGrant;
  readonly now?: () => string;
  readonly maxContextTokens?: number;
  /** Told after every persisted act-level step. */
  readonly onProgress?: (build: ActBuild) => void;
  /** Told as the child chapter build progresses, for a following UI. */
  readonly onChapterProgress?: (chapterBuildId: string) => void;
}

type MutableChapter = { -readonly [K in keyof ActChapterRecord]: ActChapterRecord[K] };

/** A mutable working copy of the persisted record, persisted after each step. */
type Working = Omit<
  { -readonly [K in keyof ActBuild]: ActBuild[K] },
  "chapters" | "diagnostics" | "openingNotes"
> & { chapters: MutableChapter[]; diagnostics: ActDiagnostic[]; openingNotes: string[] };

export class ActBuilder {
  private readonly repo: StoryRepository;
  private readonly models: ActBuildModels;
  private readonly grant: PermissionGrant;
  private readonly now: () => string;
  private readonly maxContextTokens: number;
  private readonly onProgress: ((build: ActBuild) => void) | undefined;
  private readonly chapterBuilder: ChapterBuilder;
  private readonly pauseRequested = new Set<string>();
  private readonly cancelRequested = new Set<string>();
  private readonly running = new Set<string>();
  /** The chapter build each running act is currently inside, for pause forwarding. */
  private readonly runningChild = new Map<string, string>();

  constructor(options: ActBuilderOptions) {
    this.repo = options.repo;
    this.models = options.models;
    this.grant = options.grant;
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxContextTokens = options.maxContextTokens ?? 12_000;
    this.onProgress = options.onProgress;
    this.chapterBuilder = new ChapterBuilder({
      repo: this.repo,
      models: {
        drafting: this.models.drafting,
        ...(this.models.analysis !== undefined ? { analysis: this.models.analysis } : {}),
      },
      grant: this.grant,
      now: this.now,
      maxContextTokens: this.maxContextTokens,
      ...(options.onChapterProgress !== undefined
        ? { onProgress: (child) => options.onChapterProgress?.(child.id) }
        : {}),
    });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** Create an act build from an approved act plan and run it. */
  async start(options: StartActBuildOptions): Promise<ActBuild> {
    const decision = checkPermission(
      { name: "build_act", permission: "edit_manuscript" },
      this.grant,
    );
    if (!decision.allowed) {
      throw new EditError("permission_denied", decision.reason, {
        details: { actId: options.actId },
      });
    }

    const plan = await this.repo.actPlans.get(options.actId);
    if (plan === null) {
      throw new EditError("unknown_target", `No act plan exists for "${options.actId}".`);
    }
    if (plan.status !== "approved") {
      throw new EditError(
        "unknown_target",
        `The plan for ${plan.title} is ${plan.status}. An act is built only from a plan the writer has approved.`,
      );
    }
    const findings = await this.repo.validateActPlan(plan);
    const errors = findings.filter((finding) => finding.severity === "error");
    if (errors.length > 0) {
      throw new EditError(
        "unknown_target",
        `The plan for ${plan.title} does not hold against the project: ${errors
          .map((finding) => finding.message)
          .join(" ")}`,
      );
    }

    const chapters = await this.repo.listChapters();
    const titleOf = new Map(chapters.map((c) => [c.id as string, c.title]));
    const policy = options.approvalPolicy ?? "plan_and_final";

    const task = createTask({
      id: await this.repo.agents.nextTaskId(),
      goal: `build_act: ${plan.title}`,
      now: this.now(),
      scope: plan.chapters.map((member) => member.chapterId),
      allowedTools: [],
      approvalPolicy: policy === "auto_until_error" ? "approve_destructive" : "approve_every_edit",
    });
    await this.repo.agents.saveTask(task);
    await this.repo.agents.saveTask(transition(task, "running", { now: this.now() }));

    const build: Working = {
      id: await this.repo.actBuilds.nextId(),
      actId: plan.actId,
      title: plan.title,
      planId: plan.id,
      planVersion: plan.approvedVersion ?? plan.version,
      branchId: options.branchId ?? "main",
      status: "planning",
      createdAt: this.now(),
      updatedAt: this.now(),
      requestedBy: "human",
      taskId: task.id,
      approvalPolicy: policy,
      autonomy: options.autonomy ?? "pause",
      autoConfirmObjective: options.autoConfirmObjective ?? policy === "auto_until_error",
      generateMissingPlans: options.generateMissingPlans ?? false,
      ...(options.chapterApprovalPolicy !== undefined
        ? { chapterApprovalPolicy: options.chapterApprovalPolicy }
        : {}),
      ...(options.maxSceneRevisions !== undefined
        ? { maxSceneRevisions: options.maxSceneRevisions }
        : {}),
      ...(options.researchGapPolicy !== undefined
        ? { researchGapPolicy: options.researchGapPolicy }
        : {}),
      modelAssignments: this.assignments(),
      currentStep: "validate_prerequisites",
      chapters: plan.chapters.map((member): MutableChapter => ({
        chapterId: member.chapterId,
        title: titleOf.get(member.chapterId) ?? member.chapterId,
        ...(member.role !== undefined ? { role: member.role } : {}),
        status: "pending",
      })),
      openingNotes: [],
      diagnostics: [],
      usage: EMPTY_COST,
      resumeCount: 0,
    };
    for (const finding of findings) {
      this.note(
        build,
        finding.severity === "warning" ? "warning" : "info",
        "validate_prerequisites",
        finding.message,
        finding.chapterId,
      );
    }
    await this.persist(build);
    return this.runLoop(build);
  }

  /** Continue a paused or failed act build from exactly where it stopped (§12). */
  async resume(buildId: string): Promise<ActBuild> {
    const build = await this.load(buildId);
    if (!isActBuildResumable(build.status)) {
      throw new EditError("unknown_target", `${buildId} is ${build.status}, not resumable.`, {
        details: { buildId, status: build.status },
      });
    }
    const working = this.working(build);
    working.status = statusForStep(working.currentStep);
    working.resumeCount += 1;
    delete working.failureReason;
    // A chapter that failed pauses the act at that chapter; resuming retries
    // it — never a restart from the act's first chapter (§12, §17).
    for (const chapter of working.chapters) {
      if (chapter.status === "failed") {
        chapter.status = chapter.chapterBuildId === undefined ? "pending" : "building";
        delete chapter.reason;
      }
    }
    await this.persist(working);
    await this.log(working, "resume", `resumed at ${working.currentStep}`);
    return this.runLoop(working);
  }

  /** Answer the pending gate with yes, and carry on. */
  async approve(buildId: string): Promise<ActBuild> {
    const build = await this.load(buildId);
    if (build.status !== "awaiting_approval" || build.pending === undefined) {
      throw new EditError("unknown_target", `${buildId} is not waiting for approval.`, {
        details: { buildId, status: build.status },
      });
    }
    const working = this.working(build);
    const pending = working.pending;
    delete working.pending;
    switch (pending?.kind) {
      case "chapter_plan":
      case "stale_plan": {
        // The writer's yes at this gate *is* the plan approval — the builder
        // holds no approval power of its own.
        if (pending.chapterId !== undefined) {
          await this.repo.approveChapterPlan(pending.chapterId);
          const record = this.chapterRecord(working, pending.chapterId);
          delete record.planStale;
          this.note(
            working,
            "info",
            working.currentStep,
            `the writer approved the plan for ${record.title}`,
            pending.chapterId,
          );
        }
        // Re-enter the confirm step so the approved plan is validated and
        // pinned by the same code path as any other approved plan.
        working.currentStep = "confirm_chapter_plan";
        break;
      }
      case "chapter_review":
        working.currentStep = "chapter_checkpoint";
        break;
      case "chapter_gate": {
        // A forwarded gate: the question was the child chapter build's, and
        // so is the answer. The child runs to its next stop; the build step
        // then reads where it landed.
        if (pending.chapterId !== undefined) {
          const record = this.chapterRecord(working, pending.chapterId);
          if (record.chapterBuildId !== undefined) {
            await this.chapterBuilder.approve(record.chapterBuildId);
          }
        }
        working.currentStep = "build_chapter";
        break;
      }
      case "final":
        working.currentStep = "done";
        working.status = "completed";
        await this.persist(working);
        await this.log(working, "complete", "act accepted by the writer");
        await this.closeTask(working, "completed");
        return working;
      default:
        break;
    }
    working.status = statusForStep(working.currentStep);
    await this.persist(working);
    await this.log(working, "approve", `approved; continuing at ${working.currentStep}`);
    return this.runLoop(working);
  }

  /**
   * Answer the pending gate with no. Declining a draft plan builds the chapter
   * from its scene records instead; declining anything else pauses the act for
   * the writer to take over.
   */
  async rejectPending(buildId: string, reason?: string): Promise<ActBuild> {
    const build = await this.load(buildId);
    if (build.status !== "awaiting_approval" || build.pending === undefined) {
      throw new EditError("unknown_target", `${buildId} is not waiting for approval.`, {
        details: { buildId, status: build.status },
      });
    }
    const working = this.working(build);
    const pending = working.pending;
    delete working.pending;
    this.note(
      working,
      "info",
      working.currentStep,
      `declined: ${reason ?? "no reason given"}`,
      pending?.chapterId,
    );
    if (pending?.kind === "chapter_plan") {
      working.currentStep = "build_chapter";
      working.status = statusForStep(working.currentStep);
      this.note(
        working,
        "info",
        "confirm_chapter_plan",
        "building from the chapter's scene records; the draft plan stays a draft",
        pending.chapterId,
      );
      await this.persist(working);
      await this.log(working, "reject", reason ?? "declined the draft plan");
      return this.runLoop(working);
    }
    if (pending?.kind === "chapter_gate" && pending.chapterId !== undefined) {
      // Forward the "no" to the child, which discards its held draft and
      // pauses; resuming the act resumes the child, which drafts again.
      const record = this.chapterRecord(working, pending.chapterId);
      if (record.chapterBuildId !== undefined) {
        await this.chapterBuilder.rejectPending(record.chapterBuildId, reason);
      }
    }
    working.status = "paused";
    await this.persist(working);
    await this.log(working, "reject", reason ?? "declined at the gate");
    return working;
  }

  /**
   * Ask a running act build to stop after the step it is on. The request is
   * forwarded into the running chapter build, so the pause lands at scene
   * granularity rather than waiting out a whole chapter.
   */
  requestPause(buildId: string): void {
    this.pauseRequested.add(buildId);
    const child = this.runningChild.get(buildId);
    if (child !== undefined) this.chapterBuilder.requestPause(child);
  }

  /**
   * Cancel an act build. Completed chapters are kept — they are ordinary
   * history with checkpoints — and a running child build, if any, is left
   * paused where it stands rather than destroyed.
   */
  async cancel(buildId: string): Promise<ActBuild> {
    if (this.running.has(buildId)) {
      this.cancelRequested.add(buildId);
      return this.load(buildId);
    }
    const build = await this.load(buildId);
    if (isActBuildFinished(build.status)) return build;
    const working = this.working(build);
    working.status = "cancelled";
    delete working.pending;
    this.note(working, "info", working.currentStep, "cancelled by the writer");
    await this.persist(working);
    await this.log(working, "cancel", "cancelled; completed chapters kept");
    await this.closeTask(working, "cancelled");
    return working;
  }

  async get(buildId: string): Promise<ActBuild | null> {
    return this.repo.actBuilds.get(buildId);
  }

  async list(): Promise<ActBuildSummary[]> {
    return this.repo.actBuilds.list();
  }

  /**
   * Replan the remaining act (§14): propose fresh draft chapter plans for
   * every chapter not yet built, without touching completed chapters or any
   * accepted story state. The proposals are drafts for the writer to review —
   * nothing is approved here.
   */
  async replanRemaining(
    buildId: string,
    options: { instruction?: string } = {},
  ): Promise<{ proposedChapterIds: string[] }> {
    const build = await this.load(buildId);
    if (this.running.has(buildId) || isActBuildFinished(build.status)) {
      throw new EditError(
        "unknown_target",
        `${buildId} is ${this.running.has(buildId) ? "running" : build.status}; replan a paused build.`,
      );
    }
    const architect = this.architect();
    if (architect === null) {
      throw new EditError(
        "unknown_target",
        "Replanning proposes structured plans and needs a planning model configured.",
      );
    }
    const working = this.working(build);
    const remaining = working.chapters.filter((chapter) => chapter.status === "pending");
    const proposedChapterIds: string[] = [];
    for (const chapter of remaining) {
      await architect.proposeChapterPlan({
        chapterId: chapter.chapterId,
        instruction: `The act "${working.title}" is being replanned after earlier chapters deviated from plan. Plan this chapter from the manuscript as it now stands.${
          options.instruction === undefined ? "" : `\n\n${options.instruction}`
        }`,
      });
      delete chapter.planStale;
      proposedChapterIds.push(chapter.chapterId);
      this.note(
        working,
        "info",
        "adapt_future_plans",
        `proposed an updated draft plan for ${chapter.title} — review and approve it, then resume`,
        chapter.chapterId,
      );
    }
    await this.persist(working);
    await this.log(
      working,
      "replan",
      `proposed draft plans for ${String(proposedChapterIds.length)} remaining chapter(s)`,
    );
    return { proposedChapterIds };
  }

  // ── The pipeline loop ────────────────────────────────────────────────────

  private async runLoop(build: Working): Promise<ActBuild> {
    this.running.add(build.id);
    try {
      for (;;) {
        if (this.cancelRequested.delete(build.id)) {
          build.status = "cancelled";
          delete build.pending;
          this.note(build, "info", build.currentStep, "cancelled by the writer");
          await this.persist(build);
          await this.closeTask(build, "cancelled");
          return build;
        }
        if (this.pauseRequested.delete(build.id)) {
          build.status = "paused";
          this.note(build, "info", build.currentStep, "paused by the writer");
          await this.persist(build);
          await this.log(build, "pause", `paused before ${build.currentStep}`);
          return build;
        }

        try {
          const outcome = await this.step(build);
          await this.persist(build);
          if (outcome === "stop") return build;
        } catch (cause) {
          const reason = cause instanceof Error ? cause.message : String(cause);
          build.status = "failed";
          build.failureReason = `${build.currentStep}${
            build.currentChapterId === undefined ? "" : ` (${build.currentChapterId})`
          }: ${reason}`;
          this.note(build, "error", build.currentStep, reason, build.currentChapterId);
          await this.persist(build);
          await this.log(build, "fail", build.failureReason);
          return build;
        }
      }
    } finally {
      this.running.delete(build.id);
    }
  }

  private async step(build: Working): Promise<"continue" | "stop"> {
    switch (build.currentStep) {
      case "validate_prerequisites":
        return this.stepPrerequisites(build);
      case "inspect_opening":
        return this.stepOpening(build);
      case "confirm_chapter_plan":
        return this.stepConfirmPlan(build);
      case "build_chapter":
        return this.stepBuildChapter(build);
      case "evaluate_progress":
        return this.stepEvaluate(build);
      case "adapt_future_plans":
        return this.stepAdapt(build);
      case "approve_chapter":
        return this.stepApproveChapter(build);
      case "chapter_checkpoint":
        return this.stepCheckpoint(build);
      case "act_validation":
        return this.stepActValidation(build);
      case "final_build":
        return this.stepFinalBuild(build);
      case "evaluate_goals":
        return this.stepEvaluateGoals(build);
      case "done":
        return "stop";
    }
  }

  /** The act-level checkpoint: the whole act reverts here in one move. */
  private async stepPrerequisites(build: Working): Promise<"continue"> {
    build.status = "planning";
    const checkpoint = await this.repo.createCheckpoint(`Before building ${build.title}`);
    build.checkpointId = checkpoint.id;
    build.currentStep = "inspect_opening";
    return "continue";
  }

  /**
   * §5's "inspect opening state": where things stand entering the act, read
   * deterministically and kept on the record so the writer can compare the
   * finish against the start.
   */
  private async stepOpening(build: Working): Promise<"continue"> {
    const plan = await this.plan(build);
    if (plan.openingState !== undefined) {
      build.openingNotes.push(`The plan says: ${plan.openingState}`);
    }
    const firstScene = await this.firstActScene(build);
    if (firstScene !== null) {
      const [threads, setups] = await Promise.all([
        this.repo.getActiveThreadsAtScene(firstScene),
        this.repo.getOpenSetupsBeforeScene(firstScene),
      ]);
      build.openingNotes.push(
        `${String(threads.length)} thread(s) running: ${threads.map((t) => t.name).join(", ") || "none"}`,
        `${String(setups.length)} setup(s) outstanding`,
      );
    } else {
      build.openingNotes.push(
        "No act scenes exist yet; the opening will form as plans are approved.",
      );
    }
    build.currentStep = "confirm_chapter_plan";
    return "continue";
  }

  /**
   * §5's "generate/confirm chapter plan", one chapter at a time.
   *
   * An approved plan is re-validated *now*, against the project as the
   * previous chapters actually left it — never against the state the plan was
   * written in. A draft plan gates; a missing plan is proposed (when asked)
   * or noted and built without.
   */
  private async stepConfirmPlan(build: Working): Promise<"continue" | "stop"> {
    const record = build.chapters.find((chapter) => chapter.status === "pending");
    if (record === undefined) {
      delete build.currentChapterId;
      build.currentStep = "act_validation";
      return "continue";
    }
    build.status = "planning";
    build.currentChapterId = record.chapterId;

    const plan = await this.repo.plans.get(record.chapterId);
    if (plan !== null && plan.status === "approved") {
      const errors = await this.staleErrors(build, record);
      if (errors.length === 0) {
        record.planId = plan.id;
        record.planVersion = plan.approvedVersion ?? plan.version;
        delete record.planStale;
        build.currentStep = "build_chapter";
        return "continue";
      }
      // §6 at the moment it matters: the plan no longer holds. Never build
      // from a stale plan; stop with the dependency named, or arrive with a
      // proposal — per the configured autonomy.
      record.planStale = true;
      for (const error of errors.slice(0, 5)) {
        this.note(build, "error", "confirm_chapter_plan", error.message, record.chapterId);
      }
      const architect = this.architect();
      if (build.autonomy === "propose" && architect !== null) {
        await this.proposeRevision(
          build,
          record,
          errors.map((e) => e.message),
        );
        return this.gate(
          build,
          `The plan for ${record.title} no longer held, so Manu drafted an updated one. Approve it?`,
          "stale_plan",
          record.chapterId,
        );
      }
      if (build.autonomy === "propose") {
        this.note(
          build,
          "warning",
          "confirm_chapter_plan",
          "an updated plan was not proposed: no planning model is configured",
          record.chapterId,
        );
      }
      build.status = "paused";
      this.note(
        build,
        "warning",
        "confirm_chapter_plan",
        `paused: the approved plan for ${record.title} no longer holds against the manuscript. Revise it (or replan the remaining act), then resume.`,
        record.chapterId,
      );
      await this.log(build, "stale_plan", `paused at ${record.chapterId}`);
      return "stop";
    }

    if (plan !== null && plan.status === "draft") {
      return this.gate(
        build,
        `${record.title} has a draft plan. Approve it, or decline to build from the chapter's scene records?`,
        "chapter_plan",
        record.chapterId,
      );
    }

    const architect = this.architect();
    if (build.generateMissingPlans && architect !== null) {
      await architect.proposeChapterPlan({
        chapterId: record.chapterId,
        instruction: this.actInstruction(build, record, await this.plan(build)),
      });
      this.note(
        build,
        "info",
        "confirm_chapter_plan",
        `proposed a draft plan for ${record.title} from the act's goals`,
        record.chapterId,
      );
      return this.gate(
        build,
        `Manu drafted a plan for ${record.title}. Approve it, or decline to build from the chapter's scene records?`,
        "chapter_plan",
        record.chapterId,
      );
    }
    if (build.generateMissingPlans) {
      this.note(
        build,
        "warning",
        "confirm_chapter_plan",
        "a plan was not generated: no planning model is configured",
        record.chapterId,
      );
    }
    this.note(
      build,
      "info",
      "confirm_chapter_plan",
      `${record.title} has no chapter plan; building from its scene records`,
      record.chapterId,
    );
    build.currentStep = "build_chapter";
    return "continue";
  }

  /**
   * Run (or resume) the child chapter build. By default the child runs
   * hands-off — the act builder is the gatekeeper — and stops of its own
   * accord only for errors, which pause the act at this chapter (§17). Under
   * a pass-through scene policy (Phase 34) the child's own gates are
   * **forwarded** upward instead of treated as stops.
   */
  private async stepBuildChapter(build: Working): Promise<"continue" | "stop"> {
    const record = this.currentChapter(build);
    build.status = "building";
    if (record.status === "pending") {
      record.status = "building";
      record.startedAt = this.now();
    }
    await this.persist(build);

    let child;
    if (record.chapterBuildId !== undefined) {
      this.runningChild.set(build.id, record.chapterBuildId);
      const held = await this.repo.chapterBuilds.get(record.chapterBuildId);
      child =
        held !== null && isBuildResumable(held.status)
          ? await this.chapterBuilder.resume(record.chapterBuildId)
          : held;
    }
    if (child === undefined || child === null) {
      child = await this.chapterBuilder.start({
        chapterId: record.chapterId,
        branchId: build.branchId,
        approvalPolicy: build.chapterApprovalPolicy ?? "auto_until_error",
        autoConfirmObjective: build.autoConfirmObjective,
        ...(build.maxSceneRevisions !== undefined ? { maxRevisions: build.maxSceneRevisions } : {}),
        ...(build.researchGapPolicy !== undefined
          ? { researchGapPolicy: build.researchGapPolicy }
          : {}),
      });
      record.chapterBuildId = child.id;
    }
    this.runningChild.delete(build.id);
    await this.accumulateUsage(build);

    if (child.status === "completed") {
      record.status = "completed";
      record.finishedAt = this.now();
      record.words = child.scenes.reduce((sum, scene) => sum + (scene.words ?? 0), 0);
      if (child.planId !== undefined) {
        record.planId = child.planId;
        record.planVersion = child.planVersion as number;
      }
      await this.log(build, "chapter_done", `${record.chapterId} built by ${child.id}`);
      build.currentStep = "evaluate_progress";
      return "continue";
    }

    // A gate the child raised under a pass-through policy: surface it here,
    // verbatim, and send the answer back down when it arrives.
    if (child.status === "awaiting_approval" && child.pending !== undefined) {
      return this.gate(build, child.pending.question, "chapter_gate", record.chapterId);
    }

    // A pause the writer asked for mid-chapter, honoured by the child at the
    // scene it reached: a clean stop, not a failure.
    if (child.status === "paused" && this.pauseRequested.delete(build.id)) {
      build.status = "paused";
      this.note(
        build,
        "info",
        "build_chapter",
        `paused by the writer; ${record.title} holds at the scene it reached`,
        record.chapterId,
      );
      await this.log(build, "pause", `paused inside ${record.chapterId}`);
      return "stop";
    }

    // §17: the chapter stopped — paused on a validation error, failed on a
    // provider, or cancelled by the writer directly. The act pauses here with
    // the child's own diagnosis on the record; nothing is skipped.
    record.status = "failed";
    record.reason =
      child.failureReason ??
      child.diagnostics.filter((d) => d.severity === "error" || d.severity === "warning").at(-1)
        ?.message ??
      `chapter build ${child.id} stopped (${child.status})`;
    build.status = "paused";
    this.note(
      build,
      "error",
      "build_chapter",
      `paused: building ${record.title} stopped — ${record.reason}. Resume retries it from where it stopped.`,
      record.chapterId,
    );
    await this.log(build, "chapter_stopped", `${record.chapterId}: ${record.reason}`);
    return "stop";
  }

  /**
   * §8: where does the act stand now? Answered from recorded state — threads,
   * knowledge, relationships, setups — with no model involved. The report is
   * kept on the build, and the deterministic slice of §7's drift (a goal
   * reached with chapters to spare) is noted in plain words.
   */
  private async stepEvaluate(build: Working): Promise<"continue"> {
    build.status = "validating";
    const plan = await this.plan(build);
    build.goalReport = await this.repo.evaluateActGoals(plan);
    const remaining = build.chapters.filter((chapter) => chapter.status === "pending").length;
    const deterministic = build.goalReport.results.filter((r) => r.method === "deterministic");
    if (
      remaining > 0 &&
      deterministic.length > 0 &&
      deterministic.every((r) => r.status === "satisfied")
    ) {
      this.note(
        build,
        "info",
        "evaluate_progress",
        `every act goal the record can decide is already satisfied, with ${String(remaining)} chapter(s) still to build — ahead of plan`,
      );
    }
    await this.log(
      build,
      "progress",
      `${String(build.goalReport.satisfied)}/${String(build.goalReport.results.length)} act goal(s) satisfied`,
    );
    build.currentStep = "adapt_future_plans";
    return "continue";
  }

  /**
   * §6: does what was actually written invalidate any *future* chapter's
   * approved plan? Detection is deterministic — each plan is re-validated
   * against current state at its own entry boundary. A stale plan stops the
   * act (pause) or is re-proposed as a draft for review (propose); it is never
   * silently built from, and completed chapters are never touched.
   */
  private async stepAdapt(build: Working): Promise<"continue" | "stop"> {
    const future = build.chapters.filter((chapter) => chapter.status === "pending");
    const newlyStale: MutableChapter[] = [];
    for (const chapter of future) {
      const plan = await this.repo.plans.get(chapter.chapterId);
      if (plan === null || plan.status !== "approved") continue;
      const errors = await this.staleErrors(build, chapter);
      if (errors.length === 0) {
        delete chapter.planStale;
        continue;
      }
      if (chapter.planStale !== true) {
        chapter.planStale = true;
        newlyStale.push(chapter);
        this.note(
          build,
          "warning",
          "adapt_future_plans",
          `the plan for ${chapter.title} no longer holds: ${errors[0]?.message ?? ""}`,
          chapter.chapterId,
        );
      }
    }
    if (newlyStale.length > 0) {
      const architect = this.architect();
      if (build.autonomy === "propose" && architect !== null) {
        for (const chapter of newlyStale) {
          const errors = await this.staleErrors(build, chapter);
          await this.proposeRevision(
            build,
            chapter,
            errors.map((finding) => finding.message),
          );
        }
        build.status = "paused";
        this.note(
          build,
          "warning",
          "adapt_future_plans",
          `paused: ${String(newlyStale.length)} future chapter plan(s) went stale; updated drafts are ready for review. Approve them, then resume.`,
        );
      } else {
        if (build.autonomy === "propose") {
          this.note(
            build,
            "warning",
            "adapt_future_plans",
            "updated plans were not proposed: no planning model is configured",
          );
        }
        build.status = "paused";
        this.note(
          build,
          "warning",
          "adapt_future_plans",
          `paused: ${String(newlyStale.length)} future chapter plan(s) no longer hold against what was written. Revise them (or replan the remaining act), then resume.`,
        );
      }
      await this.log(build, "stale_plans", newlyStale.map((c) => c.chapterId).join(", "));
      return "stop";
    }
    build.currentStep = "approve_chapter";
    return "continue";
  }

  /** The act-level chapter gate, under the `every_chapter` policy (§11). */
  private async stepApproveChapter(build: Working): Promise<"continue" | "stop"> {
    const record = this.currentChapter(build);
    if (build.approvalPolicy === "every_chapter") {
      return this.gate(
        build,
        `Keep the built ${record.title} and continue the act?`,
        "chapter_review",
        record.chapterId,
      );
    }
    build.currentStep = "chapter_checkpoint";
    return "continue";
  }

  private async stepCheckpoint(build: Working): Promise<"continue"> {
    const record = this.currentChapter(build);
    const checkpoint = await this.repo.createCheckpoint(`After ${record.title} (${build.id})`);
    record.checkpointId = checkpoint.id;
    delete build.currentChapterId;
    build.currentStep = "confirm_chapter_plan";
    return "continue";
  }

  /**
   * §10: act-level validation, with the three severities kept honestly apart —
   * violated hard constraints are errors, unmet requirements are warnings, and
   * questions only a reader can settle are semantic concerns, labelled so.
   */
  private async stepActValidation(build: Working): Promise<"continue"> {
    build.status = "validating";
    const plan = await this.plan(build);
    build.goalReport = await this.repo.evaluateActGoals(plan);
    for (const result of build.goalReport.results) {
      if (result.status === "unsatisfied") {
        this.note(
          build,
          result.kind === "forbidden_fact" ? "error" : "warning",
          "act_validation",
          `${result.statement} — ${result.evidence}`,
        );
      } else if (result.status === "not_evaluated" && result.method === "semantic") {
        this.note(
          build,
          "semantic_concern",
          "act_validation",
          `"${result.statement}" is the author's intent; the record shows ${result.evidence}. Only a reading can settle it.`,
        );
      }
    }
    // Plan coverage across the act: the children's model-labelled judgement,
    // rolled up as a concern, never as a failure.
    let unmet = 0;
    for (const chapter of build.chapters) {
      if (chapter.chapterBuildId === undefined) continue;
      const child = await this.repo.chapterBuilds.get(chapter.chapterBuildId);
      if (child === null) continue;
      for (const scene of child.scenes) {
        unmet += (scene.coverage ?? []).filter((item) => !item.met).length;
      }
    }
    if (unmet > 0) {
      this.note(
        build,
        "semantic_concern",
        "act_validation",
        `${String(unmet)} planned beat(s) across the act were judged unmet by the coverage model — the writer's call whether the deviations stand`,
      );
    }
    build.currentStep = "final_build";
    return "continue";
  }

  /** §5's tail: the Story Compiler and the story tests — the act-relevant slice reported (§9). */
  private async stepFinalBuild(build: Working): Promise<"continue"> {
    const plan = await this.plan(build);
    const result = await this.repo.buildStory();
    const tests = await this.repo.runStoryTests();
    build.finalBuildId = result.id;
    build.finalBuildErrors = result.diagnostics.filter((d) => d.severity === "error").length;
    build.finalTestFailures = tests.deterministic.failed + tests.errored;

    const scenes = await this.repo.listScenes();
    const chapterIds = new Set(plan.chapters.map((member) => member.chapterId));
    const sceneIds = new Set(
      scenes
        .filter(
          (scene) => scene.chapterId !== undefined && chapterIds.has(scene.chapterId as string),
        )
        .map((scene) => scene.id as string),
    );
    const storyTests = await this.repo.listStoryTests();
    const actTestIds = new Set(
      storyTests
        .filter((test) =>
          testAppliesToAct(
            { id: test.id as string, scope: test.scope },
            { chapterIds, sceneIds, storyTestIds: plan.storyTestIds },
          ),
        )
        .map((test) => test.id as string),
    );
    const actFailures = tests.results.filter(
      (item) => actTestIds.has(item.testId) && item.status === "failed",
    );
    build.actTestFailures = actFailures.length;
    for (const failure of actFailures.slice(0, 8)) {
      this.note(build, "error", "final_build", `act story test failed: ${failure.statement}`);
    }
    if (build.finalBuildErrors > 0) {
      this.note(
        build,
        "warning",
        "final_build",
        `the Story Build finished with ${String(build.finalBuildErrors)} error(s) — see Story Build`,
      );
    }
    build.currentStep = "evaluate_goals";
    return "continue";
  }

  /** The finish: a final checkpoint, and — unless hands-off — the writer's verdict. */
  private async stepEvaluateGoals(build: Working): Promise<"continue" | "stop"> {
    const checkpoint = await this.repo.createCheckpoint(`Built ${build.title} (${build.id})`);
    this.note(build, "info", "evaluate_goals", `finished; checkpoint ${checkpoint.id}`);
    if (build.approvalPolicy !== "auto_until_error") {
      const report = build.goalReport;
      const summary =
        report === undefined
          ? ""
          : ` ${String(report.satisfied)}/${String(report.results.length)} act goals satisfied.`;
      return this.gate(build, `Accept the built ${build.title}?${summary}`, "final", undefined);
    }
    build.currentStep = "done";
    build.status = "completed";
    await this.log(build, "complete", "act built");
    await this.closeTask(build, "completed");
    return "stop";
  }

  // ── Support ──────────────────────────────────────────────────────────────

  private async gate(
    build: Working,
    question: string,
    kind: NonNullable<ActBuild["pending"]>["kind"],
    chapterId: string | undefined,
  ): Promise<"stop"> {
    build.status = "awaiting_approval";
    build.pending = {
      question,
      kind,
      ...(chapterId !== undefined ? { chapterId } : {}),
      raisedAt: this.now(),
    };
    await this.log(build, "gate", question);
    return "stop";
  }

  /**
   * The errors that make a chapter's approved plan genuinely stale (§6).
   *
   * Validation runs against the project as it stands *now* — but a plan whose
   * prerequisite is scheduled to arrive in an earlier, still-unbuilt act
   * chapter is not stale, it is waiting. So an error is suppressed when an
   * earlier **pending** chapter's approved plan still promises to deliver it:
   * a knowledge change granting the missing information to its source, or a
   * scene planting the missing setup. Once that chapter is built (and did or
   * did not deliver), the promise expires and the check bites — which is
   * exactly how "Chapter 8 failed to teach Mara FACT_X, and Chapter 10 needs
   * it" is caught the moment Chapter 8 completes, not when Chapter 10 starts.
   */
  private async staleErrors(
    build: Working,
    target: MutableChapter,
  ): Promise<readonly { code: string; message: string }[]> {
    const plan = await this.repo.plans.get(target.chapterId);
    if (plan === null || plan.status !== "approved") return [];
    const errors = (await this.repo.validateChapterPlan(plan)).filter(
      (finding) => finding.severity === "error",
    );
    if (errors.length === 0) return [];

    const promisedFacts = new Set<string>();
    const promisedSetups = new Set<string>();
    for (const chapter of build.chapters) {
      if (chapter.chapterId === target.chapterId) break;
      if (chapter.status !== "pending") continue;
      const earlier = await this.repo.plans.get(chapter.chapterId);
      if (earlier === null || earlier.status !== "approved") continue;
      for (const scene of earlier.scenes) {
        for (const change of scene.knowledgeChanges) {
          if (change.to !== "unknown" && change.to !== "disbelieved") {
            promisedFacts.add(`${change.characterId}:${change.factId}`);
          }
        }
        for (const id of scene.setupIds) promisedSetups.add(id);
      }
    }
    return errors.filter((finding) => {
      if (finding.code === "revelation_unavailable" && finding.refs !== undefined) {
        return !promisedFacts.has(`${finding.refs.characterId ?? ""}:${finding.refs.factId ?? ""}`);
      }
      if (finding.code === "payoff_without_setup" && finding.refs?.setupId !== undefined) {
        return !promisedSetups.has(finding.refs.setupId);
      }
      return true;
    });
  }

  private architect(): PlanArchitect | null {
    if (this.models.planning === undefined) return null;
    return new PlanArchitect({
      repo: this.repo,
      model: this.models.planning,
      grant: this.grant,
      now: this.now,
      maxContextTokens: this.maxContextTokens,
    });
  }

  /** Propose an updated draft plan for a chapter whose plan went stale. */
  private async proposeRevision(
    build: Working,
    record: MutableChapter,
    problems: readonly string[],
  ): Promise<void> {
    const architect = this.architect();
    if (architect === null) return;
    await architect.proposeChapterPlan({
      chapterId: record.chapterId,
      instruction: `The approved plan for this chapter no longer holds against the manuscript as actually written. Plan it again from current state. The validation problems were:\n${problems
        .map((problem) => `- ${problem}`)
        .join("\n")}`,
    });
    this.note(
      build,
      "info",
      build.currentStep,
      `proposed an updated draft plan for ${record.title}`,
      record.chapterId,
    );
  }

  /** The instruction a generated chapter plan gets: the act's goals, verbatim. */
  private actInstruction(build: Working, record: MutableChapter, plan: ActPlan): string {
    const lines: string[] = [
      `This chapter belongs to the act "${plan.title}"${record.role === undefined ? "" : ` as its ${record.role}`}.`,
    ];
    if (plan.objective !== undefined) lines.push(`The act's objective: ${plan.objective}`);
    if (plan.targetClosingState !== undefined) {
      lines.push(`By the act's end: ${plan.targetClosingState}`);
    }
    for (const goal of plan.plotThreadGoals) lines.push(`Thread goal: ${goal.intent}`);
    for (const goal of plan.characterArcGoals) lines.push(`Arc goal: ${goal.movement}`);
    for (const goal of plan.relationshipGoals) lines.push(`Relationship goal: ${goal.intent}`);
    for (const constraint of plan.forbiddenFacts) {
      lines.push(
        `Must stay withheld: ${constraint.factId}${constraint.reason === undefined ? "" : ` (${constraint.reason})`}`,
      );
    }
    lines.push(...plan.constraints);
    return lines.join("\n");
  }

  /** Recompute accumulated usage from every child build — idempotent (§18). */
  private async accumulateUsage(build: Working): Promise<void> {
    let usage = EMPTY_COST;
    for (const chapter of build.chapters) {
      if (chapter.chapterBuildId === undefined) continue;
      const child = await this.repo.chapterBuilds.get(chapter.chapterBuildId);
      if (child !== null) usage = addRunCost(usage, child.usage);
    }
    build.usage = usage;
  }

  private async plan(build: Working): Promise<ActPlan> {
    const plan = await this.repo.actPlans.get(build.actId);
    if (plan === null) {
      throw new EditError("unknown_target", `The act plan for ${build.actId} no longer exists.`);
    }
    return plan;
  }

  /** The first act scene in telling order, for the opening inspection. */
  private async firstActScene(build: Working): Promise<string | null> {
    const [scenes, chapters] = await Promise.all([
      this.repo.listScenes(),
      this.repo.listChapters(),
    ]);
    const actChapterIds = new Set(build.chapters.map((chapter) => chapter.chapterId));
    const order = new Map(chapters.map((c) => [c.id as string, c.order]));
    const actScenes = scenes
      .filter(
        (scene) => scene.chapterId !== undefined && actChapterIds.has(scene.chapterId as string),
      )
      .sort(
        (a, b) => (order.get(a.chapterId as string) ?? 0) - (order.get(b.chapterId as string) ?? 0),
      );
    return actScenes.length === 0 ? null : (actScenes[0]?.id as string);
  }

  private currentChapter(build: Working): MutableChapter {
    const id = build.currentChapterId;
    if (id === undefined) {
      throw new EditError(
        "unknown_target",
        `${build.id} has no current chapter at ${build.currentStep}.`,
      );
    }
    return this.chapterRecord(build, id);
  }

  private chapterRecord(build: Working, chapterId: string): MutableChapter {
    const record = build.chapters.find((chapter) => chapter.chapterId === chapterId);
    if (record === undefined) {
      throw new EditError("unknown_target", `${chapterId} is not part of act build ${build.id}.`);
    }
    return record;
  }

  private assignments(): Readonly<Partial<Record<RoutingClass, string>>> {
    return {
      premium_prose: this.models.drafting.id,
      ...(this.models.analysis !== undefined ? { cheap_analysis: this.models.analysis.id } : {}),
      ...(this.models.planning !== undefined ? { premium_reasoning: this.models.planning.id } : {}),
    };
  }

  private note(
    build: Working,
    severity: ActDiagnostic["severity"],
    step: string,
    message: string,
    chapterId?: string,
  ): void {
    build.diagnostics.push({
      severity,
      step,
      ...(chapterId !== undefined ? { chapterId } : {}),
      message,
      at: this.now(),
    });
  }

  private working(build: ActBuild): Working {
    return {
      ...build,
      chapters: build.chapters.map((chapter) => ({ ...chapter })),
      diagnostics: [...build.diagnostics],
      openingNotes: [...build.openingNotes],
    };
  }

  private async load(buildId: string): Promise<ActBuild> {
    const build = await this.repo.actBuilds.get(buildId);
    if (build === null) {
      throw new EditError("unknown_target", `No act build "${buildId}".`);
    }
    return build;
  }

  private async persist(build: Working): Promise<void> {
    build.updatedAt = this.now();
    await this.repo.actBuilds.save(build);
    this.onProgress?.(build);
  }

  /** Every act-level step in the ordinary agent activity log, under one task. */
  private async log(build: Working, step: string, summary: string): Promise<void> {
    await this.repo.agents.appendActivity({
      taskId: build.taskId,
      timestamp: this.now(),
      tool: `act_build.${step}`,
      argumentsSummary: `build=${build.id}, act=${build.actId}`,
      resultSummary: summary,
      status: "ok",
    });
  }

  private async closeTask(build: Working, to: "completed" | "cancelled"): Promise<void> {
    const task = await this.repo.agents.getTask(build.taskId);
    if (task === null) return;
    try {
      await this.repo.agents.saveTask(transition(task, to, { now: this.now() }));
    } catch {
      // A task already terminal must not block finishing the build.
    }
  }
}

/** The step a resumed act build re-enters, mapped to a visible status. */
function statusForStep(step: ActBuildStep): ActBuildStatus {
  switch (step) {
    case "validate_prerequisites":
    case "inspect_opening":
    case "confirm_chapter_plan":
      return "planning";
    case "build_chapter":
      return "building";
    case "evaluate_progress":
    case "adapt_future_plans":
    case "act_validation":
    case "final_build":
    case "evaluate_goals":
      return "validating";
    case "approve_chapter":
      return "awaiting_approval";
    default:
      return "building";
  }
}
