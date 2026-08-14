import {
  checkPermission,
  createTask,
  transition,
  type PermissionGrant,
} from "@jellytind/agent-runtime";
import { ContextCompiler, renderContextPackage } from "@jellytind/context-compiler";
import {
  findResearchPlaceholders,
  isBuildFinished,
  isBuildResumable,
  EMPTY_COST,
  type ApprovalPolicy,
  type BuildDiagnostic,
  type Chapter,
  type ChapterBuild,
  type ChapterBuildStatus,
  type ChapterBuildStep,
  type ChapterBuildSummary,
  type PlanCoverageItem,
  type RoutingClass,
  type RunCost,
  type Scene,
  type SceneBuildRecord,
  type SceneLengthTarget,
} from "@jellytind/domain";
import { ModelError, type LanguageModel, type OutputSchema } from "@jellytind/model-router";
import {
  resolveSceneRange,
  listSceneSpans,
  sceneMarker,
  type StoryRepository,
} from "@jellytind/story-repository";
import { PROPOSAL_SCHEMA, RESPONSE_FORMAT, validateProposalText } from "./proposal-schema";
import { EDITOR_SYSTEM_PROMPT } from "./prompts";
import { StateExtractor } from "./state-extractor";
import { EditError } from "./types";

/**
 * The long-form chapter builder (Phase 31).
 *
 * «Build Chapter 17 from the approved plan» is **not** one model completion.
 * It is this pipeline, run one small operation at a time, with the harness —
 * never the model — deciding what happens next:
 *
 * ```
 * validate prerequisites → checkpoint → plan the scene sequence → [gate]
 * for each scene:
 *   compile scene context → draft (continuing in bounded steps if short)
 *   → [gate] → commit as one change set → extract state changes
 *   → deterministic validation → plan coverage → bounded revision
 *   → checkpoint
 * assemble → final Story Build → Story Tests → present
 * ```
 *
 * The record in `.writer/builds/chapters/` is written after every step, which
 * is what makes a build pausable, cancellable, and resumable after Manu has
 * been closed and reopened — it never restarts from Scene 1 (§11).
 *
 * Two boundaries hold throughout:
 *
 * - **The manuscript is one manuscript.** Scenes are committed into the same
 *   chapter file a human writes in, through ordinary change sets with AI
 *   provenance. Context is recompiled from the *current* project state before
 *   every draft, so a scene the writer edited by hand mid-build is what the
 *   next scene works from (§15–16).
 * - **Canon rules are unchanged.** Extracted state lands as `proposed`;
 *   only objective, high-confidence kinds may auto-confirm, and only when the
 *   writer switched that on when starting the build (§6).
 */

/** Transition kinds objective enough to auto-confirm under policy. */
const OBJECTIVE_KINDS: readonly string[] = [
  "character_location",
  "object_holder",
  "object_location",
  "object_owner",
  "object_status",
];
const AUTO_CONFIRM_CONFIDENCE = 0.8;

/** The models a build draws on, by class of work (§17). */
export interface ChapterBuildModels {
  /** Prose the writer will read. A build cannot start without one. */
  readonly drafting: LanguageModel;
  /** Plan coverage and state extraction. Omitted → those steps are skipped, and say so. */
  readonly analysis?: LanguageModel;
}

export interface StartBuildOptions {
  readonly chapterId: string;
  /** The version this build belongs to, from the open session. */
  readonly branchId?: string;
  readonly approvalPolicy?: ApprovalPolicy;
  /** Auto-confirm objective, high-confidence state transitions (§6). */
  readonly autoConfirmObjective?: boolean;
  /** Length targets per scene, where the plan supplies one (§4). */
  readonly targets?: Readonly<Record<string, SceneLengthTarget>>;
  /** Automatic repair attempts per scene before pausing (§9). */
  readonly maxRevisions?: number;
  /** Continuation calls allowed for one long scene (§5). */
  readonly maxContinuations?: number;
  /** What an unresolved [RESEARCH: …] placeholder does to the build (Phase 35 §20). */
  readonly researchGapPolicy?: "pause" | "proceed";
}

export interface ChapterBuilderOptions {
  readonly repo: StoryRepository;
  readonly models: ChapterBuildModels;
  readonly grant: PermissionGrant;
  readonly now?: () => string;
  readonly maxContextTokens?: number;
  /** Told after every persisted step, so a UI can follow along. */
  readonly onProgress?: (build: ChapterBuild) => void;
}

interface CoverageResult {
  readonly beats: readonly { beat: string; met: boolean; note: string }[];
}

const COVERAGE_SCHEMA: OutputSchema<CoverageResult> = {
  name: "PlanCoverage",
  parse(value: unknown): CoverageResult {
    if (typeof value !== "object" || value === null) {
      throw new EditError("empty_response", "PlanCoverage: expected an object.");
    }
    const list = (value as { beats?: unknown }).beats;
    if (!Array.isArray(list)) {
      throw new EditError("empty_response", 'PlanCoverage: "beats" must be an array.');
    }
    return {
      beats: list
        .filter((b): b is Record<string, unknown> => typeof b === "object" && b !== null)
        .map((b) => ({
          beat: String(b.beat ?? ""),
          met: b.met === true,
          note: typeof b.note === "string" ? b.note : "",
        })),
    };
  },
};

type MutableScene = { -readonly [K in keyof SceneBuildRecord]: SceneBuildRecord[K] };

/** A mutable working copy of the persisted record. Persisted after each step. */
type Working = Omit<
  { -readonly [K in keyof ChapterBuild]: ChapterBuild[K] },
  "scenes" | "diagnostics"
