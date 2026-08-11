# SEARCH

Deterministic, LLM-free project retrieval — the reliable foundation the future
[Context Compiler](CONTEXT_COMPILER.md) builds on. Prefer structured/lexical
retrieval over asking a model to scan everything (MASTER_BUILD.md §40).

- **Packages:** `@jellytind/search` (lexical engine + abstractions),
  `@jellytind/story-repository` (project indexing + structured queries)
- **Status (Phase 4):** **Implemented and tested.** Full-text search across the
  project, structured graph queries, incremental index updates, and a global
  search UI. Semantic (embedding) search is defined as an abstraction, not yet
  implemented.

## Two retrieval layers

1. **Lexical full-text** — exact keyword/phrase search over all project text.
2. **Structured graph queries** — precise answers from entity links (which
   scenes contain a character, are set at a location, advance a thread, …).

Both are deterministic and answer many project questions with no LLM. A third
**semantic** layer is planned behind the same shapes.

## Lexical index (`@jellytind/search`)

`LexicalIndex` is a pure-TypeScript inverted index (no `node:*`), so it runs
identically in Node tests and the browser renderer.

- **Tokeniser:** Unicode-aware; lowercases and extracts letter/number runs, so
  punctuation and special characters never break search.
- **Query language:** bare terms are ANDed (`brass key` → both tokens present);
  quoted phrases match adjacent tokens (`"brass key"`).
- **Ranking:** term frequency, with a bonus for phrase matches; deterministic
  tie-break by id.
- **Excerpts:** a ~180-character window around the first match.
- **Incremental:** `upsert` / `remove` update a single document — small changes
  never force a full reindex.
- **Filters:** restrict results by `ResultKind` (result type).

Every hit carries `SearchMeta` — `kind`, `title`, and (where applicable) `path`,
`entityId`, `chapterId`, `sceneId` — so a result traces back to its file or
entity.

## Project indexing (`ProjectSearch`)

`ProjectSearch` (in `@jellytind/story-repository`) builds documents from the
authoritative project sources:

| Source                                                                  | Result kind                         |
| ----------------------------------------------------------------------- | ----------------------------------- |
| `manuscript/**.md` (chapter prose)                                      | `prose`                             |
| character / location / object files                                     | `character` / `location` / `object` |
| `story/`, `world/`, `plot/`, `style/`, `research/`, `notes/` text files | area kind                           |
| scenes / threads / facts / rules / events / relationships (collections) | entity kind                         |

It is **built lazily** on first search and updated **incrementally** on every
mutation — `writeProjectFile`, entity create/update, and delete each patch just
the affected document(s). It is always consistent with the files, and a reopen
rebuilds cleanly from source.

`repo.searchText({ text, filters?, limit? })` runs it; `repo.rebuildSearchIndex()`
forces a full rebuild.

## Structured queries

Exact answers computed from the entity graph (pure functions in `queries.ts`):

```ts
repo.getScenesByCharacter(id) / getScenesByPOV(id);
repo.getScenesByLocation(id) / getObjectAppearances(id);
repo.getScenesByPlotThread(id) / getPlotThreadAppearances(id);
repo.getScenesBetweenChapters(startChapterId, endChapterId);
repo.getCharacterAppearances(id); // → { scenes, events }
```

## Worked examples

| Question                                                   | Mechanism                             |
| ---------------------------------------------------------- | ------------------------------------- |
| "Find every scene containing Mara."                        | `getScenesByCharacter(CHAR_MARA)`     |
| "Find every scene set at Blackthorn Manor."                | `getScenesByLocation(LOC_…)`          |
| 'Find every mention of "brass key".'                       | `searchText({ text: '"brass key"' })` |
| "Find all scenes linked to the missing photograph thread." | `getScenesByPlotThread(THREAD_…)`     |

The first three work today with no LLM.

## Semantic search boundary

`SemanticSearchProvider` is defined now so retrieval consumers can be written
against it:

```ts
interface SemanticSearchProvider {
  isAvailable(): boolean;
  search(query: string, filters?: SearchFilters, limit?: number): Promise<SearchHit[]>;
}
```

`UnavailableSemanticSearch` is the current placeholder. An embedding-backed
implementation will return the same `SearchHit` shape and sit **alongside** the
lexical layer — the Context Compiler can blend both — without replacing
deterministic search.

## UI

The workbench's left panel has a **Search** tab: a query box, result-type filter
chips, and a results list showing result type, title, an excerpt, and location
(file path / chapter). Selecting a result opens the file or selects the entity
in the inspector.

## Invariants

- Search is deterministic and reproducible; no LLM in the lexical or structured
  layers.
- The index is derived from and always reconcilable with the authoritative files.
- Semantic retrieval is additive — it never replaces deterministic search.
