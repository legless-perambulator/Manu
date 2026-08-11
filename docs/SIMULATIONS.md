# SIMULATIONS

Reader and character simulation systems used to test narrative behaviour. Both produce **model judgement**, presented with evidence — never objective science.

## Status

Documentation stage (targeted for V4 — Simulation and Advanced Intelligence).

## Character Simulator

Not "chat with your character." A character simulator receives memories, personality, goals, fears, knowledge, beliefs, relationships, current emotional state, physical state and current circumstances, then challenges proposed story behaviour.

Example — *Given everything Mara knows at this point, would she realistically enter the house alone?*

```
CHARACTER SIMULATION
Proposed action: Mara enters the house alone.
Consistency: Low
Primary conflicts:
  - established fear of enclosed spaces
  - knows suspect may be present
  - previously refuses unnecessary physical risk
  - has access to police backup
Estimated behavioural plausibility: 24%
Possible fixes:
  - remove access to backup
  - create urgent time pressure
  - establish overriding personal motive
  - alter earlier characterisation
```

Purpose: identify **plot-forced behaviour**. Probabilities are model judgement, not objective measurement.

The simulator draws its inputs from [Story State](STORY_STATE.md) at the relevant story time (what the character knows/feels *then*, not "latest").

## Reader Simulator

Virtual readers experience the manuscript **sequentially** and must not have access to future chapters. Reader state **persists** across chapters — do not reset the reader after each chapter.

Example profiles: genre expert / high mystery literacy; casual reader; emotion-focused reader; highly critical developmental reader.

After each chapter, record questions such as: what do you think is happening? who do you trust/suspect? what questions are you asking? what do you predict? what confused/bored/excited you? which emotional moments landed? what information do you remember?

Visualise signals over time, e.g. suspicion of a character across chapters:

```
SUSPICION OF MARA
100% ┤                        ╭──
 75% ┤                ╭───────╯
 50% ┤       ╭────────╯
 25% ┤───╮───╯
  0% └──────────────────────────
      1  5 10 15 20 25 30 35   CHAPTER
```

Use reader simulation for: mystery reveal timing · emotional response · confusion · pacing · predictions · trust · tension · character attachment · foreshadowing visibility.

## Design requirements

- **No future leakage.** A reader/character simulation is strictly bounded to information available at that story point (reader presentation order for readers; story chronology + character knowledge for characters). See truth/belief/reader-knowledge separation in [STORY_STATE.md](STORY_STATE.md).
- **Persistent state.** Reader state accumulates; it is stored and inspectable.
- **Judgement, not fact.** Outputs feed the [Story Debugger](STORY_DEBUGGER.md), story tests and dashboards as evidence, always labelled as simulation results.
- **Cost-aware.** Reader sims may run as inexpensive parallel model calls (see [MODEL_ROUTER.md](MODEL_ROUTER.md)).
- **Branch-aware.** Simulations can run per branch to compare alternatives (see [VERSIONING.md](VERSIONING.md)).

## Invariants

- Simulations never see information the reader/character could not have at that point.
- Results are model judgement with evidence; never presented as objective truth.
- Reader state persists across the run.
