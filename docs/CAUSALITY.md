# CAUSALITY

The story dependency graph: which parts of a novel exist because of which other
parts. The foundation [Story Refactor](STORY_REFACTOR.md) is built on.

- **Packages:** `@jellytind/domain` (the vocabulary),
  `@jellytind/story-causality` (the graph), `@jellytind/story-repository`
  (persistence and queries), `@jellytind/editing` (`DependencyAnalyst` —
  proposals)
- **Status (Phase 19):** **Implemented and tested.** Eight relation kinds,
  manual registration, AI proposals held for review, the five queries, blast
  radius with path explanations, deletion warnings, a compiler rule and an
  interactive graph view.

## The premise

A manuscript records **sequence**: this scene, then that one. It does not record
**consequence**, and consequence is what breaks when a scene is cut.

Nothing in the prose says that the confrontation in chapter 19 only happens
because of the letter in chapter 4. That link lives in the author's head, which
is why cutting chapter 4 is terrifying: they know something will break and
cannot say what. The graph writes those links down.

**The acceptance test is that the application can answer _if I remove this
scene, what later story elements depend on it?_ from persistent story
architecture rather than by asking a model to guess.**

## What earns a place

This is deliberately **not** an attempt to encode every causal relation in a
novel. A graph that tried would be enormous, mostly wrong, and useless — every
scene "causes" the next one in some sense, and a warning that fires on
everything is a warning nobody reads.

What earns a place is the dependency a writer would want to be warned about
before changing something. Ten good edges are worth more than a hundred
plausible ones, and the model prompt says so in as many words.

## The relations

| Kind         | Reads as       | Influence |
| ------------ | -------------- | --------- |
| `causes`     | A causes B     | A → B     |
| `enables`    | A enables B    | A → B     |
| `motivates`  | A motivates B  | A → B     |
| `reveals`    | A reveals B    | A → B     |
| `prevents`   | A prevents B   | A → B     |
| `resolves`   | A resolves B   | A → B     |
| `requires`   | A requires B   | **B → A** |
| `depends_on` | A depends on B | **B → A** |

### The writer never has to think backwards

_The confrontation **requires** the letter_ is how a person says it. But
influence runs the other way: the letter is upstream. So the edge is **stored as
the sentence was written** and **traversed on one normalised arrow**,
cause → effect. `A requires B` and `B enables A` describe the same influence and
behave identically in every query.

Traced paths render along the arrow, using the passive form where the sentence
was backwards, so a chain always reads forwards:

```
SCENE_0004 → enables → SCENE_0019 → is required by → SCENE_0027
```

## Nodes

Scenes, events, facts, plot threads, setups, objects, characters — and
**decisions**.

`Decision` is a new entity in this phase (`DECISION_0001`: what someone decides,
who decides it, in which scene, and why). It exists because plot is what
happens, while a decision is _why the next thing happens_: a chain of scenes
explains sequence, a chain of decisions explains consequence. Recording one is
optional; a story needs the decisions that later decisions rest on, not all of
them.

Locations and world rules are deliberately excluded. A place does not cause
anything, and a rule constrains the story rather than participating in its chain
of events.

## Registration is explicit

```ts
repo.addDependencies([{ kind: "enables", fromId: SCENE_0004, toId: SCENE_0019, description: "…" }]);
```

Both endpoints must exist and must be kinds that can participate. A dependency
naming a deleted scene is a claim about nothing, and one recorded now would
silently poison every blast radius later.

Dependencies are **canon**: they live in `plot/dependencies.json` beside plot
threads and setups, travel with the project, and go through the journal — losing
a link a refactor was planned around should be undoable ([VERSIONING.md](VERSIONING.md)).

They are not entities: an edge has no name, no file and no place in the entity
browser, so it carries its own `DEP_nnnn` sequence.

## Proposals are held

A model can read a run of scenes and notice that the confrontation only happens
because of the letter. What it cannot do is _decide_ that — being wrong here is
expensive in a way most model errors are not. A hallucinated dependency does not
produce a bad sentence; it produces a blast radius a writer trusts and a
refactor planned against a link that does not exist.

So `DependencyAnalyst` stores everything as `proposed`, which the graph excludes
by default, and a human accepts or rejects each one. Drafts naming an invented
ID, a relation kind that does not exist, or carrying no evidence are **set aside
with the reason** rather than dropped, so the writer sees what the model tried
to claim.

The scope is a named run of scenes, not "the whole book": a thousand proposals
nobody reviews is the same as no review at all.

## Queries

