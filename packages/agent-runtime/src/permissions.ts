/**
 * The permission architecture agents are governed by.
 *
 * Permissions are enforced by application services, never by the model: a model
 * that decides to call `write_manuscript` still cannot, because the executor
 * checks the grant before the handler runs (MASTER_BUILD.md §33,
 * docs/AGENT_RUNTIME.md — "Permissions").
 *
 * Phase 7 ships read permissions only; the write permissions are declared here
 * so that mutating tools slot into an existing model rather than requiring the
 * architecture to be retrofitted around them.
 */
export type AgentPermission =
  | "read_manuscript"
  | "read_canon"
  | "edit_manuscript"
  | "edit_story_state"
  | "edit_plans"
  | "create_entities"
  | "delete_entities"
  | "run_research"
  | "create_branches"
  | "apply_refactors"
  | "run_simulations"
  | "use_external_services";

/** Permissions that grant only side-effect-free reads. */
export const READ_ONLY_PERMISSIONS: readonly AgentPermission[] = ["read_manuscript", "read_canon"];

/** True when a permission allows changing project state. */
export function isMutating(permission: AgentPermission): boolean {
  return !READ_ONLY_PERMISSIONS.includes(permission);
}

/**
 * What an agent is allowed to do on a given run.
 *
 * `allowedTools` is the task's tool allow-list and is intersected with
 * `permissions`: a tool must be *both* named by the task and covered by a
 * granted permission. Two independent gates means widening one never silently
 * widens the other.
 */
export interface PermissionGrant {
  readonly permissions: readonly AgentPermission[];
  /** Tool names the task may call. `undefined` means "any registered tool". */
  readonly allowedTools?: readonly string[];
}

/** The grant used for Phase 7 investigation: read everything, change nothing. */
export const READ_ONLY_GRANT: PermissionGrant = {
  permissions: READ_ONLY_PERMISSIONS,
};

export type PermissionDecision =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

/** Decide whether a tool may run under a grant. Pure and fully testable. */
export function checkPermission(
  tool: { readonly name: string; readonly permission: AgentPermission },
  grant: PermissionGrant,
): PermissionDecision {
  if (grant.allowedTools !== undefined && !grant.allowedTools.includes(tool.name)) {
    return {
      allowed: false,
      reason: `Tool "${tool.name}" is not in this task's allowed tools.`,
    };
  }
  if (!grant.permissions.includes(tool.permission)) {
    return {
      allowed: false,
      reason: `Tool "${tool.name}" requires the "${tool.permission}" permission, which this task was not granted.`,
    };
  }
  return { allowed: true };
}
