# Documentation

Living architecture and product documentation for **Manu**, an AI-native fiction development environment.

The permanent north-star vision and full product specification lives in [`../MASTER_BUILD.md`](../MASTER_BUILD.md). Implementation rules for coding agents live in [`../AGENTS.md`](../AGENTS.md).

These documents are **living**: update the relevant document whenever an architectural decision materially changes. They describe intended architecture and current status, and each is explicit about which parts are implemented versus planned.

## Index

| Document                                     | Purpose                                                   |
| -------------------------------------------- | --------------------------------------------------------- |
| [VISION.md](VISION.md)                       | Why this product exists and what "done" means.            |
| [ARCHITECTURE.md](ARCHITECTURE.md)           | System layers, boundaries and dependency direction.       |
| [DOMAIN_MODEL.md](DOMAIN_MODEL.md)           | Core fiction domain entities and their relationships.     |
| [STORY_REPOSITORY.md](STORY_REPOSITORY.md)   | On-disk project structure and persistence contract.       |
| [STORY_STATE.md](STORY_STATE.md)             | Machine-readable story state, truth/belief/knowledge.     |
| [TIMELINE.md](TIMELINE.md)                   | Story-world chronology versus manuscript presentation.    |
| [OBJECTS_LOCATIONS.md](OBJECTS_LOCATIONS.md) | Object continuity, nested locations, physical checks.     |
| [NARRATIVE_THREADS.md](NARRATIVE_THREADS.md) | Plot-thread lifecycle, setups, payoffs, foreshadowing.    |
| [CAUSALITY.md](CAUSALITY.md)                 | The story dependency graph and blast-radius analysis.     |
| [SEARCH.md](SEARCH.md)                       | Deterministic full-text + structured retrieval.           |
| [CONTEXT_COMPILER.md](CONTEXT_COMPILER.md)   | How working context is constructed for each operation.    |
| [STORY_COMPILER.md](STORY_COMPILER.md)       | Deterministic + semantic story checks and the build.      |
| [STORY_TESTS.md](STORY_TESTS.md)             | Writer-authored assertions the build holds the story to.  |
| [AGENT_RUNTIME.md](AGENT_RUNTIME.md)         | Agent orchestration, tasks and multi-agent coordination.  |
| [AGENT_TOOLS.md](AGENT_TOOLS.md)             | The typed tool surface agents operate through.            |
| [MODEL_ROUTER.md](MODEL_ROUTER.md)           | Provider-independent model abstraction and routing.       |
| [AI_EDITING.md](AI_EDITING.md)               | Controlled AI manuscript editing: propose, review, apply. |
| [VERSIONING.md](VERSIONING.md)               | Revisions, diffs, checkpoints, branches, audit trail.     |
| [STORY_REFACTOR.md](STORY_REFACTOR.md)       | Analyse, plan, stage, validate and commit a story change. |
| [STORY_DEBUGGER.md](STORY_DEBUGGER.md)       | Diagnostic workflow that investigates before editing.     |
| [SIMULATIONS.md](SIMULATIONS.md)             | Reader and character simulation systems.                  |
| [SECURITY_PRIVACY.md](SECURITY_PRIVACY.md)   | Local-first ownership, data handling, privacy posture.    |
| [UX.md](UX.md)                               | Interface principles and the IDE layout.                  |
| [BRAND.md](BRAND.md)                         | The canonical Manu brand: palette, wordmark, voice.       |
| [BUILDING.md](BUILDING.md)                   | Running from source and building the Linux AppImage.      |
| [ROADMAP.md](ROADMAP.md)                     | Versioned delivery plan (V1–V6).                          |

## How to use these documents

1. Before implementing a major feature, read `MASTER_BUILD.md`, `AGENTS.md`, and the relevant documents here.
2. Every subsystem document states its **responsibilities**, **key decisions**, **invariants**, and **status**.
3. When you materially change a subsystem, update its document in the same change.
