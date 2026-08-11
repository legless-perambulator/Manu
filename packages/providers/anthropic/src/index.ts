// Public surface: only the provider-independent implementation and its options.
// Anthropic wire shapes (./wire) and mapping helpers stay internal by design.
export { AnthropicLanguageModel, AnthropicApiError } from "./anthropic-model";
export type { AnthropicModelOptions, FetchLike } from "./anthropic-model";
