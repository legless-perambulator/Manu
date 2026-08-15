# STORY_REFACTOR

The fiction equivalent of refactoring software: change a structural element and
understand the blast radius **before** touching the manuscript.

- **Package:** `@jellytind/story-refactor`
- **Depends on:** `@jellytind/story-repository`, `@jellytind/story-causality`,
  `@jellytind/story-compiler`, `@jellytind/context-compiler`,
  `@jellytind/model-router`, `@jellytind/agent-runtime`
- **Status (Phase 20):** **V1 implemented and tested.** Four bounded refactor
  classes, deterministic analysis and planning, model-assisted consequences and
  sentence rewrites, checkpoint + staged transaction, validation against a
  shadow copy, a dedicated Refactor workspace, a full audit trail and an
  analysis-only agent tool. Arbitrary refactors are **PLANNED**.

## The premise

_"Make Marcus Elias's childhood friend instead of his brother."_

That is a change to a story's **architecture**, not to a paragraph. It reaches
a character record, a relationship, the facts and threads that rested on the
sibling bond, every scene that says the word, the knowledge those scenes moved,
and a story test the writer wrote a year ago. Done by hand, the last consequence
surfaces six months later in a copy-edit.

**The acceptance test is the whole scenario**: open a populated mystery where
Marcus is Elias's brother, ask for the change, and get the affected entities,
the dependency risks, a transformation plan, staged edits, diffs, a Story Build,
a Story Test run, and — only after approval — one revertible change set, with
every stable ID untouched and the project still valid on reopening.

## The order of operations

```
analyse → plan → checkpoint → stage → validate → present → commit or discard
```

Everything before `commit` is reversible by doing nothing. That is not a
convention; it is enforced by where the work happens.

### Validation runs against a shadow copy

The build and the story tests run on an **in-memory copy of the project with
the staged writes applied**, opened as a second repository. Nothing on disk
moves.

This is what lets "commit only after approval" be literally true rather than
"commit, validate, revert if it went badly". A writer shown diagnostics for a
change that has already happened is being shown a fait accompli.

## Bounded classes, not arbitrary change

Four, deliberately:

| Class                        | Changes                                                    |
| ---------------------------- | ---------------------------------------------------------- |
| `rename_entity`              | display name, prose occurrences; old name kept as an alias |
| `change_relationship`        | type, status, description, and the words the prose uses    |
| `change_character_attribute` | role / description / goals, and the word the prose uses    |
| `move_story_event`           | which chapter a scene belongs to                           |

**The stable ID never changes.** A refactor may change everything about a
character except which character they are — that is what makes every reference
survive the operation ([DOMAIN_MODEL.md](DOMAIN_MODEL.md)).

## Analysis is found, not guessed

Dependency discovery runs through the structured systems and manuscript
discovery through the search index. A model is **never asked what is affected**,
because the project already knows and a model would be wrong more expensively.

| Question                        | Answered by                           |
| ------------------------------- | ------------------------------------- |
| What points at this?            | the entity graph's `findReferences`   |
| What depends on it?             | the causality graph's blast radius    |
| What state does it move?        | story-state transitions               |
| What scenes is it in?           | scene records                         |
| What are those scenes carrying? | their threads, facts, objects, setups |
| What does the prose say?        | the chapter files, whole-word matched |
| What has the writer asserted?   | the story tests                       |

### The hop that matters

A relationship does not point at a plot thread, and a thread does not point at
a relationship. They meet **in the scenes both appear in**. Without that extra
hop, changing what two characters are to each other would report no threads at
all — which is exactly the consequence a writer needs to be warned about. So
the analysis expands from the scenes a target appears in to what those scenes
carry.

### Risks carry their source

```
[RECORDED]        2 plot thread(s) rest on what is changing.
[RECORDED]        manuscript/CHAPTER_0004.md uses "brother" 3 times.
[MODEL JUDGEMENT] The inheritance motive rests on them being brothers.
```

A risk the structured systems found is a fact about the project. A risk a model
raised is a reading. A writer weighing whether to go ahead has to know which
they are looking at ([STORY_COMPILER.md](STORY_COMPILER.md)).

## The plan

Ordered steps, every one naming stable IDs:

- `update_entity` — a structured field change
- `replace_text` — a deterministic, whole-word term substitution, with every
  occurrence located and its before/after shown
- `rewrite_passage` — a sentence the model rewrote
- `move_scene`
- `manual` — **something the refactor will not do for you**

`manual` earns its place. _Elias's mother refers to Marcus as her son_ is not a
word swap, and a refactor that quietly left it would be worse than one that
says so out loud.

### The model's two jobs

Consequences the structured systems cannot see, and sentence rewrites where a
word substitution alone would leave the prose ungrammatical. It is given the
analysis and Context-Compiled context for the most affected scene — never the
whole project ([CONTEXT_COMPILER.md](CONTEXT_COMPILER.md)).

