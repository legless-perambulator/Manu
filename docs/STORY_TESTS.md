# STORY_TESTS

The fiction equivalent of automated tests. A writer states what must — or must
not — be true at a point in the story, and the project holds them to it for as
long as the book is being written.

- **Packages:** `@jellytind/domain` (the vocabulary),
  `@jellytind/story-compiler` (the engine), `@jellytind/story-repository`
  (persistence and validation)
- **Status (Phase 17):** **Deterministic tests implemented and tested.**
  Semantic tests are **declared, recorded and reported as not evaluated** — the
  shape exists, the evaluator does not.

## The premise

_Elias must not know the killer's identity before chapter 37._

That is the kind of thing an author holds in their head for eighteen months and
then breaks in a single afternoon's revision, three hundred pages away from the
scene that made it matter. Nothing in a manuscript records it. Nothing catches
it. It surfaces in a copy-edit, or in a review.

A story test writes it down in a form the project can check. Every build asks
the question again, so the intention survives the revision.

**The acceptance test is that a writer can encode important narrative
intentions as persistent executable assertions.**

## Two kinds of test, kept apart

| Kind              | Decided by                     | Can be `passed`?          |
| ----------------- | ------------------------------ | ------------------------- |
| **deterministic** | recorded state, replayed       | yes — it is true or false |
| **semantic**      | a model's reading of the prose | not yet: `not_evaluated`  |

`DeterministicAssertion` and `SemanticAssertion` are **separate unions**, so
the type system refuses to mix them, and `type` on a stored test is derived from
the assertion rather than chosen by the writer. Collapsing the two would let an
opinion be reported as a fact, which is the failure this whole product exists to
avoid.

A semantic test is never reported as passing. It comes back as
`not_evaluated`, with a reason, and is never turned into a build diagnostic —
**an unanswered question is not a satisfied one**, and a green suite that
quietly included unevaluated judgements would be a lie.

## The model

```ts
interface StoryTest {
  id: TestId; // TEST_0001
  name: string;
  description: string;
  type: "deterministic" | "semantic"; // derived from the assertion
  scope: TestScope;
  enabled: boolean;
  severity: "error" | "warning" | "info";
  assertion: Assertion;
  createdAt: string;
}
```

### Scope

Most narrative intentions are not "always true" but "true **until**". A system
that could only assert the former would be useless for exactly the promises
writers care about most.

```ts
{ kind: "always" }
{ kind: "at",      anchorId: SCENE_0012 }
{ kind: "before",  anchorId: CHAPTER_0037 }
{ kind: "from",    anchorId: CHAPTER_0037 }
{ kind: "between", anchorId: CHAPTER_0012, untilId: CHAPTER_0020 }
```

A scope resolves to the **scenes in story order** it covers, and the assertion
is checked at every one of them — so "before chapter 37" is checked at every
scene up to chapter 37, not merely at one convenient point.

A chapter anchor resolves to the chapter's **first** scene, so "before chapter
37" means "before chapter 37 begins", which is what a writer means when they say
it. The one exception is `between`'s `untilId`, which resolves to the chapter's
**last** scene, so a range ending at a chapter covers the whole of it.

Boundaries are **after**: an assertion is checked against the world as it stands
once the scene has happened — what "true at this point in the story" means to a
reader who has just finished it.

### Deterministic assertions

| Assertion                      | Answered from                           |
| ------------------------------ | --------------------------------------- |
| `character_knows_fact`         | knowledge state (`known` or `believed`) |
| `character_does_not_know_fact` | the same, negated                       |
| `character_alive`              | reconstructed character status          |
| `character_dead`               | the same, negated                       |
| `character_at_location`        | reconstructed character location        |
| `object_at_location`           | reconstructed object location           |
| `object_owned_by`              | reconstructed object ownership          |
| `plot_thread_status`           | thread lifecycle at that point          |
| `fact_true`                    | `Fact.objectiveTruth` and establishment |
| `relationship_status`          | reconstructed relationship status       |

Every one is answerable from recorded state alone. That is the entry
requirement: an assertion needing a model's reading belongs in the semantic
union.

### Semantic assertions

Declared now, evaluated later:

```ts
{ kind: "reader_suspicion", characterId, comparison: "below" | "above", level }
{ kind: "relationship_progression", relationshipId, expected }   // "slow-burn"
{ kind: "character_disposition", characterId, expected }         // "guarded"
{ kind: "free_form", statement }
```

These are the assertions a writer most wants — _the reader should not strongly
suspect Mara before chapter 22_, _the romance should feel slow-burn_, _Elias
should remain emotionally guarded_ — and none is decidable from structured
state. Recording them without an evaluator is deliberate: the shape exists,
tests can be written against it, and the engine says plainly that nothing has
answered them. They will be evaluated when Reader Simulation exists
([SIMULATIONS.md](SIMULATIONS.md)), and even then their results will be labelled
`MODEL JUDGEMENT` and will never be errors.

## Results

