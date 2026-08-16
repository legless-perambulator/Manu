import {
  AgentBuilderError,
  type BuilderScope,
  type CustomAgentDefinition,
  type FileStorePort,
  type FlowDefinition,
} from "./types";
import { parseAgentDefinition, parseFlowDefinition } from "./pack";

/**
 * Scoped storage (§9) with revision history (§25).
 *
 * One store class, three scopes: the desktop constructs it over the project
 * (`.writer/studio/`), over a universe (`.universe/studio/`), and over app
 * data for global definitions. A definition never knows how it is stored;
 * its `scope` field records where it came from so the interface can say so.
 *
 * Saving over an existing definition bumps the revision and files the old
 * body under `history/`, so a run that recorded "agent noir-editor,
 * revision 2" can always be traced to the exact definition that did the
 * work. Removal renames rather than destroys.
 */

export const STUDIO_DIRS: Readonly<Record<BuilderScope, string>> = {
  project: ".writer/studio",
  universe: ".universe/studio",
  global: "studio",
};

export interface LoadedDefinitions {
  readonly agents: readonly CustomAgentDefinition[];
  readonly flows: readonly FlowDefinition[];
  /** Files that could not be loaded, each with the reason. Never silent. */
  readonly problems: ReadonlyArray<{ readonly path: string; readonly reason: string }>;
}

export class BuilderStore {
  constructor(
    private readonly files: FileStorePort,
    private readonly scope: BuilderScope,
    private readonly root: string = STUDIO_DIRS[scope],
  ) {}

  private agentPath(id: string): string {
    return `${this.root}/agents/${id}.json`;
  }

  private flowPath(id: string): string {
    return `${this.root}/flows/${id}.json`;
  }

  async load(): Promise<LoadedDefinitions> {
    const agents: CustomAgentDefinition[] = [];
    const flows: FlowDefinition[] = [];
    const problems: Array<{ path: string; reason: string }> = [];
    const paths = await this.files.listProjectFiles(this.root);
    for (const path of [...paths].sort()) {
      if (!path.endsWith(".json") || path.includes("/history/") || path.includes("/runs/")) {
        continue;
      }
      const raw = await this.files.readProjectFile(path);
      if (raw === null || raw.trim() === "") continue;
      try {
        if (path.includes("/agents/")) agents.push(parseAgentDefinition(raw, path, this.scope));
        else if (path.includes("/flows/")) flows.push(parseFlowDefinition(raw, path, this.scope));
      } catch (cause) {
        problems.push({ path, reason: cause instanceof Error ? cause.message : String(cause) });
      }
    }
    return { agents, flows, problems };
  }

  async saveAgent(agent: CustomAgentDefinition): Promise<CustomAgentDefinition> {
    return (await this.save(agent, this.agentPath(agent.id), "agents")) as CustomAgentDefinition;
  }

  async saveFlow(flow: FlowDefinition): Promise<FlowDefinition> {
    return (await this.save(flow, this.flowPath(flow.id), "flows")) as FlowDefinition;
  }

  private async save(
    definition: CustomAgentDefinition | FlowDefinition,
    path: string,
    kind: "agents" | "flows",
  ): Promise<CustomAgentDefinition | FlowDefinition> {
    const existing = await this.files.readProjectFile(path);
    let revision = 1;
    if (existing !== null && existing.trim() !== "") {
      const held = JSON.parse(existing) as { revision?: number };
      const oldRevision = typeof held.revision === "number" ? held.revision : 1;
      revision = oldRevision + 1;
      await this.files.writeProjectFile(
        `${this.root}/history/${kind}/${definition.id}/${String(oldRevision)}.json`,
        existing,
      );
    }
    const next = { ...definition, scope: this.scope, revision };
    await this.files.writeProjectFile(path, `${JSON.stringify(next, null, 2)}\n`);
    return next;
  }

  /** Prior revisions of a definition, oldest first. */
  async history(kind: "agents" | "flows", id: string): Promise<readonly number[]> {
    const paths = await this.files.listProjectFiles(`${this.root}/history/${kind}/${id}`);
    return paths
      .map((path) => Number(/\/(\d+)\.json$/.exec(path)?.[1] ?? Number.NaN))
      .filter((held) => Number.isFinite(held))
      .sort((a, b) => a - b);
  }

  async revision(kind: "agents" | "flows", id: string, revision: number): Promise<string | null> {
    return this.files.readProjectFile(
      `${this.root}/history/${kind}/${id}/${String(revision)}.json`,
    );
  }

  /** Rename out of the way; a store must never destroy what a run references. */
  async remove(kind: "agents" | "flows", id: string): Promise<void> {
    const path = kind === "agents" ? this.agentPath(id) : this.flowPath(id);
    const raw = await this.files.readProjectFile(path);
    if (raw === null) {
      throw new AgentBuilderError("run_not_found", `Nothing named "${id}" is saved here.`);
    }
    await this.files.writeProjectFile(`${path}.removed`, raw);
    await this.files.writeProjectFile(path, "");
  }
}
