# ROADMAP

Versioned delivery plan. Implementation proceeds **vertically**: finish a coherent slice before starting multiple unrelated large systems. This document is the permanent map from vision to shipped capability; `MASTER_BUILD.md` is the full north-star specification.

## Status

Pre-V1. The repository currently contains the vision (`MASTER_BUILD.md`), agent rules (`AGENTS.md`) and this living architecture documentation. No application code exists yet.

## Vertical-slice method

For every major capability:

1. define the domain model
2. define persistence
3. define application service
4. define UI
5. define agent tools if relevant
6. define LLM responsibility if relevant
7. define validation
8. define tests
9. implement
10. document

Do not build disconnected mock features. Every feature should progressively strengthen the same underlying fiction operating environment.

## V1 — Writing IDE

Prove the core paradigm: **AI can operate reliably on a fiction project instead of merely chatting about it.**

- project creation · portable project repository
- manuscript/chapter structure · characters · locations · basic plot threads
- editor · project tree · AI panel · basic agent runtime
- typed file/story tools · Context Compiler V1 · project search
- AI edits · diffs · checkpoints · undo/revert
- model abstraction · basic local persistence

V1 does not need every advanced story system.

## V2 — Story Intelligence

The application begins understanding the structure of the story.

- scenes as entities · story state · timeline
- character knowledge · relationships · object continuity
- plot-thread lifecycle · world rules
- Story Compiler (deterministic + semantic checks) · dependency/causality graph
- Story Refactor V1 · Story Debugger V1

## V3 — Agent System

- Author Agent · Architect · Scene Director · Drafter
- Continuity / Character / Dialogue / Prose / Developmental / Copy Editors
- custom agents · Writing Skills
- task orchestration · multi-agent workflows · agent permissions · model routing

## V4 — Simulation and Advanced Intelligence

- Reader Simulator · Character Simulator
- mystery auditing · Story Tests · semantic tests · reader-state persistence
- suspicion/trust graphs · character behavioural analysis
- advanced knowledge graph · advanced causality analysis

## V5 — Autonomous Production

- chapter / act / book build pipelines
- approval gates · autonomous revision passes
- resumable long-running tasks · automatic validation
- state extraction · checkpointing · `/write-book`

`/write-book` means *launch a persistent, stateful, validated, multi-stage production pipeline* — not "ask a model for a novel."

## V6 — Ecosystem

- plugin protocol · agent sharing · skill sharing · genre modules · marketplace
- external research tools · publishing integrations · richer import/export
- series/universe support · collaboration · community extensions

## Milestone ladder (cross-cutting)

1. AI can safely and intelligently operate on a structured fiction project. *(V1)*
2. The system understands enough story structure to reason about consequences across the project. *(V2)*
3. Specialised agents can collaboratively perform professional-scale workflows. *(V3)*
4. The system can simulate readers and characters to test narrative behaviour. *(V4)*
5. The harness can reliably execute novel-scale production/revision over long periods with consistency, state, recoverability and human control. *(V5+)*

## First demonstration target

An early demo that shows why this product is different (`MASTER_BUILD.md` §66): create a mystery project, five characters, a premise, a 12-chapter outline, draft Chapter 1, establish structured state — then *"Change Marcus from Elias's brother to his childhood friend,"* run the refactor blast-radius analysis, apply on a branch, show diffs, run a Story Build. This is a far stronger demonstration than generating prose.
