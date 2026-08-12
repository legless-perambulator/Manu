# JellyTind

An AI-native fiction development environment — a structured **fiction operating environment** inspired by AI coding IDEs and coding-agent harnesses.

This is **not** a chatbot with a writing editor attached. It lets AI agents inspect, understand, modify, validate, debug, refactor and build large fiction projects using persistent project state, specialised tools, structured story entities, context compilation, versioning and deterministic orchestration.

> **The model is not the product. The harness around the model is the product.**

## Start here

- [`MASTER_BUILD.md`](MASTER_BUILD.md) — the permanent north-star product specification and architecture vision.
- [`AGENTS.md`](AGENTS.md) — implementation rules for coding agents working in this repository. **Read before making significant architectural decisions.**
- [`docs/`](docs/) — living architecture and product documentation. See [`docs/README.md`](docs/README.md) for the index.

## Status

**Phase 12 complete.** Implemented and tested so far:

- **Phase 0** — monorepo, tooling, stable branded entity IDs, persistence and
  model-provider boundaries, Tauri + React desktop shell.
- **Phase 1** — the Story Repository: portable on-disk project format, atomic
  root-confined writes, SQLite index, project creation/open/validate UI.
- **Phase 3** — fiction-domain entities (characters, locations, objects, plot
  threads, facts, world rules, events, relationships) with referential
  integrity and an entity inspector.
- **Phase 4** — project search and retrieval: lexical index, structured
  queries, global search UI.
- **Phase 5** — revision history: change sets, checkpoints, diffs, revert, and
  a staging transaction ready for AI operations.
- **Phase 6** — provider-independent language-model infrastructure: the
  `LanguageModel` interface with declared capabilities, a model registry, typed
  failures, streaming, structured-output validation, tool calling, a
  deterministic mock provider, the Anthropic adapter, API keys in OS secure
  storage, and a model settings screen.
- **Phase 7** — the agent runtime: a typed, permission-checked tool system with
  thirteen read-only project tools, persistent agent tasks, an activity log, and
  an investigating agent that inspects a project through tools rather than being
  handed the manuscript — with an Agent panel to drive it.
- **Phase 8** — Context Compiler V1: task-specific context packages with
  provenance on every element, three explicit recipes, a token budget that
  degrades through declared steps instead of truncating silently, and a Context
  tab for inspecting exactly what a model would receive.
- **Phase 9** — controlled AI manuscript editing: rewrite a selection, rewrite a
  scene or continue a scene, with the model proposing rather than writing —
  staged, diffed, accepted hunk by hunk, and fully audited and revertible.
- **Phase 10** — Story State V1: deterministic, time-aware state built from
  scene-anchored transitions, answering _where was Elias before Scene 42?_ and
  _did Mara know about the vault yet?_ without re-reading the manuscript — with
  manual correction, AI extraction that proposes rather than canonises, and
  state carried into compiled context.
- **Phase 11** — the character knowledge and belief graph: objective truth,
  knowledge, belief and false belief kept separate, with acquisition sources,
  traceable information chains, deterministic continuity checks, and selected
  knowledge carried into compiled context.
- **Phase 12** — dynamic relationship state: stable identity with evolving type,
  status, optional analytical dimensions and milestones, queryable at any story
  moment, with a chapter-by-chapter timeline view and context that never shows an
  earlier scene a later scene's relationship.

Implementation proceeds as vertical slices — see
[`docs/ROADMAP.md`](docs/ROADMAP.md) and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Repository layout

```
apps/desktop/            Tauri + React desktop shell
packages/                domain, persistence, model-router, story-compiler,
                         agent-runtime, context-compiler, editing, search,
                         story-repository, story-state, shared,
                         providers/anthropic
docs/                    living architecture documentation
```

## Getting started

Prerequisites: **Node ≥ 20**, **pnpm 10**. Building the native desktop app also
requires the **Rust toolchain** and the standard [Tauri system
dependencies](https://v2.tauri.app/start/prerequisites/) (on Debian/Ubuntu:
`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libsoup-3.0-dev`, `librsvg2-dev`).

```bash
pnpm install        # install workspace dependencies
pnpm check          # typecheck + lint + format:check + test
pnpm test           # unit tests (Vitest)
pnpm dev            # frontend dev server (UI in a browser)
pnpm dev:desktop    # full desktop app via Tauri (requires a display)
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full command list and
the package dependency graph.