> & { scenes: MutableScene[]; diagnostics: BuildDiagnostic[] };

export class ChapterBuilder {
  private readonly repo: StoryRepository;
  private readonly models: ChapterBuildModels;
  private readonly grant: PermissionGrant;
  private readonly now: () => string;
  private readonly maxContextTokens: number;
  private readonly onProgress: ((build: ChapterBuild) => void) | undefined;
  /** Cooperative stop flags, checked between steps of a running loop. */
  private readonly pauseRequested = new Set<string>();
  private readonly cancelRequested = new Set<string>();
  /** Builds whose loop is executing in this process right now. */
  private readonly running = new Set<string>();

  constructor(options: ChapterBuilderOptions) {
    this.repo = options.repo;
    this.models = options.models;
    this.grant = options.grant;
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxContextTokens = options.maxContextTokens ?? 12_000;
    this.onProgress = options.onProgress;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** Create a build and run it until it finishes, pauses, or stops at a gate. */
  async start(options: StartBuildOptions): Promise<ChapterBuild> {
    const decision = checkPermission(
      { name: "build_chapter", permission: "edit_manuscript" },
      this.grant,
    );
    if (!decision.allowed) {
      throw new EditError("permission_denied", decision.reason, {
        details: { chapterId: options.chapterId },
      });
    }

    const chapter = (await this.repo.listChapters()).find((c) => c.id === options.chapterId);
    if (chapter === undefined) {
      throw new EditError("unknown_target", `No chapter exists with ID "${options.chapterId}".`);
    }

    const policy = options.approvalPolicy ?? "auto_until_error";

    // §15 (Phase 32): consume the approved plan directly. Targets, the pinned
    // version and the plan's constraints all come off the plan; the scene
    // records themselves were materialised when the writer approved it.
    const plan = await this.repo.plans.get(chapter.id as string);
    const planTargets: Record<string, SceneLengthTarget> = {};
    const planConstraints: string[] = [];
    let planPin: { planId: string; planVersion: number } | null = null;
    if (plan !== null && plan.status === "approved") {
      planPin = { planId: plan.id, planVersion: plan.approvedVersion ?? plan.version };
      for (const planned of plan.scenes) {
        if (planned.sceneId !== undefined && planned.targetWords !== undefined) {
          planTargets[planned.sceneId] = planned.targetWords;
        }
      }
      const facts = new Map(
        (await this.repo.listFacts()).map((fact) => [fact.id as string, fact.statement]),
      );
      for (const forbidden of plan.forbiddenFacts) {
        const statement = facts.get(forbidden.factId) ?? forbidden.factId;
        planConstraints.push(
          `${forbidden.characterId === undefined ? "No character" : forbidden.characterId} may come to understand: "${statement}"${forbidden.reason === undefined ? "" : ` (${forbidden.reason})`}. Do not reveal, imply or let dialogue confirm it.`,
        );
      }
      planConstraints.push(...plan.constraints);
    }
    const task = createTask({
      id: await this.repo.agents.nextTaskId(),
      goal: `build_chapter: ${chapter.title}`,
      now: this.now(),
      scope: [chapter.id as string, chapter.filePath],
      allowedTools: [],
      approvalPolicy: policy === "auto_until_error" ? "approve_destructive" : "approve_every_edit",
    });
    await this.repo.agents.saveTask(task);
    await this.repo.agents.saveTask(transition(task, "running", { now: this.now() }));

    const build: Working = {
      id: await this.repo.chapterBuilds.nextId(),
      chapterId: chapter.id as string,
      chapterTitle: chapter.title,
      branchId: options.branchId ?? "main",
      status: "planning",
      createdAt: this.now(),
      updatedAt: this.now(),
      requestedBy: "human",
      taskId: task.id,
      approvalPolicy: policy,
      autoConfirmObjective: options.autoConfirmObjective ?? policy === "auto_until_error",
      modelAssignments: this.assignments(),
      maxRevisions: options.maxRevisions ?? 1,
      maxContinuations: options.maxContinuations ?? 3,
      ...(options.researchGapPolicy !== undefined
        ? { researchGapPolicy: options.researchGapPolicy }
        : {}),
      targets: { ...planTargets, ...options.targets },
      ...(planPin !== null ? { ...planPin } : {}),
      ...(planConstraints.length > 0 ? { planConstraints } : {}),
      currentStep: "validate_prerequisites",
      scenes: [],
      diagnostics: [],
      usage: EMPTY_COST,
      resumeCount: 0,
    };

    if (plan !== null && plan.status !== "approved") {
      this.note(
        build,
        "info",
        "validate_prerequisites",
        `a ${plan.status} plan exists for this chapter but only an approved plan is consumed; building from the scene records alone`,
      );
    }
    await this.persist(build);
    return this.runLoop(build);
  }

  /** Continue a paused or failed build from exactly where it stopped (§11, §18). */
  async resume(buildId: string): Promise<ChapterBuild> {
    const build = await this.load(buildId);
    if (!isBuildResumable(build.status)) {
      throw new EditError("unknown_target", `${buildId} is ${build.status}, not resumable.`, {
        details: { buildId, status: build.status },
      });
    }
    const working = this.working(build);
    working.status = statusForStep(working.currentStep);
    working.resumeCount += 1;
    delete working.failureReason;
    // A scene caught mid-draft when the process died or the provider failed
    // is put back in the queue. Nothing of it was committed — "drafting" at
    // rest with no held draft always means an interrupted call — and without
    // this it would be skipped silently, the one thing a resume must never
    // do. A "drafting" scene *with* a held draft is different: the draft
    // survived (a pause between draft and commit), and commits as it stands.
    for (const scene of working.scenes) {
      if (scene.status === "drafting" && scene.draft === undefined) {
        scene.status = "pending";
      }
    }
    await this.persist(working);
    await this.log(working, "resume", `resumed at ${working.currentStep}`);
    return this.runLoop(working);
  }

  /** Answer the pending gate with yes, and carry on. */
  async approve(buildId: string): Promise<ChapterBuild> {
    const build = await this.load(buildId);
    if (build.status !== "awaiting_approval" || build.pending === undefined) {
      throw new EditError("unknown_target", `${buildId} is not waiting for approval.`, {
        details: { buildId, status: build.status },
      });
    }
    const working = this.working(build);
    delete working.pending;
    if (working.currentStep === "approve_plan") working.currentStep = "draft_scene";
    else if (working.currentStep === "approve_scene") working.currentStep = "commit_scene";
    else if (working.currentStep === "assemble_chapter") working.currentStep = "final_build";
    working.status = statusForStep(working.currentStep);
    await this.persist(working);
    await this.log(working, "approve", `approved; continuing at ${working.currentStep}`);
    return this.runLoop(working);
  }

  /**
   * Answer the pending gate with no.
   *
   * A held draft is discarded — it never reached the manuscript. The build
   * pauses rather than dies, because "not this draft" is not "stop building":
   * resume drafts the scene again.
   */
  async rejectPending(buildId: string, reason?: string): Promise<ChapterBuild> {
    const build = await this.load(buildId);
    if (build.status !== "awaiting_approval" || build.pending === undefined) {
      throw new EditError("unknown_target", `${buildId} is not waiting for approval.`, {
        details: { buildId, status: build.status },
      });
    }
    const working = this.working(build);
    const sceneId = working.pending?.sceneId;
    delete working.pending;
    if (sceneId !== undefined) {
      const scene = this.sceneRecord(working, sceneId);
      delete scene.draft;
      scene.status = "pending";
      working.currentStep = "draft_scene";
    }
    working.status = "paused";
    this.note(
      working,
      "info",
      working.currentStep,
      `declined: ${reason ?? "no reason given"}`,
      sceneId,
    );
    await this.persist(working);
    await this.log(working, "reject", reason ?? "declined at the gate");
    return working;
  }

  /** Ask a running build to stop after the step it is on. */
  requestPause(buildId: string): void {
    this.pauseRequested.add(buildId);
  }

  /**
   * Cancel a build (§12): committed work is kept — it is ordinary history —
   * staged work is discarded, the project is left valid, and the cancellation
   * is recorded. A cancelled build never runs again.
   */
  async cancel(buildId: string): Promise<ChapterBuild> {
    if (this.running.has(buildId)) {
      this.cancelRequested.add(buildId);
      const current = await this.load(buildId);
      return current;
    }
    const build = await this.load(buildId);
    if (isBuildFinished(build.status)) return build;
    const working = this.working(build);
    this.discardStaged(working);
    working.status = "cancelled";
    delete working.pending;
    this.note(working, "info", working.currentStep, "cancelled by the writer");
    await this.persist(working);
    await this.log(working, "cancel", "cancelled; committed scenes kept, staged draft discarded");
    await this.closeTask(working, "cancelled");
    return working;
  }

  async get(buildId: string): Promise<ChapterBuild | null> {
    return this.repo.chapterBuilds.get(buildId);
  }

  async list(): Promise<ChapterBuildSummary[]> {
    return this.repo.chapterBuilds.list();
  }

  // ── The pipeline loop ────────────────────────────────────────────────────

  /**
   * Run steps until the build finishes, pauses, fails, or reaches a gate.
   *
   * One switch, one step per iteration, one persist per step. The loop never
   * decides anything a step did not record: after a crash, replaying from
   * `currentStep` reaches the same place.
   */
  private async runLoop(build: Working): Promise<ChapterBuild> {
    this.running.add(build.id);
    try {
      for (;;) {
        if (this.cancelRequested.delete(build.id)) {
          this.discardStaged(build);
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
          // §18: surface exactly where it stopped. The step and scene are on
          // the record; resume retries from the same step.
          const reason = cause instanceof Error ? cause.message : String(cause);
          build.status = "failed";
          build.failureReason = `${build.currentStep}${
            build.currentSceneId === undefined ? "" : ` (${build.currentSceneId})`
          }: ${reason}`;
          this.note(
            build,
            "error",
            build.currentStep,
            cause instanceof ModelError ? `provider failure: ${reason}` : reason,
            build.currentSceneId,
          );
          await this.persist(build);
          await this.log(build, "fail", build.failureReason);
          return build;
        }
      }
    } finally {
      this.running.delete(build.id);
    }
  }

  /** Execute the current step. Returns "stop" when the loop should hand back. */
  private async step(build: Working): Promise<"continue" | "stop"> {
    switch (build.currentStep) {
      case "validate_prerequisites":
        return this.stepPrerequisites(build);
      case "plan_scenes":
        return this.stepPlan(build);
      case "approve_plan":
        return this.gate(build, "Build these scenes?", undefined);
      case "draft_scene":
        return this.stepDraft(build);
      case "approve_scene":
        return this.gate(
          build,
          `Keep the drafted ${build.currentSceneId ?? "scene"}?`,
          build.currentSceneId,
        );
      case "commit_scene":
        return this.stepCommit(build);
      case "extract_state":
        return this.stepExtract(build);
      case "validate_scene":
        return this.stepValidate(build);
      case "check_coverage":
        return this.stepCoverage(build);
      case "revise_scene":
        return this.stepRevise(build);
      case "checkpoint":
        return this.stepCheckpoint(build);
      case "assemble_chapter":
        return this.stepAssemble(build);
      case "final_build":
        return this.stepFinal(build);
      case "done":
        return "stop";
    }
  }

  /**
   * §1–2 of the pipeline: the chapter is real, its file exists, its scenes are
   * assigned, and every planned scene has a marker so its prose has an exact
   * address. Missing markers are appended in scene order as one ordinary
   * change set — the file stays a plain, portable Markdown document.
   */
  private async stepPrerequisites(build: Working): Promise<"continue" | "stop"> {
    build.status = "planning";
    const { chapter, scenes } = await this.chapterAndScenes(build);
    if (scenes.length === 0) {
      throw new EditError(
        "unknown_target",
        `${chapter.title} has no scenes assigned, so there is no plan to build from. Add scenes to the chapter first.`,
      );
    }
    const unplanned = scenes.filter((scene) => scene.title.trim() === "");
    if (unplanned.length > 0) {
      throw new EditError(
        "unknown_target",
        `${String(unplanned.length)} scene(s) in ${chapter.title} have no title. A build needs to know what each scene is.`,
      );
    }

    const file = (await this.repo.readProjectFile(chapter.filePath)) ?? "";
    const spans = new Set(listSceneSpans(file).map((span) => span.sceneId));
    const missing = scenes.filter((scene) => !spans.has(scene.id as string));
    if (missing.length > 0) {
      const markers = missing.map((scene) => sceneMarker(scene.id as string)).join("\n\n");
      const separator =
        file === "" || file.endsWith("\n\n") ? "" : file.endsWith("\n") ? "\n" : "\n\n";
      await this.repo
        .beginTransaction(`Prepare ${chapter.title} for building`)
        .writeFile(chapter.filePath, `${file}${separator}${markers}\n`)
        .commit(`Prepare ${chapter.title} for building`, {
          actor: "agent",
          operation: "build_chapter",
          taskId: build.taskId,
        });
    }

    // Phase 35 §20–21: unresolved research placeholders are a declared
    // dependency, not prose. They never trigger research automatically — the
    // policy decides whether the build waits for it or carries them along.
    const gaps = [
      ...findResearchPlaceholders(file),
      ...scenes.flatMap((scene) => findResearchPlaceholders(scene.purpose.join("\n"))),
    ];
    if (gaps.length > 0) {
      const questions = [...new Set(gaps.map((gap) => gap.question))];
      if (build.researchGapPolicy === "pause") {
        build.status = "paused";
        this.note(
          build,
          "warning",
          "validate_prerequisites",
          `paused: ${String(questions.length)} research question(s) unresolved in ${chapter.title} — ${questions.join("; ")}. Research them (the Research panel collects placeholders), then resume.`,
        );
        await this.log(build, "research_gap", questions.join("; "));
        return "stop";
      }
      this.note(
        build,
        "info",
        "validate_prerequisites",
        `${String(questions.length)} research question(s) unresolved in ${chapter.title}: ${questions.join("; ")}. Building with the placeholders in place.`,
      );
    }

    // §13: the pre-build checkpoint. The whole build reverts here in one move.
    const checkpoint = await this.repo.createCheckpoint(`Before building ${chapter.title}`);
    build.checkpointId = checkpoint.id;
    build.currentStep = "plan_scenes";
    return "continue";
  }

  /**
   * §2: fix the scene sequence. A scene whose span already holds prose is
   * recorded as committed-before-the-build — a half-written chapter builds its
   * remaining scenes rather than overwriting a writer's work.
   */
  private async stepPlan(build: Working): Promise<"continue"> {
    const { chapter, scenes } = await this.chapterAndScenes(build);
    const file = (await this.repo.readProjectFile(chapter.filePath)) ?? "";
    const spans = new Map(listSceneSpans(file).map((span) => [span.sceneId, span]));

    build.scenes = scenes.map((scene): MutableScene => {
      const span = spans.get(scene.id as string);
      const existing = span === undefined ? "" : file.slice(span.start, span.end).trim();
      const target = build.targets[scene.id as string];
      return {
        sceneId: scene.id as string,
        title: scene.title,
        status: existing === "" ? "pending" : "committed",
        beats: scene.purpose,
        ...(target !== undefined ? { target } : {}),
        attempts: 0,
        calls: 0,
        ...(existing === ""
          ? {}
          : { words: countWords(existing), reason: "already written before this build" }),
      };
    });

    if (build.scenes.every((scene) => scene.status === "committed")) {
      this.note(build, "info", "plan_scenes", "every scene already has prose; nothing to draft");
      build.currentStep = "assemble_chapter";
      return "continue";
    }

    build.currentStep =
      build.approvalPolicy === "auto_until_error" ? "draft_scene" : "approve_plan";
    return "continue";
  }

  /** Stop at a gate. The question is persisted; the answer arrives via approve(). */
  private async gate(
    build: Working,
    question: string,
    sceneId: string | undefined,
  ): Promise<"stop"> {
    build.status = "awaiting_approval";
    build.pending = {
      question,
      ...(sceneId !== undefined ? { sceneId } : {}),
      raisedAt: this.now(),
    };
    await this.log(build, "gate", question);
    return "stop";
  }

  /**
   * §3–5: draft one scene from freshly compiled context.
   *
   * The context is compiled *now*, from the project as it currently stands —
   * never from a snapshot taken when the build started — so everything already
   * committed, including the writer's own edits, is what this scene grows from.
   * A draft shorter than its plan's minimum is continued from its exact
   * endpoint in bounded steps, never regenerated from scratch.
   */
  private async stepDraft(build: Working): Promise<"continue"> {
    const record = this.nextPending(build);
    if (record === null) {
      build.currentStep = "assemble_chapter";
      delete build.currentSceneId;
      return "continue";
    }

    build.status = "drafting";
    build.currentSceneId = record.sceneId;
    record.status = "drafting";
    record.startedAt = this.now();
    record.attempts += 1;

    const pkg = await this.compileScene(record.sceneId, `Draft ${record.sceneId} from its plan.`);
    const beats =
      record.beats.length === 0
        ? ""
        : `\n\nThe scene's planned beats:\n${record.beats.map((b) => `- ${b}`).join("\n")}`;
    const lengthNote = describeTarget(record.target);
    const constraints =
      build.planConstraints === undefined || build.planConstraints.length === 0
        ? ""
        : `\n\nHard constraints from the approved plan — these override everything else:\n${build.planConstraints.map((c) => `- ${c}`).join("\n")}`;

    const proposed = await this.callModel(build, "premium_prose", {
      system: EDITOR_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: renderContextPackage(pkg) },
        {
          role: "user",
          content: `Write the prose for ${record.sceneId} ("${record.title}") in full, working from its structured purpose and the compiled context. This scene has no prose yet — you are drafting it, not editing it.${beats}${constraints}${lengthNote}\n\n${RESPONSE_FORMAT}`,
        },
      ],
    });
    let text = validateProposalText(proposed.text, "", { operation: "build_chapter" });
    record.calls += 1;

