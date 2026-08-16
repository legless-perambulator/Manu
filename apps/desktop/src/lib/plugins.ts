import {
  PluginHost,
  type HostEnvironment,
  type InstalledPlugin,
  type PluginPermission,
  type ToolCallOutcome,
} from "@jellytind/plugin-protocol";
import type { SecretStore } from "@jellytind/model-router";
import type { StoryRepository } from "@jellytind/story-repository";
import { chapterBody } from "@jellytind/story-mapper";

/**
 * The desktop's plugin runtime (Phase 42).
 *
 * Plugins are project files: `.writer/plugins/<id>.json` holds the manifest
 * (so a project carries its dependencies with it, §20), and `state.json`
 * holds enablement and the writer's grants. The host receives exactly the
 * capabilities the environment builds — chapter *bodies* (never front
 * matter), entity counts, an https fetcher, and plugin-scoped secrets under
 * `plugin:<id>:<name>` keys, far away from provider credentials (§15).
 */

const PLUGIN_DIR = ".writer/plugins";
const STATE_PATH = `${PLUGIN_DIR}/state.json`;

interface PluginState {
  readonly enabled: boolean;
  readonly granted: readonly PluginPermission[];
}

function safeFileId(id: string): string {
  return id.replace(/[^a-z0-9.-]/g, "_");
}

export interface PluginRuntime {
  readonly host: PluginHost;
  reload(): Promise<void>;
  installFromText(raw: string): Promise<{ ok: boolean; errors: readonly string[] }>;
  setEnabled(id: string, enabled: boolean): Promise<void>;
  removePlugin(id: string): Promise<void>;
  readSettings(id: string): Promise<Record<string, unknown>>;
  writeSettings(id: string, settings: Record<string, unknown>): Promise<void>;
}

export async function createPluginRuntime(
  repo: StoryRepository,
  secrets: SecretStore,
): Promise<PluginRuntime> {
  const environment: HostEnvironment = {
    fetchJson: async (url, headers) => {
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`${new URL(url).hostname} answered ${response.status}.`);
      return (await response.json()) as unknown;
    },
    getSecret: (pluginId, name) => secrets.get(`plugin:${pluginId}:${name}`),
    project: {
      chapters: async () => {
        const chapters = [...(await repo.listChapters())].sort((a, b) => a.order - b.order);
        const out: Array<{ title: string; text: string }> = [];
        for (const chapter of chapters) {
          const raw = (await repo.readProjectFile(chapter.filePath)) ?? "";
          out.push({
            title: chapter.title,
            text: chapterBody(raw).replace(/<!--[\s\S]*?-->/g, ""),
          });
        }
        return out;
      },
      entityCounts: async () => {
        const counts: Record<string, number> = {};
        for (const summary of await repo.listEntitySummaries()) {
          counts[summary.kind] = (counts[summary.kind] ?? 0) + 1;
        }
        return counts;
      },
    },
  };

  const host = new PluginHost(environment);

  async function readState(): Promise<Record<string, PluginState>> {
    const raw = await repo.readProjectFile(STATE_PATH);
    return raw === null ? {} : (JSON.parse(raw) as Record<string, PluginState>);
  }

  async function writeState(state: Record<string, PluginState>): Promise<void> {
    await repo.writeProjectFile(STATE_PATH, JSON.stringify(state, null, 2));
  }

  async function reload(): Promise<void> {
    for (const plugin of host.plugins()) host.remove(plugin.manifest.id);
    const state = await readState();
    const files = (await repo.listProjectFiles(PLUGIN_DIR)).filter(
      (path) =>
        path.endsWith(".json") && !path.endsWith("state.json") && !path.includes("/settings/"),
    );
    for (const path of files) {
      const raw = await repo.readProjectFile(path);
      if (raw === null) continue;
      const result = host.install(raw);
      if (result.ok && result.manifest !== undefined) {
        const held = state[result.manifest.id];
        if (held?.enabled === true) host.enable(result.manifest.id, held.granted);
      }
    }
  }

  await reload();

  return {
    host,
    reload,
    async installFromText(raw: string) {
      const result = host.install(raw);
      if (!result.ok || result.manifest === undefined) {
        return { ok: false, errors: result.errors };
      }
      await repo.writeProjectFile(
        `${PLUGIN_DIR}/${safeFileId(result.manifest.id)}.json`,
        JSON.stringify(result.manifest, null, 2),
      );
      return { ok: true, errors: [] };
    },
    async setEnabled(id: string, enabled: boolean) {
      const state = await readState();
      if (enabled) {
        const plugin = host.enable(id);
        state[id] = { enabled: true, granted: plugin.granted };
      } else {
        host.disable(id);
        state[id] = { enabled: false, granted: [] };
      }
      await writeState(state);
    },
    async removePlugin(id: string) {
      host.remove(id);
      const state = await readState();
      delete state[id];
      await writeState(state);
      // The manifest file stays on disk unless the writer deletes it from the
      // Project files view — removing an entry must never destroy data the
      // project may still reference (§20, §21). We rename it out of the way.
      const raw = await repo.readProjectFile(`${PLUGIN_DIR}/${safeFileId(id)}.json`);
      if (raw !== null) {
        await repo.writeProjectFile(`${PLUGIN_DIR}/${safeFileId(id)}.json.removed`, raw);
        await repo.writeProjectFile(`${PLUGIN_DIR}/${safeFileId(id)}.json`, "");
      }
    },
    async readSettings(id: string) {
      const raw = await repo.readProjectFile(`${PLUGIN_DIR}/settings/${safeFileId(id)}.json`);
      return raw === null ? {} : (JSON.parse(raw) as Record<string, unknown>);
    },
    async writeSettings(id: string, settings: Record<string, unknown>) {
      await repo.writeProjectFile(
        `${PLUGIN_DIR}/settings/${safeFileId(id)}.json`,
        JSON.stringify(settings, null, 2),
      );
    },
  };
}

/** Render a tool outcome as terminal-report lines. */
export function reportLines(outcome: ToolCallOutcome): string[] {
  if (!outcome.ok) return [outcome.error];
  const lines: string[] = [];
  for (const [key, value] of Object.entries(outcome.value)) {
    if (Array.isArray(value)) {
      for (const row of value) {
        if (typeof row === "object" && row !== null) {
          lines.push(
            Object.entries(row as Record<string, unknown>)
              .map(([k, v]) => `${k}: ${String(v)}`)
              .join(" · "),
          );
        }
      }
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  return lines;
}

/** Terminal commands contributed by enabled plugins (§7): one shared registry. */
export function pluginCommandEntries(host: PluginHost): ReadonlyArray<{
  readonly plugin: InstalledPlugin;
  readonly name: string;
  readonly summary: string;
  readonly run: () => Promise<{ title: string; lines: readonly string[] }>;
}> {
  const out: Array<{
    plugin: InstalledPlugin;
    name: string;
    summary: string;
    run: () => Promise<{ title: string; lines: readonly string[] }>;
  }> = [];
  for (const plugin of host.plugins()) {
    if (!plugin.enabled || !plugin.granted.includes("register_commands")) continue;
    for (const command of plugin.manifest.contributes.commands ?? []) {
      if (command.action.kind !== "run_tool") continue;
      const tool = command.action.tool;
      out.push({
        plugin,
        name: command.name,
        summary: command.summary,
        run: async () => ({
          title: `${plugin.manifest.name}`,
          lines: reportLines(await host.callTool(plugin.manifest.id, tool, {})),
        }),
      });
    }
  }
  return out;
}
