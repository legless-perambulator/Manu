# STORY_STATE

Explicit, machine-readable story state so the LLM does not have to reconstruct every fact from prose on every task.

- **Package:** `@jellytind/story-state` (timeline + validation), persisted by `@jellytind/story-repository`
- **Depends on:** `@jellytind/domain`, `@jellytind/shared`
- **Status (Phase 10 — V1):** **Implemented and tested.** Five dimensions — character location, alive/dead status, object ownership, object location, canonical facts and simple character knowledge — reconstructable at any scene boundary, with manual editing, AI extraction and Context Compiler integration. Physical condition, emotional variables, relationship dynamics, beliefs, goals and reader knowledge are **PLANNED**.

## State is transitions, not a snapshot

State is **not** stored as "what is true now". It is a set of changes, each
anchored to the scene where it happens:

```
SCENE_0042
  CHAR_ELIAS   location        → LOC_BLACKTHORN
  CHAR_ELIAS   knowledge add   → FACT_VAULT_EXISTS  (told, certainty 0.8)
  OBJECT_KEY   owner           → CHAR_ELIAS
```

The state at any point is derived by replaying every transition up to that
point. That is what lets the system answer _where was Elias immediately before
Scene 42?_ rather than only _where is Elias?_ — and it means correcting one
transition corrects every later answer at once, because nothing is cached.

## The V1 dimensions

| Transition kind      | Subject   | Value                                          |
| -------------------- | --------- | ---------------------------------------------- |
| `character_location` | character | location                                       |
| `character_status`   | character | `active` / `inactive` / `deceased` / `unknown` |
| `object_owner`       | object    | character (or empty for unowned)               |
| `object_location`    | object    | location                                       |
| `fact_established`   | fact      | the fact — when it becomes true in the world   |
| `knowledge_gained`   | character | fact, with `certainty` and `howLearned`        |

Five dimensions, deliberately. Each one is objective enough to be recorded
without interpretation, which is what keeps the whole layer deterministic.
Emotional variables and relationship dynamics are exactly the dimensions that
are _not_, so they wait.

## Querying the timeline

```ts
timeline.characterStateAfterScene(CHAR_ELIAS, SCENE_0042);
timeline.characterStateBeforeScene(CHAR_ELIAS, SCENE_0042);
timeline.objectStateBeforeScene(OBJECT_REVOLVER, SCENE_0051);
timeline.characterKnowledgeBeforeScene(CHAR_MARA, SCENE_0037);
timeline.knows(CHAR_MARA, FACT_VAULT_EXISTS, { sceneId: SCENE_0037, position: "before" });
timeline.establishedFactsBeforeScene(SCENE_0042);
timeline.worldStateAt({ sceneId: SCENE_0042, position: "after" });
```

A character state carries location, status, derived inventory and knowledge, each
knowledge entry naming the scene where it was learned — so _does Mara know about
the vault?_ is answered with _yes, since SCENE_0041, witnessed, certainty 1.0_.

**Ordering** comes from `orderScenes` in `@jellytind/domain`: chapters by order,
then scenes in project order within each chapter. It lives in the domain because
the Context Compiler, the timeline and the Story Compiler must all agree on what
"the previous scene" means. Replay is deterministic — scene order, then
transition ID — so the same timeline always yields the same state. A transition
anchored to a scene that no longer exists is ignored rather than misapplied.

## Provenance and confirmation

Every transition records:

```
sceneId · kind · subjectId · value · certainty? · howLearned?
source (author | agent | import) · modelId? · confirmationStatus · note? · createdAt · confirmedAt?
```

`confirmationStatus` is the canon boundary:

- **`confirmed`** — canon. Only these contribute to reconstructed state.
- **`proposed`** — a model's suggestion. Persisted so it is visible and
  correctable, but **excluded from state**.
- **`rejected`** — considered and dismissed. Never contributes, even in preview.

A query may pass `{ include: "with_proposed" }` to preview what state _would_ look
like if the pending proposals were accepted. That is for review only; canon never
includes them (AGENTS.md — "Canon vs Inference").

