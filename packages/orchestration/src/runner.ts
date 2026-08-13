import {
  EMPTY_COST,
  describeWorkflowNode,
  flattenNodes,
  type Disagreement,
  type PendingApproval,
  type RoutingClass,
  type WorkflowArtifact,
  type WorkflowNodeRecord,
  type WorkflowRun,
} from "@jellytind/domain";
import { agentById, createTask, transition } from "@jellytind/agent-runtime";
import type { StoryRepository } from "@jellytind/story-repository";
import { parseArtifact, renderArtifact, type BuildResult, type Draft } from "./artifacts";
import { mergeReviews, openDisagreements, resolveDisagreement } from "./conflicts";
import { conditionById } from "./graph";
import { addCost, route, type RoutingTable } from "./routing";
import {
  OrchestrationError,
  type AgentNode,
  type AgentWorkExecutor,
  type WorkflowDefinition,
  type WorkflowNode,
  type WorkflowRunStoreLike,
} from "./types";

export interface WorkflowProgress {
  readonly run: WorkflowRun;
  readonly node: WorkflowNodeRecord;
  readonly index: number;
  readonly total: number;
  /** `✓ Architect`, `→ Character Review`, `○ Continuity`. */
  readonly line: string;
}

export interface WorkflowRunOptions {
  readonly onProgress?: (event: WorkflowProgress) => void;
  readonly signal?: AbortSignal;
}

export interface WorkflowRunnerOptions {
  readonly repo: StoryRepository;
  readonly runs: WorkflowRunStoreLike;
  readonly routing: RoutingTable;
  /** Without one, every agent step is skipped and the deterministic nodes run. */
  readonly executor?: AgentWorkExecutor | null;
  readonly now?: () => string;
}

/** What the writer says at an approval gate. */
export interface ApprovalDecision {
  readonly approved: boolean;
  readonly note?: string;
  /** How the writer settles each disagreement: which agent's position wins. */
  readonly resolutions?: ReadonlyArray<{ target: string; chose: string; note?: string }>;
}

interface PlannedNode {
  readonly node: WorkflowNode;
  /** Conditions that must hold for this node to run at all. */
  readonly guards: readonly string[];
}

/**
 * The orchestrator.
 *
 * Specialists do not talk to each other and do not decide who goes next. This
 * engine does: it runs the graph, hands each agent the **artifacts** the
 * earlier steps produced, validates what comes back before it becomes a
 * handoff, stops at approval gates, and writes the run to disk after every
 * node.
 *
 * Four properties are the point of the whole phase:
 *
 * - **One project state.** Every agent reads the same Story Repository. A draft
 *   is an artifact until the writer approves it; only then does an `apply` node
 *   write, as one recorded change set, after a checkpoint.
 * - **An audit trail.** The run carries its nodes, artifacts, checkpoints and
 *   change sets, and every step is logged to the agent activity store.
 * - **Disagreement survives.** Where reviewers pull in different directions,
 *   both positions are kept and put to the writer. Nothing is overwritten by
 *   whoever ran last.
 * - **Cost is counted.** Each step declares a routing class; the ledger records
 *   calls and tokens per class, and invents no money.
 */
export class WorkflowRunner {
  private readonly repo: StoryRepository;
  private readonly runs: WorkflowRunStoreLike;
  private readonly routing: RoutingTable;
  private readonly executor: AgentWorkExecutor | null;
  private readonly now: () => string;

