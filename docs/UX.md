# UX

The interface should feel more like an IDE than a chat application. Chat is a tool inside the environment, not the dominant metaphor.

## Status

Documentation stage. The V1 writing IDE (editor, project tree, AI panel, activity panel) proves the core paradigm (see [ROADMAP.md](ROADMAP.md)).

## Primary layout

Four primary areas:

```
┌───────────────┬───────────────────────────┬───────────────┐
│ Project        │  Writing Workspace         │ Inspector / AI │
│ Explorer       │  (editor, centre)          │ (right)        │
│ (left)         │                            │                │
├───────────────┴───────────────────────────┴───────────────┤
│ Agent Activity / Terminal (bottom)                          │
└─────────────────────────────────────────────────────────────┘
```

### Left — Project Explorer

```
PROJECT
▾ Manuscript
   ▾ Act I
      Chapter 01 / 02 / 03
▾ Scenes  ▾ Characters  ▾ Locations  ▾ Plot Threads
▾ Timeline  ▾ World  ▾ Research  ▾ Style  ▾ Tests
▾ Simulations  ▾ Agent Workspace
```

### Centre — Writing Workspace

Rich text or Markdown-backed writing; chapter and scene editing; comments and annotations; inline AI actions; tracked changes; selections; revision highlighting; distraction-free/focus mode; multiple tabs; split views.

### Right — Inspector / AI

Context-sensitive: current scene, characters present, POV, location, active threads, story state, continuity warnings, AI interaction, entity inspector, scene metadata.

### Bottom — Agent Activity / Terminal

Shows what the AI is doing — tool activity, findings, plans and results — without exposing hidden chain-of-thought:

```
AUTHOR  Strengthen Chapters 12–15. Investigate first.
AGENT   Inspecting chapter structure...
        [read chapter_012] [read chapter_013] [read chapter_014] [read chapter_015]
        [inspect active threads] [inspect character goals] [analyse pacing]
        Three structural problems found...
```

## Human-first writing mode

The product must remain excellent when the writer wants to write manually. AI enhances rather than obstructs. Provide: clean editor, no-AI mode, focus mode, notes, comments, scene cards, outline, project navigation, search, revision history. A user should be able to write an entire novel manually while benefiting from the organisational and analytical infrastructure.

## Inline AI

Lightweight in-editor actions: rewrite · shorten · expand · change tone · strengthen subtext · improve dialogue · remove exposition · continue · describe · inspect consistency. Inline AI **still uses the [Context Compiler](CONTEXT_COMPILER.md)** — it must not become a disconnected miniature chatbot.

## Command palette / writing terminal

Command-style interaction for power users maps to real structured operations and skills:

```
/inspect character mara      /outline chapter 17      /draft scene SCENE_0041
/rewrite SCENE_0041 --dialogue-only   /continuity act2   /trace clue bloody_watch
/find "Mara knows about the key"      /voice-check elias  /build
/debug betrayal_marcus       /refactor "make Mara the detective"
/branch darker-ending        /reader-sim chapter 1..20   /character-pass mara
```

Non-technical users must be able to perform the same actions through graphical controls.

## Honesty of the interface

- **No fake features.** Do not build controls implying capabilities that do not exist; clearly label anything unavailable during development. Avoid mockups masquerading as functioning architecture.
- **Explain the system's understanding.** Wherever possible let the user inspect *why* the system believes something, with evidence and a way to correct it (see [STORY_STATE.md](STORY_STATE.md)).
- **Approval visibility.** The user always understands what an agent is permitted to do and what approval mode is active (see [AGENT_RUNTIME.md](AGENT_RUNTIME.md)).

## Story Health Dashboard (later)

A project dashboard may surface diagnostic signals (word count, chapter lengths, POV distribution, plot-thread activity, unresolved threads, continuity warnings, pacing estimates, dialogue percentage, reader-sim results, test status). Never present subjective metrics as literary quality — use them as diagnostics.
