/**
 * Token accounting.
 *
 * A real tokeniser is provider-specific, and the compiler must stay
 * provider-independent, so the default is a deterministic character-based
 * estimate. It is deliberately named an *estimate* and reported as such in the
 * package metadata; a caller with a real tokeniser injects one and the budget
 * arithmetic is unchanged.
 */
export interface TokenCounter {
  readonly name: string;
  count(text: string): number;
}

/** ~4 characters per token — the usual rough ratio for English prose. */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 4);

export const CHARACTER_ESTIMATOR: TokenCounter = {
  name: "characters/4 (estimate)",
  count: estimateTokens,
};
