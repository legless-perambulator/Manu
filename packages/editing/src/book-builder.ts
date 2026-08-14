import {
  checkPermission,
  createTask,
  transition,
  type PermissionGrant,
} from "@jellytind/agent-runtime";
import {
  DEFAULT_QUALITY_GATES,
  EMPTY_COST,
  addRunCost,
  isActBuildResumable,
  isBookBuildFinished,
  isBookBuildResumable,
  type ActBuild,
  type BookActRecord,
  type BookBuild,
  type BookBuildStatus,
  type BookBuildStep,
  type BookBuildSummary,
  type BookDiagnostic,
  type BookPlan,
  type RoutingClass,
} from "@jellytind/domain";
import type { StoryRepository } from "@jellytind/story-repository";
import { ActBuilder, type ActBuildModels } from "./act-builder";
import { EditError } from "./types";

/**
 * The book builder (Phase 34): Manu's novel-scale production pipeline.
 *
 * «Write the book» is hundreds of small operations, not one:
 *
 * ```
 * Traditional AI:  prompt → novel-sized completion attempt
 * Manu:            plan → context → scene → validate → state → checkpoint → continue
 * ```
 *
 * The book builder never asks a model for a book. It coordinates act builds
 * (Phase 33), which coordinate chapter builds (Phase 31), which draft one
 * scene at a time from freshly compiled context (Phase 32's plans). Each
 * level owns its own intent — book → act → chapter → scene — and nothing
 * flattens the hierarchy into one giant outline prompt (§5).
 *
 * Everything the lower layers guarantee holds here, one level up:
 *
 * - **One canonical story.** Story State stays the single authority (§7);
 *   completed chapters update it through ordinary confirmed transitions, and
 *   future builds read it back. The book build records progress, never state.
 * - **Human prose is canonical** (§16). Pause anywhere, rewrite a chapter by
 *   hand, resume: every later scene is drafted from the manuscript as it now
 *   is, because context is compiled at draft time, never from a snapshot.
 * - **Every gate anywhere is answered here.** Scene gates (under Every Scene)
 *   are raised by chapter builds, forwarded through the act build, surfaced
 *   on the book build verbatim; the answer travels back down the same chain.
 * - **Failure is a pause, not corruption** (§14). A provider dropping mid-act
 *   pauses the book with the diagnosis on the record; resume retries from the
 *   exact scene reached. Nothing regenerates because a process restarted.
 */

export interface StartBookBuildOptions {
  readonly branchId?: string;
  readonly approvalPolicy?: BookBuild["approvalPolicy"];
  readonly autoConfirmObjective?: boolean;
  /** Quality gates (§18); omitted fields take the defaults. */
  readonly gates?: Partial<BookBuild["gates"]>;
}

export interface BookBuilderOptions {
  readonly repo: StoryRepository;
  readonly models: ActBuildModels;
  readonly grant: PermissionGrant;
  readonly now?: () => string;
  readonly maxContextTokens?: number;
  /** Told after every persisted book-level step. */
  readonly onProgress?: (build: BookBuild) => void;
  /** Told as the running act progresses, for the dashboard's live line. */
  readonly onActProgress?: (actBuild: ActBuild) => void;
}

type MutableAct = { -readonly [K in keyof BookActRecord]: BookActRecord[K] };

type Working = Omit<
  { -readonly [K in keyof BookBuild]: BookBuild[K] },
  "acts" | "diagnostics" | "openingNotes"
> & { acts: MutableAct[]; diagnostics: BookDiagnostic[]; openingNotes: string[] };

export class BookBuilder {
  private readonly repo: StoryRepository;
  private readonly models: ActBuildModels;
  private readonly grant: PermissionGrant;
  private readonly now: () => string;
  private readonly onProgress: ((build: BookBuild) => void) | undefined;
  private readonly actBuilder: ActBuilder;
  private readonly pauseRequested = new Set<string>();
  private readonly cancelRequested = new Set<string>();
  private readonly running = new Set<string>();
  /** The act build each running book is currently inside, for pause forwarding. */
  private readonly runningChild = new Map<string, string>();

