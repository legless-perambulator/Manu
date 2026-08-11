import type { AnyId } from "@jellytind/domain";

/**
 * Deterministic project search types.
 *
 * A `SearchDocument` is a unit of searchable text plus metadata that lets a hit
 * be traced back to its file or entity. The lexical layer is exact and
 * LLM-free; a semantic layer can be added later behind the same shapes without
 * replacing it (see docs/SEARCH.md).
 */

/** The kind of thing a result points at — an entity kind or a file area. */
export type ResultKind =
  | "prose"
  | "character"
  | "location"
  | "object"
  | "scene"
  | "plot_thread"
  | "fact"
  | "world_rule"
  | "event"
  | "relationship"
  | "story"
  | "world"
  | "plot"
  | "style"
  | "research"
  | "notes";

export interface SearchMeta {
  readonly kind: ResultKind;
  readonly title: string;
  /** Project-relative file path, when the document is file-backed. */
  readonly path?: string;
  /** Entity id, when the document represents an entity. */
  readonly entityId?: AnyId | string;
  /** Chapter/scene the document belongs to, when applicable. */
  readonly chapterId?: string;
  readonly sceneId?: string;
}

export interface SearchDocument {
  /** Stable, unique document id (e.g. `file:manuscript/CHAPTER_0001.md`). */
  readonly id: string;
  readonly text: string;
  readonly meta: SearchMeta;
}

export interface SearchFilters {
  /** Restrict results to these result kinds. */
  readonly kinds?: readonly ResultKind[];
}

export interface SearchQuery {
  readonly text: string;
  readonly filters?: SearchFilters;
  readonly limit?: number;
}

export interface SearchHit {
  readonly id: string;
  readonly score: number;
  readonly excerpt: string;
  readonly meta: SearchMeta;
}

/** Synchronous lexical index port. */
export interface SearchIndex {
  upsert(doc: SearchDocument): void;
  remove(id: string): void;
  clear(): void;
  size(): number;
  search(query: SearchQuery): SearchHit[];
}

/**
 * Future embedding-based retrieval. Defined now so the Context Compiler can
 * depend on the abstraction; an implementation is added later WITHOUT replacing
 * the deterministic lexical layer (docs/SEARCH.md).
 */
export interface SemanticSearchProvider {
  isAvailable(): boolean;
  search(query: string, filters?: SearchFilters, limit?: number): Promise<SearchHit[]>;
}
