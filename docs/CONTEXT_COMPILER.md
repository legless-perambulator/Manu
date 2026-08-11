# CONTEXT_COMPILER

The Context Compiler constructs the best possible working context for every AI operation. It is one of the core pieces of intellectual infrastructure in the product.

- **Package:** `@jellytind/context-compiler`
- **Depends on:** `@jellytind/domain`, `@jellytind/shared`
- **Status:** **PLANNED (V1).** The package defines the shapes — `ContextRecipe`, `ContextFragment`, `CompiledContext`, and the `ContextCompiler` interface. The compiler implementation (selection, budgeting, summarisation) is not yet built.

Its **retrieval foundation is now in place** (Phase 4): deterministic full-text
and structured search (`@jellytind/search` + the repository's `searchText` and
structured queries), plus a `SemanticSearchProvider` abstraction to add embeddings
later. The compiler will assemble context from these deterministic sources rather
than dumping the manuscript into a model. See [SEARCH.md](SEARCH.md).

Every included `ContextFragment` names its `source`, keeping compiled context
attributable and inspectable by construction.

## Principle

Conventional RAG is **not** the central intelligence architecture — it is one retrieval subsystem among many. The compiler does not blindly dump a 150,000-word manuscript into context. It assembles a task-specific, explicit, inspectable working set.

## Inputs to context selection

Context selection combines deterministic relationships with retrieval:

- deterministic relationships (entity references, scene/chapter adjacency)
- active plot threads
- character participation and current character state
- character knowledge and reader knowledge
- world rules and story rules
- location and object state
- timeline proximity
- relevant foreshadowing
- author style profile and character voice examples
- recent pacing information
- scene objectives / specification
- semantic search (embeddings)
- full-text (lexical) search
- summaries (hierarchical)
- user-pinned context

## Task-specific recipes

Different tasks require different context recipes. A continuity audit receives different context from a dialogue rewrite; a drafting agent receives different context from a copy editor.

Example: **Draft Scene 83** may compile:

```
TASK: Draft Scene 83.
SCENE SPECIFICATION / PREVIOUS SCENE / NEXT PLANNED SCENE
POV CHARACTER / CURRENT CHARACTER STATE / CHARACTERS PRESENT / RELATIONSHIPS
LOCATION STATE / RELEVANT WORLD RULES / ACTIVE PLOT THREADS
CHARACTER KNOWLEDGE / READER KNOWLEDGE / RELEVANT FORESHADOWING
AUTHOR STYLE PROFILE / CHARACTER VOICE EXAMPLES / RECENT PACING / SCENE OBJECTIVES
```

A recipe is a declarative description of _which sources, in what priority, under what token budget_ — resolved deterministically before any model call.

## Design requirements

- **Explicit and inspectable.** The user can see exactly what went into context and why. Context construction is debuggable, not a black box.
- **Budget-aware.** Recipes respect a token budget; when the budget is tight, priority and summarisation (see [below](#summaries)) decide what is included at full fidelity versus summarised.
- **Minimum useful context.** Agents receive the minimum useful context rather than indiscriminately loading everything (Rule 16 in `AGENTS.md`).
- **Deterministic where possible.** Selection driven by domain relationships and structured queries is preferred over asking a model to decide what to read.

## Summaries

The compiler draws on hierarchical summaries (scene → chapter → sequence → act → arc → thread → whole-book) to fit large scope into budget. Summaries are regeneratable from source and must never silently override source canon.

## Relationship to other subsystems

- Reads from the [Story Repository](STORY_REPOSITORY.md), [Story State](STORY_STATE.md), and search/index.
- Serves the [Agent Runtime](AGENT_RUNTIME.md) and inline AI — **inline AI must also use the Context Compiler** and must not become a disconnected miniature chatbot.
- Its output feeds model calls routed by the [Model Router](MODEL_ROUTER.md).

## Invariants

- Never load the whole manuscript by default.
- Every compiled context is inspectable and attributable to sources.
- Summaries and derived retrieval never override confirmed canon.
