# AGENTS.md

Implementation rules for coding agents working in this repository.

## Project Purpose

This repository contains an AI-native fiction development environment.

The product is not a chatbot with a writing editor attached.

It is a structured fiction operating environment inspired by AI coding IDEs and coding-agent harnesses.

The application must allow AI agents to inspect, understand, modify, validate, debug, refactor and build large fiction projects using persistent project state, specialised tools, structured story entities, context compilation, versioning and deterministic orchestration.

Read `MASTER_BUILD.md` before making significant architectural decisions.

---

## Core Architectural Principle

The central principle of this project is:

> **The model is not the product. The harness around the model is the product.**

Language models provide:

- reasoning
- interpretation
- semantic analysis
- creativity
- prose generation

Application code provides:

- state
- persistence
- file operations
- workflows
- permissions
- validation
- indexing
- versioning
- dependency management
- checkpoints
- branching
- deterministic tests
- orchestration

Do not use an LLM where reliable deterministic software can perform the task.

---

## Story Repository Is Source of Truth

The project repository is authoritative.

Chat history is not authoritative.

Model memory is not authoritative.

Cached summaries are not authoritative.

Derived indexes are not authoritative.

Every important canonical piece of project information must ultimately resolve back to the Story Repository or explicitly confirmed structured story state.

---

## Domain Architecture

Maintain strict separation between:

1. UI
2. Application services
3. Story domain
4. Agent runtime
5. Context Compiler
6. Story Compiler
7. Persistence
8. Model providers
9. Search/indexing
10. External integrations

UI code must not become the authoritative implementation of story logic.

Model-provider code must not leak throughout the application.

Agent prompts must not become substitutes for domain modelling.

---

## Stable Entity IDs

All meaningful story entities must have stable internal IDs.

Never use names as primary identity.

Examples:

- `CHAR_0001`
- `SCENE_0001`
- `CHAPTER_0001`
- `LOC_0001`
- `THREAD_0001`
- `FACT_0001`
- `OBJECT_0001`
- `EVENT_0001`

Names and titles can change.

IDs should remain stable.

---

## AI Mutation Rules

Every meaningful AI mutation must be:

- attributable
- inspectable
- reversible
- validated where applicable
- recorded in revision history

Before large AI operations, create a checkpoint or equivalent safe state.

Do not allow an LLM response to directly overwrite substantial project content without going through the application's mutation layer.

---

## Structured LLM Output

Whenever an LLM returns structured information:

1. define a schema
2. request structured output
3. validate the output
4. repair or retry if appropriate
5. reject invalid mutations
6. log the failure

Never trust malformed or partial model JSON.

Use strongly typed schemas.

---

## Canon vs Inference

Never silently convert model interpretation into canonical story state.

Distinguish at minimum:

- confirmed canon
- deterministic derived information
- author note
- model inference
- suggestion
- unverified information

When extracting story state from prose, subjective or uncertain conclusions should remain proposed changes until confirmed or otherwise approved by defined workflow rules.

---

## Context Rules

Do not blindly load entire novels into model context.

The Context Compiler should retrieve information based on task requirements.

Potential sources include:

- target text
- neighbouring scenes
- involved characters
- current character states
- locations
- active plot threads
- story rules
- knowledge state
- reader state
- style rules
- semantic search
- lexical search
- summaries
- user-pinned context

Context construction should be explicit and inspectable.

---

## Deterministic Orchestration

Complex workflows should be software-controlled.

Do not implement major operations as a single prompt such as:

> "Write this entire chapter."

Instead orchestrate:

- retrieve state
- compile context
- plan
- validate
- draft
- extract changes
- run checks
- checkpoint
- continue

LLMs should perform bounded reasoning/generation steps inside deterministic workflows.

---

## Provider Independence

Do not bind core architecture to Anthropic, Claude or any other provider.

Claude may be the first provider used during development.

All model operations must go through provider-independent interfaces.

Future support should be possible for:

- Anthropic
- OpenAI
- Google
- OpenRouter
- Ollama
- local models
- OpenAI-compatible endpoints

---

## Local-First Principles

The writer's project should remain portable.

Prefer human-readable project files such as:

- Markdown
- YAML
- JSON

Use SQLite or equivalent local storage for structured state and indexing where beneficial.

Do not make a user's manuscript dependent on proprietary cloud storage.

---

## Human Writing Is First Class

The application must remain useful without AI.

Do not design the editor as merely an AI output viewer.

The user must be able to:

- write manually
- organise manually
- edit manually
- search
- navigate
- annotate
- inspect versions
- use project structure

AI enhances the environment.

It does not replace the writing environment.

---

## UI Principles

The eventual interface should feel more like an IDE than a chat application.

Primary conceptual layout:

- project explorer on left
- editor/workspace in centre
- inspector/AI on right
- activity/task panel below

Do not make chat the dominant visual metaphor.

---

## Testing

All domain logic requires tests.

Prioritise tests for:

- IDs
- repository operations
- mutations
- revision history
- state transitions
- validation
- Context Compiler selection
- Story Compiler checks
- model response parsing
- failure recovery

Do not rely only on end-to-end manual testing.

---

## Incremental Development

Do not attempt to build all of `MASTER_BUILD.md` at once.

Build vertical slices.

For each capability:

1. define domain model
2. define persistence
3. define application service
4. define UI
5. define agent tools if relevant
6. define LLM responsibility if relevant
7. define validation
8. define tests
9. implement
10. document

Finish a coherent slice before beginning multiple unrelated large systems.

---

## No Fake Features

Do not build UI controls that imply capabilities that do not exist.

Do not create placeholder buttons for major future features unless clearly labelled as unavailable during development.

Avoid visual mockups masquerading as functioning architecture.

---

## Refactoring

Before large structural changes:

- inspect existing architecture
- explain affected modules
- preserve existing tests where possible
- add migration logic where required

Do not casually rewrite the application architecture because a new feature appears easier another way.

---

## Documentation

Maintain the documentation in `/docs`.

When architecture materially changes, update the appropriate documentation.

Important documents include:

- `VISION.md`
- `ARCHITECTURE.md`
- `DOMAIN_MODEL.md`
- `STORY_REPOSITORY.md`
- `STORY_STATE.md`
- `CONTEXT_COMPILER.md`
- `STORY_COMPILER.md`
- `AGENT_RUNTIME.md`
- `AGENT_TOOLS.md`
- `MODEL_ROUTER.md`
- `VERSIONING.md`
- `STORY_REFACTOR.md`
- `STORY_DEBUGGER.md`
- `SIMULATIONS.md`
- `SECURITY_PRIVACY.md`
- `UX.md`
- `ROADMAP.md`

---

## Working Behaviour

Before implementing a major feature:

1. read `MASTER_BUILD.md`
2. read `AGENTS.md`
3. inspect relevant documentation
4. inspect current implementation
5. identify affected systems
6. present an implementation plan
7. implement
8. run tests
9. resolve failures
10. summarise changes
11. update documentation if necessary

Do not implement blindly from a single user sentence when repository context already exists.

---

## Definition of Success

The application succeeds when AI can reliably operate on fiction projects that are too large and complex to treat as ordinary chat context.

The long-term system should allow a writer to ask:

> "Change this character's role and tell me what breaks."

> "Trace everything this character knows before this scene."

> "Run continuity across the manuscript."

> "Draft this chapter from the approved scene plan."

> "Investigate why this reveal does not work."

> "Create an alternative branch and compare it."

> "Run reader simulations."

> "Build the next five chapters while preserving story state."

Each of those operations must be powered by persistent infrastructure rather than prompt tricks.

Always protect that architectural direction.
