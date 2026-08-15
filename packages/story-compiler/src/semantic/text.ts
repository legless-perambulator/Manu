/**
 * Deterministic text measurements the heuristic rules share.
 *
 * Nothing here judges anything — these are counts and extractions, and the
 * rules that use them still emit HEURISTIC findings, never errors.
 */

/** Prose with scene markers and comments removed. */
export function cleanProse(text: string): string {
  return text
    .replace(/<!--[^>]*-->/g, " ")
    .replace(/^#+ .*$/gm, " ")
    .trim();
}

export function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}'’]+/gu) ?? [];
}

/** Sentences, crudely but consistently. */
export function sentencesOf(text: string): string[] {
  return cleanProse(text)
    .split(/(?<=[.!?…])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

/** Quoted dialogue spans, straight or curly. */
export function dialogueOf(text: string): string[] {
  const spans: string[] = [];
  for (const match of cleanProse(text).matchAll(/["“]([^"”]{2,300})["”]/g)) {
    spans.push((match[1] ?? "").trim());
  }
  return spans;
}

/** How much of the prose is inside quotation marks, 0–1. */
export function dialogueRatio(text: string): number {
  const total = wordsOf(cleanProse(text)).length;
  if (total === 0) return 0;
  const quoted = dialogueOf(text).reduce((sum, span) => sum + wordsOf(span).length, 0);
  return Math.min(1, quoted / total);
}

/** Word n-grams and how often each occurs. */
export function ngramCounts(text: string, n: number): Map<string, number> {
  const words = wordsOf(cleanProse(text));
  const counts = new Map<string, number>();
  for (let i = 0; i + n <= words.length; i += 1) {
    const gram = words.slice(i, i + n).join(" ");
    counts.set(gram, (counts.get(gram) ?? 0) + 1);
  }
  return counts;
}

/**
 * Perception-filter constructions: "she saw", "he felt", "Mara noticed" —
 * the narration reporting perception instead of rendering the thing itself.
 */
const FILTER_VERBS = [
  "saw",
  "watched",
  "heard",
  "felt",
  "noticed",
  "realised",
  "realized",
  "seemed",
  "wondered",
  "knew",
] as const;

export function filteringCount(text: string): { count: number; examples: string[] } {
  const examples: string[] = [];
  let count = 0;
  for (const sentence of sentencesOf(text)) {
    const lowered = sentence.toLowerCase();
    if (
      FILTER_VERBS.some((verb) => new RegExp(`\\b(she|he|they|i|\\w+)\\s+${verb}\\b`).test(lowered))
    ) {
      count += 1;
      if (examples.length < 3) examples.push(shorten(sentence));
    }
  }
  return { count, examples };
}

/** Body-reaction clichés that read as repeated emotional tells. */
const EMOTIONAL_TELLS = [
  "heart pounded",
  "heart raced",
  "heart hammered",
  "breath caught",
  "stomach dropped",
  "stomach twisted",
  "blood ran cold",
  "hands trembled",
  "throat tightened",
] as const;

export function emotionalTells(text: string): Map<string, number> {
  const lowered = cleanProse(text).toLowerCase();
  const counts = new Map<string, number>();
  for (const tell of EMOTIONAL_TELLS) {
    const found = lowered.split(tell).length - 1;
    if (found > 0) counts.set(tell, found);
  }
  return counts;
}

export function shorten(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** A short excerpt of a scene for a model prompt — bounded, never the book. */
export function excerpt(text: string, maxWords = 350): string {
  const words = cleanProse(text).split(/\s+/);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")} […]`;
}

/** FNV-1a over a string — the cache validity hash (§13). */
export function contentHash(material: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < material.length; i += 1) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
