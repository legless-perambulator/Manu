# STORY_STATE

Explicit, machine-readable story state so the LLM does not have to reconstruct every fact from prose on every task.

- **Package:** `@jellytind/story-state` (timeline + validation), persisted by `@jellytind/story-repository`
- **Depends on:** `@jellytind/domain`, `@jellytind/shared`
- **Status (Phase 10 V1, extended in Phase 11):** **Implemented and tested.** Character location, alive/dead status, object ownership and location, canonical facts, a full **knowledge and belief graph** — states, acquisition sources, false beliefs, transfer chains and deterministic violation checks — and **dynamic relationship state** with optional analytical dimensions, all reconstructable at any scene boundary, with manual editing, AI extraction and Context Compiler integration. Phase 13 adds the **story-world chronology** — see [TIMELINE.md](TIMELINE.md) — which supplies this same replay engine with a second scene order, and Phase 14 adds **object continuity and nested locations** — see [OBJECTS_LOCATIONS.md](OBJECTS_LOCATIONS.md). Physical condition, goals and reader knowledge are **PLANNED**.

**No future leakage** is a permanent regression fixture rather than a claim: one
story with a setup in chapter one and a reveal in chapter three, checked at the
earlier point across story state, knowledge, relationships, ordering, compiled
context, the reader simulator and the character simulator. Every "must not
contain" case is paired with a positive control at the later point, so a fixture
that silently recorded nothing cannot pass. The fixture is exported as
`leakageFixture` from `@jellytind/story-repository` so all three guards check the
same story (Phase 30.5B3).

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

| Transition kind          | Subject      | Value                                                                         |
| ------------------------ | ------------ | ----------------------------------------------------------------------------- |
| `character_location`     | character    | location                                                                      |
| `character_status`       | character    | `active` / `inactive` / `deceased` / `unknown`                                |
| `object_owner`           | object       | character (or empty for unowned)                                              |
| `object_location`        | object       | location                                                                      |
| `fact_established`       | fact         | the fact — when it becomes true in the world                                  |
| `knowledge_changed`      | character    | fact, with `knowledgeState`, `sourceType`, `sourceEntityId?` and `certainty?` |
| `relationship_type`      | relationship | the new type — rival, ally, mentor                                            |
| `relationship_status`    | relationship | the new free-form status — "strained", "estranged"                            |
| `relationship_dimension` | relationship | one `dimension` moving to a `level` and/or `magnitude`                        |
| `relationship_event`     | relationship | a milestone — betrayal, alliance, reconciliation                              |

Each dimension is objective enough to be recorded without interpretation, which
is what keeps the layer deterministic. Emotional variables and relationship
dynamics are exactly the dimensions that are _not_, so they wait.

### Format migration

`knowledge_gained` (pre-Phase-11) is read as `knowledge_changed` with state
`known`, and its `howLearned` as an acquisition source. Old projects keep working
without a rewrite, and migrate themselves as they are edited.

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

## Dynamic relationships

"Elias and Mara are allies" is not an answer. The question is what their
relationship **was at the point in the story being worked on** — so relationships
get the same treatment as location and knowledge.

### Identity survives change

The `Relationship` entity holds identity — `REL_0012` is Elias↔Mara for the whole
book — plus the _starting_ type, status and description. Everything that changes
lives in transitions. However often the pair go from allies to adversaries,
nothing keys off "the ally relationship"; it keys off the ID.

### Descriptive state comes first

`type`, `status` and `description` are the substance, and they are free text: a
writer who never touches a number has fully working relationships.

### Optional analytical dimensions

Ten are available — trust, affection, fear, resentment, loyalty, dependency,
suspicion, attraction, respect, power — and **every one is optional**. They exist
so a writer can ask whether a collapse of trust was earned, not to make anyone
quantify a friendship.

Each dimension change may carry a **qualitative level**
(`none · very_low · low · moderate · high · very_high`), a **0–1 magnitude**, or
both, plus the reason it moved:

```
SCENE_0042  REL_ELIAS_MARA
  trust:      0.48 → 0.31   moderate → low
  suspicion:  —    → 0.51   moderate
  reason: Mara lies about the vault.
```

Both forms are first class, and the system never invents the one it was not
given: `qualitativeOf(0.31)` describes a magnitude as `low`, but a recorded
`low` stays `low` — analysis knows only the band. **Numeric values are analytical
aids, not objective literary truth**, and the code says so where it is defined.

### Milestones

`first_meeting · alliance · betrayal · confession · reconciliation ·
falling_out · estrangement · rescue · debt_incurred · oath_sworn · oath_broken ·
rivalry_begins · kiss · breakup · death_of_one`

Deliberately not romance-shaped: a thriller's oaths and debts matter as much as a
romance's kisses.

### Queries

