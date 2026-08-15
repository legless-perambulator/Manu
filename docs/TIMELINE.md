# TIMELINE

The Story Timeline Engine: the distinction between the order a story is
**presented** and the order it **happens**.

- **Packages:** `@jellytind/domain` (story time vocabulary),
  `@jellytind/story-state` (chronology + checks), persisted by
  `@jellytind/story-repository`
- **Status (Phase 13):** implemented and tested. Story time at six precisions,
  temporal relations, a scene and event chronology, character timelines,
  chronological state replay, deterministic contradiction checks, temporal
  context, and the Timeline panel.

## The premise

A manuscript has an order — chapter 1, then chapter 2 — and the story world has
a chronology, and **they are not the same sequence**. A flashback is presented
third and happens first. Two chapters may cover one afternoon from different
points of view. A murder happens forty years before the book opens and is never
on the page at all.

Treating chapter order as chronological truth is the assumption that makes
continuity checking useless for anything but the simplest linear novel. So the
project carries two orderings over the same material:

| Ordering                      | Where it lives                       | Answers                                      |
| ----------------------------- | ------------------------------------ | -------------------------------------------- |
| **Manuscript / presentation** | `orderScenes` in `@jellytind/domain` | "what has the reader been told by now?"      |
| **Story-world chronology**    | `StoryChronology`                    | "what was true in the world at that moment?" |

Neither replaces the other. Phase 10's `StoryTimeline` still replays state in
manuscript order — that is the right answer for drafting continuity — and the
chronology gives it a second scene order when the question is about the world
rather than the reader.

## Story time

Every scene and event may carry a `storyTime`. All of it is optional, and no
precision is privileged:

```ts
{ kind: "exact",       instant: "1997-08-14T22:00:00Z" }
{ kind: "date",        date: "1997-08-14" }
{ kind: "approximate", earliest?, latest?, label: "the summer of the fire" }
{ kind: "relative",    anchorId: "EVENT_0001", relation: "after", offset: { days: 3 } }
{ kind: "ordinal",     label: "Day 3, evening" }
{ kind: "unknown" }
```

**Real calendar dates are never required.** A story ordered entirely by "this
happens before that" is a complete, checkable chronology; a story timestamped to
the minute gets contradiction checking on top. Adoption can be gradual, and a
project that never states a single date is not a degraded case.

Precision is modelled rather than flattened because checks depend on it. A
`date` bounds a whole day, an `exact` bounds one instant — which is exactly why
"14:00 in London, 14:05 in Edinburgh" is checkable and "the 14th in London, the
14th in Edinburgh" is not, and must not be reported as an error.

`duration` is likewise optional on both scenes and events, and may be
unquantified: `{ label: "most of the night" }` is a real answer that renders and
travels but takes no part in arithmetic.

### Legacy story time

Events used to carry story time as free text. It is **interpreted on read**, not
discarded: a bare string becomes an `ordinal` time labelled with the original
words, or a `date`/`exact` time where it plainly is one. No project is rewritten
and none loses its timeline on upgrade.

## Temporal relations

```ts
"before" | "after" | "during" | "overlaps" | "same_time" | "approximately_before";
```

A `TemporalLink` records one authored statement that two nodes stand in some
relation, optionally with a known `gap`. Links are canon and carry the same
`confirmationStatus` discipline as story-state transitions: a model may
_propose_ that two scenes are simultaneous without that becoming the story's
chronology. They live in `.writer/state/timeline.json` and go through the
journaled store, so changing the chronology is as revertible as changing prose.

`approximately_before` is deliberately soft: it orders the display, and a
timestamp that disagrees with it produces a warning rather than an error.

## How the order is decided

Strictly, in this precedence:

1. **explicit temporal relations**
2. **resolved absolute story time**
3. **manuscript presentation order**

The third is a tie-break, not a claim. Two refinements make it behave the way a
writer expects:

- **Undated material stays where it was put.** An undated node inherits the last
  dated position before it in the manuscript, so dated scenes move to where they
  belong while everything else keeps its neighbourhood.
- **The rearrangement is minimal.** A node's sort key is lowered to the earliest
  key of anything it must precede. Given only "scene 3 before scene 1", the
  honest reading is 3, 1, 2 — not 2, 3, 1, which is what a naive topological
  sort produces because scene 2 happened to become available first.

Ordering is a topological sort over the relation graph with that key as the
tie-break, so it is total and reproducible for a given project state.

### Resolved intervals

Constraints propagate to a fixed point. A scene stamped `14:00` pins itself; an
event declared "three days after" it inherits a pin; a scene linked `before` that
event inherits an upper bound. Every inherited bound is marked `inferred`, so a
check can tell a writer's timestamp from the system's arithmetic.

An unquantified `after` yields a lower bound and **no** upper bound. Inventing
one would be the system making up story time nobody gave it.

### Contradictions do not break the view

A cyclic set of relations has no valid ordering. Rather than throwing — a writer
mid-edit will produce contradictions, and an unusable timeline is not a helpful
response — the nodes are appended in key order and reported through
`contradictorySet()` for validation to explain.

## Events

An event is not tied to the manuscript. It may be dramatised inside a scene,
happen off the page between two scenes, span a range, or predate the book by
decades. `sceneId` is therefore optional, and an event without one has **no
presentation position** — which is not a defect, it is what "off-page" means.

## Queries