    // §5: continuation. If the draft stops short of the plan's minimum, ask for
    // more from the exact endpoint — inspecting what exists, never repeating it.
    const minWords = record.target?.minWords;
    const maxContinuations = build.maxContinuations;
    let continuations = 0;
    while (
      minWords !== undefined &&
      countWords(text) < minWords &&
      continuations < maxContinuations
    ) {
      continuations += 1;
      const more = await this.callModel(build, "premium_prose", {
        system: EDITOR_SYSTEM_PROMPT,
        messages: [
          { role: "user", content: renderContextPackage(pkg) },
          {
            role: "user",
            content: `The draft of ${record.sceneId} is incomplete. It currently ends:\n\n…${tail(
              text,
              1_500,
            )}\n\nContinue from exactly that point. Do not restate or summarise anything already written. Cover the remaining planned beats.${beats}\n\n${RESPONSE_FORMAT}`,
          },
        ],
      });
      const continuation = validateProposalText(more.text, "", { operation: "build_chapter" });
      record.calls += 1;
      text = `${text.replace(/\s+$/, "")}\n\n${continuation}`;
    }
    if (minWords !== undefined && countWords(text) < minWords) {
      this.note(
        build,
        "warning",
        "draft_scene",
        `draft is ${String(countWords(text))} words against a minimum of ${String(minWords)} after ${String(continuations)} continuation(s)`,
        record.sceneId,
      );
    }
    const maxWords = record.target?.maxWords;
    if (maxWords !== undefined && countWords(text) > maxWords) {
      // Over-length is reported, never truncated: cutting a scene mid-sentence
      // to satisfy a number is exactly the kind of harm §4 rules out.
      this.note(
        build,
        "warning",
        "draft_scene",
        `draft is ${String(countWords(text))} words against a maximum of ${String(maxWords)}; left intact for review`,
        record.sceneId,
      );
    }

