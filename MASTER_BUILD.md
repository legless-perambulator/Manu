# MASTER_BUILD

# MASTER BUILD SPECIFICATION — AI-NATIVE FICTION DEVELOPMENT ENVIRONMENT

## 0\. MASTER DIRECTIVE

Build a proper AI-native development environment dedicated to fiction writing.

This is **not** an AI chatbot with a text editor attached.

This is **not** a conventional writing application with an AI assistant.

This is **not** simply RAG over a manuscript.

The fundamental concept is to take the architecture, workflows, tooling, reliability mechanisms, and agent harnesses that have made AI coding environments powerful and apply those principles to fiction writing.

The product should eventually feel like the fiction-writing equivalent of an AI coding IDE or agentic development environment.

A programmer gives an AI coding agent a repository. The agent can inspect files, understand architecture, search code, edit specific ranges, create files, run tests, inspect errors, use tools, maintain task state, compare changes, revert mistakes, work iteratively, delegate to specialist agents, and continue operating on a project far larger than a single model response.

A fiction writer should be able to do the same thing.

The central paradigm is:

**A story is a structured project that an AI can operate on.**

The manuscript is only one component of that project.

The complete project also contains characters, scenes, locations, timelines, plot threads, world rules, character knowledge, relationships, objects, mysteries, themes, research, stylistic rules, author preferences, revisions, simulations, tests, and machine-readable story state.

The AI should operate on this environment through dedicated fiction-writing tools rather than relying on an enormous conversation history.

The long-term ambition is to build a **fiction operating environment**.

Core conceptual vocabulary should include:

- Story Repository

- Writing Workspace

- Context Compiler

- Story Compiler

- Story Debugger

- Story Tests

- Story State

- Story Refactor

- Writing Agents

- Writing Skills

- Reader Simulator

- Character Simulator

- Story Graph

- Knowledge Graph

- Causality Graph

- Branches

- Checkpoints

- Revisions

- Builds

- Model Router

The product should ultimately make working on a 150,000-word novel feel more like operating on a sophisticated software project than repeatedly asking a chatbot to remember and rewrite a huge document.

The guiding principle throughout development is:

**The LLM provides intelligence and creativity. The harness provides memory, structure, process, reliability, tools, state, verification and control.**

---

# 1\. PRODUCT PHILOSOPHY

The primary problem being solved is not that modern language models are incapable of producing good prose.

The problem is that the normal interface between writers and language models is fundamentally inadequate for novel-scale work.

Typical AI writing workflow:

Writer → Prompt → Chat → Generated Text → Copy/Paste → Repeat

Desired workflow:

Writer → Writing Environment → Agent → Story Tools → Story Repository → Validation → Revision → Manuscript

The AI must be able to work across a persistent project rather than treating every interaction as an isolated generation task.

A request such as:

> Strengthen the tension across Chapters 12–15\. Investigate the problem before changing anything.

should cause the agent to:

1. Locate Chapters 12–15\.

2. Inspect their scenes.

3. Inspect scene objectives.

4. Inspect active plot threads.

5. Inspect character goals and conflicts.

6. Inspect preceding and following chapters where necessary.

7. Analyse pacing and tension.

8. Report its diagnosis.

9. Propose a plan.

10. Wait for approval if required.

11. Make targeted edits using dedicated tools.

12. Show diffs.

13. Run relevant story checks.

14. Update affected story state.

15. Create a revision/checkpoint.

The system must support both highly controlled human-in-the-loop workflows and increasingly autonomous workflows.

The goal is not to remove the writer.

The goal is to give the writer an extraordinarily capable fiction-development environment.

---

# 2\. THE STORY REPOSITORY

Every writing project should exist as a structured repository.

The repository should be portable, inspectable and not dependent on a proprietary cloud database.

A conceptual project structure:

```
MY_NOVEL/
│
├── manuscript/
│   ├── act_1/
│   │   ├── chapter_001.md
│   │   ├── chapter_002.md
│   │   └── chapter_003.md
│   ├── act_2/
│   └── act_3/
│
├── scenes/
│   ├── SCENE_0001.yaml
│   ├── SCENE_0002.yaml
│   └── ...
│
├── story/
│   ├── premise.md
│   ├── synopsis.md
│   ├── themes.md
│   ├── promises.md
│   └── story_rules.md
│
├── characters/
│   ├── CHAR_ELIAS/
│   │   ├── profile.md
│   │   ├── voice.md
│   │   ├── arc.md
│   │   ├── relationships.md
│   │   └── state.json
│   └── ...
│
├── world/
│   ├── locations/
│   ├── factions/
│   ├── cultures/
│   ├── history/
│   ├── systems/
│   ├── glossary/
│   └── objects/
│
├── plot/
│   ├── master_outline.md
│   ├── timelines.json
│   ├── plot_threads.json
│   ├── mysteries.json
│   ├── clues.json
│   ├── foreshadowing.json
│   └── causality.json
│
├── style/
│   ├── prose.md
│   ├── dialogue.md
│   ├── pacing.md
│   ├── banned_tendencies.md
│   ├── author_profile.json
│   └── examples/
│
├── research/
├── references/
├── notes/
│
└── .writer/
    ├── project.json
    ├── state/
    ├── index/
    ├── revisions/
    ├── branches/
    ├── agents/
    ├── skills/
    ├── commands/
    ├── tests/
    ├── simulations/
    └── memory/
```

The exact implementation may evolve, but the architectural principle must remain:

**story information should exist as structured project data rather than being trapped inside prompts or chat history.**

Use human-readable files such as Markdown, YAML and JSON wherever appropriate.

Use a local structured database such as SQLite where indexing, relationships, query performance or derived state make it useful.

The user's actual creative work must remain portable.

---

# 3\. STABLE ENTITY IDENTITIES

Every meaningful story entity must receive a permanent internal ID.

Do not use mutable display names as primary identifiers.

Examples:

```
CHAR_0001
CHAR_0002

SCENE_0042

LOC_0017

THREAD_0008

OBJECT_0021

FACT_0041

EVENT_0068

REL_0012

CLUE_0014
```

A character may change from:

> Marcus Vale

to:

> Marcus Kane

without breaking references.

Relationships, dependencies, timelines and story graphs should point to IDs.

Names are presentation.

IDs are identity.

This becomes essential for:

- refactoring

- dependency analysis

- graph construction

- continuity

- state tracking

- aliases

- revisions

- branches

- automated story transformations

---

# 4\. SCENES AS FIRST-CLASS OBJECTS

Scenes must not merely be arbitrary ranges of text.

A scene should be a structured story entity with its own metadata.

Example:

```yaml
id: SCENE_0083

chapter: CHAPTER_0017

pov: CHAR_ELIAS

location: LOC_BLACKTHORN_LIBRARY

characters:
  - CHAR_ELIAS
  - CHAR_MARA

purpose:
  - reveal_partial_truth_about_father
  - increase_suspicion_of_mara
  - plant_cellar_key

conflict:
  external: low
  interpersonal: high
  internal: medium

entry_state:
  elias_trust_mara: 0.48

exit_state:
  elias_trust_mara: 0.31

plot_threads:
  advances:
    - THREAD_FATHER_DISAPPEARANCE
  introduces:
    - THREAD_CELLAR_KEY

knowledge_changes:
  CHAR_ELIAS:
    learns:
      - FACT_FATHER_VISITED_MANOR_1997

status: drafted

word_count: 2381
```

The manuscript remains readable prose.

The scene layer provides machine-readable structural understanding.

This enables agents to reason about a novel's architecture rather than only its sentences.

---

# 5\. THE WRITING IDE

Create a full writing workspace inspired conceptually by:

