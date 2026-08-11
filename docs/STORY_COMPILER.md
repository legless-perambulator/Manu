# STORY_COMPILER

The fiction equivalent of compiling and testing software. The writer runs `/build` (or presses **Build Story**) and the compiler runs deterministic and semantic checks over the project.

- **Package:** `@jellytind/story-compiler`
- **Depends on:** `@jellytind/domain`, `@jellytind/shared`
- **Status:** The check-aggregation core (`runChecks`) and the `Severity` / `Finding` / `StoryCheck` / `BuildReport` types are **implemented and tested**. Concrete checks (timeline, knowledge, continuity, …) are **PLANNED** (V2).

## Implemented: the build core

`runChecks(checks, context)` is the deterministic orchestration core: individual
checks are pluggable, but running them (concurrently), tallying severities, and
deciding pass/fail (`ok = no error-severity findings`) is plain software. A check
that throws is captured as an `error` finding instead of aborting the build.
Every `Finding` carries a `source: "deterministic" | "semantic"` so the UI can
label model judgement honestly and never present it as fact.

Deterministic checks come first; semantic checks layer on afterwards.

## Example build output

```
STORY BUILD 284
✓ Timeline valid
✓ Character locations valid
✓ World rules valid
✓ Character knowledge valid
✓ POV rules valid

⚠ Mara knows about the Black Vault in Chapter 16 but does not learn this until Chapter 18.
⚠ Revolver used in Chapter 22 was left in Elias's flat in Chapter 19.
⚠ Plot thread "missing photograph" introduced Ch4, last referenced Ch9, unresolved for 63,291 words.
⚠ Elias dialogue similarity to Marcus: 81% — character voices may be converging.
⚠ Chapter 27 contains four consecutive low-conflict scenes.
⚠ Phrase "his jaw tightened" occurs 17 times.
✓ All registered foreshadowing has valid future targets

BUILD COMPLETED WITH 6 WARNINGS
```

## Check catalogue (initial)

- impossible character locations
- timeline contradictions
- dead characters appearing alive
- character knowledge violations (knowing something before they could)
- object/inventory continuity (unexplained transfers)
- conflicting world rules
- POV violations
- duplicate aliases/entities
- unresolved plot threads / abandoned foreshadowing
- repeated phrases
- inconsistent physical descriptions
- chronology issues
- scene dependency problems

## Deterministic vs semantic

The compiler must **never pretend subjective literary judgement is deterministic fact.** Every result is classified:

| Severity       | Meaning                                                                                               |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| **Error**      | A hard, deterministic violation (e.g. a dead character speaks; an object teleports with no transfer). |
| **Warning**    | A likely problem, deterministic or semantic (e.g. long-dormant thread; possible voice convergence).   |
| **Suggestion** | A subjective, model-informed recommendation.                                                          |

Deterministic checks run over structured domain state and are reproducible. Semantic checks use model judgement and are always presented as such — with evidence, never as objective fact. See the semantic-analysis principles below.

## Semantic analysis principles

Always distinguish `FACT` / `DETERMINISTIC RESULT` / `MODEL JUDGEMENT` / `INFERENCE` / `SUGGESTION`.

Never present _"This scene is boring."_ as objective. Prefer:

> "Three reader simulations reported reduced engagement here, and the scene contains lower conflict than the preceding five scenes."

Always explain the evidence.

## Story Tests

Writers (and agents) can define explicit story assertions:

```
EXPECT reader_suspects(CHAR_MARA) < 0.5 UNTIL CHAPTER_0022
EXPECT knows(CHAR_ELIAS, FACT_KILLER_IDENTITY) == false UNTIL CHAPTER_0037
EXPECT location(OBJECT_GUN) == LOC_EVIDENCE_ROOM FROM CHAPTER_0012 TO CHAPTER_0029
EXPECT relationship(ELIAS, MARA).progression == "slow_burn"
EXPECT FACT_VILLAIN_IDENTITY not_exposed BEFORE CHAPTER_0038
```

Some tests are deterministic; others require semantic judgement. The UI must distinguish them:

```
DETERMINISTIC TESTS  21 / 21 passed
SEMANTIC TESTS       18 / 21 passed   3 warnings
```

Users create their own tests; agents may recommend tests based on the story's stated intentions.

## Project rules

The compiler and agents respect user-defined hard/soft/style/character rules, e.g. `Only Elias POV until Chapter 20`, `Never use semicolons in dialogue`, `Magic cannot resurrect the dead`. See [DOMAIN_MODEL.md](DOMAIN_MODEL.md) (WorldRule) and project rules in `MASTER_BUILD.md` §52.

## Invariants

- Errors are deterministic; subjective judgements are never labelled Error.
- Every semantic finding carries its evidence.
- Builds are per-branch (see [VERSIONING.md](VERSIONING.md)) and reproducible for the deterministic subset.
