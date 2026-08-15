# STORY MAPPING

Reverse story mapping: reconstructing a structured Story Repository from an
existing manuscript — story development in reverse.

- **Packages:** `@jellytind/story-mapper`, driven by the Map Manuscript panel
  and routed through the `manuscript_mapping` operation
- **Status (Phase 40 Part B):** implemented and tested. A persistent,
  resumable pipeline of deterministic extractors and chunked semantic steps;
  proposals with qualitative confidence and evidence; a review workspace with
  batch actions; apply that respects every existing uncertainty vocabulary.

## The premise

A writer who already wrote a novel should get the same Manu a native project
gets: Compiler, Debugger, Refactor, Reader Simulator, agents. That requires
the structured project — characters, locations, scenes, timeline, knowledge,
relationships, threads — to be _reconstructed from the prose_. This is not one
model call (§7); it is a pipeline, and every step of it produces **proposals**
the writer reviews, never quiet canon.

## The pipeline (§8)

Deterministic steps parse the whole book cheaply and first: scene segmentation
from explicit break marks, character extraction with alias resolution,
importance classification, locations, objects. Semantic steps — facts,
timeline, knowledge, relationships, threads, setups/payoffs, causality,
author voice, character voices, summaries — need a model and walk the book
**one bounded excerpt at a time** (24k characters, split at paragraph edges).
The scale test imports a 150k-word, 40-chapter manuscript and proves no call
ever sees the whole book (§43).

Progress persists to `.writer/mapping/` after every chunk: pause, close the
app, reopen, resume exactly where it stopped (§27). With no model configured,
semantic steps are **skipped with a stated reason** and the deterministic
mapping still lands — never guessed, never silent.

## Extraction principles

- **Characters** (§9–§10): candidates come from name patterns and dialogue
  attribution; the role classification argues from appearance span, dialogue
  volume and co-presence — not mention count alone — and says which signals it
  used. Nothing is invented; what the manuscript does not support is absent,
  not fabricated.
- **Entity resolution** (§11): "Mara", "Detective Ellison" and "Ellison"
  resolve to _Mara Ellison_ when exactly one owner fits the evidence. A short
  name two characters could own ("Mara" with both Mara Ellison and Mara Vance
  on the page) becomes a `needs_review` proposal listing the candidates — the
  writer picks; the mapper never guesses.
- **Locations** (§12): recurring places, with hierarchy recorded only where
  the prose states it ("the Library at Blackthorn Manor"). No invented
  geography.
- **Objects** (§13): recurrence plus narrative handling (taken, hidden,
  found, passed) — not an entity for every cup and chair, and the whole list
  arrives as review items.
- **Facts, knowledge, timeline, relationships** (§14–§17): model-derived,
  each with a quote and qualitative confidence. Unknown chronology stays
  unknown; relationships are qualitative, never fake numbers.

## Nothing becomes canon silently

Applying accepted proposals uses the repository's existing uncertainty
vocabulary: model-derived facts land as **provisional**, knowledge transitions
land as **proposed** with source `import` (reviewable in the Knowledge panel),
scene records are created and the chapter's own break marks become scene
markers — under the front matter, never over it. Duplicate statements, threads
and relationships collapse to one record. Causality follows the existing
dependency-review architecture rather than bypassing it (§21). Author Voice is
never overwritten from an import; using a manuscript to update it is an
explicit act (§22).

## The review workspace (§24–§26)

The panel leads with counts per category — confirmed, proposed, needing
review — and opens a queue only when asked. Batch actions handle the obvious
("Accept everything high-confidence", "Ignore minor objects"); ambiguous
aliases offer their candidates as one-click resolutions; every proposal shows
its confidence, origin (parsed vs model) and evidence with quotes. Scope is
stated before mapping starts: words, chapters, estimated model operations and
an estimated cost where pricing is known — an estimate, not a promise (§29).

## Verification

`packages/story-mapper/src/acceptance.test.ts` walks §41 end to end on a
20-chapter fixture novel with POVs, aliases, locations, objects and threads:
DOCX import → mapping → ambiguity correction → batch accept → apply → Story
Build over the mapped project → reopen intact. Separate tests cover
pause/resume across instances, the no-model skip, the §42 export scenario and
the §43 scale run.

## Relationship to other subsystems

- [IMPORT_EXPORT.md](IMPORT_EXPORT.md) — how the manuscript gets in.
- [STORY_STATE.md](STORY_STATE.md) / [CAUSALITY.md](CAUSALITY.md) — the
  vocabularies mapped data lands in, uncertainty included.
- [MODEL_ROUTER.md](MODEL_ROUTER.md) — `manuscript_mapping` is cheap-analysis
  work: high cost sensitivity, parallel-friendly, local-eligible.
- [STORY_COMPILER.md](STORY_COMPILER.md) — the same build runs over a mapped
  project as over a native one, which is the point.