```ts
repo.getDependenciesOf(id); // one step upstream — what it rests on
repo.getDependentsOf(id); // one step downstream — what rests on it
repo.getTransitiveDependents(id); // everything downstream, at any distance
repo.getDependencyPath(from, to); // the shortest chain, or null
repo.calculateBlastRadius(id); // everything downstream, with the paths
```

All of them accept `{ kinds, maxDepth }`, so a writer can ask "what does this
_cause_, ignoring what it merely enables?" and get a different, smaller answer.

## Blast radius

```
Changing SCENE_0042 may affect:

  SCENE_0051   direct     SCENE_0042 → causes → SCENE_0051
  FACT_0012    direct     SCENE_0042 → reveals → FACT_0012
  SCENE_0053   2 steps    SCENE_0042 → causes → SCENE_0051 → enables → SCENE_0053
  THREAD_0008  3 steps    … → SCENE_0053 → resolves → THREAD_0008
  SCENE_0061   3 steps    … → SCENE_0053 → motivates → SCENE_0061
```

Every affected element carries **the path that reaches it**. "SCENE_0051 is
affected" is not actionable; "SCENE_0051, because this scene causes it" is. Up
to three routes are kept per element, because two independent paths to the same
scene is exactly the sort of thing a writer wants to see.

## Cycles never crash

A causal loop is usually a mistake, but it is a mistake a writer can make — and
a graph that hung or threw on one would fail in precisely the moment it was
needed. Every traversal carries a visited set; a blast radius that met a loop
says `cyclic: true` and still returns a complete answer.

Loops are **reported, not prevented**. A writer may register a genuine feedback
loop, and refusing the edge would be the system overruling them. What the system
owes them is to say it is there.

## Deletion warnings

Deleting an entity the graph depends on is refused by default, and the refusal
says how much rests on it:

> `SCENE_0042` takes part in 3 registered dependencies, and 5 story elements
> depend on it directly or transitively.

The inspector shows the blast radius before the confirmation, listing each
affected element and whether it is direct. Unlinking removes the dependencies
along with the entity — and, being journaled, is revertible.

## Compiler integration

The `dependency_integrity` rule (category `causality`) consumes
`checkDependencies` rather than re-deriving it, like every other rule:

| Finding                 | Severity  | Why                                             |
| ----------------------- | --------- | ----------------------------------------------- |
| `dangling_endpoint`     | `error`   | The link names something that no longer exists. |
| `self_dependency`       | `error`   | Something registered as resting on itself.      |
| `cycle`                 | `warning` | A loop — possibly deliberate.                   |
| `effect_precedes_cause` | `warning` | The effect comes first in story order.          |
| `duplicate`             | `info`    | The same link registered twice.                 |

Only **confirmed** edges are checked: a proposal naming a missing scene is a
proposal to reject, not a broken dependency, and reporting it as an error would
punish the writer for not having reviewed it yet.

`effect_precedes_cause` is a warning rather than an error on purpose — a
flashback or a delayed reveal can legitimately be recorded that way.

## The graph view

Deliberately not a spider's web on a canvas. A writer asking "what depends on
this scene?" is answered better by three readable columns — what it rests on,
the thing itself, what rests on it — than by a picture they have to untangle.
Clicking any node re-centres the view, so walking the graph is how you explore
it; relation kinds are filter checkboxes; the blast radius sits underneath with
its paths spelled out.

The registration form reads as a sentence — _this · causes · that_ — and the
direction is worked out from the relation.

## Invariants

- Only registered dependencies exist. Nothing is inferred into the graph.
- Edges are stored as written and traversed on one normalised arrow.
- A model's proposal is not part of the graph until a human accepts it.
- Both endpoints must exist, and must be kinds that can participate.
- Traversal is cycle-safe: loops are reported, never fatal.
- Every blast-radius entry carries the path that explains it.
- Deleting a depended-on entity warns first and says how much depends on it.
- Dependencies are canon: journaled, revertible, and travel with the project.

## Relationship to other subsystems

- [STORY_REFACTOR.md](STORY_REFACTOR.md) — what this exists to make possible.
- [DOMAIN_MODEL.md](DOMAIN_MODEL.md) — `Decision`, and the stable IDs that make
  the graph tractable.
- [STORY_COMPILER.md](STORY_COMPILER.md) — the `dependency_integrity` rule.
- [NARRATIVE_THREADS.md](NARRATIVE_THREADS.md) — setups and payoffs, which are a
  narrower recorded relationship between scenes and are first-class nodes here.
- [STORY_DEBUGGER.md](STORY_DEBUGGER.md) — investigates _why_ something is not
  working; this records _what rests on what_.
- [VERSIONING.md](VERSIONING.md) — dependencies are change sets.
