# BOOK_BUILDER

Manu's novel-scale production pipeline: "/write-book" as a persistent,
recoverable, hierarchical build (Phase 34).

- **Packages:** `@jellytind/domain` (`BookPlan`, `BookBuild`, the report),
  `@jellytind/story-repository` (`BookPlanStore`, `BookBuildStore`,
  validation, book-goal evaluation), `@jellytind/editing` (`BookBuilder`)
- **Status:** **Implemented and tested.** The book plan at the top of the
  planning hierarchy, the per-act pipeline over the Phase 33 Act Builder,
  gate forwarding from any depth, quality gates, restart/rate-limit/failure
  recovery, mid-build model changes with provenance, the Write book
  dashboard, and the draft-build report. Rewrite and editing-pass build
  variants are **declared, not built** (§26).

## The principle (§32)

```
Traditional AI:  prompt → novel-sized completion attempt

Manu:            plan → context → scene → validate → state → checkpoint → continue
```

A book build never asks a model for a book — or an act, or a chapter. It
coordinates act builds, which coordinate chapter builds, which draft one
scene at a time from freshly compiled, budget-bounded context. Hundreds of
model operations, every transition decided by the harness, every step
persisted. **The harness creates scale.** No step anywhere assumes the
manuscript fits a context window.

## The hierarchy (§1, §5)

```
Book intent   BookPlan          plot/book.json — one per project
     ↓
Act intent    ActPlan[]         plot/acts/ACT_XXXX.json
     ↓
Chapter intent ChapterPlan[]    plot/plans/CHAPTER_XXXX.json
     ↓
Scene intent  PlannedScene[]    materialised scene records
     ↓
Prose         the manuscript    ordinary Markdown, ordinary change sets
```

