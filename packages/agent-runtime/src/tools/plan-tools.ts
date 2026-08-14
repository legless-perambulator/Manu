import { objectSchema } from "../schema";
import { eraseTool, type RegisteredTool, type Tool } from "../tool";
import { ToolError } from "../errors";
import type { ChapterPlanLike, ProjectAccess } from "../ports";

/**
 * Chapter-plan tools (Phase 32 §13–14).
 *
 * The Story Architect and the Scene Director operate on **structured plans**
 * through these, not on prose advice: a plan scene is a typed record the
 * harness validates, stores as a draft, and puts in front of the writer.
 *
 * The boundary that matters: `create_scene_plan` and `revise_scene_plan` write
 * a *draft plan* — a proposal document — under the `edit_plans` permission.
 * There is deliberately **no approve tool**. Approval materialises scenes and
 * unlocks the Chapter Builder, and that decision belongs to the writer alone
 * (docs/PLANNING.md).
 */

/** The scenes of a plan, as records the tools can read and rebuild. */
function scenesOf(plan: ChapterPlanLike): Record<string, unknown>[] {
  return plan.scenes.filter(
    (scene): scene is Record<string, unknown> => typeof scene === "object" && scene !== null,
  );
}

function requirePlans(access: ProjectAccess, tool: string) {
  const get = access.getChapterPlan?.bind(access);
  const save = access.saveChapterPlan?.bind(access);
  const validate = access.validateChapterPlan?.bind(access);
  if (get === undefined || save === undefined || validate === undefined) {
    throw new ToolError("tool_failed", tool, "This project does not support chapter plans.");
  }
  return { get, save, validate };
}

/** A draft plan shell for a chapter that has none yet. */
function emptyPlan(chapterId: string): ChapterPlanLike {
  // The extra fields beyond the structural port type are the repository's plan
  // shape; carried as data so a fresh draft is complete on disk.
  const shell = {
    id: `PLANFOR_${chapterId}`,
    chapterId,
    status: "draft",
    scenes: [],
    activePlotThreadIds: [],
    requiredSetupIds: [],
    requiredPayoffIds: [],
    characterArcMovement: [],
    forbiddenFacts: [],
    constraints: [],
    notes: [],
    source: "model",
  };
  return shell as ChapterPlanLike;
}

const SCENE_FIELDS = {
  title: { type: "string" as const, description: "What the scene is called in the plan." },
  pov: { type: "string" as const, description: "POV character id (CHAR_…).", optional: true },
  locationId: { type: "string" as const, description: "Location id (LOC_…).", optional: true },
  characterIds: {
    type: "string[]" as const,
    description: "Character ids present in the scene.",
    optional: true,
  },
  objective: { type: "string" as const, description: "What the scene is for.", optional: true },
  conflict: { type: "string" as const, description: "What resists it.", optional: true },
  exitState: {
    type: "string" as const,
    description: "Where things stand coming out.",
    optional: true,
  },
  beats: {
    type: "string[]" as const,
    description: "Ordered narrative beats, as short statements.",
    optional: true,
  },
};

function plannedSceneFrom(input: Record<string, unknown>, key: string): Record<string, unknown> {
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  return {
    key,
    title: typeof input.title === "string" ? input.title : "Untitled scene",
    ...(typeof input.pov === "string" ? { pov: input.pov } : {}),
    ...(typeof input.locationId === "string" ? { locationId: input.locationId } : {}),
    characterIds: list(input.characterIds),
    objectIds: [],
    ...(typeof input.objective === "string" ? { objective: input.objective } : {}),
    ...(typeof input.conflict === "string" ? { conflict: input.conflict } : {}),
    ...(typeof input.exitState === "string" ? { exitState: input.exitState } : {}),
    beats: list(input.beats),
    revelations: [],
    knowledgeChanges: [],
    relationshipChanges: [],
    plotThreadIds: [],
    setupIds: [],
    payoffSetupIds: [],
    requiredFactIds: [],
  };
}

export function inspectScenePlanTool(
  access: ProjectAccess,
): Tool<{ chapterId: string; sceneKey?: string }, unknown> {
  return {
    name: "inspect_scene_plan",
    description:
      "Read a chapter's plan: its objective, constraints and planned scenes — or one planned scene by key. Returns null when the chapter has no plan.",
    permission: "read_canon",
    inputSchema: objectSchema("InspectScenePlanInput", {
      chapterId: { type: "string", description: "The chapter (CHAPTER_…)." },
      sceneKey: {
        type: "string",
        description: "A planned scene's key, to read just that scene.",
        optional: true,
      },
    }),
    outputSchema: objectSchema("InspectScenePlanOutput", {
      plan: { type: "object", description: "The plan, one scene of it, or null." },
    }),
    async handler(input) {
      const { get } = requirePlans(access, "inspect_scene_plan");
      const plan = await get(input.chapterId);
      if (plan === null || input.sceneKey === undefined) return { plan };
      const scene = scenesOf(plan).find((entry) => entry.key === input.sceneKey) ?? null;
      return { plan: scene };
    },
  };
}

