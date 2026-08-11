# JellyTind

An AI-native fiction development environment — a structured **fiction operating environment** inspired by AI coding IDEs and coding-agent harnesses.

This is **not** a chatbot with a writing editor attached. It lets AI agents inspect, understand, modify, validate, debug, refactor and build large fiction projects using persistent project state, specialised tools, structured story entities, context compilation, versioning and deterministic orchestration.

> **The model is not the product. The harness around the model is the product.**

## Start here

- [`MASTER_BUILD.md`](MASTER_BUILD.md) — the permanent north-star product specification and architecture vision.
- [`AGENTS.md`](AGENTS.md) — implementation rules for coding agents working in this repository. **Read before making significant architectural decisions.**
- [`docs/`](docs/) — living architecture and product documentation. See [`docs/README.md`](docs/README.md) for the index.

## Status

**Phase 0 — technical foundation, complete.** The monorepo, tooling, domain
identity foundation (stable branded entity IDs), persistence and
model-provider boundaries, and a Tauri + React desktop shell are in place and
tested. No product features have been built yet. Implementation proceeds as
vertical slices — see [`docs/ROADMAP.md`](docs/ROADMAP.md) and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Repository layout

```
apps/desktop/            Tauri + React desktop shell
packages/                domain, persistence, model-router, story-compiler,
                         agent-runtime, context-compiler, search, story-repository,
                         shared, providers/anthropic
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
