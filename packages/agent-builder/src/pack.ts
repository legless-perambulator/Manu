import {
  AgentBuilderError,
  BUILDER_VERSION,
  FLOW_OUTPUTS,
  type BuilderScope,
  type CustomAgentDefinition,
  type FlowDefinition,
  type FlowStep,
  type ModelPolicy,
  type PackageMetadata,
} from "./types";

/**
 * Shareable packages (§10, §26).
 *
 * Export writes exactly the definition plus the metadata a future sharing
 * surface needs — name, author, description, version, compatibility,
 * permissions, dependencies — and nothing else. Credentials cannot leak
 * because the definition schema has nowhere to put one; import additionally
 * refuses anything that *looks* like it carries a key, so a hand-edited file
 * with a pasted secret is turned away with a sentence instead of stored.
 */

export interface BuilderPackage {
  readonly kind: "manu-agent" | "manu-skill";
  readonly builder: string;
  readonly name: string;
  readonly author?: string;
  readonly description?: string;
  readonly version: number;
  readonly permissions: readonly string[];
  readonly dependencies: {
    readonly agents: readonly string[];
    readonly tools: readonly string[];
  };
  readonly definition: unknown;
}

const CREDENTIAL_SHAPES = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /"(api[_-]?key|apikey|token|secret|password|credential|authorization)"\s*:/i,
];

function refuseCredentials(raw: string): void {
  for (const shape of CREDENTIAL_SHAPES) {
    if (shape.test(raw)) {
      throw new AgentBuilderError(
        "invalid_package",
        "This file appears to contain a credential. Packages never carry keys — remove it and try again.",
      );
    }
  }
}

function* walkSteps(steps: readonly FlowStep[]): Generator<FlowStep> {
  for (const step of steps) {
    yield step;
    if (step.kind === "branch") {
      yield* walkSteps(step.then);
      yield* walkSteps(step.otherwise);
    }
  }
}

export function exportAgentPackage(agent: CustomAgentDefinition): string {
  const pack: BuilderPackage = {
    kind: "manu-agent",
    builder: BUILDER_VERSION,
    name: agent.name,
    ...(agent.metadata.author !== undefined ? { author: agent.metadata.author } : {}),
    ...(agent.metadata.description !== undefined
      ? { description: agent.metadata.description }
      : {}),
    version: agent.revision,
    permissions: agent.permissions,
    dependencies: { agents: [], tools: agent.tools },
    definition: { ...agent, scope: "project" },
  };
  return `${JSON.stringify(pack, null, 2)}\n`;
}

export function exportFlowPackage(flow: FlowDefinition): string {
  const agents = new Set<string>();
  const tools = new Set<string>();
  for (const step of walkSteps(flow.steps)) {
    if (step.kind === "run_agent") agents.add(step.agent);
    if (step.kind === "run_tool") tools.add(step.tool);
  }
  const pack: BuilderPackage = {
    kind: "manu-skill",
    builder: BUILDER_VERSION,
    name: flow.name,
    ...(flow.metadata.author !== undefined ? { author: flow.metadata.author } : {}),
    ...(flow.metadata.description !== undefined ? { description: flow.metadata.description } : {}),
    version: flow.revision,
    permissions: [],
    dependencies: { agents: [...agents].sort(), tools: [...tools].sort() },
    definition: { ...flow, scope: "project" },
  };
  return `${JSON.stringify(pack, null, 2)}\n`;
}

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((held): held is string => typeof held === "string")
    : [];
}

function metadataOf(raw: Record<string, unknown>): PackageMetadata {
  const held = (raw["metadata"] ?? {}) as Record<string, unknown>;
  return {
    ...(text(held["author"]) === "" ? {} : { author: text(held["author"]) }),
    ...(text(held["description"]) === "" ? {} : { description: text(held["description"]) }),
    compatibility: { app: "manu", builder: BUILDER_VERSION },
  };
}

function modelOf(raw: unknown, where: string): ModelPolicy {
  const held = (raw ?? { kind: "routing" }) as Record<string, unknown>;
  if (held["kind"] === "class") {
    return { kind: "class", modelClass: text(held["modelClass"]) as never };
  }
  if (held["kind"] === "pinned") {
    const modelId = text(held["modelId"]);
    if (modelId === "") {
      throw new AgentBuilderError("invalid_definition", `${where}: a pinned model needs an id.`);
    }
    return { kind: "pinned", modelId };
  }
  return { kind: "routing" };
}

/** Turn one file's contents into an agent, or explain why it cannot be one. */
export function parseAgentDefinition(
  raw: string,
  where: string,
  scope: BuilderScope,
): CustomAgentDefinition {
  refuseCredentials(raw);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (cause) {
    throw new AgentBuilderError("invalid_definition", `${where}: not valid JSON.`, { cause });
  }
  const id = text(parsed["id"]);
  const name = text(parsed["name"]);
  if (id === "") throw new AgentBuilderError("invalid_definition", `${where}: "id" is required.`);
  if (name === "")
    throw new AgentBuilderError("invalid_definition", `${where}: "name" is required.`);
  const context = (parsed["context"] ?? {}) as Record<string, unknown>;
  const output = (parsed["output"] ?? { kind: "notes" }) as Record<string, unknown>;
  return {
    id,
    name,
    purpose: text(parsed["purpose"]),
    instructions: text(parsed["instructions"]),
    permissions: strings(parsed["permissions"]) as never,
    tools: strings(parsed["tools"]),
    model: modelOf(parsed["model"], where),
    context: {
      ...(context["currentScene"] === true ? { currentScene: true } : {}),
      ...(context["currentChapter"] === true ? { currentChapter: true } : {}),
      ...(context["charactersPresent"] === true ? { charactersPresent: true } : {}),
      ...(context["relevantResearch"] === true ? { relevantResearch: true } : {}),
      ...(context["plotThreads"] === true ? { plotThreads: true } : {}),
      ...(context["authorVoice"] === true ? { authorVoice: true } : {}),
      ...(text(context["recipe"]) === "" ? {} : { recipe: text(context["recipe"]) }),
    },
    output: output["kind"] === "proposals" ? { kind: "proposals" } : { kind: "notes" },
    ...(text(parsed["commandAlias"]) === "" ? {} : { commandAlias: text(parsed["commandAlias"]) }),
    scope,
    revision: typeof parsed["revision"] === "number" ? parsed["revision"] : 1,
    metadata: metadataOf(parsed),
  };
}

