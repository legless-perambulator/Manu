import { conditionMap, surfaceOf, validateWorkflowGraph } from "./graph";
import {
  OrchestrationError,
  type WorkflowDefinition,
  type WorkflowInput,
  type WorkflowNode,
} from "./types";

/**
 * The workflows Manu ships with.
 *
 * A workflow is **data**: a list of nodes naming specialists, artifacts and
 * conditions. It is validated when it is defined, so a workflow that could not
 * work never reaches a run (docs/ORCHESTRATION.md).
 */

export function defineWorkflow(input: {
  id: string;
  name: string;
  description: string;
  inputs?: readonly WorkflowInput[];
  nodes: readonly WorkflowNode[];
}): WorkflowDefinition {
  const draft = {
    id: input.id,
    name: input.name,
    description: input.description,
    inputs: input.inputs ?? [],
    nodes: input.nodes,
  };
  validateWorkflowGraph(draft, conditionMap());
  const { agents, routingClasses } = surfaceOf(input.nodes);
  return { ...draft, agents, routingClasses };
}

const CHAPTER_INPUT: WorkflowInput = {
  key: "chapterId",
  label: "Chapter",
  entityKind: "chapter",
  required: true,
};

/**
 * _Develop and draft Chapter 17._
 *
 * The pipeline from the specification, with the two things a pipeline drawing
 * leaves out: the three editors review the draft **in parallel** because their
 * subjects are independent, and their results are **merged** rather than
 * chained — so the Prose Editor cannot quietly overwrite what the Character
 * Editor asked for.
 *
 * Nothing reaches the manuscript without a checkpoint and the writer's word.
 */
export const CHAPTER_WORKFLOW = defineWorkflow({
  id: "chapter_development",
  name: "Chapter Development",
  description:
    "Architect a chapter, plan its scenes, draft it, review it three ways, and write it only after you approve.",
  inputs: [CHAPTER_INPUT],
  nodes: [
    {
      kind: "agent",
      id: "architect",
      title: "Architect",
      agent: "story_architect",
      instruction:
        "Say what this chapter has to accomplish in the book: what it must achieve, what constrains it, which threads it carries, and what could go wrong.",
      reads: [],
      produces: "chapter_brief",
      routingClass: "premium_reasoning",
      contextRecipe: "chapter_inspection",
    },
    {
      kind: "agent",
      id: "scene_director",
      title: "Scene Director",
      agent: "scene_director",
      instruction:
        "Turn the brief into scenes: objective, conflict, beats and the reversal for each. Do not write prose.",
      reads: ["chapter_brief"],
      produces: "scene_plan",
      routingClass: "premium_reasoning",
      contextRecipe: "chapter_inspection",
    },
    {
      kind: "approval",
      id: "approve_plan",
      title: "Approve the plan",
      question: "Is this the chapter you want written?",
      reads: ["chapter_brief", "scene_plan"],
    },
    {
      kind: "agent",
      id: "draft",
      title: "Draft",
      agent: "drafter",
      instruction:
        "Write the chapter from the plan, in the author's voice and each character's voice, respecting story state at this point in the book.",
      reads: ["chapter_brief", "scene_plan"],
      produces: "draft",
      routingClass: "premium_prose",
      contextRecipe: "scene_rewrite",
      // Prose is the expensive step and the one most worth retrying: a
      // malformed response costs a call, not the chapter.
      maxAttempts: 2,
    },
    {
      kind: "parallel",
      id: "review",
      title: "Review",
      branches: [
        {
          kind: "agent",
          id: "character_review",
          title: "Character Review",
          agent: "character_editor",
          instruction:
            "Does everyone behave like themselves, and does the chapter move their arc? Note what to keep, revise or cut, and say which.",
          reads: ["draft", "chapter_brief"],
          produces: "character_notes",
          routingClass: "cheap_analysis",
        },
        {
          kind: "agent",
          id: "continuity_review",
          title: "Continuity",
          agent: "continuity_editor",
          instruction:
            "Check the draft against what the project already knows: timeline, who knows what, objects, world rules.",
          reads: ["draft"],
          produces: "continuity_report",
          routingClass: "cheap_analysis",
        },
        {
          kind: "agent",
          id: "prose_review",
          title: "Prose",
          agent: "prose_editor",
          instruction:
            "Work at the level of the sentence: rhythm, imagery, unintended repetition, clarity.",
          reads: ["draft"],
          produces: "prose_notes",
          routingClass: "cheap_analysis",
        },
      ],
    },
    {
      kind: "merge",
      id: "merge_reviews",
      title: "Merge reviews",
      reads: ["character_notes", "continuity_report", "prose_notes"],
      produces: "merged_review",
    },
    {
      kind: "checkpoint",
      id: "checkpoint",
      title: "Checkpoint",
      label: "Before chapter draft",
    },
    {
      kind: "approval",
      id: "approve_draft",
      title: "Approve the draft",
      question: "Write this draft into the chapter?",
      reads: ["draft", "merged_review"],
      // Where the editors disagree, the writer decides before anything is
      // written. Neither position is discarded.
      requiresDisagreementsResolved: true,
    },
    {
      kind: "apply",
      id: "apply",
      title: "Write the chapter",
      reads: ["draft"],
    },
    {
      kind: "build",
      id: "build",
      title: "Build",
      produces: "build_result",
    },
    {
      kind: "conditional",
      id: "when_build_broke",
      title: "If the build found errors",
      when: "build_has_errors",
      children: [
        {
          kind: "agent",
          id: "diagnose",
          title: "Diagnose the build",
          agent: "continuity_editor",
          instruction:
            "The build reported errors after this chapter was written. Say what in the new chapter caused each, and what would fix it. Propose; change nothing.",
          reads: ["build_result", "draft"],
          produces: "revision_proposal",
          routingClass: "premium_reasoning",
        },
      ],
    },
  ],
});

