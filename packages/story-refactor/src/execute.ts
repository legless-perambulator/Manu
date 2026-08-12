import {
  checkPermission,
  createTask,
  transition,
  type PermissionGrant,
} from "@jellytind/agent-runtime";
import type { Diagnostic } from "@jellytind/story-compiler";
import type { StagedTransaction, StoryRepository } from "@jellytind/story-repository";
import { analyseRefactor, describeRequest } from "./analyse";
import { applyReplacement, planRefactor } from "./plan";
import {
  RefactorError,
  snapshot,
  type PlanStep,
  type RefactorPlan,
  type RefactorRequest,
  type RefactorRun,
  type ValidationSnapshot,
} from "./types";

const REQUIRED_PERMISSION = "edit_manuscript" as const;

/**
 * A staged refactor, waiting for a decision.
 *
 * Nothing in the project has changed yet. The checkpoint is taken, the edits
 * are staged, and the build and the tests have already run — against a shadow
 * copy, so what the writer is looking at is a genuine forecast rather than a
 * fait accompli (docs/STORY_REFACTOR.md).
 */
export interface StagedRefactor {
  readonly run: RefactorRun;
  /** Apply it. Records exactly one change set. */
  commit(notes?: string): Promise<RefactorRun>;
  /** Walk away. The project was never touched. */
  discard(notes?: string): Promise<RefactorRun>;
}

export interface RefactorOptions {
  readonly repo: StoryRepository;
  readonly grant: PermissionGrant;
  readonly now?: () => string;
  /** Skip the checkpoint. Tests use this; a writer never should. */
  readonly checkpoint?: boolean;
}

/**
 * Analyse, plan, checkpoint, stage and validate — without committing.
 *
 * The order matters and is the whole product claim. A writer is shown what a
 * structural change would do to their novel *before* it does it, with the
 * compiler and their own story tests run against the result.
 */
export async function stageRefactor(
  request: RefactorRequest,
  options: RefactorOptions,
  plan?: RefactorPlan,
): Promise<StagedRefactor> {
  const { repo, grant } = options;
  const now = options.now ?? (() => new Date().toISOString());

  const decision = checkPermission(
    { name: "story_refactor", permission: REQUIRED_PERMISSION },
    grant,
  );
  if (!decision.allowed) {
    throw new RefactorError("validation_failed", decision.reason, { kind: request.kind });
  }

  const analysis = await analyseRefactor(repo, request);
  const finalPlan = plan ?? (await planRefactor(repo, request, analysis));

  const task = createTask({
    id: await repo.agents.nextTaskId(),
    goal: `story_refactor (${request.kind}): ${analysis.summary}`,
    now: now(),
    scope: [...analysis.targets],
    allowedTools: [],
    approvalPolicy: "approve_every_edit",
  });
  await repo.agents.saveTask(task);
  const running = await repo.agents.saveTask(transition(task, "running", { now: now() }));

  // ── Before ────────────────────────────────────────────────────────────────

  const [buildBefore, testsBefore] = await Promise.all([
    repo.buildStory({ persist: false }),
    repo.runStoryTests(),
  ]);
  const before = snapshot(buildBefore, testsBefore);

  // ── The safety net, taken before anything is staged ───────────────────────

  const checkpoint =
    options.checkpoint === false
      ? undefined
      : await repo.createCheckpoint(`Before refactor: ${analysis.summary}`);

  // ── Stage ─────────────────────────────────────────────────────────────────

  const tx = repo.beginTransaction(`Refactor: ${analysis.summary}`, {
    actor: "human",
    operation: `refactor_${request.kind}`,
    taskId: running.id,
  });
  await applyPlan(repo, tx, finalPlan);

  if (tx.isEmpty()) {
    throw new RefactorError("nothing_to_do", "The plan staged no changes.");
  }
  const stagedFiles = await tx.preview();

  // ── Validate against a shadow copy ────────────────────────────────────────

  const { build: buildAfter, tests: testsAfter } = await repo.validateStaged(tx);
  const after = snapshot(buildAfter, testsAfter);
  const introduced = introducedBy(before.diagnostics, after.diagnostics);

  const run: RefactorRun = {
    id: await repo.nextRefactorId(),
    status: introduced.some((d) => d.severity === "error") ? "failed_validation" : "staged",
    kind: request.kind,
    instruction: analysis.instruction,
    request,
    analysis,
    plan: finalPlan,
    createdAt: now(),
    modelIds: finalPlan.modelId === undefined ? [] : [finalPlan.modelId],
    ...(checkpoint !== undefined ? { checkpointId: checkpoint.id } : {}),
    stagedFiles,
    before,
    after,
    introduced,
  };
  await repo.saveRefactorRun(run);

  await repo.agents.appendActivity({
    taskId: running.id,
    timestamp: now(),
    tool: "story_refactor",
    argumentsSummary: analysis.summary,
    resultSummary: `${String(stagedFiles.length)} file(s) staged; ${String(introduced.length)} new diagnostic(s)`,
    status: introduced.some((d) => d.severity === "error") ? "failed" : "ok",
  });

  let settled = false;
  const settle = async (
    status: RefactorRun["status"],
    extra: Partial<RefactorRun>,
  ): Promise<RefactorRun> => {
    if (settled) {
      throw new RefactorError("not_staged", "This refactor has already been decided.");
    }
    settled = true;
    const next: RefactorRun = { ...run, status, ...extra };
    await repo.saveRefactorRun(next);
    await repo.agents.saveTask(
      transition(running, status === "committed" ? "completed" : "cancelled", { now: now() }),
    );
    return next;
  };

  return {
    run,
    /**
     * Commit is a decision, not a formality: a writer may accept a refactor
     * that introduced warnings, or even errors they intend to fix next. What
     * the system owes them is that they saw the errors first.
     */
    async commit(notes?: string): Promise<RefactorRun> {
      const change = await tx.commit(`Refactor: ${analysis.summary}`, {
        actor: "human",
        operation: `refactor_${request.kind}`,
        taskId: running.id,
        ...(finalPlan.modelId !== undefined ? { modelId: finalPlan.modelId } : {}),
      });
      return settle("committed", {
        approvedAt: now(),
        changeSetId: change.id,
        ...(notes !== undefined ? { notes } : {}),
      });
    },

    async discard(notes?: string): Promise<RefactorRun> {
      tx.discard();
      return settle("discarded", notes === undefined ? {} : { notes });
    },
  };
}

