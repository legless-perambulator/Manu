# ACT_BUILDER

The act-level production workflow: coordinating chapter builds toward goals
that span chapters (Phase 33).

- **Packages:** `@jellytind/domain` (`ActPlan`, `ActBuild`, goal evaluation
  vocabulary), `@jellytind/story-repository` (`ActPlanStore`, `ActBuildStore`,
  act plan validation, deterministic goal evaluation), `@jellytind/editing`
  (`ActBuilder`)
- **Status:** **Implemented and tested.** Act plans with chapter roles and
  act-level goals, the deterministic per-chapter pipeline over the Phase 31
  Chapter Builder, future-plan adaptation, pause/resume across restarts,
  replanning the remaining act, act-scoped story tests, and the Write act
  panel. **Book Build / `/write-book` is not built** and remains out of scope.

## Not a for-loop

```
for chapter in act: buildChapter(chapter)     ← what this is NOT
```

Between every two chapters the act builder reasons about the act as a whole,
in deterministic code:

```
load the approved Act Plan
validate act prerequisites → checkpoint → inspect opening state
for each chapter, in act order:
  confirm the chapter's plan       (re-validated against actual current state)
  build the chapter                (the whole Phase 31 pipeline, as a child)
  evaluate act progress            (goals answered from recorded state)
  re-validate future chapter plans (§6 — the dependency check)
  [gate under every_chapter] → checkpoint
act-level validation → Story Compiler → Story Tests (act slice reported)
→ final goal evaluation → present
```

A model is never asked what to do next. Models draft prose and judge coverage
_inside_ the child chapter builds, and — when configured — **propose** updated
chapter plans that a human then reviews. Every transition above is the
harness's.

## The act plan

An act is not an entity in the ID registry: it is **named by the chapters that
make it up** (the shape `getThreadsIntroducedInAct` already committed to), and
the act plan is the act's definition — a plain project file under
`plot/acts/ACT_XXXX.json`, journaled, versioned in place with bounded
snapshots, exactly like a chapter plan.

Beyond identity and the ordered chapter list, everything is optional:
objective, dramatic function, opening and target closing state, per-chapter
**roles** (§2 — free text; `setup · escalation · reversal · …` are
suggestions, not an enforced structural theory), pacing and escalation intent,
constraints and notes.

The goals are the point (§3):

| Goal                | Author's words +               | Deterministic hook (optional)                |
| ------------------- | ------------------------------ | -------------------------------------------- |
| `plotThreadGoals`   | intent                         | `minAdvances` (scene touches), target status |
| `characterArcGoals` | movement                       | fact + target knowledge state                |
| `relationshipGoals` | intent                         | tracked dimension + rises/falls              |
| `requiredSetupIds`  | must be planted within the act | always deterministic                         |
| `requiredPayoffIds` | must pay off within the act    | always deterministic                         |
| `forbiddenFacts`    | must stay withheld through it  | always deterministic                         |

An act plan is `draft` until the writer approves it; a build starts only from
an approved plan, pinned by version.

## Goal evaluation (§3, §8)

