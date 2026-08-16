import { AppError } from "@jellytind/shared";
import type { PluginManifest, PluginPermission } from "@jellytind/plugin-protocol";
import type { CustomAgentDefinition, FlowDefinition } from "@jellytind/agent-builder";

/**
 * The Manu extension ecosystem (Phase 45).
 *
 * One package format unifies everything installable: a plugin (Phase 42), a
 * custom agent or skill flow (Phase 43), a genre pack, a project template,
 * compiler rules — an **Extension**. The goal of this foundation is exactly
 * «discover, inspect, safely install, update and remove»: no payments, no
 * social platform, no remote marketplace yet — but every abstraction shaped
 * so those can arrive without rework (docs/EXTENSIONS.md).
 */

export type ExtensionErrorCode =
  | "invalid_package"
  | "incompatible"
  | "approval_required"
  | "missing_dependency"
  | "dependency_cycle"
  | "not_installed"
  | "nothing_to_roll_back"
  | "integrity";

export class ExtensionError extends AppError {
  constructor(
    code: ExtensionErrorCode,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(code, message, options);
  }
}

/** The ecosystem format version. Major must match to install. */
export const ECOSYSTEM_VERSION = "1.0";

export const EXTENSION_CATEGORIES = [
  "agents",
  "skills",
  "genre_packs",
  "templates",
  "tools",
] as const;
export type ExtensionCategory = (typeof EXTENSION_CATEGORIES)[number];

/** A simple starter shape a template contribution describes. */
export interface TemplateContribution {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** Genre modules the template starts with. */
  readonly modules: readonly string[];
}

/**
 * What an extension contributes. Every entry is an existing, already-secured
 * vocabulary: the plugin protocol's manifest, the builder's agent and flow
 * definitions, module ids from the genre framework. The extension layer adds
 * packaging, not power.
 */
export interface ExtensionContributions {
  readonly plugin?: PluginManifest;
  readonly agents?: readonly CustomAgentDefinition[];
  readonly skills?: readonly FlowDefinition[];
  readonly templates?: readonly TemplateContribution[];
  /** Built-in genre modules this pack turns on. */
  readonly modules?: readonly string[];
}

export interface ExtensionDependency {
  readonly id: string;
  /** Minimum version, when it matters. */
  readonly version?: string;
}

/**
 * Ratings and reviews are architecture only (§11): fields a future catalogue
 * can populate. Nothing social is built on them here.
 */
export interface EcosystemMetadata {
  readonly tags?: readonly string[];
  readonly homepage?: string;
  readonly averageRating?: number;
  readonly ratingCount?: number;
}

export interface ExtensionManifest {
  readonly id: string;
  readonly name: string;
  readonly author: string;
  readonly version: string;
  readonly description: string;
  readonly category: ExtensionCategory;
  readonly compatibility: { readonly app: "manu"; readonly ecosystem: string };
  /** The union of everything inside that needs a grant. */
  readonly permissions: readonly PluginPermission[];
  readonly dependencies: readonly ExtensionDependency[];
  readonly contributions: ExtensionContributions;
  readonly metadata?: EcosystemMetadata;
}

/**
 * Integrity (§3). The digest covers the canonicalised manifest; a signature,
 * when present, covers the digest under a named trusted key. An unsigned
 * package with a valid digest is *intact*, not *verified* — the difference
 * is stated, never blurred.
 */
export interface PackageIntegrity {
  readonly algorithm: "sha256";
  readonly digest: string;
  readonly signature?: { readonly keyId: string; readonly value: string };
}

/** The distributable unit: a manifest plus its integrity envelope. */
export interface ExtensionPackage {
  readonly format: "manu-extension";
  readonly ecosystem: string;
  readonly manifest: ExtensionManifest;
  readonly integrity: PackageIntegrity;
}

export type TrustLevel = "trusted" | "unsigned" | "invalid";

/** What inspection shows before anything installs (§5, §14). */
export interface ExtensionDetails {
  readonly manifest: ExtensionManifest;
  readonly trust: TrustLevel;
  /** Human lines: "1 agent — Noir Dialogue Editor", "2 commands", … */
  readonly adds: readonly string[];
  readonly problems: readonly string[];
  readonly warnings: readonly string[];
}

export interface InstalledExtension {
  readonly manifest: ExtensionManifest;
  readonly enabled: boolean;
  readonly trust: TrustLevel;
  readonly installedAt: string;
  /** Permissions the writer approved at install/update time. */
  readonly approvedPermissions: readonly PluginPermission[];
  /** Present when a previous version is preserved for rollback (§8). */
  readonly previousVersion?: string;
}

/** One row of a catalogue (§4). */
export interface CatalogueEntry {
  readonly id: string;
  readonly name: string;
  readonly author: string;
  readonly version: string;
  readonly description: string;
  readonly category: ExtensionCategory;
  readonly featured?: boolean;
  readonly metadata?: EcosystemMetadata;
}

/**
 * The catalogue, as a port. Today's implementation is local and first-party;
 * a remote catalogue implements the same two calls later. A failing
 * catalogue yields an error the manager tolerates — Manu launches and every
 * installed extension keeps working offline (§16).
 */
export interface CataloguePort {
  list(): Promise<readonly CatalogueEntry[]>;
  /** The raw package text for an entry. */
  fetch(id: string): Promise<string>;
}

export interface FileStorePort {
  readProjectFile(path: string): Promise<string | null>;
  writeProjectFile(path: string, contents: string): Promise<void>;
  listProjectFiles(prefix?: string): Promise<readonly string[]>;
}

/** §10: what a project asks of its environment. Never auto-installed. */
export interface ProjectExtensionNeeds {
  readonly required: readonly ExtensionDependency[];
  readonly recommended: readonly ExtensionDependency[];
}
