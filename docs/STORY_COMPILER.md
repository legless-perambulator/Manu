# STORY_COMPILER

The fiction equivalent of compiling and testing software. The writer presses
**Build Story** and gets real continuity diagnostics, produced by arithmetic
over structured state rather than by a model re-reading the manuscript.

- **Package:** `@jellytind/story-compiler`
- **Depends on:** `@jellytind/domain`, `@jellytind/shared`, `@jellytind/story-state`
- **Status (Phase 16):** **V1 implemented and tested.** The diagnostic model,
  the rule registry, ten deterministic rules, configuration, build history and
  comparison, the agent tools and the Story Build view are built. Semantic
  checks, Story Tests and full incremental compilation are **PLANNED**.

## The premise

Every subsystem before this one recorded something: who is where, who knows
what, when things happen, where objects have been, what the story has promised.
The compiler is what makes that investment pay: one command that asks every
recorded system whether the story holds together, and answers in a list a writer
can act on.

**The acceptance test is that pressing Build Story produces real continuity
diagnostics from structured story state.** Not a model's opinion — arithmetic.

## The compiler consumes; it does not duplicate

This is the load-bearing decision. Almost every rule is a **thin adapter** over
a check that already exists in the subsystem that owns the data:

| Rule                    | Consumes                                        |
| ----------------------- | ----------------------------------------------- |
| `referential_integrity` | the entity graph's `checkIntegrity()`           |
| `location_structure`    | `checkContinuity` (domain location tree)        |
| `character_continuity`  | `checkContinuity`                               |
| `object_continuity`     | `checkContinuity`                               |
| `knowledge_continuity`  | `checkKnowledgeViolations`                      |
| `timeline_consistency`  | `checkTimeline`                                 |
| `thread_lifecycle`      | `checkNarrative`                                |
| `setup_payoff`          | `checkNarrative`                                |
| `scene_relationships`   | — structural, and nowhere else to live          |
| `world_rules`           | — recorded statuses against declared hard rules |

Re-deriving any of that inside the compiler would create a second
implementation of continuity to drift apart from the first. A rule's job is to
run the check that already exists and dress its findings as diagnostics with
evidence and a suggested action.

The two rules with no upstream owner are genuinely new checks, and even those
live as close to their data as they can: "a dead character appears alive" was
added to `checkContinuity` in `@jellytind/story-state`, beside its siblings,
rather than inside the compiler.

## Diagnostics

```ts
interface Diagnostic {
  id: string; // stable fingerprint
  ruleId: string;
  severity: "error" | "warning" | "info";
  message: string;
  entities: string[];
  sceneId?: string;
  chapterId?: string;
  evidence: string;
  suggestedAction?: string;
}
```

`evidence` is required. A finding that cannot say _why_ the compiler believes it
is a finding a writer cannot evaluate, and it will be ignored — deservedly.

### Severity means something

| Severity  | Meaning                                                    |
| --------- | ---------------------------------------------------------- |
| `error`   | a deterministic violation the recorded data cannot support |
| `warning` | a likely problem that may well be intentional              |
| `info`    | worth knowing; not a problem                               |

An unfinished book is _supposed_ to be full of open promises and long silences.
Grading those as errors would make the build useless during drafting, which is
when it is needed most.

**The compiler never presents subjective literary judgement as an error.**
Nothing in this version produces a finding a model had a hand in.

### Identity is a fingerprint

`id` is derived from the rule, the scene and the entities involved — **never
from the message**. That is what lets two builds be compared without rewording a
sentence inventing a "new" problem, and what makes "did my fix work?" answerable.

## The rule registry

```ts
interface StoryCompilerRule {
  id: string;
  name: string;
  category: RuleCategory;
  description: string;
  inputs: BuildInputKind[];
  run(context: BuildContext): DiagnosticDraft[] | Promise<DiagnosticDraft[]>;
}
```

Rules are **values, not code paths**, so the registry extends by concatenation:

```ts
buildStory([...CORE_RULES, ...myRules], context);
```

Later phases add rules this way, and plugins eventually will too, without the
build knowing anything about them.

### A rule that throws is a finding

One broken rule must not cost a writer the other nine answers. A throw becomes
an `error` diagnostic saying the check could not run, and the build continues —
because _a check that could not run is not a check that passed_, and a build
must never imply otherwise.

## Configuration

```ts
{
  disabledRules: ["scene_relationships"],
  disabledCategories: ["plot_threads"],
  severityOverrides: { thread_lifecycle: "info" },
  options: { dormantAfterScenes: 20 },
}
```

A severity override forces **every** finding from that rule to one severity: a
writer who wants dormancy as a note rather than a warning should not have to
learn which sub-finding is which.

`options` is typed rather than a bag of unknowns, because a setting nobody can
discover is a setting nobody uses. `dormantAfterScenes` has no default — the
right number for a thriller is wrong for a family saga
([NARRATIVE_THREADS.md](NARRATIVE_THREADS.md)).

## Skipped is not passed