```ts
repo.getRelationshipBeforeScene(REL_0012, SCENE_0042);
repo.getRelationshipAfterScene(REL_0012, SCENE_0042);
repo.getRelationshipHistory(REL_0012);
repo.getRelationshipsForCharacter(CHAR_ELIAS, boundary);
repo.getRelationshipChangesInChapter(CHAPTER_0012);
```

A history entry reads as a movement, not a destination — `trust: high (0.72) →
low (0.31)` — because the running value is threaded through the replay.

### The timeline view

The desktop **Relations** tab shows the arc grouped by chapter, the way a writer
reads their own book:

```
ELIAS → MARA
  Openings      SCENE_0001  first meeting
                SCENE_0001  trust — → moderate (0.48)
  The Rift      SCENE_0012  trust  high (0.72) → low (0.31)
                            Mara lies about the vault.
                SCENE_0012  status close → suspicious
  Aftermath     SCENE_0023  type   → enemies
```

Plain on purpose: correct time-aware data matters more than visual polish here.

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

### Selected knowledge, not every fact

Scene context also carries the information picture — and only the part that
matters. Three things are selected, each because an operation would be wrong
without it:

- **false beliefs** held by anyone in the scene, stated plainly as false, so a
  model does not quietly "correct" a character who is meant to be wrong;
- **information asymmetries** among the people present;
- **the facts the scene itself references** (`Scene.factIds`), with everyone's
  position on each.

Everything else is left out. Dumping every fact for every character would defeat
the purpose of having a compiler.

### Relationships at the right moment

Scene context includes the relationships between characters **who are both in the
scene**, reconstructed at the scene's **entry boundary**.

The boundary is the point. Drafting Chapter 3 must never receive Chapter 20's
fractured version of a friendship that is currently warm — that would quietly
write the ending into the beginning. A test asserts exactly this: a relationship
that turns hostile later does not appear in an earlier scene's context.

This is the payoff. A drafting or rewriting operation now receives _who is where,
who is carrying what, and who knows what_ as compiled context — instead of a
model re-reading the manuscript to work it out.

## Truth, belief and knowledge

Three representations that never collapse into one:

```
FACT_VAULT_CONTENTS  objectiveTruth: false   ← the world
MARA   known      FACT_VAULT_EXISTS   witnessed SCENE_0041      ← what she knows
ELIAS  believed   FACT_VAULT_PAPERS   told by Mara SCENE_0042   ← what he believes
```

1. **Objective story truth** — a `Fact` is a _proposition_, and
   `objectiveTruth` says whether it holds in the fictional world.
   `fact_established` says when a true one becomes true. A false proposition is
   still a first-class entity, because characters can believe it.
2. **Character knowledge and belief** — `knowledge_changed` records what a
   character holds, how they came by it, from whom, and how firmly.
3. **Reader knowledge** — what the manuscript has exposed to the reader at a
   given point. **PLANNED.**

**A belief never mutates a fact.** `FACT_KILLER_IS_MARCUS` with
`objectiveTruth: false` is what a false belief points at; the character's
position is recorded against it, and the world's verdict stays where it belongs.

### Knowledge states

| State         | Meaning                                                               |
| ------------- | --------------------------------------------------------------------- |
| `unknown`     | No position. The absence of a record, not a record of absence.        |
| `suspected`   | Entertains it without accepting it.                                   |
| `believed`    | Accepts it, but could be wrong.                                       |
| `known`       | Has it first-hand or beyond doubt.                                    |
| `disbelieved` | Actively rejects it — which is _not_ the same as never having met it. |

`believed` and `known` are the states in which a character acts on the
proposition (`holdsAsTrue`). Everything downstream — false beliefs, asymmetries,
violation checks — is built on that distinction rather than on the exact state.

**Certainty is optional analytical metadata**, not objective psychology. It
records how firmly the author wants a position held; nothing depends on its exact
value.

### How information was acquired

`witnessed · told · read · inferred · remembered · assumed · deceived · unknown`

When another party is the source, `sourceEntityId` names them — which is what
makes transfer traceable without a separate transfer record:

```
Mara tells Elias about the vault in SCENE_0042
  → knowledge_changed  ELIAS  FACT_VAULT  believed  told  by CHAR_MARA
```

### The reconstructed record

Queries return a `KnowledgeRecord`, derived rather than stored:

```
id · characterId · factId · state · certainty? · sourceType · sourceEntityId?
acquiredAtSceneId? · lostAtSceneId? · notes?
```

`acquiredAtSceneId` survives later refinements — a suspicion in Chapter 3 that
hardens into knowledge in Chapter 9 still answers _when did Elias first learn
about the vault?_ with Chapter 3.

## Knowledge queries

```ts
timeline.characterKnowledgeBeforeScene(CHAR_MARA, SCENE_0042);
timeline.characterKnowledgeAfterScene(CHAR_MARA, SCENE_0042);
timeline.doesCharacterKnowFactAtScene(CHAR_MARA, FACT_VAULT, boundary);
timeline.charactersWhoKnowFactAtScene(FACT_KILLER, boundary);
timeline.knowledgeHistory(CHAR_ELIAS, FACT_VAULT); // one character, one fact
timeline.factKnowledgeTimeline(FACT_VAULT); // one fact, everyone
timeline.traceAcquisition(CHAR_ELIAS, FACT_VAULT, boundary); // the chain back
```

