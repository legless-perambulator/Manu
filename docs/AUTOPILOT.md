# Manuscript Intelligence Autopilot

> Phase 44. «The writer writes the story. Manu maintains the map.» The
> autopilot keeps the structured Story Repository — characters, state,
> knowledge, relationships, timeline, threads, objects, scene metadata —
> synchronised with the prose, quietly, incrementally and reversibly.

## Principles

Writing is primary (§1). The autopilot never pops a dialog, never edits
prose, and never turns uncertainty into canon silently. Everything it infers
becomes a **proposal with evidence** in the Story Intelligence inbox; only
what the writer accepts — or what the confidence policy may auto-apply, low
risk and reversibly — reaches the structured record.

Implementation: `packages/autopilot` (the engine), the desktop's
`lib/intelligence.ts` (project wiring) and the **Story Intelligence** panel
(`/intelligence`, alias `/sync`).

## Change detection and scope (§2, §33)

Every prose unit — a scene span, or a chapter without markers — carries a
content fingerprint in `.writer/autopilot/state.json`. `noteChange` compares
fingerprints and enqueues work only for units whose prose actually changed:
editing one scene of a 200-scene, 150k-word manuscript queues exactly that
scene, which the scale test asserts by counting analyst calls.

## The queue (§3–§5)

Jobs persist in `.writer/autopilot/queue.json` and survive restarts. Each
changed unit gets a **deterministic scan** (entity mentions, alias
resolution, discovery — pure parsing, reusing the story-mapper's
extractors) and a **semantic scan** (scene metadata, state, knowledge,
relationships, objects, threads, timeline, facts — one bounded analyst call
per kind). Deterministic work always runs first; the caller debounces
(after autosave, after a few quiet seconds, on manual sync) so nothing runs
per keystroke (§4).

## Proposals (§6–§15, §18)

Every proposal answers the three questions: **what** (`summary`), **why**
(`because`), **where** (`evidence` with a scene and a quote). Kinds:

- **Entity discovery** (§6): a repeated unknown name — mentions and
  mid-sentence/dialogue signals hold the "not every capitalised noun" line —
  becomes _Possible new character_ with Add / Not a character / Ignore.
- **Alias resolution** (§7): "Detective Ellison" resolves to Mara Ellison by
  stripped-token subset against exactly one owner; high-confidence safe
  aliases auto-link under the policy, ambiguity waits for review.
- **Scene metadata, state, knowledge, relationships, objects, threads,
  timeline, facts** (§8–§15): each from a per-kind briefing that forbids
  invented precision. Relationships focus on meaningful transitions, not
  per-sentence trust arithmetic; objects ignore furniture; timeline reports
  only signals the prose contains.

## Policy (§17)

`conservative` — semantic changes wait for confirmation. `balanced`
(default) — high-confidence **low-risk** proposals auto-apply. `automatic` —
medium confidence low-risk too. Risk is fixed per kind: objective state and
object movement are low; knowledge, relationships, threads, facts and
timeline carry interpretation and never auto-apply. There is no
prose-writing port in the engine at all, so "never auto-apply manuscript
changes" is a type-level property. Auto-applied intelligence records what it
wrote and can be reverted.

## Authority and conflicts (§20, §21)

Scene fields the author set explicitly (a POV, a location) are passed to the
engine as authoritative — it does not even propose over them. When an
inference contradicts established canon (via the deterministic conflict
check or the analyst flagging it), the proposal lands in **Conflicts** with
Update canon / Explain exception / Ignore — changing the manuscript is the
writer's act in the editor, never Manu's.

## Correction learning (§19)

Accepting an alias stores an alias rule; rejecting a discovery stores
"not an entity". Rules live in `.writer/autopilot/learning.json` — a JSON
file the writer can read, never a fine-tuned model — and every later scan
applies them before proposing anything.

## Applying intelligence

Accepted (and policy-auto-applied) proposals land as their real records:
characters, provisional facts, confirmed state transitions
(`character_location`, `object_holder`, `knowledge_changed` with the fact
created first), relationships, new plot threads. Anything the project cannot
yet anchor — an unknown name, movement on an existing thread — lands as a
**provisional fact carrying the evidence**, preserved and reviewable rather
than dropped or guessed at.

## Context and builds (§25, §26)

`confirmed()` (accepted + auto-applied) is what may feed authoritative
context; `uncertain()` is available only as explicitly uncertain context.
`takeAffectedScenes()` hands the incremental Story Build exactly the scenes
whose intelligence changed, so applying one transition never rebuilds the
novel.

## Budget, battery, privacy (§27–§29)

Semantic analysis is routed through `manuscript_mapping` — cheap-analysis
class, local-eligible, privacy-governed: a Local Only routing policy means
prose never reaches a cloud provider because routing refuses before any call
exists. The writer can set a monthly background budget (semantic work waits,
visibly, when it is spent) and can pause background intelligence entirely;
paused means zero work, not deferred work.

## Status and surfaces (§16, §30, §31)

One quiet line: _Story Intelligence synced_ · _3 item(s) need review_ ·
_Syncing…_ · _Paused_. The inbox lives in the Story Intelligence panel and
occupies nothing while writing. Manual sync (§24) offers scene, chapter or
entire manuscript — the full sync states its scene count, call count and
estimated cost before running.

## Handovers (§22, §23)

After Phase 40's Map Manuscript applies its mapping, `markSynced()` records
the manuscript as known-synchronised and the autopilot takes over
incrementally. External edits go through the existing safe-reload
protection first; the fingerprint diff then scopes analysis to what actually
changed.

## Acceptance (§32, §33)

`packages/autopilot/src/autopilot.test.ts` runs the scene-42 scenario end to
end — Dr. Halden proposed, Mara resolved, location and key transfer
auto-applied under balanced, knowledge/relationship/thread waiting with
quotes, one rejection leaving the rest coherent, accepted state feeding
`confirmed()`, and a fresh engine resuming the review state from disk — plus
the 200-scene/150k-word scale test proving single-scene scope.
