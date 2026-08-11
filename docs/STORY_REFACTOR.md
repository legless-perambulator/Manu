# STORY_REFACTOR

The fiction equivalent of refactoring software: change a structural element and understand the blast radius **before** touching the manuscript.

## Status

Documentation stage (Story Refactor V1 targeted for V2). Depends on the [Domain Model](DOMAIN_MODEL.md), [Story State](STORY_STATE.md), the causality graph, and [Versioning](VERSIONING.md) branches.

## Principle

For a request like *"Make Mara the detective instead of Elias,"* the system analyses dependencies **first**, reports the affected elements, and only then applies changes — ideally on a branch.

```
PROPOSED STORY REFACTOR
Change: Mara becomes primary investigator.

Affected:
  18 scenes · 4 character arcs · 7 plot threads
  3 relationship trajectories · 11 knowledge transitions
  2 clues · 1 ending dependency

High-risk dependencies:
  SCENE_0048 · SCENE_0061 · THREAD_INHERITANCE · FACT_VAULT_DISCOVERY

[Inspect Plan]  [Create Branch + Apply]  [Cancel]
```

## Dependency / causality analysis

Refactor relies on the **Causality Graph**: scenes and events declare dependencies, so changing or deleting one reveals what breaks.

```
Elias discovers letter → Confronts father → Father lies → Elias contacts Mara
→ Mara investigates vault → Marcus learns investigation continues → Marcus destroys evidence
```

Deleting or significantly changing a scene surfaces its dependents and explains *why*:

```
Removing SCENE_0042 may break causal dependencies for: SCENE_0051, SCENE_0053, SCENE_0061
```

This is the fiction equivalent of dependency analysis.

## Supported refactors

change a relationship · change a character's profession · move an event earlier · remove a character · merge two characters · change the murderer · change POV character · alter a world rule · change a location · change the ending · convert first-person ↔ third-person · change story chronology.

## Workflow

```
analyse dependencies (blast radius) → present affected elements & high-risk dependencies
→ user chooses: inspect plan / create branch + apply / cancel
→ apply on a branch via the mutation layer → show diffs → run Story Build → report
```

Applying a refactor is a **transactional** operation (see [VERSIONING.md](VERSIONING.md)): staged, validated, committed on success, otherwise rolled back. It should not casually rewrite architecture; it presents consequences and lets the author decide.

## Invariants

- Blast-radius analysis precedes any manuscript change.
- References are resolved by stable ID, which is what makes refactors tractable (see [DOMAIN_MODEL.md](DOMAIN_MODEL.md)).
- Prefer applying on a branch; always show diffs and run a Story Build afterward.
