# UNIVERSE

Series and universe projects: many books, one persistent fictional world —
with book-specific chronology, state and spoiler boundaries intact.

- **Packages:** `@jellytind/universe`, surfaced by the Universe panel and the
  start screen's Open a universe…
- **Status (Phase 41):** implemented and tested. Universe and series domain,
  shared canon with scopes and per-book bindings, book digests as the
  cross-book memory layer, boundary-guarded prior state, cross-book timeline,
  deterministic cross-book checks, canon conflicts with four resolutions,
  universe story tests, reconciliation for attached and imported books.

## The premise

A trilogy should not duplicate its world three times — and it must not smear
its books together either. The layer keeps four things separate on purpose:
**universe canon** ("dragons exist"), **series canon**, **book canon**, and
**book state** ("Mara is injured after Scene 12"), which stays exactly where
it always lived: in the book's own Story Repository, time-anchored (§5). The
universe stores identity and residue, never a second copy of a book.

## Shared canon, bound not copied

A `CanonEntity` is a universe-stable identity — character, location, faction,
species, world rule, history, object, fact, language, culture, magic system or
event (§3) — with a scope (universe / series / book, §4) and **bindings**: one
per book, naming the book-local record that manifests it. `CHAR_MARA` the
canon identity binds to Book 1's `CHAR_0007` and Book 2's `CHAR_0002` (§7);
each book's record keeps its own age, appearance and status at that story
point, and Book 3's description never overwrites Book 1's (§21). Nothing is
required to be shared — a book-local character simply has no canon entry.
Derived age exists only where birth year and story year are both stated (§8).

## The shared world repository

A universe is a folder: `.universe/` (manifest, canon, series threads and
arcs, cross-book timeline events, memory digests, conflicts, tests) with the
books as ordinary, fully portable Manu projects beside it (§14). A book
carries one small link file naming its universe; without it — or without the
universe folder — the book is a complete standalone project. Opening a book
stays lightweight; opening a universe lists its books and opens one (§15).

## Digests: the cross-book memory layer

What Book 2 inherits from Book 1 is Book 1's **digest** (§9–§10): end-of-book
knowledge, relationship state and character status translated into canon
terms through the bindings, destroyed-or-lost entities, chapter-level event
skeleton, and a short summary. Never the novel. The Context Compiler-facing
`renderPriorContext` assembles shared rules in scope plus the boundary-safe
prior state into one small block (§17) — the scale test proves five books,
100+ characters and hundreds of facts are served from digest reads alone,
with no manuscript touched.

## Spoiler boundaries

There is deliberately no unbounded cross-book query (§11). Everything is
asked _as of a book_, and only digests of books strictly earlier in reading
order can answer — the code path from a Book 1 operation to Book 2 canon does
not exist. The acceptance test writes a death into Book 2's digest and shows
Book 1's context contains no trace of it.

## Cross-book intelligence

- **Checks** (§18), deterministic only: a character dead in an earlier book
  appearing alive later; a destroyed entity used unchanged; a character
  "learning" a fact an earlier book already gave them; a book's world rule
  drifting from universe canon.
- **Canon conflicts** (§22): a bound book fact disagreeing with the canonical
  statement is surfaced with exactly the four honest moves — correct the
  book, update canon, explain the exception, ignore — and the decision is
  recorded, never silent.
- **Universe story tests** (§19): "Mara remains alive through Book 2",
  "FACT_X is not known before Book 3", "the manor stands until Event Z" —
  pass / fail / inconclusive over the digests.
- **Series threads and arcs** (§12–§13): qualitative per-book phases
  (introduced, escalates, resolved; trust, betrayal, reconciliation) that sit
  above book-level threads and arcs without replacing them.

## Reconciliation

Attaching a book — imported via Phase 40 or written natively — proposes
matches against existing canon by name and alias (§20): one owner proposes a
binding, several demand a choice, no match offers promotion into canon.
Nothing merges automatically when uncertain, and an accepted match creates a
binding plus a learned alias — never a copy.

## Future series builds (§23)

`SeriesPlanSlot` reserves where a multi-book planning workflow would attach.
Autonomous trilogy generation is deliberately not implemented.

## Verification

`packages/universe/src/acceptance.test.ts` walks §25 with two real book
repositories in a real Blackthorn universe folder — shared Mara and Manor,
knowledge carried into Book 2 in Book 2's local IDs, no backwards leak,
relationship history forward, the interleaved timeline, the 1884/1891 canon
conflict flagged and resolved, imported-book reconciliation, and a full
reopen from disk — plus the §24 scale test and the §18 checks.

## Relationship to other subsystems

- [STORY_REPOSITORY.md](STORY_REPOSITORY.md) — books stay self-contained;
  the universe holds links, not copies.
- [STORY_STATE.md](STORY_STATE.md) — book state remains time-anchored in the
  book; digests carry only its end-of-book residue.
- [CONTEXT_COMPILER.md](CONTEXT_COMPILER.md) — prior-book context arrives as
  one compact rendered block, selected, never wholesale.
- [IMPORT_EXPORT.md](IMPORT_EXPORT.md) / [STORY_MAPPING.md](STORY_MAPPING.md)
  — an imported book attaches and reconciles like any other.
