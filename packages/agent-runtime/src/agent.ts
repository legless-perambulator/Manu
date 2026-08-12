import { READ_ONLY_PERMISSIONS, type AgentPermission } from "./permissions";
import { READ_ONLY_TOOL_NAMES } from "./tools/project-tools";
import { BUILD_TOOL_NAMES } from "./tools/build-tools";

/**
 * Agent identity and capability.
 *
 * The product uses one orchestrating Author Agent that delegates to specialists
 * (Architect, Scene Director, Drafter, editors, …) rather than a single
 * monolithic "Writer AI" (MASTER_BUILD.md §19, docs/AGENT_RUNTIME.md).
 * Permissions are enforced by application services, not by the model.
 *
 * Phase 7 ships one agent — the read-only Investigator. The specialists and the
 * orchestrator that coordinates them land in V3.
 */
export interface AgentDescriptor {
  readonly name: string;
  readonly description: string;
  /** Tool names this agent may invoke. */
  readonly permittedTools: readonly string[];
  readonly permissions: readonly AgentPermission[];
  /** Preferred model task category for routing (see @jellytind/model-router). */
  readonly preferredTask?: string;
}

/**
 * The investigating agent: reads the project through typed tools and answers
 * questions about it. It holds no write permission at all, so no configuration
 * mistake can turn an investigation into an edit.
 */
export const INVESTIGATOR_AGENT: AgentDescriptor = {
  name: "investigator",
  description:
    "Investigates a story project through typed read-only tools and answers questions grounded in what it retrieved.",
  // The build tools are read-and-run: they change nothing about the story, and
  // an investigator that can build answers continuity questions from
  // deterministic diagnostics rather than from its own reading.
  permittedTools: [...READ_ONLY_TOOL_NAMES, ...BUILD_TOOL_NAMES],
  permissions: READ_ONLY_PERMISSIONS,
  preferredTask: "continuity",
};
