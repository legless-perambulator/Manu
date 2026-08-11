# ARCHITECTURE

How the codebase is organised, where the boundaries are, and which way
dependencies point. This is the map that keeps subsystems from leaking into one
another. For the product vision see [`VISION.md`](VISION.md); for the full
north-star spec see [`../MASTER_BUILD.md`](../MASTER_BUILD.md).

## Status

**Phases 1, 3, 4 & 5 implemented.** On the Phase-0 foundation: the persistent
Story Repository, the fiction-domain **entity graph** with referential integrity,
deterministic **search & retrieval** (`@jellytind/search`), and **revision
history** — journaled change sets, checkpoints, diffs, revert, and a staging
transaction — are built and tested, with a functional desktop workbench (files,
entities, inspector, search, history/diff). The remaining subsystem packages are
typed interfaces marked **PLANNED**; features continue as vertical slices (see
[`ROADMAP.md`](ROADMAP.md)).

## Repository layout

A pnpm-workspaces monorepo. Applications live in `apps/`, libraries in
`packages/`, provider adapters in `packages/providers/`.

```
/
├── apps/
│   └── desktop/                 @jellytind/desktop — Tauri + React shell
│       ├── src/                 React renderer (UI)
│       └── src-tauri/           Rust host process (window, commands, FS access)
├── packages/
│   ├── shared/                  @jellytind/shared        — Result, errors, branding, logging
│   ├── domain/                  @jellytind/domain        — branded entity IDs + generation
│   ├── persistence/             @jellytind/persistence   — storage interfaces + in-memory impls
│   ├── story-repository/        @jellytind/story-repository — project = source of truth (PLANNED)
│   ├── model-router/            @jellytind/model-router  — LanguageModel interface, registry, secrets, routing
│   ├── context-compiler/        @jellytind/context-compiler — task context construction (PLANNED)
│   ├── story-compiler/          @jellytind/story-compiler — deterministic/semantic checks
│   ├── agent-runtime/           @jellytind/agent-runtime — typed tools, tasks, agents
│   ├── search/                  @jellytind/search        — lexical search (semantic PLANNED)
│   └── providers/
│       └── anthropic/           @jellytind/provider-anthropic — Anthropic adapter (isolated)
├── docs/                        living architecture documentation
├── MASTER_BUILD.md              north-star product specification
└── AGENTS.md                    implementation rules for coding agents
```

## Layered architecture

Each layer may depend only on layers below it. The package graph enforces this.

```
┌───────────────────────────────────────────────────────────────┐
│ apps/desktop (UI)                                               │
│   renderer imports domain + shared; Rust host owns FS/window    │
├───────────────────────────────────────────────────────────────┤
│ Application services  (PLANNED: orchestration, tasks, approvals)│
├───────────────┬───────────────┬───────────────────────────────┤
│ agent-runtime │ context-       │ story-compiler                 │
│               │ compiler       │                                │
├───────────────┴───────────────┴───────────────────────────────┤
│ story-repository            model-router (+ providers/*)        │
├───────────────────────────────────────────────────────────────┤
│ domain            persistence            search                 │
├───────────────────────────────────────────────────────────────┤
│ shared (no dependencies)                                        │
└───────────────────────────────────────────────────────────────┘
```

### Dependency edges (current)

| Package              | Depends on                                                       |
| -------------------- | ---------------------------------------------------------------- |
| `shared`             | —                                                                |
| `domain`             | `shared`                                                         |
| `persistence`        | `shared`, `domain`                                               |
| `story-repository`   | `shared`, `domain`, `persistence`, `search`                      |
| `model-router`       | `shared`                                                         |
| `provider-anthropic` | `shared`, `model-router`                                         |
| `search`             | `shared`, `domain`                                               |
| `story-compiler`     | `shared`, `domain`                                               |
| `context-compiler`   | `shared`, `domain`                                               |
| `agent-runtime`      | `shared`, `domain`, `model-router`                               |
| `apps/desktop`       | `domain`, `persistence`, `story-repository`, `shared` (renderer) |

There are no cycles. `shared` is a sink; the UI is a source.

### Browser-safe vs Node-only code

`@jellytind/persistence` has two entry points. The main barrel is **browser-safe**
(pure TypeScript, no `node:*`) and is what the renderer bundles transitively via
`@jellytind/story-repository`. Node-only filesystem/SQLite adapters live behind the
`@jellytind/persistence/node` subpath and are imported only by tests and Node
hosts — never by the renderer. The desktop app reaches the real filesystem through
root-confined Rust commands (see [`STORY_REPOSITORY.md`](STORY_REPOSITORY.md)).