/**
 * The order steps are applied in.
 *
 * Sentence rewrites go first, then blanket substitutions. Both act on the same
 * prose, and a rewrite quotes the file as it stands *now* — run the
 * substitution first and every quotation stops matching, so the specific edit
 * is silently dropped in favour of the general one. Specific before general.
 */
const STEP_ORDER: Readonly<Record<PlanStep["kind"], number>> = {
  rewrite_passage: 0,
  replace_text: 1,
  update_entity: 2,
  move_scene: 3,
  manual: 4,
};

/** Turn plan steps into staged file writes. Nothing here touches the project. */
async function applyPlan(
  repo: StoryRepository,
  tx: StagedTransaction,
  plan: RefactorPlan,
): Promise<void> {
  const ordered = [...plan.steps].sort((a, b) => STEP_ORDER[a.kind] - STEP_ORDER[b.kind]);
  for (const step of ordered) {
    switch (step.kind) {
      case "update_entity":
        await repo.stageEntityUpdate(tx, step.entityId, step.patch);
        break;

      case "move_scene":
        await repo.stageEntityUpdate(tx, step.sceneId, {
          chapterId: step.toChapterId,
        } as Record<string, unknown>);
        break;

      case "replace_text": {
        const text = await tx.readFile(step.path);
        if (text === null) break;
        tx.writeFile(step.path, applyReplacement(text, step.find, step.replace));
        break;
      }

      case "rewrite_passage": {
        // The planner verified the excerpt appears exactly once before making
        // the step. Verified again here, because the file may have moved
        // between planning and staging, and a near-miss replacement is worse
        // than none.
        const text = await tx.readFile(step.path);
        if (text === null) break;
        if (text.split(step.excerpt).length - 1 !== 1) break;
        tx.writeFile(step.path, text.replace(step.excerpt, step.instruction));
        break;
      }

      case "manual":
        // Deliberately nothing. It is on the plan so the writer sees it.
        break;
    }
  }
}

/**
 * Diagnostics present after but not before.
 *
 * By fingerprint, so a reworded message is not a new problem and a genuinely
 * new one is never hidden behind an old one (docs/STORY_COMPILER.md).
 */
export function introducedBy(
  before: readonly Diagnostic[],
  after: readonly Diagnostic[],
): Diagnostic[] {
  const known = new Set(before.map((d) => d.id));
  return after.filter((d) => !known.has(d.id));
}

/** Whether validation found something that should stop a writer. */
export function failedValidation(run: {
  introduced: readonly Diagnostic[];
  before?: ValidationSnapshot;
  after?: ValidationSnapshot;
}): boolean {
  if (run.introduced.some((d) => d.severity === "error")) return true;
  const before = run.before;
  const after = run.after;
  if (before === undefined || after === undefined) return false;
  // A test that passed before and does not now is a failure the writer set.
  return after.failedTestIds.some((id) => !before.failedTestIds.includes(id));
}

export { describeRequest };
