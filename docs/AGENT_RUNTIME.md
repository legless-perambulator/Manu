# AGENT_RUNTIME

How agents are orchestrated. Do not build one monolithic "Writer AI"; build a primary orchestrating agent that coordinates specialists through controlled orchestration and a persistent task system.

## Status

Documentation stage (agent system targeted for V3; a basic agent runtime and typed tools are part of V1).

## Agents

- **Author Agent** — general project-level orchestrator. Understands the request, determines required tools and specialists, coordinates work, presents results.
- **Story Architect** — macro structure: acts, sequences, promises, arcs, causality, setup/payoff, pacing, climax, resolution.
- **Scene Director** — turns narrative intention into scene architecture: goals, conflict, entrances/exits, beats, reversals, revelations, emotional progression, transitions.
- **Drafter** — writes prose from structured plans and compiled context.
- **Continuity Editor** — factual consistency across the project.
- **Character Editor** — motivation, psychology, decisions, arcs, consistency, emotional development.
- **Dialogue Editor** — voice differentiation, subtext, rhythm, realism, exposition, character-specific speech.
- **Prose Editor** — sentences, rhythm, imagery, clarity, repetition, description, narrative voice.
- **Developmental Editor** — challenges the manuscript at a high level rather than blindly improving prose.
- **Mystery Engine** — clues, red herrings, suspects, evidence, alibis, reader vs character knowledge, solvability.
- **Worldbuilding Agent** — canon, cultures, systems, geography, factions, history, terminology, internal rules.
- **Research Agent** — retrieves and organises external factual information.
- **Copy Editor** — late-stage grammar, punctuation, consistency, spelling, formatting, mechanics.

All agents use **shared project state** rather than maintaining incompatible private versions of the story.

## Custom agents

Users can create specialist agents (e.g. *Grimdark Editor*, *Golden Age Mystery Auditor*, *Romance Chemistry Editor*). A custom agent supports: instructions, permitted tools, preferred models, context recipes, triggers, output schemas, and genre/project-specific knowledge.

## Skills

Reusable agent workflows invoked like commands, e.g. `/murder-mystery-audit`, `/character-pass CHAR_MARA`, `/dialogue-pass`, `/pacing-audit`, `/continuity-audit`, `/foreshadowing-audit`, `/remove-ai-tendencies`, `/copy-edit`, `/reader-confusion-test`. A skill is a defined multi-step workflow (deterministic steps around bounded model steps). Skills should eventually be shareable/installable. See [ROADMAP.md](ROADMAP.md).

## Task system

Agents operate against explicit, persisted tasks. A task contains:

```
goal · scope · allowed files/entities · required context · tools
acceptance criteria · tests · approval policy · status · dependencies
```

Complex requests are decomposed:

```
TASK: Strengthen Act II.
1 Diagnose Act II pacing.  2 Inspect character arcs.  3 Inspect plot-thread progression.
4 Produce intervention plan.  5 Request approval.  6 Apply approved structural changes.
7 Run Story Build.  8 Present diffs and report.
```

**Task state persists independently of chat.** Chat history is not the task system and is not the source of truth.

## Multi-agent coordination

Specialists cooperate through controlled orchestration, not endless uncontrolled agent conversations. The orchestrator decides when a specialist is useful; agents pass **structured outputs**.

```
Architect → Scene Director → Drafter → Character Editor → Continuity Editor → Prose Editor → Story Compiler
```

## The investigate-before-modifying default

For broad or ambiguous changes, agents default to:

```
inspect → diagnose → plan → modify → validate
```

not `prompt → immediately rewrite everything`. This is a key behaviour borrowed from capable coding agents. See [STORY_DEBUGGER.md](STORY_DEBUGGER.md).

## Long-form generation pipeline

Long-form writing is **not** solved by asking a model for a 5,000-word chapter in one response. Drafting is orchestrated (a model may generate only 1,000–2,000 words per step):

```
load chapter spec → load story state → compile context → generate scene plan → validate plan
→ approval gate (if configured) → per scene: create · draft · validate · extract state changes
→ assemble chapter → continuity/prose/character checks → present chapter and diagnostics
```

See deterministic orchestration in [ARCHITECTURE.md](ARCHITECTURE.md) and autonomous builds in [ROADMAP.md](ROADMAP.md).

## Permissions

Agents have configurable autonomy. Permissions include: read manuscript, read canon, edit manuscript, edit story state, create/delete entities, run research, create branches, apply refactors, run simulations, use external services. Approval policies (e.g. *always ask before editing manuscript*, *allow metadata updates automatically*, *edits only inside current chapter*) are enforced by application services, not by the model. The user must always understand what an agent is permitted to do.

## Failure recovery

Long-running workflows must survive failures: checkpoints, resumability, retry, partial completion, error logs, cancellation, rollback. Never require a 100,000-word workflow to restart because one model request failed. See [VERSIONING.md](VERSIONING.md).

## Invariants

- One orchestrator; specialists pass structured output; no free-for-all agent chatter.
- Task state and project state persist outside chat.
- All mutations go through the mutation layer and respect permissions.
- Structured model output is schema-validated before it affects the project (see [MODEL_ROUTER.md](MODEL_ROUTER.md)).