- VS Code

- modern AI coding IDEs

- Scrivener

- Obsidian

- professional creative-production software

The interface should ultimately contain four primary areas.

### Left Sidebar — Project Explorer

Example:

```
PROJECT

▾ Manuscript
   ▾ Act I
      Chapter 01
      Chapter 02
      Chapter 03

▾ Scenes
▾ Characters
▾ Locations
▾ Plot Threads
▾ Timeline
▾ World
▾ Research
▾ Style
▾ Tests
▾ Simulations
▾ Agent Workspace
```

### Centre — Writing Workspace

The main manuscript/editor surface.

Support:

- rich text or Markdown-backed writing

- chapter editing

- scene editing

- comments

- annotations

- inline AI actions

- tracked changes

- selections

- revision highlighting

- distraction-free writing

- multiple tabs

- split views

### Right Sidebar — Inspector / AI

Context-sensitive information such as:

- current scene

- characters present

- POV

- location

- active threads

- story state

- continuity warnings

- AI interaction

- entity inspector

- scene metadata

### Bottom Panel — Agent Activity / Terminal

Show what the AI is doing.

Example:

```
AUTHOR
Strengthen Chapters 12–15.
Investigate first.

AGENT
Inspecting chapter structure...

[read chapter_012]
[read chapter_013]
[read chapter_014]
[read chapter_015]
[inspect active threads]
[inspect character goals]
[analyse pacing]

Three structural problems found...
```

The user should be able to understand the agent's actions without needing hidden chain-of-thought.

Show tool activity, findings, plans and results.

---

# 6\. AGENT TOOL SYSTEM

Do not build the AI as an unrestricted text generator.

Build a typed tool system.

Initial foundational tools should include:

```
list_files()
read_file()
read_range()
create_file()
write_file()
replace_range()
move_file()
search_project()

get_character()
get_scene()
get_location()
get_story_state()
get_plot_threads()

create_checkpoint()
show_diff()
revert_change()
compare_versions()
```

Fiction-specific tools should expand to include:

```
get_character_state()
get_character_knowledge()
get_character_timeline()
get_relationship_state()

get_location_state()
get_object_state()

get_active_threads()
get_scene_context()
get_chapter_context()

get_world_rule()
get_fact()
trace_fact()

create_scene()
split_scene()
move_scene()
delete_scene()

generate_outline()
generate_scene_plan()
draft_scene()
continue_scene()

analyse_pacing()
analyse_dialogue()
analyse_prose()
analyse_character_voice()
analyse_tension()
analyse_scene_purpose()

check_continuity()
check_timeline()
check_character_knowledge()
check_world_rules()
check_repetition()
check_foreshadowing()
check_unresolved_threads()

update_story_state()
```

Tools must use typed schemas.

AI operations should produce auditable actions.

Prefer:

```
update_character_state(
    character = CHAR_ELIAS,
    after_scene = SCENE_0042,
    changes = {...}
)
```

over an agent silently rewriting arbitrary state files.

This gives the harness control over what changed and allows validation.

---

# 7\. THE CONTEXT COMPILER

Do not treat conventional RAG as the central intelligence architecture.

RAG is one retrieval subsystem.

Build a **Context Compiler**.

Its responsibility is to construct the best possible working context for every AI operation.

For example:

> Draft Scene 83.

The Context Compiler may construct:

```
TASK
Draft Scene 83.

SCENE SPECIFICATION
...

PREVIOUS SCENE
...

NEXT PLANNED SCENE
...

POV CHARACTER
...

CURRENT CHARACTER STATE
...

CHARACTERS PRESENT
...

RELATIONSHIPS
...

LOCATION STATE
...

RELEVANT WORLD RULES
...

ACTIVE PLOT THREADS
...

CHARACTER KNOWLEDGE
...

READER KNOWLEDGE
...

RELEVANT FORESHADOWING
...

AUTHOR STYLE PROFILE
...

CHARACTER VOICE EXAMPLES
...

RECENT PACING INFORMATION
...

SCENE OBJECTIVES
...
```

It should not blindly dump an entire 150,000-word manuscript into context.

Context selection should combine:

- deterministic relationships

- entity references

- scene adjacency

- chapter adjacency

- active plot threads

- character participation

- character knowledge

- world rules

- timeline proximity

- semantic search

- full-text search

- embeddings

- summaries

- user-pinned context

- task-specific retrieval rules

Different tasks require different context recipes.

A continuity audit should receive different context from a dialogue rewrite.

A drafting agent should receive different context from a copy editor.

The Context Compiler is one of the core pieces of intellectual infrastructure in the product.

---

# 8\. STORY STATE ENGINE

Create explicit machine-readable story state.

Do not require the LLM to reconstruct every fact from prose whenever it performs a task.

Example:

```yaml
after_scene: SCENE_0042

characters:

  CHAR_ELIAS:
    location: LOC_BLACKTHORN_MANOR

    physical_state:
      injured_left_hand: true

    inventory:
      - OBJECT_BRASS_KEY
      - OBJECT_PHONE

    knowledge:
      FACT_VAULT_EXISTS:
        certainty: 1.0

      FACT_MARA_IS_SPYING:
        certainty: 0.0

    emotional_state:
      trust_mara: 0.32
      fear: 0.71

  CHAR_MARA:
    location: LOC_LONDON

    knowledge:
      FACT_ELIAS_FOUND_VAULT:
        certainty: 1.0
```

Story state may include:

- location

- alive/dead status

- physical condition

- possessions

- knowledge

- beliefs

- relationships

- emotional variables

- commitments

- goals

- secrets

- disguises

- injuries

- resources

- status

- faction membership

- unresolved actions

State should be reconstructable across story time.

The system should understand:

> What was true immediately before Scene 42?

not merely:

> What is true in the latest state?

---

# 9\. TRUTH, BELIEF AND KNOWLEDGE

Build separate representations for:

### Objective Story Truth

What is actually true in the fictional world.

### Character Knowledge / Belief

What each character believes to be true.

Include:

- source

- time learned

- certainty

- whether belief is false

- whether information was inferred

- whether information was directly witnessed

### Reader Knowledge

What information the manuscript has actually exposed to the reader at a particular point.

These must not be conflated.

Conceptually:

```
TRUTH
  ↓
Who knows it?
  ↓
How did they learn it?
  ↓
When?
  ↓
How certain are they?
  ↓
Who do they believe also knows it?
```

This system is particularly important for:

- mysteries

- thrillers

- espionage

- political fiction

- fantasy intrigue

- unreliable narrators

- dramatic irony

The system should eventually detect situations such as:

> Mara references the vault in Chapter 16, but she does not learn about the vault until Chapter 18.

---

# 10\. RELATIONSHIP STATE

Relationships should also be dynamic story objects.

Do not store merely:

```
Elias — friend of Mara
```

Allow relationships to evolve.

Potential variables:

```
trust
affection
fear
resentment
loyalty
dependency
suspicion
attraction
respect
power
knowledge_of_other
```

Changes should be tied to story events.

This allows the system to inspect whether relationship progression is earned.

Example:

```
ELIAS → MARA TRUST

CH01  0.62
CH05  0.71
CH09  0.66
CH14  0.48
CH17  0.31
CH23  0.18
```

Use this for analysis, not to mechanically dictate creative writing.

---

# 11\. STORY COMPILER

Create the fiction equivalent of compiling/testing software.

The writer should eventually be able to run:

```
/build
```

or press:

**Build Story**

The Story Compiler runs deterministic and semantic checks.

Example:

