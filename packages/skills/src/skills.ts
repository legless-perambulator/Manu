import { operationById, sectionsOf, surfaceOf, validateWorkflow } from "./operations";
import { SkillError, type SkillDefinition, type SkillInput, type SkillStep } from "./types";

/**
 * The skills Manu ships with.
 *
 * Each is a **sequence of named operations**, not a prompt. That is the whole
 * claim of this phase: `/character-pass` is eight structured queries against
 * the project's own reconstruction, in an order that makes each one useful to
 * the next, and it produces the same report twice on an unchanged project
 * (docs/WRITING_SKILLS.md).
 */

/** Build a skill, deriving its declared surface from the steps it names. */
export function defineSkill(input: {
  id: string;
  command: string;
  name: string;
  description: string;
  inputs?: readonly SkillInput[];
  steps: ReadonlyArray<{ operationId: string; id?: string; title?: string }>;
  preferredAgent?: string;
  module?: string;
  custom?: boolean;
}): SkillDefinition {
  const inputs = input.inputs ?? [];
  const steps: SkillStep[] = input.steps.map((step) => {
    const operation = operationById(step.operationId);
    return {
      id: step.id ?? step.operationId,
      operationId: step.operationId,
      title: step.title ?? operation.title,
    };
  });

  validateWorkflow(steps, inputs);
  const { requiredTools, contextRecipes } = surfaceOf(steps);

  return {
    id: input.id,
    command: input.command,
    name: input.name,
    description: input.description,
    inputs,
    steps,
    requiredTools,
    contextRecipes,
    ...(input.preferredAgent === undefined ? {} : { preferredAgent: input.preferredAgent }),
    ...(input.module === undefined ? {} : { module: input.module }),
    outputSchema: { name: `${input.id}_report`, sections: sectionsOf(steps) },
    ...(input.custom === true ? { custom: true } : {}),
  };
}

const CHARACTER_INPUT: SkillInput = {
  key: "characterId",
  label: "Character",
  entityKind: "character",
  required: true,
  description: "Whose pass this is.",
};

const CHAPTER_INPUT: SkillInput = {
  key: "chapterId",
  label: "Chapter",
  entityKind: "chapter",
  required: false,
  description: "Leave empty to run over the whole book.",
};

export const CHARACTER_PASS = defineSkill({
  id: "character_pass",
  command: "/character-pass",
  name: "Character Pass",
  description:
    "Everything the project knows about one character: where they appear, what they learn, how their relationships move, how they speak, and whether anything changes.",
  inputs: [CHARACTER_INPUT],
  preferredAgent: "character_editor",
  steps: [
    { operationId: "locate_character_scenes" },
    { operationId: "reconstruct_chronology" },
    { operationId: "reconstruct_knowledge" },
    { operationId: "reconstruct_relationships" },
    { operationId: "inspect_character_dialogue" },
    { operationId: "inspect_behaviour" },
    { operationId: "inspect_arc" },
    { operationId: "compile_report" },
  ],
});

export const CONTINUITY_AUDIT = defineSkill({
  id: "continuity_audit",
  command: "/continuity-audit",
  name: "Continuity Audit",
  description:
    "Run every deterministic check the project can make, read the diagnostics, then look for the continuity a rule cannot express.",
  preferredAgent: "continuity_editor",
  steps: [
    { operationId: "run_story_build" },
    { operationId: "inspect_diagnostics" },
    { operationId: "run_story_tests" },
    { operationId: "inspect_semantic_continuity" },
    { operationId: "categorise_findings" },
    { operationId: "compile_report" },
  ],
});

export const DIALOGUE_PASS = defineSkill({
  id: "dialogue_pass",
  command: "/dialogue-pass",
  name: "Dialogue Pass",
  description:
    "Pull the dialogue off the page, measure it against the voices the project records, and look at what it is carrying.",
  inputs: [CHAPTER_INPUT],
  preferredAgent: "dialogue_editor",
  steps: [
    { operationId: "identify_dialogue" },
    { operationId: "load_voice_profiles" },
    { operationId: "inspect_exposition" },
    { operationId: "inspect_differentiation" },
    { operationId: "inspect_subtext" },
    { operationId: "compile_report" },
  ],
});