```ts
chronology.chronologicalOrder(); // the story's own sequence
chronology.presentationOrder(); // the reader's sequence
chronology.isFlashback(SCENE_0003); // presented after material that happens later
chronology.simultaneousWith(SCENE_0001); // parallel / overlapping material
chronology.intervalOf(SCENE_0001); // resolved bounds, and whether inferred

repo.getCharacterTimeline(CHAR_ELIAS); // one life, in the order it was lived
repo.getEventsForCharacter(CHAR_ELIAS);
repo.getCharacterLocationAtTime(CHAR_ELIAS, { kind: "instant", instant: "2018-01-01T00:00:00Z" });
```

`simultaneousWith` counts two ways to be at once, and both are legitimate: an
explicit `same_time`/`overlaps` relation is how a writer with no calendar says
"meanwhile", and genuinely overlapping resolved intervals is how a timestamped
project says it without being asked.

### Chronological state

`chronology.stateTimeline(transitions)` builds a `StoryTimeline` whose scene
order is the chronology rather than the manuscript. This is the payoff of the
subsystem: the same replay machinery, asked a different question.

```
manuscript replay  → what had the reader been told by chapter 12?
chronological replay → what was true in the world at that moment?
```

A flashback makes those two different answers, and
`getCharacterLocationAtTime` uses the second.

## Validation

`checkTimeline({ chronology, links, travel })` — deterministic, no model:

| Kind                        | Severity | Meaning                                            |
| --------------------------- | -------- | -------------------------------------------------- |
| `contradictory_relations`   | error    | relations form a loop; nothing satisfies them all  |
| `relation_contradicts_time` | error\*  | a stated relation is refuted by the recorded times |
| `impossible_interval`       | error    | constraints leave a node no possible moment        |
| `character_bilocation`      | error    | one character pinned to two places at one moment   |
| `impossible_travel`         | error    | a declared journey does not fit the gap            |
| `event_outside_scene`       | warning  | an event's time falls outside the scene it is in   |
| `dangling_relation`         | warning  | a relation names something not on the timeline     |

\* warning when the relation is `approximately_before`.

### Travel times are declared, never assumed

The specification's example is a character in London at 14:00 and Edinburgh at
14:05. The system does **not** know that is impossible: the story may be set in
1840, in 2140, or on a world where the two are a door apart. So:

- **Bilocation** needs no assumption — one body, two places, one moment — and is
  checked wherever both moments are pinned precisely enough that no reading can
  separate them. Two scenes on the same _date_ in different cities are never
  flagged.
- **Impossible travel** is checked only against a `TravelRule` the writer has
  declared between two locations. With none declared, no travel violation is
  ever reported. That is deliberate, not a gap.

The check uses the most generous gap the recorded times allow, so it fires only
when the journey is impossible under the writer's own declaration.

## Temporal context

The Context Compiler adds three things to the `storyState` section for a target
scene ([CONTEXT_COMPILER.md](CONTEXT_COMPILER.md)):

| Element                                                               | Rule              |
| --------------------------------------------------------------------- | ----------------- |
| where the scene sits in story time, and whether it is out of sequence | `story_time`      |
| events the story world has already reached by then                    | `preceding_event` |
| material occupying the same moment                                    | `concurrent_node` |

**The future is excluded by default.** A flashback sits early in the story world
and late in the book, so its manuscript neighbours are its future; handing its
drafting context the events that surround it _in the manuscript_ would quietly
write the ending into the beginning. Forward-looking events are included only
when a caller passes `includeFuture`, and when they are, the rendered text says
plainly that they have not happened yet. That is the "unless intentionally
requested" clause made explicit rather than assumed.

## The Timeline panel

The desktop app's **Timeline** tab draws lanes across ranked positions:

- toggle between **story order** and **manuscript order** — the difference is
  the information
- layer by **characters**, **locations** or **plot threads**, filtered to one or
  showing everything
- flashbacks and nodes with violations are marked in the chart
- click a node to inspect it: story time, both positions, location, cast,
  simultaneous material, and any contradiction it is part of
- set a scene's story time at any precision, and record relations between nodes
- the full contradiction list, with the reminder that travel times are declared

Positions are **ranks, not a scaled clock**. Most projects carry no calendar at
all; a chart that needed one would be empty for them, and the ordering is
exactly as true without it.

## Relationship to other subsystems

- [STORY_STATE.md](STORY_STATE.md) — the chronology supplies an alternative
  scene order to the same replay engine. State is still transitions; nothing is
  cached.
- [DOMAIN_MODEL.md](DOMAIN_MODEL.md) — `StoryTime`, `StoryDuration`,
  `TemporalRelation`, `TemporalLink` and `TravelRule` are domain vocabulary, so
  the compiler, the repository and the UI all agree on them.
- [CONTEXT_COMPILER.md](CONTEXT_COMPILER.md) — temporal context, with the
  no-future-leakage guarantee.
- [STORY_COMPILER.md](STORY_COMPILER.md) — `checkTimeline` is the reusable
  foundation for the "Timeline valid" line in a story build.
- [STORY_MAP.md](STORY_MAP.md) — the Story Map's timeline view draws both
  orderings side by side and derives flashbacks from the chronology's ranks.

## Invariants

- Chapter order is never treated as chronological truth.
- Real calendar dates are never required; relations alone are a chronology.
- Precision is preserved, never flattened — a date is a day, not an instant.
- Nothing is inferred about how the world works: travel times are declared.
- Chronologically future material never reaches an earlier scene's context
  unless explicitly requested.
- Ordering is deterministic and reproducible for a given project state.
- A contradictory chronology still renders; it reports rather than fails.
