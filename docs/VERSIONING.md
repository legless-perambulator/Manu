# VERSIONING

Every AI mutation must be reversible, attributable and auditable. This document covers revisions, diffs, checkpoints, branches, transactional edits and the audit trail.

- **Package:** `@jellytind/story-repository` (change sets, history, checkpoints, diffs, revert, staging)
- **Status (Phase 5, extended in Phase 9):** **Implemented and tested.** Every significant mutation is captured as a reviewable, reversible **change set**; checkpoints snapshot the whole project; a line diff drives a diff viewer; single change sets and whole-checkpoint reverts work; and a staging transaction is ready for future AI operations. **Phase 21 adds branching:** alternative versions of the whole project, isolated, comparable and conservatively mergeable.

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

## Story Refactor uses all of it

A refactor is the operation the versioning layer was built for: it takes a
**checkpoint**, prepares its edits in a **staged transaction**, validates them
against a shadow copy, and commits exactly **one change set** on approval — so
a structural change to a novel is one revertible entry, not eleven. Its audit
record lives under `.writer/refactors/` rather than in the journal, because the
change is the change set and recording the record of it would double every
entry. See [STORY_REFACTOR.md](STORY_REFACTOR.md).

## Branching: alternative versions

_"What if Marcus survives Chapter 28?"_ is not a question about a paragraph. It
is a question about the whole book — the manuscript, who knows what afterwards,
which threads pay off, which tests still hold. So a **branch is an alternative
state of the entire Story Repository**, not an alternative text file.

```
main
├── mara-confesses-early
├── marcus-survives
└── darker-ending
```

### The interface says "version"

A novelist trying a darker ending is doing something they already understand.
They should not have to learn version control to do it, so the interface says
**Current version**, **Alternative versions**, **Create version**, **Compare**.
The word _branch_ survives only in the stable ID (`BRANCH_0002`), where an
advanced user will recognise it.

### How isolation actually works

Every subsystem — manuscript, entities, story state, knowledge, relationships,
timeline, objects, plot threads, tests, dependencies — reads and writes through
one narrow interface, `ProjectStore`. So isolating the store isolates all of
them at once, and **no subsystem needs to know branches exist**.

`BranchedProjectStore` is a copy-on-write view: reads fall through to the
parent, writes land in the branch's own overlay under
`.writer/branches/<BRANCH_ID>/files/`, and deletes are recorded as tombstones
rather than touching the parent. A `StoryRepository` is always scoped to
exactly one branch and cannot see another.

That is what makes isolation total rather than a rule every subsystem has to
remember — and it is why isolation covers systems written long before branching
existed.

The branches directory is invisible from inside any branch. Main is the same
class with no overlay: it still hides that directory, so a shadow-copy
validation or a search index built on main never ingests an alternative
version's files.

### Main, and migration

Every project has a main branch. Projects created before branching existed have
no registry; they get one on first use, describing the state already on disk.
Opening an old project is a migration that changes nothing the writer can see.

The registry — the list of versions and which is current — lives at
`.writer/branches/branches.json` and is written through the **base** store, so
switching versions never forks the list of versions. It is on disk, not in
memory, which is why the active version survives a restart.

### Creating a version does not write the alternative

Creating `marcus-survives` copies nothing and changes nothing. The description
records what the writer intends; the prose is untouched until they do it. The
creative transformation is a separate act, performed after switching — by the
writer, or by an agent they ask.

### Switching

Switching re-opens the project against different files. Anything held only in
an editor buffer or a staged AI proposal belongs to the version it was written
on, so the writer is shown exactly what would be left behind and has to resolve
it first. **Nothing is silently discarded.**

### Comparison

| Half           | What it reports                                              |
| -------------- | ------------------------------------------------------------ |
| **Textual**    | Manuscript files that differ, with lines added and removed   |
| **Structural** | Records added, removed or changed — matched by **stable ID** |

Matching by ID is what makes a renamed character a modification rather than a
deletion plus an addition. The comparison also reports **what it inspected**, so
silence reads as "no difference" rather than "not looked at"
([STORY_COMPILER.md](STORY_COMPILER.md)).

**Story-intelligence comparison** — pacing, character arc, thematic effect,
which ending lands harder — is deliberately **not** implemented in this phase.
The architecture is in place: `BranchComparison` is where such a reading would
attach, and it would be labelled model judgement, never presented as a
measurement. A model telling a writer which ending is better, unprompted and
unevidenced, is exactly the kind of claim this product does not make.

### Merge is conservative, on purpose

**Fiction does not merge like code.** Two versions of a chapter that both
changed are not a three-way text merge problem; they are two different books,
and only the author knows which sentence should survive.

So a merge takes only what is unambiguous:

- a file the source changed and the target did not → **applied**
- a file both changed → **a conflict, reported, never guessed at**

Each side is asked about its **own** record of what it changed — a branch's
overlay is literally the list of files it has touched; main's is its change
history since the branch point. Comparing content instead would make "they both
edited this" indistinguishable from "only one of them did", which is precisely
the distinction a merge turns on.

Nothing is applied until the whole merge is planned, and the result is one
revertible change set.

### Deletion

Deleting a version destroys work with no undo, so it takes an explicit
confirmation that names what is lost. **Main cannot be deleted.** Neither can
the version currently being written on, nor one that other versions were taken
from.

### The build belongs to the branch

Story Compiler and Story Tests run against the active version, and their
diagnostics stay there. Build numbering is per-branch: two versions can each
hold their own `BUILD_0001`, in their own namespace, neither able to see the
other.

### Agent tools

```
list_branches      read_canon       what versions exist, and which is current
create_branch      create_branches  take a new one; changes nothing in the story
switch_branch      create_branches  work somewhere else
compare_branches   read_canon       what differs, prose and records
```

There is deliberately **no `delete_branch`**. A version is a body of work a
writer chose to keep, and there is no undo for removing it; that decision stays
behind a human confirmation ([AGENT_TOOLS.md](AGENT_TOOLS.md)).

### Invariants

- A branch is an alternative state of the whole repository, not a file.
- Every project has a main branch; main is never deleted.
- Every branch has a stable ID, never reused.
- No branch can read or write another branch's files.
- Creating a branch changes nothing in the story.
- Switching never silently discards unsaved work.
- Comparison matches records by stable ID and states what it inspected.
- A merge applies only unambiguous changes and reports the rest as conflicts.
- Builds, tests and diagnostics belong to the branch that produced them.
- The active version and the version list are on disk, and survive a restart.
- No agent tool deletes a version.
