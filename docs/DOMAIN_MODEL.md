# DOMAIN_MODEL

The fiction domain model is the authoritative representation of story data. UI components and model responses must never usurp it.

## Status

Documentation stage. Entity list and identity rules are settled; concrete TypeScript types are defined per vertical slice as each entity is implemented.

## Core entities

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

A character may change from *Marcus Vale* to *Marcus Kane* without breaking any reference. Relationships, dependencies, timelines and story graphs point to IDs.

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
exit_state:  { elias_trust_mara: 0.31 }
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

- **Relationship** — a dynamic object, not a static label. Variables (trust, affection, fear, resentment, loyalty, dependency, suspicion, attraction, respect, power, knowledge_of_other) change with story events so progression can be inspected for whether it is *earned*. Use for analysis, not to mechanically dictate prose. See [STORY_STATE.md](STORY_STATE.md).
- **PlotThread** — has a lifecycle: `planned → introduced → active → escalating → dormant → resolved → abandoned`. Tracks appearances. Dormancy can be flagged but is not automatically "bad".
- **Foreshadowing** — setups and payoffs are *linked* entities with visibility and reader-interpretation metadata; detect setup-without-payoff and payoff-without-setup. Supports multi-stage foreshadowing.
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
