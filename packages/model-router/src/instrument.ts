import type { LanguageModel } from "./model";
import type { RequestOptions, TokenUsage } from "./types";

/**
 * Wrap a model so every call additionally reports its token usage to `sink`
 * (Phase 36 §10). The caller's own `onUsage`, when present, still fires —
 * instrumentation observes, it never replaces. This is how a builder or the
 * usage ledger counts actual tokens without any call site changing shape.
 */
export function instrumentModel(
  model: LanguageModel,
  sink: (usage: TokenUsage) => void,
): LanguageModel {
  const chain = (options?: RequestOptions): RequestOptions => ({
    ...options,
    onUsage: (usage) => {
      options?.onUsage?.(usage);
      sink(usage);
    },
  });
  return {
    id: model.id,
    capabilities: model.capabilities,
    generateText: (request, options) => model.generateText(request, chain(options)),
    streamText: (request, options) => model.streamText(request, chain(options)),
    generateStructured: (request, options) => model.generateStructured(request, chain(options)),
    runWithTools: (request, options) => model.runWithTools(request, chain(options)),
  };
}
