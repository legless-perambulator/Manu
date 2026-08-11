import {
  checkPermission,
  createTask,
  transition,
  type PermissionGrant,
} from "@jellytind/agent-runtime";
import {
  ContextCompiler,
  renderContextPackage,
  type ContextPackage,
  type RecipeName,
} from "@jellytind/context-compiler";
import { ModelError, type LanguageModel } from "@jellytind/model-router";
import {
  applyHunks,
  buildHunks,
  computeLineDiff,
  resolveSceneRange,
  type AiProvenance,
  type StagedTransaction,
  type StoryRepository,
} from "@jellytind/story-repository";
import { PROPOSAL_SCHEMA, RESPONSE_FORMAT, validateProposalText } from "./proposal-schema";
import {
  continueSceneTask,
  EDITOR_SYSTEM_PROMPT,
  sceneRewriteTask,
  selectionTask,
} from "./prompts";
import {
  EditError,
  type AcceptOptions,
  type AcceptResult,
  type EditProposal,
  type EditRequest,
  type ProposalContextInfo,
  type TextRange,
} from "./types";

/** Permission every operation here requires. */
const REQUIRED_PERMISSION = "edit_manuscript" as const;

const DEFAULT_CONTINUE_WORDS = 350;

export interface ManuscriptEditorOptions {
  readonly repo: StoryRepository;
  readonly model: LanguageModel;
  /** What this session is allowed to do. Checked before any model call. */
  readonly grant: PermissionGrant;
  readonly now?: () => string;
  /** Context budget for editing operations. */
  readonly maxContextTokens?: number;
}

interface Pending {
  readonly proposal: EditProposal;
  readonly transaction: StagedTransaction;
}

/**
 * Controlled AI manuscript editing.
 *
 * Implements the phase's workflow end to end, using the systems that already
 * exist rather than around them:
 *
 * ```
 * identify target → compile context (Context Compiler) → invoke model (Model Router)
 * → validate response (schema + deterministic checks) → stage (StagedTransaction)
 * → present diff → human accepts or rejects → commit as one ChangeSet
 * → audit (AI provenance on the change set + the agent activity log)
 * ```
 *
 * **The model never writes to a file.** It returns prose; this class decides
 * what that means for the project, and only a human decision commits it.
 */
export class ManuscriptEditor {
  private readonly repo: StoryRepository;
  private readonly model: LanguageModel;
  private readonly grant: PermissionGrant;
  private readonly now: () => string;
  private readonly maxContextTokens: number;
  private readonly pending = new Map<string, Pending>();
  private seq = 0;

  constructor(options: ManuscriptEditorOptions) {
    this.repo = options.repo;
    this.model = options.model;
    this.grant = options.grant;
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxContextTokens = options.maxContextTokens ?? 12_000;
  }

  /** Proposals awaiting a decision, newest first. */
  list(): EditProposal[] {
    return [...this.pending.values()].map((p) => p.proposal).reverse();
  }

  // ── 1–7: propose ─────────────────────────────────────────────────────────

