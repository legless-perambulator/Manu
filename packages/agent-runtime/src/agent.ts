/**
 * Agent capabilities and permissions.
 *
 * The product uses one orchestrating Author Agent that delegates to specialists
 * (Architect, Scene Director, Drafter, editors, …) rather than a single
 * monolithic "Writer AI" (MASTER_BUILD.md §19, docs/AGENT_RUNTIME.md).
 * Permissions are enforced by application services, not by the model.
 *
 * Phase 0 defines the descriptor shape; concrete agents and the orchestrator
 * land in V3 (docs/ROADMAP.md).
 */
export type AgentPermission =
  | "read_manuscript"
  | "read_canon"
  | "edit_manuscript"
  | "edit_story_state"
  | "create_entities"
  | "delete_entities"
  | "run_research"
  | "create_branches"
  | "apply_refactors"
  | "run_simulations"
  | "use_external_services";

export interface AgentDescriptor {
  readonly name: string;
  readonly description: string;
  /** Tool names this agent may invoke. */
  readonly permittedTools: readonly string[];
  readonly permissions: readonly AgentPermission[];
  /** Preferred model task category for routing (see @jellytind/model-router). */
  readonly preferredTask?: string;
}
