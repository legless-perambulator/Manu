import {
  AgentBuilderError,
  type AgentInvoker,
  type CustomAgentDefinition,
  type FileStorePort,
  type FlowCondition,
  type FlowDefinition,
  type FlowOutput,
  type FlowStep,
  type ProposedEdit,
} from "./types";

/**
 * The flow runner (§12–§18).
 *
 * Flows execute sequentially through a closed set of step kinds. A run is a
 * project file from its first step: every state change is persisted before
 * the runner moves on, so an approval gate can wait a week and a restart
 * resumes exactly where the run stopped (§27). The run snapshots the flow
 * definition and records the revision of every agent it used, so "which
 * version did this?" always has an answer (§25).
 *
 * Safety holds by construction: run_tool accepts read-only tools, proposals
 * stage rather than apply, apply_staged_changes runs only after an approval
 * gate approved specific proposals, and retry is bounded at three attempts —
 * there is no loop construct at all, so there is no infinite one.
 */

export const FLOW_RUNS_DIR = ".writer/studio/runs";

export interface FlowStepRecord {
  readonly id: string;
  readonly kind: FlowStep["kind"];
  readonly title: string;
  readonly status: "done" | "skipped" | "failed" | "waiting";
  readonly summary: string;
  readonly attempts?: number;
}

export interface FlowRunState {
  readonly id: string;
  readonly flowId: string;
  readonly flowRevision: number;
  /** The definition as it was when the run started — restarts replay this. */
  readonly flow: FlowDefinition;
  readonly inputs: Readonly<Record<string, string>>;
  readonly status: "running" | "awaiting_approval" | "finished" | "failed" | "rejected";
  readonly steps: readonly FlowStepRecord[];
  /** Which agent revisions did the work (§25). */
  readonly agentsUsed: ReadonlyArray<{ readonly id: string; readonly revision: number }>;
  readonly notes: readonly string[];
  readonly proposals: readonly ProposedEdit[];
  /** Proposal ids the writer accepted at the gate. */
  readonly accepted: readonly string[];
  readonly approval?: { readonly stepId: string; readonly question: string };
  readonly measures: {
    readonly compiler_errors?: number;
    readonly compiler_warnings?: number;
    readonly tests_failed?: number;
    readonly findings?: number;
  };
  readonly report?: { readonly title: string; readonly lines: readonly string[] };
  readonly output: FlowOutput;
  readonly changeSetId?: string;
  readonly error?: string;
}

export interface FlowRunPorts {
  readonly files: FileStorePort;
  readonly invoker: AgentInvoker | null;
  /** Custom agents by id; a shipped specialist resolves to null and passes through. */
  resolveAgent(id: string): CustomAgentDefinition | null;
  searchProject(query: string): Promise<readonly string[]>;
  runTool?(name: string): Promise<string>;
  compileContext?(recipe: string): Promise<string>;
  runStoryBuild(): Promise<{
    readonly errors: number;
    readonly warnings: number;
    readonly lines: readonly string[];
  }>;
  runStoryTests?(): Promise<{ readonly failed: number; readonly lines: readonly string[] }>;
  applyEdits?(
    edits: readonly ProposedEdit[],
  ): Promise<{ readonly changeSetId: string; readonly applied: number }>;
}

function holds(condition: FlowCondition, measures: FlowRunState["measures"]): boolean {
  const value = measures[condition.measure] ?? 0;
  return condition.comparison === "equals" ? value === condition.value : value > condition.value;
}

/** The linear order this run will execute, branches resolved from measures. */
function executionOrder(
  steps: readonly FlowStep[],
  measures: FlowRunState["measures"],
): FlowStep[] {
  const order: FlowStep[] = [];
  for (const step of steps) {
    if (step.kind === "branch") {
      order.push(step);
      order.push(...(holds(step.condition, measures) ? step.then : step.otherwise));
    } else {
      order.push(step);
    }
  }
  return order;
}

export class FlowRunner {
  constructor(private readonly ports: FlowRunPorts) {}

  private runPath(id: string): string {
    return `${FLOW_RUNS_DIR}/${id}.json`;
  }

  private async persist(state: FlowRunState): Promise<void> {
    await this.ports.files.writeProjectFile(this.runPath(state.id), JSON.stringify(state, null, 2));
  }

  async get(runId: string): Promise<FlowRunState> {
    const raw = await this.ports.files.readProjectFile(this.runPath(runId));
    if (raw === null) {
      throw new AgentBuilderError("run_not_found", `No run named "${runId}".`);
    }
    return JSON.parse(raw) as FlowRunState;
  }

  async list(): Promise<readonly FlowRunState[]> {
    const paths = await this.ports.files.listProjectFiles(FLOW_RUNS_DIR);
    const runs: FlowRunState[] = [];
    for (const path of paths.filter((held) => held.endsWith(".json")).sort()) {
      const raw = await this.ports.files.readProjectFile(path);
      if (raw !== null && raw.trim() !== "") runs.push(JSON.parse(raw) as FlowRunState);
    }
    return runs;
  }

