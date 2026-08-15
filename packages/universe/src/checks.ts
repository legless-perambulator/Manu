import type { StoryRepository } from "@jellytind/story-repository";
import type { Universe } from "./store";
import { priorState, boundaryForBook } from "./context";
import type { CanonConflict, UniverseDiagnostic, UniverseTest, UniverseTestResult } from "./types";

/**
 * Deterministic cross-book checks (§18) and canon conflict surfacing (§22).
 *
 * Everything here is computed from digests, bindings and canon records — no
 * model, no guessing, and no reading of other books' manuscripts. What cannot
 * be checked deterministically is not checked here.
 */

/** Check one book against everything before it. */
export async function universeChecks(
  universe: Universe,
  bookId: string,
  repo: StoryRepository,
): Promise<UniverseDiagnostic[]> {
  const diagnostics: UniverseDiagnostic[] = [];
  const prior = await priorState(universe, boundaryForBook(universe, bookId));
  const bindings = await universe.bindingsForBook(bookId);
  const canonByLocal = bindings;

  // Character died earlier but appears in this book (§18.1).
  const deceased = new Set(
    prior.characterStatus
      .filter((held) => held.status === "deceased")
      .map((held) => held.canonCharacterId),
  );
  for (const character of await repo.listCharacters()) {
    const canon = canonByLocal.get(character.id as string);
    if (canon === undefined) continue;
    if (deceased.has(canon.id) && character.status !== "deceased") {
      diagnostics.push({
        id: `dead-then-alive:${canon.id}:${bookId}`,
        severity: "error",
        message:
          `${canon.name} died in an earlier book but appears in this one as ` +
          `"${character.status}". Resurrections need to be written, not assumed.`,
        bookId,
        canonEntityId: canon.id,
      });
    }
  }

  // Entity destroyed or lost earlier but used unchanged here (§18.2).
  const destroyed = new Map(prior.destroyedOrLost.map((held) => [held.canonEntityId, held.note]));
  for (const object of await repo.listObjects()) {
    const canon = canonByLocal.get(object.id as string);
    if (canon === undefined) continue;
    const note = destroyed.get(canon.id);
    if (note !== undefined && object.status === "exists") {
      diagnostics.push({
        id: `destroyed-then-used:${canon.id}:${bookId}`,
        severity: "error",
        message: `${canon.name} is used unchanged in this book, but: ${note}`,
        bookId,
        canonEntityId: canon.id,
      });
    }
  }

  // Character "learns" a fact an earlier book already gave them (§18.3's
  // deterministic half: witnessing/learning can't be verified, re-learning can).
  const known = new Set(
    prior.knowledge
      .filter((held) => held.state === "known")
      .map((held) => `${held.canonCharacterId}|${held.canonFactId}`),
  );
  for (const transition of await repo.listStateTransitions()) {
    if (transition.kind !== "knowledge_changed") continue;
    const canonCharacter = canonByLocal.get(transition.subjectId);
    const canonFact = canonByLocal.get(transition.value);
    if (canonCharacter === undefined || canonFact === undefined) continue;
    if (known.has(`${canonCharacter.id}|${canonFact.id}`)) {
      diagnostics.push({
        id: `relearn:${canonCharacter.id}:${canonFact.id}:${transition.id as string}`,
        severity: "info",
        message:
          `${canonCharacter.name} learns "${canonFact.name}" in this book, ` +
          `but already knew it entering it. Intentional reminder scenes are fine; ` +
          `discovery scenes are not.`,
        bookId,
        canonEntityId: canonCharacter.id,
      });
    }
  }

  // Book world rule contradicting universe canon by name (§18.4): the same
  // named rule with materially different text is a contradiction to look at.
  const canonRules = (await universe.listCanon("world_rule")).filter(
    (entity) => entity.scope.level === "universe",
  );
  for (const rule of await repo.listWorldRules()) {
    const matching = canonRules.find(
      (canon) => canon.name.trim().toLowerCase() === rule.name.trim().toLowerCase(),
    );
    if (matching === undefined) continue;
    const canonText = (matching.statement ?? matching.description).trim();
    if (
      canonText !== "" &&
      rule.description.trim() !== "" &&
      canonText !== rule.description.trim()
    ) {
      diagnostics.push({
        id: `rule-drift:${matching.id}:${bookId}`,
        severity: "warning",
        message:
          `World rule "${rule.name}" differs from universe canon in this book. ` +
          `Canon: "${canonText}" — this book: "${rule.description.trim()}".`,
        bookId,
        canonEntityId: matching.id,
      });
    }
  }

  return diagnostics;
}