`repo.evaluateActGoals(plan)` answers every goal **from recorded state at the
act's closing boundary** — the last act scene in telling order — with no model
anywhere. A goal with a hook comes back `satisfied`/`unsatisfied` with plain
evidence ("trust fell across the act (0.6 → 0.2)"). A goal that is only the
author's intent comes back `not_evaluated`, `method: "semantic"`, with what
the record _can_ say as evidence. Measurement is never dressed up as
judgement; drift analysis (§7) that needs a reading is labelled a
**semantic concern**, one of the three severities act validation keeps apart
(§10): `error` (violated hard constraints, broken builds, failing act tests),
`warning` (unmet requirements), `semantic_concern` (the writer's call).

The evaluation is cheap and re-run after every chapter, so the Write act panel
can always show "4 / 7 currently satisfied" — and note, deterministically,
when every decidable goal is satisfied ahead of plan.

## Future-chapter adaptation (§6)

After each chapter completes, every **future** chapter's approved plan is
re-validated against the project as it now actually stands — the same
`validateChapterPlan`, at that chapter's own entry boundary. One subtlety
makes this honest rather than noisy: an error is suppressed while an earlier,
still-unbuilt act chapter's approved plan **promises** to deliver the missing
prerequisite (a knowledge change granting the fact to its source; a scene
planting the setup). The moment that chapter is built, the promise expires —
so "Chapter 8 was meant to teach Mara FACT_X and didn't, and Chapter 10 needs
it" is caught when Chapter 8 completes, not when Chapter 10 starts.

A stale plan is never built from. What happens instead is the configured
autonomy:

- **`pause`** — the act stops, the dependency is named, the writer decides.
- **`propose`** — Manu drafts an updated plan for the affected chapter
  (`PlanArchitect`, saved as an ordinary `draft` with `source: "model"`),
  then stops for review. **Approval is still the writer's**: the act builder
  has no way to approve a plan except a gate the writer answers.

**Replan Remaining Act** (§14) is the writer-initiated version: fresh draft
plans are proposed for every not-yet-built chapter, with an optional
instruction; completed chapters and accepted story state are untouched.

## The build record

An `ActBuild` in `.writer/builds/acts/AB_XXXX.json`, written after every
act-level step: status (`pending · planning · building · awaiting_approval ·
validating · paused · failed · completed · cancelled`), current step and
chapter, the per-chapter ledger (child build id, pinned plan version,
`planStale`, checkpoint, words), opening notes, diagnostics, the latest goal
report, the pending gate, and usage **accumulated from every child chapter
build** (§18 — recomputed idempotently, so resuming never double-counts).

Pause/resume is the same promise as Phase 31, one level up (§12): build
chapters 6–8, close Manu, reopen, resume at 9 — never a rebuild of 6. A failed
or stopped chapter build **pauses the act at that chapter** (§17) with the
child's own diagnosis on the record; resume retries that chapter from where
it stopped, because the child build record is itself resumable.

Human edits during the act need no machinery (§13): child builds compile
context from the current project at every draft, so a chapter edited by hand
mid-act is simply what later chapters grow from. The act plan is direction,
never a snapshot to build from.

## Approval modes (§11)

- **Every Chapter** — a gate after each chapter is built, and a final gate.
- **Act Plan + Final Act** — approve the plan up front; chapters run
  hands-off; one gate on the finished act.
- **Automatic Until Error** — no gates; stops for errors, failed chapters and
  stale plans.

Chapter-level gates belong to the act builder alone — child builds run
`auto_until_error`, so there is one gatekeeper, not two. Gates also carry the
plan decisions: a chapter with a draft plan (or a generated one, under
"draft plans for chapters that have none") gates before building, and the
writer's yes at that gate _is_ the chapter-plan approval; declining builds
from the chapter's scene records and leaves the draft a draft.

## Act-scoped story tests (§9)

No new machinery: an act-wide test is an ordinary Story Test scoped `between`
the act's first and last chapter (`actTestScope` builds exactly that), so
"THREAD_PHOTOGRAPH must remain unresolved through Act II" is written the way
every other test is. At the act's final build, the full suite runs and the
**act-relevant slice** — tests whose scope anchors fall inside the act, plus
any the plan names — is reported on the build (`actTestFailures`), each
failure an act-level error.

## The UI (§15–16)

The **Write act** panel (Assist group): pick or create an act, name it, tick
its chapters into order with roles, write the goals — all manual-first, no
model required — then Check the plan, Approve it, choose the approval mode
and the stale-plan autonomy, and build. During a build: the chapter checklist
(`✓ → ○ !`), "Act goals: 4 / 7 currently satisfied" with per-goal evidence,
where the act started, the gate when one is open, Pause/Resume/Cancel, and
Replan the remaining act while paused. Clicking a chapter shows its chapter
plan — scenes and beats — so the writer can inspect Act Plan → Chapter Plan →
Scene plan without ever seeing a backend representation. The manuscript stays
open beside it throughout.

## Invariants

- The harness decides every transition; models draft, judge and propose — never steer.
- An act builds only from a plan the writer approved, pinned by version.
- A stale chapter plan is never built from; it pauses the act or arrives re-proposed.
- Plan approval belongs to the writer alone, at every level, under every policy.
- Goal evaluation is deterministic; intent goals are reported, never decided.
- A failed chapter pauses the act at that chapter. Nothing is skipped silently.
- Completed chapters are never rebuilt — not by resume, not by replanning.
- The record on disk is sufficient to resume after a restart, at the chapter reached.
- Cancellation keeps completed chapters and leaves the project valid.

## Not yet

- **Book Build / `/write-book`** — building multiple acts as one operation is
  deliberately out of scope for this phase.
- **Automatic cost routing** — usage is accumulated per class (§18); choosing
  models by cost is a future phase.

## Relationship to other subsystems

- [CHAPTER_BUILDER.md](CHAPTER_BUILDER.md) — the pipeline each chapter runs as a child.
- [PLANNING.md](PLANNING.md) — the chapter plans an act confirms, consumes and re-proposes.
- [STORY_STATE.md](STORY_STATE.md) — the recorded state every goal is answered from.
- [STORY_TESTS.md](STORY_TESTS.md) — the assertions the act's slice is reported from.
- [STORY_COMPILER.md](STORY_COMPILER.md) — the deterministic checks at every chapter and the finish.
- [VERSIONING.md](VERSIONING.md) — the checkpoints before the act, after every chapter, and at the end.