  async start(
    flow: FlowDefinition,
    inputs: Readonly<Record<string, string>>,
  ): Promise<FlowRunState> {
    for (const input of flow.inputs) {
      if (input.required && (inputs[input.key] ?? "").trim() === "") {
        throw new AgentBuilderError(
          "invalid_definition",
          `The skill needs "${input.label}" before it can run.`,
        );
      }
    }
    const existing = await this.ports.files.listProjectFiles(FLOW_RUNS_DIR);
    const id = `RUN_${String(existing.filter((held) => held.endsWith(".json")).length + 1).padStart(4, "0")}`;
    const state: FlowRunState = {
      id,
      flowId: flow.id,
      flowRevision: flow.revision,
      flow,
      inputs,
      status: "running",
      steps: [],
      agentsUsed: [],
      notes: [],
      proposals: [],
      accepted: [],
      measures: {},
      output: flow.output,
    };
    await this.persist(state);
    return this.advance(state);
  }

  /** Continue a persisted run — a fresh process resumes from the file alone. */
  async resume(runId: string): Promise<FlowRunState> {
    const state = await this.get(runId);
    if (state.status !== "running") return state;
    return this.advance(state);
  }

  async approve(runId: string, acceptedProposalIds?: readonly string[]): Promise<FlowRunState> {
    const state = await this.get(runId);
    if (state.status !== "awaiting_approval" || state.approval === undefined) {
      throw new AgentBuilderError("not_awaiting_approval", "This run is not waiting for approval.");
    }
    const accepted = acceptedProposalIds ?? state.proposals.map((held) => held.id);
    const next: FlowRunState = {
      ...state,
      status: "running",
      steps: state.steps.map((step) =>
        step.id === state.approval?.stepId
          ? {
              ...step,
              status: "done" as const,
              summary: `Approved — ${String(accepted.length)} of ${String(state.proposals.length)} proposal(s) accepted.`,
            }
          : step,
      ),
      accepted,
    };
    const cleared: FlowRunState = { ...next };
    delete (cleared as { approval?: unknown }).approval;
    await this.persist(cleared);
    return this.advance(cleared);
  }

  async reject(runId: string): Promise<FlowRunState> {
    const state = await this.get(runId);
    if (state.status !== "awaiting_approval" || state.approval === undefined) {
      throw new AgentBuilderError("not_awaiting_approval", "This run is not waiting for approval.");
    }
    const next: FlowRunState = {
      ...state,
      status: "rejected",
      steps: state.steps.map((step) =>
        step.id === state.approval?.stepId
          ? { ...step, status: "done" as const, summary: "Rejected. Nothing was applied." }
          : step,
      ),
    };
    delete (next as { approval?: unknown }).approval;
    await this.persist(next);
    return next;
  }

  private async advance(initial: FlowRunState): Promise<FlowRunState> {
    let state = initial;
    // Recomputed each pass: an earlier build step may have set the measures a
    // later branch reads, and resume must take the same path the first
    // process would have — the measures are persisted, so it does.
    for (;;) {
      const order = executionOrder(state.flow.steps, state.measures);
      const next = order.find((step) => !state.steps.some((held) => held.id === step.id));
      if (next === undefined) {
        state = { ...state, status: "finished" };
        await this.persist(state);
        return state;
      }
      state = await this.runStep(state, next);
      await this.persist(state);
      if (state.status !== "running") return state;
    }
  }

  private record(
    state: FlowRunState,
    step: FlowStep,
    outcome: Omit<FlowStepRecord, "id" | "kind" | "title">,
    patch: Partial<FlowRunState> = {},
  ): FlowRunState {
    return {
      ...state,
      ...patch,
      steps: [...state.steps, { id: step.id, kind: step.kind, title: step.title, ...outcome }],
    };
  }

  private material(state: FlowRunState): string {
    return state.notes.join("\n");
  }