```ts
type TestStatus = "passed" | "failed" | "skipped" | "not_evaluated" | "errored";
```

- `skipped` — the test is disabled. Kept, listed, never silently dropped.
- `errored` — the scope could not be resolved, or covers no scenes. A test that
  could not run is not a test that passed.

A failure says everything needed to act on it:

```ts
interface TestFailure {
  sceneId: string;
  chapterId?: string;
  expected: string; // "CHAR_0002 does not know FACT_0001 after SCENE_0001"
  actual: string; // "CHAR_0002 known FACT_0001"
  evidence: string; // "Acquired in SCENE_0001 (dialogue by CHAR_0001)."
  entities: string[];
}
```

Expected state, actual state, the story point, the evidence, and the entities
to click through to. A failure a writer cannot evaluate is a failure they learn
to ignore.

## The test builder

**Nobody has to write code to say _Elias must not know the killer's identity
before chapter 37_.** The Tests panel is a structured form:

```
EXPECT   Character: Elias
         does not know
         Fact:      Killer Identity
         before
         Chapter 37
```

The pickers are driven by the assertion kind, so the form can only produce
assertions the engine can actually decide, and the entity lists come from the
project rather than from typing. The kind selector separates **Deterministic**
from **Semantic — recorded, not yet evaluated**, so the distinction is visible
at the moment of authoring rather than explained afterwards.

Under the form, the test is read back as a sentence before it is saved:

> EXPECT **Elias does not know Killer Identity, before The Revelation**

A textual power-user syntax
(`EXPECT knows(CHAR_ELIAS, FACT_0001) == false UNTIL CHAPTER_0037`) is a later
layer over the same structures, not a replacement for the form.

## Validation

A test about a character the project does not have asserts nothing, and would
fail forever for the wrong reason. So the repository refuses to record one:
every entity an assertion names, and every scope anchor, must exist.

Deletion runs the same rule backwards. An entity a test asserts about — or a
chapter a test's scope is anchored to, because the range is part of the claim —
cannot be deleted while the test stands. Unlinking deletes the tests with it.

## Tests are canon

A story test is the writer's stated intention for their own book, as authored as
a character or a world rule. It lives in `.writer/tests/story_tests.json` and
goes through the **journaled** store, so adding, disabling and deleting one are
change sets: as revertible as prose. Deleting a test a year of revision was
built around should be something you can undo ([VERSIONING.md](VERSIONING.md)).

This is the opposite of a build, which is derived analysis and is written
straight to the store ([STORY_COMPILER.md](STORY_COMPILER.md)).

## Running

```ts
repo.runStoryTests(); // just the suite — for the builder
repo.buildStory(); // the build runs them too, and reports them separately
```

Tests run during every Story Build and are displayed **separately** from the
rules, because they are a different kind of claim — the writer's assertions
rather than the system's checks:

```
DETERMINISTIC STORY TESTS                        21 / 22 passed

FAILED  Elias must not know the killer's identity
        Elias does not know Killer Identity, before The Revelation
        Elias known FACT_0001 after SCENE_0001

3 semantic test(s) recorded, not evaluated.
```

A failing deterministic test also becomes a build diagnostic under the
`story_tests` rule, carrying **the test's own severity** — a writer who marked
an intention as a warning gets a warning, and the build's status follows. An
errored test becomes a warning saying the test could not run. A semantic test
never becomes a diagnostic at all.

## Agent tools

```
list_story_tests       — the writer's assertions, as stated
run_story_tests        — run them; every result, with totals
get_failed_story_tests — only the failures, with where, expected and actual
```

All three are `read_canon`: running tests changes nothing. They are a better
source than the agent's own reading of the prose, because they are what the
writer _said_ their story must be.

**There is no tool that writes a test, and none that repairs a failing one.** An
assertion about what a story must be belongs to the person who made it
([AGENT_TOOLS.md](AGENT_TOOLS.md)).

## Invariants

- Deterministic and semantic assertions are separate types and never mix.
- A semantic test is reported as `not_evaluated`, never as `passed`.
- A disabled test is `skipped`, and a skipped test is not a passed one.
- A test that could not resolve its scope is `errored`, not passed.
- Every failure carries expected state, actual state, a story point and evidence.
- Every entity and anchor a test names must exist before the test is recorded.
- Tests are canon: journaled, revertible, and never deleted silently.
- Running tests changes nothing about the story.
- Agents may read and run tests; only a human writes one.

## Relationship to other subsystems

- [STORY_STATE.md](STORY_STATE.md) — where every deterministic answer comes from.
- [STORY_COMPILER.md](STORY_COMPILER.md) — the build that runs the suite.
- [STORY_REPOSITORY.md](STORY_REPOSITORY.md) — persistence, validation, journaling.
- [SIMULATIONS.md](SIMULATIONS.md) — what will eventually answer semantic tests.
- [AGENT_TOOLS.md](AGENT_TOOLS.md) — the three read-and-run tools.
