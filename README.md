# JellyTind

An AI-native fiction development environment — a structured **fiction operating environment** inspired by AI coding IDEs and coding-agent harnesses.

This is **not** a chatbot with a writing editor attached. It lets AI agents inspect, understand, modify, validate, debug, refactor and build large fiction projects using persistent project state, specialised tools, structured story entities, context compilation, versioning and deterministic orchestration.

> **The model is not the product. The harness around the model is the product.**

## Start here

- [`MASTER_BUILD.md`](MASTER_BUILD.md) — the permanent north-star product specification and architecture vision.
- [`AGENTS.md`](AGENTS.md) — implementation rules for coding agents working in this repository. **Read before making significant architectural decisions.**
- [`docs/`](docs/) — living architecture and product documentation. See [`docs/README.md`](docs/README.md) for the index.

## Status

**Phase 19 complete.** Implemented and tested so far:

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
- **Phase 13** — the Story Timeline Engine: story-world chronology held separate
  from manuscript order, so flashbacks, parallel events and nonlinear structure
  are first-class — with optional story time at any precision, ordering
  relations for stories that carry no calendar, character timelines, historical
  state queries, contradiction checks that never assume real-world travel, and a
  visual timeline.
- **Phase 14** — object continuity and location tracking: objects traced through
  the story by owner, holder, place, condition, status and visibility; nested
  locations that know the Hidden Vault is inside Blackthorn Manor; and six
  deterministic checks that find the revolver left in a flat and fired at the
  manor without a model re-reading a word.
- **Phase 15** — plot threads, setups and payoffs: thread lifecycle
  reconstructed at any point in the book, six ways a scene can touch a thread,
  dormancy measured rather than judged, first-class foreshadowing with the
  promises it makes and keeps, and context that never hands a scene what only
  the author knows.
- **Phase 16** — Story Compiler V1: press Build Story and get deterministic
  continuity diagnostics assembled from every recorded system — with evidence, a
  suggested action, click-through navigation, build history and a diff against
  the last build. The compiler consumes the existing checks rather than
  reimplementing them, and says plainly what it did not check.
- **Phase 17** — Story Tests: the writer's own assertions, written down and
  held to. _Elias must not know the killer's identity before chapter 37_ becomes
  a persistent, executable test that every build re-asks — built from a
  structured form rather than code, failing with expected state, actual state,
  the scene and the evidence. Semantic assertions are recorded in a separate
  type and reported as not evaluated, never as passing.
- **Phase 18** — Story Debugger V1: investigate before editing. _Why doesn't
  Marcus's betrayal land?_ becomes a structured investigation — what was
  planted, when the signals start, who already knew, how the relationship stood
  — answered from what the project records rather than with generic advice. The
  evidence half runs with no model at all; a model's reading is labelled as
  judgement, must cite the evidence it rests on, and proposes interventions
  nothing applies.
- **Phase 19** — the story causality and dependency graph: registered
  cause-and-effect between scenes, events, facts, threads, setups, objects and
  decisions, so _if I remove this scene, what depends on it?_ is answered from
  persistent story architecture rather than by asking a model. Blast radius
  explains every affected element with the path that reaches it, traversal is
  cycle-safe, deletion warns first, and a model may propose links but never
  register them.

Implementation proceeds as vertical slices — see
[`docs/ROADMAP.md`](docs/ROADMAP.md) and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Repository layout

```
apps/desktop/            Tauri + React desktop shell
packages/                domain, persistence, model-router, story-compiler,
                         story-debugger, story-causality, agent-runtime,
                         context-compiler, editing, search, story-repository,
                         story-state, shared, providers/anthropic
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
