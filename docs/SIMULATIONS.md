# SIMULATIONS

Reader and character simulation systems used to test narrative behaviour. Both produce **model judgement**, presented with evidence — never objective science.

- **Packages:** `@jellytind/reader-sim` (profiles, the sequential engine,
  staleness, series), `@jellytind/domain` (the vocabulary),
  `@jellytind/context-compiler` (the `reader_sequential` recipe),
  `@jellytind/story-repository` (persistence), `@jellytind/editing` (the reader
  as a model call)
- **Status:** **Reader Simulator implemented and tested (Phase 27).** Four
  shipped profiles plus the writer's own, persistent per-chapter state, the ten
  questions, charts over story progression, staleness detection and re-running
  from an affected chapter. The **Character Simulator remains PLANNED** (V4).

## Reader Simulator

A reader who has read this far and no further.

### No future leakage

This is the requirement everything else is arranged around, and it is enforced
by construction rather than by asking a model to behave.

A reader is given exactly one object — a **packet** — built from the
`reader_sequential` Context Compiler recipe. That recipe is **subtractive**:
where every other recipe asks "what would help here?", it asks "what could this
person possibly have seen?" and refuses the rest.

| Given                                                 | Withheld                                           |
| ----------------------------------------------------- | -------------------------------------------------- |
| Prose up to and including this chapter, nearest first | Every later chapter — prose, title, summary, ID    |
| The reader's own accumulated state                    | Character sheets, plot threads, world rules, facts |
| Their profile's traits                                | Story state: who knows what, where anything is     |
|                                                       | Setups, payoffs and authorial intent               |

**No entity records at all.** A character record, a thread's status, a fact's
objective truth — these are what the _author_ knows. Hand a reader the story
bible and of course they suspect the right person: they were told.

The test that matters plants a unique token in every chapter of a twenty-chapter
book and asserts that a packet for chapter ten contains `CHAPTERWORD10`, contains
`CHAPTERWORD1`, and contains **none** of eleven through twenty — nor any later
chapter's title or ID, nor the recorded fact that gives the mystery away.

### The reader persists

```
ReaderState {
  known · remembered · suspicions · trust · attachment
  predictions · questions · confusion · interest · emotionalResponse
}
```

