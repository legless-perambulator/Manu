import { validateManifest as validatePluginManifest } from "@jellytind/plugin-protocol";
import type { PluginPermission } from "@jellytind/plugin-protocol";
import { validateAgent, validateFlow, type ValidationContext } from "@jellytind/agent-builder";
import { verifyIntegrity, type TrustedKey } from "./integrity";
import {
  ECOSYSTEM_VERSION,
  EXTENSION_CATEGORIES,
  ExtensionError,
  type CataloguePort,
  type CatalogueEntry,
  type ExtensionDetails,
  type ExtensionPackage,
  type FileStorePort,
  type InstalledExtension,
  type ProjectExtensionNeeds,
  type TrustLevel,
} from "./types";

/**
 * The extension manager (§6–§10, §14–§16).
 *
 * Everything destructive is gated: installation demands explicit approval of
 * the stated permissions, an update that *adds* permissions demands renewed
 * approval naming exactly the additions, the previous version is preserved
 * so a failed update rolls back, and removal renames rather than deletes —
 * a project that used an extension keeps every record the extension created.
 * The catalogue is a port the manager merely consults; when it fails, the
 * installed world keeps working (§16).
 */

export const EXTENSIONS_DIR = ".writer/extensions";
const STATE_PATH = `${EXTENSIONS_DIR}/state.json`;
const PROJECT_NEEDS_PATH = `${EXTENSIONS_DIR}/project.json`;

const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const VERSION_PATTERN = /^\d+(?:\.\d+){0,2}$/;

const CREDENTIAL_SHAPES = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /"(api[_-]?key|apikey|token|password|credential|authorization)"\s*:/i,
];

interface StateEntry {
  readonly version: string;
  readonly enabled: boolean;
  readonly trust: TrustLevel;
  readonly approvedPermissions: readonly PluginPermission[];
  readonly installedAt: string;
  readonly previousVersion?: string;
}

