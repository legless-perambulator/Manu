# Manu

A writing IDE for fiction — a structured **fiction operating environment**
inspired by AI coding IDEs and coding-agent harnesses.

> _manus_ → hand → _manuscript_ → _amanuensis_.
> **You are the author. Manu is the hand.**

This is **not** a chatbot with a writing editor attached. It lets AI agents inspect, understand, modify, validate, debug, refactor and build large fiction projects using persistent project state, specialised tools, structured story entities, context compilation, versioning and deterministic orchestration.

> **The model is not the product. The harness around the model is the product.**

## Start here

- [`MASTER_BUILD.md`](MASTER_BUILD.md) — the permanent north-star product specification and architecture vision.
- [`AGENTS.md`](AGENTS.md) — implementation rules for coding agents working in this repository. **Read before making significant architectural decisions.**
- [`docs/`](docs/) — living architecture and product documentation. See [`docs/README.md`](docs/README.md) for the index.

## Status

**Phase 28 complete** — `0.1.0-alpha`, with distributable Linux AppImage and Flatpak packages.
Implemented and tested so far:

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
- **Phase 20** — Story Refactor V1: _make Marcus Elias's childhood friend
  instead_ becomes an analysed, planned, staged and validated change. The
  system finds what it reaches through the structured systems and the search
  index, names the risks, plans the edits, takes a checkpoint, stages them, and
  runs the Story Build and the writer's own story tests **against a shadow copy
  of the project** — then commits one revertible change set only when the
  writer approves. Stable IDs never move, and the whole operation is recorded.

- **Phase 20.5** — the Manu brand and a UX consistency pass: one canonical
  token system built on the four brand colours, the `manu` wordmark outlined
  from Martian Grotesk, fifteen panels grouped into four, a command palette and
  a keyboard layer, the manuscript set as prose rather than as a text field,
  Paper and Manu Black themes, empty states and microcopy that say what to do
  next — and the first real desktop package: `Manu-0.1.0-alpha`, standalone,
  as a Linux AppImage. See [`docs/BRAND.md`](docs/BRAND.md),
  [`docs/UX.md`](docs/UX.md) and [`docs/BUILDING.md`](docs/BUILDING.md).

- **Phase 21** — Story Branching: alternative versions of the _whole_ project.
  _What if Marcus survives Chapter 28?_ becomes a version you can write into
  without risking the book you have. Isolation is total because every subsystem
  reads through one store interface and the branch is a copy-on-write view of
  it — manuscript, state, knowledge, relationships, timeline, objects, threads,
  tests and dependencies all at once. Versions compare on both halves, prose and
  records matched by stable ID; merges take only what is unambiguous and report
  the rest as conflicts, because fiction does not merge like code. The build
  belongs to the branch that produced it.

- **Phase 22** — the Author Voice system: a persistent, inspectable model of
  how the writer writes, and deliberately **not** one enormous system prompt.
  Rules they stated, passages they marked, and tendencies a model observed —
  each labelled, evidenced and proposed rather than assumed. The Context
  Compiler retrieves only the slice an operation needs, so a dialogue rewrite is
  not handed preferences about landscape. Rules carrying a phrase are checked
  exactly; rules that need a reading are reported as unchecked rather than
  passed. Nothing is inferred from a single rejection.

- **Phase 23** — character voice: persistent speech identities, so a dialogue
  task tells Elias from Mara using project data rather than their character
  descriptions. Thirteen optional qualitative attributes in the writer's own
  words, example lines that keep their source, and voice that is allowed to
  change — shifts are scene-anchored and replayed, so a character who has lost a
  brother by chapter 30 is not flagged as inconsistent. Differentiation reports
  a band with its caveat and never a percentage, measurements describe the
  recorded lines rather than the character, and a sample too small to support a
  statistic produces no finding at all.

- **Phase 24** — specialised writing agents: nine of them, and each one a
  _configuration_ rather than a chat persona. A Copy Editor is not a Story
  Architect with a politer prompt; it holds three read tools, compiles no story
  context and runs on a fast model, while the Architect alone reaches refactor
  analysis and the Continuity Editor alone holds the whole build/test/debug
  surface. The difference is enforced: a specialist's tool list _is_ its
  permission grant, and the model is never even shown a tool its specialist does
  not hold. None may delete, apply a refactor, or fork canon onto a private
  branch. See [`docs/SPECIALIST_AGENTS.md`](docs/SPECIALIST_AGENTS.md).

