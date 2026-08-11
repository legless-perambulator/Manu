# ROADMAP

Versioned delivery plan. Implementation proceeds **vertically**: finish a coherent slice before starting multiple unrelated large systems. This document is the permanent map from vision to shipped capability; `MASTER_BUILD.md` is the full north-star specification.

## Status

**Phases 0 (foundation), 1 (Story Repository), 3 (fiction-domain entities), 4
(search & retrieval), 5 (revision history, checkpoints & diffs), 6
(provider-independent model layer) and 7 (agent runtime & read-only tool system)
complete.** AI can now _inspect_ a project through typed tools; agent-driven
_edits_ and the Context Compiler are next, on top of the safety layer that
already exists.

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

## Phase 0 — Technical foundation ✅

Establish the architecture and toolchain without building product features.

- pnpm monorepo; TypeScript strict; ESLint + Prettier; Vitest; root scripts
  (`dev`, `build`, `test`, `lint`, `typecheck`).
- Clean package boundaries: `shared`, `domain`, `persistence`, `story-repository`,
  `model-router`, `context-compiler`, `story-compiler`, `agent-runtime`, `search`,
  `providers/anthropic`.
- Domain identity foundation: branded entity IDs + generation, fully tested.
- Persistence interfaces (`ProjectStore`, `StateStore`, `RevisionStore`) with
  in-memory implementations.
- Provider-independent `LanguageModel` interface, `ModelRouter`, structured-output
  validation, and an isolated Anthropic adapter.
- Tauri + React desktop shell that compiles, launches, and bridges to Rust.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the resulting structure.

## Phase 1 — The Story Repository ✅

The persistent, authoritative project format.

- Domain: `Project`, `Chapter`, `Character`, `Location`, `PlotThread`, and the
  `ProjectManifest` with schema versioning.
- Persistence: pure path-safety, `NodeProjectStore` (atomic writes, traversal
  prevention), and a SQLite derived index with a versioned migration runner.
- `StoryRepository` service: create / open / validate / save; safe file
  read/write/list/mkdir/exists; entity creation with stable, persisted IDs.
- Desktop app: create / open project flow, project explorer over the real
  repository, and a Markdown editor that saves through the repository. Filesystem
  access is mediated by root-confined Rust commands.

See [STORY_REPOSITORY.md](STORY_REPOSITORY.md).

## Phase 3 — Foundational fiction-domain entities ✅

A real story-world graph beneath the manuscript (no AI).

- Domain: `Character`, `Location`, `StoryObject`, `PlotThread`, `Fact`,
  `WorldRule`, `StoryEvent`, `Relationship`, `Scene` — with stable IDs (`RULE_`,
  `REL_` added) and status vocabularies.
- Repository: authoritative per-kind stores (Markdown+front-matter for prose
  entities, JSON collections for data entities), full CRUD, ID-stable renames,
  entity linking, and **referential integrity** (reference validation on write,
  dependency lookup, and safe delete with prevent/unlink).
- UI: context-sensitive inspector (structured character profile; scene POV /
  location / participants / threads / purpose; metadata for every kind), an
  entities browser with creation, entity linking, and delete-with-dependency
  warnings.

See [DOMAIN_MODEL.md](DOMAIN_MODEL.md) and [STORY_REPOSITORY.md](STORY_REPOSITORY.md).

## Phase 4 — Search & retrieval ✅

Deterministic retrieval before AI context selection.

- `@jellytind/search`: pure-TS lexical inverted index (Unicode tokeniser, AND
  terms + quoted phrases, ranking, excerpts, kind filters, incremental
  upsert/remove) and a `SemanticSearchProvider` abstraction for later embeddings.
- Repository: `ProjectSearch` indexes prose, entity files and collections (lazy
  build + incremental updates); `searchText`; and structured graph queries
  (`getScenesByCharacter/POV/Location/PlotThread`, `getScenesBetweenChapters`,
  `getCharacter/Object/PlotThread Appearances`).
- UI: a global Search tab (query, result-type filters, located excerpts) that
  opens files or selects entities.

See [SEARCH.md](SEARCH.md).

## Phase 5 — Revision history, checkpoints & diffs ✅

The safety layer required before unrestricted AI editing.

- Every mutation is captured as a reviewable, reversible **change set**
  (actor, operation, file before/after, entity changes, status) via a journaling
  store; failed operations roll back and record nothing.
- **Checkpoints** snapshot the whole project (auto "Draft 0" at creation).
- Line **diff** engine + a diff viewer (additions/deletions/modifications).
- **Revert** a single change set or to a checkpoint — non-destructive
  (history is append-only; the revert is itself recorded), with in-memory state
  reloaded afterwards.
- A **staging transaction** (stage → validate → present → commit/discard) ready
  for future AI operations.
- UI: a History tab (change sets + checkpoints) and a diff viewer with revert.

See [VERSIONING.md](VERSIONING.md).

## Phase 6 — Provider-independent language-model infrastructure ✅

The layer every AI feature is built on, deliberately bound to no single vendor.

- `LanguageModel` with four capabilities — `generateText`, `streamText`,
  `generateStructured`, `runWithTools` — plus a declared `ModelCapabilities`
  record, so a provider need not support everything and unsupported use fails
  typed rather than confusingly.
- **Model registry**: `ModelDescriptor` metadata (provider, model id, display
  name, capabilities, context window, cost) as data. No product behaviour is
  hard-coded around a current model name.
