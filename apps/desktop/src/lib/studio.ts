import {
  BuilderStore,
  FlowRunner,
  testAgent,
  toolCatalog,
  type AgentInvoker,
  type CatalogGroup,
  type CustomAgentDefinition,
  type FileStorePort,
  type FlowDefinition,
  type FlowRunPorts,
  type ProposedEdit,
  type SandboxProject,
  type ValidationContext,
} from "@jellytind/agent-builder";
import { SPECIALIST_IDS } from "@jellytind/agent-runtime";
import { chapterBody } from "@jellytind/story-mapper";
import type { SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import type { PluginHost } from "@jellytind/plugin-protocol";
import { createRoutedModel, routingProfiles, routingAnchors, loadRoutingSettings } from "./routing";
import { loadAiSettings } from "./connections";

/**
 * The Studio's home in the desktop app (Phase 43).
 *
 * Everything the panel does goes through here: scoped stores (§9), the tool
 * catalog with plugin tools folded in (§23), the validation context (§24),
 * the routed invoker (§6), and the flow runner's ports over the real
 * project — search, Story Build, story tests. The invoker maps the agent's
 * model policy onto the router rather than around it: `routing` routes,
 * `class` pins to the writer's purpose assignment, `pinned` pins to the
 * named profile — so custom agents obey the same budgets, privacy policy and
 * usage accounting as everything else.
 */

export interface StudioRuntime {
  readonly stores: { readonly project: BuilderStore; readonly global: BuilderStore };
  readonly catalog: readonly CatalogGroup[];
  readonly validation: ValidationContext;
  readonly invoker: AgentInvoker | null;
  readonly runner: FlowRunner;
  agents(): Promise<readonly CustomAgentDefinition[]>;
  flows(): Promise<readonly FlowDefinition[]>;
  problems(): Promise<ReadonlyArray<{ path: string; reason: string }>>;
}

/** Global definitions live in app data, not in any one project (§9). */
function localStorageFiles(prefix: string): FileStorePort {
  const key = (path: string) => `${prefix}:${path}`;
  return {
    readProjectFile: (path) => Promise.resolve(window.localStorage.getItem(key(path))),
    writeProjectFile: (path, contents) => {
      window.localStorage.setItem(key(path), contents);
      return Promise.resolve();
    },
    listProjectFiles: (dirPrefix) => {
      const out: string[] = [];
      for (let index = 0; index < window.localStorage.length; index += 1) {
        const stored = window.localStorage.key(index);
        if (stored === null || !stored.startsWith(`${prefix}:`)) continue;
        const path = stored.slice(prefix.length + 1);
        if (dirPrefix === undefined || path.startsWith(dirPrefix)) out.push(path);
      }
      return Promise.resolve(out);
    },
  };
}

const NOTES_INSTRUCTION =
  'Reply as JSON: {"notes": string[]} — each note one specific, grounded observation.';
const PROPOSALS_INSTRUCTION =
  'Reply as JSON: {"notes": string[], "proposals": [{"find": string, "replace": string, "reason": string}]} — ' +
  "propose only edits the material supports; every proposal is reviewed by the writer before anything changes.";

interface InvocationPayload {
  readonly notes?: unknown;
  readonly proposals?: unknown;
}

function parseInvocation(value: unknown): {
  notes: string[];
  proposals: Array<Omit<ProposedEdit, "id">>;
} {
  const held = (value ?? {}) as InvocationPayload;
  const notes = Array.isArray(held.notes)
    ? held.notes.filter((note): note is string => typeof note === "string")
    : [];
  const proposals: Array<Omit<ProposedEdit, "id">> = [];
  if (Array.isArray(held.proposals)) {
    for (const entry of held.proposals) {
      const raw = (entry ?? {}) as Record<string, unknown>;
      if (typeof raw["find"] === "string" && typeof raw["replace"] === "string") {
        proposals.push({
          find: raw["find"],
          replace: raw["replace"],
          reason: typeof raw["reason"] === "string" ? raw["reason"] : "",
        });
      }
    }
  }
  return { notes, proposals };
}

function createInvoker(repo: StoryRepository, secrets: SecretStore): AgentInvoker {
  let sequence = 0;
  return {
    async invoke(request) {
      const definition = request.definition;
      const routing = loadRoutingSettings();
      const anchors = routingAnchors();
      let pins = routing.pins;
      // Map the policy onto router pins: the router stays the single decider.
      if (definition?.model.kind === "pinned") {
        const target = routingProfiles().find(
          (held) => definition.model.kind === "pinned" && held.modelId === definition.model.modelId,
        );
        if (target !== undefined) {
          pins = { ...pins, custom_agent: `${target.connectionId}:${target.modelId}` };
        }
      } else if (definition?.model.kind === "class") {
        const purpose =
          definition.model.modelClass === "reasoning"
            ? "reasoning"
            : definition.model.modelClass === "fast"
              ? "utility"
              : "drafting";
        const anchor = anchors[purpose];
        if (anchor !== undefined) pins = { ...pins, custom_agent: anchor };
      }
      const { model, profile } = await createRoutedModel(repo, secrets, "custom_agent", {
        routing: { ...routing, pins },
      });
      const system = [
        definition?.purpose ?? "You are a writing specialist working for the author.",
        definition?.instructions ?? "",
        request.wantsProposals ? PROPOSALS_INSTRUCTION : NOTES_INSTRUCTION,
      ]
        .filter((part) => part !== "")
        .join("\n\n");
      const parsed = await model.generateStructured({
        system,
        messages: [{ role: "user", content: `${request.instruction}\n\n---\n${request.material}` }],
        maxOutputTokens: 1600,
        schema: { name: "agent_invocation", parse: parseInvocation },
      });
      return {
        notes: parsed.notes,
        ...(request.wantsProposals
          ? {
              proposals: parsed.proposals.map((held) => ({
                ...held,
                id: `P${String((sequence += 1)).padStart(3, "0")}`,
              })),
            }
          : {}),
        modelId: profile.modelId,
      };
    },
  };
}

function flowPorts(
  repo: StoryRepository,
  invoker: AgentInvoker | null,
  resolveAgent: (id: string) => CustomAgentDefinition | null,
): FlowRunPorts {
  return {
    files: repo,
    invoker,
    resolveAgent,
    searchProject: async (query) => {
      const hits = await repo.searchText({ text: query, limit: 25 });
      return hits.map((hit) => hit.excerpt);
    },
    runStoryBuild: async () => {
      const build = await repo.buildStory({});
      const errors = build.diagnostics.filter((held) => held.severity === "error").length;
      const warnings = build.diagnostics.filter((held) => held.severity === "warning").length;
      return {
        errors,
        warnings,
        lines: build.diagnostics.slice(0, 20).map((held) => held.message),
      };
    },
    runStoryTests: async () => {
      const run = await repo.runStoryTests();
      return {
        failed: run.deterministic.failed,
        lines: [`${String(run.deterministic.failed)} of ${String(run.results.length)} failing.`],
      };
    },
  };
}

export async function createStudioRuntime(
  repo: StoryRepository,
  secrets: SecretStore,
  pluginHost: PluginHost | null,
): Promise<StudioRuntime> {
  const project = new BuilderStore(repo, "project");
  const global = new BuilderStore(localStorageFiles("manu.studio"), "global");

  const pluginTools: Array<{ name: string; title: string; pluginId: string; pluginName: string }> =
    [];
  for (const plugin of pluginHost?.plugins() ?? []) {
    if (!plugin.enabled || !plugin.granted.includes("register_agent_tools")) continue;
    for (const tool of plugin.manifest.contributes.tools ?? []) {
      pluginTools.push({
        name: tool.name,
        title: tool.description,
        pluginId: plugin.manifest.id,
        pluginName: plugin.manifest.name,
      });
    }
  }
  const catalog = toolCatalog(pluginTools);

  const loadAll = async () => {
    const [own, shared] = await Promise.all([project.load(), global.load()]);
    return {
      agents: [...own.agents, ...shared.agents],
      flows: [...own.flows, ...shared.flows],
      problems: [...own.problems, ...shared.problems],
    };
  };
  const loaded = await loadAll();

  const ai = loadAiSettings();
  const invoker = ai.connections.length === 0 ? null : createInvoker(repo, secrets);

  const validation: ValidationContext = {
    catalog,
    availableModels: [...new Set(routingProfiles().map((held) => held.modelId))],
    availableAgents: [...SPECIALIST_IDS, ...loaded.agents.map((held) => held.id)],
  };

  const resolve = (id: string): CustomAgentDefinition | null =>
    loaded.agents.find((held) => held.id === id) ?? null;

  return {
    stores: { project, global },
    catalog,
    validation,
    invoker,
    runner: new FlowRunner(flowPorts(repo, invoker, resolve)),
    agents: async () => (await loadAll()).agents,
    flows: async () => (await loadAll()).flows,
    problems: async () => (await loadAll()).problems,
  };
}

/** The sandbox's read-only view of the project (§8). */
export function sandboxProject(repo: StoryRepository): SandboxProject {
  return {
    chapters: async () => {
      const chapters = [...(await repo.listChapters())].sort((a, b) => a.order - b.order);
      const out: Array<{ title: string; text: string }> = [];
      for (const chapter of chapters) {
        const raw = (await repo.readProjectFile(chapter.filePath)) ?? "";
        out.push({ title: chapter.title, text: chapterBody(raw) });
      }
      return out;
    },
    characters: async () =>
      (await repo.listEntitySummaries())
        .filter((held) => held.kind === "character")
        .map((held) => held.name),
    plotThreads: async () =>
      (await repo.listEntitySummaries())
        .filter((held) => held.kind === "plot_thread")
        .map((held) => held.name),
  };
}

/**
 * Terminal commands for saved definitions with an alias (§20), through the
 * same registry plugin commands use. An agent alias runs the sandbox — real
 * analysis, nothing applied. A flow alias starts the flow; a run that
 * reaches an approval gate says so and waits in the Studio.
 */
export function studioCommandEntries(
  repo: StoryRepository,
  runtime: StudioRuntime,
  loaded: { agents: readonly CustomAgentDefinition[]; flows: readonly FlowDefinition[] },
): ReadonlyArray<{
  readonly name: string;
  readonly summary: string;
  readonly run: () => Promise<{ title: string; lines: readonly string[] }>;
}> {
  const out: Array<{
    name: string;
    summary: string;
    run: () => Promise<{ title: string; lines: readonly string[] }>;
  }> = [];
  for (const agent of loaded.agents) {
    if (agent.commandAlias === undefined) continue;
    out.push({
      name: agent.commandAlias,
      summary: `${agent.name} — ${agent.purpose}`,
      run: async () => {
        const result = await testAgent(agent, {
          project: sandboxProject(repo),
          invoker: runtime.invoker,
        });
        return {
          title: agent.name,
          lines:
            result.skipped !== undefined
              ? [result.skipped]
              : [
                  ...result.notes,
                  ...(result.proposedMutations.length > 0
                    ? [
                        `${String(result.proposedMutations.length)} edit(s) proposed — nothing applied. Review in the Studio.`,
                      ]
                    : []),
                ],
        };
      },
    });
  }
  for (const flow of loaded.flows) {
    if (flow.commandAlias === undefined) continue;
    out.push({
      name: flow.commandAlias,
      summary: `${flow.name} — ${flow.description}`,
      run: async () => {
        if (flow.inputs.some((input) => input.required)) {
          return {
            title: flow.name,
            lines: ["This skill needs inputs — run it from the Studio panel."],
          };
        }
        const run = await runtime.runner.start(flow, {});
        return {
          title: flow.name,
          lines: [
            `Run ${run.id}: ${run.status.replace(/_/g, " ")}.`,
            ...(run.status === "awaiting_approval"
              ? ["Waiting for your approval in the Studio panel."]
              : (run.report?.lines.slice(0, 10) ?? [])),
          ],
        };
      },
    });
  }
  return out;
}