## Boundary rules (enforced by structure)

- **UI must not implement story logic.** The renderer imports domain types and
  renders them; it never becomes the source of truth. Filesystem access is
  mediated by the Rust host, not done ad hoc in React.
- **Provider code must not leak.** All model access goes through the
  `LanguageModel` interface in `@jellytind/model-router`. Anthropic-specific wire
  shapes live only inside `@jellytind/provider-anthropic` (`wire.ts`, `sse.ts`,
  `mapping.ts`) and are never re-exported; every failure crosses the boundary as
  a typed `ModelError`. See [`MODEL_ROUTER.md`](MODEL_ROUTER.md).
- **Credentials are not project content.** Provider API keys are held by the
  desktop host in OS secure storage and never written into a Story Repository,
  its manifest, its entities or its history.
- **Agent prompts are not domain modelling.** Rules that can be encoded in the
  domain or checked deterministically live in code (e.g. `@jellytind/domain`
  ID invariants, `@jellytind/story-compiler` checks), not in a prompt.
- **The domain layer is authoritative.** UI components and model responses never
  own domain state.

## The determinism boundary

The most important line in the product separates **process** from **intelligence**:

- **Software controls**: loops, state transitions, permissions, branching,
  validation, file I/O, versioning, dependency resolution, retries, approvals.
  Examples already in code: `SequentialIdGenerator`, `runChecks`, `ModelRouter`,
  `parseModelJson`.
- **LLMs perform**: bounded creativity, interpretation, semantic reasoning, and
  language understanding _inside_ deterministic workflows, via `LanguageModel`.

Never use an LLM where deterministic software suffices; never let a raw model
response mutate the project (structured output is schema-validated by
`parseModelJson` before use).

## Source-of-truth hierarchy

Authoritative → derived: (1) Story Repository files + confirmed structured state,
(2) deterministic derived data (indexes, computed state), (3) model
inference/suggestions (proposed until confirmed), (4) cached summaries, (5) chat
history / model memory (never authoritative). See
[`STORY_REPOSITORY.md`](STORY_REPOSITORY.md).

## Module resolution & build model

- Workspace packages export their **TypeScript source** (`"main": "./src/index.ts"`)
  and are wired both by pnpm symlinks and by `paths` in `tsconfig.base.json`.
  Vite and Vitest consume source directly; there is no separate library build
  step in Phase 0.
- **Typecheck** is a single root pass over `packages/**` plus a DOM/JSX pass over
  the desktop app.
- The desktop app is bundled by **Vite**; the Rust host embeds the built
  frontend via `tauri::generate_context!` and is compiled by **Cargo**.

## Tooling

| Concern                | Tool                                                                       |
| ---------------------- | -------------------------------------------------------------------------- |
| Language               | TypeScript (strict; `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, …) |
| UI                     | React 18 + Vite 6                                                          |
| Desktop shell          | Tauri 2 (Rust host)                                                        |
| Unit tests             | Vitest 2 (+ `expectTypeOf` for type-level tests)                           |
| Lint                   | ESLint 9 (flat config) + typescript-eslint                                 |
| Format                 | Prettier 3                                                                 |
| Package manager        | pnpm 10 workspaces                                                         |
| Structured local state | SQLite (PLANNED adapter behind `StateStore`)                               |

## Root commands

| Command                        | Action                                                    |
| ------------------------------ | --------------------------------------------------------- |
| `pnpm dev`                     | Vite dev server for the desktop frontend (browser-run UI) |
| `pnpm dev:desktop`             | `tauri dev` — full desktop app (requires a display)       |
| `pnpm build`                   | Typecheck, then Vite-build the frontend                   |
| `pnpm build:desktop`           | `tauri build` — bundle the native app                     |
| `pnpm typecheck`               | `tsc --noEmit` over all packages + the app                |
| `pnpm test`                    | Run the Vitest suite                                      |
| `pnpm lint`                    | ESLint over the repo                                      |
| `pnpm format` / `format:check` | Prettier write / verify                                   |
| `pnpm check`                   | typecheck + lint + format:check + test                    |

## Scale assumption

Every core subsystem assumes the whole project does **not** fit in model context
— short stories through 200,000-word novels, trilogies, and large worldbuilding
repositories. Retrieval, state, and checks are designed around that.