```
STORY BUILD 284

✓ Timeline valid
✓ Character locations valid
✓ World rules valid
✓ Character knowledge valid
✓ POV rules valid

⚠ Mara knows about the Black Vault in Chapter 16
  but does not learn this until Chapter 18.

⚠ Revolver used in Chapter 22 was left in Elias's flat
  in Chapter 19.

⚠ Plot thread "missing photograph"
  introduced Chapter 4
  last referenced Chapter 9
  unresolved for 63,291 words.

⚠ Elias dialogue similarity to Marcus: 81%
  Character voices may be converging.

⚠ Chapter 27 contains four consecutive low-conflict scenes.

⚠ Phrase "his jaw tightened" occurs 17 times.

✓ All registered foreshadowing has valid future targets

BUILD COMPLETED WITH 6 WARNINGS
```

Initial compiler checks should include:

- impossible character locations

- timeline contradictions

- dead characters appearing alive

- character knowledge violations

- object/inventory continuity

- conflicting world rules

- POV violations

- duplicate aliases/entities

- unresolved plot threads

- abandoned foreshadowing

- repeated phrases

- inconsistent physical descriptions

- chronology issues

- scene dependency problems

Separate:

**Errors**

from:

**Warnings**

from:

**Suggestions**

Never pretend subjective literary judgement is deterministic fact.

---

# 12\. STORY TESTS

Allow writers to create explicit story assertions.

Examples:

```
EXPECT reader_suspects(CHAR_MARA) < 0.5 UNTIL CHAPTER_0022

EXPECT knows(CHAR_ELIAS, FACT_KILLER_IDENTITY) == false
UNTIL CHAPTER_0037

EXPECT location(OBJECT_GUN) == LOC_EVIDENCE_ROOM
FROM CHAPTER_0012 TO CHAPTER_0029

EXPECT relationship(ELIAS, MARA).progression == "slow_burn"

EXPECT FACT_VILLAIN_IDENTITY not_exposed BEFORE CHAPTER_0038
```

Some tests can be deterministic.

Others require semantic model judgement.

The UI must distinguish them:

```
DETERMINISTIC TESTS
21 / 21 passed

SEMANTIC TESTS
18 / 21 passed
3 warnings
```

Users should be able to create their own tests.

Agents should also be able to recommend tests based on the story's intentions.

---

# 13\. STORY DEBUGGER

Create a dedicated diagnostic mode.

The Story Debugger should investigate why something is not working instead of immediately rewriting it.

Example request:

> Marcus's betrayal isn't landing.

Debugger:

```
Tracing Marcus betrayal...

Reveal:
Chapter 34

Expected prerequisites:
✓ Reader attachment
✓ Trust established
✗ Personal sacrifice establishing loyalty
✓ Concealed motive
⚠ Suspicion introduced too early

Evidence:
Ch. 7 — Marcus saves Elias
Ch. 11 — suspicious absence
Ch. 14 — suspicious phone call
Ch. 19 — suspicious lie
Ch. 21 — suspicious disappearance

Diagnosis:

Reader suspicion likely reaches high levels approximately
8–10 chapters before intended reveal.

Suggested intervention:

Remove, reinterpret or counterbalance the Chapter 14 signal.
Strengthen a loyalty-confirming action between Chapters 15–18.
```

Debugger workflows should exist for:

- weak reveals

- flat character arcs

- pacing problems

- unearned decisions

- weak endings

- missing setup

- poor payoff

- mystery solvability

- romance progression

- thematic inconsistency

- exposition problems

- dialogue voice convergence

The debugger diagnoses before editing.

---

# 14\. CAUSALITY GRAPH

Represent meaningful cause-and-effect relationships.

Example:

```
Elias discovers letter
        ↓
Confronts father
        ↓
Father lies
        ↓
Elias contacts Mara
        ↓
Mara investigates vault
        ↓
Marcus learns investigation continues
        ↓
Marcus destroys evidence
```

Scenes/events should be able to declare dependencies.

If a user deletes or significantly changes a scene:

```
Removing SCENE_0042 may break causal dependencies for:

SCENE_0051
SCENE_0053
SCENE_0061
```

The system should explain why.

This is the fiction equivalent of dependency analysis.

---

# 15\. STORY REFACTOR

Create a major feature called **Story Refactor**.

This is the fiction equivalent of refactoring software.

Example request:

> Make Mara the detective instead of Elias.

Before changing anything, determine the blast radius.

Example:

```
PROPOSED STORY REFACTOR

Change:
Mara becomes primary investigator.

Affected:

18 scenes
4 character arcs
7 plot threads
3 relationship trajectories
11 knowledge transitions
2 clues
1 ending dependency

High-risk dependencies:
SCENE_0048
SCENE_0061
THREAD_INHERITANCE
FACT_VAULT_DISCOVERY

[Inspect Plan]
[Create Branch + Apply]
[Cancel]
```

Other refactors:

- change a relationship

- change a character's profession

- move an event earlier

- remove a character

- merge two characters

- change murderer

- change POV character

- alter world rule

- change location

- change ending

- convert first-person to third-person

- change story chronology

The system should analyse dependencies before applying changes.

---

# 16\. VERSION CONTROL, DIFFS AND HISTORY

Every AI mutation must be reversible.

Provide visual diffs.

Example:

```diff
- He walked slowly toward the door.
+ Elias crossed the room but stopped short of the door.
```

Support:

- accept change

- reject change

- accept selected changes

- reject selected changes

- accept all

- restore previous version

Create checkpoints automatically before large operations.

Conceptual revision stages:

```
Draft 0
Structural Rewrite
Character Pass
Dialogue Pass
Prose Pass
Developmental Edit
Copy Edit
Final
```

Each change should retain:

- timestamp

- agent

- model

- task

- affected entities

- previous content

- resulting content

- user approval status

- concise reason/summary

- associated checkpoint

Do not expose hidden chain-of-thought.

Expose useful action summaries and provenance.

---

# 17\. BRANCHING

Support alternative versions of a story.

Conceptually:

```
main
│
├── mara-confesses-early
│
├── elias-dies-ending
│
└── darker-act-three
```

Example:

> Try a version where Mara confesses in Chapter 31.

The system creates a branch.

Affected content can be rewritten without destroying the main manuscript.

Allow:

- branch creation

- branch comparison

- branch deletion

- branch merging where practical

- branch-level simulations

- branch-level Story Builds

Provide semantic comparison:

> How does the darker ending affect Elias's arc, theme, pacing and unresolved threads compared with main?

---

# 18\. AUDIT TRAIL

Every AI-generated or AI-modified passage should be traceable.

Clicking a passage may reveal:

```
Created:
11 August 2026

Agent:
Prose Editor

Model:
[model]

Task:
Remove exposition from argument.

Revision:
v183 → v184

Reason:
Dialogue explicitly stated resentment already established through action.
```

Maintain provenance for:

- AI generation

- AI editing

- human editing

- imports

- automated refactors

- compiler auto-fixes

- agent operations

The writer must remain in control of the manuscript.

---

# 19\. WRITING AGENT ARCHITECTURE

Do not build one monolithic "Writer AI."

Create a primary orchestrating agent capable of using specialist agents.

### Author Agent

General project-level agent.

Understands the writer's request, determines required tools and specialists, coordinates work and presents results.

### Story Architect

Responsible for macro structure:

- acts

- sequences

- story promises

- arcs

- causality

- setup/payoff

- pacing

- structural theories

- climax

- resolution

### Scene Director

Turns narrative intention into scene architecture.

Handles:

- scene goals

- conflict

- entrances/exits

- beats

- reversals

- revelations

- emotional progression

- scene transitions

### Drafter

Writes prose from structured plans and context.

### Continuity Editor

Checks factual consistency across the project.

### Character Editor

Focuses on:

