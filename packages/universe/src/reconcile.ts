import type { Universe } from "./store";
import type { CanonEntity, CanonKind } from "./types";

/**
 * Reconciling a newly attached (often imported) book with existing canon
 * (§20): "this book's Mara Ellison looks like CHAR_MARA from Book 1."
 *
 * Matching is by exact name or alias, case- and punctuation-insensitively.
 * One match proposes; several matches — or a bare given name two canon
 * characters could own — demand review. Nothing merges automatically when
 * uncertain, and applying a match creates a *binding*, never a copy.
 */

export interface ReconcileCandidate {
  readonly localId: string;
  readonly localName: string;
  readonly kind: CanonKind;
}

export type ReconcileProposal =
  | {
      readonly kind: "match";
      readonly localId: string;
      readonly localName: string;
      readonly canonId: string;
      readonly canonName: string;
      readonly confidence: "high" | "medium";
    }
  | {
      readonly kind: "ambiguous";
      readonly localId: string;
      readonly localName: string;
      readonly candidates: ReadonlyArray<{ canonId: string; canonName: string }>;
    }
  | {
      readonly kind: "new";
      readonly localId: string;
      readonly localName: string;
      readonly entityKind: CanonKind;
    };

function fold(name: string): string {
  return name
    .toLowerCase()
    .replace(/[_\-.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function namesOf(entity: CanonEntity): string[] {
  return [entity.name, ...entity.aliases].map(fold);
}

export async function reconcileEntities(
  universe: Universe,
  bookId: string,
  candidates: readonly ReconcileCandidate[],
): Promise<ReconcileProposal[]> {
  const canon = await universe.listCanon();
  const alreadyBound = await universe.bindingsForBook(bookId);
  const proposals: ReconcileProposal[] = [];

  for (const candidate of candidates) {
    if (alreadyBound.has(candidate.localId)) continue;
    const needle = fold(candidate.localName);
    const pool = canon.filter((entity) => entity.kind === candidate.kind);

    const exact = pool.filter((entity) => namesOf(entity).includes(needle));
    if (exact.length === 1) {
      proposals.push({
        kind: "match",
        localId: candidate.localId,
        localName: candidate.localName,
        canonId: (exact[0] as CanonEntity).id,
        canonName: (exact[0] as CanonEntity).name,
        confidence: "high",
      });
      continue;
    }
    if (exact.length > 1) {
      proposals.push({
        kind: "ambiguous",
        localId: candidate.localId,
        localName: candidate.localName,
        candidates: exact.map((entity) => ({ canonId: entity.id, canonName: entity.name })),
      });
      continue;
    }

    // A shorter form of exactly one canon name ("Mara" ⊂ "Mara Ellison").
    const partial = pool.filter((entity) =>
      namesOf(entity).some((name) => {
        const words = new Set(name.split(" "));
        return needle.split(" ").every((word) => words.has(word)) && needle !== name;
      }),
    );
    if (partial.length === 1) {
      proposals.push({
        kind: "match",
        localId: candidate.localId,
        localName: candidate.localName,
        canonId: (partial[0] as CanonEntity).id,
        canonName: (partial[0] as CanonEntity).name,
        confidence: "medium",
      });
      continue;
    }
    if (partial.length > 1) {
      proposals.push({
        kind: "ambiguous",
        localId: candidate.localId,
        localName: candidate.localName,
        candidates: partial.map((entity) => ({ canonId: entity.id, canonName: entity.name })),
      });
      continue;
    }

    proposals.push({
      kind: "new",
      localId: candidate.localId,
      localName: candidate.localName,
      entityKind: candidate.kind,
    });
  }
  return proposals;
}

/** Apply an accepted match: one binding, aliases learned, nothing copied. */
export async function applyMatch(
  universe: Universe,
  bookId: string,
  proposal: { localId: string; localName: string; canonId: string },
): Promise<CanonEntity> {
  const entity = await universe.getCanon(proposal.canonId);
  if (entity === null) throw new Error(`No canon entity ${proposal.canonId}.`);
  const bound = await universe.bindCanon(proposal.canonId, {
    bookId,
    localId: proposal.localId,
  });
  const known = new Set([entity.name, ...entity.aliases].map(fold));
  if (!known.has(fold(proposal.localName))) {
    return universe.updateCanon(proposal.canonId, {
      aliases: [...entity.aliases, proposal.localName],
    });
  }
  return bound;
}

/** Promote a book-local entity into shared canon, bound to its origin book. */
export async function promoteToCanon(
  universe: Universe,
  bookId: string,
  input: {
    localId: string;
    name: string;
    kind: CanonKind;
    description?: string;
    statement?: string;
  },
): Promise<CanonEntity> {
  const entity = await universe.addCanon({
    kind: input.kind,
    name: input.name,
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.statement !== undefined ? { statement: input.statement } : {}),
  });
  return universe.bindCanon(entity.id, { bookId, localId: input.localId });
}
