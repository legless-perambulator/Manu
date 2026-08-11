import type { AnyId } from "@jellytind/domain";

/**
 * @jellytind/search — project-wide search.
 *
 * Prefers structured data over forcing a model to scan everything
 * (MASTER_BUILD.md §40). The plan is local full-text (lexical) search first,
 * then an optional vector index for semantic search, behind one interface.
 * Phase 0 defines the query/hit shapes; implementations are PLANNED (V1 lexical,
 * V4 semantic — docs/ROADMAP.md).
 */
export type SearchMode = "exact" | "fuzzy" | "semantic";

export interface SearchQuery {
  readonly text: string;
  readonly mode?: SearchMode;
  readonly limit?: number;
}

export interface SearchHit {
  /** Path or entity the hit belongs to. */
  readonly location: string;
  readonly entity?: AnyId;
  readonly snippet: string;
  readonly score: number;
}

export interface SearchIndex {
  /** Add or update a document in the index. */
  upsert(location: string, text: string, entity?: AnyId): Promise<void>;
  remove(location: string): Promise<void>;
  query(query: SearchQuery): Promise<SearchHit[]>;
}
