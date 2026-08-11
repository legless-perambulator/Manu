// Public surface: only the provider-independent implementation and its options.
// Anthropic wire shapes (./wire), SSE framing (./sse) and mapping helpers stay
// internal by design — no vendor-specific type crosses this boundary.
export { AnthropicLanguageModel } from "./anthropic-model";
export type { AnthropicModelOptions, FetchLike } from "./anthropic-model";

export { AnthropicProvider, ANTHROPIC_MODELS, ANTHROPIC_PROVIDER_NAME } from "./models";
export type { AnthropicProviderOptions } from "./models";
