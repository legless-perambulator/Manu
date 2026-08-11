# STORY_REPOSITORY

The Story Repository is the authoritative project source. Chat history, model memory, cached summaries and derived indexes are **not** authoritative. Every canonical fact must ultimately resolve back to the repository or to explicitly confirmed structured story state.

- **Packages:** `@jellytind/persistence` (storage interfaces), `@jellytind/story-repository` (typed project view)
- **Depends on:** `@jellytind/domain`, `@jellytind/shared`
- **Status:** Storage **interfaces + in-memory implementations** exist and are tested; the native filesystem + SQLite adapters and the typed repository are **PLANNED** (V1).

The layout below is the target contract; exact filenames may evolve, but the principle is fixed: **story information exists as structured project data, not trapped inside prompts or chat history.**

## Implemented: the storage boundary

`@jellytind/persistence` defines the narrow interfaces every higher layer uses,
so the backend can vary (native FS via Tauri, in-memory for tests, future sync)
without touching domain or application code.

```ts
interface ProjectStore {
  // the portable file store (source of truth)
  readFile(path): Promise<string | null>;
  writeFile(path, content): Promise<void>;
  exists(path): Promise<boolean>;
  list(prefix?): Promise<string[]>;
  delete(path): Promise<void>;
}
interface StateStore {
  // derived, SQLite-backed later; reconstructable
  get<T>(key): Promise<T | null>;
  set<T>(key, value): Promise<void>;
  delete(key): Promise<void>;
  keys(prefix?): Promise<string[]>;
}
interface RevisionStore {
  // append-only history (see VERSIONING.md)
  append(entry): Promise<void>;
  get(id): Promise<RevisionEntry | null>;
  list(options?): Promise<RevisionEntry[]>;
}
```

`InMemoryProjectStore` and `InMemoryStateStore` ship now as the reference
implementations and test doubles; native adapters implement the same contracts.
`@jellytind/story-repository` will sit above `ProjectStore`, parsing files into
typed domain entities and mediating mutations through the versioning layer.

## Principles

- **Portable.** The writer's creative work must never depend on a proprietary cloud-only format.
- **Human-readable where it matters.** Markdown for prose, YAML/JSON for structured data.
- **Local-first.** A local structured database (SQLite) is used for indexing, relationships, query performance and derived state — but the manuscript itself remains plain files.
- **Derived ≠ canonical.** Anything under `.writer/index/` or SQLite is regeneratable from source and never overrides source canon.

## Conceptual project structure

```
MY_NOVEL/
├── manuscript/
│   ├── act_1/
│   │   ├── chapter_001.md
│   │   ├── chapter_002.md
│   │   └── chapter_003.md
│   ├── act_2/
│   └── act_3/
├── scenes/
│   ├── SCENE_0001.yaml
│   └── ...
├── story/
│   ├── premise.md
│   ├── synopsis.md
│   ├── themes.md
│   ├── promises.md
│   └── story_rules.md
├── characters/
│   ├── CHAR_ELIAS/
│   │   ├── profile.md
│   │   ├── voice.md
│   │   ├── arc.md
│   │   ├── relationships.md
│   │   └── state.json
│   └── ...
├── world/
│   ├── locations/  factions/  cultures/  history/
│   ├── systems/    glossary/   objects/
├── plot/
│   ├── master_outline.md
│   ├── timelines.json
│   ├── plot_threads.json
│   ├── mysteries.json
│   ├── clues.json
│   ├── foreshadowing.json
│   └── causality.json
├── style/
│   ├── prose.md  dialogue.md  pacing.md
│   ├── banned_tendencies.md
│   ├── author_profile.json
│   └── examples/
├── research/
├── references/
├── notes/
└── .writer/
    ├── project.json
    ├── state/        index/       revisions/
    ├── branches/     agents/      skills/
    ├── commands/     tests/       simulations/
    └── memory/
```

## Division of responsibility

| Data                             | Home                                      | Authoritative? |
| -------------------------------- | ----------------------------------------- | -------------- |
| Prose                            | `manuscript/**.md`                        | Yes            |
| Scene structure                  | `scenes/*.yaml`                           | Yes            |
| Canon story facts, world rules   | `story/`, `world/`, `plot/`               | Yes            |
| Confirmed story state            | `.writer/state/`                          | Yes            |
| Revisions, branches, checkpoints | `.writer/revisions/`, `.writer/branches/` | Yes (history)  |
| Full-text / vector index         | `.writer/index/` + SQLite                 | No (derived)   |
| Summaries                        | derived store                             | No (derived)   |
| Agents, skills, commands         | `.writer/`                                | Config         |

## Manuscript vs metadata

Export must preserve the writer's actual manuscript independently from internal AI metadata. A reader should never need `.writer/` to read the book. See [VERSIONING.md](VERSIONING.md) for how history is stored without polluting the prose.

## SQLite usage

Use a local structured database where indexing, relationships, query performance or derived state make it useful — entity indexes, cross-references, full-text search, repetition statistics, graph edges, embeddings. Everything in SQLite must be reconstructable from the portable files, so a project remains valid if the database is deleted.

## Portability guarantee

At any time the user can zip the project directory and open it elsewhere. No feature may introduce a hard dependency on remote storage for the core manuscript and story data. Cloud sync, if implemented, is optional infrastructure layered on top. See [SECURITY_PRIVACY.md](SECURITY_PRIVACY.md).
