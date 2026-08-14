/**
 * @jellytind/provider-openai-compatible
 *
 * One chat-completions transport, four provider identities: OpenAI,
 * OpenRouter, Ollama and anything else speaking the same API
 * (docs/MODEL_ROUTER.md).
 */
export { OpenAiCompatibleModel } from "./model";
export type { FetchLike, OpenAiCompatibleModelOptions } from "./model";
export {
  OpenAiCompatibleProvider,
  openAiProvider,
  openRouterProvider,
  ollamaProvider,
  openAiCompatibleProvider,
  parseOpenAiModels,
  parseOllamaModels,
  OPENAI_PROVIDER_ID,
  OPENROUTER_PROVIDER_ID,
  OLLAMA_PROVIDER_ID,
  OPENAI_COMPATIBLE_PROVIDER_ID,
} from "./providers";
export type { CompatibleProviderConfig, CompatibleProviderOptions } from "./providers";
