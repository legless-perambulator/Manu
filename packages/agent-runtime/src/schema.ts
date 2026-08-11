import type { OutputSchema } from "@jellytind/model-router";
import { AgentError } from "./errors";

/**
 * A tool schema: validates a value *and* describes itself to a model.
 *
 * It extends the provider-independent {@link OutputSchema} from the model
 * router, so the same validating contract guards structured model output and
 * tool arguments. `jsonSchema` is the description handed to a provider's
 * tool-calling API; it is data, never provider-specific code
 * (docs/AGENT_TOOLS.md — "Typed schemas in and out").
 */
export interface ToolSchema<T> extends OutputSchema<T> {
  readonly jsonSchema: Readonly<Record<string, unknown>>;
}

/** The value kinds a tool field may declare. */
export type FieldType =
  "string" | "number" | "boolean" | "string[]" | "object" | "object[]" | "unknown";

export interface FieldSpec {
  readonly type: FieldType;
  readonly description: string;
  /** Fields are required unless marked optional. */
  readonly optional?: boolean;
}

const JSON_TYPES: Record<FieldType, Record<string, unknown>> = {
  string: { type: "string" },
  number: { type: "number" },
  boolean: { type: "boolean" },
  "string[]": { type: "array", items: { type: "string" } },
  object: { type: "object" },
  "object[]": { type: "array", items: { type: "object" } },
  unknown: {},
};

function matches(type: FieldType, value: unknown): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "string[]":
      return Array.isArray(value) && value.every((v) => typeof v === "string");
    case "object":
      return typeof value === "object" && value !== null && !Array.isArray(value);
    case "object[]":
      return Array.isArray(value) && value.every((v) => typeof v === "object" && v !== null);
    case "unknown":
      return true;
  }
}

/**
 * Build an object {@link ToolSchema} from a flat field map.
 *
 * Deliberately small and dependency-free: it validates the shape a tool
 * contract actually promises, rejects unknown-typed values, and drops keys the
 * schema does not declare — so a model cannot smuggle extra arguments past a
 * tool. A richer schema library can implement {@link ToolSchema} later without
 * changing any tool.
 */
export function objectSchema<T>(
  name: string,
  fields: Readonly<Record<string, FieldSpec>>,
): ToolSchema<T> {
  const entries = Object.entries(fields);
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, spec] of entries) {
    properties[key] = { ...JSON_TYPES[spec.type], description: spec.description };
    if (spec.optional !== true) required.push(key);
  }

  return {
    name,
    jsonSchema: { type: "object", properties, required, additionalProperties: false },
    parse(value: unknown): T {
      if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new AgentError("invalid_arguments", `${name}: expected an object.`, {
          details: { received: typeof value },
        });
      }
      const source = value as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const [key, spec] of entries) {
        const field = source[key];
        if (field === undefined || field === null) {
          if (spec.optional === true) continue;
          throw new AgentError("invalid_arguments", `${name}: "${key}" is required.`, {
            details: { field: key, expected: spec.type },
          });
        }
        if (!matches(spec.type, field)) {
          throw new AgentError(
            "invalid_arguments",
            `${name}: "${key}" must be of type ${spec.type}.`,
            { details: { field: key, expected: spec.type, received: typeof field } },
          );
        }
        out[key] = field;
      }
      return out as T;
    },
  };
}

/** A schema for a tool that takes no arguments. */
export function emptySchema<T = Record<string, never>>(name: string): ToolSchema<T> {
  return objectSchema<T>(name, {});
}
