# SIMULATIONS

Reader and character simulation systems used to test narrative behaviour. Both produce **model judgement**, presented with evidence — never objective science.

- **Packages:** `@jellytind/reader-sim` (profiles, the sequential engine,
  staleness, series), `@jellytind/domain` (the vocabulary),
  `@jellytind/context-compiler` (the `reader_sequential` recipe),
  `@jellytind/story-repository` (persistence), `@jellytind/editing` (the reader
  as a model call)
- **Status:** **Both implemented and tested.** Reader Simulator (Phase 27):
  four shipped profiles plus the writer's own, persistent per-chapter state,
  the ten questions, charts over story progression, staleness detection and
  re-running from an affected chapter. Character Simulator (Phase 28):
  author-confirmed personality, state compiled at a story point, the behaviour
  test, counterfactuals, the agency audit and Story Debugger integration.
- **Also:** `@jellytind/character-sim` (the snapshot, the test, the audit),
  `@jellytind/story-repository` (`personalities`).

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

## Character Simulator

_Would Mara realistically enter the house alone here?_

Not "chat with your character". The question is whether a proposed action
follows from what this person knows, wants and fears **at this point in the
story** — and the answer is worthless unless the state is taken at the right
point.

### The snapshot is the acceptance criterion

Everything is reconstructed at the boundary **entering** the scene, which is
the only state that can explain a choice made inside it:

| Compiled                                              | From                                  |
| ----------------------------------------------------- | ------------------------------------- |
| Character profile, goals, notes                       | the character record                  |
| Author-confirmed personality                          | `.writer/characters/personality.json` |
| Physical state: status, presence, location, inventory | state at `{ sceneId, before }`        |
| Knowledge — **theirs alone**                          | knowledge at that boundary            |
| Relationships, as they stand at that point            | relationship state at that boundary   |
| Memories: scenes they were in, nearest first          | scene order                           |
| Pressures: what they have just learned or lost        | transitions in the last three scenes  |
| Scene circumstances: purpose, who is present, where   | the scene record                      |

Two exclusions do the real work:

**No future.** State is replayed to the boundary. A transition anchored later
in the book cannot reach back into it — tested directly: Mara does not hold the
fact in scene two, holds it in scene four, and her relationship with Elias is
`wary` at two and `broken` at four.

**No borrowed knowledge.** Propositions the story has established that this
character does _not_ hold are **counted and withheld**. The briefing says _"1
other proposition is established that this character does not hold; it is
deliberately not shown to you"_ — because whether she would walk into the trap
depends on what _she_ believes. What the reader knows is a different question,
and mixing the two is how a simulator quietly starts answering it.

### Author-confirmed personality

Ten dimensions — values, fears, temperament, moral lines, under pressure,
attachments, blind spots, competence, self-image, risk appetite — recorded in
the author's own words.

Traits carry a status, because a model may **propose** one from the manuscript
and a proposal is not a fact about the character until the author agrees.
**Only confirmed traits reach a simulation**: a model's reading of Mara, fed
back in as Mara's personality, would make every answer agree with the model's
own guess. A rejected trait is kept — it is the author saying _that is not who
she is_, which says more than never having recorded it.

### The behaviour test

```
Proposed action          Mara enters the cellar alone.

Potential contradiction  She is recorded at The cellar entering a scene set
                         somewhere else.                    [from the project]

Model judgement          Strained — possible, but it costs something
                         Her stated fear is specific and the scene gives her no
                         pressure to override it.
                         Would change this: whether the fear is meant to have
                         been overcome by now.
                         A reading by <model>, not a measurement. 1 factor for,
                         2 against — counts, not a score.

Factors supporting       She has said she wants to know who sealed it.
Factors opposing         Going alone costs her the one corroborating witness.
                         She is recorded as avoiding confined spaces alone.

What would make it       Take away the option of waiting for Elias.
more plausible           Costs: Elias loses a scene of presence.

Relevant established     …everything the project records, with its source.
factors
```

**Hard contradictions are deterministic.** The project settles them: recorded
deceased, recorded departed, recorded somewhere else, not in the scene at all,
or — the sharpest, borrowed from the Story Debugger — the action turns on a
proposition they do not hold at this point. That last one is not a matter of
taste: the manuscript is asking someone to act on information nobody gave them.

**Everything a model raises is soft**, and labelled a reading.

### No probability

There is no percentage, no score and no probability anywhere in the output, and
a test asserts it. "Behavioural plausibility: 24%" is a number with no
instrument, no population and no defined error — it would look like science and
mean nothing. What the test reports is a **band** with its reasoning, and the
**counts** behind it stated as counts. The heuristic that maps counts to a band
is called `heuristicBand`, so nothing can mistake it for a measurement.

### What would they do instead?

Advisory, and applied to nothing. Alternatives come back as options with a band
and a reason, and the caveat travels with them — a simulator that quietly
rewrote a scene to whatever a model found more plausible would be replacing the
author's judgement with its own.

### Character Agency Audit

_Where does someone act because the plot needs them to?_ Mostly a reading — but
not entirely, and the part that is not is worth finding first. Four
deterministic signals:

1. **Acting on information they do not have** — a scene turning on a
   proposition they do not hold.
2. **A decision with no recorded reason** — the author wrote down that she
   chose; nothing says why.
3. **Moved without a reason** — their position or condition changes in a scene
   where no decision of theirs is recorded. The change may be done _to_ them.
4. **No goals at all** — not a fault, but nothing can be checked against it, and
   the audit says so rather than passing silently.

Everything beyond those is model judgement and carries the caveat.

### Motivation debugging

The Story Debugger asks _why does Mara's decision feel forced?_; the simulator
asks _would she do it at all?_ Same reconstructed state, two directions — so
the simulator hands its **deterministic** findings back in the debugger's own
evidence shape, and the Debug panel offers the simulation directly from a
motivation question.

The model's judgement is deliberately **not** included as evidence: a diagnosis
citing another model's reading would be citing itself, and the debugger's whole
contract is that claims rest on what the project records.

### Without a model

Unlike the reader simulation, the character simulation has a real deterministic
half: established factors and hard contradictions run with no model at all. The
judgement is simply absent, and the report says why.

## Design requirements

- **No future leakage.** Enforced by construction, not by instructions. Reader
  presentation order for readers; the scene boundary and character knowledge for
  characters. See truth/belief/reader-knowledge separation in
  [STORY_STATE.md](STORY_STATE.md).
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
- With no model configured, a reader simulation refuses to start rather than
  inventing a reader; a character simulation runs its deterministic half and
  says what it could not weigh.
- A character is never given a proposition they do not hold — only the count of
  them.
- Only author-confirmed personality reaches a simulation.
- Plausibility is a band with reasoning. No percentage, no score, no
  probability.
- Counterfactuals and conditions are advisory; nothing is applied to canon.

## Relationship to other subsystems

- [CONTEXT_COMPILER.md](CONTEXT_COMPILER.md) — the `reader_sequential` recipe
  and the `revealsFuture` flag reader-facing recipes filter on.
- [NARRATIVE_THREADS.md](NARRATIVE_THREADS.md) — the authorial intent a reader
  must never see.
- [STORY_STATE.md](STORY_STATE.md) — truth, belief and reader knowledge kept
  apart.
- [MODEL_ROUTER.md](MODEL_ROUTER.md) — where the reader's model comes from.