The book plan **names** its acts; it does not contain them. Each level is
planned, versioned, validated and approved at its own level — nothing is
flattened into one giant outline prompt. The book plan carries the whole-book
material: premise, story goal, genre, target length (guidance, never a quota —
§23), opening and target ending state, the act list with per-act intent,
major plot threads, character arcs ("guarded → trusting → betrayed →
reconciled"), relationship arcs, themes, promises to the reader, constraints,
and book-scoped story tests. Almost everything is optional.

Like every plan: a proposal until the writer approves it, versioned in place
with bounded snapshots, journaled. **Plan evolution** (§6) is the layers'
existing machinery — completed prose changes state; future chapter plans are
re-validated inside acts, future act plans between acts; stale plans pause or
are re-proposed for review; completed work is never rewritten for it.

## Book-level state and goals (§7–8)

Story State remains the single authority: the book build records **progress,
never state**. Completed chapters update canon through ordinary confirmed
transitions and future builds read it back — there is no private book-build
state anywhere.

`repo.evaluateBookGoals(plan)` is the act-goal engine run over every chapter
of every act the book names: thread goals, arc goals (with knowledge hooks),
relationship goals (with dimension hooks) — deterministic where a hook
exists, honestly `not_evaluated` where the goal is the author's intent.
Re-run after every act, so the dashboard always shows the goals' standing.

**Book story tests** (§9) are ordinary Story Tests — "killer identity not
exposed before Chapter 38" is a `before`-scoped assertion, "Mara alive until
the final act" a `between`. The full suite runs at every chapter commit, at
every act's end, and at the book's finish, where the report counts it.

## The pipeline (§4)

```
validate the Book Plan → pre-build checkpoint → inspect opening
for each act, in telling order:
  confirm the act plan        (draft → gate; approved → re-validated now)
  run the Act Builder         (the whole Phase 33 pipeline, as a child)
  evaluate book progress      (goals from recorded state)
  quality gates (§18)         (compiler errors / hard-test failures pause)
  re-validate future act plans (§6)
  [gate under every_act] → checkpoint
assemble → full Story Compiler → Story Tests → coverage → Build Report
```

## Approval policies (§10–11)

| Policy             | Who gates                                         |
| ------------------ | ------------------------------------------------- |
| `every_scene`      | every drafted scene is held for the writer        |
| `every_chapter`    | after each chapter                                |
| `every_act`        | after each act, and once at the end               |
| `auto_until_error` | nobody — errors, failures and stale plans stop it |
| `autonomous`       | as auto, and Manu arrives with proposals (§11)    |

One choice fans out down the hierarchy, and **every gate anywhere is
answered at the book level**: a scene gate is raised by the chapter build,
forwarded through the act build (`chapter_gate`), surfaced on the book build
(`act_gate`) verbatim — and the answer travels back down the same chain.
One gatekeeper, one conversation.

`autonomous` is not "ignore the writer". It is `auto_until_error` with
proposals: missing chapter plans are drafted for review, stale plans arrive
re-proposed. It still stops for **every plan approval** (always the
writer's), every error, every failed quality gate — with validation,
checkpoints, audit and cancellation fully active.

**Quality gates** (§18) are configurable per build: pause on Story Compiler
errors after an act (default on), pause on failing error-severity story
tests (default on), and the bounded repair limit (§19) — `maxSceneRepairs`,
default 2 — which becomes every chapter build's revision bound: repair
attempts are counted, and past the limit the build pauses and surfaces the
issue rather than looping.

## Long-running execution (§12–14)

The `BookBuild` record in `.writer/builds/book/` is written after every
book-level step, and the act and chapter records below it after theirs. A
build spanning hours and many application sessions resumes exactly where it
stopped: reopening Manu shows the paused build — completed acts, current
chapter, the open gate — with Resume, Inspect and Cancel (§13). Nothing
regenerates because a process restarted; a scene interrupted mid-draft is
re-queued, never skipped, and never duplicated (§28 — this phase's failure
injection caught and fixed exactly that gap in the chapter builder's resume).

**Provider failure is a pause, not corruption** (§14): a rate limit or
dropped connection pauses the build with the diagnosis on the record; Resume
retries from the exact scene reached.

**Models may change mid-build** (§15): on resume the assignments are
refreshed and recorded — future operations use the new model, earlier
chapters keep their provenance in ordinary history (every change set carries
its `modelId`), and nothing is regenerated for the change.

**Manual writing mid-build** (§16) needs no machinery: pause, rewrite a
chapter by hand, resume. Context is compiled from the current project at
every draft, so human prose is simply what later scenes grow from — a
co-production pipeline, not an AI-owned manuscript.

**Branch-first experiments** (§17): the start screen recommends building a
risky autonomous run on a separate version, using the existing branching
architecture. Recommended, never forced.

## The dashboard (§20–23)

The **Write book** panel: the book plan (premise, goal, acts with intents,
book goals, promises) with Check and Approve; the §31 pre-flight summary
(version, scope, existing words — an already-written manuscript is never
overwritten blindly; existing prose is always kept); the policy choice; and
during a build, the calm view — acts holding their chapters (`✓ → ○ !`),
one live line ("Building "Chapter 11"… · Act 2 / 3 · Chapter 3 / 10 ·
48,371 words"), the goals' standing, the open gate, Pause/Resume/Cancel.
Real positions, never invented percentages (§22); real canonical word
counts, never padding toward a target (§23). The machinery's detail —
diagnostics, the agent activity log, the child build records — is a
disclosure away (§21), not the default view.

## The report (§24–26)

At completion the build carries a `BookBuildReport`: words, acts, chapters,
scenes, compiler errors and warnings, story tests passed, every failing test
as a sentence, unresolved threads by name, and the count of semantic
concerns — every issue navigable from the record. Its label is the whole of
§25: **"Draft build complete."** The pipeline finishing is a fact about
prose existing, not a claim of publication readiness; polishing belongs to
future editing workflows. The record's `variant` field (§26) declares
`first_draft | rewrite | editing_pass` so those futures are variants of this
architecture — a book build already never assumes a blank page.

**Usage** (§27) accumulates per class from every chapter build through every
act build to the book, recomputed idempotently so resuming never
double-counts. Scene-level counts live on the chapter records, chapter-level
on the act records, act-level and book-level on this one.

## Invariants

- No model call ever produces more than one scene's prose.
- The harness decides every transition; models draft, judge and propose.
- A book builds only from an approved book plan; acts and chapters likewise.
- Plan approval is the writer's alone, at every level, under every policy.
- Story State is the single authority; the book build records progress only.
- Human prose is canonical; nothing is regenerated without being asked.
- A failure anywhere is a pause with a diagnosis, never corruption.
- Completed work is never rebuilt — not by resume, restart, or replanning.
- The report describes a draft. Nothing calls the book finished.

## Not yet

- **Rewrite and editing-pass variants** (§26) — declared on the record,
  not implemented.
- **Cost intelligence and automatic model routing** — usage is counted
  (§27); choosing models by cost is future work.

## Relationship to other subsystems

- [ACT_BUILDER.md](ACT_BUILDER.md) — the pipeline each act runs as a child.
- [CHAPTER_BUILDER.md](CHAPTER_BUILDER.md) — where prose is actually made.
- [PLANNING.md](PLANNING.md) — chapter plans; the hierarchy's middle layers.
- [STORY_STATE.md](STORY_STATE.md) — the single authority every level reads.
- [STORY_TESTS.md](STORY_TESTS.md) — book-scoped assertions and the report's counts.
- [VERSIONING.md](VERSIONING.md) — checkpoints at every level; branch-first experiments.
