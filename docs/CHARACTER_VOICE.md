# CHARACTER_VOICE

Persistent speech identities for the people in the book.

- **Packages:** `@jellytind/domain` (the model), `@jellytind/story-repository`
  (storage, measurement, comparison, checking),
  `@jellytind/context-compiler` (delivery)
- **Status (Phase 23):** **Implemented and tested.** Optional qualitative
  attributes, examples with source locations, scene-anchored voice evolution,
  deterministic differentiation and voice check, and context retrieval.

## Why a description is not enough

A character record says Elias is guarded and Mara is a solicitor. Neither tells
a model that Elias answers in four words and never contracts, while Mara circles
a question for three sentences before refusing it. That difference is what makes
dialogue sound like two people rather than one writer doing accents, and it has
to be **project data** — recorded, inspectable, checkable — not a paragraph of
prose.

The acceptance test is exactly that: a dialogue task distinguishes Elias's voice
from Mara's from what the project stores.

## The profile

Thirteen qualitative dimensions, **all optional**:

```
formality · vocabulary · sentence_length · directness · contractions
profanity · humour · regional_language · interruptions · filler_words
metaphor_usage · emotional_openness · evasiveness
```

Values are the writer's own words — _"blunt to the point of rudeness"_, _"never
swears except at his brother"_ — not a number on a scale. A voice is not a
slider, and forcing one would make the profile lie. Profiles merge on write, so
a writer fills in one field today and another next month; **an unfilled
attribute stays absent rather than becoming a default nobody chose**.

### Examples keep their source

A recorded line carries its scene, chapter and file. An example a writer cannot
navigate back to is an assertion — six months later nobody remembers whether it
was the voice they wanted or a first draft they meant to fix.

Examples can also be marked **not representative**: a counter-example, kept on
purpose to say _this is what he must not sound like_. Those are excluded from
the representative set and from measurement.

## Voice is not static

A character who has lost a brother by chapter 30 does not talk the way they did
in chapter 2, and a system that flags the change as an inconsistency is worse
than no system.

So voice **shifts** are scene-anchored transitions — the same shape as
everything else in [STORY_STATE.md](STORY_STATE.md). The baseline is replayed
forward through every shift anchored at or before a scene:

```
voiceAt(profile, shifts, sceneOrder, sceneId)
  → baseline, then each shift in scene order
  → attributes a shift does not mention carry forward untouched
```

A shift takes effect **in** the scene it is anchored to. Asking for the voice at
chapter 2 gets the guarded version; at chapter 31, the raw one.

## Measurement: of the sample, never of the character

`measureDialogue()` counts what is actually there — utterances, mean length,
question rate, contractions and hesitation breaks per hundred words, mean word
length as a rough register proxy.

Two rules make this honest:

**Nothing is defaulted to zero.** Filler and profanity rates are `null` unless
the writer named terms for them, and the reason appears in `notMeasured`. There
is deliberately **no built-in profanity list**: what counts is a matter of
register and setting, and shipping one would apply a stranger's judgement to
someone's novel.

**Samples too small are refused.** Below `MIN_WORDS_FOR_CHECK` (12 words) a
passage has a mean word length, but it is noise; reporting it as a departure
from the character's voice would be inventing a finding. Too small to measure is
said out loud.

Every result carries how many lines it came from.

## Differentiation

```
VOICE SIMILARITY

Elias ↔ Marcus
High similarity

Shared tendencies:
- similar utterance length
- similar contraction use
- similar hesitation and interruption

Heuristic, from the dialogue recorded for each character. Not a measurement of
the characters themselves.
6 recorded line(s) for CHAR_ELIAS, 5 for CHAR_MARCUS.
```

**A band, never a percentage.** A percentage implies a measurement with a
defined error, and there is no such thing for _do these two people sound the
same_; the number would look scientific and mean nothing. The caveat is part of
the result, not decoration, and it is tested for — as is the absence of any `%`
anywhere in the output.

Two characters with three lines each will read as similar whatever is true of
them, so the caveat says so when the sample is thin.

Attributes the writer stated are compared too, and reported separately from what
the numbers show: _both described as "blunt" for directness_ is a different kind
of fact from _similar contraction use_.

## Voice check

```
/voice-check CHAR_ELIAS          (equivalent UI action in the Voice panel)
```

Compares a passage against the character's recorded lines and reports where it
departs. It does **not** say the passage is wrong: that is two sets of numbers
differing, and whether the difference is a mistake or a character having a
different kind of night is the writer's call.

Where voice shifts are recorded, the caller should check against the voice at
that point in the book rather than the baseline.

## Context

When a scene is compiled, every speaking character contributes their recorded
voice: stated attributes, shifts already in force, and lines they have actually
said. The POV character gets six examples, everyone else three — enough to hear
a rhythm, not enough to drown the scene the model is meant to be writing.

Shifts already in force are named, so a model reads the change as the voice
rather than as an inconsistency to smooth out.

**Emotional state is not duplicated here.** It is already compiled into the
`storyState` section from scene-anchored transitions, and the compiler consumes
what exists rather than re-deriving it ([STORY_COMPILER.md](STORY_COMPILER.md)).

## For the Dialogue Editor agent

The surface a future Dialogue Editor needs is in place: `characterVoice()` on
the repository returns the voice at a scene; `checkCharacterVoice()` scores a
draft against it; `compareVoices()` answers whether two people have collapsed
into one. All deterministic, all with no model configured.

## Invariants

- No attribute is required, and an unfilled one is absent, not defaulted.
- An example keeps where it came from.
- Voice may change over the book; shifts are scene-anchored and replayed.
- Measurements describe the recorded sample, never the character.
- Nothing is measured against a list the writer did not supply.
- A sample too small to support a statistic produces no finding, and says so.
- Similarity is a band with a caveat, never a percentage.
- A voice check reports departures, not verdicts.
- Everything here runs with no model configured.

## Relationship to other subsystems

- [AUTHOR_VOICE.md](AUTHOR_VOICE.md) — how the _writer_ writes; this is how each
  _character_ speaks. Both reach the model through `styleRules`.
- [STORY_STATE.md](STORY_STATE.md) — the scene-anchored transition shape voice
  shifts borrow, and the source of emotional state.
- [CONTEXT_COMPILER.md](CONTEXT_COMPILER.md) — how voice is delivered, and
  capped.
