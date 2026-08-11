# STORY_STATE

Explicit, machine-readable story state so the LLM does not have to reconstruct every fact from prose on every task.

- **Packages (planned):** a `story-state` engine over `@jellytind/persistence` (`StateStore`) and `@jellytind/domain`.
- **Status:** **PLANNED (V2 — Story Intelligence).** No code yet; the `StateStore` interface it will build on exists today (see [STORY_REPOSITORY.md](STORY_REPOSITORY.md)).

## What state captures

State may include, per character/object/location: location, alive/dead status, physical condition, possessions, knowledge, beliefs, relationships, emotional variables, commitments, goals, secrets, disguises, injuries, resources, status, faction membership, unresolved actions.

```yaml
after_scene: SCENE_0042
characters:
  CHAR_ELIAS:
    location: LOC_BLACKTHORN_MANOR
    physical_state: { injured_left_hand: true }
    inventory: [OBJECT_BRASS_KEY, OBJECT_PHONE]
    knowledge:
      FACT_VAULT_EXISTS: { certainty: 1.0 }
      FACT_MARA_IS_SPYING: { certainty: 0.0 }
    emotional_state: { trust_mara: 0.32, fear: 0.71 }
  CHAR_MARA:
    location: LOC_LONDON
    knowledge:
      FACT_ELIAS_FOUND_VAULT: { certainty: 1.0 }
```

## Time-indexed reconstruction

State must be reconstructable **across story time**, not merely "latest". The system answers _what was true immediately before Scene 42?_, not only _what is true now_. State is anchored to scene boundaries (`entry_state` / `exit_state`) and derived by replaying transitions in story-chronological order.

Distinguish **story-world chronology** from **reader presentation order** (flashbacks, nonlinear structure). See [SIMULATIONS.md](SIMULATIONS.md) and the timeline model.

## Truth, belief, and knowledge — three separate representations

Never conflate these:

1. **Objective story truth** — what is actually true in the fictional world.
2. **Character knowledge / belief** — what each character believes, with: source, time learned, certainty, whether the belief is false, whether inferred vs directly witnessed, and who they believe _also_ knows it.
3. **Reader knowledge** — what the manuscript has actually exposed to the reader at a given point.

```
TRUTH → Who knows it? → How did they learn it? → When? → How certain? → Who do they believe also knows it?
```

This drives mysteries, thrillers, espionage, political fiction, fantasy intrigue, unreliable narrators and dramatic irony. It lets the Story Compiler detect e.g. _Mara references the vault in Chapter 16 but does not learn of it until Chapter 18._

## Relationship state

Relationships evolve and are tied to story events, so the system can inspect whether progression is _earned_:

```
ELIAS → MARA TRUST
CH01 0.62  CH05 0.71  CH09 0.66  CH14 0.48  CH17 0.31  CH23 0.18
```

Use for analysis, not to mechanically dictate creative writing.

## AI state extraction

After drafting or editing a scene, the system may **propose** state changes:

```
Elias: + learns FACT_VAULT_EXISTS; + receives OBJECT_BRASS_KEY; location → Blackthorn Manor
Mara:  trust(Elias) 0.61 → estimated 0.54
Plot:  THREAD_CELLAR_KEY introduced
[Confirm] [Edit] [Reject]
```

- Objective changes (inventory, location, a fact explicitly stated) are easier to confirm, and may be auto-confirmed under policy.
- Subjective/inferred changes (an emotional estimate) are labelled as inference and stay proposed until approved.
- **Do not silently convert speculative AI interpretation into canonical state.** See the canon-vs-inference rule in [AGENTS.md](../AGENTS.md) and semantic principles in [STORY_COMPILER.md](STORY_COMPILER.md).

## Explainability

The system should be able to justify a state belief:

```
System believes Mara knows about the vault.
Evidence — SCENE_0041: "Mara stared at the plans. The chamber beneath the west wing..."
State transition: FACT_VAULT_EXISTS added after SCENE_0041.
[Correct] [Inspect]
```

## Invariants

- State transitions are attributable to a scene/event and are reversible.
- Truth, belief and reader knowledge never share a field.
- Certainty and provenance (witnessed vs inferred) are stored on beliefs.
- Confirmed state is canonical; proposed state is not, until approved.
