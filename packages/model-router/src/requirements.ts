/**
 * What each kind of AI work needs from a model (Phase 36 §3).
 *
 * One central declaration per operation, instead of requirements scattered
 * through prompts and call sites. When the Story Architect needs structured
 * output and strong reasoning, that is written HERE, once — the router, the
 * route preview, the settings screen and the tests all read the same record.
 */

/** The purposes a writer assigns models to in Settings → AI Providers (§5). */
export const WORK_PURPOSES = ["default", "reasoning", "drafting", "utility", "simulation"] as const;
export type WorkPurpose = (typeof WORK_PURPOSES)[number];

/**
 * Every model-routed operation in the product. Closed set: a new kind of AI
 * work is added here, with its requirements, before anything can route it.
 */
export const ROUTED_OPERATIONS = [
  "story_architecture",
  "chapter_planning",
  "scene_drafting",
  "prose_revision",
  "manuscript_edit",
  "state_extraction",
  "coverage_check",
  "diagnosis",
  "dependency_analysis",
  "refactor_planning",
  "reader_simulation",
  "character_simulation",
  "research",
  "skill_reading",
  "semantic_analysis",
  "summarisation",
  "metadata_extraction",
  "search_query",
  "manuscript_mapping",
  "custom_agent",
] as const;
export type RoutedOperation = (typeof ROUTED_OPERATIONS)[number];

/** `required` excludes models known not to do it; `preferred` only ranks. */
export type RequirementLevel = "required" | "preferred";

export interface OperationRequirements {
  readonly operation: RoutedOperation;
  /** The writer-facing name. */
  readonly label: string;
  /**
   * The purpose whose configured model anchors this operation (§5). A manual
   * assignment for this purpose is the writer's word and the router treats it
   * as such — see the engine for exactly when a policy may prefer elsewhere.
   */
  readonly purpose: WorkPurpose;
  /** The orchestration routing class this operation reports under. */
  readonly routingClass: "premium_reasoning" | "premium_prose" | "cheap_analysis";
  readonly structuredOutput?: RequirementLevel;
  readonly tools?: RequirementLevel;
  readonly streaming?: RequirementLevel;
  readonly vision?: RequirementLevel;
  /** How much careful thinking the work needs. */
  readonly reasoning?: "high" | "standard";
  /** Whether the output is prose a reader will judge. */
  readonly proseQuality?: "high" | "standard";
  /** High: bulk or frequent work where cheapness genuinely matters. */
  readonly costSensitivity?: "high" | "normal";
  /** Many small independent calls — friendliness to parallel fan-out. */
  readonly parallelFriendly?: boolean;
  /**
   * Whether a capable local model is an appropriate home for this work under
   * a local-first policy (§16). Final prose is deliberately not.
   */
  readonly localEligible?: boolean;
}

const req = (r: OperationRequirements): OperationRequirements => r;