- motivation

- psychology

- decisions

- arcs

- consistency

- emotional development

### Dialogue Editor

Focuses on:

- voice differentiation

- subtext

- rhythm

- conversational realism

- exposition

- character-specific speech

### Prose Editor

Focuses on:

- sentences

- rhythm

- imagery

- clarity

- repetition

- description

- narrative voice

### Developmental Editor

Challenges the manuscript at a high level rather than blindly improving prose.

### Mystery Engine

Tracks:

- clues

- red herrings

- suspects

- evidence

- alibis

- reader knowledge

- character knowledge

- revelations

- deductions

- solvability

### Worldbuilding Agent

Maintains:

- canon

- cultures

- systems

- geography

- factions

- history

- terminology

- internal rules

### Research Agent

Retrieves and organises external factual information where required.

### Copy Editor

Late-stage:

- grammar

- punctuation

- consistency

- spelling

- formatting

- mechanical errors

Agents must use shared project state rather than maintaining incompatible private versions of the story.

---

# 20\. CUSTOM AGENTS

Allow users to create custom specialist agents.

Example:

```
Agent:
Grimdark Editor

Responsibilities:
- challenge clean moral binaries
- identify consequences that resolve too neatly
- identify plot-protected characters
- identify moral decisions without meaningful cost
- challenge overly heroic framing
```

Another:

```
Agent:
Golden Age Mystery Auditor

Responsibilities:
- inspect clue fairness
- identify withheld essential information
- analyse suspect viability
- reconstruct reader deductions
- test reveal timing
```

Another:

```
Agent:
Romance Chemistry Editor
```

Custom agents should support:

- instructions

- permitted tools

- preferred models

- context recipes

- triggers

- output schemas

- genre-specific knowledge

- project-specific knowledge

---

# 21\. WRITING SKILLS

Create reusable agent workflows called **Skills**.

Example:

```
/murder-mystery-audit
```

Workflow:

1. Extract all clues.

2. Identify every clue appearance.

3. Identify which characters possess each clue.

4. Reconstruct the intended solution.

5. Determine earliest point a reader could reasonably solve it.

6. Identify unfairly withheld information.

7. Identify contradictory evidence.

8. Identify accidental clues.

9. Analyse red herrings.

10. Produce structured report.

Example:

```
/character-pass CHAR_MARA
```

Workflow:

1. Find every scene containing Mara.

2. Reconstruct her chronological experience.

3. Reconstruct her knowledge progression.

4. Reconstruct emotional arc.

5. Inspect dialogue patterns.

6. Compare stated traits with demonstrated traits.

7. Identify contradictions.

8. Identify unexplained behaviour changes.

9. Produce recommended interventions.

Additional skills could include:

```
/dialogue-pass
/pacing-audit
/continuity-audit
/foreshadowing-audit
/worldbuilding-audit
/romance-progression
/scene-purpose-audit
/remove-ai-tendencies
/copy-edit
/reader-confusion-test
```

Skills should eventually be shareable/installable.

---

# 22\. CHARACTER SIMULATOR

Create a proper character simulation system.

This is not merely "chat with your character."

A character simulator receives:

- memories

- personality

- goals

- fears

- knowledge

- beliefs

- relationships

- current emotional state

- physical state

- current circumstances

It can then challenge proposed story behaviour.

Example:

> Given everything Mara knows at this point, would she realistically enter the house alone?

Potential result:

```
CHARACTER SIMULATION

Proposed action:
Mara enters the house alone.

Consistency:
Low

Primary conflicts:
- established fear of enclosed spaces
- knows suspect may be present
- previously refuses unnecessary physical risk
- has access to police backup

Estimated behavioural plausibility:
24%

Possible fixes:
- remove access to backup
- create urgent time pressure
- establish overriding personal motive
- alter earlier characterisation
```

Probabilities must be presented as model judgement, not objective science.

The purpose is to identify **plot-forced behaviour**.

---

# 23\. READER SIMULATOR

Create virtual readers that experience the manuscript sequentially.

They must not have access to future chapters.

Example reader profiles:

```
Reader A
Genre expert
High mystery literacy

Reader B
Casual reader

Reader C
Emotion-focused reader

Reader D
Highly critical developmental reader
```

After each chapter, record questions such as:

- What do you think is happening?

- Who do you trust?

- Who do you suspect?

- What questions are you asking?

- What do you predict?

- What confused you?

- What bored you?

- What excited you?

- Which emotional moments landed?

- What information do you remember?

Persist the reader's state.

Do not reset the reader after every chapter.

Visualise results over time.

Example:

```
SUSPICION OF MARA

100% ┤
     │                        ╭──
 75% ┤                ╭───────╯
     │
 50% ┤       ╭────────╯
     │
 25% ┤───╮───╯
     │
  0% └──────────────────────────
      1  5 10 15 20 25 30 35
             CHAPTER
```

Use reader simulation for:

- mystery reveal timing

- emotional response

- confusion

- pacing

- predictions

- trust

- tension

- character attachment

- foreshadowing visibility

---

# 24\. AUTHOR VOICE SYSTEM

Create a persistent **Author Voice Profile**.

Do not reduce style to one prompt.

Learn from:

- user-written prose

- approved AI prose

- rejected AI prose

- manual corrections

- favourite passages

- dialogue exercises

- explicit rules

- annotations

- stylistic examples

Example:

```
AUTHOR PROFILE

Dialogue:
- contractions heavily preferred
- avoids explicit emotional exposition
- interruptions common
- characters rarely address each other by name
- subtext preferred over direct explanation

Prose:
- medium-short sentences
- sparse figurative language
- physical observation before introspection
- avoids ornamental description

Repeated AI tendencies rejected by author:
- "couldn't help but"
- "a mixture of X and Y"
- melodramatic rhetorical fragments
- explaining subtext after dialogue
- unnecessary character-name repetition
```

The system should learn from accept/reject behaviour where the user permits this.

Separate:

- global author profile

- project-specific voice

- character-specific voice

- POV-specific voice

The writer must be able to inspect and edit inferred rules.

---

# 25\. CHARACTER VOICE MODELS

Maintain character-specific speech profiles.

Potential features:

- sentence length

- vocabulary

- contractions

- profanity

- humour

- formality

- regionalisms

- metaphor preferences

- directness

- interruptions

- filler words

- avoidance patterns

- emotional leakage

- speech evolution over story time

Allow dialogue comparison.

Example compiler warning:

```
Elias / Marcus dialogue similarity: unusually high.

Potential voice convergence detected.
```

This is semantic analysis, not deterministic truth.

---

# 26\. VISUAL TIMELINE

Build an interactive story timeline.

Conceptually:

```
TIME →

ELIAS  ━━━━━━━●━━━━━━━━●━━━━━━
MARA       ━━━━━●━━━━━━━━━━━━●
MARCUS ━━━━━━━━━━━●━━━━●━━━━━━
            ↑
          murder
```

Timeline layers may include:

- characters

- locations

- plot threads

- world events

- historical events

- objects

- clues

- relationships

Click a point to inspect:

- location

- event

- knowledge

- physical state

- inventory

- relationships

- participating scenes

Support stories with:

- flashbacks

- nonlinear chronology

- multiple timelines

- time jumps

- parallel events

Distinguish:

**story-world chronology**

from:

**reader presentation order**.

---

# 27\. KNOWLEDGE GRAPH

Create an interactive graph showing entities and relationships.

Nodes may include:

- characters

- locations

- objects

- factions

- events

- facts

- clues

- plot threads

Edges may represent:

- knows

- believes

- owns

- located\_at

- related\_to

- member\_of

- caused

- witnessed

- suspects

- loves

- hates