- **Phase 25** — Writing Skills: `/character-pass`, `/continuity-audit`,
  `/dialogue-pass`, `/pacing-audit`, `/foreshadowing-audit`,
  `/scene-purpose-audit`, `/remove-ai-tendencies`. A skill is an **executable
  workflow**, not a saved prompt: a sequence of structured queries against the
  project, each writing down what it found before the next one starts, so the
  same run on an unchanged project says the same thing twice. Progress shows
  step by step; a step that could not run says why and never counts as passed;
  and because every step's output is persisted as it completes, a run
  interrupted at step three resumes at step three — across a restart. Writers
  compose their own from the same operation registry, as a file in the project.
  See [`docs/WRITING_SKILLS.md`](docs/WRITING_SKILLS.md).

- **Phase 26** — controlled multi-agent orchestration: _develop and draft
  Chapter 17_ becomes a workflow the writer watches run. Architect → Scene
  Director → **approve** → Drafter → three editors in parallel → merge →
  checkpoint → **approve** → write → build, with a conditional diagnosis if the
  build breaks. Specialists never talk to each other: they hand back typed
  artifacts — chapter brief, scene plan, draft, continuity report — each
  validated before the next agent sees it. Where the editors want different
  things for the same scene, **both positions are kept** and the writer settles
  it; approval is refused while a disagreement is open. Steps declare a routing
  class rather than a model, and the run counts calls and tokens per class
  without inventing money. See
  [`docs/ORCHESTRATION.md`](docs/ORCHESTRATION.md).

- **Phase 27** — the Reader Simulator: readers who experience the manuscript
  **sequentially**, and are never shown a page they have not reached. The
  guarantee is structural rather than instructed — a reader is handed one
  packet, built by a subtractive context recipe that carries prose up to this
  chapter and **no project records at all**, because a character sheet is what
  the author knows. State persists: chapter eleven is read by the person
  chapter ten produced, carrying their suspicions, trust, attachment,
  predictions, questions and confusion forward. Four readers ship — genre
  expert, casual, emotion-focused, critical developmental — and writers add
  their own. Attitudes are bands with reasons, never percentages, charted
  across the book with the caveat attached. Rewrite chapter four and the run
  says so, marks chapters four onward stale and nothing earlier, and re-reads
  from there with the reader who finished chapter three. See
  [`docs/SIMULATIONS.md`](docs/SIMULATIONS.md).

- **Phase 28** — the Character Simulator: _would Mara really enter the house
  alone here?_ Everything about her is reconstructed at the boundary
  **entering** the scene, and the two things that would ruin the answer are
  excluded by construction — nothing from later in the book, and no proposition
  she has not been told, which is counted and withheld rather than handed over.
  Personality is the author's own: a model may propose a trait, but only
  confirmed ones reach a simulation. Hard contradictions are settled by the
  project — recorded elsewhere, recorded deceased, or acting on information
  nobody gave her; everything a model raises is a labelled reading. There is no
  percentage anywhere, and a test asserts it: a band with its reasoning, and the
  counts behind it stated as counts. Counterfactuals and conditions are
  advisory and applied to nothing, and an agency audit finds where someone acts
  because the plot needs them to. See
  [`docs/SIMULATIONS.md`](docs/SIMULATIONS.md).

Implementation proceeds as vertical slices — see
[`docs/ROADMAP.md`](docs/ROADMAP.md) and
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Repository layout

```
apps/desktop/            Tauri + React desktop shell
packages/                domain, persistence, model-router, story-compiler,
                         story-debugger, story-causality, story-refactor,
                         agent-runtime, character-sim, context-compiler, editing,
                         orchestration, reader-sim, search, skills,
                         story-repository, story-state, shared,
                         providers/anthropic
docs/                    living architecture documentation
scripts/                 brand-asset and development-fixture generators
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
pnpm dev:fixture    # write a small development project to ./.dev/blackthorn
```

To build the distributable AppImage, see [`docs/BUILDING.md`](docs/BUILDING.md).

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full command list and
the package dependency graph.
