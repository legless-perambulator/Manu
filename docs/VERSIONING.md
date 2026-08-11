# VERSIONING

Every AI mutation must be reversible, attributable and auditable. This document covers revisions, diffs, checkpoints, branches, transactional edits and the audit trail.

- **Package:** `@jellytind/persistence` (`RevisionStore`, `RevisionEntry`, `RevisionAuthor`)
- **Status:** The append-only `RevisionStore` **interface** exists. The mutation layer, diffs, checkpoints, undo/revert and branching are **PLANNED (V1)**; richer history follows.

Every revision entry already carries provenance — `author` (human or agent+model),
`summary`, and `affectedEntities` (by ID) — so the audit trail is attributable by
construction.

## Mutation layer

All meaningful mutations pass through the application's mutation layer. No LLM response directly overwrites substantial project content. Each mutation is attributable, inspectable, reversible, validated where applicable, and recorded in revision history.

## Diffs

Provide visual diffs for every change:

```diff
- He walked slowly toward the door.
+ Elias crossed the room but stopped short of the door.
```

Support: accept change · reject change · accept selected · reject selected · accept all · restore previous version.

## Checkpoints

Create checkpoints automatically before large operations, so any substantial AI operation has a safe state to return to. Checkpoints are the backbone of failure recovery (see [AGENT_RUNTIME.md](AGENT_RUNTIME.md)).

## Revision record

Each change retains:

```
timestamp · agent · model · task · affected entities
previous content · resulting content · user approval status
concise reason/summary · associated checkpoint
```

Do **not** expose hidden chain-of-thought. Expose useful action summaries and provenance.

Conceptual revision stages (as labels, not enforced order): Draft 0 · Structural Rewrite · Character Pass · Dialogue Pass · Prose Pass · Developmental Edit · Copy Edit · Final.

## Audit trail

Every AI-generated or AI-modified passage is traceable. Clicking a passage may reveal:

```
Created: 11 August 2026
Agent: Prose Editor        Model: [model]
Task: Remove exposition from argument.
Revision: v183 → v184
Reason: Dialogue explicitly stated resentment already established through action.
```

Maintain provenance for: AI generation, AI editing, human editing, imports, automated refactors, compiler auto-fixes, and agent operations. The writer must always be able to distinguish what the author wrote, what AI wrote, what AI changed, why it changed, and how to undo it.

## Branching

Support alternative versions of a story:

```
main
├── mara-confesses-early
├── elias-dies-ending
└── darker-act-three
```

Affected content can be rewritten on a branch without destroying the main manuscript. Support branch creation, comparison, deletion, merging where practical, branch-level simulations and branch-level Story Builds. Provide **semantic** comparison, e.g. _how does the darker ending affect Elias's arc, theme, pacing and unresolved threads compared with main?_

If a refactor is applied, prefer _Create Branch + Apply_ so the analysis and change are isolated (see [STORY_REFACTOR.md](STORY_REFACTOR.md)).

## Transactional AI edits

Large operations behave transactionally. For _"rewrite Chapter 12 and update affected state"_, the system **stages** manuscript edits, state changes, thread changes, knowledge changes, summaries and index updates; **validates**; and only **commits** on success. If validation fails, the previous safe state is preserved.

## Invariants

- No mutation bypasses the mutation layer.
- Every AI mutation is reversible and carries provenance.
- Checkpoints exist before every large operation.
- Staged edits commit atomically or not at all.
- Hidden chain-of-thought is never surfaced; action summaries and provenance are.
