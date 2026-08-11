import type { AnyId } from "@jellytind/domain";

/**
 * @jellytind/context-compiler — constructs the best working context per task.
 *
 * Not general RAG: a task-specific, explicit, inspectable, budget-aware
 * selection over domain relationships, state, search and summaries
 * (MASTER_BUILD.md §7, docs/CONTEXT_COMPILER.md). Phase 0 defines the shape of a
 * recipe and its compiled output; the compiler implementation is PLANNED for V1.
 */

/** Named source of context, so every inclusion is attributable and inspectable. */
export interface ContextFragment {
  readonly source: string;
  readonly text: string;
  readonly entities?: readonly AnyId[];
}

/** Declarative description of which sources to include, in priority order. */
export interface ContextRecipe {
  readonly task: string;
  readonly maxTokens?: number;
  readonly sources: readonly string[];
  readonly pinned?: readonly AnyId[];
}

export interface CompiledContext {
  readonly recipe: ContextRecipe;
  readonly fragments: readonly ContextFragment[];
  readonly estimatedTokens: number;
}

/**
 * PLANNED (V1). Given a recipe and project data, produce a
 * {@link CompiledContext}.
 */
export interface ContextCompiler {
  compile(recipe: ContextRecipe): Promise<CompiledContext>;
}
