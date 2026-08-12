# STORY_DEBUGGER

A diagnostic workflow that investigates **why** something is not working before
proposing anything. The fiction equivalent of a debugger: you do not fix the
line you first suspect, you find out what the program actually did.

- **Packages:** `@jellytind/story-debugger` (the deterministic investigation),
  `@jellytind/editing` (`DiagnosisAnalyst` — the model's interpretation),
  `@jellytind/story-repository` (project access and report persistence)
- **Status (Phase 18):** **V1 implemented and tested.** Four modes — reveal,
  character motivation, pacing, continuity — with deterministic tracing, model
  interpretation, navigable reports, a `/debug` command and three agent tools.
  Reader-simulation signals are **PLANNED** ([SIMULATIONS.md](SIMULATIONS.md)).

## The premise

_"Marcus's betrayal isn't landing."_

Every writing tool answers that with advice: raise the stakes, plant more
foreshadowing, deepen the relationship. Advice is what you say when you have not
looked. The project has looked at nothing — it does not know which scene the
reveal is in, what was planted for it, when the signals start, or who already
knew.

The debugger looks. It finds the reveal, pulls the setups that serve it, counts
how far ahead the signals begin, reconstructs the relationship as it stood
entering the scene, and lists everyone who already knew — and only then does a
model say what it thinks that means, with citations.

**The acceptance test is that the product investigates a story problem in a
structured way rather than responding with generic writing advice.**

## The workflow

```
problem
  ↓
identify scope
  ↓
retrieve evidence
  ↓
trace the relevant story systems
  ↓
analyse
  ↓
form diagnosis
  ↓
present evidence
  ↓
suggest interventions
```

The first four steps are **deterministic and model-free** — that is the
load-bearing decision. `repo.traceStoryProblem()` produces a real report on a
project with no model configured at all, and when a model does run its
contribution is visibly an _addition_ to the evidence rather than the substance
of it.

Nothing rewrites manuscript content. The debugger diagnoses.

## Three kinds of claim, kept apart

| Kind              | Where it comes from                 | Label in the report |
| ----------------- | ----------------------------------- | ------------------- |
| **Evidence**      | what the project records, retrieved | deterministic       |
| **Measurement**   | counted from that evidence          | counted, not graded |
| **Diagnosis**     | a model reading the evidence        | MODEL JUDGEMENT     |
| **Interventions** | the model's proposals               | suggestions         |

The separation is in the types, not just the presentation: `DebugTrace` holds
evidence and measurements and nothing else, and `DebugReport` adds an
**optional** diagnosis. A report can exist with evidence and no diagnosis. It
cannot exist with a diagnosis and no evidence.

### Measurement is not judgement

"The first signal sits nine scenes before the reveal" is a fact. "The reveal is
telegraphed" is an opinion. The trace produces only the first, with its basis
attached, exactly as thread dormancy is measured rather than graded
([NARRATIVE_THREADS.md](NARRATIVE_THREADS.md)). Whether nine is too many depends
on the book, and a system that decided it would be wrong about half of them.

## The four modes

### Reveal — _why doesn't Marcus's betrayal land?_

Finds the reveal (given directly, or from the payoff of a setup, a thread's last
appearance, or the first acquisition of the revealed fact) and inspects:

- the reveal scene, its purpose and position in story order
- every **setup** recorded as serving it: where planted, subtlety, intended
  reading, distance from the reveal
- promises made before it and still outstanding at it — what the reader is
  holding
- the preceding scenes that carry the reveal's material, each with its distance
- **who already knew**, from the knowledge transitions, and how they came to
- the **thread's** whole lifecycle, and its dormancy entering the reveal
- the **relationship** the reveal breaks, as it stood entering the scene
- prose excerpts for the reveal and the nearest signals

Measured: scenes from first signal to reveal, chapters spanned, and how many
scenes carry the material.

### Character motivation — _Mara's decision to enter the house feels forced_

A decision reads as earned when it follows from what the character wants, what
they know, and who they are to the people involved. Three of those are recorded:

- their **goals** (`Character.goals`, added for this — see below)
- what they **know** entering the scene, and how they came to know it
- their **location and status** entering the scene
- the **relationships** with everyone else in the scene, as they stood entering it
- their **prior behaviour** — their last few scenes, with what each was for
- the scene's own purpose and prose

The sharpest signal here is deterministic: **a scene whose recorded facts
include something the character does not hold at that point.** That is not a
matter of taste — the manuscript is asking someone to act on information nobody
has given them.

### Pacing

- chapter lengths, scene counts, and scenes recording no purpose
- the distribution: total, median, longest-to-shortest ratio
- chapters two or more times the median, or half it, stated as **distance**
- thread activity chapter by chapter

Two things are declared unmeasured rather than faked: **conflict and tension
have no fields in the domain**, and rhythm inside a scene needs a reading of the
prose rather than a count of it. The report says so under _Not inspected_.

### Continuity — start from a diagnostic, find the cause

The Story Build says _what_ is wrong. It does not say how the project got there,
and the cause is what a writer fixes:

> `object_continuity`: SCENE_0005 takes place at the manor and uses the
> revolver, but the revolver was last recorded at the Vance House.

The trace walks **each entity the diagnostic names** back through the system
that owns it — object history and transfers, character position, knowledge
chains, thread lifecycle, relationship changes — up to the scene where the
finding landed, and measures the silence: how many scenes ran between the last
recorded change and the finding.

## Character goals

`Character.goals` is new in this phase: short lines saying what someone is
trying to do, the counterpart of a scene's `purpose`. It exists because
motivation debugging is a question about the gap between what someone wants,
what they know and what they do, and two of those three were already recorded.

Goals are the author's statement of intent, not derived state. A character with
no recorded goals is **not** a character without goals, and the report says
which of the two it is looking at — under evidence _and_ under _Not inspected_.
Projects written before this field simply read as an empty list.

## The report

Seven headings, always in this order, always present — a section with nothing in
it says so rather than disappearing:

```
Problem
Scope inspected
Evidence
Diagnosis
Confidence and uncertainty
Possible interventions
Affected entities
```

A missing Diagnosis heading would quietly hide the fact that nothing interpreted
the evidence, so it is always there and says **"Not diagnosed"** when nothing
did.

### Scope names what it did not look at

```
Not inspected: What the prose implies to a first-time reader — no reader
               simulation exists yet.
Not inspected: Whether the choice serves Mara's goals — none are recorded to
               compare against.
```

A silent omission would make the report untrustworthy in exactly the cases where
it matters most.

### Every cited item is navigable

Evidence carries `sceneId`, `chapterId` and `entities`; in the Debug panel each
is a button that opens the scene's prose or the entity's inspector. A finding
you cannot click through to is a finding you learn to ignore.

## The model's contract

The `DiagnosisAnalyst` is given the evidence — each item with a **stable ID**
(`E1`, `E2`, …) — and is required to cite those IDs. What comes back is coerced,
never trusted:

- citations that resolve to real evidence go in `basis`;
- **citations that resolve to nothing go in `unsupported`**, kept visible rather
  than quietly dropped, because a diagnosis resting on invented evidence is
  exactly the failure this product exists to prevent;
- an unreadable confidence is read as `low`, never as high;
- an intervention with no summary is dropped; an unknown `kind` or `effort`
  falls back rather than propagating.

If the model call fails, **the evidence is still saved** with no diagnosis. A
failed interpretation must not cost the writer the investigation.

## `/debug betrayal Marcus`

The topic word chooses the mode — `betrayal`, `twist`, `reversal` and `secret`
all mean reveal — and the remaining words are resolved against the project's own
entities, because "Marcus" must mean `CHAR_0007` before anything can be traced.
The whole line survives as the problem statement: a mode plus two IDs is not
what the writer said.

Words that match nothing are **reported, not ignored**, and a prefix matching
two characters names neither.

Natural language takes the other road: the agent reads the sentence and calls
`run_story_debug` with the same structured request, so the fast path needs no
model at all.

## Agent tools

```
run_story_debug     — investigate; returns scope, evidence and measurements
list_debug_reports  — what has been investigated before
get_debug_report    — a stored report, with its diagnosis if one was made
```

`run_story_debug` returns the **investigation, not a conclusion**. Routing an
agent's question through a second model call would put an opinion between the
agent and the record; interpreting deterministic evidence is what an agent is
for.

All three are `read_canon`. **No tool applies an intervention** — the debugger
diagnoses, and acting on a diagnosis is an editorial decision that stays with a
human ([AI_EDITING.md](AI_EDITING.md)).

## Where the pieces live

`@jellytind/story-debugger` sits **below** the Story Repository, beside the
Story Compiler, and depends on no model. The repository satisfies its narrow
`DebugReader` port structurally and adds persistence:

```ts
repo.traceStoryProblem(request); // deterministic, no model
repo.parseDebugCommand("/debug betrayal Marcus");
repo.saveDebugReport(trace, { durationMs });
repo.listDebugReports();
```

The interpreting half lives in `@jellytind/editing` because that package's job
is controlled AI operations — the model proposes, a human decides — and a
diagnosis is exactly that. Keeping it there also keeps the model router from
being dragged underneath the repository.

Reports persist under `.writer/debug/`, written **straight to the store rather
than through the journal**: an investigation is derived analysis, not a change
to the story, and a writer's revision history should contain the changes they
made rather than the questions they asked ([VERSIONING.md](VERSIONING.md)).

## What is deliberately absent

- **Reader simulation.** "Would a reader suspect Marcus by chapter 14?" is the
  question a writer most wants answered, and nothing here answers it. The trace
  measures how many signals there are and where; it does not model a reader
  ([SIMULATIONS.md](SIMULATIONS.md)).
- **Conflict and tension metrics.** No such fields exist in the domain.
- **Prose-level analysis** — voice, rhythm, dialogue attribution.
- **Automatic editing.** Interventions are proposals. Applying one goes through
  the normal propose → review → accept flow when the writer chooses it.

## Invariants

- Diagnosis precedes modification; the debugger never rewrites the manuscript.
- Evidence is deterministic; the diagnosis is labelled model judgement; the
  interventions are labelled suggestions.
- Measurements are counted, never graded.
- A model's citation to evidence that does not exist is surfaced, not dropped.
- The report says what it did **not** inspect, and why.
- Every cited story item is navigable.
- A failed interpretation still saves the evidence.
- Investigating changes nothing about the story and is not a change set.
- No agent tool applies an intervention.

## Relationship to other subsystems

- [STORY_COMPILER.md](STORY_COMPILER.md) — says what is wrong; continuity
  debugging starts from one of its diagnostics and finds the cause.
- [STORY_STATE.md](STORY_STATE.md), [TIMELINE.md](TIMELINE.md),
  [NARRATIVE_THREADS.md](NARRATIVE_THREADS.md),
  [OBJECTS_LOCATIONS.md](OBJECTS_LOCATIONS.md) — where the evidence comes from.
- [STORY_TESTS.md](STORY_TESTS.md) — the writer's own assertions; a failing one
  is often the fastest route into a debug session.
- [AI_EDITING.md](AI_EDITING.md) — where an accepted intervention would go.
- [AGENT_TOOLS.md](AGENT_TOOLS.md) — the three read-and-run debug tools.
- [SIMULATIONS.md](SIMULATIONS.md) — what will eventually answer the reader
  questions this cannot.