  constructor(options: BookBuilderOptions) {
    this.repo = options.repo;
    this.models = options.models;
    this.grant = options.grant;
    this.now = options.now ?? (() => new Date().toISOString());
    this.onProgress = options.onProgress;
    this.actBuilder = new ActBuilder({
      repo: this.repo,
      models: this.models,
      grant: this.grant,
      now: this.now,
      ...(options.maxContextTokens !== undefined
        ? { maxContextTokens: options.maxContextTokens }
        : {}),
      ...(options.onActProgress !== undefined ? { onProgress: options.onActProgress } : {}),
    });
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * "/write-book": create a book build from the approved book plan and run it.
   * Never one prompt for a book (§3) — the loop below is the whole story.
   */
  async start(options: StartBookBuildOptions = {}): Promise<BookBuild> {
    const decision = checkPermission(
      { name: "build_book", permission: "edit_manuscript" },
      this.grant,
    );
    if (!decision.allowed) {
      throw new EditError("permission_denied", decision.reason);
    }

    const plan = await this.repo.bookPlan.get();
    if (plan === null) {
      throw new EditError("unknown_target", "No book plan exists. Plan the book first.");
    }
    if (plan.status !== "approved") {
      throw new EditError(
        "unknown_target",
        `The book plan is ${plan.status}. A book is built only from a plan the writer has approved.`,
      );
    }
    const findings = await this.repo.validateBookPlan(plan);
    const errors = findings.filter((finding) => finding.severity === "error");
    if (errors.length > 0) {
      throw new EditError(
        "unknown_target",
        `The book plan does not hold against the project: ${errors
          .map((finding) => finding.message)
          .join(" ")}`,
      );
    }

    const open = (await this.repo.bookBuilds.list()).find(
      (entry) => !isBookBuildFinished(entry.status),
    );
    if (open !== undefined) {
      throw new EditError(
        "unknown_target",
        `Book build ${open.id} is ${open.status}. Resume or cancel it before starting another.`,
      );
    }

    const policy = options.approvalPolicy ?? "every_act";
    const titles = new Map<string, string>();
    for (const member of plan.acts) {
      titles.set(member.actId, (await this.repo.actPlans.get(member.actId))?.title ?? member.actId);
    }
    const task = createTask({
      id: await this.repo.agents.nextTaskId(),
      goal: "build_book",
      now: this.now(),
      scope: plan.acts.map((member) => member.actId),
      allowedTools: [],
      approvalPolicy:
        policy === "auto_until_error" || policy === "autonomous"
          ? "approve_destructive"
          : "approve_every_edit",
    });
    await this.repo.agents.saveTask(task);
    await this.repo.agents.saveTask(transition(task, "running", { now: this.now() }));

    const build: Working = {
      id: await this.repo.bookBuilds.nextId(),
      projectId: plan.projectId,
      branchId: options.branchId ?? "main",
      planId: plan.id,
      planVersion: plan.approvedVersion ?? plan.version,
      variant: "first_draft",
      status: "planning",
      createdAt: this.now(),
      updatedAt: this.now(),
      requestedBy: "human",
      taskId: task.id,
      approvalPolicy: policy,
      autoConfirmObjective:
        options.autoConfirmObjective ?? (policy === "auto_until_error" || policy === "autonomous"),
      gates: { ...DEFAULT_QUALITY_GATES, ...options.gates },
      modelAssignments: this.assignments(),
      currentStep: "validate_prerequisites",
      acts: plan.acts.map((member): MutableAct => ({
        actId: member.actId,
        title: titles.get(member.actId) ?? member.actId,
        ...(member.intent !== undefined ? { intent: member.intent } : {}),
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
        finding.actId,
      );
    }
    await this.persist(build);
    return this.runLoop(build);
  }

  /**
   * Continue a paused or failed book build from exactly where it stopped
   * (§13). Model assignments are refreshed here (§15): a model changed since
   * the pause is used for future operations, recorded as such — earlier
   * chapters keep their provenance and are never regenerated for it.
   */
  async resume(buildId: string): Promise<BookBuild> {
    const build = await this.load(buildId);
    if (!isBookBuildResumable(build.status)) {
      throw new EditError("unknown_target", `${buildId} is ${build.status}, not resumable.`, {
        details: { buildId, status: build.status },
      });
    }
    const working = this.working(build);
    working.status = statusForStep(working.currentStep);
    working.resumeCount += 1;
    delete working.failureReason;
    for (const act of working.acts) {
      if (act.status === "failed") {
        act.status = act.actBuildId === undefined ? "pending" : "building";
        delete act.reason;
      }
    }
    const assignments = this.assignments();
    if (JSON.stringify(assignments) !== JSON.stringify(working.modelAssignments)) {
      this.note(
        working,
        "info",
        working.currentStep,
        `model assignments changed for future operations: ${Object.entries(assignments)
          .map(([cls, id]) => `${cls} → ${id}`)
          .join(", ")}. Earlier chapters keep their recorded provenance.`,
      );
      working.modelAssignments = assignments;
    }
    await this.persist(working);
    await this.log(working, "resume", `resumed at ${working.currentStep}`);
    return this.runLoop(working);
  }

  /** Answer the open gate with yes — wherever in the hierarchy it was raised. */
  async approve(buildId: string): Promise<BookBuild> {
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
      case "act_plan": {
        // The writer's yes *is* the act plan approval.
        if (pending.actId !== undefined) {
          await this.repo.approveActPlan(pending.actId);
          this.note(
            working,
            "info",
            working.currentStep,
            `the writer approved the plan for ${this.actRecord(working, pending.actId).title}`,
            pending.actId,
          );
        }
        working.currentStep = "confirm_act_plan";
        break;
      }
      case "act_gate": {
        // Forwarded: the answer travels back down to the act (and, if the
        // gate was a scene's, on down to the chapter build that raised it).
        if (pending.actId !== undefined) {
          const record = this.actRecord(working, pending.actId);
          if (record.actBuildId !== undefined) {
            await this.actBuilder.approve(record.actBuildId);
          }
        }
        working.currentStep = "build_act";
        break;
      }
      case "act_review":
        working.currentStep = "act_checkpoint";
        break;
      case "final":
        working.currentStep = "done";
        working.status = "completed";
        await this.persist(working);
        await this.log(working, "complete", "draft build accepted by the writer");
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

  /** Answer the open gate with no. */
  async rejectPending(buildId: string, reason?: string): Promise<BookBuild> {
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
      pending?.actId,
    );
    if (pending?.kind === "act_gate" && pending.actId !== undefined) {
      // Forward the "no" down the chain, then read where the act landed —
      // declining a draft chapter plan continues without it; declining a held
      // scene pauses the chain, and resume drafts the scene again.
      const record = this.actRecord(working, pending.actId);
      let landed;
      if (record.actBuildId !== undefined) {
        landed = await this.actBuilder.rejectPending(record.actBuildId, reason);
      }
      if (landed === undefined || landed.status === "paused") {
        working.status = "paused";
        await this.persist(working);
        await this.log(working, "reject", reason ?? "declined at the forwarded gate");
        return working;
      }
      working.currentStep = "build_act";
      working.status = statusForStep(working.currentStep);
      await this.persist(working);
      await this.log(working, "reject", reason ?? "declined at the forwarded gate");
      return this.runLoop(working);
    }
    working.status = "paused";
    await this.persist(working);
    await this.log(working, "reject", reason ?? "declined at the gate");
    return working;
  }

  /**
   * Ask a running book build to stop after the step it is on. Forwarded down
   * the running chain, so the pause lands at the scene the pipeline reached.
   */
  requestPause(buildId: string): void {
    this.pauseRequested.add(buildId);
    const child = this.runningChild.get(buildId);
    if (child !== undefined) this.actBuilder.requestPause(child);
  }

  /** Cancel a book build. Completed work is kept — it is ordinary history. */
  async cancel(buildId: string): Promise<BookBuild> {
    if (this.running.has(buildId)) {
      this.cancelRequested.add(buildId);
      const child = this.runningChild.get(buildId);
      if (child !== undefined) this.actBuilder.requestPause(child);
      return this.load(buildId);
    }
    const build = await this.load(buildId);
    if (isBookBuildFinished(build.status)) return build;
    const working = this.working(build);
    working.status = "cancelled";
    delete working.pending;
    this.note(working, "info", working.currentStep, "cancelled by the writer");
    await this.persist(working);
    await this.log(working, "cancel", "cancelled; completed acts and chapters kept");
    await this.closeTask(working, "cancelled");
    return working;
  }

  async get(buildId: string): Promise<BookBuild | null> {
    return this.repo.bookBuilds.get(buildId);
  }

  async list(): Promise<BookBuildSummary[]> {
    return this.repo.bookBuilds.list();
  }

  // ── The pipeline loop ────────────────────────────────────────────────────

  private async runLoop(build: Working): Promise<BookBuild> {
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
            build.currentActId === undefined ? "" : ` (${build.currentActId})`
          }: ${reason}`;
          this.note(build, "error", build.currentStep, reason, build.currentActId);
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
      case "confirm_act_plan":
        return this.stepConfirmActPlan(build);
      case "build_act":
        return this.stepBuildAct(build);
      case "evaluate_progress":
        return this.stepEvaluate(build);
      case "adapt_future_plans":
        return this.stepAdapt(build);
      case "approve_act":
        return this.stepApproveAct(build);
      case "act_checkpoint":
        return this.stepCheckpoint(build);
      case "assemble_book":
        return this.stepAssemble(build);
      case "final_build":
        return this.stepFinalBuild(build);
      case "book_tests":
        return this.stepBookTests(build);
      case "coverage":
        return this.stepCoverage(build);
      case "present":
        return this.stepPresent(build);
      case "done":
        return "stop";
    }
  }

  /**
   * §31: before anything runs — the pre-build checkpoint, and an honest note
   * about what already exists. A manuscript with prose in it is never
   * overwritten: chapter builds keep every scene that already has text and
   * draft only the empty ones.
   */
  private async stepPrerequisites(build: Working): Promise<"continue"> {
    build.status = "planning";
    const held = await this.manuscriptWords();
    if (held > 0) {
      this.note(
        build,
        "info",
        "validate_prerequisites",
        `the manuscript already holds ${String(held)} words. Existing prose is kept; only empty scenes are drafted.`,
      );
    }
    const checkpoint = await this.repo.createCheckpoint("Before the book build");
    build.checkpointId = checkpoint.id;
    build.currentStep = "inspect_opening";
    return "continue";
  }

  /** The scope of what is about to happen, stated up front (§31). */
  private async stepOpening(build: Working): Promise<"continue"> {
    const plan = await this.plan();
    if (plan.openingState !== undefined) {
      build.openingNotes.push(`The plan says: ${plan.openingState}`);
    }
    let chapters = 0;
    let scenes = 0;
    const allScenes = await this.repo.listScenes();
    for (const member of plan.acts) {
      const actPlan = await this.repo.actPlans.get(member.actId);
      if (actPlan === null) continue;
      chapters += actPlan.chapters.length;
      const ids = new Set(actPlan.chapters.map((chapter) => chapter.chapterId));
      scenes += allScenes.filter(
        (scene) => scene.chapterId !== undefined && ids.has(scene.chapterId as string),
      ).length;
    }
    build.openingNotes.push(
      `${String(plan.acts.length)} act(s), ${String(chapters)} chapter(s), ${String(scenes)} scene(s) planned`,
      ...(plan.targetWords !== undefined
        ? [`target: about ${String(plan.targetWords)} words — guidance, never a quota`]
        : []),
    );
    build.currentStep = "confirm_act_plan";
    return "continue";
  }

  /**
   * §4's "confirm/generate Act Plan", one act at a time. An approved act plan
   * is re-validated against the project as the earlier acts actually left it;
   * a draft act plan gates — the writer's yes is the approval.
   */
  private async stepConfirmActPlan(build: Working): Promise<"continue" | "stop"> {
    const record = build.acts.find((act) => act.status === "pending");
    if (record === undefined) {
      delete build.currentActId;
      build.currentStep = "assemble_book";
      return "continue";
    }
    build.status = "planning";
    build.currentActId = record.actId;

    const plan = await this.repo.actPlans.get(record.actId);
    if (plan === null) {
      build.status = "paused";
      this.note(
        build,
        "error",
        "confirm_act_plan",
        `paused: the plan for ${record.title} no longer exists.`,
        record.actId,
      );
      return "stop";
    }
    if (plan.status !== "approved") {
      return this.gate(
        build,
        `${record.title} has a ${plan.status} plan. Approve it so the act can build?`,
        "act_plan",
        record.actId,
      );
    }
    const errors = (await this.repo.validateActPlan(plan)).filter(
      (finding) => finding.severity === "error",
    );
    if (errors.length > 0) {
      record.planStale = true;
      for (const error of errors.slice(0, 5)) {
        this.note(build, "error", "confirm_act_plan", error.message, record.actId);
      }
      build.status = "paused";
      this.note(
        build,
        "warning",
        "confirm_act_plan",
        `paused: the plan for ${record.title} no longer holds against the project. Revise it, then resume.`,
        record.actId,
      );
      await this.log(build, "stale_act_plan", `paused at ${record.actId}`);
      return "stop";
    }
    record.planId = plan.id;
    record.planVersion = plan.approvedVersion ?? plan.version;
    delete record.planStale;
    build.currentStep = "build_act";
    return "continue";
  }

  /** Run (or resume) the child act build, interpreting wherever it stops. */
  private async stepBuildAct(build: Working): Promise<"continue" | "stop"> {
    const record = this.currentAct(build);
    build.status = "building";
    if (record.status === "pending") {
      record.status = "building";
      record.startedAt = this.now();
    }
    await this.persist(build);

    let child;
    if (record.actBuildId !== undefined) {
      this.runningChild.set(build.id, record.actBuildId);
      const held = await this.repo.actBuilds.get(record.actBuildId);
      if (held !== null && isActBuildResumable(held.status)) {
        child = await this.actBuilder.resume(record.actBuildId);
      } else if (held !== null && held.status === "awaiting_approval") {
        // Re-entered after a forwarded approval: read where the act stands
        // now; the answer already travelled down in approve().
        child = held;
      } else {
        child = held;
      }
    }
    if (child === undefined || child === null) {
      const mapped = this.actPolicies(build);
      child = await this.actBuilder.start({
        actId: record.actId,
        branchId: build.branchId,
        approvalPolicy: mapped.act,
        autonomy: build.approvalPolicy === "autonomous" ? "propose" : "pause",
        autoConfirmObjective: build.autoConfirmObjective,
        generateMissingPlans: build.approvalPolicy === "autonomous",
        ...(mapped.chapter !== undefined ? { chapterApprovalPolicy: mapped.chapter } : {}),
        maxSceneRevisions: build.gates.maxSceneRepairs,
      });
      record.actBuildId = child.id;
    }
    this.runningChild.delete(build.id);
    await this.accumulateUsage(build);
    this.mirrorPosition(build, child);

    if (child.status === "completed") {
      record.status = "completed";
      record.finishedAt = this.now();
      record.words = child.chapters.reduce((sum, chapter) => sum + (chapter.words ?? 0), 0);
      record.chaptersCompleted = child.chapters.filter((c) => c.status === "completed").length;
      record.chaptersTotal = child.chapters.length;
      delete build.currentChapterId;
      delete build.currentSceneId;
      await this.log(build, "act_done", `${record.actId} built by ${child.id}`);
      build.currentStep = "evaluate_progress";
      return "continue";
    }

    if (child.status === "awaiting_approval" && child.pending !== undefined) {
      // A gate raised somewhere below — an act's own, or a chapter's,
      // forwarded already once. Surface it verbatim; kind carries the chain.
      return this.gate(
        build,
        child.pending.question,
        "act_gate",
        record.actId,
        child.pending.chapterId,
      );
    }

    if (child.status === "paused" && this.pauseRequested.delete(build.id)) {
      build.status = "paused";
      this.note(
        build,
        "info",
        "build_act",
        `paused by the writer; ${record.title} holds at the scene it reached`,
        record.actId,
      );
      await this.log(build, "pause", `paused inside ${record.actId}`);
      return "stop";
    }

    // §14, §17: the act stopped — a provider failure, a validation error, a
    // stale chapter plan. The book pauses with the diagnosis on the record;
    // state is preserved and resume retries. Never treated as corruption.
    record.status = "failed";
    record.reason =
      child.failureReason ??
      child.diagnostics.filter((d) => d.severity === "error" || d.severity === "warning").at(-1)
        ?.message ??
      `act build ${child.id} stopped (${child.status})`;
    build.status = "paused";
    this.note(
      build,
      "error",
      "build_act",
      `paused: building ${record.title} stopped — ${record.reason}. Resume retries from where it stopped.`,
      record.actId,
    );
    await this.log(build, "act_stopped", `${record.actId}: ${record.reason}`);
    return "stop";
  }

  /**
   * §8 between acts: where the book's goals stand, from recorded state; then
   * the quality gates (§18) — configurable, and a failed gate pauses.
   */
  private async stepEvaluate(build: Working): Promise<"continue" | "stop"> {
    build.status = "validating";
    const plan = await this.plan();
    build.goalReport = await this.repo.evaluateBookGoals(plan);
    await this.log(
      build,
      "progress",
      `${String(build.goalReport.satisfied)}/${String(build.goalReport.results.length)} book goal(s) satisfied`,
    );

    const record = this.currentAct(build);
    const child =
      record.actBuildId === undefined ? null : await this.repo.actBuilds.get(record.actBuildId);
    if (build.gates.requireCleanCompile && (child?.finalBuildErrors ?? 0) > 0) {
      build.status = "paused";
      this.note(
        build,
        "error",
        "evaluate_progress",
        `quality gate: ${record.title} finished with ${String(child?.finalBuildErrors ?? 0)} Story Compiler error(s). Fix the project, then resume.`,
        record.actId,
      );
      await this.log(build, "gate_failed", "compiler errors after act");
      return "stop";
    }
    if (build.gates.requireHardTestsPass) {
      const tests = await this.repo.runStoryTests();
      const hardFailures = tests.results.filter(
        (result) => result.status === "failed" && result.severity === "error",
      );
      if (hardFailures.length > 0) {
        build.status = "paused";
        this.note(
          build,
          "error",
          "evaluate_progress",
          `quality gate: ${String(hardFailures.length)} hard story test(s) failing after ${record.title}: ${hardFailures
            .map((failure) => failure.statement)
            .join("; ")}. Fix the story, then resume.`,
          record.actId,
        );
        await this.log(build, "gate_failed", "hard story tests failing after act");
        return "stop";
      }
    }
    build.currentStep = "adapt_future_plans";
    return "continue";
  }

  /**
   * §6 at book level: does what was actually written still support the
   * remaining acts' plans? Chapter-level adaptation lives inside each act as
   * it runs; here each future act's plan is re-validated whole. A stale act
   * plan pauses the build with the act named — never silently built from.
   */
  private async stepAdapt(build: Working): Promise<"continue" | "stop"> {
    const future = build.acts.filter((act) => act.status === "pending");
    const newlyStale: MutableAct[] = [];
    for (const act of future) {
      const plan = await this.repo.actPlans.get(act.actId);
      if (plan === null || plan.status !== "approved") continue;
      const errors = (await this.repo.validateActPlan(plan)).filter(
        (finding) => finding.severity === "error",
      );
      if (errors.length === 0) {
        delete act.planStale;
        continue;
      }
      if (act.planStale !== true) {
        act.planStale = true;
        newlyStale.push(act);
        this.note(
          build,
          "warning",
          "adapt_future_plans",
          `the plan for ${act.title} no longer holds: ${errors[0]?.message ?? ""}`,
          act.actId,
        );
      }
    }
    if (newlyStale.length > 0) {
      build.status = "paused";
      this.note(
        build,
        "warning",
        "adapt_future_plans",
        `paused: ${String(newlyStale.length)} future act plan(s) no longer hold against what was written. Revise them, then resume — completed acts are untouched.`,
      );
      await this.log(build, "stale_plans", newlyStale.map((act) => act.actId).join(", "));
      return "stop";
    }
    build.currentStep = "approve_act";
    return "continue";
  }

  /** The book-level act gate, under the `every_act` policy (§10). */
  private async stepApproveAct(build: Working): Promise<"continue" | "stop"> {
    const record = this.currentAct(build);
    if (build.approvalPolicy === "every_act") {
      return this.gate(
        build,
        `Keep the built ${record.title} and continue the book?`,
        "act_review",
        record.actId,
      );
    }
    build.currentStep = "act_checkpoint";
    return "continue";
  }

  private async stepCheckpoint(build: Working): Promise<"continue"> {
    const record = this.currentAct(build);
    const checkpoint = await this.repo.createCheckpoint(`After ${record.title} (${build.id})`);
    record.checkpointId = checkpoint.id;
    delete build.currentActId;
    build.currentStep = "confirm_act_plan";
    return "continue";
  }

  /** The manuscript as it now stands — real words, no padding toward targets (§23). */
  private async stepAssemble(build: Working): Promise<"continue"> {
    build.status = "validating";
    const plan = await this.plan();
    const words = await this.manuscriptWords();
    const target =
      plan.targetWords === undefined
        ? ""
        : ` (target was about ${String(plan.targetWords)} — guidance, not a quota)`;
    this.note(
      build,
      "info",
      "assemble_book",
      `the manuscript holds ${String(words)} words${target}`,
    );
    build.currentStep = "final_build";
    return "continue";
  }

  private async stepFinalBuild(build: Working): Promise<"continue"> {
    const result = await this.repo.buildStory();
    build.finalBuildId = result.id;
    build.currentStep = "book_tests";
    return "continue";
  }

  private async stepBookTests(build: Working): Promise<"continue"> {
    await this.repo.runStoryTests();
    build.currentStep = "coverage";
    return "continue";
  }

  /**
   * §24: the report — every number from the record, every issue navigable.
   * And §25 in one word: the label says **draft**. The pipeline finishing is
   * a fact about prose existing, not a claim that the book is ready.
   */
  private async stepCoverage(build: Working): Promise<"continue"> {
    const plan = await this.plan();
    build.goalReport = await this.repo.evaluateBookGoals(plan);
    for (const result of build.goalReport.results) {
      if (result.status === "unsatisfied") {
        this.note(build, "warning", "coverage", `${result.statement} — ${result.evidence}`);
      } else if (result.status === "not_evaluated" && result.method === "semantic") {
        this.note(
          build,
          "semantic_concern",
          "coverage",
          `"${result.statement}" is the author's intent; the record shows ${result.evidence}. Only a reading can settle it.`,
        );
      }
    }

