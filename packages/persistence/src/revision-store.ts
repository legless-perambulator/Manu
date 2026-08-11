import type { AnyId } from "@jellytind/domain";

/**
 * Append-only revision history. Every meaningful AI mutation is attributable,
 * inspectable and reversible (AGENTS.md — "AI Mutation Rules";
 * docs/VERSIONING.md). This interface is the storage contract for that history.
 *
 * Planned: the concrete store, diff computation, checkpoints and branch heads
 * are implemented in V1 (docs/ROADMAP.md). Types here are intentionally minimal
 * and will grow with the versioning slice.
 */
export interface RevisionEntry {
  readonly id: string;
  readonly createdAt: string; // ISO-8601
  readonly author: RevisionAuthor;
  readonly summary: string;
  readonly affectedEntities: readonly AnyId[];
  /** Optional structured payload (diff handle, checkpoint id, etc.). */
  readonly details?: Readonly<Record<string, unknown>>;
}

export type RevisionAuthor =
  | { readonly kind: "human" }
  | { readonly kind: "agent"; readonly agent: string; readonly model?: string };

export interface RevisionStore {
  append(entry: RevisionEntry): Promise<void>;
  get(id: string): Promise<RevisionEntry | null>;
  /** List entries, newest first, optionally filtered by affected entity. */
  list(options?: { entity?: AnyId; limit?: number }): Promise<RevisionEntry[]>;
}