  async propose(request: EditRequest): Promise<EditProposal> {
    const decision = checkPermission(
      { name: request.operation, permission: REQUIRED_PERMISSION },
      this.grant,
    );
    if (!decision.allowed) {
      throw new EditError("permission_denied", decision.reason, {
        details: { operation: request.operation },
      });
    }

    const target = await this.resolveTarget(request);
    const instruction = taskInstruction(request);

    const task = createTask({
      id: await this.repo.agents.nextTaskId(),
      goal: `${request.operation}: ${instruction}`,
      now: this.now(),
      scope: [target.targetId, target.path],
      // Editing calls no tools; its permission is checked directly.
      allowedTools: [],
      approvalPolicy: "approve_manuscript_edits",
    });
    await this.repo.agents.saveTask(task);
    let current = await this.repo.agents.saveTask(transition(task, "running", { now: this.now() }));

    try {
      const { pkg, info } = await this.compileContext(request, target.recipe, target.targetId);
      const proposed = await this.invokeModel(pkg, request, target, instruction);
      const text = validateProposalText(proposed.text, target.original, {
        operation: request.operation,
      });

      const after = spliceText(target.file, target.range, text, request.operation);
      const hunks = buildHunks(computeLineDiff(target.file, after));

      this.seq += 1;
      const proposal: EditProposal = {
        id: `PROP_${String(this.seq).padStart(4, "0")}`,
        taskId: current.id,
        operation: request.operation,
        targetId: target.targetId,
        path: target.path,
        instruction,
        ...("directive" in request ? { directive: request.directive } : {}),
        range: target.range,
        before: target.file,
        after,
        hunks,
        rationale: proposed.rationale,
        warnings: proposed.warnings,
        context: info,
        modelId: this.model.id,
        createdAt: this.now(),
      };

      // Stage, but do not commit: the project is untouched until a human says so.
      const transaction = this.repo
        .beginTransaction(summaryFor(proposal))
        .writeFile(target.path, after);

      current = await this.repo.agents.saveTask(
        transition(current, "awaiting_approval", { now: this.now() }),
      );
      this.pending.set(proposal.id, { proposal, transaction });
      await this.log(proposal, "ok", `proposed ${String(hunks.length)} hunk(s), awaiting review`);
      return proposal;
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      await this.repo.agents.saveTask(
        transition(current, "failed", { now: this.now(), failureReason: reason }),
      );
      if (cause instanceof ModelError) {
        throw new EditError("provider_failed", reason, { cause });
      }
      throw cause;
    }
  }

  // ── 8–9: accept or reject ────────────────────────────────────────────────

  /** Commit an approved proposal, in full or hunk by hunk. */
  async accept(proposalId: string, options: AcceptOptions = {}): Promise<AcceptResult> {
    const hunkIds = options.hunkIds;
    if (hunkIds !== undefined && hunkIds.length === 0) {
      throw new EditError(
        "no_change",
        "Accepting zero hunks changes nothing — reject the proposal instead.",
        { details: { proposalId } },
      );
    }

    const { proposal, transaction } = this.take(proposalId);
    const offered = proposal.hunks.length;
    const partial = hunkIds !== undefined && hunkIds.length < offered;
    const text = partial ? applyHunks(proposal.before, proposal.after, hunkIds) : proposal.after;
    const accepted = hunkIds?.length ?? offered;
    const approval = partial ? "partially_accepted" : "accepted";

    // The approval details are only known now, so they are stamped at commit.
    transaction.writeFile(proposal.path, text);
    const change = await transaction.commit(
      summaryFor(proposal, approval),
      this.metaFor(proposal, approval, accepted, offered),
    );

    await this.completeTask(proposal.taskId, "completed");
    await this.log(
      proposal,
      "ok",
      `${approval} — ${String(accepted)}/${String(offered)} hunk(s) committed as ${change.id}`,
    );

    return { changeSetId: change.id, approval, acceptedHunks: accepted, offeredHunks: offered };
  }

