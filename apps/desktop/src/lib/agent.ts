import {
  createBuildTools,
  createTestTools,
  createDebugTools,
  createRefactorTools,
  createProjectTools,
  createTask,
  InvestigationAgent,
  READ_ONLY_GRANT,
  INVESTIGATOR_AGENT,
  ToolExecutor,
  ToolRegistry,
  type AgentActivityEvent,
  type AgentRunResult,
  type ProjectAccess,
  agentById,
  grantFor,
} from "@jellytind/agent-runtime";
import type { SpecialistId } from "@jellytind/agent-runtime";
import type { SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import { refactorAccess } from "@jellytind/story-refactor";
import { ModelError } from "@jellytind/model-router";
import { capabilityProblem, createConfiguredModel } from "./models";

/**
 * Wiring for the desktop Agent panel.
 *
 * The application assembles the pieces — repository, tool registry, executor,
 * model — and then stays out of the way. It holds no story logic and no
 * provider knowledge: the repository satisfies the runtime's `ProjectAccess`
 * port, and the model arrives through the provider-independent layer
 * (docs/AGENT_RUNTIME.md).
 */
export interface InvestigationHandle {
  readonly result: Promise<AgentRunResult>;
  /** Stop the run; the task ends `cancelled`. */
  cancel(): void;
}

export interface StartInvestigationOptions {
  readonly repo: StoryRepository;
  readonly secrets: SecretStore;
  readonly question: string;
  /** Run as a named specialist rather than the general investigator. */
  readonly specialistId?: SpecialistId;
  readonly onActivity: (event: AgentActivityEvent, line: string) => void;
  readonly onTaskCreated?: (taskId: string) => void;
}

export async function startInvestigation(
  options: StartInvestigationOptions,
): Promise<InvestigationHandle> {
  const { repo, secrets, question, onActivity } = options;
  // A specialist runs under its own grant: its tool list and its permissions,
  // both enforced by the executor (docs/SPECIALIST_AGENTS.md). With none
  // chosen, the general investigator's read-only grant applies.
  const specialist = options.specialistId === undefined ? null : agentById(options.specialistId);

  // The repository satisfies the runtime's read port directly.
  // The repository plus refactor analysis: the composition lives in
  // @jellytind/story-refactor, which is the layer that depends on both.
  const access: ProjectAccess = refactorAccess(repo);
  const registry = new ToolRegistry().register(
    ...createProjectTools(access),
    ...createBuildTools(access),
    ...createTestTools(access),
    ...createDebugTools(access),
    ...createRefactorTools(access),
  );

  // This registry holds no editing tool, so nothing run here can write to the
  // manuscript whatever permissions a specialist carries — an editing
  // specialist's `edit_manuscript` is spent through the Manuscript Editor
  // (docs/EDITING.md), which applies its own approval gate.
  const grant = specialist === null ? READ_ONLY_GRANT : grantFor(specialist);
  const executor = new ToolExecutor({ registry, grant, store: repo.agents });

  // An investigation *is* a tool loop. A model known not to call tools cannot
  // run one, and saying so now beats a mystifying empty answer later
  // (docs/MODEL_ROUTER.md — capabilities).
  const refusal = capabilityProblem("reasoning", ["tools"]);
  if (refusal !== null) throw new ModelError("unsupported", refusal);

  const model = await createConfiguredModel(secrets, "reasoning");
  const agent = new InvestigationAgent({ model, executor, store: repo.agents });

  const task = createTask({
    id: await repo.agents.nextTaskId(),
    goal: question,
    now: new Date().toISOString(),
    allowedTools: specialist === null ? INVESTIGATOR_AGENT.permittedTools : specialist.tools,
    approvalPolicy: "approve_every_edit",
  });
  await repo.agents.saveTask(task);
  options.onTaskCreated?.(task.id);

  const controller = new AbortController();
  return {
    result: agent.run(task, { signal: controller.signal, onActivity }),
    cancel: () => controller.abort(),
  };
}
