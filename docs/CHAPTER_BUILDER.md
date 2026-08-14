# CHAPTER_BUILDER

Manu's first long-form production pipeline: building a chapter from its scene
plan as a controlled sequence of small operations.

- **Packages:** `@jellytind/editing` (`ChapterBuilder`), `@jellytind/domain`
  (the `ChapterBuild` record), `@jellytind/story-repository`
  (`ChapterBuildStore`, persistence under `.writer/builds/chapters/`)
- **Status (Phase 31):** **Implemented and tested.** Scene-by-scene drafting
  with per-scene contexts, bounded continuation, state extraction, deterministic
  validation, plan coverage with a bounded revision loop, three approval
  policies, pause/resume across restarts, cancellation, checkpoints, and a full
  audit trail. The Act Builder (Phase 33) and the Book Builder (Phase 34) run
  this pipeline as their leaf.

## The rule

**The harness controls progression, not the model.** «Build Chapter 17» is
never sent to a model as an instruction. It is decomposed by deterministic
code into a pipeline whose every transition is decided by the harness:

```
validate prerequisites → checkpoint → plan the scene sequence → [gate]
for each scene:
  compile scene context          (Context Compiler, from CURRENT project state)
  draft the scene                (one bounded model call, continued if short)
  [gate under every_scene]       (the draft is held; nothing has landed)
  commit as one change set       (ordinary history, AI provenance)
  extract state changes          (StateExtractor → proposed transitions)
  deterministic validation       (the whole Story Compiler rule set)
  plan coverage                  (model judgement, labelled as such)
  bounded revision if unmet      (maxRevisions, then pause and report)
  checkpoint
assemble → final Story Build → Story Tests → present
```

A model is invoked at exactly three points — drafting/continuing/revising prose,
extracting state, judging coverage — and each invocation is one bounded call
whose output is schema-validated before the harness decides what it means.

## The record

A build is a persisted `ChapterBuild` in `.writer/builds/chapters/CB_XXXX.json`,
written after **every step**. It carries the chapter, the branch, the status,
the current step and scene, the approval policy, the model assignments, the
per-scene ledger (beats, attempts, calls, words, change set, checkpoint,
coverage, extracted-state counts), diagnostics, usage counts, the pending
question when stopped at a gate — and, for an `every_scene` build, the held
draft itself, so a gate that was open when Manu closed is still open tomorrow.

Statuses: `pending · planning · awaiting_approval · drafting · validating ·
revising · completed · failed · cancelled · paused`. `paused` and `failed` are
resumable; `completed` and `cancelled` are terminal.

## The approved chapter plan (Phase 32)

When the chapter has an **approved** `ChapterPlan` ([PLANNING.md](PLANNING.md)),
`start` consumes it directly: the build record pins `planId` and `planVersion`
(the approved version number, exactly), per-scene word targets come from the
plan, and the plan's constraints — forbidden knowledge resolved to plain
sentences — are appended to **every** drafting instruction as hard constraints.
The scene records the builder drafts from are the very ones approval
materialised, so there is one representation of the chapter's shape, not two.
A plan still in `draft` is noted in the build's diagnostics and ignored; only
the writer's approval makes a plan an input.

## Scene-by-scene generation

Each scene is drafted from a freshly compiled `scene_rewrite` context: purpose,
POV, location, participants, story/knowledge/relationship state as it stands
_entering the scene_, live threads, setups, voice material and adjacent prose.
Context is compiled **at draft time from the current project state**, never
from a build-start snapshot — which is what makes the manual-intervention
workflow real: build Scene 1, edit it by hand, resume, and Scene 2 is drafted
against the edited text.

Prose is committed into the chapter's ordinary Markdown file, inside the
scene's `<!-- scene: SCENE_XXXX -->` span (markers are added in one recorded
change set during prerequisites if missing). There is no parallel AI
manuscript: human and built scenes are one file, told apart by provenance in
history, not by location.

## Length and continuation

A plan may give a scene `minWords`/`maxWords`, or neither. A draft short of its
minimum is **continued from its exact endpoint**: the harness passes the tail
of the existing draft and instructs the model to pick up mid-flow without
restating anything. Continuations are bounded (`maxContinuations`, default 3);
a scene still short after that is committed with an honest warning. An
over-length scene is **reported, never truncated** — cutting prose to satisfy
a number is the harm the bound exists to prevent, not a way to enforce it.

## State extraction and canon

After each committed scene the existing `StateExtractor` proposes transitions,
which land as `proposed` under the ordinary canon rules. When the writer
enabled `autoConfirmObjective` at build time, transitions that are **both**
objective in kind (`character_location`, `object_holder`, `object_location`,
`object_owner`, `object_status`) **and** high-confidence (≥ 0.8) are confirmed
automatically. Knowledge, relationships and everything interpretive always
stays `proposed`, whatever the confidence — "Canon vs Inference" is not
suspended because a build is running.

Confirmed state then feeds the next scene's compiled context: what Scene 1
established is what Scene 2 is written against.

## Validation between scenes