function stepOf(raw: unknown, where: string, index: number, depth: number): FlowStep {
  const held = (raw ?? {}) as Record<string, unknown>;
  const kind = text(held["kind"]);
  const id = text(held["id"]) === "" ? `step-${String(index + 1)}` : text(held["id"]);
  const title = text(held["title"]) === "" ? kind.replace(/_/g, " ") : text(held["title"]);
  const base = { id, title };
  switch (kind) {
    case "run_agent": {
      const retry = held["retry"] as Record<string, unknown> | undefined;
      return {
        kind,
        ...base,
        agent: text(held["agent"]),
        instruction: text(held["instruction"]),
        ...(retry !== undefined && typeof retry["maxAttempts"] === "number"
          ? { retry: { maxAttempts: retry["maxAttempts"] } }
          : {}),
      };
    }
    case "run_tool":
      return { kind, ...base, tool: text(held["tool"]) };
    case "search_project":
      return { kind, ...base, query: text(held["query"]) };
    case "compile_context":
      return { kind, ...base, recipe: text(held["recipe"]) as never };
    case "run_story_build":
    case "run_story_tests":
    case "generate_report":
    case "apply_staged_changes":
      return { kind, ...base };
    case "request_approval":
      return { kind, ...base, question: text(held["question"]) };
    case "branch": {
      if (depth > 0) {
        throw new AgentBuilderError(
          "invalid_workflow",
          `${where}: a branch inside a branch is not supported.`,
        );
      }
      const condition = (held["condition"] ?? {}) as Record<string, unknown>;
      const children = (value: unknown): FlowStep[] =>
        Array.isArray(value)
          ? value.map((child, childIndex) => stepOf(child, where, childIndex, depth + 1))
          : [];
      return {
        kind,
        ...base,
        condition: {
          measure: text(condition["measure"]) as never,
          comparison: condition["comparison"] === "equals" ? "equals" : "greater_than",
          value: typeof condition["value"] === "number" ? condition["value"] : 0,
        },
        then: children(held["then"]),
        otherwise: children(held["otherwise"]),
      };
    }
    default:
      throw new AgentBuilderError(
        "invalid_workflow",
        `${where}: step ${String(index + 1)} has the kind "${kind}", which Manu does not have.`,
      );
  }
}

/** Turn one file's contents into a flow, or explain why it cannot be one. */
export function parseFlowDefinition(
  raw: string,
  where: string,
  scope: BuilderScope,
): FlowDefinition {
  refuseCredentials(raw);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (cause) {
    throw new AgentBuilderError("invalid_definition", `${where}: not valid JSON.`, { cause });
  }
  const id = text(parsed["id"]);
  const name = text(parsed["name"]);
  if (id === "") throw new AgentBuilderError("invalid_definition", `${where}: "id" is required.`);
  if (name === "")
    throw new AgentBuilderError("invalid_definition", `${where}: "name" is required.`);
  const steps = Array.isArray(parsed["steps"]) ? parsed["steps"] : [];
  const output = text(parsed["output"]);
  return {
    id,
    name,
    description: text(parsed["description"]),
    inputs: Array.isArray(parsed["inputs"])
      ? parsed["inputs"].map((entry) => {
          const held = (entry ?? {}) as Record<string, unknown>;
          const key = text(held["key"]);
          if (key === "") {
            throw new AgentBuilderError("invalid_definition", `${where}: an input has no key.`);
          }
          return {
            key,
            label: text(held["label"]) === "" ? key : text(held["label"]),
            required: held["required"] === true,
            ...(text(held["entityKind"]) === ""
              ? {}
              : { entityKind: text(held["entityKind"]) as never }),
          };
        })
      : [],
    steps: steps.map((entry, index) => stepOf(entry, where, index, 0)),
    output: (FLOW_OUTPUTS as readonly string[]).includes(output)
      ? (output as FlowDefinition["output"])
      : "report",
    ...(text(parsed["commandAlias"]) === "" ? {} : { commandAlias: text(parsed["commandAlias"]) }),
    scope,
    revision: typeof parsed["revision"] === "number" ? parsed["revision"] : 1,
    metadata: metadataOf(parsed),
  };
}

/** Read a shared package, refuse credentials, hand back what it defines. */
export function importPackage(raw: string): {
  readonly agent?: CustomAgentDefinition;
  readonly flow?: FlowDefinition;
} {
  refuseCredentials(raw);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (cause) {
    throw new AgentBuilderError("invalid_package", "Not a valid package file.", { cause });
  }
  const definition = JSON.stringify(parsed["definition"] ?? parsed);
  if (parsed["kind"] === "manu-skill") {
    return { flow: parseFlowDefinition(definition, "package", "project") };
  }
  return { agent: parseAgentDefinition(definition, "package", "project") };
}