  private async runStep(state: FlowRunState, step: FlowStep): Promise<FlowRunState> {
    try {
      switch (step.kind) {
        case "search_project": {
          const match = /^\{input\.([a-z0-9_]+)\}$/.exec(step.query.trim());
          const query = match !== null ? (state.inputs[match[1] ?? ""] ?? "") : step.query;
          const lines = await this.ports.searchProject(query);
          return this.record(
            state,
            step,
            { status: "done", summary: `Found ${String(lines.length)} match(es) for “${query}”.` },
            { notes: [...state.notes, ...lines] },
          );
        }
        case "run_tool": {
          if (this.ports.runTool === undefined) {
            return this.record(state, step, {
              status: "skipped",
              summary: "This project cannot run tools here.",
            });
          }
          const summary = await this.ports.runTool(step.tool);
          return this.record(
            state,
            step,
            { status: "done", summary },
            { notes: [...state.notes, summary] },
          );
        }
        case "compile_context": {
          if (this.ports.compileContext === undefined) {
            return this.record(state, step, {
              status: "skipped",
              summary: "Context compilation is not available here.",
            });
          }
          const compiled = await this.ports.compileContext(step.recipe);
          return this.record(
            state,
            step,
            { status: "done", summary: `Compiled the ${step.recipe.replace(/_/g, " ")} context.` },
            { notes: [...state.notes, compiled] },
          );
        }
        case "run_agent":
          return await this.runAgentStep(state, step);
        case "run_story_build": {
          const result = await this.ports.runStoryBuild();
          return this.record(
            state,
            step,
            {
              status: "done",
              summary: `Story Build: ${String(result.errors)} error(s), ${String(result.warnings)} warning(s).`,
            },
            {
              notes: [...state.notes, ...result.lines],
              measures: {
                ...state.measures,
                compiler_errors: result.errors,
                compiler_warnings: result.warnings,
              },
            },
          );
        }
        case "run_story_tests": {
          if (this.ports.runStoryTests === undefined) {
            return this.record(state, step, {
              status: "skipped",
              summary: "Story tests are not available here.",
            });
          }
          const result = await this.ports.runStoryTests();
          return this.record(
            state,
            step,
            { status: "done", summary: `Story tests: ${String(result.failed)} failing.` },
            {
              notes: [...state.notes, ...result.lines],
              measures: { ...state.measures, tests_failed: result.failed },
            },
          );
        }
        case "branch": {
          const taken = holds(step.condition, state.measures);
          return this.record(state, step, {
            status: "done",
            summary: `${step.condition.measure.replace(/_/g, " ")} ${
              step.condition.comparison === "equals" ? "=" : ">"
            } ${String(step.condition.value)} is ${taken ? "true" : "false"} — taking the ${
              taken ? "first" : "second"
            } path.`,
          });
        }
        case "request_approval": {
          return this.record(
            state,
            step,
            { status: "waiting", summary: step.question },
            {
              status: "awaiting_approval",
              approval: { stepId: step.id, question: step.question },
            },
          );
        }
        case "apply_staged_changes": {
          const approved = state.steps.some(
            (held) => held.kind === "request_approval" && held.status === "done",
          );
          if (!approved) {
            throw new AgentBuilderError(
              "step_failed",
              "Apply staged changes ran with no approval before it. Nothing was applied.",
            );
          }
          const accepted = state.proposals.filter((held) => state.accepted.includes(held.id));
          if (accepted.length === 0) {
            return this.record(state, step, {
              status: "done",
              summary: "No accepted proposals to apply.",
            });
          }
          if (this.ports.applyEdits === undefined) {
            return this.record(state, step, {
              status: "skipped",
              summary: "Applying edits is not available here; the proposals remain staged.",
            });
          }
          const applied = await this.ports.applyEdits(accepted);
          return this.record(
            state,
            step,
            {
              status: "done",
              summary: `Applied ${String(applied.applied)} accepted edit(s) as one change set.`,
            },
            { changeSetId: applied.changeSetId },
          );
        }
        case "generate_report": {
          const lines = [
            ...state.notes,
            ...(state.proposals.length > 0
              ? [
                  `${String(state.proposals.length)} proposal(s), ${String(state.accepted.length)} accepted.`,
                ]
              : []),
          ];
          return this.record(
            state,
            step,
            { status: "done", summary: `Report ready: ${String(lines.length)} line(s).` },
            { report: { title: state.flow.name, lines } },
          );
        }
      }
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      return this.record(
        state,
        step,
        { status: "failed", summary: reason },
        { status: "failed", error: reason },
      );
    }
  }

  private async runAgentStep(
    state: FlowRunState,
    step: Extract<FlowStep, { kind: "run_agent" }>,
  ): Promise<FlowRunState> {
    if (this.ports.invoker === null) {
      return this.record(state, step, {
        status: "skipped",
        summary: "No model is configured, so this agent step was skipped — not passed.",
      });
    }
    const definition = this.ports.resolveAgent(step.agent);
    const maxAttempts = Math.min(Math.max(step.retry?.maxAttempts ?? 1, 1), 3);
    let attempts = 0;
    let lastError = "";
    while (attempts < maxAttempts) {
      attempts += 1;
      try {
        const result = await this.ports.invoker.invoke({
          definition,
          ...(definition === null ? { specialist: step.agent } : {}),
          instruction: step.instruction,
          material: this.material(state),
          wantsProposals: definition?.output.kind === "proposals",
        });
        const proposals = result.proposals ?? [];
        return this.record(
          state,
          step,
          {
            status: "done",
            summary: `${String(result.notes.length)} note(s)${
              proposals.length > 0 ? `, ${String(proposals.length)} proposal(s) staged` : ""
            }.`,
            attempts,
          },
          {
            notes: [...state.notes, ...result.notes],
            proposals: [...state.proposals, ...proposals],
            measures: {
              ...state.measures,
              findings: (state.measures.findings ?? 0) + result.notes.length,
            },
            agentsUsed:
              definition === null
                ? state.agentsUsed
                : [
                    ...state.agentsUsed.filter((held) => held.id !== definition.id),
                    { id: definition.id, revision: definition.revision },
                  ],
          },
        );
      } catch (cause) {
        lastError = cause instanceof Error ? cause.message : String(cause);
      }
    }
    const reason = `${step.title} failed after ${String(attempts)} attempt(s): ${lastError}`;
    return this.record(
      state,
      step,
      { status: "failed", summary: reason, attempts },
      { status: "failed", error: reason },
    );
  }
}
