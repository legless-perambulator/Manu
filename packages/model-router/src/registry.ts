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
}

/** Build a descriptor, deriving the `supports*` flags from `capabilities`. */
export function describeModel(input: {
  provider: string;
  modelId: string;
  displayName: string;
  capabilities: ModelCapabilities;
  contextWindow?: number;
  costMetadata?: CostMetadata;
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
