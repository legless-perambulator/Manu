# AI_EDITING

Controlled AI manuscript editing: targeted, reviewable, reversible changes to prose.

- **Package:** `@jellytind/editing`
- **Depends on:** `@jellytind/story-repository`, `@jellytind/context-compiler`, `@jellytind/model-router`, `@jellytind/agent-runtime`, `@jellytind/domain`, `@jellytind/shared`
- **Status (Phase 9):** **Implemented and tested.** Three operations — `rewrite_selection`, `rewrite_scene`, `continue_scene` — with staged proposals, hunk-level acceptance and full audit. Autonomous chapter rewriting and multi-scene operations are **PLANNED**.

## The rule

**The model never writes to a file.** It returns prose. The harness decides what
that means for the project, and only a human decision commits it.

This is the phase where the product stops resembling a writing chatbot: the AI
knows what it is editing because the harness supplied structured story context,
and every proposed change is reviewable and reversible before it exists.

## Workflow

```
1 identify target      → which file, which character range, which scene
2 compile context      → Context Compiler recipe, budgeted and attributed
3 invoke model         → Model Router, provider-independent
4 validate response    → schema + deterministic checks
5 stage                → StagedTransaction; the project is untouched
6 present diff         → hunks the author can take or leave
7 accept or reject     → the human decision
8 commit               → one ChangeSet
9 audit                → AI provenance on the change set + agent activity log
```

Every step reuses a subsystem that already existed. Nothing here reimplements
retrieval, model access, staging or history.

## Operations

### `rewrite_selection`

The author selects a passage and picks a directive:

```
rewrite · shorten · expand · strengthen_dialogue · increase_tension · remove_exposition
```

The selection is addressed by character range, and the range's current text is
checked against what the author selected. If the file moved underneath, the
operation fails with `stale_selection` rather than editing the wrong prose.

Scene context is compiled automatically: when the scene is known, the
`scene_rewrite` recipe supplies neighbours, characters, POV, location, threads,
world rules and style material; when it is not, the chapter that owns the file
supplies `chapter_inspection` context. The recipe used is recorded on the change
set.

### `rewrite_scene`

Rewrites one scene in full, working from its structured purpose and the compiled
context. Only that scene's prose is replaced — the rest of the chapter, and the
other scenes' markers, are untouched.

### `continue_scene`

Generates a continuation at the end of the scene's text, respecting the existing
prose, the characters present, the POV, the location, the live plot threads and
the project's style files — all of which arrive through the compiled context, not
through prompt text.

Autonomous chapter rewriting is deliberately **not** implemented.

## Addressing a scene's prose

A chapter file is the authoritative text; scenes are records that reference it.
To edit one scene, the prose needs a boundary, so a chapter may mark scene starts
with an HTML comment:

```markdown
<!-- scene: SCENE_0001 -->

The hall was colder than Mara remembered.

<!-- scene: SCENE_0002 -->

Elias was already waiting.
```

The marker is invisible in rendered Markdown, survives any editor, and keeps the
file portable — no sidecar index, no proprietary format.

Markers are **optional**, with two deterministic fallbacks, both unambiguous:

- a chapter with exactly one scene _is_ that scene;
- a continuation of a chapter's last scene appends at the end of the file.

Anything else fails with an explanation of how to mark the scene, rather than
guessing which paragraphs belong to which scene.

## Validation

The model replies against a schema (`text`, `rationale`, `warnings`), so prose is
validated before it can reach a file. Deterministic checks then reject:

| Check                                            | Failure            |
| ------------------------------------------------ | ------------------ |
| empty or whitespace-only prose                   | `empty_response`   |
| output identical to the original                 | `no_change`        |
| output far larger than the target should produce | `runaway_response` |

Markdown code fences the model may wrap prose in are stripped. `warnings` are
surfaced to the reviewer rather than acted on — a model that notices a continuity
problem reports it; it does not fix it silently.

## Review

The proposal screen shows the instruction, the context recipe with its element
and token counts, the model, the model's stated rationale, anything it flagged —
and the diff.

Changes are grouped into **hunks**. The author can accept all of them, reject the
whole proposal, or tick individual hunks and take only those; a preview shows the
file as it would be saved. Accepting zero hunks is refused rather than treated as
a rejection, so "accept nothing" can never be mistaken for "accept everything".

Applying every hunk yields the model's text byte-for-byte; applying none yields
the original. Partial selections are rebuilt from the diff.

## Audit

Two records, both in systems that already existed:

**On the change set** (`ChangeSet.ai`) — beside the before/after text, so it can
never drift from the change it describes:

```
operation · targetId · instruction · directive · contextRecipe · contextTokens
modelId · taskId · approval · approvedAt · acceptedHunks / offeredHunks
```

with `actor: "agent"`. History listing shows the AI operation on the entry.

**In the agent activity log** — every proposal outcome, including rejections.
A rejected proposal changes nothing, so it produces no change set; the decision
is still recorded.

## Tasks and permissions

Each operation is an `AgentTask` (Phase 7), persisted in `.writer/agents/`:

```
pending → running → awaiting_approval → completed   (accepted)
                                      ↘ cancelled   (rejected)
                  ↘ failed                          (bad output or provider error)
```

`awaiting_approval → completed` was added to the lifecycle in this phase:
approval is the last step of an edit, so resuming through `running` would be a
fiction.

Operations require the `edit_manuscript` permission and are named in the grant's
allow-list. Without it the operation fails before the model is called at all —
the check is the first thing `propose` does.

## Reversibility

An accepted AI edit is an ordinary change set: it appears in history, diffs like
any other change, and `revertChangeSet` restores the prose exactly. A rejected
proposal leaves nothing behind but its activity entry.

## Invariants

- The model never writes to a project file.
- Every edit's context comes from the Context Compiler, never from ad-hoc reads.
- Model output is schema-validated and sanity-checked before it is staged.
- Nothing is committed without an explicit human decision.
- Every committed AI edit records which model, instruction, recipe and approval produced it.
- Every AI edit is revertible through the normal history.
- An operation without `edit_manuscript` never reaches a model.
