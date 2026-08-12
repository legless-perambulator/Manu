# CONTEXT_COMPILER

The Context Compiler constructs the best possible working context for every AI operation. It is one of the core pieces of intellectual infrastructure in the product.

- **Package:** `@jellytind/context-compiler`
- **Depends on:** `@jellytind/domain`, `@jellytind/search`, `@jellytind/shared`
- **Status (Phase 8):** **V1 implemented and tested.** The `ContextPackage`, provenance model, token budget with prioritised degradation, three explicit recipes, package rendering and the Inspect Context UI are built. Semantic retrieval, hierarchical summaries and story-state sources are **PLANNED**.

## Principle

Conventional RAG is **not** the central intelligence architecture — it is one retrieval subsystem among many. The compiler does not blindly dump a 150,000-word manuscript into context. It assembles a task-specific, explicit, inspectable working set.

**Every model operation obtains its context from here.** An operation states _which recipe_ and _which target_; it does not read project files and paste them into a prompt. That is the acceptance test for this subsystem, and the reason to build it before drafting and rewriting exist.

## The context package

```ts
interface ContextPackage {
  task: string;
  target?: { id; kind; label };
  sections: ContextSection[];
  metadata: ContextMetadata;
}
```

Sections are fixed and ordered, so two packages are comparable at a glance:

```
task · target · primaryText · adjacentScenes · characters · locations
plotThreads · styleRules · worldRules · additionalRetrievedContext
```

Each `ContextItem` carries its `id`, `kind`, `label`, rendered `text`, the
`priority` that decided its fate under budget, how much of it survived
(`rendering`), its token cost, and its **provenance**.

## Provenance

Every element knows why it is there:

```ts
interface Provenance {
  rule: SelectionRule; // machine-readable, e.g. "participant_character"
  reason: string; // what a user reads
  via?: string[]; // the IDs that led here
}
```

Rendered in the inspector — and, by default, in the text handed to the model:

```
CHAR_0002 — Elias
included because: participant in SCENE_0042
```

`via` records the chain, so any element can be traced back to the target that
pulled it in. Provenance is not decoration: it is what makes a compiled context
debuggable instead of a black box.

## Recipes

Different tasks need different context. **There is deliberately no universal
recipe** — a scaled-up one-size strategy is exactly the failure this subsystem
exists to prevent.

### Scene inspection

Understand one scene as it stands.

| Retrieved                           | Provenance rule         |
| ----------------------------------- | ----------------------- |
| the target scene                    | `target_entity`         |
| prose of its chapter                | `target_prose`          |
| the previous scene                  | `previous_scene`        |
| the next scene                      | `next_scene`            |
| the POV character                   | `pov_character`         |
| the participating characters        | `participant_character` |
| the location                        | `scene_location`        |
| the linked plot threads             | `linked_plot_thread`    |
| world rules that constrain the work | `world_rule`            |

All of it is reached by following the scene's own references, so selection is
deterministic and explainable.

### Scene rewrite

Everything scene inspection gathers, **plus** what a rewrite must not violate:

| Retrieved                                                       | Provenance rule   |
| --------------------------------------------------------------- | ----------------- |
| author style material (`style/`)                                | `style_rule`      |
| voice material for the characters who speak (`style/examples/`) | `character_voice` |

The recipe _composes_ scene inspection rather than restating it, and the extra
cost of style and voice material is paid only when the task calls for it. Voice
material is matched deterministically: a `style/examples/` file belongs to a
character when its path names the character's ID or name. A character's own
`notes` field — where a writer records voice — already travels with the character
rendering.

### Chapter inspection

| Retrieved                                               | Provenance rule                 |
| ------------------------------------------------------- | ------------------------------- |
| the chapter and its prose                               | `target_entity`, `target_prose` |
| the chapter's scenes                                    | `chapter_scene`                 |
| a summary of the previous chapter                       | `previous_chapter`              |
| a summary of the next chapter                           | `next_chapter`                  |
| the characters involved, with the scenes they appear in | `chapter_character`             |
| plot threads still active in those scenes               | `chapter_plot_thread`           |

Note what this recipe **does not** do: it never pulls the neighbouring chapters'
prose. At chapter scope that would be three chapters of manuscript to answer one
question. Neighbours arrive as summaries — which is precisely why it is a
separate recipe.

Stored hierarchical summaries do not exist yet, so a neighbour's summary is
derived deterministically from structure (title, status, scene titles) and
labelled `(derived summary)` so it can never be mistaken for authored canon.
When stored summaries land, they replace the derived digest behind the same
provenance rule.

## Token budget

```ts
interface ContextBudget {
  maxTokens: number;
  reserveForOutput?: number; // held back for the model's reply
}
```

