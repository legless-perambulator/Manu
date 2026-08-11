/**
 * Unicode-aware tokenizer. Lowercases and extracts maximal runs of letters and
 * numbers, so punctuation and whitespace are irrelevant and special characters
 * do not break search. Deterministic.
 */
const TOKEN_RE = /[\p{L}\p{N}]+/gu;

export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const match of text.toLowerCase().matchAll(TOKEN_RE)) {
    out.push(match[0]);
  }
  return out;
}

export interface ParsedQuery {
  /** Bare terms, all of which must be present (AND). */
  readonly terms: string[];
  /** Quoted phrases, matched as adjacent token sequences. */
  readonly phrases: string[];
}

const PHRASE_RE = /"([^"]+)"/g;

/**
 * Parse a query string into required terms and quoted phrases. `brass key`
 * requires both tokens anywhere; `"brass key"` requires them adjacent.
 */
export function parseQuery(query: string): ParsedQuery {
  const phrases: string[] = [];
  for (const match of query.matchAll(PHRASE_RE)) {
    const phrase = tokenize(match[1] ?? "").join(" ");
    if (phrase.length > 0) phrases.push(phrase);
  }
  const withoutPhrases = query.replace(PHRASE_RE, " ");
  return { terms: tokenize(withoutPhrases), phrases };
}