export const OPERATION_REQUIREMENTS: Readonly<Record<RoutedOperation, OperationRequirements>> = {
  story_architecture: req({
    operation: "story_architecture",
    label: "Story architecture",
    purpose: "reasoning",
    routingClass: "premium_reasoning",
    structuredOutput: "required",
    reasoning: "high",
  }),
  chapter_planning: req({
    operation: "chapter_planning",
    label: "Chapter planning",
    purpose: "reasoning",
    routingClass: "premium_reasoning",
    structuredOutput: "required",
    reasoning: "high",
  }),
  scene_drafting: req({
    operation: "scene_drafting",
    label: "Scene drafting",
    purpose: "drafting",
    routingClass: "premium_prose",
    structuredOutput: "required",
    proseQuality: "high",
  }),
  prose_revision: req({
    operation: "prose_revision",
    label: "Prose revision",
    purpose: "drafting",
    routingClass: "premium_prose",
    structuredOutput: "required",
    proseQuality: "high",
  }),
  manuscript_edit: req({
    operation: "manuscript_edit",
    label: "Manuscript editing",
    purpose: "drafting",
    routingClass: "premium_prose",
    structuredOutput: "required",
    proseQuality: "high",
  }),
  state_extraction: req({
    operation: "state_extraction",
    label: "State extraction",
    purpose: "utility",
    routingClass: "cheap_analysis",
    structuredOutput: "required",
    costSensitivity: "high",
    localEligible: true,
  }),
  coverage_check: req({
    operation: "coverage_check",
    label: "Plan coverage check",
    purpose: "utility",
    routingClass: "cheap_analysis",
    structuredOutput: "required",
    costSensitivity: "high",
    localEligible: true,
  }),
  diagnosis: req({
    operation: "diagnosis",
    label: "Story diagnosis",
    purpose: "reasoning",
    routingClass: "premium_reasoning",
    structuredOutput: "required",
    reasoning: "high",
  }),
  dependency_analysis: req({
    operation: "dependency_analysis",
    label: "Dependency analysis",
    purpose: "reasoning",
    routingClass: "premium_reasoning",
    structuredOutput: "required",
    reasoning: "high",
  }),
  refactor_planning: req({
    operation: "refactor_planning",
    label: "Refactor planning",
    purpose: "reasoning",
    routingClass: "premium_reasoning",
    structuredOutput: "required",
    reasoning: "high",
  }),
  reader_simulation: req({
    operation: "reader_simulation",
    label: "Reader simulation",
    purpose: "simulation",
    routingClass: "cheap_analysis",
    structuredOutput: "required",
    costSensitivity: "high",
    parallelFriendly: true,
    localEligible: true,
  }),
  character_simulation: req({
    operation: "character_simulation",
    label: "Character simulation",
    purpose: "simulation",
    routingClass: "cheap_analysis",
    structuredOutput: "required",
    costSensitivity: "high",
    parallelFriendly: true,
    localEligible: true,
  }),
  research: req({
    operation: "research",
    label: "Research",
    purpose: "default",
    routingClass: "cheap_analysis",
    structuredOutput: "required",
    tools: "preferred",
  }),
  custom_agent: req({
    operation: "custom_agent",
    label: "Custom agent",
    purpose: "drafting",
    routingClass: "premium_prose",
    structuredOutput: "required",
    proseQuality: "high",
  }),
  skill_reading: req({
    operation: "skill_reading",
    label: "Skill semantic reading",
    purpose: "utility",
    routingClass: "cheap_analysis",
    structuredOutput: "required",
    costSensitivity: "high",
    localEligible: true,
  }),
  semantic_analysis: req({
    operation: "semantic_analysis",
    label: "Semantic story analysis",
    purpose: "utility",
    routingClass: "cheap_analysis",
    structuredOutput: "required",
    costSensitivity: "high",
    localEligible: true,
  }),
  summarisation: req({
    operation: "summarisation",
    label: "Summarisation",
    purpose: "utility",
    routingClass: "cheap_analysis",
    costSensitivity: "high",
    localEligible: true,
  }),
  metadata_extraction: req({
    operation: "metadata_extraction",
    label: "Metadata extraction",
    purpose: "utility",
    routingClass: "cheap_analysis",
    structuredOutput: "required",
    costSensitivity: "high",
    localEligible: true,
  }),
  search_query: req({
    operation: "search_query",
    label: "Search query generation",
    purpose: "utility",
    routingClass: "cheap_analysis",
    costSensitivity: "high",
    localEligible: true,
  }),
  // Reverse story mapping (Phase 40): many small structured extractions over
  // one bounded excerpt each. Exactly the profile cheap and local models fit.
  manuscript_mapping: req({
    operation: "manuscript_mapping",
    label: "Manuscript mapping",
    purpose: "utility",
    routingClass: "cheap_analysis",
    structuredOutput: "required",
    costSensitivity: "high",
    parallelFriendly: true,
    localEligible: true,
  }),
};

export function requirementsFor(operation: RoutedOperation): OperationRequirements {
  return OPERATION_REQUIREMENTS[operation];
}
