import {
  DependencyAnalyst,
  DiagnosisAnalyst,
  ManuscriptEditor,
  ModelAgentWorkExecutor,
  ModelCharacterAnalyst,
  ModelReaderAnalyst,
  ModelSkillAnalyst,
} from "@jellytind/editing";
import type { PermissionGrant } from "@jellytind/agent-runtime";
import type { SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import { RefactorPlanner } from "@jellytind/story-refactor";
import { ModelError } from "@jellytind/model-router";
import { capabilityProblem, createConfiguredModel, createModelForClass } from "./models";

/**
 * The permission grant AI editing runs under.
 *
 * Reading is granted so the Context Compiler can do its work; `edit_manuscript`
 * is granted so prose operations are permitted. Nothing else is — no entity
 * creation, no deletion, no branching — so a mistake in this layer cannot reach
 * story state (docs/AGENT_RUNTIME.md — "Permissions").
 */
export const MANUSCRIPT_EDIT_GRANT: PermissionGrant = {
  permissions: ["read_manuscript", "read_canon", "edit_manuscript"],
  allowedTools: ["rewrite_selection", "rewrite_scene", "continue_scene"],
};

/**
 * Build a {@link ManuscriptEditor} for the open project, reading the API key
 * from secure storage at call time via the provider-independent layer.
 */
export async function createManuscriptEditor(
  repo: StoryRepository,
  secrets: SecretStore,
): Promise<ManuscriptEditor> {
  // Every edit arrives as a structured proposal a human reviews, so a model
  // known not to produce structured output cannot do this work at all.
  const refusal = capabilityProblem("drafting", ["structuredOutput"]);
  if (refusal !== null) throw new ModelError("unsupported", refusal);

  const model = await createConfiguredModel(secrets, "drafting");
  return new ManuscriptEditor({ repo, model, grant: MANUSCRIPT_EDIT_GRANT });
}

/** Turn an editing failure into guidance a writer can act on. */
export function explainEditError(error: unknown): string {
  if (error instanceof Error && "editCode" in error) {
    const code = (error as { editCode: string }).editCode;
    if (code === "stale_selection") {
      return "The text changed since you selected it. Re-select the passage and try again.";
    }
    if (code === "no_change") {
      return "The model returned the passage unchanged — nothing to review.";
    }
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * The permission grant story debugging runs under.
 *
 * Read-only, and deliberately narrower than the editing grant: the debugger
 * diagnoses. Nothing it produces can reach the manuscript, so no mistake in
 * this layer can turn an investigation into an edit
 * (docs/STORY_DEBUGGER.md).
 */
export const STORY_DEBUG_GRANT: PermissionGrant = {
  permissions: ["read_manuscript", "read_canon"],
  allowedTools: ["story_debug"],
};

/**
 * Build a {@link DiagnosisAnalyst} for the open project.
 *
 * Only needed to *interpret* a trace — `repo.traceStoryProblem` needs no model
 * at all, which is why the Debug panel works before one is configured.
 */
export async function createDiagnosisAnalyst(
  repo: StoryRepository,
  secrets: SecretStore,
): Promise<DiagnosisAnalyst> {
  const model = await createConfiguredModel(secrets, "reasoning");
  return new DiagnosisAnalyst({ repo, model, grant: STORY_DEBUG_GRANT });
}

/**
 * Build a {@link DependencyAnalyst} for the open project.
 *
 * Read-only: it proposes causality, and everything it proposes is stored as
 * `proposed` for a human to accept or reject (docs/STORY_REFACTOR.md).
 */
export async function createDependencyAnalyst(
  repo: StoryRepository,
  secrets: SecretStore,
): Promise<DependencyAnalyst> {
  const model = await createConfiguredModel(secrets, "reasoning");
  return new DependencyAnalyst({ repo, model, grant: STORY_DEBUG_GRANT });
}

/**
 * The permission grant Story Refactor runs under.
 *
 * `edit_manuscript` because a refactor rewrites prose; nothing wider, so a
 * mistake here cannot delete an entity or branch the project
 * (docs/STORY_REFACTOR.md).
 */
export const STORY_REFACTOR_GRANT: PermissionGrant = {
  permissions: ["read_manuscript", "read_canon", "edit_manuscript"],
  allowedTools: ["story_refactor"],
};

/**
 * Build a {@link RefactorPlanner} for the open project.
 *
 * Only needed to add the model's reading of the consequences and its sentence
 * rewrites — the deterministic plan needs no model, which is why a refactor
 * works before one is configured.
 */
export async function createRefactorPlanner(
  repo: StoryRepository,
  secrets: SecretStore,
): Promise<RefactorPlanner> {
  const model = await createConfiguredModel(secrets, "reasoning");
  return new RefactorPlanner({ repo, model });
}

/**
 * The permission grant a Writing Skill's semantic steps run under.
 *
 * Read-only, and narrower still than the debugger's: a skill's model steps
 * observe material the deterministic steps already retrieved. Nothing a skill
 * produces reaches the manuscript (docs/WRITING_SKILLS.md).
 */
export const SKILL_READING_GRANT: PermissionGrant = {
  permissions: ["read_manuscript", "read_canon"],
  allowedTools: ["skill_reading"],
};

/**
 * Build the analyst a skill's semantic steps use, or `null` when no model is
 * configured — in which case those steps are skipped with a stated reason and
 * every deterministic step still runs.
 */
export async function createSkillAnalyst(secrets: SecretStore): Promise<ModelSkillAnalyst | null> {
  try {
    const model = await createConfiguredModel(secrets, "utility");
    return new ModelSkillAnalyst({ model, grant: SKILL_READING_GRANT });
  } catch {
    return null;
  }
}

/**
 * Build the executor a multi-agent workflow's steps run through.
 *
 * Each step's routing class resolves to its own configured model, so a
 * premium-prose draft and a cheap-analysis review can genuinely run on
 * different models. With nothing configured this returns `null`, and the
 * workflow's agent steps are skipped with a stated reason while its
 * deterministic nodes — checkpoint, build — still run (docs/ORCHESTRATION.md).
 */
export async function createAgentWorkExecutor(
  repo: StoryRepository,
  secrets: SecretStore,
): Promise<ModelAgentWorkExecutor | null> {
  try {
    // One probe: if the default model cannot be built, nothing here can run.
    await createConfiguredModel(secrets);
  } catch {
    return null;
  }
  return new ModelAgentWorkExecutor({
    repo,
    modelFor: (routingClass) => createModelForClass(routingClass, secrets),
  });
}

/**
 * Build the reader a simulation runs as, or `null` when no model is configured.
 *
 * Unlike the deterministic subsystems, a reader simulation has no useful half
 * without a model: interpretation is the whole of what it produces, so the
 * panel says so rather than offering an empty run (docs/SIMULATIONS.md).
 */
export async function createReaderAnalyst(
  secrets: SecretStore,
): Promise<ModelReaderAnalyst | null> {
  try {
    const model = await createConfiguredModel(secrets, "simulation");
    return new ModelReaderAnalyst({ model });
  } catch {
    return null;
  }
}

/**
 * Build the judge a character simulation uses, or `null` when no model is
 * configured — in which case the deterministic half still runs and says what it
 * could not weigh (docs/SIMULATIONS.md).
 */
export async function createCharacterAnalyst(
  secrets: SecretStore,
): Promise<ModelCharacterAnalyst | null> {
  try {
    const model = await createConfiguredModel(secrets, "simulation");
    return new ModelCharacterAnalyst({ model });
  } catch {
    return null;
  }
}
