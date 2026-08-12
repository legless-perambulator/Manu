# DOMAIN_MODEL

The fiction domain model is the authoritative representation of story data. UI components and model responses must never usurp it.

- **Package:** `@jellytind/domain`
- **Depends on:** `@jellytind/shared`
- **Status:** Identity foundation (IDs) **implemented and tested**. The foundational fiction-domain entities are **implemented** (Phase 3): `Project`, `Chapter`, `Scene`, `Character`, `Location`, `StoryObject`, `PlotThread`, `Fact`, `WorldRule`, `StoryEvent`, `Relationship`, plus the `ProjectManifest`. Belief and knowledge semantics are **implemented** (Phase 11): facts carry an
  objective truth value, scenes list the facts they reference, and per-character
  positions live in the story-state timeline. Story-world time is **implemented**
  (Phase 13): scenes and events carry an optional `StoryTime` at any precision,
  and `TemporalRelation`/`TemporalLink`/`TravelRule` give the chronology its
  vocabulary. Object continuity is **implemented** (Phase 14): object statuses
  and visibility are first-class, and nested locations answer containment
  questions in one place. Narrative promises are **implemented** (Phase 15): the
  `Setup` entity, thread interactions and subtlety are first-class. Character
  intent is **implemented** (Phase 18): `Character.goals` records what someone
  is trying to do, the counterpart of a scene's `purpose`, so the debugger can
  ask whether a decision serves it ([STORY_DEBUGGER.md](STORY_DEBUGGER.md)).
  Causality is **implemented** (Phase 19): the `Decision` entity and the
  `Dependency` vocabulary record why one part of a story exists because of
  another ([CAUSALITY.md](CAUSALITY.md)). Numeric relationship state remains
  **PLANNED**.

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
- Prefixes (`CHAR`, `SCENE`, `LOC`, `THREAD`, `FACT`, `OBJECT`, `EVENT`, `RULE`,
  `REL`, `CHAPTER`, `PROJ`) are part of the on-disk contract.

## Implemented: the fiction-domain graph (Phase 3)

`@jellytind/domain` defines the structured, first-class story entities; the
graph that links, persists and integrity-checks them lives in
`@jellytind/story-repository` (see [STORY_REPOSITORY.md](STORY_REPOSITORY.md)).
All cross-entity references are by **stable ID**.

| Entity         | Key fields                                                                          | References (by ID)                                                                      |
| -------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `Character`    | name, aliases, description, role, goals, notes, status                              | —                                                                                       |
| `Decision`     | description, characterId, sceneId?, reason?, notes?                                 | character, scene                                                                        |
| `Location`     | name, aliases, description, notes                                                   | `parentLocationId?` → location (nesting; containment-aware)                             |
| `StoryObject`  | name, aliases, description, status (`exists`/`lost`/`destroyed`/`hidden`/`unknown`) | —                                                                                       |
| `PlotThread`   | name, description, status                                                           | `introducedSceneId?`, `resolvedSceneId?`, `relatedSceneIds[]` → scene                   |
| `Fact`         | statement, status, objectiveTruth, source?, notes?                                  | —                                                                                       |
| `WorldRule`    | name, description, severity (`hard`/`soft`/`style`), scope                          | —                                                                                       |
| `StoryEvent`   | name, description, storyTime?, duration?                                            | `sceneId?`, `locationId?`, `characterIds[]`, `plotThreadIds[]?`                         |
| `Relationship` | type, status, description (all _starting_ values)                                   | `characterAId`, `characterBId` (required)                                               |
| `Scene`        | title, purpose[], status, storyTime?, duration?                                     | `chapterId?`, `pov?`, `locationId?`, `characterIds[]`, `plotThreadIds[]`, `objectIds[]` |
| `Chapter`      | title, order, status                                                                | —                                                                                       |

Status vocabularies are exported as constant arrays (`CHARACTER_STATUSES`,
`PLOT_THREAD_STATUSES`, `WORLD_RULE_SEVERITIES`, …) so the UI and validation stay
in sync. A `Fact` is a **proposition**, not a truth: `objectiveTruth` says
whether it holds in the fictional world, so a false statement is still a
first-class entity that characters can believe. Per-character position lives in
the story-state timeline, never on the fact — **belief and
per-character knowledge semantics are deliberately deferred** (a later phase).

**Renaming never changes identity:** display names live in the record; the ID is
fixed at creation and derives file paths, so a rename leaves every reference
intact.

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

- **Relationship** — a dynamic object, not a static label. The entity carries
  identity (which survives every change) and starting values; type, status, ten
  optional analytical dimensions and milestone events evolve through
  scene-anchored transitions, so any story moment can be reconstructed. Use for
  analysis, not to mechanically dictate prose. See [STORY_STATE.md](STORY_STATE.md).
- **PlotThread** — has a lifecycle: `planned → introduced → active → escalating → dormant → resolved → abandoned`, moved by scene-anchored transitions so any point in the book can be reconstructed. How a scene touches a thread is one of six interactions. Dormancy is measured, never graded. See [NARRATIVE_THREADS.md](NARRATIVE_THREADS.md).
- **Setup** — a promise the story makes and the moment it keeps it, recorded
  because nothing in the prose links the two scenes. Carries foreshadowing
  metadata including `trueMeaning`, which is author-only. See
  [NARRATIVE_THREADS.md](NARRATIVE_THREADS.md).
- **Foreshadowing** — setups and payoffs are _linked_ entities with visibility and reader-interpretation metadata; detect setup-without-payoff and payoff-without-setup. Supports multi-stage foreshadowing.
- **Object** — important objects are entities; ownership, holder, location,
  condition, status and visibility are **time-aware state** rather than fields on
  the entity, so an object can be traced through the whole story and physical
  contradictions found deterministically. Owner and holder are separate: a stolen
  revolver still belongs to its owner. See
  [OBJECTS_LOCATIONS.md](OBJECTS_LOCATIONS.md).
- **Location** — locations nest (`parentLocationId`), and containment is
  honoured everywhere: someone in the Hidden Vault is at Blackthorn Manor. A
  malformed tree is a continuity finding, not a crash. See
  [OBJECTS_LOCATIONS.md](OBJECTS_LOCATIONS.md).
- **StoryEvent** — a moment in the story world, not in the manuscript. It may be
  dramatised in a scene, happen off the page, or predate the book by decades, so
  `sceneId` is optional and story time is not tied to chapter order. See
  [TIMELINE.md](TIMELINE.md).
- **StoryTime / TemporalRelation** — where something sits in story-world time, at
  whatever precision the writer has: an instant, a date, a range, a position
  relative to another node, an ordinal marker, or explicitly unknown. Real
  calendar dates are never required — `before`/`after`/`during`/`overlaps`/
  `same_time` relations are a complete chronology on their own. See
  [TIMELINE.md](TIMELINE.md).
- **WorldRule** — structured, queryable hard/soft rules (e.g. `RULE_MAGIC_001: resurrection impossible`) consulted during drafting, continuity, timeline, refactor and simulation.
- **Fact / Belief / Knowledge** — objective truth (`Fact.objectiveTruth`),
  per-character belief (the knowledge graph in the story-state timeline) and
  reader knowledge are **separate** representations and must never be conflated.
  Implemented for the first two; reader knowledge is **PLANNED**. See
  [STORY_STATE.md](STORY_STATE.md).
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
