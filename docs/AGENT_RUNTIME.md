# AGENT_RUNTIME

How agents are orchestrated. Do not build one monolithic "Writer AI"; build a primary orchestrating agent that coordinates specialists through controlled orchestration and a persistent task system.

- **Package:** `@jellytind/agent-runtime`
- **Depends on:** `@jellytind/domain`, `@jellytind/model-router`, `@jellytind/persistence`, `@jellytind/search`, `@jellytind/shared`
- **Status (Phase 7, extended in Phase 24):** The task system, permission model, tool registry, executor, activity log and the **read-only Investigator agent** are **implemented and tested**, with tasks and activity persisted in the project. The **nine writing specialists** are implemented as configurations enforced by the same permission machinery ([SPECIALIST_AGENTS.md](SPECIALIST_AGENTS.md)). The orchestrator and multi-agent workflows remain **PLANNED** (V3). See [AGENT_TOOLS.md](AGENT_TOOLS.md).

## Task system

Agents operate against explicit, persisted tasks:

```ts
interface AgentTask {
  id;
  goal;
  status;
  createdAt;
  updatedAt;
  scope; // entity IDs / paths the task may touch
  allowedTools; // the task half of the permission check
  approvalPolicy;
  acceptanceCriteria?;
  dependsOn?;
  failureReason?;
}
```

```
pending → running → awaiting_approval → running → completed
                 ↘ failed  ↘ cancelled
```

The lifecycle is encoded as data and enforced by `transition()`, so illegal
moves — a completed task silently restarting, a cancelled task reporting success
— throw rather than being merely discouraged. Tasks are immutable values: a
transition returns a new record, so no caller can mutate one in place and lose
the trail.

**Task state persists independently of chat.** Tasks and activity live in
`.writer/agents/` (`RepositoryAgentStore`), so an investigation survives closing
the app. Chat history is not the task system and is not the source of truth.
Agent reads use the raw store, bypassing the change-set journal: reading a
project is not a story mutation and must not appear in the manuscript's
revision history.

Complex requests are decomposed:

```
TASK: Strengthen Act II.
1 Diagnose Act II pacing.  2 Inspect character arcs.  3 Inspect plot-thread progression.
4 Produce intervention plan.  5 Request approval.  6 Apply approved structural changes.
7 Run Story Build.  8 Present diffs and report.
```

Decomposition itself is **PLANNED**; Phase 7 runs one task per question.

## The Investigator (implemented)

The first real agent. It runs the `inspect → answer` half of the
investigate-before-modifying default:

```
model turn → tool calls → tool results → … → one structured, schema-checked answer
```

Deliberately bounded rather than open-ended: a step ceiling caps the loop, the
task's `allowedTools` caps the tool surface, and cancellation is checked between
every step and every tool call. Every call goes through the `ToolExecutor`, so
permissions, validation and logging apply to the agent exactly as they would to
any other caller.

The agent holds **no write permission at all**. It cannot modify the project, and
it is told so in its instructions, so it cannot truthfully claim to have.

### The ports

The runtime declares what it needs rather than importing the repository:

- **`ProjectAccess`** — the read surface the tools need. `StoryRepository`
  satisfies it structurally, so no adapter is required and nothing in the runtime
  can reach past the interface into the filesystem. Tests satisfy it with a
  fixture.
- **`AgentStore`** — task and activity persistence, implemented by the repository
  under `.writer/agents/`.

This keeps the dependency one-way: the agent runtime states requirements; the
repository, which owns the project on disk, meets them.

### Grounded answers

The final answer is structured and validated (`AGENT_ANSWER_SCHEMA`):

```ts
{
  summary;
  findings: [{ statement, sources }];
  interpretation;
  uncertainties;
}
```

