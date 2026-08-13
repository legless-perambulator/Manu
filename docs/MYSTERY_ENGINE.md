# MYSTERY_ENGINE

The information architecture of a mystery, held as records rather than inferred
from prose — and the one question that architecture exists to answer: **can a
careful reader fairly reach the intended solution before the reveal?**

- **Packages:** `@jellytind/mystery` (the architecture loader, chain resolution,
  the fairness audit, solvability, obviousness, alibi checking),
  `@jellytind/domain` (the vocabulary), `@jellytind/story-repository`
  (`mysteries`), `@jellytind/skills` (`/fairness-audit`),
  `@jellytind/reader-sim` (the suspicion series the obviousness check consumes)
- **Status:** **Implemented and tested** (Phase 29). Clue, suspect and deduction
  records; the five evidence kinds kept apart; deduction chains with cycle
  detection; the fairness audit; earliest solvability against authorial intent;
  accidental obviousness against simulated readers; alibis against the Timeline
  Engine; red-herring resolution tracking. The desktop **Mystery** panel is the
  clue board.

## The claim

> Manu should be capable of reconstructing an entire mystery's information
> architecture independently from the prose alone once its clue system has been
> populated or confirmed.

That is the acceptance criterion, and it is a load-bearing constraint rather
than a slogan. The test for it builds a book with **no prose in it at all** —
every chapter file is front matter and a heading — populates clues, deductions
and suspects, and then asks the engine when the reader had what, which reasoning
rests on which clue, whether the ending is earned, and which alibis the timeline
contradicts. Every one of those questions is answered in full. If any of it
needed the manuscript, that test would fail.

The consequence is that the engine reads records and nothing else. There is no
step anywhere in this subsystem that asks a model what it thinks of your book.

## The records

### Clue

```
Clue {
  description · kind · source · visibility
  firstAppearance · readerExposure[] · characterDiscoveries[]
  trueMeaning? · apparentMeaning?
  relatedFactIds[] · relatedSuspectIds[] · relatedObjectIds[]
  payoffSceneId? · status · resolution? · resolvedSceneId?
}
```

Two fields carry most of the weight.

**`readerExposure`** is the list of scenes where the reader is _shown_ it,
separate from `characterDiscoveries` — where the characters find it. Those come
apart constantly: the reader sees the damp coat in chapter two and the
investigator notices it in chapter nine, and a mystery that confuses the two is
a mystery whose author has lost track of who knows what. The store keeps them
honest by folding `firstAppearance` into `readerExposure` automatically — a clue
the reader meets in a scene _has been exposed there_, whether or not the author
listed it twice.

**`trueMeaning`** is author-only. It is the single field in the project that
must never reach a reader-facing context, and it is the reason the Reader
Simulator's recipe carries no entity records at all (`docs/SIMULATIONS.md`). In
the desktop panel it sits behind a toggle.

`visibility` — `stated`, `shown`, `buried` — is the author's intent, not a
measurement. It exists because fairness turns on it: a solution resting entirely
on buried clues is technically fair and practically not, and that distinction is
worth a verdict of its own.

### The five kinds, kept apart

`clue` · `evidence` · `red_herring` · `deduction` · `reveal`

They behave differently and are stored as different things. A clue is
_available_; evidence _establishes_; a red herring is available and meant to
mislead; a deduction is what the reader must _do_ with them; a reveal is where
the story stops asking. Collapsing them into one "clue" list is what makes a
mystery board decorative — the audit needs to know that the ledger entry is
meant to point the wrong way before it can tell you the story never explains it.

### Suspect

```
Suspect {
  mysteryId + characterId
  motive? · means? · opportunity?
  alibi? { claim · locationId? · coversSceneId? · corroboratedBy? }
  evidenceFor[] · evidenceAgainst[]
  intendedReaderSuspicion? · investigatorSuspicion?
}
```

**Nothing decides guilt from these values.** Motive, means and opportunity are
recorded because they are what a _reader_ weighs, not so a program can add them
up — and a suspect with all three who did not do it is the most useful object in
a mystery. The author says who did it, in `Mystery.culpritIds`, and that is the
only statement of guilt anywhere in the system. A test asserts it: the fixture's
most suspicious character has motive, means and opportunity, is not the culprit,
and appears nowhere in the audit's output.

A suspect is not an entity. It is a **role a character plays inside one
mystery** — the same person may be a suspect in one and a witness in another —
so the record is keyed by the pair. Deleting a mystery takes its suspects with
it and leaves the character untouched.

### Deduction

```
Deduction {
  statement · premises[] · difficulty · yieldsFactId? · isSolution?
}
```

Premises are clue IDs, fact IDs or other deduction IDs, which makes the whole
thing a graph — and makes "is this solvable by chapter twelve?" a question about
when every premise became available rather than a matter of taste.

## The chain

```
CLUE_0001 A key missing from the board  [scene 1]
+
CLUE_0002 Elias's coat is damp to the elbow  [scene 3]
↓
DEDUCTION_0001 Whoever sealed it went down before it was sealed
(reachable from scene 3)
```

