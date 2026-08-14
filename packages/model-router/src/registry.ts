import type { ModelCapabilities } from "./types";

export interface CostMetadata {
  /** Cost per 1M input tokens, in `currency`. */
  readonly inputPer1M?: number;
  /** Cost per 1M output tokens, in `currency`. */
  readonly outputPer1M?: number;
  readonly currency?: string;
}

/**
 * Provider-independent metadata for a model. Product code inspects these fields
 * (capabilities, context window, cost) rather than hard-coding behaviour around
 * any particular model name (docs/MODEL_ROUTER.md).
 */
export interface ModelDescriptor {
  readonly provider: string;
  readonly modelId: string;
  readonly displayName: string;
  readonly capabilities: ModelCapabilities;
  readonly contextWindow?: number;
  readonly costMetadata?: CostMetadata;
  readonly supportsTools: boolean;
  readonly supportsStructuredOutput: boolean;
  readonly supportsStreaming: boolean;
  /**
   * Capabilities nobody has actually told us about.
   *
   * A discovered Ollama model reports a name and little else: whether it does
   * tool calling depends on the weights, not on the server. Rather than assume
   * `true` and fail mysteriously at the first tool call, or assume `false` and
   * refuse a model that works, the honest answer is recorded here and surfaced
   * (docs/MODEL_ROUTER.md — "Do not guess unknown capabilities").
   */
  readonly unknownCapabilities?: readonly (keyof ModelCapabilities)[];
  /** True when the model accepts images. Absent when nobody has said.  */
  readonly vision?: boolean;
  /** True when the model is a reasoning model. Absent when nobody has said. */
  readonly reasoning?: boolean;
}

/** Whether a capability is known to be supported, known absent, or unknown. */
export type CapabilityState = "yes" | "no" | "unknown";

export function capabilityState(
  descriptor: ModelDescriptor,
  capability: keyof ModelCapabilities,
): CapabilityState {
  if (descriptor.unknownCapabilities?.includes(capability) === true) return "unknown";
  return descriptor.capabilities[capability] ? "yes" : "no";
}

/**
 * Why a model cannot be used for an operation, or `null` when it can.
 *
 * "Unknown" is deliberately allowed through with no complaint — refusing a
 * local model because nobody publishes a capability table for it would make the
 * strictness worse than useless. What is refused is a model known not to do the
 * thing (docs/MODEL_ROUTER.md).
 */
export function capabilityRefusal(
  descriptor: ModelDescriptor,
  required: readonly (keyof ModelCapabilities)[],
): string | null {
  const missing = required.filter((capability) => capabilityState(descriptor, capability) === "no");
  if (missing.length === 0) return null;
  const names: Record<keyof ModelCapabilities, string> = {
    streaming: "streaming",
    structuredOutput: "structured output",
    tools: "tool calling",
  };
  return `${descriptor.displayName} does not support ${missing.map((m) => names[m]).join(" or ")}, which this operation needs. Choose another model in Settings → AI Providers.`;
}

/** Build a descriptor, deriving the `supports*` flags from `capabilities`. */
export function describeModel(input: {
  provider: string;
  modelId: string;
  displayName: string;
  capabilities: ModelCapabilities;
  contextWindow?: number;
  costMetadata?: CostMetadata;
  unknownCapabilities?: readonly (keyof ModelCapabilities)[];
  vision?: boolean;
  reasoning?: boolean;
}): ModelDescriptor {
  return {
    ...input,
    supportsTools: input.capabilities.tools,
    supportsStructuredOutput: input.capabilities.structuredOutput,
    supportsStreaming: input.capabilities.streaming,
  };
}

const key = (provider: string, modelId: string): string => `${provider}:${modelId}`;

/** A catalog of known models across providers. */
export class ModelRegistry {
  private readonly models = new Map<string, ModelDescriptor>();

  register(...descriptors: ModelDescriptor[]): this {
    for (const d of descriptors) this.models.set(key(d.provider, d.modelId), d);
    return this;
  }

  get(provider: string, modelId: string): ModelDescriptor | undefined {
    return this.models.get(key(provider, modelId));
  }

  list(provider?: string): ModelDescriptor[] {
    const all = [...this.models.values()];
    const filtered = provider === undefined ? all : all.filter((d) => d.provider === provider);
    return filtered.sort((a, b) =>
      key(a.provider, a.modelId).localeCompare(key(b.provider, b.modelId)),
    );
  }

  providers(): string[] {
    return [...new Set([...this.models.values()].map((d) => d.provider))].sort();
  }
}
