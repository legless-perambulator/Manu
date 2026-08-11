/**
 * @jellytind/search — deterministic, LLM-free project retrieval.
 *
 * Prefers structured/lexical retrieval over asking a model to scan everything
 * (MASTER_BUILD.md §40). The lexical layer is implemented; a semantic layer is
 * defined as an abstraction to add later behind the same shapes.
 */
export type {
  ResultKind,
  SearchMeta,
  SearchDocument,
  SearchFilters,
  SearchQuery,
  SearchHit,
  SearchIndex,
  SemanticSearchProvider,
} from "./types";

export { tokenize, parseQuery } from "./tokenizer";
export type { ParsedQuery } from "./tokenizer";
export { LexicalIndex } from "./lexical-index";
export { UnavailableSemanticSearch } from "./semantic";
