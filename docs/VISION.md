# VISION

## The problem

Modern language models can produce good prose. The problem is not generation quality — it is that the normal interface between writers and models is inadequate for novel-scale work.

The typical AI writing loop is:

```
Writer → Prompt → Chat → Generated Text → Copy/Paste → Repeat
```

Everything the model "knows" about the project lives in a fragile conversation window. Nothing persists. Nothing is inspectable. Nothing can be validated, reverted, or reasoned about structurally.

## The desired workflow

```
Writer → Writing Environment → Agent → Story Tools → Story Repository → Validation → Revision → Manuscript
```

The AI works across a persistent project instead of treating every interaction as an isolated generation task.

## The paradigm

> **A story is a structured project that an AI can operate on.**

The manuscript is only one component. The complete project also contains characters, scenes, locations, timelines, plot threads, world rules, character knowledge, relationships, objects, mysteries, themes, research, stylistic rules, author preferences, revisions, simulations, tests, and machine-readable story state.

We are building the fiction-writing equivalent of an AI coding IDE / agentic development environment. A programmer hands a coding agent a repository; the agent inspects files, understands architecture, searches, edits ranges, runs tests, inspects errors, maintains task state, compares changes, reverts mistakes, and delegates to specialists. **A fiction writer should be able to do the same thing.**

## Guiding principle

> **The LLM provides intelligence and creativity. The harness provides memory, structure, process, reliability, tools, state, verification and control.**

Equivalently: _the model is not the product; the harness around the model is the product._

## What success looks like

The application succeeds when AI can reliably operate on fiction projects too large and complex to treat as ordinary chat context. Concretely, requests like these become normal and are powered by persistent infrastructure rather than prompt tricks:

- "Read my entire project and tell me why Act II feels weaker than Act I. Investigate before proposing edits."
- "Trace every clue related to the murder and tell me the earliest chapter where an attentive reader could reasonably identify the killer."
- "Show me everything Mara knows immediately before entering the manor."
- "Try an alternative branch where Marcus survives Chapter 28 and determine what later scenes break."
- "Make Mara the detective instead of Elias. Analyse the blast radius before touching the manuscript."
- "Build Chapter 17 from the approved scene plan. Stop for approval after the chapter."

`/write-book` should not mean _ask a model to generate a novel_. It should mean _launch a sophisticated, persistent, stateful, validated, multi-stage fiction production pipeline_.

## Milestone ladder

1. **AI can safely and intelligently operate on a structured fiction project.**
2. **The system understands enough story structure to detect and reason about consequences across the project.**
3. **Specialised agents can collaboratively perform professional-scale fiction-development workflows.**
4. **The system can simulate readers and characters to test narrative behaviour.**
5. **The harness can reliably execute novel-scale production and revision workflows over long periods while preserving consistency, state, recoverability and human control.**

## Non-goals

- A better chatbot.
- A conventional writing app with an assistant bolted on.
- Plain RAG over a manuscript.
- Impressive one-shot generation demos at the cost of the architecture required for novel-scale work.
