import { AppError } from "@jellytind/shared";
import type { AgentPermission, ModelClass } from "@jellytind/agent-runtime";

/**
 * Custom agents and visual skill flows (Phase 43).
 *
 * A custom agent is **a configuration in the vocabulary Manu already
 * enforces** — the agent-runtime's permissions, a tool allowlist from the
 * catalog, a model policy the router resolves, a context selection the
 * Context Compiler compiles. It is not a persona and not code: everything a
 * custom agent may do, a shipped specialist could already do, and everything
 * it may not do is refused by the same executor gates
 * (docs/AGENT_BUILDER.md).
 *
 * A flow is the same idea for workflows: an ordered list of closed step
 * kinds, bounded branching over named deterministic conditions, approval
 * gates from the existing approval architecture, and bounded retry. There is
 * no scripting language and no way to express one.
 */

export type AgentBuilderErrorCode =
  | "invalid_definition"
  | "unknown_tool"
  | "permission_mismatch"
  | "incompatible_model"
  | "unknown_agent"
  | "invalid_condition"
  | "invalid_workflow"
  | "invalid_output"
  | "invalid_package"
  | "run_not_found"
  | "not_awaiting_approval"
  | "step_failed";

export class AgentBuilderError extends AppError {
  constructor(
    code: AgentBuilderErrorCode,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(code, message, options);
  }
}

/** Where a definition lives, and therefore what it travels with (§9). */
export type BuilderScope = "project" | "universe" | "global";

/**
 * How the agent's model is chosen (§6).
 *
 * `routing` hands the decision to Manu's router. `class` asks for a kind of
 * model without naming one. `pinned` names a configured model and is checked
 * against what is actually configured — a pin to a model that is not there is
 * a validation error, not a runtime surprise.
 */
export type ModelPolicy =
  | { readonly kind: "routing" }
  | { readonly kind: "class"; readonly modelClass: ModelClass }
  | { readonly kind: "pinned"; readonly modelId: string };

/**
 * What the agent is given to work from (§7) — writer-facing choices, each one
 * a real Context Compiler source. Advanced users may name a detailed recipe.
 */
export interface ContextSelection {
  readonly currentScene?: boolean;
  readonly currentChapter?: boolean;
  readonly charactersPresent?: boolean;
  readonly relevantResearch?: boolean;
  readonly plotThreads?: boolean;
  readonly authorVoice?: boolean;
  /** Advanced: a detailed recipe id, validated against the compiler's set. */
  readonly recipe?: string;
}

export const CONTEXT_RECIPES = ["scene_inspection", "scene_rewrite", "chapter_inspection"] as const;

/**
 * What the agent hands back (§1 "Output behaviour").
 *
 * `notes` is analysis the writer reads. `proposals` are staged edits that
 * only ever reach the manuscript through review and approval — a custom
 * agent has no direct write path, whatever it asks for.
 */
export type OutputBehaviour = { readonly kind: "notes" } | { readonly kind: "proposals" };

/** Export metadata, marketplace-shaped but used today for files (§26). */
export interface PackageMetadata {
  readonly author?: string;
  readonly description?: string;
  /** The app this was built against. */
  readonly compatibility: { readonly app: "manu"; readonly builder: string };
}

export const BUILDER_VERSION = "1.0";

export interface CustomAgentDefinition {
  readonly id: string;
  readonly name: string;
  /** One or two sentences: what this agent is for. */
  readonly purpose: string;
  /** The working brief the model receives, written by the writer. */
  readonly instructions: string;
  /** The grant. Enforced by the executor, never by the prompt. */
  readonly permissions: readonly AgentPermission[];
  /** The tool allowlist, from the catalog. Both gates apply (§4, §5). */
  readonly tools: readonly string[];
  readonly model: ModelPolicy;
  readonly context: ContextSelection;
  readonly output: OutputBehaviour;
  /** An optional /command registered through the Phase 39 registry (§3). */
  readonly commandAlias?: string;
  readonly scope: BuilderScope;
  /** Bumped on every saved change; runs record the revision they used (§25). */
  readonly revision: number;
  readonly metadata: PackageMetadata;
}

/** What a flow needs before it can run (§17). */
export interface FlowInput {
  readonly key: string;
  readonly label: string;
  readonly entityKind?: "character" | "chapter" | "scene" | "scene_range";
  readonly required: boolean;
}