- **Typed failures**: one `ModelError` with a `modelCode` covering network,
  rate limit, auth, malformed output, timeout, cancellation, unsupported
  capability and provider errors.
- **Anthropic adapter**: the first functioning provider — text, SSE streaming,
  structured output and tool calling — with every wire shape private to the
  package.
- **Mock provider**: deterministic, records calls, can disable capabilities and
  inject any failure, so the whole abstraction is tested with no external API.
- **API keys** in operating-system secure storage via the desktop host, never in
  a Story Repository.
- UI: model settings (choose provider, choose model, store key, test connection).

Per-task routing policy, cost limits and privacy routing come later.

See [MODEL_ROUTER.md](MODEL_ROUTER.md).

## Phase 7 — Agent runtime & fiction-project tool system ✅

The first real agent, and the moment the core paradigm becomes demonstrable: **AI
inspects a structured fiction project through dedicated tools instead of
receiving the whole project in a prompt.**

- **Typed tool system**: name, description, input/output schemas, permission and
  handler. Every call is resolved, permission-checked, argument-validated,
  executed, output-validated and logged — a model that asks for a forbidden tool
  or malformed arguments never reaches a handler.
- **Thirteen read-only tools**: files (`list_project_files`, `read_file`,
  `read_range`, `search_project`), entities (`get_project`, `get_chapter`,
  `get_scene`, `get_character`, `get_location`, `get_plot_thread`) and
  deterministic graph queries (`get_scenes_by_character`, `…_by_location`,
  `…_by_plot_thread`).
- **Permissions architecture** with two independent gates (the agent's granted
  permissions and the task's tool allow-list). Phase 7 runs read-only; the write
  permissions are declared so mutating tools slot into an existing model.
- **Persistent `AgentTask`** (goal, status, scope, allowed tools, approval
  policy) with an enforced lifecycle, stored in `.writer/agents/` — task state
  lives in the project, not in a chat transcript.
- **Activity log** of actions — tool, argument summary, result summary,
  timestamp, status. Never model reasoning.
- **Path safety**: agent-supplied paths cannot escape the project root, and
  `.writer/` internals are refused.
- **Investigating agent**: a bounded tool loop, then one schema-validated answer
  that keeps retrieved project content separate from model interpretation.
- UI: an Agent panel (ask, live activity, grounded answer, cancel, recent tasks).

Broad autonomous manuscript rewriting is deliberately **not** enabled here.

See [AGENT_RUNTIME.md](AGENT_RUNTIME.md) and [AGENT_TOOLS.md](AGENT_TOOLS.md).

## Phase 8 — Context Compiler V1 ✅

Explicit, task-specific context assembly — so no writing operation ever has to
build a giant prompt out of random project files.

- **`ContextPackage`** with fixed, ordered sections (task, target, primaryText,
  adjacentScenes, characters, locations, plotThreads, styleRules, worldRules,
  additionalRetrievedContext).
- **Provenance on every element**: a machine-readable rule, a sentence a user
  reads (`participant in SCENE_0042`), and the chain of IDs that led there.
- **Three explicit recipes** — scene inspection, scene rewrite (which composes
  it and adds style and character-voice material), and chapter inspection (which
  takes neighbouring chapters as summaries, never as prose). There is
  deliberately no universal recipe.
- **Token budget** with an output reserve and priority bands. Nothing is
  silently truncated: elements degrade through declared steps — full, summary,
  reference, excluded — and every degradation is recorded with its cost and
  reason. Prose excerpts state inline how much was omitted. The task and target
  are always present, even when the budget cannot fit them.
- **Deterministic first**: selection follows the project's own references with a
  total ordering, so compiling twice yields an identical package. Semantic
  retrieval augments this later.
- **Package rendering** — the pure function that turns a package into the text a
  model call receives, so the inspector and the model cannot diverge.
- UI: a Context tab that compiles any recipe against any scene or chapter at a
  chosen budget and shows what was selected, why, what the budget did, and the
  exact compiled text.

See [CONTEXT_COMPILER.md](CONTEXT_COMPILER.md).

## V1 (remaining) — Writing IDE

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

`/write-book` means _launch a persistent, stateful, validated, multi-stage production pipeline_ — not "ask a model for a novel."

## V6 — Ecosystem

- plugin protocol · agent sharing · skill sharing · genre modules · marketplace
- external research tools · publishing integrations · richer import/export
- series/universe support · collaboration · community extensions

## Milestone ladder (cross-cutting)

1. AI can safely and intelligently operate on a structured fiction project. _(V1)_
2. The system understands enough story structure to reason about consequences across the project. _(V2)_
3. Specialised agents can collaboratively perform professional-scale workflows. _(V3)_
4. The system can simulate readers and characters to test narrative behaviour. _(V4)_
5. The harness can reliably execute novel-scale production/revision over long periods with consistency, state, recoverability and human control. _(V5+)_

## First demonstration target

An early demo that shows why this product is different (`MASTER_BUILD.md` §66): create a mystery project, five characters, a premise, a 12-chapter outline, draft Chapter 1, establish structured state — then _"Change Marcus from Elias's brother to his childhood friend,"_ run the refactor blast-radius analysis, apply on a branch, show diffs, run a Story Build. This is a far stronger demonstration than generating prose.