- depends\_on

Allow time-based inspection.

The graph at Chapter 5 may differ from the graph at Chapter 30.

---

# 28\. MYSTERY / CLUE ENGINE

Build dedicated support for mystery structures.

Track:

```
clue
source
first appearance
who discovers it
reader exposure
interpretations
true meaning
false meaning
related suspects
dependencies
payoff
```

Also track:

- red herrings

- alibis

- evidence

- suspect motives

- opportunity

- means

- deductions

- reveals

- hidden information

The Mystery Engine should eventually answer:

> Could the reader fairly solve this before the reveal?

and explain why.

It should also detect:

- impossible deductions

- missing evidence

- characters acting on unavailable information

- accidentally obvious culprit

- redundant clues

- unresolved red herrings

---

# 29\. GENRE MODULES

The environment should adapt to different forms of fiction.

### Mystery Module

Add:

- suspects

- clues

- evidence

- alibis

- deduction chains

- reveal timing

- reader knowledge

### Fantasy Module

Add:

- cultures

- geography

- genealogy

- magic systems

- religions

- factions

- languages

- historical eras

- species

- artefacts

### Romance Module

Add:

- relationship progression

- attraction

- conflict

- intimacy

- emotional milestones

- romantic beats

### Thriller Module

Add:

- threat escalation

- operational timelines

- information asymmetry

- pursuit

- locations

- resources

- deadlines

### Screenplay Module

Add:

- scene headings

- screenplay formatting

- cast

- production breakdown

- dialogue timing

- locations

- scene duration

Genre modules should extend the common story engine rather than creating incompatible products.

---

# 30\. LONG-FORM GENERATION PIPELINE

Do not solve long-form writing by asking a model to output a 5,000-word chapter in one response.

Use orchestrated generation.

Example:

```
TASK:
Draft Chapter 17.

1. Load chapter specification.
2. Load relevant story state.
3. Compile context.
4. Generate scene plan.
5. Validate scene plan.
6. Request approval if configured.
7. Create Scene 41.
8. Draft Scene 41.
9. Validate Scene 41.
10. Extract state changes.
11. Create Scene 42.
12. Draft Scene 42.
13. Validate transition.
14. Update state.
15. Repeat.
16. Assemble chapter.
17. Run chapter continuity.
18. Run prose checks.
19. Run character checks.
20. Present chapter and diagnostics.
```

A model may only generate 1,000–2,000 words during each operation.

The harness assembles coherent long-form work through iteration.

This is one of the fundamental principles of the product.

---

# 31\. AUTONOMOUS BOOK BUILDING

Eventually support high-level operations such as:

```
/write-book --outline approved-outline-v4
```

Conceptual execution:

```
BOOK BUILD

Planning Chapter 1...
Drafting Scene 1/4...
Validating...
Updating state...

Drafting Scene 2/4...
Validating...

Chapter 1 complete.
4,921 words.

Running continuity...
Updating story state...
Creating checkpoint...

Planning Chapter 2...
```

Support approval modes:

```
Approval Mode

○ Every edit
○ Every scene
● Every chapter
○ Every act
○ Autonomous
```

Autonomous mode must still:

- checkpoint work

- maintain audit trail

- run validation

- respect tests

- stop on critical errors

- allow rollback

The objective is not a single enormous generation.

It is an autonomous writing pipeline.

---

# 32\. DETERMINISTIC ORCHESTRATION

Do not let an LLM improvise every workflow.

Where a process can be deterministic, implement it deterministically.

Example:

```
draft_chapter()
```

should invoke an orchestrated pipeline:

```
load_state
↓
compile_context
↓
plan_scenes
↓
approval_gate
↓
draft_scene
↓
semantic_checks
↓
revision
↓
state_extraction
↓
continuity_tests
↓
repeat
↓
chapter_review
↓
checkpoint
```

The LLM performs tasks requiring creativity, language understanding or judgement.

Software controls:

- loops

- state transitions

- permissions

- branching

- validation

- file operations

- versioning

- dependency resolution

- retries

- approvals

- workflow progression

**LLM for intelligence. Code for process.**

---

# 33\. APPROVAL AND PERMISSION SYSTEM

Agents should have configurable autonomy.

Possible permissions:

```
Read manuscript
Read canon
Edit manuscript
Edit story state
Create entities
Delete entities
Run research
Create branches
Apply refactors
Run simulations
Use external services
```

Approval policies may include:

```
Always ask before editing manuscript
Ask before destructive operations
Allow metadata updates automatically
Allow compiler fixes automatically
Allow edits only inside current chapter
```

The user should always understand what an agent is permitted to do.

---

# 34\. WRITING TERMINAL / COMMAND PALETTE

Provide command-style interaction for power users.

Examples:

```
/inspect character mara

/outline chapter 17

/draft scene SCENE_0041

/rewrite SCENE_0041 --dialogue-only

/continuity act2

/trace clue bloody_watch

/find "Mara knows about the key"

/voice-check elias

/build

/debug betrayal_marcus

/refactor "make Mara the detective"

/branch darker-ending

/reader-sim chapter 1..20

/character-pass mara
```

Commands should map to real structured operations and skills.

Non-technical users should be able to perform the same actions through graphical controls.

---

# 35\. MODEL ROUTER

Do not permanently bind the product to one model provider.

Create a provider abstraction.

Conceptually:

```typescript
interface LanguageModel {
    generate(...)
    stream(...)
    toolCall(...)
    structuredOutput(...)
}
```

Support adapters over time for:

- Anthropic

- OpenAI

- Google

- OpenRouter

- local models

- Ollama

- OpenAI-compatible APIs

- future providers

Allow task-specific routing.

Example:

```
Planning       → strongest reasoning model
Drafting       → preferred prose model
Continuity     → large-context reasoning model
Copy editing   → inexpensive model
Metadata       → cheap/local model
Reader sims    → inexpensive parallel models
Research       → research-capable model
Embeddings     → embedding model
```

Users should eventually support:

- hosted credits

- bring your own API key

- local models

- per-agent model selection

- automatic routing

- cost limits

- privacy preferences

The architecture must remain provider-independent even if Claude is initially used heavily.

---

# 36\. COST AND TOKEN INTELLIGENCE

Because novel-scale agentic work can be expensive, provide model-usage visibility.

Track:

- tokens

- estimated cost

- model

- operation

- agent

- project

- workflow

Allow policies such as:

```
Use local model for metadata extraction.

Use premium model only for final prose.

Maximum £2 per chapter build.

Use cheap models for reader simulation.

Ask before operations estimated above £X.
```

Cache reusable context and derived data where appropriate.

---

# 37\. RESEARCH SYSTEM

Research should be a first-class project component.

Agents should be able to:

- search research

- attach research to scenes

- attach sources to facts

- distinguish fictional canon from real-world research

- identify unsupported factual claims

- preserve citations internally

- summarise source material

- retrieve only relevant research during drafting

Research must never silently become fictional canon.

The system should distinguish:

```
CANON FACT

RESEARCH FACT

AUTHOR NOTE

MODEL INFERENCE

UNVERIFIED IDEA
```

---

# 38\. PLUGIN / TOOL ECOSYSTEM

Design for extensibility.

Eventually allow third-party tools analogous to an MCP/plugin ecosystem.

Potential integrations:

- historical research

- books/reference databases

- maps

- name databases

- etymology

- language tools

- screenplay formatters

- audiobook narration

- publishing formatters

- grammar engines

- timeline engines

- worldbuilding generators

- image generation

- character portraits

- map generation

- Scrivener import/export

- Word import/export

- EPUB

- PDF

- Kindle-ready export

Developers should eventually be able to add specialised writing tools without modifying the core application.