The shape enforces the canon/inference boundary (AGENTS.md — "Canon vs
Inference"): retrieved project information carries its sources and is rendered
separately from `interpretation`, which the UI labels explicitly as the model's
reading and **not** project canon. A malformed response fails validation and
surfaces as a typed error rather than a half-rendered answer.

### Activity, not chain-of-thought

The activity log records **actions**: tool, argument summary, result summary,
timestamp, status, duration. It never contains model reasoning, and none is
requested, stored or displayed. The user understands what the agent did by seeing
what it _did_:

```
get_scenes_by_character id=CHAR_0001 → 4 scenes
get_scene id=SCENE_0012 → scene
read_range path=manuscript/CHAPTER_0002.md, startLine=40 → 1200 chars
```

Result summaries describe shape, not content — the activity feed is a record of
what happened, not a second copy of the manuscript.

## Permissions

Agents have configurable autonomy. Permissions include: read manuscript, read
canon, edit manuscript, edit story state, create/delete entities, run research,
create branches, apply refactors, run simulations, use external services.
Approval policies (_always ask before editing manuscript_, _allow metadata
updates automatically_, _edits only inside current chapter_) are enforced by
application services, **not** by the model: a model that decides to call a write
tool still cannot, because the executor checks the grant before the handler runs.
The user must always understand what an agent is permitted to do. See
[AGENT_TOOLS.md](AGENT_TOOLS.md) for the two-gate check.

## Agents

Nine of the specialists below are **implemented** as registry entries rather
than prompts — tools, permissions, context recipe, output shape and model class,
with the tool list becoming the executor's grant. See
[SPECIALIST_AGENTS.md](SPECIALIST_AGENTS.md); the rest of this list remains
planned.

- **Author Agent** — general project-level orchestrator. Understands the request, determines required tools and specialists, coordinates work, presents results. Implemented today as the Investigator plus `recommendSpecialist`.
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

Users can create specialist agents (e.g. _Grimdark Editor_, _Golden Age Mystery Auditor_, _Romance Chemistry Editor_). A custom agent supports: instructions, permitted tools, preferred models, context recipes, triggers, output schemas, and genre/project-specific knowledge. `AgentDescriptor` already carries permitted tools and permissions.

## Skills

**Implemented in Phase 25** — see [WRITING_SKILLS.md](WRITING_SKILLS.md). Seven ship with Manu, each a sequence of named operations against the Story Repository rather than a prompt, resumable where it stopped, and composable by the writer into skills of their own.

Reusable agent workflows invoked like commands, e.g. `/murder-mystery-audit`, `/character-pass CHAR_MARA`, `/dialogue-pass`, `/pacing-audit`, `/continuity-audit`, `/foreshadowing-audit`, `/remove-ai-tendencies`, `/copy-edit`, `/reader-confusion-test`. A skill is a defined multi-step workflow (deterministic steps around bounded model steps). Skills should eventually be shareable/installable. See [ROADMAP.md](ROADMAP.md).

## Multi-agent coordination — PLANNED

Specialists cooperate through controlled orchestration, not endless uncontrolled agent conversations. The orchestrator decides when a specialist is useful; agents pass **structured outputs**.

```
Architect → Scene Director → Drafter → Character Editor → Continuity Editor → Prose Editor → Story Compiler
```

## The investigate-before-modifying default

For broad or ambiguous changes, agents default to:

```
inspect → diagnose → plan → modify → validate
```

not `prompt → immediately rewrite everything`. This is a key behaviour borrowed from capable coding agents. Phase 7 implements `inspect`; the rest follows. See [STORY_DEBUGGER.md](STORY_DEBUGGER.md).

## Long-form generation pipeline — PLANNED

Long-form writing is **not** solved by asking a model for a 5,000-word chapter in one response. Drafting is orchestrated (a model may generate only 1,000–2,000 words per step):

```
load chapter spec → load story state → compile context → generate scene plan → validate plan
→ approval gate (if configured) → per scene: create · draft · validate · extract state changes
→ assemble chapter → continuity/prose/character checks → present chapter and diagnostics
```

See deterministic orchestration in [ARCHITECTURE.md](ARCHITECTURE.md) and autonomous builds in [ROADMAP.md](ROADMAP.md).

## Failure recovery

Long-running workflows must survive failures: checkpoints, resumability, retry, partial completion, error logs, cancellation, rollback. Phase 7 implements cancellation, typed failure recording on the task, and persistence of both; resumability and retry are **PLANNED**. Never require a 100,000-word workflow to restart because one model request failed. See [VERSIONING.md](VERSIONING.md).

## Invariants

- One orchestrator; specialists pass structured output; no free-for-all agent chatter.
- Task state and project state persist outside chat.
- Every tool call is permission-checked, schema-validated and logged.
- Agent-supplied paths can never escape the project root.
- Retrieved project content and model interpretation are never presented as the same thing.
- Private model reasoning is never stored or displayed.
- All mutations go through the mutation layer and respect permissions.
- Structured model output is schema-validated before it affects the project (see [MODEL_ROUTER.md](MODEL_ROUTER.md)).