export const PACING_AUDIT = defineSkill({
  id: "pacing_audit",
  command: "/pacing-audit",
  name: "Pacing Audit",
  description:
    "Measure the shape of the book against its own habit: chapter and scene length, sentence rhythm, and which threads have gone quiet.",
  inputs: [CHAPTER_INPUT],
  preferredAgent: "developmental_editor",
  steps: [
    { operationId: "measure_pacing" },
    { operationId: "inspect_thread_activity" },
    { operationId: "read_pacing" },
    { operationId: "compile_report" },
  ],
});

export const FORESHADOWING_AUDIT = defineSkill({
  id: "foreshadowing_audit",
  command: "/foreshadowing-audit",
  name: "Foreshadowing Audit",
  description:
    "Every promise the story makes, whether it is kept, and how far apart the two ends sit.",
  preferredAgent: "story_architect",
  steps: [
    { operationId: "inspect_setups" },
    { operationId: "measure_setup_distance" },
    { operationId: "inspect_thread_activity" },
    { operationId: "compile_report" },
  ],
});

export const SCENE_PURPOSE_AUDIT = defineSkill({
  id: "scene_purpose_audit",
  command: "/scene-purpose-audit",
  name: "Scene Purpose Audit",
  description:
    "What each scene says it is for, and whether the project records anything changing in it.",
  preferredAgent: "scene_director",
  steps: [
    { operationId: "inspect_scene_purpose" },
    { operationId: "inspect_scene_change" },
    { operationId: "categorise_findings" },
    { operationId: "compile_report" },
  ],
});

export const REMOVE_AI_TENDENCIES = defineSkill({
  id: "remove_ai_tendencies",
  command: "/remove-ai-tendencies",
  name: "Remove AI Tendencies",
  description:
    "Count the constructions a model reaches for more often than a novelist does, check them against your own rules, and propose alternatives. Nothing is changed.",
  inputs: [CHAPTER_INPUT],
  preferredAgent: "prose_editor",
  steps: [
    { operationId: "scan_prose_tendencies" },
    { operationId: "check_voice_rules" },
    { operationId: "propose_rewrites" },
    { operationId: "compile_report" },
  ],
});

export const FAIRNESS_AUDIT = defineSkill({
  id: "fairness_audit",
  command: "/fairness-audit",
  name: "Fairness Audit",
  description:
    "Can a careful reader fairly reach the intended solution before the reveal? Resolve the chain of reasoning, check every premise against what the reader has been shown, and compare the earliest solvable point to where you meant it to be.",
  inputs: [
    {
      key: "mysteryId",
      label: "Mystery",
      entityKind: "mystery",
      required: true,
      description: "Which mystery to audit.",
    },
  ],
  preferredAgent: "continuity_editor",
  // Arrives with the Mystery module, and is offered only while it is on.
  module: "mystery",
  steps: [
    { operationId: "load_mystery" },
    { operationId: "resolve_deduction_chain" },
    { operationId: "audit_fairness" },
    { operationId: "estimate_solvability" },
    { operationId: "check_alibis" },
    { operationId: "detect_obviousness" },
    { operationId: "compile_report" },
  ],
});

export const BUILT_IN_SKILLS: readonly SkillDefinition[] = [
  CHARACTER_PASS,
  CONTINUITY_AUDIT,
  DIALOGUE_PASS,
  PACING_AUDIT,
  FORESHADOWING_AUDIT,
  SCENE_PURPOSE_AUDIT,
  REMOVE_AI_TENDENCIES,
  FAIRNESS_AUDIT,
];

export function skillById(id: string, extra: readonly SkillDefinition[] = []): SkillDefinition {
  const found = [...BUILT_IN_SKILLS, ...extra].find((skill) => skill.id === id);
  if (found === undefined) {
    throw new SkillError("unknown_skill", `No skill with id "${id}".`, { details: { skill: id } });
  }
  return found;
}

/** Resolve `/character-pass` (or `character_pass`) to a skill. */
export function skillByCommand(
  command: string,
  extra: readonly SkillDefinition[] = [],
): SkillDefinition | null {
  const wanted = command.trim().toLowerCase();
  return (
    [...BUILT_IN_SKILLS, ...extra].find(
      (skill) => skill.command.toLowerCase() === wanted || skill.id === wanted,
    ) ?? null
  );
}