---

# 39\. IMPORT AND EXPORT

Users must never feel trapped.

Support eventually:

### Import

- Markdown

- plain text

- DOCX

- Scrivener where practical

- EPUB where legally/technically appropriate

- structured project formats

### Export

- Markdown

- DOCX

- PDF

- EPUB

- manuscript format

- screenplay format where applicable

- complete portable project archive

Export should preserve the writer's actual manuscript independently from internal AI metadata.

---

# 40\. SEARCH

Create powerful project-wide search.

Support:

- exact text

- fuzzy text

- semantic search

- entity search

- dialogue-only search

- character appearance search

- location search

- timeline search

- state search

- fact search

Examples:

> Find every scene where Mara and Elias are alone.

> Find every mention of the brass key before Chapter 20.

> Find every scene where Elias knows about the vault but Mara doesn't.

This should use structured data wherever possible rather than forcing an LLM to scan everything.

---

# 41\. PROJECT MEMORY

Separate project memory from chat history.

Potential layers:

### Canon Memory

Explicit truths.

### Working Memory

Current task and temporary working state.

### Author Preference Memory

Stable stylistic/user preferences.

### Agent Memory

Useful workflow-specific information.

### Conversation History

Previous interactions.

Chat history should not become the primary source of truth.

The repository is the source of truth.

---

# 42\. STORY SUMMARISATION LAYERS

Maintain hierarchical summaries.

Potential levels:

```
Scene summary
Chapter summary
Sequence summary
Act summary
Character arc summary
Plot-thread summary
Whole-book summary
```

Summaries should be regeneratable from source material.

Never allow a summary to silently override source canon.

Use summaries to improve context efficiency.

---

# 43\. BACKGROUND INDEXING

When manuscript content changes, queue relevant derived updates.

Potential jobs:

- update full-text index

- update embeddings

- extract entities

- propose state changes

- refresh scene summary

- refresh chapter summary

- inspect continuity impact

- update graph edges

- update repetition statistics

Do not unnecessarily block the writing experience.

Clearly distinguish automatically derived information from confirmed canon.

---

# 44\. AI STATE EXTRACTION

After drafting or editing a scene, the system may propose state changes.

Example:

```
Detected state changes:

Elias:
+ learns FACT_VAULT_EXISTS
+ receives OBJECT_BRASS_KEY
location → Blackthorn Manor

Mara:
trust(Elias) 0.61 → estimated 0.54

Plot:
THREAD_CELLAR_KEY introduced

[Confirm]
[Edit]
[Reject]
```

Objective state changes should be easier to confirm automatically.

Subjective inferred state should be labelled accordingly.

Do not silently convert speculative AI interpretation into canonical state.

---

# 45\. STORY HEALTH DASHBOARD

Eventually provide a project dashboard.

Possible signals:

- manuscript word count

- chapter lengths

- POV distribution

- character appearances

- plot-thread activity

- unresolved threads

- continuity warnings

- pacing estimates

- dialogue percentage

- scene conflict levels

- reader simulation results

- revision progress

- test status

Avoid pretending subjective metrics equal literary quality.

Use them as diagnostic tools.

---

# 46\. SEMANTIC ANALYSIS PRINCIPLES

The product will perform subjective analysis.

Always distinguish:

```
FACT
DETERMINISTIC RESULT
MODEL JUDGEMENT
INFERENCE
SUGGESTION
```

Never present:

> This scene is boring.

as objective fact.

Prefer:

> Three reader simulations reported reduced engagement here, and the scene contains lower conflict than the preceding five scenes.

Explain evidence.

---

# 47\. FAILURE RECOVERY

Long-running workflows must survive failures.

Every substantial workflow should support:

- checkpoints

- resumability

- retry

- partial completion

- error logs

- cancellation

- rollback

Example:

```
BOOK BUILD INTERRUPTED

Completed:
Chapters 1–14

Current:
Chapter 15
Scene 3/5

Last safe checkpoint:
BUILD_0041

[Resume]
[Inspect]
[Rollback]
```

Never require a 100,000-word generation workflow to restart because one model request failed.

---

# 48\. AGENT TASK SYSTEM

Agents need explicit tasks.

A task should contain:

```
goal
scope
allowed files/entities
required context
tools
acceptance criteria
tests
approval policy
status
dependencies
```

Complex requests should be decomposed.

Example:

```
TASK
Strengthen Act II.

SUBTASKS

1. Diagnose Act II pacing.
2. Inspect character arcs.
3. Inspect plot-thread progression.
4. Produce intervention plan.
5. Request approval.
6. Apply approved structural changes.
7. Run Story Build.
8. Present diffs and report.
```

Task state must persist independently of chat.

---

# 49\. MULTI-AGENT COORDINATION

Specialist agents should be able to cooperate without independently corrupting the manuscript.

Use controlled orchestration.

Example:

```
Architect
    ↓
Scene Director
    ↓
Drafter
    ↓
Character Editor
    ↓
Continuity Editor
    ↓
Prose Editor
    ↓
Story Compiler
```

Agents should pass structured outputs.

Avoid endless uncontrolled agent conversations.

The orchestrator decides when another specialist is useful.

---

# 50\. HUMAN-FIRST WRITING MODE

The product must remain excellent when the writer wants to write manually.

AI should enhance rather than obstruct traditional writing.

Features should include:

- clean editor

- no-AI mode

- focus mode

- notes

- comments

- scene cards

- outline

- project navigation

- search

- revision history

A user should be able to write an entire novel manually while benefiting from the organisational and analytical infrastructure.

---

# 51\. INLINE AI

Provide lightweight AI actions directly in the editor.

Examples:

- rewrite

- shorten

- expand

- change tone

- strengthen subtext

- improve dialogue

- remove exposition

- continue

- describe

- inspect consistency

Inline AI should still use the Context Compiler.

It must not become a disconnected miniature chatbot.

---

# 52\. PROJECT RULES

Allow writers to define hard and soft project rules.

Examples:

```
HARD RULE
Magic cannot resurrect the dead.

HARD RULE
Only Elias POV until Chapter 20.

SOFT RULE
Avoid more than two consecutive introspective scenes.

STYLE RULE
Never use semicolons in dialogue.

CHARACTER RULE
Mara never willingly discusses her mother before Chapter 24.
```

Compiler and agents should respect these rules.

---

# 53\. FORESHADOWING AND PAYOFF SYSTEM

Treat setups and payoffs as linked entities.

Example:

```
SETUP:
SCENE_0008
Brass key shown in father's drawer.

PAYOFF:
SCENE_0057
Key opens cellar archive.

VISIBILITY:
subtle

READER_INTERPRETATION:
mundane object
```

Detect:

- setup without payoff

- payoff without sufficient setup

- excessively obvious setup

- forgotten setup

- conflicting setup

Allow multiple-stage foreshadowing.

---

# 54\. PLOT THREAD SYSTEM

Every plot thread should have a lifecycle.

Potential states:

```
planned
introduced
active
escalating
dormant
resolved
abandoned
```

Track appearances.

Example:

```
THREAD_MISSING_PHOTOGRAPH

Introduced: Ch04
Advanced: Ch06
Advanced: Ch09
Dormant: Ch10–Ch21
Resolved: Ch27
```

Compiler can flag suspicious dormancy.

Do not automatically assume dormancy is bad.

---

# 55\. OBJECT CONTINUITY

Important objects should be entities.

Track:

- ownership

- location

- condition

- appearances

- transfers

- destruction

- knowledge

Example:

```
OBJECT_REVOLVER

Ch19:
location = Elias's flat

Ch22:
used by Elias at Blackthorn Manor
```

