import {
  COMPUTED_OPERATIONS,
  PLUGIN_PERMISSIONS,
  protocolCompatible,
  type BasePermission,
  type ObjectSchema,
  type PluginManifest,
  type PluginPermission,
  type ValidationResult,
} from "./types";

/**
 * Manifest validation (§2, §3, §4): the schema is enforced, incompatibility
 * is loud, and contributing a capability requires the matching permission —
 * least privilege is checked at the door, not assumed later.
 */

const ID_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const VERSION_PATTERN = /^\d+\.\d+(?:\.\d+)?$/;
const NAME_PATTERN = /^[a-z][a-z0-9_-]*$/;
const HOST_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

const KNOWN_CONTRIBUTIONS = new Set([
  "tools",
  "commands",
  "skills",
  "compilerRules",
  "contextProviders",
  "importers",
  "exporters",
  "panels",
  "settings",
]);

/** Which permission each contribution kind demands (§4). */
const PERMISSION_FOR: Readonly<Record<string, BasePermission>> = {
  commands: "register_commands",
  skills: "register_skills",
  compilerRules: "register_compiler_rules",
  tools: "register_agent_tools",
  contextProviders: "register_context",
  importers: "register_importers",
  exporters: "register_exporters",
  panels: "register_panels",
  settings: "plugin_settings",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validSchema(schema: unknown, where: string, errors: string[]): schema is ObjectSchema {
  if (!isRecord(schema) || !isRecord(schema["fields"])) {
    errors.push(`${where}: an input/output schema needs a "fields" object.`);
    return false;
  }
  for (const [field, spec] of Object.entries(schema["fields"])) {
    if (!isRecord(spec) || !["string", "number", "boolean"].includes(String(spec["kind"]))) {
      errors.push(`${where}: field "${field}" must declare kind string|number|boolean.`);
    }
  }
  return true;
}

export function validateManifest(raw: string | unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let parsed: unknown;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, errors: ["The manifest is not valid JSON."], warnings };
    }
  } else {
    parsed = raw;
  }
  if (!isRecord(parsed)) {
    return { ok: false, errors: ["The manifest must be a JSON object."], warnings };
  }

  const id = String(parsed["id"] ?? "");
  if (!ID_PATTERN.test(id) || id.includes("..") || id.length > 128) {
    errors.push(`"${id}" is not a valid plugin id (lowercase reverse-domain style).`);
  }
  if (typeof parsed["name"] !== "string" || parsed["name"].trim() === "") {
    errors.push("The plugin needs a name.");
  }
  if (!VERSION_PATTERN.test(String(parsed["version"] ?? ""))) {
    errors.push("The plugin needs a semantic version, e.g. 1.0.0.");
  }
  const declaredProtocol = String(parsed["protocolVersion"] ?? "");
  if (declaredProtocol === "") {
    errors.push("The manifest must declare protocolVersion.");
  } else if (!protocolCompatible(declaredProtocol)) {
    errors.push(
      `This plugin speaks protocol ${declaredProtocol}; this Manu speaks a different major version. It will not be loaded.`,
    );
  }

  // Permissions: known bases, or network:<bare-host>.
  const permissions: PluginPermission[] = [];
  const rawPermissions = Array.isArray(parsed["permissions"]) ? parsed["permissions"] : [];
  for (const held of rawPermissions) {
    const permission = String(held);
    if ((PLUGIN_PERMISSIONS as readonly string[]).includes(permission)) {
      permissions.push(permission as PluginPermission);
    } else if (permission.startsWith("network:")) {
      const host = permission.slice("network:".length);
      if (!HOST_PATTERN.test(host)) {
        errors.push(`"${permission}" is not a valid network permission (bare host names only).`);
      } else {
        permissions.push(permission as PluginPermission);
      }
    } else {
      errors.push(`"${permission}" is not a permission Manu has.`);
    }
  }
  const hosts = new Set(
    permissions
      .filter((held) => held.startsWith("network:"))
      .map((held) => held.slice("network:".length)),
  );

  const contributes = isRecord(parsed["contributes"]) ? parsed["contributes"] : {};
  for (const key of Object.keys(contributes)) {
    if (!KNOWN_CONTRIBUTIONS.has(key)) {
      // Preserved, surfaced, never silently dropped (§21).
      warnings.push(
        `Contribution kind "${key}" is not known to this Manu version. It is preserved but inactive.`,
      );
      continue;
    }
    const needed = PERMISSION_FOR[key];
    if (needed !== undefined && !permissions.includes(needed)) {
      errors.push(`Contributing "${key}" requires the "${needed}" permission.`);
    }
  }

  // Tools: names, schemas, and implementations — including the network gate
  // at validation time (§14): an http tool must name a declared host.
  const tools = Array.isArray(contributes["tools"]) ? contributes["tools"] : [];
  for (const held of tools) {
    if (!isRecord(held)) continue;
    const name = String(held["name"] ?? "");
    if (!NAME_PATTERN.test(name)) {
      errors.push(`Tool name "${name}" must be lowercase words/underscores.`);
      continue;
    }
    validSchema(held["input"], `tool ${name} input`, errors);
    validSchema(held["output"], `tool ${name} output`, errors);
    const implementation = held["implementation"];
    if (!isRecord(implementation)) {
      errors.push(`Tool ${name} has no implementation.`);
      continue;
    }
    if (implementation["kind"] === "computed") {
      if (
        !(COMPUTED_OPERATIONS as readonly string[]).includes(String(implementation["operation"]))
      ) {
        errors.push(
          `Tool ${name}: "${String(implementation["operation"])}" is not a computed operation this Manu provides.`,
        );
      }
    } else if (implementation["kind"] === "http_get_json") {
      const url = String(implementation["url"] ?? "");
      let host = "";
      try {
        const parsedUrl = new URL(url.replace(/\{input\.[a-z0-9_]+\}/gi, "x"));
        if (parsedUrl.protocol !== "https:") {
          errors.push(`Tool ${name}: only https:// URLs are allowed.`);
        }
        host = parsedUrl.hostname;
      } catch {
        errors.push(`Tool ${name}: "${url}" is not a valid URL.`);
      }
      if (host !== "" && !hosts.has(host)) {
        errors.push(
          `Tool ${name} calls ${host}, which the manifest does not declare (add "network:${host}").`,
        );
      }
    } else {
      errors.push(`Tool ${name}: unknown implementation kind "${String(implementation["kind"])}".`);
    }
  }

  // Compiler rules must declare their type; subjective templates cannot be
  // deterministic because deterministic kinds are a closed set (§9).
  const rules = Array.isArray(contributes["compilerRules"]) ? contributes["compilerRules"] : [];
  for (const held of rules) {
    if (!isRecord(held)) continue;
    if (held["type"] !== "deterministic" && held["type"] !== "semantic") {
      errors.push(
        `Compiler rule "${String(held["id"])}" must declare type "deterministic" or "semantic".`,
      );
    }
    if (held["type"] === "deterministic") {
      const template = held["template"];
      const kind = isRecord(template) ? String(template["kind"]) : "";
      if (!["scene_word_limit", "entity_field_required"].includes(kind)) {
        errors.push(
          `Compiler rule "${String(held["id"])}": "${kind}" is not a deterministic template. Subjective checks must be declared semantic.`,
        );
      }
    }
  }

  if (errors.length > 0) return { ok: false, errors, warnings };
  return {
    ok: true,
    manifest: { ...(parsed as unknown as PluginManifest), permissions },
    errors: [],
    warnings,
  };
}