`resolveChain` walks it depth-first with a visiting set, exactly like the
causality graph: a mystery whose deductions reference each other in a circle is
an authoring mistake, and it must be **reported** rather than hanging the audit
(`docs/CAUSALITY.md`). Steps come back in the order the reader must make them.

A step is reachable at the position of its **latest** premise. The reader cannot
make the deduction until they have all of it, so the last thing to arrive is the
thing that governs.

One resolution rule matters more than the rest: **a fact is available only when
a clue exposes it**. A proposition the story has established is not a
proposition the reader has been handed, and treating it as one would quietly
paper over the exact failure this engine exists to find. A fact premise with no
clue pointing at it resolves to `availableAt: null` — which is how _hidden
essential information_ is detected rather than assumed away.

## The fairness audit

Run as a Writing Skill — `/fairness-audit` — composed from six registered
operations plus the report step (`docs/WRITING_SKILLS.md`):

```
load_mystery → resolve_deduction_chain → audit_fairness
  → estimate_solvability → check_alibis → detect_obviousness → compile_report
```

Every step is deterministic. The whole workflow runs with no model configured,
and a test asserts that too.

| Problem              | What it means                                                    |
| -------------------- | ---------------------------------------------------------------- |
| `hidden_essential`   | The solution rests on something the reader is never shown        |
| `late_premise`       | A premise arrives at or after the reveal                         |
| `missing_premise`    | A deduction rests on something not in the project — or on itself |
| `unresolved_herring` | A red herring the story never explains away                      |
| `technically_fair`   | Every clue the solution needs is present, and all of them buried |
| `unpaid_clue`        | A clue planted with no payoff scene and no deduction using it    |

The verdict is deliberately **not a score**:

- **fair** — every premise reached the reader before the reveal
- **strained** — they all did, but only just, or only in buried form
- **unfair** — one did not
- **insufficient_data** — nothing is recorded to check

`strained` is the interesting case and the one a percentage would hide. The
report also carries `readerHasByReveal` — everything the reader holds by the
reveal, in scene order — and `notChecked`, because a mystery with no recorded
reveal scene has not passed the reveal check, it has skipped it.

## Earliest solvability

The scene by which every premise of the solution has reached the reader, with
the **gating premise** named: the one thing that arrives last and holds
solvability back. Compared against `Mystery.intendedSolvableFromSceneId` as
`scenesFromIntended` — negative when the book gives it away early, positive when
the reader is kept waiting past the point the author meant.

The arithmetic is exact and the conclusion is **labelled model analysis**
regardless, because a premise that technically arrives in scene nine may not be
one a reader can use until they have a reason to look at it. Every result
carries `MYSTERY_CAVEAT`:

> Model analysis over the clue system the author recorded — not a measurement of
> whether real readers solve it.

## Accidental obviousness

The Reader Simulator already answers _when did this reader start suspecting X?_
The Mystery Engine knows who X is and when the author meant them to be
suspected. Put together, that is accidental obviousness — and neither half would
be worth building alone.

`detectObviousness` reads `firstSuspected` from each completed simulation
(`docs/SIMULATIONS.md`) and reports only readers who arrive **earlier** than
intended; a reader who gets there on time is not a finding. Comparison is in
chapters, which is the coarser and therefore the honest unit, since readings are
per chapter and the chain is per scene. Findings are sourced as `model`, however
arithmetic the comparison looks: anything built on a simulated reader is a
model's reading.

With no completed simulations stored, the step is **skipped with its reason
stated** — never reported clean.

## Alibis against the timeline

A registered contradiction, not a deduction: the suspect says they were at the
mill, and the project records them at the manor in the scene the alibi covers.
State is read at `{ sceneId, position: "after" }` — an alibi is a claim about
the whole scene, not about walking into it (`docs/TIMELINE.md`).

Three outcomes, and the third is the point:

- `contradicted` — the timeline puts them somewhere else
- `uncorroborated` — nothing supports the claim
- `unchecked` — no alibi recorded, or one naming no scene to check it against

An alibi nothing could check is reported as unmeasured rather than as clean.

## Storage

`mystery/{mysteries,clues,deductions,suspects}.json`, in the project proper
rather than under `.writer/` — because this is **canon**. Who did it, what each
clue really means and which reasoning the reader is expected to do are as
authored as any character record. They travel with the book, they belong in the
writer's revision history, and they are the thing that makes the architecture
reconstructible without the prose.

## Invariants

- The architecture is answerable with an empty manuscript. Nothing in this
  subsystem reads prose.
- `trueMeaning` and `Mystery.solution` are author-only and never enter a
  reader-facing context.
- Guilt is never derived. `culpritIds` is authored; motive, means and
  opportunity are recorded and never summed.
- A fact is available to the reader only through a clue that exposes it.
- Cycles in the deduction graph are reported, never traversed.
- Verdicts are bands with stated reasons. No score, no percentage, no
  probability — asserted by test.
- A step that could not run says why. Skipped is never `ok`.