Compiler:

```
Possible continuity error:
No recorded transfer explains how OBJECT_REVOLVER
moves between locations.
```

---

# 56\. WORLD RULE ENGINE

Worldbuilding rules should be structured and queryable.

Examples:

```
RULE_MAGIC_001
Resurrection is impossible.

RULE_TRAVEL_004
London → Blackthorn Manor requires minimum 3 hours by car.

RULE_POLITICS_008
Only council members may enter Archive Chamber.
```

Use these rules during:

- drafting

- continuity

- timeline checking

- refactoring

- simulations

---

# 57\. PROJECT TEMPLATES

Support project templates.

Examples:

- blank novel

- mystery

- fantasy epic

- thriller

- romance

- screenplay

- short story

- television episode

- series bible

Templates should configure:

- folders

- entity types

- genre modules

- default tests

- agents

- skills

- metadata

---

# 58\. SERIES / UNIVERSE SUPPORT

Eventually allow multiple books to share a universe.

Conceptually:

```
UNIVERSE
│
├── shared canon
├── characters
├── world
├── history
│
├── Book 1
├── Book 2
└── Book 3
```

Support:

- global canon

- book-specific state

- spoilers

- character aging

- timeline continuity

- recurring objects

- series-level arcs

A later book must be able to query earlier canon without loading every previous manuscript indiscriminately.

---

# 59\. PRIVACY AND LOCAL-FIRST DESIGN

Where practical, design around local-first project ownership.

The writer's manuscript is sensitive intellectual property.

Architecture should make it possible to support:

- local projects

- local database

- local models

- BYOK APIs

- cloud sync as optional infrastructure

- encrypted remote storage where implemented

Do not architect the system so that every project fundamentally requires one company's cloud.

---

# 60\. COLLABORATION — FUTURE

Design so collaboration is possible later.

Potential roles:

- author

- co-author

- editor

- beta reader

- researcher

Possible features:

- comments

- suggestions

- tracked revisions

- permissions

- shared branches

- editorial tasks

Do not let collaboration complexity compromise the initial single-user architecture.

---

# 61\. PLUGIN AND SKILL MARKETPLACE — FUTURE

Eventually allow creators to distribute:

- agents

- skills

- genre modules

- project templates

- compiler rules

- context recipes

- export tools

- research integrations

Examples:

```
Police Procedural Auditor
Epic Fantasy Worldbuilding Suite
Romance Beat Inspector
Historical Dialogue Checker
Screenplay Production Pack
```

The core application becomes a platform.

---

# 62\. INITIAL TECHNOLOGY DIRECTION

Use a maintainable architecture suitable for an eventual desktop application.

Preferred initial direction:

- TypeScript

- React

- Tauri or equivalent desktop shell

- SQLite for structured local state

- Markdown/YAML/JSON for portable story files

- strongly typed domain models

- provider-independent model abstraction

- background job system

- local full-text search

- optional vector index

Do not over-engineer infrastructure before product behaviour is proven.

Maintain strict separation between:

```
UI
Application services
Agent runtime
Story domain
Persistence
Model providers
External integrations
```

---

# 63\. DOMAIN LAYER

Create a real fiction domain model.

Core concepts may include:

```
Project
Manuscript
Act
Chapter
Scene
Character
Location
Object
Faction
Event
Fact
Belief
Knowledge
Relationship
PlotThread
Clue
Foreshadowing
WorldRule
Timeline
StoryState
Revision
Branch
Test
Agent
Skill
Task
Simulation
ResearchItem
```

Do not allow UI components or model responses to become the authoritative representation of domain state.

---

# 64\. MODEL OUTPUT VALIDATION

Never depend blindly on LLM output format.

When structured output is required:

1. Define schema.

2. Request structured response.

3. Validate response.

4. Retry/repair when appropriate.

5. Reject invalid mutations.

6. Log failure.

No model response should be able to corrupt the project merely because it returned malformed JSON.

---

# 65\. TRANSACTIONAL AI EDITS

Large AI operations should behave transactionally where possible.

Example:

> Rewrite Chapter 12 and update affected state.

The system should stage:

```
manuscript edits
state changes
thread changes
knowledge changes
summaries
index updates
```

Then validate.

Only after successful validation should the operation be committed.

If validation fails, preserve the previous safe state.

---

# 66\. FIRST MAJOR PRODUCT DEMONSTRATION

Target an early demonstration that communicates why this product is fundamentally different.

Workflow:

1. Create a mystery project.

2. Create five characters.

3. Create premise.

4. Generate 12-chapter outline.

5. Draft Chapter 1.

6. Establish structured story state.

7. Ask:

> Change Marcus from Elias's brother to his childhood friend.

System responds:

```
STORY REFACTOR ANALYSIS

Changing relationship:
Marcus → Elias
brother → childhood friend

Affected:

• Character: Marcus
• Character: Elias
• Chapter 1
• Chapter 4
• Chapter 7
• Plot thread: family inheritance
• Scene SC019
• Dialogue reference SC031

7 dependent story elements detected.

[Review]
[Create Branch + Apply]
[Cancel]
```

Then apply the refactor.

Show diffs.

Run Story Build.

This demonstrates:

- structured repository

- dependency awareness

- AI editing

- state

- refactoring

- version control

- validation

This is a far stronger demonstration than simply generating prose.

---

# 67\. V1 — WRITING IDE

The first usable product should prove the core paradigm.

Implement:

- project creation

- portable project repository

- manuscript/chapter structure

- characters

- locations

- basic plot threads

- editor

- project tree

- AI panel

- basic agent runtime

- typed file/story tools

- Context Compiler V1

- project search

- AI edits

- diffs

- checkpoints

- undo/revert

- model abstraction

- basic local persistence

V1 does not need every advanced story system.

It must prove:

**AI can operate reliably on a fiction project instead of merely chatting about it.**

---

# 68\. V2 — STORY INTELLIGENCE

Add:

- scenes as entities

- story state

- timeline

- character knowledge

- relationships

- object continuity

- plot-thread lifecycle

- world rules

- Story Compiler

- deterministic checks

- semantic checks

- dependency graph

- Story Refactor V1

- Story Debugger V1

At this stage, the application begins understanding the structure of the story.

---

# 69\. V3 — AGENT SYSTEM

Add:

- Author Agent

- Architect

- Scene Director

- Drafter

- Continuity Editor

- Character Editor

- Dialogue Editor

- Prose Editor

- Developmental Editor

- Copy Editor

- custom agents

- Writing Skills

- task orchestration

- multi-agent workflows

- agent permissions

- model routing

---

# 70\. V4 — SIMULATION AND ADVANCED INTELLIGENCE

Add:

- Reader Simulator

- Character Simulator

- mystery auditing

- Story Tests

- semantic tests

- reader-state persistence

- suspicion/trust graphs

- character behavioural analysis

- advanced knowledge graph

- advanced causality analysis

---

# 71\. V5 — AUTONOMOUS PRODUCTION

Add:

- chapter build pipelines

- act build pipelines

- book build pipelines

- approval gates

- autonomous revision passes

- resumable long-running tasks

- automatic validation

- state extraction

- checkpointing

- `/write-book`

The system should be capable of producing long-form work through hundreds of controlled operations rather than one giant model response.

---

# 72\. V6 — ECOSYSTEM

Add:

- plugin protocol

- agent sharing

- skill sharing

- genre modules

- marketplace

- external research tools

- publishing integrations

- richer import/export

- series/universe support

- collaboration

- community extensions

---

# 73\. DEVELOPMENT RULES FOR CLAUDE CODE

When implementing this product, follow these rules.

### Rule 1

Read relevant architecture documentation before implementing features.

