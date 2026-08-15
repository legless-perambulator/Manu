# WRITING_SKILLS

Repeatable fiction-development workflows.

- **Packages:** `@jellytind/skills` (the operations, the skills, the runner),
  `@jellytind/domain` (the run record), `@jellytind/story-repository`
  (persistence), `@jellytind/editing` (the semantic port's implementation)
- **Status (Phase 25):** **Implemented and tested.** Thirty-four operations,
  eight shipped skills, step-by-step progress, resumable runs, custom skills
  loaded from the project. `/fairness-audit` was added by the Mystery Engine
  (Phase 29) as six further operations and no new machinery — which is the
  point of the registry.

## A skill is not a saved prompt

A prompt asks a model to do everything at once and hopes. A skill is a
**sequence of structured operations against the Story Repository**, each of
which writes down what it found before the next one starts:

```
Character Pass — Mara

✓ Located 31 scenes, 12 in their POV
✓ Reconstructed chronology — 2 flashback scenes, longest absence 7 scenes
✓ Reconstructed knowledge — 9 recorded changes across 14 facts
✓ Reconstructed 4 relationships with 11 recorded changes
→ Inspecting dialogue
```

Nothing in that list is a model's opinion. Every line is a query whose answer
the project already holds, which is why running the same skill twice on an
unchanged project produces the same report twice — and why it works with no
model configured at all.

## The shape

```
Skill {
  id · command · name · description
  inputs          what it needs before it can run
  steps           named operations, in order
  requiredTools   derived from the steps
  contextRecipes  derived from the steps
  preferredAgent  whose work this is (docs/SPECIALIST_AGENTS.md)
  outputSchema    the sections a finished run carries
}
```

`requiredTools` and `contextRecipes` are **derived**, never restated: a skill
cannot claim a surface its steps do not use.

### Operations are the alphabet

A skill carries no code. It names operations from one registry, and each
operation declares what it needs and what it leaves behind:

```
locate_character_scenes   requires characterId          → scenes
reconstruct_chronology    reads scenes                  → chronology
reconstruct_knowledge     requires characterId          → knowledge
inspect_arc               reads scenes, knowledge, …    → arc
compile_report            reads nothing new             → report
```

That makes a workflow **checkable before it runs**. A step reading `scenes`
when no earlier step produces it is rejected at definition time, with a
sentence naming the step and the key — not at minute nine of an audit.

## The eight

| Command                 | What it does                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `/character-pass`       | Scenes → chronology → knowledge → relationships → dialogue → behaviour → arc → report |
| `/continuity-audit`     | Story Build → diagnostics → your own tests → semantic risks → categorise → report     |
| `/dialogue-pass`        | Identify dialogue → load voices → exposition → differentiation → subtext → report     |
| `/pacing-audit`         | Chapter and scene measurements → thread activity → a reading of them → report         |
| `/foreshadowing-audit`  | Setups → distance to payoff → thread activity → report                                |
| `/scene-purpose-audit`  | What each scene says it is for → what actually changes in it → categorise → report    |
| `/remove-ai-tendencies` | Count constructions → check your own rules → propose alternatives → report            |
| `/fairness-audit`       | Clue system → chain of reasoning → fairness → solvability → alibis → readers → report |

Two ways in, one workflow: the Skills panel, or the command — `/character-pass
Mara`, resolved against the project's own entities so "Mara" becomes
`CHAR_0007` before anything runs. An argument that matches nothing is reported,
never guessed at.

## What a finding is

Findings carry their kind, because a writer deciding what to do next needs to
know which they are reading:

| Kind          | Means                                                              |
| ------------- | ------------------------------------------------------------------ |
| `conflict`    | Two records disagree. Deterministic and checkable.                 |
| `gap`         | The project records nothing here. **Not** a claim about the story. |
| `attention`   | Worth a look. Heuristic, and labelled as such.                     |
| `measurement` | A count, with its basis. Never a verdict.                          |
| `proposal`    | Something you could do. Nothing has applied it.                    |

And their source: `deterministic` or `model`. A model's contribution appears
beside what the project records, never inside it — the same separation the
agent panel and the debugger keep (AGENTS.md — "Canon vs Inference").

`/remove-ai-tendencies` is the clearest case. It counts fifteen named
constructions and reports _"began to" / "started to" appears 11 times_ with an
example. Whether that is a habit or a voice is the writer's call; the skill
changes nothing, and the model step produces proposals that nothing applies.

## Steps that could not run

`skipped` is a status of its own, with a reason, and it never becomes `ok`:

```
− Inspect subtext — No model is configured, so subtext was not inspected.
− Run the writer's own assertions — No story tests are recorded, so none were run.
− Locate every scene containing the character — Nobody appears in no recorded
  scene, so there is nothing to pass over.
```

A report is allowed to be thin. It is not allowed to imply it checked something
it did not. Every semantic step is skipped when no model is configured, and
every deterministic step still runs — which is most of every skill.

## Resumable

The run is written to `.writer/skills/runs/` **after every step**, with each
step's output stored as plain JSON under the key its operation produces. Later
steps read that record rather than a live object, so a run that stopped at step
three — a provider timeout, a closed lid, a crash — is picked up at step three:

```
✓ Run the Story Build            build SB_0003 passed — 4 diagnostics
✓ Inspect diagnostics            read 4 diagnostics across 3 rules
✗ Run the writer's own assertions — the disk went away
  Inspect suspicious semantic continuity
  Categorise findings
  Produce report
```

Resuming re-runs the failed step and everything after it. The two steps that
succeeded are not run again — no second build is produced — and their outputs
are what the remaining steps read. This is tested across a **closed and
reopened project**, not just within one session.

A step that was _skipped_ is not retried: skipping was the answer, and
re-running it would change what the report claims without the writer asking.

## The output schema is enforced

Each skill declares the sections a finished run carries, and `validateReport`
checks them. A section may be legitimately absent — when the step producing it
was skipped and said why — but anything else marks the run failed rather than
quietly returning less than it promised. (Phase 24 declared an output shape and
did not enforce it; this does.)

## Skills a writer writes

A custom skill is a JSON file in `.writer/skills/custom/`:

```json
{
  "id": "promise_sweep",
  "name": "Promise Sweep",
  "description": "Just the promises, before I start a revision.",
  "steps": [
    { "operationId": "inspect_setups" },
    { "operationId": "measure_setup_distance" },
    { "operationId": "compile_report" }
  ]
}
```

It is **a different order of the same operations** — not code, not a prompt.
There is nothing a custom skill can do that a shipped one cannot, which is what
makes loading one from a project safe. It is validated on load and again before
it is written, so a skill that could not run never reaches the project, and a
file that will not parse is **reported by name** rather than silently ignored.

No marketplace, no installation, no registry. The skill is a file in the
project, and it travels with the project because it _is_ the project.

## Where the model fits

Exactly four operations are semantic, and each states what it wants read:
suspicious continuity, subtext, a reading of the pacing measurements, and
alternatives for flagged constructions. They receive **only the material the
deterministic steps already retrieved** — no tools, no reach into the project —
and everything they return is labelled with the model that said it.

The port lives in `@jellytind/skills`; its implementation
(`ModelSkillAnalyst`) lives in `@jellytind/editing`, above the repository with
every other controlled model operation.

## Invariants

- A skill is a sequence of named operations; the operation registry is the
  boundary of what any skill can do.
- A workflow is validated before it runs, not during.
- The declared tool and recipe surface is derived from the steps.
- Every deterministic step runs with no model configured.
- `skipped` is never `ok`, and always carries a reason.
- The run is persisted after every step, and a stopped run resumes from where
  it stopped.
- Findings carry their kind and their source; a model's reading never becomes a
  project record.
- Nothing a skill produces changes the manuscript.

## Relationship to other subsystems

- [SPECIALIST_AGENTS.md](SPECIALIST_AGENTS.md) — each skill names the
  specialist whose work it is.
- [STORY_COMPILER.md](STORY_COMPILER.md) — `/continuity-audit` runs the build
  rather than re-implementing its checks.
- [CHARACTER_VOICE.md](CHARACTER_VOICE.md) — where `/dialogue-pass` gets the
  voices it measures against.
- [MYSTERY_ENGINE.md](MYSTERY_ENGINE.md) — what `/fairness-audit` reads
- [AUTHOR_VOICE.md](AUTHOR_VOICE.md) — the rules `/remove-ai-tendencies`
  checks, and will not propose breaking.
- [AI_EDITING.md](AI_EDITING.md) — why a proposal is not an edit.
- [COMMAND_LANGUAGE.md](COMMAND_LANGUAGE.md) — every skill's `/command`,
  built-in or custom, is registered in the terminal's command registry.