/**
 * A shorter pipeline for a chapter that already exists: review it three ways
 * and hand back what they said, including where they disagree. Writes nothing.
 */
export const CHAPTER_REVIEW_WORKFLOW = defineWorkflow({
  id: "chapter_review",
  name: "Chapter Review",
  description:
    "Three specialists review an existing chapter in parallel; their findings are merged and their disagreements kept whole.",
  inputs: [CHAPTER_INPUT],
  nodes: [
    {
      kind: "build",
      id: "build",
      title: "Build",
      produces: "build_result",
    },
    {
      kind: "agent",
      id: "brief",
      title: "Architect",
      agent: "story_architect",
      instruction: "Say what this chapter is doing in the book as it currently stands.",
      reads: [],
      produces: "chapter_brief",
      routingClass: "premium_reasoning",
      contextRecipe: "chapter_inspection",
    },
    {
      kind: "parallel",
      id: "review",
      title: "Review",
      branches: [
        {
          kind: "agent",
          id: "character_review",
          title: "Character Review",
          agent: "character_editor",
          instruction: "Behaviour, motivation and arc. Say keep, revise or cut for each note.",
          reads: ["chapter_brief"],
          produces: "character_notes",
          routingClass: "cheap_analysis",
        },
        {
          kind: "agent",
          id: "continuity_review",
          title: "Continuity",
          agent: "continuity_editor",
          instruction: "Check against the build and the project's records.",
          reads: ["build_result"],
          produces: "continuity_report",
          routingClass: "cheap_analysis",
        },
      ],
    },
    {
      kind: "merge",
      id: "merge_reviews",
      title: "Merge reviews",
      reads: ["character_notes", "continuity_report"],
      produces: "merged_review",
    },
    {
      kind: "approval",
      id: "accept",
      title: "Read the review",
      question: "Accept this review?",
      reads: ["merged_review"],
    },
  ],
});

export const WORKFLOWS: readonly WorkflowDefinition[] = [CHAPTER_WORKFLOW, CHAPTER_REVIEW_WORKFLOW];

export function workflowById(id: string): WorkflowDefinition {
  const found = WORKFLOWS.find((workflow) => workflow.id === id);
  if (found === undefined) {
    throw new OrchestrationError("unknown_workflow", `No workflow with id "${id}".`, {
      details: { workflow: id },
    });
  }
  return found;
}