### Rule 2

Do not bypass the domain layer.

### Rule 3

Never make canonical story state dependent solely on an LLM response.

### Rule 4

Prefer deterministic software whenever deterministic software can solve the problem.

### Rule 5

Use LLMs where creativity, interpretation, semantic reasoning or natural language understanding is genuinely useful.

### Rule 6

All AI manuscript mutations must be reversible.

### Rule 7

All important AI actions must be auditable.

### Rule 8

Never tie core project data permanently to one model provider.

### Rule 9

Never make manuscripts dependent on a proprietary cloud-only format.

### Rule 10

Validate all structured model outputs.

### Rule 11

Do not silently convert AI inference into canon.

### Rule 12

Separate objective facts from subjective AI judgements.

### Rule 13

Build reusable primitives instead of one-off prompt hacks.

### Rule 14

Do not use chat history as the project's primary memory system.

### Rule 15

The Story Repository is the authoritative project source.

### Rule 16

Agents should receive the minimum useful context rather than indiscriminately loading everything.

### Rule 17

Large workflows must support checkpoints and recovery.

### Rule 18

Do not implement autonomous destructive changes without appropriate safeguards.

### Rule 19

Preserve human manual editing as a first-class workflow.

### Rule 20

Do not optimise merely for impressive demos at the cost of architecture required for novel-scale work.

---

# 74\. REQUIRED ARCHITECTURE DOCUMENTATION

Maintain living documentation inside the repository.

At minimum:

```
/docs/

VISION.md
ARCHITECTURE.md
DOMAIN_MODEL.md
STORY_REPOSITORY.md
STORY_STATE.md
CONTEXT_COMPILER.md
STORY_COMPILER.md
AGENT_RUNTIME.md
AGENT_TOOLS.md
MODEL_ROUTER.md
VERSIONING.md
STORY_REFACTOR.md
STORY_DEBUGGER.md
SIMULATIONS.md
SECURITY_PRIVACY.md
UX.md
ROADMAP.md
```

Create root-level:

```
AGENTS.md
```

containing implementation rules for coding agents.

Update documentation when architectural decisions change.

---

# 75\. DESIGN PRINCIPLE: STRUCTURE WITHOUT CONSTRAINING CREATIVITY

Do not turn fiction into a spreadsheet.

Structured data exists to assist the writer and AI.

It must not require every writer to quantify every emotion, relationship or scene.

Support progressive structure.

A writer should be able to begin with:

```
Chapter 1.md
Chapter 2.md
Chapter 3.md
```

and gradually gain structured intelligence.

The system can propose entities and metadata.

The user can confirm them.

Advanced users can model stories deeply.

Casual users can remain lightweight.

---

# 76\. DESIGN PRINCIPLE: EXPLAIN THE SYSTEM'S UNDERSTANDING

Whenever possible, allow the user to inspect why the system believes something.

Example:

```
System believes Mara knows about the vault.

Evidence:

SCENE_0041:
"Mara stared at the plans. The chamber beneath the west wing..."

State transition:
FACT_VAULT_EXISTS added after SCENE_0041.

[Correct]
[Inspect]
```

This makes story intelligence debuggable.

---

# 77\. DESIGN PRINCIPLE: AI SHOULD INVESTIGATE BEFORE MODIFYING

For broad or ambiguous changes, agents should default to:

```
inspect
→ diagnose
→ plan
→ modify
→ validate
```

not:

```
prompt
→ immediately rewrite everything
```

This is one of the key behaviours borrowed from capable coding agents.

---

# 78\. DESIGN PRINCIPLE: PROJECT SCALE

Architect for:

- short stories

- novels

- 200,000-word fantasy novels

- trilogies

- long-running series

- large worldbuilding repositories

Do not assume the entire project can fit comfortably in model context.

Every core subsystem must work under that assumption.

---

# 79\. DESIGN PRINCIPLE: AUTHORIAL CONTROL

AI must never make it difficult to distinguish:

- what the author wrote

- what AI wrote

- what AI changed

- why something changed

- how to undo it

The system should increase the writer's control rather than making the manuscript opaque.

---

# 80\. LONG-TERM NORTH STAR

The completed environment should make requests like these normal:

> Read my entire project and tell me why Act II feels weaker than Act I. Investigate before proposing edits.

> Trace every clue related to the murder and tell me the earliest chapter where an attentive reader could reasonably identify the killer.

> Show me everything Mara knows immediately before entering the manor.

> Find every instance where Elias behaves inconsistently with his established fear of confinement.

> Try an alternative branch where Marcus survives Chapter 28 and determine what later scenes break.

> Make Mara the detective instead of Elias. Analyse the blast radius before touching the manuscript.

> Run five reader simulations through Chapters 1–20 without giving them future information. Show me who each reader suspects after every chapter.

> Rewrite only Marcus's dialogue across Act II to make his voice more distinct. Preserve plot information and show every diff.

> Check whether any character knows something before they could reasonably know it.

> Build Chapter 17 from the approved scene plan. Stop for approval after the chapter.

> Run the mystery audit.

> Run the Story Compiler.

> Debug the betrayal reveal.

> Branch the project and try a darker ending.

> Compare both endings structurally and emotionally.

> Continue building the book overnight, checkpoint after every chapter, stop on critical continuity failures, and leave every revision reviewable.

Ultimately:

```
/write-book
```

should not mean:

> Ask a model to generate a novel.

It should mean:

> Launch a sophisticated, persistent, stateful, validated, multi-stage fiction production pipeline.

---

# 81\. PRODUCT DEFINITION

The final product should be understood as:

**An AI-native IDE and agentic development environment for fiction.**

Its core innovation is not merely text generation.

Its innovation is giving AI writers the infrastructure that AI programmers already benefit from:

- persistent repositories

- structured project state

- specialised tools

- intelligent context construction

- search

- agents

- subagents

- reusable skills

- task orchestration

- tests

- debugging

- dependency analysis

- refactoring

- version control

- branches

- diffs

- validation

- simulation

- model routing

- long-running workflows

- resumability

- automation

- extensibility

The manuscript becomes something an intelligent system can **inspect, understand, operate on, test, debug, refactor and build**.

That is the product.

---

# 82\. FINAL IMPLEMENTATION DIRECTIVE

Do not attempt to implement this entire specification simultaneously.

Treat this document as the permanent north-star architecture and product vision.

Implementation should proceed vertically.

For every major capability:

1. Define the domain model.

2. Define the user experience.

3. Define tool interfaces.

4. Define deterministic behaviour.

5. Identify where model intelligence is required.

6. Define model schemas.

7. Define persistence.

8. Define versioning implications.

9. Define tests.

10. Implement the smallest complete vertical slice.

11. Validate it using a realistic novel project.

12. Update architecture documentation.

13. Continue to the next capability.

Do not build disconnected mock features.

Every feature should progressively strengthen the same underlying fiction operating environment.

The first milestone is not:

**"AI can write prose."**

Modern models already can.

The first milestone is:

**"AI can safely and intelligently operate on a structured fiction project."**

The second is:

**"The system understands enough story structure to detect and reason about consequences across the project."**

The third is:

**"Specialised agents can collaboratively perform professional-scale fiction-development workflows."**

The fourth is:

**"The system can simulate readers and characters to test narrative behaviour."**

The fifth is:

**"The harness can reliably execute novel-scale production and revision workflows over long periods while preserving consistency, state, recoverability and human control."**

At every stage, preserve the central principle:

> **The model is not the product. The harness around the model is the product.**

Build the environment that allows AI to work on fiction with the same persistence, tooling, structure, iteration and project awareness that the best AI coding environments provide to software development.

That is the master vision.