/**
 * Bounded branching (§14): a named deterministic measure, a comparison, a
 * number. Nothing else — no expressions, no scripting.
 */
export const CONDITION_MEASURES = [
  "compiler_errors",
  "compiler_warnings",
  "tests_failed",
  "findings",
] as const;
export type ConditionMeasure = (typeof CONDITION_MEASURES)[number];

export interface FlowCondition {
  readonly measure: ConditionMeasure;
  readonly comparison: "greater_than" | "equals";
  readonly value: number;
}

/** Bounded retry (§16). Attempts include the first; never more than three. */
export interface RetryPolicy {
  readonly maxAttempts: number;
}

/**
 * The closed set of step kinds (§12). A flow names these in order; it cannot
 * introduce a new one, which is what makes loading a flow from a file safe.
 */
export type FlowStep =
  | {
      readonly kind: "run_agent";
      readonly id: string;
      readonly title: string;
      /** A custom agent id or a shipped specialist id. */
      readonly agent: string;
      readonly instruction: string;
      readonly retry?: RetryPolicy;
    }
  | {
      readonly kind: "run_tool";
      readonly id: string;
      readonly title: string;
      /** Read-only tools only: mutations go through staged changes. */
      readonly tool: string;
    }
  | {
      readonly kind: "search_project";
      readonly id: string;
      readonly title: string;
      /** Literal text, or `{input.key}` to search for an input's value. */
      readonly query: string;
    }
  | {
      readonly kind: "compile_context";
      readonly id: string;
      readonly title: string;
      readonly recipe: (typeof CONTEXT_RECIPES)[number];
    }
  | { readonly kind: "run_story_build"; readonly id: string; readonly title: string }
  | { readonly kind: "run_story_tests"; readonly id: string; readonly title: string }
  | {
      readonly kind: "request_approval";
      readonly id: string;
      readonly title: string;
      readonly question: string;
    }
  | { readonly kind: "generate_report"; readonly id: string; readonly title: string }
  | {
      readonly kind: "apply_staged_changes";
      readonly id: string;
      readonly title: string;
    }
  | {
      readonly kind: "branch";
      readonly id: string;
      readonly title: string;
      readonly condition: FlowCondition;
      /** Sub-sequences; a branch cannot contain another branch (§14, §24). */
      readonly then: readonly FlowStep[];
      readonly otherwise: readonly FlowStep[];
    };

/** What a finished run hands the writer (§18). */
export const FLOW_OUTPUTS = [
  "report",
  "diagnostics",
  "diff",
  "plan",
  "research",
  "story_map",
  "task",
] as const;
export type FlowOutput = (typeof FLOW_OUTPUTS)[number];

export interface FlowDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly inputs: readonly FlowInput[];
  readonly steps: readonly FlowStep[];
  readonly output: FlowOutput;
  readonly commandAlias?: string;
  readonly scope: BuilderScope;
  readonly revision: number;
  readonly metadata: PackageMetadata;
}

/** An edit proposed by an agent step: staged, reviewable, never auto-applied. */
export interface ProposedEdit {
  readonly id: string;
  readonly sceneId?: string;
  readonly chapterId?: string;
  readonly find: string;
  readonly replace: string;
  readonly reason: string;
}

/** What one invocation of an agent produced. */
export interface AgentInvocationResult {
  readonly notes: readonly string[];
  readonly proposals?: readonly ProposedEdit[];
  readonly modelId?: string;
}

/**
 * The model-side work, as a port. The builder package holds no provider
 * knowledge: the desktop implements this over the router, tests fake it, and
 * with no invoker every agent step is skipped with a stated reason.
 */
export interface AgentInvoker {
  invoke(request: {
    readonly definition: CustomAgentDefinition | null;
    /** The specialist id when the step names a shipped agent instead. */
    readonly specialist?: string;
    readonly instruction: string;
    /** Material gathered by earlier steps. */
    readonly material: string;
    readonly wantsProposals: boolean;
    readonly signal?: AbortSignal;
  }): Promise<AgentInvocationResult>;
}

/** Project files, structurally satisfied by StoryRepository and stores. */
export interface FileStorePort {
  readProjectFile(path: string): Promise<string | null>;
  writeProjectFile(path: string, contents: string): Promise<void>;
  listProjectFiles(prefix?: string): Promise<readonly string[]>;
}