export function compareVersions(a: string, b: string): number {
  const parse = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const left = parse(a);
  const right = parse(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function majorOf(version: string): string {
  return version.split(".")[0] ?? "";
}

export interface ManagerOptions {
  readonly trustedKeys: readonly TrustedKey[];
  /** Context for validating contributed agents and flows against reality. */
  readonly validation: ValidationContext;
  now?(): string;
}

export class ExtensionManager {
  private constructor(
    private readonly files: FileStorePort,
    private readonly options: ManagerOptions,
    private state: Record<string, StateEntry>,
  ) {}

  static async open(files: FileStorePort, options: ManagerOptions): Promise<ExtensionManager> {
    const raw = await files.readProjectFile(STATE_PATH);
    const state =
      raw === null || raw.trim() === "" ? {} : (JSON.parse(raw) as Record<string, StateEntry>);
    return new ExtensionManager(files, options, state);
  }

  private now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }

  private packagePath(id: string): string {
    return `${EXTENSIONS_DIR}/${id}.json`;
  }

  private previousPath(id: string): string {
    return `${EXTENSIONS_DIR}/${id}.previous.json`;
  }

  private async persist(): Promise<void> {
    await this.files.writeProjectFile(STATE_PATH, JSON.stringify(this.state, null, 2));
  }

  // ── Inspection (§5, §14) ──────────────────────────────────────────────────

  /** Parse and judge a package without installing anything. */
  inspect(raw: string): ExtensionDetails {
    const problems: string[] = [];
    const warnings: string[] = [];
    for (const shape of CREDENTIAL_SHAPES) {
      if (shape.test(raw)) {
        throw new ExtensionError(
          "invalid_package",
          "This package appears to contain a credential. Extensions never carry keys.",
        );
      }
    }
    let pack: ExtensionPackage;
    try {
      pack = JSON.parse(raw) as ExtensionPackage;
    } catch (cause) {
      throw new ExtensionError("invalid_package", "Not a valid extension package.", { cause });
    }
    if (pack.format !== "manu-extension" || typeof pack.manifest !== "object") {
      throw new ExtensionError("invalid_package", "This file is not a Manu extension package.");
    }
    const manifest = pack.manifest;
    if (!ID_PATTERN.test(manifest.id ?? "")) problems.push("The extension id is not usable.");
    if ((manifest.name ?? "").trim() === "") problems.push("The extension has no name.");
    if ((manifest.author ?? "").trim() === "") problems.push("The extension names no author.");
    if (!VERSION_PATTERN.test(manifest.version ?? "")) {
      problems.push(`"${manifest.version}" is not a usable version.`);
    }
    if (!EXTENSION_CATEGORIES.includes(manifest.category)) {
      problems.push(`"${String(manifest.category)}" is not a category the catalogue has.`);
    }
    if (majorOf(manifest.compatibility?.ecosystem ?? "") !== majorOf(ECOSYSTEM_VERSION)) {
      problems.push(
        `Built for ecosystem ${manifest.compatibility?.ecosystem ?? "?"} — this Manu speaks ${ECOSYSTEM_VERSION}.`,
      );
    }

    const verdict =
      pack.integrity === undefined
        ? { trust: "invalid" as const, reason: "The package carries no integrity information." }
        : verifyIntegrity(manifest, pack.integrity, this.options.trustedKeys);
    if (verdict.trust === "invalid") {
      problems.push(verdict.reason ?? "The package fails integrity verification.");
    } else if (verdict.reason !== undefined) {
      warnings.push(verdict.reason);
    }

    const adds: string[] = [];
    const contributions = manifest.contributions ?? {};
    if (contributions.plugin !== undefined) {
      const result = validatePluginManifest(contributions.plugin);
      if (!result.ok) {
        for (const error of result.errors) problems.push(`Plugin: ${error}`);
      } else {
        adds.push(`Plugin — ${contributions.plugin.name}`);
        warnings.push(...result.warnings.map((held) => `Plugin: ${held}`));
      }
    }
    const validation: ValidationContext = {
      ...this.options.validation,
      availableAgents: [
        ...this.options.validation.availableAgents,
        ...(contributions.agents ?? []).map((held) => held.id),
      ],
    };
    for (const agent of contributions.agents ?? []) {
      const found = validateAgent(agent, validation);
      if (found.length > 0) problems.push(`Agent ${agent.name}: ${found[0] ?? ""}`);
      else adds.push(`Agent — ${agent.name}`);
    }
    for (const flow of contributions.skills ?? []) {
      const found = validateFlow(flow, validation);
      if (found.length > 0) problems.push(`Skill ${flow.name}: ${found[0] ?? ""}`);
      else
        adds.push(
          `Skill — ${flow.name}${flow.commandAlias !== undefined ? ` (/${flow.commandAlias})` : ""}`,
        );
    }
    for (const template of contributions.templates ?? []) {
      adds.push(`Project template — ${template.name}`);
    }
    if ((contributions.modules ?? []).length > 0) {
      adds.push(`Genre modules — ${(contributions.modules ?? []).join(", ")}`);
    }
    if (adds.length === 0) problems.push("The package contributes nothing.");

    return { manifest, trust: verdict.trust, adds, problems, warnings };
  }

  // ── Install / update / rollback / remove (§6–§8) ──────────────────────────

  async install(
    raw: string,
    options: { readonly approve?: boolean } = {},
  ): Promise<InstalledExtension> {
    const details = this.inspect(raw);
    if (details.problems.length > 0) {
      throw new ExtensionError("invalid_package", details.problems[0] ?? "Invalid package.", {
        details: { problems: details.problems },
      });
    }
    this.checkDependencies(details);
    if (details.manifest.permissions.length > 0 && options.approve !== true) {
      throw new ExtensionError(
        "approval_required",
        `${details.manifest.name} asks for: ${details.manifest.permissions.join(", ")}. Review and approve to install.`,
        { details: { permissions: details.manifest.permissions } },
      );
    }
    await this.files.writeProjectFile(this.packagePath(details.manifest.id), raw);
    this.state[details.manifest.id] = {
      version: details.manifest.version,
      enabled: true,
      trust: details.trust,
      approvedPermissions: details.manifest.permissions,
      installedAt: this.now(),
    };
    await this.persist();
    return this.require(details.manifest.id);
  }

  /** §7: versioned update; *added* permissions demand renewed approval. */
  async update(
    raw: string,
    options: { readonly approve?: boolean } = {},
  ): Promise<InstalledExtension> {
    const details = this.inspect(raw);
    if (details.problems.length > 0) {
      throw new ExtensionError("invalid_package", details.problems[0] ?? "Invalid package.");
    }
    const held = this.state[details.manifest.id];
    if (held === undefined) {
      throw new ExtensionError("not_installed", `${details.manifest.name} is not installed.`);
    }
    if (compareVersions(details.manifest.version, held.version) <= 0) {
      throw new ExtensionError(
        "invalid_package",
        `Version ${details.manifest.version} is not newer than the installed ${held.version}.`,
      );
    }
    const added = details.manifest.permissions.filter(
      (permission) => !held.approvedPermissions.includes(permission),
    );
    if (added.length > 0 && options.approve !== true) {
      throw new ExtensionError(
        "approval_required",
        `This update adds permissions: ${added.join(", ")}. Review and approve to update.`,
        { details: { added } },
      );
    }
    this.checkDependencies(details);
    // §8: keep what we are replacing, so a failed update can roll back.
    const previous = await this.files.readProjectFile(this.packagePath(details.manifest.id));
    if (previous !== null) {
      await this.files.writeProjectFile(this.previousPath(details.manifest.id), previous);
    }
    await this.files.writeProjectFile(this.packagePath(details.manifest.id), raw);
    this.state[details.manifest.id] = {
      version: details.manifest.version,
      enabled: held.enabled,
      trust: details.trust,
      approvedPermissions: details.manifest.permissions,
      installedAt: this.now(),
      previousVersion: held.version,
    };
    await this.persist();
    return this.require(details.manifest.id);
  }

  async rollback(id: string): Promise<InstalledExtension> {
    const held = this.state[id];
    if (held === undefined) throw new ExtensionError("not_installed", `"${id}" is not installed.`);
    const previous = await this.files.readProjectFile(this.previousPath(id));
    if (held.previousVersion === undefined || previous === null) {
      throw new ExtensionError("nothing_to_roll_back", "No previous version is preserved.");
    }
    const details = this.inspect(previous);
    await this.files.writeProjectFile(this.packagePath(id), previous);
    await this.files.writeProjectFile(this.previousPath(id), "");
    this.state[id] = {
      version: details.manifest.version,
      enabled: held.enabled,
      trust: details.trust,
      approvedPermissions: details.manifest.permissions,
      installedAt: this.now(),
    };
    await this.persist();
    return this.require(id);
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    const held = this.state[id];
    if (held === undefined) throw new ExtensionError("not_installed", `"${id}" is not installed.`);
    this.state[id] = { ...held, enabled };
    await this.persist();
  }

  /** Removal deregisters contributions; project records stay untouched. */
  async remove(id: string): Promise<void> {
    if (this.state[id] === undefined) {
      throw new ExtensionError("not_installed", `"${id}" is not installed.`);
    }
    const raw = await this.files.readProjectFile(this.packagePath(id));
    if (raw !== null) {
      await this.files.writeProjectFile(`${this.packagePath(id)}.removed`, raw);
      await this.files.writeProjectFile(this.packagePath(id), "");
    }
    delete this.state[id];
    await this.persist();
  }

  // ── Dependencies (§9) ─────────────────────────────────────────────────────

  private checkDependencies(details: ExtensionDetails): void {
    for (const dependency of details.manifest.dependencies ?? []) {
      const installed = this.state[dependency.id];
      if (installed === undefined) {
        throw new ExtensionError(
          "missing_dependency",
          `${details.manifest.name} needs "${dependency.id}", which is not installed.`,
        );
      }
      if (
        dependency.version !== undefined &&
        compareVersions(installed.version, dependency.version) < 0
      ) {
        throw new ExtensionError(
          "missing_dependency",
          `${details.manifest.name} needs "${dependency.id}" ${dependency.version} or newer; ${installed.version} is installed.`,
        );
      }
      if ((details.manifest.dependencies ?? []).some((held) => held.id === details.manifest.id)) {
        throw new ExtensionError("dependency_cycle", "An extension cannot depend on itself.");
      }
    }
    // Bounded complexity: one level of dependencies, no chains — a cycle
    // therefore cannot form beyond self-reference, and dependency graphs
    // stay inspectable at a glance.
  }

  // ── Reading the installed world ───────────────────────────────────────────

  private async require(id: string): Promise<InstalledExtension> {
    const found = await this.get(id);
    /* istanbul ignore next — callers write the entry first. */
    if (found === null) throw new ExtensionError("not_installed", `"${id}" is not installed.`);
    return found;
  }

  async installed(): Promise<readonly InstalledExtension[]> {
    const out: InstalledExtension[] = [];
    for (const [id, held] of Object.entries(this.state)) {
      const raw = await this.files.readProjectFile(this.packagePath(id));
      if (raw === null || raw.trim() === "") continue;
      const pack = JSON.parse(raw) as ExtensionPackage;
      out.push({
        manifest: pack.manifest,
        enabled: held.enabled,
        trust: held.trust,
        installedAt: held.installedAt,
        approvedPermissions: held.approvedPermissions,
        ...(held.previousVersion !== undefined ? { previousVersion: held.previousVersion } : {}),
      });
    }
    return out;
  }

  async get(id: string): Promise<InstalledExtension | null> {
    return (await this.installed()).find((held) => held.manifest.id === id) ?? null;
  }

  /** Everything the enabled extensions contribute, for the host to register. */
  async contributions(): Promise<{
    readonly plugins: readonly NonNullable<
      ExtensionPackage["manifest"]["contributions"]["plugin"]
    >[];
    readonly agents: readonly NonNullable<
      ExtensionPackage["manifest"]["contributions"]["agents"]
    >[number][];
    readonly skills: readonly NonNullable<
      ExtensionPackage["manifest"]["contributions"]["skills"]
    >[number][];
    readonly templates: readonly NonNullable<
      ExtensionPackage["manifest"]["contributions"]["templates"]
    >[number][];
    readonly modules: readonly string[];
  }> {
    const plugins = [];
    const agents = [];
    const skills = [];
    const templates = [];
    const modules = new Set<string>();
    for (const extension of await this.installed()) {
      if (!extension.enabled) continue;
      const held = extension.manifest.contributions;
      if (held.plugin !== undefined) plugins.push(held.plugin);
      agents.push(...(held.agents ?? []));
      skills.push(...(held.skills ?? []));
      templates.push(...(held.templates ?? []));
      for (const moduleId of held.modules ?? []) modules.add(moduleId);
    }
    return { plugins, agents, skills, templates, modules: [...modules] };
  }

  // ── Catalogue and updates (§4, §15, §16) ──────────────────────────────────

  /** Entries not yet installed. A failing catalogue yields an empty list. */
  async available(catalogue: CataloguePort): Promise<readonly CatalogueEntry[]> {
    try {
      const entries = await catalogue.list();
      return entries.filter((entry) => this.state[entry.id] === undefined);
    } catch {
      return [];
    }
  }

  /** Installed extensions the catalogue has newer versions of. */
  async updates(catalogue: CataloguePort): Promise<readonly CatalogueEntry[]> {
    try {
      const entries = await catalogue.list();
      return entries.filter((entry) => {
        const held = this.state[entry.id];
        return held !== undefined && compareVersions(entry.version, held.version) > 0;
      });
    } catch {
      return [];
    }
  }

  // ── Project needs (§10) ───────────────────────────────────────────────────

  async projectNeeds(): Promise<ProjectExtensionNeeds> {
    const raw = await this.files.readProjectFile(PROJECT_NEEDS_PATH);
    return raw === null || raw.trim() === ""
      ? { required: [], recommended: [] }
      : (JSON.parse(raw) as ProjectExtensionNeeds);
  }

  async declareProjectNeeds(needs: ProjectExtensionNeeds): Promise<void> {
    await this.files.writeProjectFile(PROJECT_NEEDS_PATH, JSON.stringify(needs, null, 2));
  }

  /** What the open project asks for that is not installed. Never auto-installed. */
  async missing(): Promise<{
    readonly required: readonly string[];
    readonly recommended: readonly string[];
  }> {
    const needs = await this.projectNeeds();
    const absent = (list: readonly { id: string }[]) =>
      list.filter((held) => this.state[held.id] === undefined).map((held) => held.id);
    return { required: absent(needs.required), recommended: absent(needs.recommended) };
  }
}
