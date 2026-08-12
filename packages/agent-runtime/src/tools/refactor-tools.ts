import { objectSchema } from "../schema";
import { eraseTool, type RegisteredTool, type Tool } from "../tool";
import { ToolError } from "../errors";
import type { ProjectAccess, RefactorRequestLike } from "../ports";

/**
 * The Story Refactor tool.
 *
 * **Analysis only.** An agent may work out what a structural change would
 * reach — which is genuinely useful, and read-only — but it may not stage one
 * and it may not apply one. A refactor rewrites a novel's architecture across
 * files a writer is not looking at, and the decision to do that belongs to the
 * person whose book it is (docs/STORY_REFACTOR.md).
 *
 * There is deliberately no `stage_story_refactor` and no `apply_story_refactor`.
 * When agents are eventually trusted with more, it will be through the
 * approval workflow rather than by widening this tool.
 */

const KINDS = "rename_entity, change_relationship, change_character_attribute, move_story_event";

export function analyseStoryRefactorTool(access: ProjectAccess): Tool<
  {
    kind: string;
    instruction?: string;
    entityId?: string;
    newName?: string;
    relationshipId?: string;
    newType?: string;
    characterId?: string;
    field?: string;
    newValue?: string;
    sceneId?: string;
    toChapterId?: string;
    oldTerms?: string;
  },
  unknown
> {
  return {
    name: "analyse_story_refactor",
    description: `Work out what a structural story change would reach: the entities, the dependency blast radius, the manuscript references and the recorded risks. Kinds: ${KINDS}. Analysis only — this changes nothing and cannot stage or apply a refactor.`,
    permission: "read_canon",
    inputSchema: objectSchema("AnalyseStoryRefactorInput", {
      kind: { type: "string", description: `One of: ${KINDS}.` },
      instruction: {
        type: "string",
        description: "The change in the writer's own words, when they stated one.",
        optional: true,
      },
      entityId: {
        type: "string",
        description: "For rename_entity: what to rename.",
        optional: true,
      },
      newName: { type: "string", description: "For rename_entity: the new name.", optional: true },
      relationshipId: {
        type: "string",
        description: "For change_relationship: REL_ id.",
        optional: true,
      },
      newType: {
        type: "string",
        description: "For change_relationship: what they become to each other.",
        optional: true,
      },
      characterId: {
        type: "string",
        description: "For change_character_attribute: CHAR_ id.",
        optional: true,
      },
      field: {
        type: "string",
        description: "For change_character_attribute: role, description or goals.",
        optional: true,
      },
      newValue: {
        type: "string",
        description: "For change_character_attribute: the new value.",
        optional: true,
      },
      sceneId: { type: "string", description: "For move_story_event: SCENE_ id.", optional: true },
      toChapterId: {
        type: "string",
        description: "For move_story_event: CHAPTER_ id to move it into.",
        optional: true,
      },
      oldTerms: {
        type: "string",
        description:
          'Comma-separated words the old state put in the prose, e.g. "brother, sibling". Only the writer knows which words their book uses.',
        optional: true,
      },
    }),
    outputSchema: objectSchema("AnalyseStoryRefactorOutput", {
      summary: { type: "string", description: "The change in one line." },
      affected: { type: "object[]", description: "Every structured thing it reaches, and why." },
      counts: { type: "object", description: "Affected counts by entity kind." },
      manuscriptReferences: {
        type: "object[]",
        description: "Where the prose says the words involved.",
      },
      risks: { type: "object[]", description: "Recorded risks, each labelled with its source." },
      highRisk: { type: "string[]", description: "The IDs most at risk." },
    }),
    async handler(input) {
      if (access.analyseStoryRefactor === undefined) {
        throw new ToolError(
          "tool_failed",
          "analyse_story_refactor",
          "This project does not support refactor analysis.",
        );
      }

      const terms =
        input.oldTerms === undefined
          ? undefined
          : input.oldTerms
              .split(",")
              .map((t) => t.trim())
              .filter((t) => t !== "");

      const request: RefactorRequestLike = {
        kind: input.kind,
        ...(input.instruction !== undefined ? { instruction: input.instruction } : {}),
        ...(input.entityId !== undefined ? { entityId: input.entityId } : {}),
        ...(input.newName !== undefined ? { newName: input.newName } : {}),
        ...(input.relationshipId !== undefined ? { relationshipId: input.relationshipId } : {}),
        ...(input.newType !== undefined ? { newType: input.newType } : {}),
        ...(input.characterId !== undefined ? { characterId: input.characterId } : {}),
        ...(input.field !== undefined ? { field: input.field } : {}),
        ...(input.newValue !== undefined ? { newValue: input.newValue } : {}),
        ...(input.sceneId !== undefined ? { sceneId: input.sceneId } : {}),
        ...(input.toChapterId !== undefined ? { toChapterId: input.toChapterId } : {}),
        ...(terms !== undefined ? { oldTerms: terms } : {}),
      };

      const analysis = await access.analyseStoryRefactor(request);
      return {
        summary: analysis.summary,
        affected: analysis.affected,
        counts: analysis.counts,
        manuscriptReferences: analysis.manuscriptReferences,
        risks: analysis.risks,
        highRisk: analysis.highRisk,
      };
    },
  };
}

/** The refactor tool, when the project supports it. */
export function createRefactorTools(access: ProjectAccess): RegisteredTool[] {
  if (access.analyseStoryRefactor === undefined) return [];
  return [eraseTool(analyseStoryRefactorTool(access))];
}

export const REFACTOR_TOOL_NAMES: readonly string[] = ["analyse_story_refactor"];
