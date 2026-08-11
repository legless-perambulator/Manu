import { NotImplementedError } from "@jellytind/shared";
import type { SearchFilters, SearchHit, SemanticSearchProvider } from "./types";

/**
 * Placeholder semantic provider. The abstraction exists now so retrieval
 * consumers (the future Context Compiler) can be written against it; an
 * embedding-backed implementation is added later WITHOUT changing the
 * deterministic lexical layer (docs/SEARCH.md).
 */
export class UnavailableSemanticSearch implements SemanticSearchProvider {
  isAvailable(): boolean {
    return false;
  }

  search(_query: string, _filters?: SearchFilters, _limit?: number): Promise<SearchHit[]> {
    return Promise.reject(new NotImplementedError("semantic search"));
  }
}
