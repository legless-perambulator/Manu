# AUTHOR_VOICE

A persistent, inspectable model of how a writer writes.

- **Packages:** `@jellytind/domain` (the model), `@jellytind/story-repository`
  (storage, retrieval, deterministic checking), `@jellytind/editing`
  (the model-driven readings), `@jellytind/context-compiler` (delivery)
- **Status (Phase 22):** **Implemented and tested.** Rules, samples with an
  explicit stance, inferred tendencies with review, retrieval by operation,
  deterministic rule checking, and a Voice Inspector.

## The thing this is not

**Author voice is not one enormous system prompt.** That is the obvious
implementation and it fails in three ways: it spends budget on preferences that
do not apply, it buries the rules that do, and it is a blob the writer cannot
inspect, correct or disagree with.

So the profile is **structured**. Every item is filed under a category and a
scope, and the Context Compiler retrieves the slice that bears on the operation
in hand. Rewriting a line of dialogue pulls dialogue, punctuation and
narrative-distance preferences. It does not pull the writer's feelings about
landscape description.

## What is in the profile

### Rules — what the writer said

```
Prefer physical observation before internal reflection.
Avoid explaining dialogue subtext.
Avoid semicolons in dialogue.
Avoid "couldn't help but".
```

Written by the writer, never inferred, never auto-edited. Manu follows them.

A rule may carry an optional **pattern** — a phrase or expression it can be
checked against mechanically. `Avoid "couldn't help but"` is checkable;
`Prefer physical observation before internal reflection` is not, and carries no
pattern. This distinction is load-bearing; see _Comparison_ below.

### Samples — prose, and what the writer thinks of it

| Stance               | Means                                        | Evidence of |
| -------------------- | -------------------------------------------- | ----------- |
| `representative`     | this is how I want to write                  | want        |
| `favourite`          | a passage of mine I am pleased with          | want        |
| `approved_ai`        | AI prose I accepted                          | want        |
| `correction`         | AI prose I fixed, with what it said before   | want        |
| `exercise`           | a dialogue exercise I wrote deliberately     | want        |
| `rejected_ai`        | AI prose I turned down                       | do not want |
| `not_representative` | my prose, but not the voice I am after       | do not want |
| `unassessed`         | it exists; nobody has said anything about it | **nothing** |

**Never assume imported prose represents desired style.** A manuscript is full
of first drafts, placeholder scenes and passages the writer already dislikes.
`unassessed` is the default, and it contributes nothing to any reading. Only a
stance the writer chose counts.

### Tendencies — what a model noticed

```
INFERRED

Dialogue tends to use contractions heavily.

Evidence:
27 selected representative passages.
```

Always labelled, always carrying the evidence it rests on, and always arriving
as **proposed**. The writer may **Confirm**, **Edit** — putting it in their own
words — or **Reject**.

**A proposed tendency reaches no operation.** Only the writer's rules and
tendencies they have confirmed are ever compiled into context. A reading nobody
has looked at is not a preference.

## Scope

```
global    → how I write, across everything
project   → how this book is written
pov       → how this narrator sees
character → how this character speaks
```

Narrower wins. A project may contradict a habit; a character's dialogue may
contradict the project. Items are ordered by scope when compiled, so the
narrowest reads as the final word.

> **Known gap.** All four scopes exist in the model and in retrieval, and
> `global` items behave correctly. They are stored **in the project**, because
> Manu has no application-level store yet — only the OS keychain, which is for
> secrets. A global profile genuinely shared between projects needs that store;
> until it exists, `global` means "applies to all my work in this project".
> Recorded rather than papered over.

## Retrieval: the whole point of the categories

```ts
CATEGORIES_FOR_OPERATION = {
  dialogue: [dialogue, punctuation, narrative_distance, humour, prose],
  description: [description, figurative_language, sentence_structure, prose],
  interiority: [interiority, narrative_distance, prose, sentence_structure],
  rewrite_scene: [prose, pacing, sentence_structure, narrative_distance, dialogue],
  rewrite_selection: [prose, sentence_structure, punctuation],
};
```

Voice arrives in the compiled package's `styleRules` section as two separate
items — **your rules** and **confirmed tendencies** — so the model can tell an
instruction from an observation, and so can the writer reading the Context tab.
The writer's rules outrank generic style documents in priority: a rule someone
stated beats a document they once wrote about style.

With no operation named — the writer is inspecting — everything is returned.

## Comparison: what can be checked, and what cannot

`checkVoiceRules(text, rules)` returns three things: the rules it **checked**,
the rules it **could not check**, and the **hits**, each with the places in the
passage it matched.

A rule with no pattern appears under `notChecked`. It is never silently passed —
the same discipline the Story Compiler applies to everything it did not inspect
([STORY_COMPILER.md](STORY_COMPILER.md)). A pattern the writer typed that will
not compile is also reported as unchecked, not as clean.

An `avoid` rule is violated by presence; a `prefer` rule with a pattern is
violated by absence.

Semantic comparison — does this passage sound like the writer — is a **reading**
and is delivered as one, by `VoiceAnalyst`, labelled and evidenced. It is never
presented as a measurement.

## Rejection learning

When a writer rejects AI prose, there may be something to learn. There usually
is not.

```
You rejected three passages containing explicit emotional explanation.

Possible preference:
Avoid explaining emotional subtext after dialogue.

[Add to Voice Profile]  [Ignore]
```

**Not from every rejection.** A writer says no for a hundred reasons — it was
wrong about the plot, it was fine but not now, they changed their mind.
Inferring a style rule from a single "no" would fill the profile with noise the
writer then has to clean out.

So a trait must recur across at least `REJECTION_PATTERN_THRESHOLD` (3)
rejections before it is raised, the analyst is told to return an empty list when
there is no pattern — the expected answer most of the time — and the result is
checked against that threshold on the way back rather than taken on trust. Even
then it arrives as a question, not a rule.

## Privacy

The profile lives in the project, in plain JSON under `.writer/voice/`, readable
without Manu. How someone writes is theirs. Nothing is transmitted except as
part of an operation they asked for, and then only the slice that operation
needs ([SECURITY_PRIVACY.md](SECURITY_PRIVACY.md)).

## Layering

The deterministic half — storage, retrieval by operation, rule checking — is in
`story-repository` and **runs with no model configured at all**. The
model-driven half is in `editing`, above the repository, and returns drafts: it
never writes to the profile. Same split as the Story Debugger and Story Refactor
([ARCHITECTURE.md](ARCHITECTURE.md)).

## Invariants

- Voice is never one prompt blob; it is retrieved by category and scope.
- Unassessed prose is not evidence of desired style.
- A model's reading is labelled inferred, carries its evidence, and is proposed.
- A proposed tendency never reaches an operation; only confirmed ones do.
- The writer's own rules are never edited or inferred by anything else.
- Rejected readings stay rejected.
- A rule that cannot be checked mechanically is reported as unchecked, never as
  passed.
- No preference is inferred from a single rejection.
- The profile is local, plain-text and inspectable in full.