**Rewrites must be quoted verbatim.** The model returns the original sentence
character-for-character plus its replacement; anything that does not appear
exactly once in the file is **rejected with the reason** and never staged. A
model that cannot quote the sentence it wants to change does not get to change
it, which is what keeps a refactor from rewriting a chapter nobody asked it to
touch.

If the model call fails, the deterministic plan still stands and says so. A
refactor must not become impossible because a provider was unavailable.

### Specific before general

Sentence rewrites are applied **before** blanket substitutions. Both act on the
same prose, and a rewrite quotes the file as it stands now — run the
substitution first and every quotation stops matching, so the careful edit is
silently dropped in favour of the crude one.

## Validation failure

```
REFACTOR VALIDATION FAILED

New errors: 1

SCENE_0051:
  ERROR Elias references information no longer acquired.

Story tests: 21 / 22 passed (was 22 / 22)
  TEST_0012: newly failing.

Staged files: 4
Checkpoint taken: CHECKPOINT_0002
Nothing has been applied. Approve to commit, or discard to walk away.
```

Diagnostics are compared **by fingerprint**, so a reworded message is not a new
problem and a genuinely new one is never hidden behind an old one.

Committing anyway is allowed. A writer may accept a refactor that introduces
warnings, or errors they intend to fix next; what the system owes them is that
they saw the errors first, before anything moved.

## Audit trail

Every run persists under `.writer/refactors/`: the request as asked, the
analysis, the plan, which models had a hand in it, the staged edits, diagnostics
and test results before and after, what it introduced, the checkpoint, the
approval and the resulting change set. A structural change to a novel that
cannot be accounted for afterwards is a change a writer cannot trust
([VERSIONING.md](VERSIONING.md)).

The record is written straight to the store rather than through the journal: the
_change_ is a change set, and recording the record of it as a second one would
double every entry in the history.

## Undo, at three depths

1. **Discard** before committing — the project was never touched.
2. **Revert the change set** — one entry in the history, non-destructive.
3. **Revert to the checkpoint** taken before staging.

## The Refactor workspace

A dedicated panel rather than a chat message, because this is a decision made
from evidence. It shows, in order: the requested transformation, the blast
radius with every affected entity and why, the affected manuscript, the risks
with their sources, the proposed changes step by step, then — after staging —
the validation, the diffs per file, and Accept / Discard.

"Visualise impact on the Story Map" (Phase 38) opens the same blast radius as
a causality view on the Story Map, focused on the refactor's target — the
change's reach drawn over the story rather than listed
([STORY_MAP.md](STORY_MAP.md)).

## Agent tool

```
analyse_story_refactor — what a change would reach: entities, blast radius,
                         manuscript references and recorded risks
```

`read_canon`, and **analysis only**. There is deliberately no
`stage_story_refactor` and no `apply_story_refactor`: a refactor rewrites a
novel's architecture across files the writer is not looking at, and that
decision belongs to the person whose book it is. When agents are trusted with
more, it will be through the approval workflow rather than by widening this
tool ([AGENT_TOOLS.md](AGENT_TOOLS.md)).

## Supported refactors (planned)

change a character's profession ✅ · change a relationship ✅ · rename ✅ ·
move an event ✅ · remove a character · merge two characters · change the
murderer · change POV character · alter a world rule · change a location ·
change the ending · convert first-person ↔ third-person · change story
chronology.

Each will be a bounded class with its own analysis, for the same reason the
first four are: a refactor engine that accepts anything produces plans nobody
can review.

## Invariants

- Blast-radius analysis precedes any manuscript change.
- Stable IDs never change; references survive the operation.
- Dependency discovery uses the structured systems; text discovery uses search.
- Model contributions are labelled, and never decide what is affected.
- A model rewrite must quote its sentence verbatim or it is rejected.
- Validation runs before commit, against a copy.
- Nothing commits without approval; a discarded refactor touches nothing.
- Every refactor is one change set, preceded by a checkpoint.
- The whole operation is recorded: request, analysis, plan, models, diffs,
  diagnostics before and after, approval, revision.
- No agent tool stages or applies a refactor.

## Relationship to other subsystems

- [CAUSALITY.md](CAUSALITY.md) — the dependency graph the blast radius comes from.
- [STORY_COMPILER.md](STORY_COMPILER.md) and [STORY_TESTS.md](STORY_TESTS.md) —
  what validates the result.
- [VERSIONING.md](VERSIONING.md) — checkpoints, staged transactions, change sets.
- [SEARCH.md](SEARCH.md) — how manuscript references are found.
- [CONTEXT_COMPILER.md](CONTEXT_COMPILER.md) — how the model is given context.
- [STORY_DEBUGGER.md](STORY_DEBUGGER.md) — investigates why something is not
  working; this changes it once the writer knows.