Chapter eleven is read by the person chapter ten produced. The state is carried
into the next packet — written as _their beliefs_ ("you are moderately
suspicious of Elias"), so a wrong belief from chapter three stays a belief
rather than hardening into something the reader treats as established.

The run is **not** restarted per chapter, and the engine is tested for it: the
reader arriving at chapter four is holding three chapters' worth of accumulated
belief.

### The ten questions

What do you think is happening? · Who do you trust? · Who do you suspect? ·
What do you predict? · What questions remain? · What confused you? · What
bored you? · What interested you? · What emotional moments landed? · What
details do you remember?

Answered as a reader, not as an editor being constructive. A reader who says a
chapter bored them is giving the writer the most useful sentence in the report,
and a model asked to be helpful will suppress it — so the instructions ask for
the opposite.

### Levels, never percentages

Attitudes carry a band — `none`, `low`, `moderate`, `high` — with the reason the
reader gave. A simulated reader who is "68% suspicious" is a number pretending
to be an instrument. Bands can be charted honestly and compared across chapters,
which is what a writer can actually act on.

### The deterministic half

Exposure is computed with no model at all: which chapters, scenes, characters,
facts-on-the-page and threads this reader had met by chapter N, in **presentation
order** — a flashback in chapter twelve is met in chapter twelve, whatever year
it happens in. It is the same boundary the recipe applies, and it is what the
report shows beside every reading: _read on 4,120 words, 9 scenes, having met 4
characters. Nothing after this chapter was shown._

### Four readers, and yours

| Reader                            | Reads for                                                     |
| --------------------------------- | ------------------------------------------------------------- |
| **Genre Expert**                  | structure; hard to surprise; suspects who the text is kind to |
| **Casual Reader**                 | the story; loses names; stops caring when confused            |
| **Emotion-Focused Reader**        | the people; attaches fast; remembers gestures                 |
| **Critical Developmental Reader** | what each chapter is for; says plainly when bored             |

A profile is a short list of **traits**, not a persona to act out. What a reader
notices is what makes their answers differ, and the same manuscript read by two
of them is the finding: a genre expert suspecting someone in chapter four while
a casual reader is still fond of them is not a contradiction.

Writers add their own as JSON in `.writer/readers/profiles/`, validated on load
and before writing, with a profile carrying no traits refused by name.

### Charts

```
Suspicion of Elias
high     ┤                        ╭────────
moderate ┤            ╭───────────╯
low      ┤     ╭──────╯
none     ┤─────╯
         └───────────────────────────────  ch 1 … ch 20

Simulated reader response — a model's reading of the manuscript, not a
measurement of readers.
```

The caveat is part of the series object, not decoration added by whoever draws
it. A rising line is the most persuasive thing in this product and what it is
persuading you of is one model's reading of your book.

A chapter where the reader said nothing about a subject **carries the level
forward** rather than dropping to zero: a reader who stops mentioning someone
has not stopped suspecting them.

### Staleness, and re-running from the middle

Every reading records a fingerprint of the prose it was made from. When the
writer rewrites chapter four, the check reports:

```
Chapter 4 has changed since this reader read it. Everything from there on is a
reading of prose that no longer exists. Chapters 1–3 still stand.
```

Only from there. A reader who read chapters one to three before the rewrite
still read chapters one to three — nothing that happens afterwards reaches back
and changes what they knew at the time. `rerunFrom` resumes with the reader who
finished chapter three, so an edit costs four chapters of re-reading rather than
twenty.

### For the Mystery Engine

A mystery is working when the reader suspects the right person at the right time
and not before, which is exactly `suspicionOf(simulation, characterId)` and
`firstSuspected(simulation, characterId, "moderate")`. The seam is in place, so
when the Mystery Engine arrives it consumes reader simulations rather than
growing a second opinion of its own.

### Needs a model

Unlike the deterministic subsystems, a reader simulation has no useful half
without one: interpretation is the whole of what it produces. It **refuses to
start** rather than offering an empty run — a reader who has read nothing has no
opinion, and inventing one is the failure this feature exists to avoid.

## Character Simulator — PLANNED

Not "chat with your character." A character simulator receives memories, personality, goals, fears, knowledge, beliefs, relationships, current emotional state, physical state and current circumstances, then challenges proposed story behaviour.

Example — _Given everything Mara knows at this point, would she realistically enter the house alone?_

```
CHARACTER SIMULATION
Proposed action: Mara enters the house alone.
Consistency: Low
Primary conflicts:
  - established fear of enclosed spaces
  - knows suspect may be present
  - previously refuses unnecessary physical risk
  - has access to police backup
Possible fixes:
  - remove access to backup
  - create urgent time pressure
  - establish overriding personal motive
  - alter earlier characterisation
```

Purpose: identify **plot-forced behaviour**. Any plausibility it reports is model judgement, not objective measurement.

The simulator will draw its inputs from [Story State](STORY_STATE.md) at the relevant story time (what the character knows/feels _then_, not "latest") — the character-side equivalent of the reader's sequential boundary.

## Design requirements

- **No future leakage.** Enforced by the recipe and the packet, not by
  instructions. Reader presentation order for readers; story chronology +
  character knowledge for characters. See truth/belief/reader-knowledge
  separation in [STORY_STATE.md](STORY_STATE.md).
- **Persistent state.** Reader state accumulates; it is stored per chapter and
  inspectable.
- **Judgement, not fact.** Outputs feed the [Story Debugger](STORY_DEBUGGER.md),
  story tests and dashboards as evidence, always labelled as simulation results.
- **Cost-aware.** A twenty-chapter read is twenty model calls; the panel says
  how far it has read as it goes, and a failure keeps every chapter already read.
- **Branch-aware.** Simulations live in the project, so a branch carries its own
  (see [VERSIONING.md](VERSIONING.md)).

## Invariants

- A reader is never given anything from a chapter they have not reached.
- A reader is never given a project record — only pages, and their own state.
- Reader state persists across the run and is carried into the next chapter.
- Attitudes are bands with reasons, never percentages.
- Every series carries its caveat.
- A change to chapter N invalidates readings from N onward, and no earlier.
- Re-running resumes the reader who finished N−1.
- With no model configured, a simulation refuses to start rather than inventing
  a reader.

## Relationship to other subsystems

- [CONTEXT_COMPILER.md](CONTEXT_COMPILER.md) — the `reader_sequential` recipe
  and the `revealsFuture` flag reader-facing recipes filter on.
- [NARRATIVE_THREADS.md](NARRATIVE_THREADS.md) — the authorial intent a reader
  must never see.
- [STORY_STATE.md](STORY_STATE.md) — truth, belief and reader knowledge kept
  apart.
- [MODEL_ROUTER.md](MODEL_ROUTER.md) — where the reader's model comes from.
