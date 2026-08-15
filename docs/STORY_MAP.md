# STORY MAP

The visual story-intelligence layer: one coherent system for exploring a
novel's structure — time, knowledge, relationships, causality, threads and
character arcs — over the same entities every other subsystem uses.

- **Packages:** `@jellytind/story-map` (pure view-model layer), rendered by the
  Story Map panel in the desktop app
- **Status (Phase 38):** implemented and tested. Six views over one shared
  context, a Story Point scrubber, diagnostic and story-test overlays,
  search and refactor handoffs, filtered rendering for large projects, and
  layout state that is never canonical story data.

## The premise

By Phase 38 the project can already _answer_ nearly any structural question —
who knows what, what depends on what, when things really happened — but only
textually, one query at a time. The temptation is to bolt a separate
visualisation onto each engine: a timeline widget here, a relationship graph
there, a causality explorer somewhere else, each with its own idea of what a
"node" is.

That is the failure mode this phase exists to avoid. **The Story Map is one
system, not five unrelated graph toys.** There is a single workspace, a single
set of filters, a single time scrubber, and every view is a different lens over
the same story — switching views preserves what you are looking at, because the
thing you are looking at is the same entity everywhere.

## One context, shared IDs

`@jellytind/story-map` defines `StoryMapContext`: scenes, chapters, characters,
locations, events, threads, facts, relationships, dependencies, decisions,
story tests and state transitions, plus the live `StoryTimeline` and
`StoryChronology` engines. It is deliberately a **structural subset of the
repository's existing build context** — the desktop panel passes
`repo.getBuildContext()` straight in. There is no story-map entity store, no
graph-side copy of a character, no ID translation layer. A node on the map _is_
`CHARACTER_0003`, and clicking it opens the same character every other panel
opens.

The package itself is pure: it computes view models from a context and never
touches disk, models or the repository. Everything below is a plain function.

## The Story Point scrubber

Most of the interesting questions are "…at this moment?" questions, so the map
is scrubbed by a **Story Point** — `{ sceneId, position: "before" | "after" }`,
which is exactly story-state's `StateBoundary`. Chapter anchors resolve the way
Story Tests resolve them: "before Chapter 10" is before that chapter's first
scene, "after Chapter 10" after its last.

Because the scrubber speaks the reconstruction engines' native vocabulary,
every state query — knowledge, relationship dimensions, thread status,
character location — is answered by the same `StoryTimeline` the State and
Knowledge panels use, at the chosen moment. Scrubbing backward makes later
acquisitions genuinely disappear; there is no separate map-side approximation
of history.

`storyPointStops` enumerates the scrub positions in presentation order;
`describeStoryPoint` renders them as prose ("Before Chapter 10", "After
Scene 42") because writers think in befores and afters, not indices.

## The six views

All view models live in `src/views.ts`; the panel only draws them.

| View              | Function                                       | What it shows                                                                                                                                                                                                                                                                                        |
| ----------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Timeline**      | `timelineView`                                 | Presentation order against story chronology. A scene is a flashback when its chronological rank falls below the running maximum in presentation order — derived, never guessed. Historical events and parallel character lanes included; contradictory orderings surfaced from `contradictorySet()`. |
| **Knowledge**     | `factKnowledgeView` / `characterKnowledgeView` | For a fact: who is KNOWN / BELIEVED / UNKNOWN at the Story Point, with source and acquisition scene. For a character: their whole information world at that moment.                                                                                                                                  |
| **Relationships** | `relationshipView`                             | Edges labelled with qualitative state (status, dimensions like trust: low) at the Story Point, with the key scenes where each relationship changed. No numeric affinity scores.                                                                                                                      |
| **Causality**     | `causalityView` / `blastRadiusView`            | Expand prerequisites and consequences around a focus entity to a chosen depth; the blast radius reuses `CausalityGraph.calculateBlastRadius` verbatim.                                                                                                                                               |
| **Plot threads**  | `threadView`                                   | A strip per thread across the chapters: introduced, advanced, dormant span, resolved. Dormancy is the gap between touched chapters, computed, not annotated.                                                                                                                                         |
| **Character arc** | `characterArcView`                             | Qualitative milestones in presentation order — moves, status changes, learnings, relationship events, decisions. Deliberately **not** a numeric chart; character psychology does not get a y-axis.                                                                                                   |

Visual restraint is a requirement, not a taste: the views use the Manu token
palette, meaning comes from position and shape, and nothing defaults to
arbitrary rainbow colours.

## Overlays and handoffs

Overlays are optional and off by default, because a map that shouts every
diagnostic is a map nobody opens:

- **Diagnostics** (`diagnosticOverlay`) marks scenes and entities that carry
  problems from the latest build, with counts, not walls of text.
- **Story tests** (`storyTestOverlay`) draws each test's scope span using the
  compiler's own `resolveScope`, with failures marked at the failing point.
- **Search** (`searchStrip`) is how "Show on Story Map" in Find in project
  works: the hits' scenes, arranged on the timeline.

The map is also the target of the phase's signature interaction: **Restructure
→ "Visualise impact on the Story Map"** opens the causality view focused on
the refactor's target, showing the blast radius of the change being
contemplated. Both handoffs travel through workbench state (the same pattern
as the Debugger's seeded question) — a panel asks the Workspace to open the
map with a focus, and the map takes it from there. Clicking any node offers
the reverse trip: open the scene, the character, the thread.

## Scale and persistence

A 200k-word novel must not render every fact simultaneously (§18). The panel
clamps drawing to 160 scenes with a "filter to see the rest" notice, caps
character lanes at eight unless the writer filters explicitly, and caps the
causality expansion at 400 nodes. Filters — characters, chapters, threads —
default to clean, useful views rather than everything-at-once.

View choice and overlay toggles persist in `localStorage`
(`"manu.story-map"`). **Nothing the map stores is canonical story data** —
deleting its saved state loses a preference, never a fact. Export exists where
it is straightforward ("Copy as SVG") and is deliberately minimal.

## Verification

`packages/story-map/src/story-map.test.ts` builds the §21 acceptance fixture —
ten chapters, twenty scenes, six characters, four locations, four plot threads
(one deliberately dormant for chapters 4–8), fifteen facts, knowledge
transitions, relationship changes and a four-link dependency chain — and walks
the spec's eleven verification steps: flashback detection, knowledge at a
moment from both directions, backward scrubbing, relationship state with key
scenes, blast radius, thread dormancy, arc milestones, filters and overlays.
