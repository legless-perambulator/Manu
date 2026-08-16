import {
  ExtensionManager,
  FIRST_PARTY_KEY_ID,
  staticCatalogue,
  type CataloguePort,
  type TrustedKey,
} from "@jellytind/extensions";
import { CORE_CATALOG } from "@jellytind/agent-builder";
import { SPECIALIST_IDS } from "@jellytind/agent-runtime";
import type { StoryRepository } from "@jellytind/story-repository";
import { routingProfiles } from "./routing";
import type { PluginRuntime } from "./plugins";
import type { StudioRuntime } from "./studio";

/**
 * The extension ecosystem's home in the desktop app (Phase 45).
 *
 * The manager owns discovery, inspection, versioned install/update/rollback
 * and removal; this module wires what enabled extensions *contribute* into
 * the systems that already exist — plugin manifests into the plugin host,
 * agents and skills into the Studio's project store, genre modules into the
 * module framework. Contributions are registered idempotently on load, so a
 * restart reconstructs the same world from the project files alone.
 *
 * Signing note: the first-party key here is an HMAC foundation that keeps
 * the catalogue self-consistent and the verification honest ("trusted" vs
 * "unsigned" vs "invalid"). Real distribution moves signing to keys Manu's
 * build infrastructure holds and the app only verifies — the port shapes
 * already allow that swap.
 */

const FIRST_PARTY_KEY: TrustedKey = {
  keyId: FIRST_PARTY_KEY_ID,
  secret: "manu-first-party-catalogue-foundation",
};

export interface ExtensionsRuntime {
  readonly manager: ExtensionManager;
  readonly catalogue: CataloguePort;
  /** Register enabled extensions' contributions into the live systems. */
  syncContributions(): Promise<readonly string[]>;
}

export async function createExtensionsRuntime(
  repo: StoryRepository,
  plugins: PluginRuntime | null,
  studio: StudioRuntime | null,
): Promise<ExtensionsRuntime> {
  const manager = await ExtensionManager.open(repo, {
    trustedKeys: [FIRST_PARTY_KEY],
    validation: {
      catalog: CORE_CATALOG,
      availableModels: [...new Set(routingProfiles().map((held) => held.modelId))],
      availableAgents: [...SPECIALIST_IDS],
    },
  });
  const catalogue = staticCatalogue(FIRST_PARTY_KEY);

  async function syncContributions(): Promise<readonly string[]> {
    const notes: string[] = [];
    const contributions = await manager.contributions();

    for (const manifest of contributions.plugins) {
      if (plugins === null) continue;
      const already = plugins.host.plugin(manifest.id);
      if (already === undefined) {
        const result = await plugins.installFromText(JSON.stringify(manifest));
        if (!result.ok) {
          notes.push(`Plugin ${manifest.name}: ${result.errors[0] ?? "could not install"}`);
          continue;
        }
      }
      if (plugins.host.plugin(manifest.id)?.enabled !== true) {
        await plugins.setEnabled(manifest.id, true);
      }
    }

    if (studio !== null) {
      const existingAgents = new Set((await studio.agents()).map((held) => held.id));
      for (const agent of contributions.agents) {
        if (!existingAgents.has(agent.id)) {
          await studio.stores.project.saveAgent(agent);
          notes.push(`Agent ${agent.name} is available in the Studio.`);
        }
      }
      const existingFlows = new Set((await studio.flows()).map((held) => held.id));
      for (const flow of contributions.skills) {
        if (!existingFlows.has(flow.id)) {
          await studio.stores.project.saveFlow(flow);
          notes.push(`Skill ${flow.name} is available in the Studio.`);
        }
      }
    }

    const enabledModules = await repo.modules.enabled();
    for (const moduleId of contributions.modules) {
      if (!enabledModules.includes(moduleId)) {
        await repo.modules.enable(moduleId);
        notes.push(`Genre module "${moduleId}" enabled.`);
      }
    }
    return notes;
  }

  return { manager, catalogue, syncContributions };
}