    record.draft = text;
    record.words = countWords(text);
    await this.log(
      build,
      "draft",
      `${record.sceneId}: ${String(record.words)} words in ${String(record.calls)} call(s)`,
    );

    if (build.approvalPolicy === "every_scene") {
      record.status = "awaiting_approval";
      build.currentStep = "approve_scene";
    } else {
      build.currentStep = "commit_scene";
    }
    return "continue";
  }

  /**
   * §15: commit the held draft into the chapter file as one ordinary change
   * set, with full AI provenance. The range is resolved against the file as it
   * is *now* — if the writer edited the chapter while a gate was open, the
   * splice lands in the current text or fails loudly, never in a stale copy.
   */
  private async stepCommit(build: Working): Promise<"continue"> {
    const record = this.currentScene(build);
    const draft = record.draft;
    if (draft === undefined) {
      throw new EditError("unknown_target", `${record.sceneId} has no held draft to commit.`);
    }
    const { chapter, scenes } = await this.chapterAndScenes(build);
    const file = (await this.repo.readProjectFile(chapter.filePath)) ?? "";
    const resolved = resolveSceneRange(file, record.sceneId, {
      chapterSceneIds: scenes.map((scene) => scene.id as string),
      mode: "replace",
    });
    if (!resolved.ok) {
      throw new EditError("unresolvable_range", resolved.reason, {
        details: { sceneId: record.sceneId },
      });
    }

    const body = `\n${draft}\n\n`;
    const after = file.slice(0, resolved.start) + body + file.slice(resolved.end);
    const change = await this.repo
      .beginTransaction(`Draft ${record.sceneId} (${build.id})`)
      .writeFile(chapter.filePath, after)
      .commit(`Draft ${record.sceneId} — ${record.title}`, {
        actor: "agent",
        operation: "build_chapter",
        taskId: build.taskId,
        modelId: this.models.drafting.id,
        ai: {
          operation: "build_chapter",
          targetId: record.sceneId,
          instruction: `Draft ${record.sceneId} from its plan (build ${build.id})`,
          contextRecipe: "scene_rewrite",
          contextTokens: 0,
          modelId: this.models.drafting.id,
          taskId: build.taskId,
          approval: build.approvalPolicy === "every_scene" ? "accepted" : "accepted",
          approvedAt: this.now(),
          acceptedHunks: 1,
          offeredHunks: 1,
        },
      });

    record.changeSetId = change.id;
    delete record.draft;
    record.status = "extracting";
    build.currentStep = "extract_state";
    await this.log(build, "commit", `${record.sceneId} committed as ${change.id}`);
    return "continue";
  }

  /**
   * §6: what did the scene change? Extraction goes through the existing
   * StateExtractor, so everything lands as `proposed` under the ordinary canon
   * rules. Objective, high-confidence kinds may then auto-confirm — and only
   * those, and only if the writer switched it on.
   */
  private async stepExtract(build: Working): Promise<"continue"> {
    const record = this.currentScene(build);
    if (this.models.analysis === undefined) {
      this.note(
        build,
        "info",
        "extract_state",
        "skipped — no analysis model configured; state changes were not extracted",
        record.sceneId,
      );
      record.status = "validating";
      build.currentStep = "validate_scene";
      return "continue";
    }

    const extractor = new StateExtractor({
      repo: this.repo,
      model: this.models.analysis,
      grant: this.grant,
      now: this.now,
      maxContextTokens: this.maxContextTokens,
    });
    const proposal = await extractor.analyseScene(record.sceneId);
    this.count(build, "cheap_analysis", 1);
    record.transitionsProposed = proposal.transitions.length;

    let confirmed = 0;
    if (build.autoConfirmObjective && proposal.transitions.length > 0) {
      const stored = (await this.repo.listStateTransitions()).filter(
        (t) => t.sceneId === record.sceneId && t.confirmationStatus === "proposed",
      );
      for (const t of stored) {
        const draft = proposal.transitions.find(
          (p) => p.kind === t.kind && p.subjectId === t.subjectId && p.value === t.value,
        );
        if (
          draft !== undefined &&
          OBJECTIVE_KINDS.includes(t.kind) &&
          draft.confidence >= AUTO_CONFIRM_CONFIDENCE
        ) {
          await this.repo.setTransitionStatus(t.id as string, "confirmed");
          confirmed += 1;
        }
      }
    }
    record.transitionsConfirmed = confirmed;
    await this.log(
      build,
      "extract",
      `${record.sceneId}: ${String(proposal.transitions.length)} proposed, ${String(confirmed)} objective auto-confirmed`,
    );

    record.status = "validating";
    build.currentStep = "validate_scene";
    return "continue";
  }

  /**
   * §7: deterministic validation before continuing. The whole rule set runs —
   * referential integrity, knowledge continuity, object and location
   * continuity, hard rules, story tests — because it already exists and is
   * cheap. Errors pause the build; warnings are recorded and it carries on.
   */
  private async stepValidate(build: Working): Promise<"continue" | "stop"> {
    build.status = "validating";
    const record = this.currentScene(build);
    const result = await this.repo.buildStory({ persist: false });
    const errors = result.diagnostics.filter((d) => d.severity === "error");
    const warnings = result.diagnostics.filter((d) => d.severity === "warning");

    for (const warning of warnings.slice(0, 5)) {
      this.note(build, "warning", "validate_scene", warning.message, record.sceneId);
    }
    if (errors.length > 0) {
      for (const error of errors.slice(0, 5)) {
        this.note(build, "error", "validate_scene", error.message, record.sceneId);
      }
      build.status = "paused";
      this.note(
        build,
        "error",
        "validate_scene",
        `paused: ${String(errors.length)} error(s) after ${record.sceneId}. Fix the project, then resume.`,
        record.sceneId,
      );
      await this.log(build, "validate", `paused on ${String(errors.length)} error(s)`);
      return "stop";
    }

    build.currentStep = "check_coverage";
    return "continue";
  }

  /**
   * §8: did the scene do what the plan said? This is semantic judgement by a
   * model, and every item it returns is labelled `source: "model"` — it is
   * never treated as a deterministic check, and it never becomes canon.
   */
  private async stepCoverage(build: Working): Promise<"continue" | "stop"> {
    const record = this.currentScene(build);
    if (record.beats.length === 0 || this.models.analysis === undefined) {
      if (record.beats.length > 0) {
        this.note(
          build,
          "info",
          "check_coverage",
          "skipped — no analysis model configured; plan coverage was not checked",
          record.sceneId,
        );
      }
      record.status = "committed";
      record.finishedAt = this.now();
      build.currentStep = "checkpoint";
      return "continue";
    }

    const prose = await this.sceneProse(build, record.sceneId);
    const result = await this.models.analysis.generateStructured(
      {
        system:
          "You compare a drafted fiction scene against its planned beats. Judge only whether each beat happens in the prose. Be strict: a beat merely implied offstage is not met.",
        messages: [
          {
            role: "user",
            content: `THE PLANNED BEATS\n${record.beats.map((b) => `- ${b}`).join("\n")}\n\nTHE DRAFTED SCENE\n${prose}\n\nReply with JSON only: {"beats":[{"beat":"…","met":true,"note":"one sentence of evidence"}]} — one entry per planned beat, in order.`,
          },
        ],
        schema: COVERAGE_SCHEMA,
        maxOutputTokens: 1_500,
      },
      { timeoutMs: 120_000 },
    );
    this.count(build, "cheap_analysis", 1);

    record.coverage = result.beats.map((beat): PlanCoverageItem => ({ ...beat, source: "model" }));
    const unmet = record.coverage.filter((beat) => !beat.met);
    await this.log(
      build,
      "coverage",
      `${record.sceneId}: ${String(record.coverage.length - unmet.length)}/${String(record.coverage.length)} beats met`,
    );

    if (unmet.length === 0) {
      record.status = "committed";
      record.finishedAt = this.now();
      build.currentStep = "checkpoint";
      return "continue";
    }

    // §9: a bounded repair loop, never an open one.
    if (record.attempts <= build.maxRevisions) {
      build.currentStep = "revise_scene";
      return "continue";
    }
    build.status = "paused";
    this.note(
      build,
      "warning",
      "check_coverage",
      `paused: ${String(unmet.length)} planned beat(s) unmet after ${String(record.attempts)} attempt(s): ${unmet
        .map((beat) => beat.beat)
        .join("; ")}`,
      record.sceneId,
    );
    return "stop";
  }

  /** §9: one revision pass against the unmet beats, committed like any edit. */
  private async stepRevise(build: Working): Promise<"continue"> {
    build.status = "revising";
    const record = this.currentScene(build);
    record.status = "revising";
    record.attempts += 1;
    const unmet = (record.coverage ?? []).filter((beat) => !beat.met);

    const pkg = await this.compileScene(
      record.sceneId,
      `Revise ${record.sceneId} to cover its unmet planned beats.`,
    );
    const prose = await this.sceneProse(build, record.sceneId);
    const proposed = await this.callModel(build, "premium_prose", {
      system: EDITOR_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: renderContextPackage(pkg) },
        {
          role: "user",
          content: `The scene as currently drafted:\n\n${prose}\n\nRevise it so these planned beats actually happen on the page, keeping everything that already works:\n${unmet
            .map((beat) => `- ${beat.beat}`)
            .join("\n")}\n\n${RESPONSE_FORMAT}`,
        },
      ],
    });
    const text = validateProposalText(proposed.text, prose, { operation: "build_chapter" });
    record.calls += 1;

    const { chapter, scenes } = await this.chapterAndScenes(build);
    const file = (await this.repo.readProjectFile(chapter.filePath)) ?? "";
    const resolved = resolveSceneRange(file, record.sceneId, {
      chapterSceneIds: scenes.map((scene) => scene.id as string),
      mode: "replace",
    });
    if (!resolved.ok) {
      throw new EditError("unresolvable_range", resolved.reason);
    }
    const after = `${file.slice(0, resolved.start)}\n${text}\n\n${file.slice(resolved.end)}`;
    const change = await this.repo
      .beginTransaction(`Revise ${record.sceneId} (${build.id})`)
      .writeFile(chapter.filePath, after)
      .commit(`Revise ${record.sceneId} — unmet beats`, {
        actor: "agent",
        operation: "build_chapter",
        taskId: build.taskId,
        modelId: this.models.drafting.id,
      });
    record.changeSetId = change.id;
    record.words = countWords(text);
    await this.log(build, "revise", `${record.sceneId} revised as ${change.id}`);

    build.currentStep = "validate_scene";
    return "continue";
  }

  /** §13: a revertible point after every committed scene. */
  private async stepCheckpoint(build: Working): Promise<"continue"> {
    const record = this.currentScene(build);
    const checkpoint = await this.repo.createCheckpoint(`After ${record.sceneId} (${build.id})`);
    record.checkpointId = checkpoint.id;
    delete build.currentSceneId;
    build.currentStep = "draft_scene";
    build.status = "drafting";
    return "continue";
  }

  /** Chapter-level assembly checks. The prose is already in place — one file, one manuscript. */
  private async stepAssemble(build: Working): Promise<"continue" | "stop"> {
    const { chapter } = await this.chapterAndScenes(build);
    const file = (await this.repo.readProjectFile(chapter.filePath)) ?? "";
    const committed = build.scenes.filter((scene) => scene.status === "committed");
    this.note(
      build,
      "info",
      "assemble_chapter",
      `${chapter.title}: ${String(committed.length)}/${String(build.scenes.length)} scenes, ${String(countWords(file))} words`,
    );
    if (build.approvalPolicy === "every_chapter" && build.pending === undefined) {
      return this.gate(build, `Keep the built ${chapter.title}?`, undefined);
    }
    build.currentStep = "final_build";
    return "continue";
  }

  /** §2's tail: the Story Compiler and the story tests, recorded on the build. */
  private async stepFinal(build: Working): Promise<"stop"> {
    build.status = "validating";
    const result = await this.repo.buildStory();
    const tests = await this.repo.runStoryTests();
    build.finalBuildId = result.id;
    build.finalBuildErrors = result.diagnostics.filter((d) => d.severity === "error").length;
    build.finalTestFailures = tests.deterministic.failed + tests.errored;
    if (build.finalBuildErrors > 0 || build.finalTestFailures > 0) {
      this.note(
        build,
        "warning",
        "final_build",
        `finished with ${String(build.finalBuildErrors)} build error(s) and ${String(build.finalTestFailures)} failing test(s) — see Story Build`,
      );
    }
    const checkpoint = await this.repo.createCheckpoint(
      `Built ${build.chapterTitle} (${build.id})`,
    );
    this.note(build, "info", "final_build", `finished; checkpoint ${checkpoint.id}`);
    build.currentStep = "done";
    build.status = "completed";
    await this.log(build, "complete", `chapter built; Story Build ${result.id}`);
    await this.closeTask(build, "completed");
    return "stop";
  }

  // ── Support ──────────────────────────────────────────────────────────────

  private async chapterAndScenes(build: Working): Promise<{ chapter: Chapter; scenes: Scene[] }> {
    const chapter = (await this.repo.listChapters()).find((c) => c.id === build.chapterId);
    if (chapter === undefined) {
      throw new EditError("unknown_target", `Chapter ${build.chapterId} no longer exists.`);
    }
    const scenes = (await this.repo.listScenes()).filter((s) => s.chapterId === chapter.id);
    return { chapter, scenes };
  }

  private async compileScene(sceneId: string, instruction: string) {
    const compiler = new ContextCompiler(this.repo, { now: this.now });
    return compiler.compile({
      recipe: "scene_rewrite",
      targetId: sceneId,
      instruction,
      budget: { maxTokens: this.maxContextTokens, reserveForOutput: 4_000 },
    });
  }

  private async sceneProse(build: Working, sceneId: string): Promise<string> {
    const { chapter, scenes } = await this.chapterAndScenes(build);
    const file = (await this.repo.readProjectFile(chapter.filePath)) ?? "";
    const resolved = resolveSceneRange(file, sceneId, {
      chapterSceneIds: scenes.map((scene) => scene.id as string),
      mode: "replace",
    });
    if (!resolved.ok) throw new EditError("unresolvable_range", resolved.reason);
    return file.slice(resolved.start, resolved.end).trim();
  }

  private async callModel(
    build: Working,
    cls: RoutingClass,
    request: {
      system: string;
      messages: { role: "user"; content: string }[];
    },
  ) {
    const result = await this.models.drafting.generateStructured(
      {
        system: request.system,
        messages: request.messages,
        schema: PROPOSAL_SCHEMA,
        maxOutputTokens: 8_000,
      },
      { timeoutMs: 240_000 },
    );
    this.count(build, cls, 1);
    return result;
  }

  private count(build: Working, cls: RoutingClass, calls: number): void {
    const byClass = { ...build.usage.byClass };
    const entry = byClass[cls] ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
    byClass[cls] = { ...entry, calls: entry.calls + calls };
    build.usage = {
      byClass,
      calls: build.usage.calls + calls,
      inputTokens: build.usage.inputTokens,
      outputTokens: build.usage.outputTokens,
    } as RunCost;
  }

  private assignments(): Readonly<Partial<Record<RoutingClass, string>>> {
    return {
      premium_prose: this.models.drafting.id,
      ...(this.models.analysis !== undefined ? { cheap_analysis: this.models.analysis.id } : {}),
    };
  }

  private nextPending(build: Working): MutableScene | null {
    return build.scenes.find((scene) => scene.status === "pending") ?? null;
  }

  private currentScene(build: Working): MutableScene {
    const id = build.currentSceneId;
    if (id === undefined) {
      throw new EditError(
        "unknown_target",
        `${build.id} has no current scene at ${build.currentStep}.`,
      );
    }
    return this.sceneRecord(build, id);
  }

  private sceneRecord(build: Working, sceneId: string): MutableScene {
    const record = build.scenes.find((scene) => scene.sceneId === sceneId);
    if (record === undefined) {
      throw new EditError("unknown_target", `${sceneId} is not part of build ${build.id}.`);
    }
    return record;
  }

  private discardStaged(build: Working): void {
    for (const scene of build.scenes) {
      if (scene.draft !== undefined) {
        delete scene.draft;
        if (scene.status !== "committed") scene.status = "failed";
      }
    }
  }

  private note(
    build: Working,
    severity: BuildDiagnostic["severity"],
    step: string,
    message: string,
    sceneId?: string,
  ): void {
    build.diagnostics.push({
      severity,
      step,
      ...(sceneId !== undefined ? { sceneId } : {}),
      message,
      at: this.now(),
    });
  }

  private working(build: ChapterBuild): Working {
    return {
      ...build,
      scenes: build.scenes.map((scene) => ({ ...scene })),
      diagnostics: [...build.diagnostics],
    };
  }

  private async load(buildId: string): Promise<ChapterBuild> {
    const build = await this.repo.chapterBuilds.get(buildId);
    if (build === null) {
      throw new EditError("unknown_target", `No chapter build "${buildId}".`);
    }
    return build;
  }

  private async persist(build: Working): Promise<void> {
    build.updatedAt = this.now();
    await this.repo.chapterBuilds.save(build);
    this.onProgress?.(build);
  }

  /** §19: every step in the ordinary agent activity log, under one task. */
  private async log(build: Working, step: string, summary: string): Promise<void> {
    await this.repo.agents.appendActivity({
      taskId: build.taskId,
      timestamp: this.now(),
      tool: `chapter_build.${step}`,
      argumentsSummary: `build=${build.id}, chapter=${build.chapterId}`,
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
      // A task already in a terminal state must not block finishing the build.
    }
  }
}

/** The step a resumed build re-enters, mapped to a visible status. */
function statusForStep(step: ChapterBuildStep): ChapterBuildStatus {
  switch (step) {
    case "validate_prerequisites":
    case "plan_scenes":
      return "planning";
    case "approve_plan":
    case "approve_scene":
      return "awaiting_approval";
    case "revise_scene":
      return "revising";
    case "validate_scene":
    case "final_build":
      return "validating";
    default:
      return "drafting";
  }
}

function describeTarget(target: SceneLengthTarget | undefined): string {
  if (target === undefined) return "";
  const parts: string[] = [];
  if (target.minWords !== undefined) parts.push(`at least ${String(target.minWords)} words`);
  if (target.maxWords !== undefined) parts.push(`at most ${String(target.maxWords)} words`);
  return parts.length === 0 ? "" : `\n\nLength: ${parts.join(", ")}.`;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

function tail(text: string, chars: number): string {
  return text.length <= chars ? text : text.slice(text.length - chars);
}
