import type { Universe } from "./store";
import type { BookDigest, CanonEntity, UniverseBoundary } from "./types";

/**
 * Prior-book state, behind the spoiler boundary (§9, §11, §17).
 *
 * There is deliberately no "give me everything" call. Every question is asked
 * *as of a book*, and the answer is assembled only from the digests of books
 * that come earlier in reading order — a Book 1 operation cannot receive
 * Book 2 information because the code path to it does not exist. What crosses
 * the boundary is the structured memory layer (§10): facts, statuses,
 * relationship history, event summaries — never whole novels.
 */

export interface PriorState {
  /** Which books contributed, in reading order. */
  readonly fromBooks: readonly string[];
  /** Latest-wins knowledge per (character, fact) as of the boundary. */
  readonly knowledge: ReadonlyArray<{
    readonly canonCharacterId: string;
    readonly canonFactId: string;
    readonly state: string;
  }>;
  readonly relationships: ReadonlyArray<{
    readonly canonAId: string;
    readonly canonBId: string;
    readonly type: string;
    readonly status: string;
    readonly asOfBookId: string;
  }>;
  readonly characterStatus: ReadonlyArray<{
    readonly canonCharacterId: string;
    readonly status: string;
    readonly asOfBookId: string;
  }>;
  readonly destroyedOrLost: ReadonlyArray<{
    readonly canonEntityId: string;
    readonly note: string;
  }>;
  readonly summaries: ReadonlyArray<{ readonly bookId: string; readonly summary: string }>;
}

export function boundaryForBook(universe: Universe, bookId: string): UniverseBoundary {
  const book = universe.book(bookId);
  if (book === null) throw new Error(`No book ${bookId} in this universe.`);
  return { upToReadingOrder: book.readingOrder };
}

/** The digests a boundary permits: strictly earlier reading order. */
export async function priorDigests(
  universe: Universe,
  boundary: UniverseBoundary,
): Promise<BookDigest[]> {
  const out: BookDigest[] = [];
  for (const book of universe.booksInReadingOrder()) {
    if (book.readingOrder >= boundary.upToReadingOrder) continue;
    const digest = await universe.getDigest(book.bookId);
    if (digest !== null) out.push(digest);
  }
  return out;
}

export async function priorState(
  universe: Universe,
  boundary: UniverseBoundary,
): Promise<PriorState> {
  const digests = await priorDigests(universe, boundary);
  const knowledge = new Map<
    string,
    { canonCharacterId: string; canonFactId: string; state: string }
  >();
  const relationships = new Map<
    string,
    { canonAId: string; canonBId: string; type: string; status: string; asOfBookId: string }
  >();
  const status = new Map<
    string,
    { canonCharacterId: string; status: string; asOfBookId: string }
  >();
  const destroyed: Array<{ canonEntityId: string; note: string }> = [];
  const summaries: Array<{ bookId: string; summary: string }> = [];

  for (const digest of digests) {
    for (const held of digest.knowledge) {
      knowledge.set(`${held.canonCharacterId}|${held.canonFactId}`, held);
    }
    for (const held of digest.relationships) {
      const key = [held.canonAId, held.canonBId].sort().join("|") + `|${held.type}`;
      relationships.set(key, { ...held, asOfBookId: digest.bookId });
    }
    for (const held of digest.characterStatus) {
      status.set(held.canonCharacterId, { ...held, asOfBookId: digest.bookId });
    }
    destroyed.push(...digest.destroyedOrLost);
    if (digest.summary !== undefined) {
      summaries.push({ bookId: digest.bookId, summary: digest.summary });
    }
  }

  return {
    fromBooks: digests.map((digest) => digest.bookId),
    knowledge: [...knowledge.values()],
    relationships: [...relationships.values()],
    characterStatus: [...status.values()],
    destroyedOrLost: destroyed,
    summaries,
  };
}

