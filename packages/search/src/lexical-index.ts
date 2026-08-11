import { tokenize, parseQuery } from "./tokenizer";
import type { SearchDocument, SearchHit, SearchIndex, SearchQuery, ResultKind } from "./types";

interface DocEntry {
  readonly text: string;
  readonly norm: string;
  readonly tokens: Map<string, number>;
  readonly meta: SearchDocument["meta"];
}

const DEFAULT_LIMIT = 50;

/**
 * An in-memory inverted index for exact, deterministic full-text search. Pure
 * TypeScript (no `node:*`), so it runs identically in Node tests and the browser
 * renderer. Supports incremental `upsert`/`remove` so small changes never force
 * a full reindex.
 */
export class LexicalIndex implements SearchIndex {
  private readonly docs = new Map<string, DocEntry>();
  private readonly postings = new Map<string, Map<string, number>>();

  upsert(doc: SearchDocument): void {
    if (this.docs.has(doc.id)) this.remove(doc.id);

    const tokens = new Map<string, number>();
    const ordered: string[] = tokenize(doc.text);
    for (const token of ordered) tokens.set(token, (tokens.get(token) ?? 0) + 1);

    this.docs.set(doc.id, {
      text: doc.text,
      norm: ordered.join(" "),
      tokens,
      meta: doc.meta,
    });
    for (const [token, tf] of tokens) {
      let bucket = this.postings.get(token);
      if (bucket === undefined) {
        bucket = new Map();
        this.postings.set(token, bucket);
      }
      bucket.set(doc.id, tf);
    }
  }

  remove(id: string): void {
    const entry = this.docs.get(id);
    if (entry === undefined) return;
    for (const token of entry.tokens.keys()) {
      const bucket = this.postings.get(token);
      if (bucket === undefined) continue;
      bucket.delete(id);
      if (bucket.size === 0) this.postings.delete(token);
    }
    this.docs.delete(id);
  }

  clear(): void {
    this.docs.clear();
    this.postings.clear();
  }

  size(): number {
    return this.docs.size;
  }

  search(query: SearchQuery): SearchHit[] {
    const parsed = parseQuery(query.text);
    const required = new Set<string>(parsed.terms);
    for (const phrase of parsed.phrases) for (const t of phrase.split(" ")) required.add(t);
    if (required.size === 0) return [];

    const candidates = this.candidateDocs([...required]);
    if (candidates === null) return [];

    const kinds = query.filters?.kinds;
    const allowed = kinds !== undefined ? new Set<ResultKind>(kinds) : null;

    const hits: SearchHit[] = [];
    for (const id of candidates) {
      const entry = this.docs.get(id);
      if (entry === undefined) continue;
      if (allowed !== null && !allowed.has(entry.meta.kind)) continue;
      if (!parsed.phrases.every((p) => entry.norm.includes(p))) continue;

      let score = 0;
      for (const token of required) score += entry.tokens.get(token) ?? 0;
      score += parsed.phrases.length * 5;

      hits.push({
        id,
        score,
        excerpt: makeExcerpt(entry.text, required, parsed.phrases),
        meta: entry.meta,
      });
    }

    hits.sort((a, b) => (b.score - a.score !== 0 ? b.score - a.score : a.id.localeCompare(b.id)));
    return hits.slice(0, query.limit ?? DEFAULT_LIMIT);
  }

  /** Doc ids containing every required token (AND), or null if none can. */
  private candidateDocs(required: string[]): Set<string> | null {
    const buckets = required.map((t) => this.postings.get(t));
    if (buckets.some((b) => b === undefined)) return null;
    const sorted = (buckets as Map<string, number>[]).sort((a, b) => a.size - b.size);
    const smallest = sorted[0];
    if (smallest === undefined) return null;
    const result = new Set<string>();
    outer: for (const id of smallest.keys()) {
      for (let i = 1; i < sorted.length; i++) {
        if (!(sorted[i] as Map<string, number>).has(id)) continue outer;
      }
      result.add(id);
    }
    return result;
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Build a ~180-char excerpt around the first matching term or phrase. */
function makeExcerpt(text: string, terms: Set<string>, phrases: string[]): string {
  const lower = text.toLowerCase();
  let pos = -1;

  for (const phrase of phrases) {
    const re = new RegExp(phrase.split(" ").map(escapeRegExp).join("[^\\p{L}\\p{N}]+"), "u");
    const m = re.exec(lower);
    if (m !== null && (pos === -1 || m.index < pos)) pos = m.index;
  }
  if (pos === -1) {
    for (const term of terms) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}`, "u");
      const m = re.exec(lower);
      if (m !== null && (pos === -1 || m.index < pos)) pos = m.index;
    }
  }
  if (pos === -1) pos = 0;

  const start = Math.max(0, pos - 60);
  const end = Math.min(text.length, pos + 120);
  let excerpt = text.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) excerpt = `…${excerpt}`;
  if (end < text.length) excerpt = `${excerpt}…`;
  return excerpt;
}