export function validateScenePlanTool(access: ProjectAccess): Tool<{ chapterId: string }, unknown> {
  return {
    name: "validate_scene_plan",
    description:
      "Run the deterministic plan checks over a chapter's current plan: unknown references, forbidden knowledge the plan grants, payoffs without setups, things recorded elsewhere at the chapter's entry. Changes nothing.",
    permission: "read_canon",
    inputSchema: objectSchema("ValidateScenePlanInput", {
      chapterId: { type: "string", description: "The chapter (CHAPTER_…)." },
    }),
    outputSchema: objectSchema("ValidateScenePlanOutput", {
      findings: { type: "object[]", description: "Deterministic findings, empty when clean." },
    }),
    async handler(input) {
      const { get, validate } = requirePlans(access, "validate_scene_plan");
      const plan = await get(input.chapterId);
      if (plan === null) {
        throw new ToolError(
          "tool_failed",
          "validate_scene_plan",
          `No plan exists for ${input.chapterId}.`,
        );
      }
      return { findings: await validate(plan) };
    },
  };
}

export function createScenePlanTool(
  access: ProjectAccess,
): Tool<Record<string, unknown> & { chapterId: string }, unknown> {
  return {
    name: "create_scene_plan",
    description:
      "Add a planned scene to a chapter's draft plan, creating the draft if none exists. A quick plan — title, POV, objective, conflict, outcome — is enough; beats are optional. The plan stays a draft for the writer to review; nothing is approved by this tool.",
    permission: "edit_plans",
    inputSchema: objectSchema("CreateScenePlanInput", {
      chapterId: { type: "string", description: "The chapter (CHAPTER_…)." },
      ...SCENE_FIELDS,
    }),
    outputSchema: objectSchema("CreateScenePlanOutput", {
      plan: { type: "object", description: "The updated draft plan." },
    }),
    async handler(input) {
      const { get, save } = requirePlans(access, "create_scene_plan");
      const existing = (await get(input.chapterId)) ?? emptyPlan(input.chapterId);
      if (existing.status === "approved") {
        throw new ToolError(
          "tool_failed",
          "create_scene_plan",
          `The plan for ${input.chapterId} is approved. Changing it is the writer's decision — ask them to reopen it.`,
        );
      }
      const key = `s${String(existing.scenes.length + 1)}`;
      const scenes = [...scenesOf(existing), plannedSceneFrom(input, key)];
      const plan = await save({ ...existing, scenes }, { actor: "agent", note: "scene added" });
      return { plan };
    },
  };
}

export function reviseScenePlanTool(
  access: ProjectAccess,
): Tool<Record<string, unknown> & { chapterId: string; sceneKey: string }, unknown> {
  return {
    name: "revise_scene_plan",
    description:
      "Revise one planned scene in a chapter's draft plan, by key. Only the fields given change; beats given replace the scene's beats wholesale.",
    permission: "edit_plans",
    inputSchema: objectSchema("ReviseScenePlanInput", {
      chapterId: { type: "string", description: "The chapter (CHAPTER_…)." },
      sceneKey: { type: "string", description: "The planned scene's key." },
      ...SCENE_FIELDS,
    }),
    outputSchema: objectSchema("ReviseScenePlanOutput", {
      plan: { type: "object", description: "The updated draft plan." },
    }),
    async handler(input) {
      const { get, save } = requirePlans(access, "revise_scene_plan");
      const existing = await get(input.chapterId);
      if (existing === null) {
        throw new ToolError(
          "tool_failed",
          "revise_scene_plan",
          `No plan exists for ${input.chapterId}.`,
        );
      }
      if (existing.status === "approved") {
        throw new ToolError(
          "tool_failed",
          "revise_scene_plan",
          `The plan for ${input.chapterId} is approved. Changing it is the writer's decision — ask them to reopen it.`,
        );
      }
      const held = scenesOf(existing);
      const at = held.findIndex((scene) => scene.key === input.sceneKey);
      if (at === -1) {
        throw new ToolError(
          "tool_failed",
          "revise_scene_plan",
          `No planned scene "${input.sceneKey}" in the plan for ${input.chapterId}.`,
        );
      }
      const patch = plannedSceneFrom(input, input.sceneKey);
      const current = held[at] as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...current };
      for (const field of [
        "title",
        "pov",
        "locationId",
        "objective",
        "conflict",
        "exitState",
      ] as const) {
        if (typeof input[field] === "string") merged[field] = patch[field];
      }
      if (Array.isArray(input.characterIds)) merged.characterIds = patch.characterIds;
      if (Array.isArray(input.beats)) merged.beats = patch.beats;
      const scenes = [...held];
      scenes[at] = merged;
      const plan = await save({ ...existing, scenes }, { actor: "agent", note: "scene revised" });
      return { plan };
    },
  };
}

/** All plan tools, registered only when the project supports plans. */
export function createPlanTools(access: ProjectAccess): RegisteredTool[] {
  if (access.getChapterPlan === undefined) return [];
  return [
    eraseTool(inspectScenePlanTool(access)),
    eraseTool(validateScenePlanTool(access)),
    eraseTool(createScenePlanTool(access)),
    eraseTool(reviseScenePlanTool(access)),
  ];
}

export const PLAN_TOOL_NAMES = [
  "inspect_scene_plan",
  "validate_scene_plan",
  "create_scene_plan",
  "revise_scene_plan",
] as const;