/**
 * What a character already knows entering this book (§9), translated into
 * the book's *local* fact IDs where bindings exist — exactly the shape the
 * book's own state layer speaks.
 */
export async function priorKnowledgeForBook(
  universe: Universe,
  bookId: string,
): Promise<
  ReadonlyArray<{
    readonly canonCharacterId: string;
    readonly localCharacterId: string | null;
    readonly canonFactId: string;
    readonly localFactId: string | null;
    readonly state: string;
  }>
> {
  const state = await priorState(universe, boundaryForBook(universe, bookId));
  const canon = await universe.listCanon();
  const localOf = (canonId: string): string | null => {
    const entity = canon.find((held) => held.id === canonId);
    return entity?.bindings.find((held) => held.bookId === bookId)?.localId ?? null;
  };
  return state.knowledge.map((held) => ({
    canonCharacterId: held.canonCharacterId,
    localCharacterId: localOf(held.canonCharacterId),
    canonFactId: held.canonFactId,
    localFactId: localOf(held.canonFactId),
    state: held.state,
  }));
}

/**
 * The prior-context block a drafting or agent operation includes (§17):
 * shared canon in scope, plus the boundary-safe prior state, rendered small.
 * Selection is by relevance to this book — bound entities and universe-scoped
 * rules — never by loading earlier books wholesale.
 */
export async function renderPriorContext(universe: Universe, bookId: string): Promise<string> {
  const boundary = boundaryForBook(universe, bookId);
  const state = await priorState(universe, boundary);
  const canon = await universe.listCanon();
  const name = (id: string) => canon.find((held) => held.id === id)?.name ?? id;
  const inScope = (entity: CanonEntity): boolean =>
    entity.scope.level === "universe" ||
    (entity.scope.level === "series" &&
      universe.book(bookId)?.seriesId === entity.scope.seriesId) ||
    (entity.scope.level === "book" && entity.scope.bookId === bookId);
  const relevant = canon.filter(
    (entity) =>
      inScope(entity) &&
      (entity.bindings.some((held) => held.bookId === bookId) ||
        entity.kind === "world_rule" ||
        entity.kind === "history" ||
        entity.kind === "magic_system"),
  );

  const lines: string[] = [`Universe: ${universe.name}`];
  const rules = relevant.filter((entity) =>
    ["world_rule", "history", "magic_system"].includes(entity.kind),
  );
  if (rules.length > 0) {
    lines.push("", "Shared canon:");
    for (const rule of rules.slice(0, 30)) {
      lines.push(`- ${rule.name}: ${rule.statement ?? rule.description}`.trim());
    }
  }
  if (state.summaries.length > 0) {
    lines.push("", "Previously:");
    for (const summary of state.summaries) {
      const title = universe.book(summary.bookId)?.title ?? summary.bookId;
      lines.push(`- ${title}: ${summary.summary}`);
    }
  }
  if (state.characterStatus.length > 0) {
    lines.push("", "Entering this book:");
    for (const held of state.characterStatus.slice(0, 40)) {
      lines.push(`- ${name(held.canonCharacterId)} is ${held.status}.`);
    }
  }
  if (state.knowledge.length > 0) {
    lines.push("", "Already known:");
    for (const held of state.knowledge.slice(0, 60)) {
      lines.push(
        `- ${name(held.canonCharacterId)} ${held.state === "believed" ? "believes" : "knows"}: ${name(
          held.canonFactId,
        )}`,
      );
    }
  }
  if (state.relationships.length > 0) {
    lines.push("", "Relationship history:");
    for (const held of state.relationships.slice(0, 40)) {
      lines.push(
        `- ${name(held.canonAId)} and ${name(held.canonBId)}: ${held.type}${
          held.status !== "" ? ` (${held.status})` : ""
        }`,
      );
    }
  }
  if (state.destroyedOrLost.length > 0) {
    lines.push("", "No longer available:");
    for (const held of state.destroyedOrLost) lines.push(`- ${held.note}`);
  }
  return lines.join("\n");
}