The full deterministic rule set runs after every commit — referential
integrity, knowledge continuity, object/location continuity, hard world rules,
story tests. **Errors pause the build** with the diagnostics on the record;
warnings are recorded and the build continues. Fix the project, resume, and
the pipeline re-validates from the same step.

## Plan coverage and revision

The scene's recorded purpose lines are its beats. After validation, an
analysis model judges each beat against the committed prose — semantic
judgement, so every item carries `source: "model"` and is never treated as a
deterministic result. Unmet beats trigger at most `maxRevisions` revision
passes (default 1), each committed as an ordinary change set; a scene still
unmet afterwards **pauses the build and reports**, never loops.

## Approval policies

| Policy             | What the writer sees                                           |
| ------------------ | -------------------------------------------------------------- |
| `every_scene`      | Each draft is held in the record; nothing lands until approved |
| `every_chapter`    | Scenes build in sequence; one gate before the build finishes   |
| `auto_until_error` | Commits as it goes; stops for errors and unmet plans           |

The policy is chosen when the build starts, and choosing `auto_until_error` is
itself the human decision: standing approval for commits that are all
checkpointed, attributed and revertible. Declining a held draft discards it —
it never reached the manuscript — and pauses; resume drafts the scene again.

## Pause, resume, cancel

- **Pause** is cooperative: requested between steps, honoured before the next
  one starts, recorded.
- **Resume** re-enters at `currentStep` with everything recompiled from the
  current project — tested across a genuine reopen of the project from disk.
  A `failed` build resumes the same way, retrying the step that failed. A
  scene interrupted mid-draft (no held draft survived) is put back in the
  queue and retried — never silently skipped, never duplicated.
- **Cancel** keeps every committed scene (they are ordinary history), discards
  any held draft, records the cancellation, and is terminal.

## Checkpoints

Before the build, after every committed scene, and after the finished chapter
— all through the ordinary versioning system, so one revert returns the
project to any of those points.

## Failure

Provider failures, malformed output, validation failures and save failures all
end the same way: `status: failed`, with `failureReason` naming the exact step
and scene (`draft_scene (SCENE_0003): …`). Nothing is retried silently; resume
is the retry, and it is the writer's.

## Audit

The build record keeps the request, policy, model assignments, per-scene
attempts/calls/words, coverage verdicts, extracted-state counts, diagnostics
and usage counts. Every committed scene is a change set with full AI
provenance in ordinary history; every step is logged to the agent activity
stream under the build's one task. No hidden chain-of-thought is stored —
model rationales are the models' stated summaries, requested as output.

## Model assignments

The builder takes models by class of work: `drafting` (premium prose —
required) and `analysis` (extraction and coverage — optional). The desktop app
resolves these from the writer's configured model purposes. With no analysis
model, extraction and coverage are **skipped with the reason recorded** —
"skipped" is never silent and never "ok".

## The UI

The **Write chapter** panel: pick a chapter, pick how much to see, build. A
scene checklist (`✓ → ⏸ ○`), the current activity, the held draft at a gate
with _Keep going_ / _Not this — redraft_, Pause/Resume/Cancel, the build's
notes, and past builds. Committed scenes open in the ordinary editor while the
build continues.

## Invariants

- The harness decides every transition; a model call never decides what runs next.
- One manuscript: built prose lands in the writer's chapter files as ordinary change sets.
- Context is compiled from current project state at each step, never from a snapshot.
- Extracted state obeys the existing canon rules; only objective, high-confidence
  kinds may auto-confirm, and only by prior explicit choice.
- Every loop is bounded: continuations, revisions, retries.
- Errors stop the build; warnings are recorded; skips carry reasons.
- The record on disk is sufficient to resume after a crash, from the step reached.
- Cancellation preserves committed work and leaves the project valid.

## Not yet

- **Token accounting.** Usage counts calls per class; the model interface does
  not yet expose token totals for structured calls. (Building more than one
  chapter as one operation is the Act Builder's job, and more than one act the
  Book Builder's — [ACT_BUILDER.md](ACT_BUILDER.md),
  [BOOK_BUILDER.md](BOOK_BUILDER.md) — each running this pipeline as the leaf
  where prose is actually made.)

## Relationship to other subsystems

- [PLANNING.md](PLANNING.md) — the approved chapter plan a build consumes.
- [ACT_BUILDER.md](ACT_BUILDER.md) — the act-level workflow that runs chapter
  builds as children.
- [AI_EDITING.md](AI_EDITING.md) — the single-edit machinery this reuses.
- [ORCHESTRATION.md](ORCHESTRATION.md) — the multi-agent workflow engine; the
  chapter builder is a purpose-built loop, not a workflow graph, because its
  scene sequence is data discovered at run time.
- [CONTEXT_COMPILER.md](CONTEXT_COMPILER.md) — where every draft's context comes from.
- [STORY_STATE.md](STORY_STATE.md) — the transitions extraction proposes.
- [VERSIONING.md](VERSIONING.md) — the checkpoints and change sets a build leaves.
