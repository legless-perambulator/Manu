import { validateManifest } from "./validate";
import type {
  ObjectSchema,
  PluginManifest,
  PluginPermission,
  PluginTool,
  ToolCallOutcome,
  ValidationResult,
} from "./types";

/**
 * The plugin host (§13, §16–§19).
 *
 * Everything a plugin does runs through here, against exactly the
 * capabilities the environment hands in: a project reader the host built, a
 * fetcher the host controls, a secret getter scoped to the plugin's own keys.
 * A plugin cannot reach the shell, the filesystem, other plugins' secrets or
 * an undeclared host, because no path to them exists. Failures are isolated:
 * a broken plugin produces an error record, never a crash.
 */

export interface HostEnvironment {
  /** Present only when the app supports outbound requests at all. */
  readonly fetchJson?: (url: string, headers: Record<string, string>) => Promise<unknown>;
  /** Plugin-scoped: the host prefixes keys, so plugins cannot name others'. */
  readonly getSecret?: (pluginId: string, name: string) => Promise<string | null>;
  /** Granted project capabilities, built by the host per permission. */
  readonly project?: {
    readonly chapters?: () => Promise<ReadonlyArray<{ title: string; text: string }>>;
    readonly entityCounts?: () => Promise<Readonly<Record<string, number>>>;
  };
}

export interface InstalledPlugin {
  readonly manifest: PluginManifest;
  readonly enabled: boolean;
  /** What the writer actually granted — never more than was requested. */
  readonly granted: readonly PluginPermission[];
  readonly warnings: readonly string[];
  /** The last load/run failure, kept for View Error (§19). */
  readonly error?: string;
}

/** Validate a runtime value against a tool schema. Returns problems. */
export function checkValue(schema: ObjectSchema, value: unknown, where: string): string[] {
  const problems: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [`${where} must be an object.`];
  }
  const record = value as Record<string, unknown>;
  for (const [field, spec] of Object.entries(schema.fields)) {
    const held = record[field];
    if (held === undefined) {
      if (spec.required === true) problems.push(`${where}.${field} is required.`);
      continue;
    }
    if (typeof held !== spec.kind) {
      problems.push(`${where}.${field} must be a ${spec.kind}.`);
    }
  }
  if (schema.rows !== undefined) {
    const rows = record[schema.rows.name];
    if (rows !== undefined) {
      if (!Array.isArray(rows)) {
        problems.push(`${where}.${schema.rows.name} must be an array.`);
      } else {
        for (const [index, row] of rows.entries()) {
          problems.push(
            ...checkValue(
              { fields: schema.rows.fields },
              row,
              `${where}.${schema.rows.name}[${index}]`,
            ),
          );
        }
      }
    }
  }
  return problems;
}

function pathInto(value: unknown, path: string): unknown {
  let held: unknown = value;
  for (const part of path.split(".")) {
    if (typeof held !== "object" || held === null) return undefined;
    held = (held as Record<string, unknown>)[part];
  }
  return held;
}

export class PluginHost {
  private readonly held = new Map<string, InstalledPlugin>();
  private readonly log: string[] = [];

  constructor(private readonly env: HostEnvironment) {}

  private note(line: string): void {
    this.log.push(`${new Date().toISOString()} ${line}`);
    if (this.log.length > 200) this.log.shift();
  }

  /** Developer mode's log view (§22). */
  logs(): readonly string[] {
    return this.log;
  }

  /** Validate and register. Incompatible or invalid plugins never load (§3). */
  install(raw: string | unknown): ValidationResult {
    const result = validateManifest(raw);
    if (!result.ok || result.manifest === undefined) {
      this.note(`install rejected: ${result.errors[0] ?? "invalid manifest"}`);
      return result;
    }
    this.held.set(result.manifest.id, {
      manifest: result.manifest,
      enabled: false,
      granted: [],
      warnings: result.warnings,
    });
    this.note(`installed ${result.manifest.id}@${result.manifest.version}`);
    return result;
  }

  plugins(): readonly InstalledPlugin[] {
    return [...this.held.values()];
  }

  plugin(id: string): InstalledPlugin | null {
    return this.held.get(id) ?? null;
  }

  /**
   * Enable with an explicit grant (§4, §17). Granting is clamped to what the
   * manifest requested — a writer cannot accidentally hand over more, and a
   * plugin cannot receive what it never declared.
   */
  enable(id: string, granted?: readonly PluginPermission[]): InstalledPlugin {
    const plugin = this.held.get(id);
    if (plugin === undefined) throw new Error(`No plugin "${id}" is installed.`);
    const requested = new Set(plugin.manifest.permissions);
    const effective = (granted ?? plugin.manifest.permissions).filter((held) =>
      requested.has(held),
    );
    const next: InstalledPlugin = { ...plugin, enabled: true, granted: effective };
    this.held.set(id, next);
    this.note(`enabled ${id} with [${effective.join(", ")}]`);
    return next;
  }

  disable(id: string): void {
    const plugin = this.held.get(id);
    if (plugin === undefined) return;
    this.held.set(id, { ...plugin, enabled: false, granted: [] });
    this.note(`disabled ${id}`);
  }

  remove(id: string): void {
    this.held.delete(id);
    this.note(`removed ${id}`);
  }

