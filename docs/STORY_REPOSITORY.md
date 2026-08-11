# STORY_REPOSITORY

The Story Repository is the authoritative project source. Chat history, model memory, cached summaries and derived indexes are **not** authoritative. Every canonical fact must ultimately resolve back to the repository or to explicitly confirmed structured story state.

- **Packages:** `@jellytind/persistence` (storage boundary), `@jellytind/story-repository` (the service)
- **Depends on:** `@jellytind/domain`, `@jellytind/shared`
- **Status (Phase 1):** **Implemented and tested.** Create / open / validate / save projects on real disk; atomic writes; path-traversal prevention; stable entity IDs; a SQLite derived index with migrations; and a desktop create/open/edit flow with a project explorer.

The principle is fixed: **story information exists as structured project data, not trapped inside prompts or chat history.**

## The storage boundary

`@jellytind/persistence` defines the narrow interfaces every higher layer uses,
so the backend can vary without touching domain or application code.

```ts
interface ProjectStore {
  // the portable file store (source of truth)
  readFile(path): Promise<string | null>;
  writeFile(path, content): Promise<void>; // atomic (temp + rename)
  exists(path): Promise<boolean>;
  list(prefix?): Promise<string[]>;
  delete(path): Promise<void>;
  createDirectory(path): Promise<void>;
}
```

Implementations:

- **`InMemoryProjectStore`** — tests and the reference contract.
- **`NodeProjectStore`** (`@jellytind/persistence/node`) — real filesystem with
  atomic temp-file-then-rename writes and root confinement; used by tests and any
  Node host.
- **`TauriProjectStore`** (in the desktop app) — delegates to root-confined Rust
  commands in the host process; the renderer never touches the filesystem
  directly.

Path safety is layered: the pure `normalizeProjectPath` rejects absolute paths
and `..` traversal (browser-safe, no `node:*`); `NodeProjectStore` re-checks the
resolved absolute path; and the Rust commands independently confine every path
to the project root. `StateStore` / `RevisionStore` remain interfaces for later
slices.

## The Story Repository service

`@jellytind/story-repository`'s `StoryRepository` class is the authoritative
gateway to a project, built on `ProjectStore` and independent of any particular
backend. Public API (Phase 1):

```ts
StoryRepository.createProject({ store, title, rootPath?, index? })
StoryRepository.openProject({ store, rootPath?, index? })
StoryRepository.validateProject(store)                 // → { ok, manifest?, errors, code? }
repo.saveProjectMetadata({ title })
repo.listProjectFiles(prefix?) / readProjectFile / writeProjectFile
repo.createDirectory / fileExists
repo.addChapter / addCharacter / addLocation / addPlotThread
repo.listChapters / listCharacters / listLocations / listPlotThreads
```

Every file method validates its path (traversal is rejected) and writes go
through the store's atomic write. Entity creation allocates a stable ID, writes
the entity's content file (or, for plot threads, `plot/plot_threads.json`), and
records a catalog entry.

## Stable IDs & their persistence

Entity IDs come from `SequentialIdGenerator` (`@jellytind/domain`) and depend
only on kind + a monotonic counter — never on names. The counter snapshot is
persisted in `.writer/state/id-sequences.json`; on open it is reloaded (or
reconstructed from existing IDs), so IDs stay stable and never collide across
sessions.

## SQLite derived index

An optional `ProjectIndex` (`@jellytind/persistence`) mirrors entity metadata into
SQLite for fast querying. It is **derived and reconstructable** — never the
exclusive home of manuscript content. Schema is applied by a versioned migration
runner (`schema_migrations`, `project_metadata`, `entities`). The Node binding
uses the built-in `node:sqlite` (zero native deps); the browser/host binding is a
Tauri/rusqlite adapter (attached host-side).

## Project manifest (`.writer/project.json`)

The identity record of a project. Small and forward-compatible: readers tolerate
unknown extra fields, and `schemaVersion` drives migrations.

```jsonc
{
  "schemaVersion": 1, // Story Repository format; bumped when the on-disk format changes
  "id": "PROJ_…", // stable project id (never derived from the title)
  "title": "My Novel",
  "createdAt": "2026-…Z",
  "updatedAt": "2026-…Z",
  "appFormatVersion": "0.1.0", // app that last wrote the project (informational)
}
```

`schemaVersion` and `appFormatVersion` are distinct: the former gates migrations,
the latter is diagnostic. A manifest whose `schemaVersion` is **newer** than the
running app is rejected (`unsupported_schema`) rather than silently mishandled.
Migration functions keyed off `schemaVersion` are the forward path; none are
needed yet at v1.

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
