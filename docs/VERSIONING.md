# VERSIONING

Every AI mutation must be reversible, attributable and auditable. This document covers revisions, diffs, checkpoints, branches, transactional edits and the audit trail.

- **Package:** `@jellytind/story-repository` (change sets, history, checkpoints, diffs, revert, staging)
- **Status (Phase 5, extended in Phase 9):** **Implemented and tested.** Every significant mutation is captured as a reviewable, reversible **change set**; checkpoints snapshot the whole project; a line diff drives a diff viewer; single change sets and whole-checkpoint reverts work; and a staging transaction is ready for future AI operations. Branching remains **PLANNED**.

This is the safety layer that must exist **before** unrestricted AI editing: it is
difficult for any operation — human or agent — to irreversibly damage a project.

## The mutation layer

Every mutation flows through one chokepoint. `StoryRepository` wraps its file
store in a **`JournaledProjectStore`**: while a recording session is open it
captures the before/after content of every file write and delete. Each public
mutation (`writeProjectFile`, `saveProjectMetadata`, entity add/update/delete)
runs inside `recordChange(...)`, which opens a session, runs the operation, and
emits exactly one {@link ChangeSet}. History files (`.writer/revisions/`) are
never captured, so history never diffs itself.

If the operation throws mid-way, the session is **rolled back** (before-images
restored) and no change set is committed — an interrupted or failed write cannot
leave a partially-applied, unrecorded mess.

## Change sets

A `ChangeSet` records:

```
id · timestamp · actor (human | agent | system | import) · operation
taskId? · modelId? · ai? · summary · status (committed | reverted | failed)
filesChanged[]     — path + before/after content (before=null → created, after=null → deleted)
entitiesChanged[]  — { id, kind, change: created | updated | deleted }
revertsChangeSetId? — set when this change reverts another
```

`ai` is present when an AI proposed the change and a human approved it, carrying
the operation, target, instruction, context recipe and token count, model, task,
approval (`accepted` or `partially_accepted`) and how many hunks the reviewer
took. It lives on the change set rather than in a separate log so it can never
drift from the before/after it describes. See [AI_EDITING.md](AI_EDITING.md).

`filesChanged` captures **everything** — manuscript prose, entity files, and the
structured state files (manifest, catalog, id-sequences, collection JSON) — so
changes to entities, links, metadata and project state are all covered. A
compact `ChangeSetSummary` (no content) drives fast history listing;
`getChangeSet(id)` loads the full before/after. Stored under
`.writer/revisions/changes/` with an index at `.writer/revisions/log.json`.

## Diffs

`computeLineDiff(before, after)` is a dependency-free LCS line diff classifying
each line as **context / add / remove** (a modification is a remove + add); the
diff viewer renders additions, deletions and modifications per file with
`+`/`−` counts. Any change set — including a revert — is fully inspectable.

`buildHunks` groups a diff's changed lines into addressable hunks, and
`applyHunks(before, after, ids)` rebuilds the text that results from accepting
only some of them — accepting all returns `after` byte-for-byte, accepting none
returns `before`. This is what makes _partial_ acceptance of an AI edit possible:
a reviewer takes the two sentences that improved the scene and leaves the
paragraph that did not.

## Checkpoints

`createCheckpoint(label)` snapshots every project file (excluding history) as a
named, revertible point, e.g. _Draft 0_, _Before Act II Rewrite_, _Before Story
Refactor_, _Dialogue Pass_. A **Draft 0** checkpoint is created automatically at
project creation. Large AI operations will create them automatically in a later
phase. `revertToCheckpoint(id)` restores the project to that snapshot (delta —
only differing files change) and records the revert as a new change set.

## Revert

Two granularities, both **non-destructive** — history is append-only, so a revert
never deletes later change sets:

- **`revertChangeSet(id)`** re-applies the inverse of a single change (restore
  each file's `before`). The original is marked `reverted`; the revert is itself
  recorded as a new change set (`operation: "revert"`, `revertsChangeSetId`).
  Successive reverts are supported.
- **`revertToCheckpoint(id)`** returns the whole project to a snapshot.

After any revert the repository **reloads in-memory state** (manifest, the
ID-allocation counters, and the search index) so, for example, reverting an
entity's creation frees its ID for reuse and no dangling in-memory state remains.

## Staging transactions (for future AI operations)

`beginTransaction()` returns a `StagedTransaction` — the boundary future AI
workflows use to stay reversible:

1. **stage** writes/deletes (`tx.writeFile` / `tx.deleteFile`); staged reads are
   overlaid so the operation can build on its own pending changes,
2. **validate** (the caller runs whatever checks it needs),
3. **present** — `tx.preview()` returns the before/after of every staged file for
   a diff,
4. **commit** (applies everything as one recorded change set) **or `discard`**
   (touches nothing).

Nothing reaches disk until commit, so a rejected AI proposal leaves the project
untouched.

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