    const [words, tests, threads] = await Promise.all([
      this.manuscriptWords(),
      this.repo.runStoryTests(),
      this.repo.getUnresolvedThreads(),
    ]);
    const finalBuild =
      build.finalBuildId === undefined ? null : await this.repo.getBuild(build.finalBuildId);
    const scenes = await this.repo.listScenes();
    const chapterIds = new Set<string>();
    for (const member of plan.acts) {
      const actPlan = await this.repo.actPlans.get(member.actId);
      for (const chapter of actPlan?.chapters ?? []) chapterIds.add(chapter.chapterId);
    }
    const sceneCount = scenes.filter(
      (scene) => scene.chapterId !== undefined && chapterIds.has(scene.chapterId as string),
    ).length;
    const failing = tests.results.filter((result) => result.status === "failed");
    const onPage = threads.filter((thread) => thread.status !== "planned");

    build.report = {
      label: "Draft build complete",
      words,
      actsCompleted: build.acts.filter((act) => act.status === "completed").length,
      actsTotal: build.acts.length,
      chaptersCompleted: build.acts.reduce((sum, act) => sum + (act.chaptersCompleted ?? 0), 0),
      chaptersTotal: build.acts.reduce((sum, act) => sum + (act.chaptersTotal ?? 0), 0),
      scenes: sceneCount,
      compilerErrors: finalBuild?.diagnostics.filter((d) => d.severity === "error").length ?? 0,
      compilerWarnings: finalBuild?.diagnostics.filter((d) => d.severity === "warning").length ?? 0,
      testsPassed: tests.deterministic.passed,
      testsTotal: tests.deterministic.total,
      failingTests: failing.map((result) => ({
        testId: result.testId,
        statement: result.statement,
      })),
      unresolvedThreads: onPage.map((thread) => ({
        threadId: thread.threadId,
        name: thread.name,
      })),
      semanticConcerns: build.diagnostics.filter((d) => d.severity === "semantic_concern").length,
      generatedAt: this.now(),
    };
    build.currentStep = "present";
    return "continue";
  }

  /** The finish: a final checkpoint and — unless hands-off — the writer's verdict. */
  private async stepPresent(build: Working): Promise<"continue" | "stop"> {
    const checkpoint = await this.repo.createCheckpoint(`Draft build complete (${build.id})`);
    this.note(build, "info", "present", `finished; checkpoint ${checkpoint.id}`);
    if (build.approvalPolicy !== "auto_until_error" && build.approvalPolicy !== "autonomous") {
      const report = build.report;
      const summary =
        report === undefined
          ? ""
          : ` ${String(report.words)} words, ${String(report.actsCompleted)}/${String(report.actsTotal)} acts.`;
      return this.gate(build, `Accept the draft build?${summary}`, "final", undefined);
    }
    build.currentStep = "done";
    build.status = "completed";
    await this.log(build, "complete", "draft build complete");
    await this.closeTask(build, "completed");
    return "stop";
  }

  // ── Support ──────────────────────────────────────────────────────────────

  /**
   * How the writer's one choice fans out across the hierarchy (§10): the
   * book's policy decides which layer gates, and the layers below run
   * hands-off — one gatekeeper, one conversation.
   */
  private actPolicies(build: Working): {
    act: ActBuild["approvalPolicy"];
    chapter?: "every_scene";
  } {
    switch (build.approvalPolicy) {
      case "every_scene":
        return { act: "auto_until_error", chapter: "every_scene" };
      case "every_chapter":
        return { act: "every_chapter" };
      default:
        return { act: "auto_until_error" };
    }
  }

  private async gate(
    build: Working,
    question: string,
    kind: NonNullable<BookBuild["pending"]>["kind"],
    actId: string | undefined,
    chapterId?: string,
  ): Promise<"stop"> {
    build.status = "awaiting_approval";
    build.pending = {
      question,
      kind,
      ...(actId !== undefined ? { actId } : {}),
      ...(chapterId !== undefined ? { chapterId } : {}),
      raisedAt: this.now(),
    };
    await this.log(build, "gate", question);
    return "stop";
  }

  /** Mirror where the running act stands, for the dashboard (§20). */
  private mirrorPosition(build: Working, child: ActBuild): void {
    if (child.currentChapterId !== undefined) {
      build.currentChapterId = child.currentChapterId;
      const chapter = child.chapters.find((c) => c.chapterId === child.currentChapterId);
      if (chapter?.chapterBuildId !== undefined) build.currentSceneId = undefined;
    } else {
      delete build.currentChapterId;
      delete build.currentSceneId;
    }
  }

  /** Recompute accumulated usage from every act's children — idempotent (§27). */
  private async accumulateUsage(build: Working): Promise<void> {
    let usage = EMPTY_COST;
    for (const act of build.acts) {
      if (act.actBuildId === undefined) continue;
      const child = await this.repo.actBuilds.get(act.actBuildId);
      if (child !== null) usage = addRunCost(usage, child.usage);
    }
    build.usage = usage;
  }

  /** Canonical word count, straight from the chapter files (§23). */
  private async manuscriptWords(): Promise<number> {
    const chapters = await this.repo.listChapters();
    let total = 0;
    for (const chapter of chapters) {
      const file = (await this.repo.readProjectFile(chapter.filePath)) ?? "";
      const text = file.replace(/<!--[^>]*-->/g, " ").trim();
      total += text === "" ? 0 : text.split(/\s+/).length;
    }
    return total;
  }

  private async plan(): Promise<BookPlan> {
    const plan = await this.repo.bookPlan.get();
    if (plan === null) {
      throw new EditError("unknown_target", "The book plan no longer exists.");
    }
    return plan;
  }

  private currentAct(build: Working): MutableAct {
    const id = build.currentActId;
    if (id === undefined) {
      throw new EditError(
        "unknown_target",
        `${build.id} has no current act at ${build.currentStep}.`,
      );
    }
    return this.actRecord(build, id);
  }

  private actRecord(build: Working, actId: string): MutableAct {
    const record = build.acts.find((act) => act.actId === actId);
    if (record === undefined) {
      throw new EditError("unknown_target", `${actId} is not part of book build ${build.id}.`);
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
    severity: BookDiagnostic["severity"],
    step: string,
    message: string,
    actId?: string,
  ): void {
    build.diagnostics.push({
      severity,
      step,
      ...(actId !== undefined ? { actId } : {}),
      message,
      at: this.now(),
    });
  }

  private working(build: BookBuild): Working {
    return {
      ...build,
      acts: build.acts.map((act) => ({ ...act })),
      diagnostics: [...build.diagnostics],
      openingNotes: [...build.openingNotes],
    };
  }

  private async load(buildId: string): Promise<BookBuild> {
    const build = await this.repo.bookBuilds.get(buildId);
    if (build === null) {
      throw new EditError("unknown_target", `No book build "${buildId}".`);
    }
    return build;
  }

  private async persist(build: Working): Promise<void> {
    build.updatedAt = this.now();
    await this.repo.bookBuilds.save(build);
    this.onProgress?.(build);
  }

  private async log(build: Working, step: string, summary: string): Promise<void> {
    await this.repo.agents.appendActivity({
      taskId: build.taskId,
      timestamp: this.now(),
      tool: `book_build.${step}`,
      argumentsSummary: `build=${build.id}`,
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

function statusForStep(step: BookBuildStep): BookBuildStatus {
  switch (step) {
    case "validate_prerequisites":
    case "inspect_opening":
    case "confirm_act_plan":
      return "planning";
    case "build_act":
      return "building";
    case "evaluate_progress":
    case "adapt_future_plans":
    case "assemble_book":
    case "final_build":
    case "book_tests":
    case "coverage":
    case "present":
      return "validating";
    case "approve_act":
      return "awaiting_approval";
    default:
      return "building";
  }
}
