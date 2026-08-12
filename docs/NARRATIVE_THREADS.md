# NARRATIVE_THREADS

Plot threads, setups and payoffs: explicit understanding of the promises a story
makes, rather than semantic interpretation of prose.

- **Packages:** `@jellytind/domain` (the `Setup` entity, interaction and subtlety
  vocabularies), `@jellytind/story-state` (lifecycle, dormancy, checks),
  persisted by `@jellytind/story-repository`
- **Status (Phase 15):** implemented and tested. Thread lifecycle as
  scene-anchored state, six interaction kinds, dormancy metrics, first-class
  setups and payoffs with foreshadowing metadata, six deterministic checks,
  thread and promise context with a structural spoiler guard, and the Threads
  panel.

## The premise

A plot thread is a promise the story is in the middle of keeping, and its shape
— introduced in chapter four, advanced twice, quiet through the middle, resolved
at the end — is invisible in the prose and obvious as data. A setup is worse
still: nothing whatsoever in the manuscript connects a brass key in a drawer in
chapter four to a cellar door in chapter twenty-seven. The link exists only in
the author's head.

So it is recorded. **The application understands narrative threads explicitly
rather than inferring them from 150,000 words on every query.**

## Thread lifecycle

The seven statuses were already in the domain; Phase 15 makes movement between
them time-aware, on the same scene-anchored transitions as every other kind of
state ([STORY_STATE.md](STORY_STATE.md)):

```
planned → introduced → active → escalating → dormant → resolved
                                                     ↘ abandoned
```

Two transition kinds carry it:

| Kind                | Value                 | Meaning                        |
| ------------------- | --------------------- | ------------------------------ |
| `thread_status`     | a `PlotThreadStatus`  | the lifecycle moves explicitly |
| `thread_appearance` | a `ThreadInteraction` | a scene touches the thread     |

## How a scene touches a thread

```
introduces · advances · complicates · references · escalates · resolves
```

A thread is not simply "in" a scene. Being introduced, pushed forward,
complicated, merely mentioned, raised in stakes and resolved are six different
events, and the difference is the whole shape of the thread.

Most interactions imply a lifecycle status, so a writer records one thing rather
than two:

| Interaction   | Implies      |
| ------------- | ------------ |
| `introduces`  | `introduced` |
| `advances`    | `active`     |
| `complicates` | `active`     |
| `escalates`   | `escalating` |
| `resolves`    | `resolved`   |
| `references`  | — nothing    |

**`references` is deliberately absent.** Mentioning a thread is not progress on
it, and treating a passing mention as progress would hide exactly the dormancy a
writer wants to see. An explicit `thread_status` always overrides the implication.

## Queries

```ts
repo.getThreadHistory(THREAD_PHOTO); // the whole trail, with what each step changed
repo.getThreadState(THREAD_PHOTO, { sceneId: SCENE_0042, position: "before" });
repo.getActiveThreadsAtScene(SCENE_0042); // introduced, active or escalating
repo.getDormantThreadsAtScene(SCENE_0042); // owed, but not being worked on
repo.getThreadsIntroducedInAct([CHAPTER_0001, CHAPTER_0002]);
repo.getUnresolvedThreads(); // everything the story still owes
```

Acts are not entities yet, so an act is named by the chapters that make it up.
When acts become first-class this keeps the same shape.

## Dormancy

Four measurements, at any boundary:

```
last appearance · scenes since · chapters since · words since
```

**Nothing here says a long silence is bad.** A thread quiet for eleven chapters
may be a structural problem or may be exactly the shape the book needs, and a
system that decided for the writer would be wrong about half the books ever
written. Dormancy is surfaced as information:

```
6 scene(s), 2 chapter(s), 6,000 words since SCENE_0004
```

The same discipline governs the check: `dormantAfterScenes` has **no default**.
Dormancy is reported only when a caller names a threshold, because the right
number for a thriller is wrong for a family saga.

### Word distance

Words live in chapter files, not scene files. A chapter's count is therefore
attributed to its **first** scene and the rest of its scenes get zero: every
total across a span is exact, while no per-scene number is invented. The
distinction matters, because a fabricated word count would look exactly like a
real one.

## Setups and payoffs

First-class, because a setup is a _relationship between scenes_ rather than a
property of either:

```
SETUP_0012
  description:   Brass key visible in father's drawer.
  setupScenes:   SCENE_0008
  payoffScenes:  SCENE_0057
  payoffDesc:    Key opens cellar archive.
  subtlety:      subtle
```

All three cardinalities work, because both ends are arrays:

- **one → one** — the ordinary case;
- **many → one** — the same promise planted repeatedly, kept once;
- **one → many** — a planting that pays off more than once.