  /** Discard a proposal. The project is untouched; the decision is recorded. */
  async reject(proposalId: string, reason?: string): Promise<void> {
    const { proposal, transaction } = this.take(proposalId);
    transaction.discard();
    await this.completeTask(proposal.taskId, "cancelled");
    await this.log(
      proposal,
      "denied",
      reason === undefined || reason.trim() === ""
        ? "rejected by the author"
        : `rejected: ${reason}`,
    );
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private take(proposalId: string): Pending {
    const entry = this.pending.get(proposalId);
    if (entry === undefined) {
      throw new EditError("unknown_proposal", `No pending proposal "${proposalId}".`, {
        details: { proposalId },
      });
    }
    this.pending.delete(proposalId);
    return entry;
  }

  /**
   * Work out which file, which range and which recipe an operation targets —
   * before any model is involved.
   */
  private async resolveTarget(request: EditRequest): Promise<{
    path: string;
    range: TextRange;
    file: string;
    original: string;
    targetId: string;
    recipe: RecipeName;
    sceneId?: string;
  }> {
    if (request.operation === "rewrite_selection") {
      const file = await this.readFile(request.path);
      const actual = file.slice(request.range.start, request.range.end);
      if (actual !== request.selectedText) {
        throw new EditError(
          "stale_selection",
          "The selected text no longer matches the file — it has changed since the selection was made.",
          { details: { path: request.path } },
        );
      }
      if (actual.trim() === "") {
        throw new EditError("unresolvable_range", "The selection is empty.");
      }
      // A known scene gives the richer rewrite recipe; otherwise fall back to
      // the chapter that owns the file rather than guessing at a scene.
      if (request.sceneId !== undefined) {
        return {
          path: request.path,
          range: request.range,
          file,
          original: actual,
          targetId: request.sceneId,
          recipe: "scene_rewrite",
          sceneId: request.sceneId,
        };
      }
      const chapter = (await this.repo.listChapters()).find((c) => c.filePath === request.path);
      if (chapter === undefined) {
        throw new EditError(
          "unknown_target",
          `"${request.path}" is not a chapter file, so no scene context can be compiled for it.`,
          { details: { path: request.path } },
        );
      }
      return {
        path: request.path,
        range: request.range,
        file,
        original: actual,
        targetId: chapter.id,
        recipe: "chapter_inspection",
      };
    }

    // Scene-level operations resolve the scene's prose within its chapter.
    const scene = (await this.repo.listScenes()).find((s) => s.id === request.sceneId);
    if (scene === undefined) {
      throw new EditError("unknown_target", `No scene exists with ID "${request.sceneId}".`);
    }
    const chapter = (await this.repo.listChapters()).find((c) => c.id === scene.chapterId);
    if (chapter === undefined) {
      throw new EditError(
        "unknown_target",
        `${scene.id} is not assigned to a chapter, so it has no prose to edit.`,
      );
    }

    const file = await this.readFile(chapter.filePath);
    const chapterSceneIds = (await this.repo.listScenes())
      .filter((s) => s.chapterId === chapter.id)
      .map((s) => s.id as string);
    const resolved = resolveSceneRange(file, scene.id, {
      chapterSceneIds,
      mode: request.operation === "continue_scene" ? "append" : "replace",
    });
    if (!resolved.ok) {
      throw new EditError("unresolvable_range", resolved.reason, {
        details: { sceneId: scene.id, chapter: chapter.id },
      });
    }

    return {
      path: chapter.filePath,
      range: { start: resolved.start, end: resolved.end },
      file,
      original: file.slice(resolved.start, resolved.end),
      targetId: scene.id,
      recipe: "scene_rewrite",
      sceneId: scene.id,
    };
  }

  private async readFile(path: string): Promise<string> {
    const text = await this.repo.readProjectFile(path);
    if (text === null) {
      throw new EditError("unknown_target", `No file exists at "${path}".`, { details: { path } });
    }
    return text;
  }

  /** Every operation's context comes from the Context Compiler. */
  private async compileContext(
    request: EditRequest,
    recipe: RecipeName,
    targetId: string,
  ): Promise<{ pkg: ContextPackage; info: ProposalContextInfo }> {
    const compiler = new ContextCompiler(this.repo, { now: this.now });
    const pkg = await compiler.compile({
      recipe,
      targetId,
      instruction: taskInstruction(request),
      budget: { maxTokens: this.maxContextTokens, reserveForOutput: 2_000 },
    });
    return {
      pkg,
      info: {
        recipe,
        estimatedTokens: pkg.metadata.estimatedTokens,
        itemCount: pkg.sections.reduce((n, s) => n + s.items.length, 0),
        degradedCount: pkg.metadata.notes.length,
      },
    };
  }

  private async invokeModel(
    pkg: ContextPackage,
    request: EditRequest,
    target: { original: string; targetId: string },
    instruction: string,
  ): Promise<{ text: string; rationale: string; warnings: readonly string[] }> {
    const passage =
      request.operation === "continue_scene"
        ? `The scene's text so far ends here:\n\n${tail(target.original, 2_000)}`
        : `The passage to edit, exactly as it appears in the manuscript:\n\n${target.original}`;

    return this.model.generateStructured(
      {
        system: EDITOR_SYSTEM_PROMPT,
        messages: [
          { role: "user", content: renderContextPackage(pkg) },
          {
            role: "user",
            content: `${passage}\n\nINSTRUCTION\n${instruction}\n\n${RESPONSE_FORMAT}`,
          },
        ],
        schema: PROPOSAL_SCHEMA,
        maxOutputTokens: 4_000,
      },
      { timeoutMs: 120_000 },
    );
  }

  private metaFor(
    proposal: EditProposal,
    approval: AiProvenance["approval"],
    acceptedHunks: number,
    offeredHunks: number,
  ): { actor: "agent"; operation: string; taskId: string; modelId: string; ai: AiProvenance } {
    return {
      actor: "agent",
      operation: proposal.operation,
      taskId: proposal.taskId,
      modelId: proposal.modelId,
      ai: {
        operation: proposal.operation,
        targetId: proposal.targetId,
        instruction: proposal.instruction,
        ...(proposal.directive !== undefined ? { directive: proposal.directive } : {}),
        contextRecipe: proposal.context.recipe,
        contextTokens: proposal.context.estimatedTokens,
        modelId: proposal.modelId,
        taskId: proposal.taskId,
        approval,
        approvedAt: this.now(),
        acceptedHunks,
        offeredHunks,
      },
    };
  }

  /** Record the decision in the agent activity log alongside tool activity. */
  private async log(
    proposal: EditProposal,
    status: "ok" | "denied",
    result: string,
  ): Promise<void> {
    await this.repo.agents.appendActivity({
      taskId: proposal.taskId,
      timestamp: this.now(),
      tool: proposal.operation,
      argumentsSummary: `target=${proposal.targetId}, recipe=${proposal.context.recipe}`,
      resultSummary: result,
      status,
    });
  }

  /** Close out the task behind a proposal. A missing task never blocks a commit. */
  private async completeTask(taskId: string, to: "completed" | "cancelled"): Promise<void> {
    const task = await this.repo.agents.getTask(taskId);
    if (task === null) return;
    await this.repo.agents.saveTask(transition(task, to, { now: this.now() }));
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function taskInstruction(request: EditRequest): string {
  switch (request.operation) {
    case "rewrite_selection":
      return selectionTask(request.directive, request.instruction);
    case "rewrite_scene":
      return sceneRewriteTask(request.instruction);
    case "continue_scene":
      return continueSceneTask(request.targetWords ?? DEFAULT_CONTINUE_WORDS, request.instruction);
  }
}

function summaryFor(proposal: EditProposal, approval = "accepted"): string {
  const what =
    proposal.operation === "continue_scene"
      ? `Continue ${proposal.targetId}`
      : proposal.operation === "rewrite_scene"
        ? `Rewrite ${proposal.targetId}`
        : `${proposal.directive ?? "rewrite"} selection in ${proposal.targetId}`;
  return approval === "partially_accepted" ? `${what} (partially accepted)` : what;
}

/** Replace a range, or insert at it when the range is empty (a continuation). */
function spliceText(file: string, range: TextRange, text: string, operation: string): string {
  const head = file.slice(0, range.start);
  const tailPart = file.slice(range.end);
  if (operation === "continue_scene") {
    const separator = head.endsWith("\n\n") ? "" : head.endsWith("\n") ? "\n" : "\n\n";
    const trailing = tailPart.startsWith("\n") || tailPart === "" ? "" : "\n";
    return `${head}${separator}${text}${trailing}${tailPart}`;
  }
  return `${head}${text}${tailPart}`;
}

function tail(text: string, chars: number): string {
  return text.length <= chars ? text : `…${text.slice(text.length - chars)}`;
}
