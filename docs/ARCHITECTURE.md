# ARCHITECTURE

This document describes the intended system layering, the boundaries between layers, and the direction of dependencies. It is the map that keeps subsystems from leaking into one another.

## Status

Foundational documentation stage. No application code exists yet. This document defines the target structure that implementation must respect from the first vertical slice.

## Layered architecture

Maintain strict separation between the following layers. Arrows show the **allowed** direction of dependency (a layer may depend on layers below it, never above).

```
┌─────────────────────────────────────────────┐
│ UI (React / desktop shell)                    │
├─────────────────────────────────────────────┤
│ Application Services                           │
│  (orchestration, tasks, permissions, workflows)│
├───────────────┬───────────────┬───────────────┤
│ Agent Runtime │ Context        │ Story Compiler │
│               │ Compiler       │                │
├───────────────┴───────────────┴───────────────┤
│ Story Domain (entities, IDs, invariants)       │
├───────────────────────────────────────────────┤
│ Persistence  │ Model Providers │ Search/Index   │
│ (files+SQLite)│ (Model Router) │ (FTS+vectors)  │
├───────────────────────────────────────────────┤
│ External Integrations (plugins, import/export)  │
└─────────────────────────────────────────────────┘
```

### Layer responsibilities

1. **UI** — presentation and interaction only. Must not become the authoritative implementation of story logic. Renders domain state; dispatches intent to application services.
2. **Application services** — orchestrate workflows, own the task system, enforce permissions and approval policies, coordinate agents, and commit mutations transactionally.
3. **Agent runtime** — hosts the Author Agent and specialists, runs the agent/tool loop, decomposes tasks, coordinates multi-agent work. See [AGENT_RUNTIME.md](AGENT_RUNTIME.md).
4. **Context Compiler** — constructs task-specific working context. See [CONTEXT_COMPILER.md](CONTEXT_COMPILER.md).
5. **Story Compiler** — runs deterministic and semantic checks (the "build"). See [STORY_COMPILER.md](STORY_COMPILER.md).
6. **Story domain** — the real fiction model: entities, stable IDs, invariants, state transitions. The authoritative representation of story data. See [DOMAIN_MODEL.md](DOMAIN_MODEL.md).
7. **Persistence** — reads/writes the portable Story Repository (Markdown/YAML/JSON) plus a local SQLite index/derived store. See [STORY_REPOSITORY.md](STORY_REPOSITORY.md).
8. **Model providers** — provider-independent model access behind the Model Router. See [MODEL_ROUTER.md](MODEL_ROUTER.md).
9. **Search/indexing** — full-text and optional vector search over project content.
10. **External integrations** — plugins, research tools, import/export, publishing formatters.

## Boundary rules

- **UI must not implement story logic.** It renders and dispatches; it never becomes the source of truth.
- **Model-provider code must not leak throughout the application.** All model calls go through the Model Router interface. No layer imports a vendor SDK directly except the router's adapters.
- **Agent prompts must not become substitutes for domain modelling.** If a rule can be encoded in the domain or checked deterministically, it belongs in code, not a prompt.
- **The domain layer is authoritative.** UI components and model responses must never be the authoritative representation of domain state.
- **Mutations flow through the application's mutation layer.** No LLM response directly overwrites substantial project content; every mutation is attributable, inspectable, reversible, validated where applicable, and recorded in revision history.

## The determinism boundary

The single most important architectural line in this product separates **process** from **intelligence**:

- **Software controls**: loops, state transitions, permissions, branching, validation, file operations, versioning, dependency resolution, retries, approvals, workflow progression.
- **LLMs perform**: bounded creativity, interpretation, semantic reasoning, and natural-language understanding steps *inside* deterministic workflows.

Do not use an LLM where reliable deterministic software can perform the task. Do not implement a major operation as a single prompt (e.g. "write this entire chapter"); orchestrate it. See [STORY_COMPILER.md](STORY_COMPILER.md) and the long-form pipeline in [AGENT_RUNTIME.md](AGENT_RUNTIME.md).

## Source-of-truth hierarchy

Authoritative → derived:

1. Story Repository files + explicitly confirmed structured story state (**authoritative**)
2. Deterministic derived information (indexes, computed state) — regeneratable, not authoritative
3. Model inference / suggestions — proposed until confirmed
4. Cached summaries — never override source canon
5. Chat history / model memory — never authoritative

## Structured model output

Every structured model result passes through: define schema → request structured output → validate → repair/retry if appropriate → reject invalid mutations → log failure. No model response can corrupt the project merely because it returned malformed JSON. See [MODEL_ROUTER.md](MODEL_ROUTER.md).

## Transactional edits

Large AI operations behave transactionally: manuscript edits, state changes, thread/knowledge changes, summaries and index updates are **staged**, then validated, and only committed on success. On validation failure the previous safe state is preserved. See [VERSIONING.md](VERSIONING.md).

## Initial technology direction

Preferred (subject to change; do not over-engineer before behaviour is proven):

- TypeScript
- React
- Tauri or equivalent desktop shell
- SQLite for structured local state and indexing
- Markdown/YAML/JSON for portable story files
- Strongly typed domain models
- Provider-independent model abstraction
- Background job system
- Local full-text search; optional vector index

## Scale assumption

Every core subsystem must assume the whole project does **not** fit in model context — short stories through 200,000-word novels, trilogies, and long-running series with large worldbuilding repositories.
