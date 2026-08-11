# STORY_DEBUGGER

A dedicated diagnostic mode that investigates **why** something is not working instead of immediately rewriting it.

## Status

Documentation stage (Story Debugger V1 targeted for V2).

## Principle

The debugger **diagnoses before editing**. It embodies the investigate-before-modifying default (see [AGENT_RUNTIME.md](AGENT_RUNTIME.md)):

```
inspect → diagnose → plan → (only then) modify → validate
```

## Example

Request: *"Marcus's betrayal isn't landing."*

```
Tracing Marcus betrayal...
Reveal: Chapter 34

Expected prerequisites:
  ✓ Reader attachment
  ✓ Trust established
  ✗ Personal sacrifice establishing loyalty
  ✓ Concealed motive
  ⚠ Suspicion introduced too early

Evidence:
  Ch7 Marcus saves Elias · Ch11 suspicious absence · Ch14 suspicious phone call
  Ch19 suspicious lie · Ch21 suspicious disappearance

Diagnosis:
  Reader suspicion likely reaches high levels ~8–10 chapters before the intended reveal.

Suggested intervention:
  Remove/reinterpret/counterbalance the Chapter 14 signal.
  Strengthen a loyalty-confirming action between Chapters 15–18.
```

## Debugger workflows

Diagnostic workflows exist for: weak reveals · flat character arcs · pacing problems · unearned decisions · weak endings · missing setup · poor payoff · mystery solvability · romance progression · thematic inconsistency · exposition problems · dialogue voice convergence.

## How it works

- Traces the target through structured data: scene metadata, [story state](STORY_STATE.md), knowledge transitions, the causality graph, foreshadowing links, and (where available) [reader-simulation](SIMULATIONS.md) signals.
- Presents **evidence** for every conclusion; subjective findings are labelled as model judgement, never objective fact (see semantic principles in [STORY_COMPILER.md](STORY_COMPILER.md)).
- Proposes interventions as suggestions; it does not silently edit the manuscript.

## Relationship to other subsystems

- Reads the same structured data the [Story Compiler](STORY_COMPILER.md) checks, but is investigative and narrative rather than pass/fail.
- Feeds proposed changes into the normal mutation/approval flow (see [VERSIONING.md](VERSIONING.md)) when the author chooses to act.

## Invariants

- Diagnosis precedes modification.
- Every diagnosis cites evidence.
- Interventions are proposals subject to approval, not automatic edits.
