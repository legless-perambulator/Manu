# PLANNING

The structured layer between an outline and prose: chapter plans, scene plans
and beats — Manu's genuine intermediate representation (Phase 32).

- **Packages:** `@jellytind/domain` (`ChapterPlan`, `PlannedScene`, impact,
  version comparison), `@jellytind/story-repository` (`ChapterPlanStore`,
  validation, approval), `@jellytind/editing` (`PlanArchitect`),
  `@jellytind/agent-runtime` (the four plan tools)
- **Status:** **Implemented and tested.** Manual planning, structured
  generation, deterministic validation, review and approval, plan-vs-draft
  comparison, and direct consumption by the Chapter Builder. Above chapter
  plans sit act plans — goals that span chapters — consumed by the Act
  Builder ([ACT_BUILDER.md](ACT_BUILDER.md)).

## The shape

```
outline / narrative intention
        ↓
   ChapterPlan            plot/plans/CHAPTER_XXXX.json — a plain project file
        ↓
   PlannedScene[]         beats, POV, objective, conflict, knowledge changes
        ↓  (approval materialises scene records)
   Chapter Builder        drafts scene by scene from the approved version
```

Manu never improvises the shape of a chapter while simultaneously drafting
prose: shape is decided here, reviewed here, validated here — and only then
handed to the builder.

## The plan is a proposal

A plan is `draft` until the writer approves it. Nothing reads a draft: not the
builder, not the compiler, not context. **Approval** is the one transition
that matters — it materialises planned scenes into ordinary scene records
(through `addScene`/`updateEntity`, so IDs, validation and journaling all
apply), stamps the plan `approved`, and pins `approvedVersion`, the single
number the builder holds on to. There is deliberately **no agent tool that
approves a plan.**

## Progressive structure

Nearly every field is optional. The quick plan (§11) —

```
POV · Goal · Conflict · Outcome
```

— is a complete plan, and everything downstream works from it. Beats are plain
ordered strings: reorderable, editable, never screenplay micro-structure. The
deep fields (entry/exit state, revelations, knowledge changes, relationship
movement, setups, payoffs, required facts, word targets, transition intent)
are there for the writers who want them, and deep planning does **not**
require using the Chapter Builder (§12).

## Constraints are structural

"Mara must discover the key but must not yet understand what it opens" becomes
two records: a `knowledgeChange` (the discovery) and a `forbiddenFacts` entry
(the withholding). The constraint is then enforced three times over:

1. **Validation** refuses a plan whose own scenes grant a forbidden fact.
2. **Approval** carries it into the materialised scenes' plan.
3. **The builder** resolves it to sentences and puts it in every drafting
   instruction as a hard constraint.

## Deterministic validation (§6)

`repo.validateChapterPlan(plan)` inspects the plan against the project before
anything is drafted:

| Finding                  | Severity | Meaning                                                           |
| ------------------------ | -------- | ----------------------------------------------------------------- |
| `unknown_reference`      | error    | The plan names an entity the project does not contain             |
| `forbidden_fact_granted` | error    | The plan grants knowledge its own constraints forbid              |
| `revelation_unavailable` | error    | The planned source does not hold the information at chapter entry |
| `payoff_without_setup`   | error    | Nothing planted the setup — in the book or earlier in the plan    |
| `setup_already_paid`     | warning  | The setup is already paid off elsewhere                           |
| `object_elsewhere`       | warning  | The object is recorded at another location at chapter entry       |
| `pov_not_present`        | warning  | The POV character is not among the scene's characters             |
| `character_elsewhere`    | info     | The character was last recorded somewhere else                    |
| `empty_plan`             | warning  | No scenes yet                                                     |

"Entering the chapter" is a real boundary: the last scene, in telling order,
of any earlier chapter — the same state machinery every other subsystem uses.
Semantic judgement about whether the plan is _good_ is not validation's
business.

## Impact (§7)

`planImpact(plan)` reads what the chapter claims to do — threads advanced,
setups introduced, setups resolved, knowledge touched — deterministically off
the plan's own references. Whether the prose delivers is a different question,
answered by coverage.

## Generation (§4) and review (§5)

`PlanArchitect.proposeChapterPlan({chapterId, instruction})` compiles the
chapter's context, names the adjacent chapters, and asks a reasoning model for
a structured plan against a schema. Everything comes back filtered: **an ID
the project does not contain never enters the plan** — it is set aside into
the plan's notes, visibly. The proposal is saved as a draft with
`source: "model"` and validated immediately, so review starts informed.

Review is ordinary editing: the panel supports edit, reorder, add, remove,
split, merge — each an ordinary journaled save. A generated plan the writer
edits becomes `source: "mixed"`; the provenance is never lost.

## Versions (§16)

Every save bumps `version` and keeps a bounded structured snapshot (ten), so
v3 and v4 compare **structurally** — scenes added/removed/reordered, per-scene
field changes in plain words (`comparePlanVersions`). Underneath, the plan
file is journaled like any project file, so the byte-level history rides the
existing revision architecture; no branch semantics were built for plans.

## Plan vs draft (§8)

After drafting, `PlanArchitect.comparePlanToDraft(chapterId)` judges each
planned element against the committed prose: `covered`, `partially_covered`,
`missed` — plus the **unexpected but potentially useful**, listed rather than
lost. Every verdict carries `source: "model"`; word-for-word adherence is not
required, and accepting deviation is the writer's call.

## The agents (§13–14)

Story Architect and Scene Director carry the `edit_plans` permission and four
typed tools:

```
inspect_scene_plan · validate_scene_plan        (read)
create_scene_plan · revise_scene_plan           (draft writes)
```

Their output is structured plan data, not prose advice. Draft writes only:
the tools refuse to touch an approved plan, and approval itself has no tool.

## The builder (§15)

`ChapterBuilder.start` consumes the approved plan directly: it pins
`planId`/`planVersion` on the build record, takes per-scene word targets from
the plan, and carries the plan's constraints (forbidden knowledge resolved to
sentences) into every drafting instruction. The scene records it drafts from
are the ones approval materialised — one representation, no duplication in
the workflow engine. A draft plan is noted and ignored.

## The UI (§9–10)

The **Chapter plan** panel lives in the Write group of the workbench, beside
Outline and the manuscript — dockable, movable, usable in any arrangement.
Manual first: scenes, quick fields, beats, reorder/split/merge, Check the
plan, the impact summary, and Approve all work with no model configured.
"Draft a plan with Manu" is one disclosure among the writer's tools.

## Invariants

- A plan is a proposal until the writer approves it; nothing reads a draft.
- Approval is the writer's alone — no agent tool, no auto-approval.
- Generated content is filtered against the project; unknown IDs are set aside visibly.
- Validation is deterministic; coverage is model judgement and labelled as such.
- Plan history rides the ordinary journal; structured snapshots are bounded.
- The builder consumes the exact approved version, pinned by number.

## Relationship to other subsystems

- [CHAPTER_BUILDER.md](CHAPTER_BUILDER.md) — what consumes an approved plan.
- [ACT_BUILDER.md](ACT_BUILDER.md) — the act plans above chapter plans, and
  the workflow that confirms, consumes and re-proposes chapter plans.
- [STORY_STATE.md](STORY_STATE.md) — the state validation reads at the chapter's entry.
- [SPECIALIST_AGENTS.md](SPECIALIST_AGENTS.md) — the two agents that operate on plans.
- [VERSIONING.md](VERSIONING.md) — the journal every plan save rides.
- [CONTEXT_COMPILER.md](CONTEXT_COMPILER.md) — where generation's context comes from.
