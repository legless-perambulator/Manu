# ORCHESTRATION

Specialists working together on one task, under control.

- **Packages:** `@jellytind/orchestration` (the graph, the handoffs, the
  runner), `@jellytind/domain` (the run record), `@jellytind/story-repository`
  (persistence), `@jellytind/editing` (the model-backed executor)
- **Status (Phase 26):** **Implemented and tested.** Deterministic workflow
  graphs with sequence, conditionals, retry, approval gates, parallel analysis
  and merge; structured artifacts; surfaced disagreement; routing classes with a
  counted cost ledger; two shipped workflows.

## The thing this is not

It is not a group chat. Agents do not address each other, do not take turns by
consensus, and do not decide who goes next. Left to talk, specialists produce a
transcript nobody can validate and a result nobody can attribute — and the last
one to speak quietly overwrites everyone before it.

**The workflow engine orchestrates.** Agents do work and hand back an artifact.

## The pipeline

```
Develop and draft Chapter 17.

✓ Architect              Story Architect      premium reasoning
✓ Scene Director         Scene Director       premium reasoning
⏸ Approve the plan       ← waiting for you
✓ Draft                  Drafter              premium prose
✓ Review                 3 of 3 analyses ran
    ✓ Character Review   Character Editor     cheap analysis
    ✓ Continuity         Continuity Editor    cheap analysis
    ✓ Prose              Prose Editor         cheap analysis
✓ Merge reviews          2 notes, 1 disagreement
✓ Checkpoint             CHECKPOINT_0004
⏸ Approve the draft      ← 1 disagreement to settle
○ Write the chapter
○ Build
○ Diagnose the build     (only if the build finds errors)
```

Two things the drawing in the specification leaves out, and both matter: the
three editors run **in parallel** because their subjects are independent, and
their results are **merged** rather than chained — so the Prose Editor cannot
silently overwrite what the Character Editor asked for.

## Handoffs are artifacts

```
chapter_brief · scene_plan · draft · character_notes · continuity_report
prose_notes · merged_review · revision_proposal · build_result
```

Each has a shape, and **a payload that does not match it is rejected before it
becomes a handoff**. That is the rule keeping a malformed response from becoming
the thing the next agent works from — and it is why a failed artifact can simply
be retried rather than poisoning the run.

An agent receives the artifacts its node declares it reads, rendered as
structured documents, plus compiled context from the Context Compiler. It does
not receive a transcript of how they were produced.

## The graph, checked before it runs

| Node          | What it does                                                    |
| ------------- | --------------------------------------------------------------- |
| `agent`       | One specialist, one artifact, optional `maxAttempts`            |
| `parallel`    | Independent analyses together; branches may not read each other |
| `merge`       | Combine reviews and **surface disagreement**                    |
| `approval`    | Stop. The run persists and waits for a human                    |
| `checkpoint`  | A revertible point, before anything is written                  |
| `apply`       | Write an approved draft, as one change set                      |
| `build`       | Run the Story Build                                             |
| `conditional` | Run children only when a named deterministic condition holds    |

Validation refuses, at definition time and by name: two nodes sharing an id, a
node reading an artifact nobody produces, a condition Manu does not have,
parallel branches that depend on each other, a specialist without
`edit_manuscript` producing a draft, and an `apply` with no checkpoint or no
approval before it. A workflow that cannot work never reaches a run.

Conditions are a **closed registry**, like skill operations: `build_has_errors`,
`build_is_clean`, `has_open_disagreements`, `review_wants_changes`. A workflow
is data, and data must not be able to execute something nobody wrote.

## When specialists disagree

Review notes carry a stance — `keep`, `revise`, `cut`, `flag` — so disagreement
is **detectable**: same target, different stance is a fact a program can find,
where two paragraphs of prose disagreeing is not.

```
SCENE_0012
  ( ) character_editor would keep it — the only place Elias shows doubt
  (•) prose_editor would cut it — it repeats the paragraph above
```

The merge step does not choose, does not average, and does not let the agent
that ran last win. Both positions go to the writer at the approval gate, and
where a gate is marked `requiresDisagreementsResolved` — as the chapter
workflow's draft gate is — **approval is refused while any remain open**. The
losing position stays on the record after the decision.

## Cost

A step declares a class of work, never a model:

```
premium_reasoning   structure, causality, diagnosis
premium_prose       text the writer will read
cheap_analysis      bulk reading where a smaller model is enough
local_metadata      no model; the project answers it
```

The routing table maps classes to configured models, per machine, defaulting to
the one model a writer has already set up. `planCost` says what a workflow will
ask for **before** it runs — the chapter workflow is 3 premium reasoning, 1
premium prose, 3 cheap analysis — and the run's ledger records calls and tokens
per class afterwards.

**No money is invented.** Manu does not know what the writer pays and prices
change; a figure in pounds that turned out to be wrong would be worse than no
figure. Counts are what a writer can act on.

A class with no model configured **skips** its steps with the class named, and
the deterministic nodes still run.

## What the acceptance criterion asks for

- **One project state.** Every agent reads the same Story Repository. A draft is
  an artifact until approved; only an `apply` node writes, and only after a
  checkpoint and the writer's word.
- **Audit trail.** The run carries its nodes, artifacts, checkpoints, change
  sets and cost; every step is logged to the ordinary agent activity store under
  one task, so a workflow appears in the same history as everything else.
- **Checkpoints.** Taken before the write, so the whole run reverts in one move.
- **Structured handoffs.** Nine artifact kinds, validated.
- **User approval.** Two gates in the chapter workflow. Declining ends the run
  with nothing written.

All of it is one test: the chapter workflow run end to end, asserting the
manuscript is untouched at the first gate, the checkpoint exists at the second,
the change set lands in the ordinary history, the eight artifacts arrive in
order, and the task's activity log holds the steps.

## Failure

A run is written to `.writer/workflows/runs/` after every node. A step that
fails keeps everything earlier steps produced, and `resume` picks up from it —
tested across a closed and reopened project. A node with `maxAttempts` retries
in place and reports how many attempts it took. Cancelling stops before the next
node rather than half-way through one.

## Not yet

- **The Author Agent does not choose the workflow.** A writer picks it. Routing
  a sentence to a workflow is the orchestrator layer above this one.
- **Workflows are shipped, not authored.** The definitions are code; there is no
  custom-workflow file format yet, as there is for skills.
- **`revision_proposal` is produced and shown, not applied.** The conditional
  diagnosis step ends the run with a proposal; acting on it is a new run.

## Invariants

- The engine orchestrates; agents produce artifacts and never call each other.
- Every handoff is validated before the next agent sees it.
- A workflow is validated before it runs.
- Parallel branches are independent, and the validator enforces it.
- Disagreement is surfaced, never resolved automatically.
- Nothing reaches the manuscript without a checkpoint and an approval.
- A step that could not run says why; `skipped` is never `ok`.
- Cost is counted per class, and never converted into money.

## Relationship to other subsystems

- [SPECIALIST_AGENTS.md](SPECIALIST_AGENTS.md) — who the specialists are, and
  the grants a workflow cannot widen.
- [WRITING_SKILLS.md](WRITING_SKILLS.md) — the single-agent workflow engine this
  extends: skills are deterministic passes, workflows are multi-agent ones.
- [AGENT_RUNTIME.md](AGENT_RUNTIME.md) — tasks, activity and permissions.
- [VERSIONING.md](VERSIONING.md) — the checkpoints and change sets a run leaves.
- [MODEL_ROUTER.md](MODEL_ROUTER.md) — what a routing class resolves to.
