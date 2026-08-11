/**
 * @jellytind/context-compiler — task-specific working context for model calls.
 *
 * Not general RAG: an explicit, attributed, budget-resolved selection over the
 * project's own relationships (MASTER_BUILD.md §7, docs/CONTEXT_COMPILER.md).
 * Every model operation obtains its context from here rather than assembling a
 * prompt out of arbitrary project files.
 */

export { ContextCompiler, RECIPES, RECIPE_NAMES } from "./compiler";
export type { CompileRequest, ContextCompilerOptions, RecipeInfo, RecipeName } from "./compiler";

export { CompileError } from "./errors";
export type { CompileErrorCode } from "./errors";

export { DEFAULT_BUDGET, SECTION_ORDER, section, allItems, includedIds } from "./types";
export type {
  BudgetNote,
  ContextBudget,
  ContextItem,
  ContextMetadata,
  ContextPackage,
  ContextSection,
  ContextSectionName,
  Provenance,
  Rendering,
  SelectionRule,
  TargetRef,
} from "./types";

export type { ProjectReader } from "./reader";

export { renderContextPackage } from "./present";
export type { PresentOptions } from "./present";

export { CHARACTER_ESTIMATOR, estimateTokens } from "./tokens";
export type { TokenCounter } from "./tokens";

export {
  adjacentChapters,
  adjacentScenes,
  orderChapters,
  orderScenes,
  scenesOfChapter,
} from "./sequence";
export { PRIORITY } from "./candidate";
export type { Candidate } from "./candidate";
