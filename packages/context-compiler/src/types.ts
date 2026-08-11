/**
 * The Context Compiler's vocabulary.
 *
 * Context is never an opaque blob of project text. Every element carries where
 * it came from and *why it was included*, every section is named, and anything
 * the budget forced out is reported rather than silently dropped
 * (MASTER_BUILD.md §7, docs/CONTEXT_COMPILER.md).
 */

/** Why a rule selected an element. Machine-readable, so the UI can group. */
export type SelectionRule =
  | "task_instruction"
  | "target_entity"
  | "target_prose"
  | "previous_scene"
  | "next_scene"
  | "pov_character"
  | "participant_character"
  | "chapter_character"
  | "scene_location"
  | "linked_plot_thread"
  | "chapter_plot_thread"
  | "chapter_scene"
  | "previous_chapter"
  | "next_chapter"
  | "style_rule"
  | "character_voice"
  | "world_rule"
  | "character_state"
  | "object_state"
  | "established_fact"
  | "lexical_search"
  | "pinned";

/**
 * Provenance for one context element.
 *
 * `reason` is the sentence a user reads in the inspector — e.g.
 * `participant in SCENE_0042`. `via` records the IDs that led here, so a chain
 * of inclusion can be followed back to the target.
 */
export interface Provenance {
  readonly rule: SelectionRule;
  readonly reason: string;
  readonly via?: readonly string[];
}

/** How much of an element made it into the package. */
export type Rendering =
  /** The element's full content. */
  | "full"
  /** A deterministic shortened form, because the budget could not fit `full`. */
  | "summary"
  /** Identity only (ID, kind, label) — the content did not fit. */
  | "reference";

export type ContextSectionName =
  | "task"
  | "target"
  | "primaryText"
  | "adjacentScenes"
  | "characters"
  | "locations"
  | "plotThreads"
  | "storyState"
  | "styleRules"
  | "worldRules"
  | "additionalRetrievedContext";

/** Section order in a compiled package. Fixed, so packages are comparable. */
export const SECTION_ORDER: readonly ContextSectionName[] = [
  "task",
  "target",
  "primaryText",
  "adjacentScenes",
  "characters",
  "locations",
  "plotThreads",
  "storyState",
  "styleRules",
  "worldRules",
  "additionalRetrievedContext",
];

export interface ContextItem {
  /** Entity ID, or a project-relative path for file-sourced content. */
  readonly id: string;
  readonly section: ContextSectionName;
  /** Entity kind, `file`, or `instruction`. */
  readonly kind: string;
  readonly label: string;
  readonly text: string;
  readonly provenance: Provenance;
  /** Lower sorts first and survives budget pressure longer. */
  readonly priority: number;
  readonly rendering: Rendering;
  readonly estimatedTokens: number;
  /** Tokens the full rendering would have cost, when downgraded. */
  readonly fullTokens?: number;
}

export interface ContextSection {
  readonly name: ContextSectionName;
  readonly items: readonly ContextItem[];
}

/**
 * What the budget did to an element. Recorded for everything that was not
 * included at full fidelity, because arbitrary content must never be silently
 * truncated.
 */
export interface BudgetNote {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly provenance: Provenance;
  readonly disposition: Exclude<Rendering, "full"> | "excluded";
  readonly fullTokens: number;
  readonly includedTokens: number;
  readonly reason: string;
}

export interface ContextBudget {
  /** Ceiling for the whole compiled package. */
  readonly maxTokens: number;
  /**
   * Tokens held back for the model's own reply. Subtracted from `maxTokens`
   * before selection, so a package can never crowd out the response.
   */
  readonly reserveForOutput?: number;
}

export const DEFAULT_BUDGET: ContextBudget = { maxTokens: 12_000, reserveForOutput: 2_000 };

export interface ContextMetadata {
  readonly recipe: string;
  readonly budget: ContextBudget;
  /** `maxTokens` minus `reserveForOutput` — what selection actually had. */
  readonly availableTokens: number;
  readonly estimatedTokens: number;
  readonly withinBudget: boolean;
  /** Candidates considered, before the budget was applied. */
  readonly candidateCount: number;
  readonly includedCount: number;
  /** Everything summarised, referenced or excluded, with the reason. */
  readonly notes: readonly BudgetNote[];
  /** How tokens were estimated, since the number is an estimate. */
  readonly tokenEstimator: string;
  readonly compiledAt: string;
}

export interface TargetRef {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
}

/**
 * The compiled working set for one model operation. This is what a model call
 * receives — assembled explicitly, never scraped together from arbitrary files
 * at the call site.
 */
export interface ContextPackage {
  readonly task: string;
  readonly target?: TargetRef;
  readonly sections: readonly ContextSection[];
  readonly metadata: ContextMetadata;
}

/** Look up one section of a package. */
export function section(pkg: ContextPackage, name: ContextSectionName): ContextSection | undefined {
  return pkg.sections.find((s) => s.name === name);
}

/** Every item in a package, in section order. */
export function allItems(pkg: ContextPackage): ContextItem[] {
  return pkg.sections.flatMap((s) => [...s.items]);
}

/** The IDs a package included, in order — the handle tests assert against. */
export function includedIds(pkg: ContextPackage): string[] {
  return allItems(pkg).map((item) => item.id);
}