/**
 * Canon fact conflicts (§22): a bound book fact whose statement disagrees
 * with the canonical statement is surfaced with the four honest resolutions —
 * correct the book, update canon, record an in-world exception, or ignore.
 */
export async function detectCanonConflicts(
  universe: Universe,
  bookId: string,
  repo: StoryRepository,
): Promise<CanonConflict[]> {
  const conflicts: CanonConflict[] = [];
  const bindings = await universe.bindingsForBook(bookId);
  const facts = await repo.listFacts();
  for (const fact of facts) {
    const canon = bindings.get(fact.id as string);
    if (canon === undefined || canon.kind !== "fact") continue;
    const canonStatement = (canon.statement ?? canon.description).trim();
    const bookStatement = fact.statement.trim();
    if (canonStatement === "" || bookStatement === "") continue;
    if (canonStatement.toLowerCase() !== bookStatement.toLowerCase()) {
      conflicts.push({
        id: `conflict:${canon.id}:${bookId}`,
        canonEntityId: canon.id,
        bookId,
        summary: `${canon.name}: this book disagrees with universe canon.`,
        canonSays: canonStatement,
        bookSays: bookStatement,
      });
    }
  }
  return conflicts;
}

/** Record the writer's decision on a conflict. Never resolved silently. */
export async function resolveConflict(
  universe: Universe,
  conflict: CanonConflict,
  resolution: CanonConflict["resolution"],
  note?: string,
): Promise<void> {
  const existing = await universe.listConflicts();
  const next = [
    ...existing.filter((held) => held.id !== conflict.id),
    {
      ...conflict,
      ...(resolution !== undefined ? { resolution } : {}),
      ...(note !== undefined ? { note } : {}),
    },
  ];
  await universe.saveConflicts(next);
}

// ── Universe story tests (§19) ─────────────────────────────────────────────

export async function runUniverseTests(
  universe: Universe,
  tests: readonly UniverseTest[],
): Promise<UniverseTestResult[]> {
  const results: UniverseTestResult[] = [];
  for (const test of tests) {
    const assertion = test.assertion;
    if (assertion.kind === "character_alive_through") {
      const book = universe.book(assertion.throughBookId);
      if (book === null) {
        results.push({ testId: test.id, outcome: "inconclusive", detail: "Unknown book." });
        continue;
      }
      // Alive *through* the book: state as of the boundary after it.
      const state = await priorState(universe, {
        upToReadingOrder: book.readingOrder + 1,
      });
      const status = state.characterStatus.find(
        (held) => held.canonCharacterId === assertion.canonCharacterId,
      );
      if (status === undefined) {
        results.push({
          testId: test.id,
          outcome: "inconclusive",
          detail: "No digest records this character's status yet.",
        });
      } else if (status.status === "deceased") {
        results.push({
          testId: test.id,
          outcome: "fail",
          detail: `Deceased as of ${status.asOfBookId}.`,
        });
      } else {
        results.push({
          testId: test.id,
          outcome: "pass",
          detail: `Status "${status.status}" as of ${status.asOfBookId}.`,
        });
      }
    } else if (assertion.kind === "fact_not_known_before") {
      const book = universe.book(assertion.beforeBookId);
      if (book === null) {
        results.push({ testId: test.id, outcome: "inconclusive", detail: "Unknown book." });
        continue;
      }
      const state = await priorState(universe, { upToReadingOrder: book.readingOrder });
      const leaked = state.knowledge.filter((held) => held.canonFactId === assertion.canonFactId);
      results.push(
        leaked.length === 0
          ? {
              testId: test.id,
              outcome: "pass",
              detail: "Nobody holds this fact before that book.",
            }
          : {
              testId: test.id,
              outcome: "fail",
              detail: `${leaked.length} character(s) already hold it earlier.`,
            },
      );
    } else {
      // entity_survives_until: destroyed before its event = fail.
      const events = await universe.listEvents();
      const until = events.find((held) => held.id === assertion.untilEventId);
      if (until === undefined) {
        results.push({ testId: test.id, outcome: "inconclusive", detail: "Unknown event." });
        continue;
      }
      // Books at or before the event's position must not record it destroyed.
      const state = await priorState(universe, {
        upToReadingOrder: until.afterStoryOrder + 1,
      });
      const gone = state.destroyedOrLost.find(
        (held) => held.canonEntityId === assertion.canonEntityId,
      );
      results.push(
        gone === undefined
          ? { testId: test.id, outcome: "pass", detail: "Still standing at that point." }
          : { testId: test.id, outcome: "fail", detail: gone.note },
      );
    }
  }
  return results;
}
