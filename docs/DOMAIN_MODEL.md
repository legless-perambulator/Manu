# DOMAIN_MODEL

The fiction domain model is the authoritative representation of story data. UI components and model responses must never usurp it.

- **Package:** `@jellytind/domain`
- **Depends on:** `@jellytind/shared`
- **Status:** Identity foundation (IDs) **implemented and tested**. Phase-1 entity types (`Project`, `Chapter`, `Character`, `Location`, `PlotThread`) and the `ProjectManifest` are **implemented**; richer entities (Scene, Fact, Relationship, WorldRule, …) remain **PLANNED**.

## Implemented: stable entity IDs

The identity system is real code. Every ID is a branded `string` (nominal typing
via `Brand<T, B>` from `@jellytind/shared`), so distinct ID types are mutually
incompatible at compile time.

Intended API (current):

```ts
import {
  SequentialIdGenerator,
  formatEntityId,
  parseId,
  createStoryProjectId,
  isCharacterId,
  entityKindOf,
  ENTITY_KINDS,
  type CharacterId,
  type SceneId,
  type EntityId,
  type IdFor,
} from "@jellytind/domain";

const ids = new SequentialIdGenerator();
const c: CharacterId = ids.next("character"); // "CHAR_0001", typed
const s: SceneId = ids.next("scene"); // "SCENE_0001"
// const bad: SceneId = c;                            // compile error (branding)

formatEntityId("plot_thread", 8); // "THREAD_0008"
parseId("CHAR_0007"); // { kind:"character", sequence:7, ... }
createStoryProjectId(); // "PROJ_<uuid>" — never derived from a name
SequentialIdGenerator.fromExistingIds(existing); // resume allocation without collisions
```

Key guarantees (covered by tests in `packages/domain`):

- IDs depend only on kind + a monotonic sequence, **never on names**; renames
  never change IDs or break references.
- Generators can be seeded from a snapshot or reconstructed from existing IDs so
  allocation is stable across sessions and branches.
- Prefixes (`CHAR`, `SCENE`, `LOC`, `THREAD`, `FACT`, `OBJECT`, `EVENT`,
  `CHAPTER`, `PROJ`) are part of the on-disk contract.

## Implemented: Phase-1 entity types

`Project`, `Chapter`, `Character`, `Location`, `PlotThread` are defined in
`@jellytind/domain` with branded IDs and minimal metadata (title/name, order,
status, `filePath`, aliases). `PlotThread` uses the lifecycle statuses below;
`Chapter` uses `outline | drafting | drafted | revised | final`. The
`ProjectManifest` (schema version, id, title, timestamps, app format version) is
the `.writer/project.json` record (see [STORY_REPOSITORY.md](STORY_REPOSITORY.md)).

## Planned: further entity types

The following entities are specified but not yet implemented as TypeScript types;
each arrives with its vertical slice.

### Core entities

```
Project
Manuscript
Act
Chapter
Scene
Character
Location
Object
Faction
Event
Fact
Belief
Knowledge
Relationship
PlotThread
Clue
Foreshadowing
WorldRule
Timeline
StoryState
Revision
Branch
Test
Agent
Skill
Task
Simulation
ResearchItem
```

Not every project uses every entity. See **Progressive structure** below.

## Stable entity identities

Every meaningful story entity receives a permanent internal ID. **Never use mutable display names as primary identifiers.**

Examples: `CHAR_0001`, `SCENE_0042`, `LOC_0017`, `THREAD_0008`, `OBJECT_0021`, `FACT_0041`, `EVENT_0068`, `REL_0012`, `CLUE_0014`, `CHAPTER_0017`.

A character may change from _Marcus Vale_ to _Marcus Kane_ without breaking any reference. Relationships, dependencies, timelines and story graphs point to IDs.

- **Names are presentation. IDs are identity.**
- IDs are required for refactoring, dependency analysis, graph construction, continuity, state tracking, aliases, revisions, branches, and automated transformations.
- ID allocation is monotonic per entity type and stable across renames, moves and branches.

## Scenes as first-class objects

A scene is a structured entity, not an arbitrary range of text. The manuscript stays readable prose; the scene layer provides machine-readable structure so agents can reason about a novel's architecture rather than only its sentences.

```yaml
id: SCENE_0083
chapter: CHAPTER_0017
pov: CHAR_ELIAS
location: LOC_BLACKTHORN_LIBRARY
characters: [CHAR_ELIAS, CHAR_MARA]
purpose:
  - reveal_partial_truth_about_father
  - increase_suspicion_of_mara
  - plant_cellar_key
conflict: { external: low, interpersonal: high, internal: medium }
entry_state: { elias_trust_mara: 0.48 }
exit_state: { elias_trust_mara: 0.31 }
plot_threads:
  advances: [THREAD_FATHER_DISAPPEARANCE]
  introduces: [THREAD_CELLAR_KEY]
knowledge_changes:
  CHAR_ELIAS:
    learns: [FACT_FATHER_VISITED_MANOR_1997]
status: drafted
word_count: 2381
```

## Selected entity notes

- **Relationship** — a dynamic object, not a static label. Variables (trust, affection, fear, resentment, loyalty, dependency, suspicion, attraction, respect, power, knowledge_of_other) change with story events so progression can be inspected for whether it is _earned_. Use for analysis, not to mechanically dictate prose. See [STORY_STATE.md](STORY_STATE.md).
- **PlotThread** — has a lifecycle: `planned → introduced → active → escalating → dormant → resolved → abandoned`. Tracks appearances. Dormancy can be flagged but is not automatically "bad".
- **Foreshadowing** — setups and payoffs are _linked_ entities with visibility and reader-interpretation metadata; detect setup-without-payoff and payoff-without-setup. Supports multi-stage foreshadowing.
- **Object** — important objects are entities tracking ownership, location, condition, appearances, transfers, destruction and knowledge, enabling inventory-continuity checks.
- **WorldRule** — structured, queryable hard/soft rules (e.g. `RULE_MAGIC_001: resurrection impossible`) consulted during drafting, continuity, timeline, refactor and simulation.
- **Fact / Belief / Knowledge** — objective truth, per-character belief, and reader knowledge are **separate** representations and must never be conflated. See [STORY_STATE.md](STORY_STATE.md).
- **Clue** — mystery support: source, first appearance, discoverer, reader exposure, interpretations, true/false meaning, related suspects, dependencies, payoff.
- **Revision / Branch** — see [VERSIONING.md](VERSIONING.md).

## Progressive structure

Do not turn fiction into a spreadsheet. Structured data assists the writer and AI; it must not force every writer to quantify every emotion, relationship or scene.

Support a gradient:

- A writer may begin with only `Chapter 1.md`, `Chapter 2.md`, `Chapter 3.md`.
- The system can **propose** entities and metadata; the user confirms them.
- Advanced users can model stories deeply; casual users stay lightweight.

## Invariants

- Every entity has a stable ID unique within its type.
- References between entities are by ID, never by display name.
- Renames never change IDs and never break references.
- Objective truth, character belief, and reader knowledge are stored separately.
- Domain state is only mutated through the application's mutation layer (see [VERSIONING.md](VERSIONING.md)).