Selection runs over `maxTokens − reserveForOutput`, so a package can never crowd
out the response. Candidates are sorted by priority band:

```
essential(0) → primary(10) → adjacent(20) → involved(30)
→ threads(40) → rules(50) → style(60) → retrieved(70)
```

### Nothing is silently truncated

When an element does not fit, it is **degraded through declared steps**, never
chopped:

1. **full** — the complete rendering.
2. **summary** — a deterministic structural digest (a character becomes
   `CHAR_0001 — Mara (protagonist); status: active`). Prose has no structural
   digest, so it becomes an opening excerpt whose label states how much was
   omitted, _inside the text the model reads_.
3. **reference** — identity only: `SCENE_0003 — Aftermath [content omitted: context budget]`.
4. **excluded** — recorded, not present.

Every step below `full` produces a `BudgetNote` in the metadata giving the
element, its provenance, what it would have cost, what it did cost, and the
reason. The rendered context also gains a `CONTEXT NOTES` block telling the model
that detail is missing — so absent information is never mistaken for information
absent from the project.

The task and its target are **required**: under an impossible budget the package
includes them anyway and reports `withinBudget: false`, rather than returning
something useless.

Token counts are estimates (`characters/4` by default) and are labelled as such
in `metadata.tokenEstimator`. A caller with a real tokeniser injects one; the
budget arithmetic is unchanged.

## Pinned context

User pins sit directly below the task and above everything the recipe chose. A
writer overriding the compiler's judgement is the one signal it should never
budget away.

## Deterministic first

Selection is driven by the project's own relationships and structured queries,
never by asking a model what to read:

- entity references (scene → POV, participants, location, threads)
- narrative adjacency, derived once in `sequence.ts` so every recipe agrees
- chapter membership and ordering
- world rules ranked by severity (`hard` before `soft` before `style`)
- authored style and voice files, matched by path

The ordering is total (priority, then section, then ID), so compiling the same
request against the same project state twice yields an identical package — a
property the tests assert directly, including under a reader that returns
entities in a different order.

Semantic retrieval augments this later, behind the `SemanticSearchProvider`
abstraction ([SEARCH.md](SEARCH.md)); the deterministic layer is the foundation,
not a fallback.

## Story state and knowledge

The `storyState` section carries reconstructed state at the target's **entry
boundary**, and — separately — the information picture the operation needs:
false beliefs held by anyone in the scene, information asymmetries among the
cast, and everyone's position on the facts the scene itself references.

Selection is the point. Dumping every fact every character holds would defeat the
compiler; these three are chosen because an operation is _wrong_ without them —
a model that does not know a character is meant to be mistaken will quietly
correct them. See [STORY_STATE.md](STORY_STATE.md).

## Rendering

`renderContextPackage(pkg)` turns a package into the text a model call receives —
sectioned, with each element's provenance annotated inline. It is a pure function
of the package, so what the inspector shows and what the model reads cannot
drift apart.

## Inspect Context

The desktop app's **Context** tab compiles any recipe against any scene or
chapter at a chosen budget and shows:

- every selected element, grouped by section, with `included because: …`
- token cost per element, and what the budget did to it
- the budget decisions list — everything summarised, referenced or excluded
- the exact compiled text a model would receive

This is the debugging surface for the subsystem and the honest answer to "what
did the AI actually see?".

## Inputs (full set, as the subsystem grows)

Implemented: entity references · scene/chapter adjacency · plot threads ·
character participation · locations · world rules · style and voice material ·
user-pinned context · derived structural summaries · story state at a named
boundary · character knowledge, false beliefs and information asymmetries.

Planned: reader knowledge · timeline proximity · foreshadowing · pacing · scene
specifications · stored hierarchical summaries · semantic search.

## Relationship to other subsystems

- Reads from the [Story Repository](STORY_REPOSITORY.md) through a narrow
  `ProjectReader` port, which the repository satisfies structurally. This is
  deliberately a _different, smaller_ interface from the agent runtime's
  `ProjectAccess`: each consumer states exactly what it needs.
- Serves the [Agent Runtime](AGENT_RUNTIME.md) and inline AI — **inline AI must
  also use the Context Compiler** and must not become a disconnected miniature
  chatbot.
- Its output feeds model calls routed by the [Model Router](MODEL_ROUTER.md).

## Invariants

- Never load the whole manuscript by default.
- No universal recipe; each task type declares what it needs.
- Every compiled element is attributable, with a reason a user can read.
- Nothing is silently truncated; every degradation and exclusion is recorded.
- The task and its target are always present.
- Selection is deterministic and reproducible for a given project state.
- Summaries and derived retrieval never override confirmed canon.
