/**
 * The Manu plugin protocol (Phase 42).
 *
 * A plugin is a **declarative capability bundle**: one validated manifest
 * whose contributions — tools, commands, skills, compiler rules, context
 * providers, importers, exporters, panels, settings — are assembled from
 * closed, host-implemented kinds. That is the sandbox (§13): there is no
 * arbitrary code to escape from, no shell to reach, no filesystem beyond the
 * capabilities the writer granted, and no network call to any host the
 * manifest did not name.
 */

/** The protocol version this build of Manu speaks. Major must match (§3). */
export const PROTOCOL_VERSION = "1.0";

export function protocolCompatible(declared: string): boolean {
  return declared.split(".")[0] === PROTOCOL_VERSION.split(".")[0];
}

/** Everything a plugin may ask for (§4). Nothing is implied. */
export const PLUGIN_PERMISSIONS = [
  "read_manuscript",
  "read_entities",
  "write_research",
  "create_entities",
  "modify_manuscript",
  "register_commands",
  "register_skills",
  "register_compiler_rules",
  "register_agent_tools",
  "register_context",
  "register_importers",
  "register_exporters",
  "register_panels",
  "plugin_settings",
  "plugin_secrets",
] as const;
export type BasePermission = (typeof PLUGIN_PERMISSIONS)[number];
/** Network access is declared per host: `network:api.example.com` (§14). */
export type PluginPermission = BasePermission | `network:${string}`;

// ── Value schemas (§5): typed tool inputs and outputs ──────────────────────

export interface FieldSpec {
  readonly kind: "string" | "number" | "boolean";
  readonly required?: boolean;
  readonly description?: string;
}

/** A flat object, optionally with one table of row objects. */
export interface ObjectSchema {
  readonly fields: Readonly<Record<string, FieldSpec>>;
  readonly rows?: {
    readonly name: string;
    readonly fields: Readonly<Record<string, FieldSpec>>;
  };
}

// ── Tool contributions (§5) ────────────────────────────────────────────────

/** The closed set of host-implemented computations. */
export const COMPUTED_OPERATIONS = ["manuscript_statistics", "entity_counts"] as const;
export type ComputedOperation = (typeof COMPUTED_OPERATIONS)[number];

export type ToolImplementation =
  | { readonly kind: "computed"; readonly operation: ComputedOperation }
  | {
      readonly kind: "http_get_json";
      /** `https://` only; `{input.field}` placeholders are URL-encoded. */
      readonly url: string;
      /** Output field → dot-path into the response JSON. */
      readonly pick: Readonly<Record<string, string>>;
      /** Header values may be `secret:NAME` — resolved from the plugin's own
       * secret storage, never from Manu's provider credentials (§15). */
      readonly headers?: Readonly<Record<string, string>>;
    };

export interface PluginTool {
  readonly name: string;
  readonly description: string;
  readonly input: ObjectSchema;
  readonly output: ObjectSchema;
  readonly implementation: ToolImplementation;
}

// ── Other contributions ────────────────────────────────────────────────────

export interface PluginCommand {
  readonly name: string;
  readonly summary: string;
  readonly action:
    | { readonly kind: "run_tool"; readonly tool: string }
    | { readonly kind: "open_panel"; readonly panel: string };
}

/** Compiler rules must say which kind of claim they make (§9). */
export type CompilerRuleContribution =
  | {
      readonly type: "deterministic";
      readonly id: string;
      readonly name: string;
      readonly description: string;
      readonly severity: "error" | "warning" | "info";
      readonly template:
        | { readonly kind: "scene_word_limit"; readonly maxWords: number }
        | {
            readonly kind: "entity_field_required";
            readonly entity: "character" | "location";
            readonly field: "description" | "notes";
          };
    }
  | {
      readonly type: "semantic";
      readonly id: string;
      readonly name: string;
      /** Handed to the semantic layer; always labelled model judgement. */
      readonly briefing: string;
    };

export interface ContextProviderContribution {
  readonly id: string;
  readonly title: string;
  /** The plugin tool whose report becomes the context entry. */
  readonly tool: string;
}

/** A Markdown-dialect importer (§11): patterns, not code. */
export interface ImporterContribution {
  readonly id: string;
  readonly name: string;
  readonly extensions: readonly string[];
  readonly dialect: {
    readonly chapterHeading: string;
    readonly sceneBreak?: string;
  };
}

/** A text-template exporter (§11). */
export interface ExporterContribution {
  readonly id: string;
  readonly name: string;
  readonly extension: string;
  readonly template: {
    readonly header?: string;
    /** `{title}` and `{number}` placeholders. */
    readonly chapterHeading: string;
    readonly sceneBreak?: string;
    readonly footer?: string;
  };
}

/** A panel that renders one tool's report with Manu's own components (§12). */
export interface PanelContribution {
  readonly id: string;
  readonly title: string;
  readonly purpose: string;
  readonly rendering: { readonly kind: "tool_report"; readonly tool: string };
}

export interface SettingSpec {
  readonly key: string;
  readonly label: string;
  readonly kind: "string" | "number" | "boolean" | "choice";
  readonly choices?: readonly string[];
  readonly defaultValue?: string | number | boolean;
}

export interface PluginContributes {
  readonly tools?: readonly PluginTool[];
  readonly commands?: readonly PluginCommand[];
  /** Existing custom-skill JSON, verbatim — same workflow architecture (§8). */
  readonly skills?: ReadonlyArray<Record<string, unknown>>;
  readonly compilerRules?: readonly CompilerRuleContribution[];
  readonly contextProviders?: readonly ContextProviderContribution[];
  readonly importers?: readonly ImporterContribution[];
  readonly exporters?: readonly ExporterContribution[];
  readonly panels?: readonly PanelContribution[];
  readonly settings?: readonly SettingSpec[];
}

export interface PluginManifest {
  /** Reverse-domain style, e.g. `com.example.police-research` (§2). */
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly protocolVersion: string;
  readonly manuVersion?: string;
  readonly permissions: readonly PluginPermission[];
  readonly contributes: PluginContributes;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly manifest?: PluginManifest;
  readonly errors: readonly string[];
  /** Unknown contribution kinds are preserved and named, never dropped (§21). */
  readonly warnings: readonly string[];
}

export type ToolCallOutcome =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly error: string };
