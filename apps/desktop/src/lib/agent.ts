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
} from "@jellytind/agent-runtime";
import type { SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import { refactorAccess } from "@jellytind/story-refactor";
import { createConfiguredModel, loadModelSettings } from "./models";

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
  readonly onActivity: (event: AgentActivityEvent, line: string) => void;
  readonly onTaskCreated?: (taskId: string) => void;
}

export async function startInvestigation(
  options: StartInvestigationOptions,
): Promise<InvestigationHandle> {
  const { repo, secrets, question, onActivity } = options;

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

  // Phase 7 is read-only: the grant carries no write permission at all, so no
  // configuration mistake here can turn an investigation into an edit.
  const executor = new ToolExecutor({ registry, grant: READ_ONLY_GRANT, store: repo.agents });

  const model = await createConfiguredModel(loadModelSettings(), secrets);
  const agent = new InvestigationAgent({ model, executor, store: repo.agents });

  const task = createTask({
    id: await repo.agents.nextTaskId(),
    goal: question,
    now: new Date().toISOString(),
    allowedTools: INVESTIGATOR_AGENT.permittedTools,
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