  private recordError(id: string, error: string): void {
    const plugin = this.held.get(id);
    if (plugin !== undefined) this.held.set(id, { ...plugin, error });
    this.note(`${id} failed: ${error}`);
  }

  /**
   * Run a plugin tool (§5, §6): plugin installed and enabled, the
   * implementation's permission granted, input valid, execution isolated,
   * output valid — in that order, and any failure is a typed error result.
   */
  async callTool(
    pluginId: string,
    toolName: string,
    input: Record<string, unknown>,
  ): Promise<ToolCallOutcome> {
    const plugin = this.held.get(pluginId);
    if (plugin === undefined) return { ok: false, error: `No plugin "${pluginId}" is installed.` };
    if (!plugin.enabled) return { ok: false, error: `${plugin.manifest.name} is disabled.` };
    const tool = (plugin.manifest.contributes.tools ?? []).find((held) => held.name === toolName);
    if (tool === undefined) {
      return { ok: false, error: `${plugin.manifest.name} has no tool "${toolName}".` };
    }

    const inputProblems = checkValue(tool.input, input, "input");
    if (inputProblems.length > 0) return { ok: false, error: inputProblems.join(" ") };

    try {
      const value = await this.execute(plugin, tool, input);
      const outputProblems = checkValue(tool.output, value, "output");
      if (outputProblems.length > 0) {
        // Malformed tool output is the plugin's failure, contained here (§25).
        const error = `Tool output failed its own schema: ${outputProblems.join(" ")}`;
        this.recordError(pluginId, error);
        return { ok: false, error };
      }
      return { ok: true, value };
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      this.recordError(pluginId, error);
      return { ok: false, error };
    }
  }

  private granted(plugin: InstalledPlugin, permission: PluginPermission): boolean {
    return plugin.granted.includes(permission);
  }

  private async execute(
    plugin: InstalledPlugin,
    tool: PluginTool,
    input: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const implementation = tool.implementation;

    if (implementation.kind === "computed") {
      if (implementation.operation === "manuscript_statistics") {
        if (!this.granted(plugin, "read_manuscript")) {
          throw new Error(`"${tool.name}" needs the read_manuscript permission.`);
        }
        const chapters = (await this.env.project?.chapters?.()) ?? [];
        return manuscriptStatistics(chapters);
      }
      // entity_counts
      if (!this.granted(plugin, "read_entities")) {
        throw new Error(`"${tool.name}" needs the read_entities permission.`);
      }
      const counts = (await this.env.project?.entityCounts?.()) ?? {};
      return {
        total: Object.values(counts).reduce((sum, held) => sum + held, 0),
        kinds: Object.entries(counts).map(([kind, count]) => ({ kind, count })),
      };
    }

    // http_get_json — the network gate, enforced at call time too (§14, §25).
    const url = implementation.url.replace(/\{input\.([a-z0-9_]+)\}/gi, (_, field: string) =>
      encodeURIComponent(String(input[field] ?? "")),
    );
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") throw new Error("Only https:// requests are allowed.");
    if (!this.granted(plugin, `network:${parsed.hostname}` as PluginPermission)) {
      throw new Error(
        `${plugin.manifest.name} is not granted network access to ${parsed.hostname}.`,
      );
    }
    if (this.env.fetchJson === undefined) {
      throw new Error("This Manu build does not allow plugin network access.");
    }
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(implementation.headers ?? {})) {
      if (value.startsWith("secret:")) {
        if (!this.granted(plugin, "plugin_secrets")) {
          throw new Error(`"${tool.name}" needs the plugin_secrets permission.`);
        }
        const secret = await this.env.getSecret?.(
          plugin.manifest.id,
          value.slice("secret:".length),
        );
        if (secret === null || secret === undefined) {
          throw new Error(`The secret "${value.slice("secret:".length)}" is not configured.`);
        }
        headers[name] = secret;
      } else {
        headers[name] = value;
      }
    }
    const response = await this.env.fetchJson(url, headers);
    const out: Record<string, unknown> = {};
    for (const [field, path] of Object.entries(implementation.pick)) {
      out[field] = pathInto(response, path);
    }
    return out;
  }
}

/** The host-implemented statistics computation, shared with the reference plugin. */
export function manuscriptStatistics(
  chapters: ReadonlyArray<{ title: string; text: string }>,
): Record<string, unknown> {
  let totalWords = 0;
  let dialogueWords = 0;
  let sentences = 0;
  const rows: Array<{ chapter: string; words: number }> = [];
  for (const chapter of chapters) {
    const words = chapter.text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
    totalWords += words.length;
    sentences += (chapter.text.match(/[.!?]+(?:\s|$)/g) ?? []).length;
    for (const quoted of chapter.text.match(/["“][^"”]+["”]/g) ?? []) {
      dialogueWords += quoted.split(/\s+/).length;
    }
    rows.push({ chapter: chapter.title, words: words.length });
  }
  return {
    chapters: chapters.length,
    totalWords,
    averageChapterWords: chapters.length === 0 ? 0 : Math.round(totalWords / chapters.length),
    averageSentenceWords: sentences === 0 ? 0 : Math.round(totalWords / sentences),
    dialoguePercent: totalWords === 0 ? 0 : Math.round((dialogueWords / totalWords) * 100),
    perChapter: rows,
  };
}
