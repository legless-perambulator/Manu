/**
 * @jellytind/skills — Writing Skills.
 *
 * A skill is an **executable workflow**, not a saved prompt: a sequence of
 * named operations against the Story Repository, each writing down what it
 * found, resumable where it stopped. The seven Manu ships with are compositions
 * of one registry of operations, and a writer's own skill is a different
 * composition of the same registry (docs/WRITING_SKILLS.md).
 */

export {
  OPERATIONS,
  operationById,
  hasOperation,
  validateWorkflow,
  surfaceOf,
  sectionsOf,
  isFullyDeterministic,
} from "./operations";

export {
  BUILT_IN_SKILLS,
  CHARACTER_PASS,
  CONTINUITY_AUDIT,
  DIALOGUE_PASS,
  PACING_AUDIT,
  FORESHADOWING_AUDIT,
  SCENE_PURPOSE_AUDIT,
  REMOVE_AI_TENDENCIES,
  defineSkill,
  skillById,
  skillByCommand,
} from "./skills";

export { SkillRunner, validateReport } from "./runner";
export type { SkillProgress, RunOptions, SkillRunnerOptions } from "./runner";

export { parseSkillCommand } from "./command";
export type { ParsedSkillCommand, EntitySummary } from "./command";

export { CUSTOM_SKILLS_DIR, loadCustomSkills, parseCustomSkill, saveCustomSkill } from "./custom";
export type { LoadedCustomSkills } from "./custom";

export { SkillError } from "./types";
export type {
  AnalystNote,
  SkillAnalyst,
  SkillContext,
  SkillDefinition,
  SkillErrorCode,
  SkillInput,
  SkillOperation,
  SkillOutputSchema,
  SkillRunStoreLike,
  SkillStep,
  StepOutcome,
} from "./types";

export {
  countWords,
  extractDialogue,
  proseOf,
  scanTendencies,
  sentencesOf,
  TENDENCY_PATTERNS,
} from "./prose";
export type { DialogueLine, PatternHit } from "./prose";