## Validation

Two guards run before a transition is stored, and both run again on every
correction:

1. **Shape** (`validateTransition`) — the subject and value must be entity kinds
   the transition kind allows. `character_location` given an object subject, or a
   fact where a location belongs, is refused.
2. **Existence** — every ID a transition names must exist in the project.

Together these are what stop a model inventing state: a proposal referring to
`LOC_9999` cannot be stored at all.

## Manual editing

The desktop **State** tab reconstructs the world before or after any scene,
lists the transitions recorded at that scene with their source and confirmation
status, and lets the author record a new transition, correct an existing one,
confirm or reject a proposal, or delete a transition outright.

Every one of those is a change set: state edits are reversible and appear in
history like any other project mutation ([VERSIONING.md](VERSIONING.md)).

## AI state extraction

After a scene is written or edited, **Analyse state changes** is offered. The
model receives the scene _and the state that preceded it_ through the Context
Compiler, and proposes structured transitions with a confidence and the phrase
that supports each one:

```
Detected in SCENE_0042:
  Elias is at Blackthorn Manor        0.9  "Elias was already waiting."
  Elias learns the vault exists       0.6  "Mara told him what lay beneath."
  Mara takes possession of the key    0.8  "She pocketed the key."
[Confirm] [Edit] [Reject]
```

Proposals are validated, then stored as `proposed` — never as canon. Drafts that
fail validation are **shown with the reason** rather than silently dropped, so an
author can see what the model tried to claim. Extraction requires the
`edit_story_state` permission and runs as a persisted `AgentTask`, like every
other AI operation.

## Context Compiler integration

Compiled context gains a **`storyState`** section. Scene recipes include the
state of the POV and participating characters, the objects in the scene, and the
established facts — all reconstructed **at the scene's entry boundary**, with
provenance that names it:

```
CHAR_0001 state
included because: story state of CHAR_0001 immediately before SCENE_0042,
                  who is involved in SCENE_0042
```

Chapter inspection does the same at the chapter's first scene. Only confirmed
transitions are used: a model is never fed another model's unapproved guesses as
though they were canon.

This is the payoff. A drafting or rewriting operation now receives _who is where,
who is carrying what, and who knows what_ as compiled context — instead of a
model re-reading the manuscript to work it out.

## Truth, belief and knowledge

V1 separates two of the three representations:

1. **Objective story truth** — `fact_established` marks when a fact becomes true
   in the world.
2. **Character knowledge** — `knowledge_gained` records what a character believes,
   with certainty, how they learned it, and where.
3. **Reader knowledge** — what the manuscript has exposed to the reader at a
   given point. **PLANNED.**

Because knowledge is time-indexed and separate from truth, the Story Compiler can
later detect _Mara references the vault in Chapter 16 but does not learn of it
until Chapter 18_ deterministically.

## Planned

- Physical condition, injuries, disguises, resources, faction membership.
- Emotional variables and relationship dynamics tied to story events, so
  progression can be inspected for whether it is _earned_:
  ```
  ELIAS → MARA TRUST
  CH01 0.62  CH05 0.71  CH09 0.66  CH14 0.48  CH17 0.31  CH23 0.18
  ```
  For analysis, not to mechanically dictate creative writing.
- Reader knowledge, and beliefs that are false.
- Story-world chronology distinct from reader presentation order (flashbacks,
  nonlinear structure).
- Explainability: justifying a belief with the scene and phrase that produced it —
  the evidence is already stored on each transition's `note`.

## Invariants

- State is derived by replaying transitions, never stored as a snapshot.
- Every transition is anchored to a scene and carries its source and confirmation status.
- Only confirmed transitions are canon; proposals never contribute to state.
- Truth and character knowledge never share a field.
- A transition cannot name an entity that does not exist, or one of the wrong kind.
- State edits are reversible change sets.
- Compiled context reports state _at a named boundary_, never "latest".