  constructor(options: WorkflowRunnerOptions) {
    this.repo = options.repo;
    this.runs = options.runs;
    this.routing = options.routing;
    this.executor = options.executor ?? null;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  async start(
    workflow: WorkflowDefinition,
    goal: string,
    inputs: Readonly<Record<string, string>> = {},
    options: WorkflowRunOptions = {},
  ): Promise<WorkflowRun> {
    for (const input of workflow.inputs) {
      if (input.required && (inputs[input.key] ?? "") === "") {
        throw new OrchestrationError("missing_input", `${workflow.name} needs ${input.label}.`, {
          details: { workflow: workflow.id, input: input.key },
        });
      }
    }

    const planned = planOf(workflow.nodes);
    const id = await this.runs.nextId();

    // One task for the whole run: the audit trail every agent step appends to.
    const task = createTask({
      id: await this.repo.agents.nextTaskId(),
      goal: `${workflow.name}: ${goal}`,
      now: this.now(),
      allowedTools: [],
      approvalPolicy: "approve_every_edit",
    });
    await this.repo.agents.saveTask(transition(task, "running", { now: this.now() }));

    const run: WorkflowRun = {
      id,
      workflowId: workflow.id,
      workflowName: workflow.name,
      goal,
      inputs: { ...inputs, taskId: task.id },
      status: "running",
      nodes: planned.map(({ node }) => recordFor(node)),
      artifacts: [],
      disagreements: [],
      checkpoints: [],
      changeSets: [],
      cost: EMPTY_COST,
      startedAt: this.now(),
      resumeCount: 0,
    };
    await this.runs.save(run);
    return this.execute(workflow, run, planned, options);
  }

  /**
   * Answer an approval gate.
   *
   * Approving continues the run from the next node; declining ends it with
   * nothing applied. Where a gate requires it, every disagreement must be
   * settled first — the writer chooses which agent's position holds, and both
   * remain on the record.
   */
  async approve(
    runId: string,
    workflow: WorkflowDefinition,
    decision: ApprovalDecision,
    options: WorkflowRunOptions = {},
  ): Promise<WorkflowRun> {
    const stored = await this.runs.get(runId);
    if (stored === null) {
      throw new OrchestrationError("run_not_found", `No workflow run with id ${runId}.`);
    }
    const pending = stored.pending;
    if (stored.status !== "awaiting_approval" || pending === undefined) {
      throw new OrchestrationError(
        "not_awaiting_approval",
        `${stored.workflowName} (${runId}) is not waiting for approval.`,
      );
    }

    let disagreements: readonly Disagreement[] = stored.disagreements;
    for (const resolution of decision.resolutions ?? []) {
      disagreements = resolveDisagreement(
        disagreements,
        resolution.target,
        resolution.chose,
        this.now(),
        resolution.note,
      );
    }

    const node = nodeInWorkflow(workflow, pending.nodeId);
    if (
      decision.approved &&
      node.kind === "approval" &&
      node.requiresDisagreementsResolved === true &&
      openDisagreements(disagreements).length > 0
    ) {
      throw new OrchestrationError(
        "unresolved_disagreement",
        `${String(openDisagreements(disagreements).length)} disagreement(s) are still open. Settle them before approving.`,
        { details: { targets: openDisagreements(disagreements).map((item) => item.target) } },
      );
    }

    const planned = planOf(workflow.nodes);
    const at = planned.findIndex((entry) => entry.node.id === pending.nodeId);
    const marked = markNode(stored.nodes, pending.nodeId, {
      status: decision.approved ? "ok" : "skipped",
      summary: decision.approved
        ? `Approved${decision.note === undefined ? "" : `: ${decision.note}`}`
        : undefined,
      reason: decision.approved
        ? undefined
        : `Declined by the writer${decision.note === undefined ? "" : `: ${decision.note}`}`,
      finishedAt: this.now(),
    });

    const base: WorkflowRun = {
      ...stored,
      nodes: marked,
      disagreements,
      status: decision.approved ? "running" : "rejected",
      resumeCount: stored.resumeCount + 1,
    };
    delete (base as { pending?: PendingApproval }).pending;

    if (!decision.approved) {
      await this.log(base, pending.nodeId, "declined by the writer");
      return this.finish(base, "rejected", "The writer declined at an approval gate.");
    }

    await this.runs.save(base);
    await this.log(base, pending.nodeId, "approved by the writer");
    return this.execute(workflow, base, planned, options, at + 1);
  }

  /** Continue a run that failed part-way. Completed nodes are not run again. */
  async resume(
    runId: string,
    workflow: WorkflowDefinition,
    options: WorkflowRunOptions = {},
  ): Promise<WorkflowRun> {
    const stored = await this.runs.get(runId);
    if (stored === null) {
      throw new OrchestrationError("run_not_found", `No workflow run with id ${runId}.`);
    }
    if (stored.status === "completed" || stored.status === "rejected") {
      throw new OrchestrationError(
        "not_resumable",
        `${stored.workflowName} (${runId}) already finished as ${stored.status}.`,
      );
    }
    if (stored.status === "awaiting_approval") {
      throw new OrchestrationError(
        "not_resumable",
        `${stored.workflowName} (${runId}) is waiting for your approval, not for a retry.`,
      );
    }

    const run: WorkflowRun = {
      ...stored,
      status: "running",
      resumeCount: stored.resumeCount + 1,
      nodes: stored.nodes.map((node) =>
        node.status === "failed" || node.status === "running"
          ? { ...node, status: "pending" as const }
          : node,
      ),
    };
    delete (run as { failureReason?: string }).failureReason;
    await this.runs.save(run);
    return this.execute(workflow, run, planOf(workflow.nodes), options);
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  private async execute(
    workflow: WorkflowDefinition,
    initial: WorkflowRun,
    planned: readonly PlannedNode[],
    options: WorkflowRunOptions,
    from = 0,
  ): Promise<WorkflowRun> {
    let run = initial;
    const total = flattenNodes(run.nodes).length;

    for (let index = from; index < planned.length; index += 1) {
      const entry = planned[index];
      /* istanbul ignore next — index is bounded by planned.length. */
      if (entry === undefined) continue;
      const record = run.nodes[index];
      if (record?.status === "ok" || record?.status === "skipped") continue;

      if (options.signal?.aborted === true) {
        return this.finish(run, "cancelled", "Cancelled before this step ran.");
      }

      // Guards are evaluated when the node is reached, against what the run has
      // actually produced by then — not planned in advance.
      const failing = entry.guards.find((id) => !conditionById(id).holds({ repo: this.repo, run }));
      if (failing !== undefined) {
        run = await this.save({
          ...run,
          nodes: markNode(run.nodes, entry.node.id, {
            status: "skipped",
            reason: `"${failing}" did not hold`,
            finishedAt: this.now(),
          }),
        });
        this.report(run, index, total, options);
        continue;
      }

      const startedAt = this.now();
      const started = Date.now();
      run = await this.save({
        ...run,
        nodes: markNode(run.nodes, entry.node.id, { status: "running", startedAt }),
      });
      this.report(run, index, total, options);

      try {
        const outcome = await this.runNode(workflow, entry.node, run, options);
        run = outcome.run;

        if (outcome.awaiting !== undefined) {
          run = await this.save({
            ...run,
            status: "awaiting_approval",
            pending: outcome.awaiting,
            nodes: markNode(run.nodes, entry.node.id, {
              status: "awaiting_approval",
              startedAt,
            }),
          });
          this.report(run, index, total, options);
          await this.log(run, entry.node.id, "waiting for the writer");
          return run;
        }

        run = await this.save({
          ...run,
          nodes: markNode(run.nodes, entry.node.id, {
            status: outcome.skipped === undefined ? "ok" : "skipped",
            ...(outcome.summary === undefined ? {} : { summary: outcome.summary }),
            ...(outcome.skipped === undefined ? {} : { reason: outcome.skipped }),
            ...(outcome.attempts === undefined ? {} : { attempts: outcome.attempts }),
            ...(outcome.artifactId === undefined ? {} : { artifactId: outcome.artifactId }),
            ...(outcome.children === undefined ? {} : { children: outcome.children }),
            startedAt,
            finishedAt: this.now(),
            durationMs: Date.now() - started,
          }),
        });
        await this.log(run, entry.node.id, outcome.summary ?? outcome.skipped ?? "done");
        this.report(run, index, total, options);
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        run = await this.save({
          ...run,
          nodes: markNode(run.nodes, entry.node.id, {
            status: "failed",
            reason,
            startedAt,
            finishedAt: this.now(),
            durationMs: Date.now() - started,
          }),
        });
        await this.log(run, entry.node.id, `failed: ${reason}`, "failed");
        this.report(run, index, total, options);
        // Everything already produced is kept: a failure at the drafting step
        // must not cost the writer the brief and the plan.
        return this.finish(run, "failed", reason);
      }
    }

    return this.finish(run, "completed");
  }

  private async runNode(
    workflow: WorkflowDefinition,
    node: WorkflowNode,
    run: WorkflowRun,
    options: WorkflowRunOptions,
  ): Promise<{
    run: WorkflowRun;
    summary?: string;
    skipped?: string;
    attempts?: number;
    artifactId?: string;
    children?: readonly WorkflowNodeRecord[];
    awaiting?: PendingApproval;
  }> {
    switch (node.kind) {
      case "agent": {
        const outcome = await this.runAgent(node, run, options);
        return outcome;
      }

      case "parallel": {
        // Independent analyses, run together. They cannot read each other's
        // output — the graph validator enforces that — so concurrency here
        // cannot change the result.
        const results = await Promise.all(
          node.branches.map((branch) => this.runAgent(branch, run, options)),
        );
        let next = run;
        const children: WorkflowNodeRecord[] = [];
        for (const [at, result] of results.entries()) {
          const branch = node.branches[at];
          /* istanbul ignore next — results mirror branches. */
          if (branch === undefined) continue;
          next = {
            ...next,
            artifacts: [...next.artifacts, ...result.run.artifacts.slice(run.artifacts.length)],
            cost: mergeCost(next.cost, run.cost, result.run.cost),
          };
          children.push({
            ...recordFor(branch),
            status: result.skipped === undefined ? "ok" : "skipped",
            ...(result.summary === undefined ? {} : { summary: result.summary }),
            ...(result.skipped === undefined ? {} : { reason: result.skipped }),
            ...(result.attempts === undefined ? {} : { attempts: result.attempts }),
            ...(result.artifactId === undefined ? {} : { artifactId: result.artifactId }),
            finishedAt: this.now(),
          });
        }
        const ran = children.filter((child) => child.status === "ok").length;
        return {
          run: next,
          summary: `${String(ran)} of ${String(children.length)} analyses ran`,
          children,
          ...(ran === 0 ? { skipped: "no analysis could run" } : {}),
        };
      }

      case "merge": {
        const inputs = run.artifacts.filter((artifact) => node.reads.includes(artifact.kind));
        if (inputs.length === 0) {
          return { run, skipped: "no reviews were produced, so there was nothing to merge" };
        }
        const merged = mergeReviews(inputs);
        const artifact = this.artifact(run, node.id, "workflow", node.produces, merged);
        const disagreements = [...run.disagreements, ...merged.disagreements];
        return {
          run: { ...run, artifacts: [...run.artifacts, artifact], disagreements },
          summary: `Merged ${String(inputs.length)} review(s): ${String(merged.notes.length)} note(s), ${String(merged.disagreements.length)} disagreement(s)`,
          artifactId: artifact.id,
        };
      }

      case "approval": {
        const open = openDisagreements(run.disagreements);
        return {
          run,
          awaiting: {
            nodeId: node.id,
            question: node.question,
            artifactIds: run.artifacts
              .filter((artifact) => node.reads.includes(artifact.kind))
              .map((artifact) => artifact.id),
            disagreements: open,
            raisedAt: this.now(),
          },
        };
      }

      case "checkpoint": {
        const checkpoint = await this.repo.createCheckpoint(`${node.label} — ${run.goal}`);
        return {
          run: { ...run, checkpoints: [...run.checkpoints, checkpoint.id] },
          summary: `Checkpoint ${checkpoint.id} taken`,
        };
      }

      case "build": {
        const build = await this.repo.buildStory();
        const payload: BuildResult = {
          buildId: build.id,
          status: build.status,
          errors: build.counts.error ?? 0,
          warnings: build.counts.warning ?? 0,
          diagnostics: build.diagnostics.map((diagnostic) => ({
            ruleId: diagnostic.ruleId,
            message: diagnostic.message,
            ...(diagnostic.sceneId === undefined ? {} : { sceneId: diagnostic.sceneId }),
          })),
        };
        const artifact = this.artifact(run, node.id, "story_compiler", node.produces, payload);
        return {
          run: { ...run, artifacts: [...run.artifacts, artifact] },
          summary: `Build ${build.id} ${build.status} — ${String(build.diagnostics.length)} diagnostic(s)`,
          artifactId: artifact.id,
        };
      }

      case "apply": {
        return this.applyDraft(node.reads, run);
      }

      /* istanbul ignore next — conditionals are flattened into guards. */
      case "conditional":
        return { run, skipped: "conditional nodes are flattened before execution" };
    }
    /* istanbul ignore next — the switch is exhaustive over WorkflowNode. */
    throw new OrchestrationError("invalid_workflow", `Unknown node kind in ${workflow.name}.`);
  }

  /**
   * One specialist's step, with retries.
   *
   * The artifact is validated before it becomes a handoff, so a malformed
   * response fails the step — and can be retried — rather than being passed
   * to the next agent or written anywhere.
   */
  private async runAgent(
    node: AgentNode,
    run: WorkflowRun,
    options: WorkflowRunOptions,
  ): Promise<{
    run: WorkflowRun;
    summary?: string;
    skipped?: string;
    attempts?: number;
    artifactId?: string;
  }> {
    const decision = route(this.routing, node.routingClass);
    if (this.executor === null) {
      return { run, skipped: "no agent executor is configured, so this specialist did not run" };
    }
    if (decision.unavailable !== undefined) {
      return { run, skipped: decision.unavailable };
    }

    const inputs = run.artifacts.filter((artifact) => node.reads.includes(artifact.kind));
    const maxAttempts = Math.max(1, node.maxAttempts ?? 1);
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (options.signal?.aborted === true) {
        return { run, skipped: "cancelled" };
      }
      try {
        const result = await this.executor.run({
          agent: node.agent,
          nodeId: node.id,
          instruction: node.instruction,
          goal: run.goal,
          produces: node.produces,
          routingClass: node.routingClass,
          ...(node.contextRecipe === undefined ? {} : { contextRecipe: node.contextRecipe }),
          ...(run.inputs.chapterId === undefined ? {} : { targetId: run.inputs.chapterId }),
          inputs,
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });

        const payload = parseArtifact(node.produces, result.payload);
        const artifact = this.artifact(
          run,
          node.id,
          node.agent,
          node.produces,
          payload,
          result.modelId ?? decision.modelId,
        );
        return {
          run: {
            ...run,
            artifacts: [...run.artifacts, artifact],
            cost: addCost(run.cost, node.routingClass, {
              ...(result.calls === undefined ? {} : { calls: result.calls }),
              ...(result.inputTokens === undefined ? {} : { inputTokens: result.inputTokens }),
              ...(result.outputTokens === undefined ? {} : { outputTokens: result.outputTokens }),
            }),
          },
          summary: `${agentById(node.agent).name} produced a ${node.produces.replace(/_/g, " ")}${attempt > 1 ? ` (attempt ${String(attempt)})` : ""}`,
          attempts: attempt,
          artifactId: artifact.id,
        };
      } catch (cause) {
        lastError = cause;
      }
    }

    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    throw new OrchestrationError(
      "node_failed",
      `${agentById(node.agent).name} failed after ${String(maxAttempts)} attempt(s): ${reason}`,
      { cause: lastError, details: { node: node.id, attempts: maxAttempts } },
    );
  }

  /**
   * Write an approved draft into the manuscript.
   *
   * One transaction, one change set, attributed to the run's task — so the
   * change appears in the ordinary revision history and can be reverted like
   * any other (docs/VERSIONING.md).
   */
  private async applyDraft(
    reads: readonly string[],
    run: WorkflowRun,
  ): Promise<{ run: WorkflowRun; summary?: string; skipped?: string }> {
    const drafts = run.artifacts.filter((artifact) => reads.includes(artifact.kind));
    const latest = drafts.at(-1);
    if (latest === undefined) {
      return { run, skipped: "no draft was produced, so nothing was written" };
    }
    const draft = latest.payload as Draft;
    const chapter = (await this.repo.listChapters()).find(
      (entry) => (entry.id as string) === draft.chapterId,
    );
    if (chapter === undefined) {
      throw new OrchestrationError(
        "invalid_artifact",
        `The draft names ${draft.chapterId}, which is not a chapter in this project.`,
      );
    }

    const existing = (await this.repo.readProjectFile(chapter.filePath)) ?? "";
    const frontmatter = /^---\n[\s\S]*?\n---\n/.exec(existing)?.[0] ?? "";
    const transaction = this.repo.beginTransaction(`${run.workflowName}: draft ${chapter.title}`, {
      actor: "agent",
      operation: "workflow_apply_draft",
      ...(typeof run.inputs.taskId === "string" ? { taskId: run.inputs.taskId } : {}),
      ...(latest.modelId === undefined ? {} : { modelId: latest.modelId }),
      // The same provenance any AI edit carries, so a workflow's draft is
      // audited exactly like a rewrite (docs/AI_EDITING.md).
      ai: {
        operation: "workflow_draft",
        targetId: draft.chapterId,
        instruction: run.goal,
        contextRecipe: "scene_rewrite",
        contextTokens: 0,
        modelId: latest.modelId ?? "unknown",
        taskId: typeof run.inputs.taskId === "string" ? run.inputs.taskId : run.id,
        approval: "accepted",
        approvedAt: this.now(),
      },
    });
    transaction.writeFile(chapter.filePath, `${frontmatter}${draft.prose.trim()}\n`);
    const change = await transaction.commit();

    return {
      run: { ...run, changeSets: [...run.changeSets, change.id] },
      summary: `Wrote ${String(draft.wordCount)} words to ${chapter.title} (${change.id})`,
    };
  }

  // ── Bookkeeping ───────────────────────────────────────────────────────────

  private artifact(
    run: WorkflowRun,
    nodeId: string,
    producedBy: string,
    kind: WorkflowArtifact["kind"],
    payload: unknown,
    modelId?: string,
  ): WorkflowArtifact {
    return {
      id: `${run.id}.${nodeId}`,
      kind,
      nodeId,
      producedBy,
      createdAt: this.now(),
      ...(modelId === undefined ? {} : { modelId }),
      payload,
    };
  }

  private save(run: WorkflowRun): Promise<WorkflowRun> {
    return this.runs.save(run);
  }

  private async finish(
    run: WorkflowRun,
    status: WorkflowRun["status"],
    failureReason?: string,
  ): Promise<WorkflowRun> {
    const taskId = run.inputs.taskId;
    if (typeof taskId === "string") {
      const task = await this.repo.agents.getTask(taskId);
      if (task !== null && task.status === "running") {
        await this.repo.agents.saveTask(
          transition(
            task,
            status === "completed" ? "completed" : status === "cancelled" ? "cancelled" : "failed",
            {
              now: this.now(),
              ...(failureReason === undefined ? {} : { failureReason }),
            },
          ),
        );
      }
    }
    return this.save({
      ...run,
      status,
      finishedAt: this.now(),
      ...(failureReason === undefined ? {} : { failureReason }),
    });
  }

  /** Every step, in the agent activity log — the audit trail, not a transcript. */
  private async log(
    run: WorkflowRun,
    nodeId: string,
    resultSummary: string,
    status: "ok" | "failed" = "ok",
  ): Promise<void> {
    const taskId = run.inputs.taskId;
    if (typeof taskId !== "string") return;
    await this.repo.agents.appendActivity({
      taskId,
      timestamp: this.now(),
      tool: `${run.workflowId}.${nodeId}`,
      argumentsSummary: run.goal,
      resultSummary,
      status,
    });
  }

  private report(
    run: WorkflowRun,
    index: number,
    total: number,
    options: WorkflowRunOptions,
  ): void {
    const node = run.nodes[index];
    if (node === undefined || options.onProgress === undefined) return;
    options.onProgress({ run, node, index, total, line: describeWorkflowNode(node) });
  }
}

// ── Plan and records ────────────────────────────────────────────────────────

/**
 * Flatten conditionals into guards.
 *
 * A conditional is not a jump: it is a condition attached to the nodes inside
 * it, evaluated when each is reached. That keeps execution a straight line —
 * which is what makes a run resumable by index and legible in a list.
 */
function planOf(nodes: readonly WorkflowNode[], guards: readonly string[] = []): PlannedNode[] {
  return nodes.flatMap((node) =>
    node.kind === "conditional"
      ? planOf(node.children, [...guards, node.when])
      : [{ node, guards }],
  );
}

function recordFor(node: WorkflowNode): WorkflowNodeRecord {
  return {
    id: node.id,
    title: node.title,
    kind: node.kind,
    status: "pending",
    ...(node.kind === "agent" ? { agent: agentById(node.agent).name } : {}),
    ...(node.kind === "agent" ? { routingClass: node.routingClass } : {}),
    ...(node.kind === "parallel"
      ? { children: node.branches.map((branch) => recordFor(branch)) }
      : {}),
  };
}

function markNode(
  nodes: readonly WorkflowNodeRecord[],
  id: string,
  patch: Partial<WorkflowNodeRecord> & { status: WorkflowNodeRecord["status"] },
): WorkflowNodeRecord[] {
  return nodes.map((node) => {
    if (node.id !== id) return node;
    const next = { ...node, ...patch };
    // `undefined` in a patch means "leave it out", not "store undefined".
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete (next as Record<string, unknown>)[key];
    }
    return next;
  });
}

function mergeCost(
  accumulated: WorkflowRun["cost"],
  before: WorkflowRun["cost"],
  after: WorkflowRun["cost"],
): WorkflowRun["cost"] {
  // Each parallel branch started from the same `before`, so only its delta
  // counts — otherwise the shared history would be added once per branch.
  let out = accumulated;
  for (const [routingClass, entry] of Object.entries(after.byClass)) {
    const previous = before.byClass[routingClass] ?? { calls: 0, inputTokens: 0, outputTokens: 0 };
    const calls = entry.calls - previous.calls;
    if (calls === 0 && entry.inputTokens === previous.inputTokens) continue;
    out = addCost(out, routingClass as RoutingClass, {
      calls,
      inputTokens: entry.inputTokens - previous.inputTokens,
      outputTokens: entry.outputTokens - previous.outputTokens,
    });
  }
  return out;
}

function nodeInWorkflow(workflow: WorkflowDefinition, id: string): WorkflowNode {
  const found = planOf(workflow.nodes).find((entry) => entry.node.id === id);
  if (found === undefined) {
    throw new OrchestrationError("unknown_node", `No node "${id}" in ${workflow.name}.`);
  }
  return found.node;
}

export { renderArtifact };
