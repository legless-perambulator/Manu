import { formatEntityId, parseId, type IdFor } from "./ids";
import { ENTITY_KINDS, isEntityKind, isSequenceKind, type SequenceKind } from "./entity-kind";

/** A per-kind snapshot of the last-used sequence numbers. */
export type SequenceSnapshot = Partial<Record<SequenceKind, number>>;

/**
 * Coerce untrusted JSON (e.g. a persisted id-sequence file) into a valid
 * {@link SequenceSnapshot}, dropping unknown keys and non-integer/negative
 * values. Never throws; unrecognised input yields an empty snapshot.
 */
export function normalizeSequenceSnapshot(raw: unknown): SequenceSnapshot {
  const out: SequenceSnapshot = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isEntityKind(key) || !isSequenceKind(key)) continue;
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Allocates stable, monotonic entity IDs. Allocation depends only on entity
 * kind and a per-kind counter — never on entity names — so IDs remain stable
 * across renames (AGENTS.md — "Stable Entity IDs").
 */
export interface IdGenerator {
  /** Allocate the next ID for a sequence-based kind. */
  next<K extends SequenceKind>(kind: K): IdFor<K>;
  /** The sequence number the next `next(kind)` call would produce. */
  peek(kind: SequenceKind): number;
  /** Export current counters so allocation can resume after reload. */
  snapshot(): SequenceSnapshot;
}

/**
 * In-memory sequential ID generator.
 *
 * Counters can be seeded from a prior {@link SequenceSnapshot} or reconstructed
 * from a repository's existing IDs via {@link SequentialIdGenerator.fromExistingIds},
 * guaranteeing new IDs never collide with allocated ones even across sessions
 * and branches. Persistence of the snapshot is the caller's responsibility (see
 * the persistence layer).
 */
export class SequentialIdGenerator implements IdGenerator {
  private readonly counters = new Map<SequenceKind, number>();

  constructor(seed: SequenceSnapshot = {}) {
    for (const kind of ENTITY_KINDS) {
      if (!isSequenceKind(kind)) continue;
      const last = seed[kind];
      if (last !== undefined) {
        if (!Number.isInteger(last) || last < 0) {
          throw new RangeError(`Seed for ${kind} must be a non-negative integer.`);
        }
        this.counters.set(kind, last);
      }
    }
  }

  next<K extends SequenceKind>(kind: K): IdFor<K> {
    const nextSeq = (this.counters.get(kind) ?? 0) + 1;
    this.counters.set(kind, nextSeq);
    return formatEntityId(kind, nextSeq);
  }

  peek(kind: SequenceKind): number {
    return (this.counters.get(kind) ?? 0) + 1;
  }

  snapshot(): SequenceSnapshot {
    return Object.fromEntries(this.counters) as SequenceSnapshot;
  }

  /**
   * Build a generator whose counters are set to the maximum sequence seen for
   * each kind among the provided raw IDs. Unrecognised or non-sequence IDs are
   * ignored.
   */
  static fromExistingIds(ids: Iterable<string>): SequentialIdGenerator {
    const seed: SequenceSnapshot = {};
    for (const raw of ids) {
      const parsed = parseId(raw);
      if (parsed === null || parsed.sequence === null) continue;
      const kind = parsed.kind;
      if (!isSequenceKind(kind)) continue;
      const current = seed[kind] ?? 0;
      if (parsed.sequence > current) seed[kind] = parsed.sequence;
    }
    return new SequentialIdGenerator(seed);
  }
}