Several separate `Setup` entities sharing a payoff scene is the other reading of
"many to one": distinct promises kept at the same moment.

### Foreshadowing metadata

| Field                    | What it records                                  |
| ------------------------ | ------------------------------------------------ |
| `subtlety`               | `blatant` `overt` `subtle` `buried`              |
| `intendedInterpretation` | what a first-time reader is meant to take it for |
| `trueMeaning`            | what it actually means — **author-only**         |
| `targetThreadId`         | the thread it serves                             |
| `targetRevealId`         | the proposition it ultimately reveals            |

`subtlety` is **authorial intent, not measurement**. Whether a setup _reads_ as
too obvious is a semantic judgement that belongs to a model working from the
prose; this is the writer stating what they were aiming for, which is a
different and checkable thing.

## Checks

`checkNarrative({ timeline, scenes, threads, setups, metrics, dormantAfterScenes })`
— deterministic, no model:

| Kind                       | Severity | What it means                                          |
| -------------------------- | -------- | ------------------------------------------------------ |
| `setup_without_payoff`     | warning  | a promise planted with nothing to keep it              |
| `payoff_before_setup`      | error    | the reader meets the answer before the question        |
| `unresolved_setup`         | warning  | the setup's thread finished without it landing         |
| `dangling_setup_reference` | error    | a setup names a scene the project does not have        |
| `abandoned_thread`         | warning  | a thread was dropped, and what still points at it      |
| `dormant_thread`           | warning  | a thread quiet for at least the named number of scenes |

Only structural contradictions are errors. Everything else is a warning, because
an unfinished book is _supposed_ to be full of open promises and long silences —
calling those mistakes would make the check useless during drafting. A setup
marked `abandoned` is one the writer deliberately dropped, and stops being asked
about.

**No craft judgement lives here.** Whether foreshadowing is too heavy, whether a
gap hurts the pacing, whether a payoff lands — all semantic, all future, all
model work.

## Threads and promises in compiled context

Scene inspection carries three things
([CONTEXT_COMPILER.md](CONTEXT_COMPILER.md)):

| Element                                         | Rule               | Reader-safe? |
| ----------------------------------------------- | ------------------ | ------------ |
| threads the scene carries, at their entry state | `active_thread`    | yes          |
| promises planted before it and not yet kept     | `open_setup`       | yes          |
| payoffs landing in it, with what they mean      | `scene_payoff`     | **no**       |
| promises planted here, and what they are for    | `authorial_intent` | **no**       |

Thread state is reconstructed at the scene's **entry** boundary, so drafting
chapter three is never told what the thread becomes in chapter twenty.

### The spoiler guard

The last two elements are marked `revealsFuture: true`, and the flag travels
onto the compiled `ContextItem`.

This is a structural guarantee rather than a naming convention, and it exists
for a subsystem that does not exist yet: **Reader Simulation** models what a
reader believes at a point in the book, and handing it authorial intent would
make its answers worthless. When it lands it filters on this flag, rather than
relying on whoever writes the recipe to remember.

Note what is _not_ flagged: the outstanding-promises list. What has already been
planted is something the reader has seen; only the intent behind it is hidden,
and that is not rendered there.

## The Threads panel

The desktop app's **Threads** tab shows, for any plot thread:

```
THE MISSING PHOTOGRAPH        status: resolved

Openings
  introduced                  SCENE_0001   the gap on the wall
  advanced                    SCENE_0003
The Middle
  dormant                     SCENE_0005
The Cellar
  resolved                    SCENE_0011
```

plus its dormancy measurements, the promises registered against it, forms to
record the next step or the next promise, and the findings that name it. The
dormancy threshold is a field the writer fills in — the app has no opinion until
they give it one.

## Relationship to other subsystems

- [STORY_STATE.md](STORY_STATE.md) — threads use the same scene-anchored
  transitions as knowledge, relationships and objects, replayed the same way.
- [CONTEXT_COMPILER.md](CONTEXT_COMPILER.md) — thread and promise context, and
  the `revealsFuture` flag.
- [STORY_COMPILER.md](STORY_COMPILER.md) — `checkNarrative` is the reusable
  foundation for the "unresolved threads" and "registered foreshadowing has
  valid future targets" lines of a story build.
- [SIMULATIONS.md](SIMULATIONS.md) — Reader Simulation is the intended consumer
  of the spoiler guard.

## Invariants

- A thread's lifecycle is reconstructed, never stored as "current status".
- A passing reference is not progress.
- Dormancy is a measurement; the system never decides what "too long" means.
- Word distance is exact across a span and invented for no individual scene.
- Setups are relationships between scenes, recorded because nothing in the prose
  records them.
- `trueMeaning` is author-only and never reaches a reader-facing context.
- Every check here is decidable from structure. Craft judgement is model work.
