import type { LanguageModel } from "./model";
import type { ModelDescriptor } from "./registry";

/** Credentials/config needed to instantiate a provider's model. */
export interface ProviderCredentials {
  readonly apiKey?: string;
  readonly baseUrl?: string;
}

/**
 * A model provider: it knows its catalog and can construct a
 * {@link LanguageModel} for one of its models given credentials. Registering a
 * new provider is how the product gains support for a new backend without any
 * change to core code (docs/MODEL_ROUTER.md).
 */
export interface ModelProvider {
  readonly name: string;
  models(): ModelDescriptor[];
  createModel(modelId: string, credentials: ProviderCredentials): LanguageModel;
}