`traceAcquisition` follows a position back through whoever passed it on, stopping
at a first-hand source, an unknown one, or a cycle:

```
Elias — believed — told by Mara, SCENE_0042
Mara  — known    — witnessed,    SCENE_0041
```

## The knowledge graph

`factKnowledgeGraph(timeline, fact, boundary)` gives everyone's position on one
proposition at one moment — built on the timeline, never stored:

```
FACT_VAULT_EXISTS  (true in the world)
  ├── Mara   — known     — witnessed SCENE_0041
  ├── Elias  — believed  — told by Mara, SCENE_0042
  └── Marcus — unknown
```

`falseBeliefsAt` reports both directions of contradiction: holding a false
proposition as true, and rejecting a true one.
`informationAsymmetriesAt` reports where the characters _in a scene_ do not share
what they hold — the dramatic-irony signal, restricted to the cast because
asymmetry between people who are not present is bookkeeping, not tension.

## Knowledge violations

`checkKnowledgeViolations` is a reusable, deterministic check API — the
foundation the Story Compiler builds on, deliberately not wired to a UI beyond a
plain list.

| Kind                                         | Severity | What it catches                                                            |
| -------------------------------------------- | -------- | -------------------------------------------------------------------------- |
| `told_without_knowing`                       | error    | Someone passed on in good faith what they did not hold.                    |
| `knowledge_before_fact`                      | error    | A character holds a true fact before the story establishes it.             |
| `contradictory_transitions`                  | error    | One scene records two different positions for the same character and fact. |
| `referenced_without_knowledge`               | warning  | A scene puts a fact on the page nobody in it holds.                        |
| `source_not_present` / `learner_not_present` | warning  | A transfer names someone who is not in the scene.                          |

**Deception is exempt from `told_without_knowing`.** A liar conveying something
they know to be false is the whole point of deception; flagging it would make the
system unable to represent the genre it exists for. `told` requires the source to
hold it; `deceived` does not; `read` names a document rather than a mind.

`referenced_without_knowledge` asks the POV character where a scene has one,
because a fact on the page of a scene told from inside someone's head is a fact
that person is expected to hold. Where there is no POV — the ordinary case, since
`pov` is optional — it asks whether _anybody present_ holds it, and names who was
checked. Before Phase 30.5B3 it asked only about the POV, which made it
unreachable for most scenes and was the one planted defect the audit's compiler
probe missed (MANU-034). A scene with no characters at all is expository or
off-page narration and is still not reported.

It is a _warning_ on purpose — a scene referencing a
fact nobody in it holds is often dramatic irony rather than a mistake, so it
is reported without being called wrong.

Because knowledge is time-indexed and separate from truth, this detects _Mara
references the vault in Chapter 16 but does not learn of it until Chapter 18_
with no model involved.

## Planned

- Physical condition, injuries, disguises, resources, faction membership.
- Beliefs about _other characters'_ beliefs — who Elias thinks knows what.
- Emotional variables and relationship dynamics tied to story events, so
  progression can be inspected for whether it is _earned_:
  ```
  ELIAS → MARA TRUST
  CH01 0.62  CH05 0.71  CH09 0.66  CH14 0.48  CH17 0.31  CH23 0.18
  ```
  For analysis, not to mechanically dictate creative writing.
- Reader knowledge — what the manuscript has exposed, as distinct from what
  characters hold.
- Explainability: justifying a belief with the scene and phrase that produced it —
  the evidence is already stored on each transition's `note`.

## Two scene orders

Transitions are anchored to scenes, and a scene order turns them into state. The
manuscript's order is one such order; the story world's chronology is another,
and in a nonlinear story they disagree.

```ts
new StoryTimeline(orderScenes(scenes, chapters), transitions); // the reader's sequence
chronology.stateTimeline(transitions); // the world's sequence
```

Same replay machinery, two questions: _what had the reader been told by chapter
12?_ and _what was true in the world at that moment?_ A flashback makes those
different answers. See [TIMELINE.md](TIMELINE.md).

## Invariants

- State is derived by replaying transitions, never stored as a snapshot.
- Every transition is anchored to a scene and carries its source and confirmation status.
- Only confirmed transitions are canon; proposals never contribute to state.
- Truth, character knowledge and belief never share a field.
- A belief never mutates the fact it points at.
- Relationship identity survives every change of type and status.
- Relationship dimensions are optional; no writer is forced to quantify.
- Compiled context never shows a scene a later scene's relationship state.
- Deception is representable: a source need not hold what they convey.
- A transition cannot name an entity that does not exist, or one of the wrong kind.
- State edits are reversible change sets.
- Compiled context reports state _at a named boundary_, never "latest".
