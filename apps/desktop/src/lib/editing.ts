import { DiagnosisAnalyst, ManuscriptEditor } from "@jellytind/editing";
import type { PermissionGrant } from "@jellytind/agent-runtime";
import type { SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import { createConfiguredModel, loadModelSettings } from "./models";

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
  const model = await createConfiguredModel(loadModelSettings(), secrets);
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
  const model = await createConfiguredModel(loadModelSettings(), secrets);
  return new DiagnosisAnalyst({ repo, model, grant: STORY_DEBUG_GRANT });
}
