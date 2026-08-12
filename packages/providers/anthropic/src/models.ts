import {
  ModelError,
  describeModel,
  type ModelDescriptor,
  type ModelProvider,
  type ProviderCredentials,
} from "@jellytind/model-router";
import { AnthropicLanguageModel, type FetchLike } from "./anthropic-model";

export const ANTHROPIC_PROVIDER_NAME = "anthropic";

const FULL_CAPABILITIES = { streaming: true, structuredOutput: true, tools: true } as const;

/**
 * Catalog of Anthropic models this adapter can serve.
 *
 * This is data, not behaviour: nothing in the product branches on a specific
 * model name (AGENTS.md — "Provider Independence"). Adding or removing an entry
 * changes what the settings UI offers and nothing else, so the catalog can be
 * refreshed as the provider's line-up changes.
 */
export const ANTHROPIC_MODELS: readonly ModelDescriptor[] = [
  describeModel({
    provider: ANTHROPIC_PROVIDER_NAME,
    modelId: "claude-sonnet-4-5",
    displayName: "Claude Sonnet 4.5",
    capabilities: FULL_CAPABILITIES,
    contextWindow: 200_000,
    costMetadata: { inputPer1M: 3, outputPer1M: 15, currency: "USD" },
  }),
  describeModel({
    provider: ANTHROPIC_PROVIDER_NAME,
    modelId: "claude-opus-4-1",
    displayName: "Claude Opus 4.1",
    capabilities: FULL_CAPABILITIES,
    contextWindow: 200_000,
    costMetadata: { inputPer1M: 15, outputPer1M: 75, currency: "USD" },
  }),
  describeModel({
    provider: ANTHROPIC_PROVIDER_NAME,
    modelId: "claude-haiku-4-5",
    displayName: "Claude Haiku 4.5",
    capabilities: FULL_CAPABILITIES,
    contextWindow: 200_000,
    costMetadata: { inputPer1M: 1, outputPer1M: 5, currency: "USD" },
  }),
];

export interface AnthropicProviderOptions {
  /** Inject a `fetch` implementation (tests supply a fake; no network). */
  readonly fetch?: FetchLike;
  /** Extra models to offer beyond {@link ANTHROPIC_MODELS}. */
  readonly extraModels?: readonly ModelDescriptor[];
}

/**
 * {@link ModelProvider} implementation for Anthropic. The application registers
 * providers and asks them for models; it never constructs an adapter directly,
 * so a second provider can be added without touching core code.
 */
export class AnthropicProvider implements ModelProvider {
  readonly name = ANTHROPIC_PROVIDER_NAME;

  constructor(private readonly options: AnthropicProviderOptions = {}) {}

  models(): ModelDescriptor[] {
    return [...ANTHROPIC_MODELS, ...(this.options.extraModels ?? [])];
  }

  createModel(modelId: string, credentials: ProviderCredentials): AnthropicLanguageModel {
    const apiKey = credentials.apiKey;
    if (apiKey === undefined || apiKey.trim() === "") {
      throw new ModelError("auth", "An Anthropic API key is required.", {
        details: { provider: this.name, modelId },
      });
    }
    return new AnthropicLanguageModel({
      apiKey,
      model: modelId,
      ...(credentials.baseUrl !== undefined ? { baseUrl: credentials.baseUrl } : {}),
      ...(this.options.fetch !== undefined ? { fetch: this.options.fetch } : {}),
    });
  }
}