A disabled rule, a rule outside an incremental run's scope, a rule that threw:
all are reported distinctly from `passed`, and the Story Build view says so
under **Not checked**. A build that quietly omitted a check would be worse than
no build.

The same honesty governs world rules: hard rules the compiler cannot evaluate
deterministically are reported as `info`, so a green build never implies they
were enforced.

## Build history and comparison

Builds are numbered, and their summaries persist under `.writer/builds/`.
Diagnostics live in per-build files, so a history list is one read regardless of
how much a project has accumulated.

```ts
repo.buildStory();
repo.listBuilds();
repo.compareToPreviousBuild(BUILD_0284);
// → { added, resolved, persistent }
```

**Builds are not change sets.** A build is derived analysis: running one changes
nothing about the story, so it is written straight to the store rather than
through the journal. Recording it as a change set would fill a writer's history
with entries they did not make ([VERSIONING.md](VERSIONING.md)).

## Incremental builds

Each rule declares what it reads:

```
entities · scenes · transitions · chronology · setups · world_rules · prose
```

`rulesAffectedBy(rules, changed)` maps a change to the rules it could possibly
affect, and `buildStory(..., { only })` runs just those. Full incremental
compilation — driven automatically from change sets — is not wired up yet, but
the seam is real, tested, and honest about its results: rules not re-run come
back as **skipped**, never as passed.

## Agent tools

```
run_story_build        — run the build; returns status, counts and diagnostics
get_build_diagnostics  — read a past build, filtered by severity or rule
```

Both are read-and-run under `read_canon`: running a build changes nothing. The
investigating agent has them, which is what lets it answer "is this project
consistent?" from deterministic diagnostics rather than from its own reading.

**There is no tool that applies a fix.** A diagnostic is a finding about the
writer's story, and acting on one is an editorial decision that stays with a
human until the workflow for reviewing such changes exists
([AI_EDITING.md](AI_EDITING.md)).

## The Story Build view

```
STORY BUILD 284                                        1 error

✓ Referential integrity      ✓ Timeline
✓ Location structure         ✓ Character knowledge

ERROR   object_continuity
SCENE_0003 takes place at LOC_0001 and uses OBJECT_0001, but OBJECT_0001
was last recorded at LOC_0002, and nothing moves it.
  Recorded position: LOC_0002.
  → Record the transfer that moves it, or correct the recorded position.
  [SCENE_0003] [OBJECT_0001] [LOC_0001] [LOC_0002]

WARNING setup_payoff
SETUP_0001 ("Brass key visible in father's drawer.") is planted in
SCENE_0001 and has no payoff recorded.
  → Record where the promise is kept, or mark the setup abandoned.

1 error, 1 warning, 0 notes · 12ms · 1 new, 2 resolved, 0 still open
```

Every diagnostic is clickable: an entity opens in the inspector, a scene opens
its chapter's prose and selects the scene. Diagnostics new since the last build
are marked, and resolved ones are listed struck through — the answer to "did that
work, and did I break anything?".

## What is deliberately absent

No check here is faked. These are named in the vision and are **not**
implemented, because they cannot yet be made reliable:

- POV rules beyond a scene's own coherence — needs prose analysis
- duplicate aliases and inconsistent physical descriptions — semantic
- repeated phrases and voice convergence — semantic
- most world rules — prose, and therefore model work
- pacing and scene-purpose judgements — semantic
- Story Tests (`EXPECT knows(CHAR_ELIAS, FACT) == false UNTIL CHAPTER_0037`)

A build a writer cannot trust is worse than a shorter one.

## Semantic analysis, when it arrives

Every result will be classified — `FACT` / `DETERMINISTIC RESULT` /
`MODEL JUDGEMENT` / `INFERENCE` / `SUGGESTION` — and semantic findings will
carry their evidence. Never _"This scene is boring."_ Instead:

> "Three reader simulations reported reduced engagement here, and the scene
> contains lower conflict than the preceding five scenes."

The `Severity` union will gain nothing: a model judgement is never an `error`.

## Relationship to other subsystems

- [STORY_STATE.md](STORY_STATE.md), [TIMELINE.md](TIMELINE.md),
  [OBJECTS_LOCATIONS.md](OBJECTS_LOCATIONS.md),
  [NARRATIVE_THREADS.md](NARRATIVE_THREADS.md) — where the checks actually live.
- [STORY_REPOSITORY.md](STORY_REPOSITORY.md) — assembles the build context and
  persists builds; the compiler depends on nothing above it.
- [AGENT_TOOLS.md](AGENT_TOOLS.md) — the two build tools.
- [VERSIONING.md](VERSIONING.md) — builds are per-branch and are not change sets.

## Invariants

- The compiler consumes existing checks; continuity logic is never duplicated here.
- Errors are deterministic. Subjective judgement is never an error.
- Every diagnostic carries evidence.
- A skipped rule is reported as skipped, never as passed.
- Diagnostic identity comes from what a finding is about, not how it is worded.
- Running a build changes nothing about the story.
- No check is faked; one that cannot be made reliable is absent and said to be.
