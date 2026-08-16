import type { AgentPermission } from "@jellytind/agent-runtime";

/**
 * The tool catalog the builder offers (§4).
 *
 * Grouped semantically, because "what can this agent read?" is a writer's
 * question and a 200-item checkbox is not an answer. Every entry names the
 * permission the runtime will demand for it, so the builder can refuse an
 * allowlist the grant cannot cover *before* saving (§24) instead of letting
 * the executor deny it at run time.
 *
 * The names mirror the agent-runtime registries and are asserted against
 * them in the tests, so this catalog cannot drift from what actually exists.
 */

export interface CatalogTool {
  readonly name: string;
  readonly title: string;
  readonly permission: AgentPermission;
  /** Present when the tool arrived from a plugin (§23). */
  readonly pluginId?: string;
}

export interface CatalogGroup {
  readonly id: string;
  readonly label: string;
  readonly tools: readonly CatalogTool[];
}

const read = (name: string, title: string, permission: AgentPermission): CatalogTool => ({
  name,
  title,
  permission,
});

export const CORE_CATALOG: readonly CatalogGroup[] = [
  {
    id: "story",
    label: "Read the story",
    tools: [
      read("get_project", "Project overview", "read_canon"),
      read("get_chapter", "A chapter's record", "read_manuscript"),
      read("get_scene", "A scene's record", "read_manuscript"),
      read("get_character", "A character's record", "read_canon"),
      read("get_location", "A location's record", "read_canon"),
      read("get_plot_thread", "A plot thread's record", "read_canon"),
      read("get_scenes_by_character", "Scenes a character appears in", "read_canon"),
      read("get_scenes_by_location", "Scenes at a location", "read_canon"),
      read("get_scenes_by_plot_thread", "Scenes on a thread", "read_canon"),
    ],
  },
  {
    id: "manuscript",
    label: "Read the manuscript",
    tools: [
      read("read_file", "Read a project file", "read_manuscript"),
      read("read_range", "Read part of a file", "read_manuscript"),
      read("list_project_files", "List project files", "read_manuscript"),
      read("search_project", "Search the whole project", "read_manuscript"),
    ],
  },
  {
    id: "research",
    label: "Research",
    tools: [
      read("list_research", "List research items", "read_canon"),
      read("search_research", "Search research", "read_canon"),
      read("create_research_item", "Save a sourced research item", "run_research"),
    ],
  },
  {
    id: "checks",
    label: "Story checks",
    tools: [
      read("run_story_build", "Run the Story Build", "read_canon"),
      read("get_build_diagnostics", "Read build problems", "read_canon"),
      read("list_story_tests", "List story tests", "read_canon"),
      read("run_story_tests", "Run story tests", "read_canon"),
      read("get_failed_story_tests", "Read failing tests", "read_canon"),
      read("run_story_debug", "Trace a story problem", "read_canon"),
      read("list_debug_reports", "List debug reports", "read_canon"),
      read("get_debug_report", "Read a debug report", "read_canon"),
    ],
  },
  {
    id: "plans",
    label: "Plans",
    tools: [
      read("inspect_scene_plan", "Read a chapter's scene plan", "read_canon"),
      read("validate_scene_plan", "Validate a scene plan", "read_canon"),
      read("create_scene_plan", "Draft a scene plan", "edit_plans"),
      read("revise_scene_plan", "Revise a scene plan", "edit_plans"),
    ],
  },
  {
    id: "structure",
    label: "Structure & versions",
    tools: [
      read("analyse_story_refactor", "Analyse a structural change", "read_canon"),
      read("list_branches", "List versions", "read_canon"),
      read("compare_branches", "Compare versions", "read_canon"),
    ],
  },
];

/**
 * The full catalog: core groups plus one group per plugin that contributed
 * agent tools — shown only when the plugin is enabled and holds the grant,
 * which the caller decides (§23).
 */
export function toolCatalog(
  pluginTools: ReadonlyArray<{
    readonly name: string;
    readonly title: string;
    readonly pluginId: string;
    readonly pluginName: string;
  }> = [],
): readonly CatalogGroup[] {
  if (pluginTools.length === 0) return CORE_CATALOG;
  const byPlugin = new Map<string, { label: string; tools: CatalogTool[] }>();
  for (const tool of pluginTools) {
    const held = byPlugin.get(tool.pluginId) ?? { label: tool.pluginName, tools: [] };
    // Plugin tools run inside the plugin host's own permission gates; from the
    // agent's side they are external calls, so the external permission covers
    // them rather than a per-tool grant the runtime does not have.
    held.tools.push({
      name: `plugin:${tool.pluginId}:${tool.name}`,
      title: tool.title,
      permission: "use_external_services",
      pluginId: tool.pluginId,
    });
    byPlugin.set(tool.pluginId, held);
  }
  return [
    ...CORE_CATALOG,
    ...[...byPlugin.entries()].map(([id, held]) => ({
      id: `plugin:${id}`,
      label: held.label,
      tools: held.tools as readonly CatalogTool[],
    })),
  ];
}

/** Every tool in a catalog, flat, for validation. */
export function catalogTools(catalog: readonly CatalogGroup[]): ReadonlyMap<string, CatalogTool> {
  const map = new Map<string, CatalogTool>();
  for (const group of catalog) for (const tool of group.tools) map.set(tool.name, tool);
  return map;
}

/** Tools whose permission only reads. Flows' run_tool steps are held to this. */
export function isReadOnlyTool(tool: CatalogTool): boolean {
  return tool.permission === "read_manuscript" || tool.permission === "read_canon";
}
