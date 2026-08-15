/**
 * The universe domain (Phase 41): many books, one persistent fictional world.
 *
 * The separations this vocabulary exists to keep clean:
 *
 * - **Universe canon** — true across the whole world ("dragons exist").
 * - **Series canon** — true within one series of that universe.
 * - **Book canon & state** — a book's own facts, and its *time-specific*
 *   story state, which stays in the book's Story Repository. "Mara is
 *   injured" is never an eternal universe fact (§5).
 * - **Boundaries** — what a Book 1 operation may see never includes Book 2
 *   (§11). Everything cross-book takes an explicit boundary.
 */

export interface UniverseBook {
  /** Stable within the universe, e.g. "BOOK_0001". */
  readonly bookId: string;
  readonly title: string;
  /**
   * Where the book's Story Repository lives, relative to the universe root
   * when nested there (the portable arrangement), absolute otherwise.
   */
  readonly path: string;
  /** 1-based publication/reading order (§6). */
  readonly readingOrder: number;
  /**
   * 1-based position in story chronology, when it differs from reading
   * order (a prequel). Defaults to reading order.
   */
  readonly storyOrder?: number;
  readonly seriesId?: string;
  /** The matching project id inside the book folder, once known. */
  readonly projectId?: string;
}

export interface Series {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /** Order among the universe's series. */
  readonly order: number;
  readonly bookIds: readonly string[];
}

export interface UniverseManifest {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly books: readonly UniverseBook[];
  readonly series: readonly Series[];
}

// ── Shared canon ───────────────────────────────────────────────────────────

/** What a shared record may be (§3). Not every entity must be shared. */
export const CANON_KINDS = [
  "character",
  "location",
  "faction",
  "species",
  "world_rule",
  "history",
  "object",
  "fact",
  "language",
  "culture",
  "magic_system",
  "event",
] as const;
export type CanonKind = (typeof CANON_KINDS)[number];

/** Where a canon record holds true (§4). */
export type CanonScope =
  | { readonly level: "universe" }
  | { readonly level: "series"; readonly seriesId: string }
  | { readonly level: "book"; readonly bookId: string };

/**
 * One book's manifestation of a canon entity (§7, §21): the same universe
 * identity, bound to that book's local record — which carries the
 * book-specific age, appearance, relationships and status at that story
 * point. Bindings never overwrite each other; Book 1's description of Mara
 * survives Book 3's.
 */
export interface CanonBinding {
  readonly bookId: string;
  /** The book-local entity id, e.g. "CHAR_0007" inside that repository. */
  readonly localId: string;
  /** Book-specific presentation notes, kept per book (§21). */
  readonly presentation?: string;
}

export interface CanonEntity {
  /** Universe-stable, e.g. "CANON_0001". */
  readonly id: string;
  readonly kind: CanonKind;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly scope: CanonScope;
  /** For characters: the story-world birth year, when the writer knows it (§8). */
  readonly birthYear?: number;
  /** For facts: the canonical statement. */
  readonly statement?: string;
  readonly bindings: readonly CanonBinding[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ── Cross-book timeline (§6) ───────────────────────────────────────────────

/** An event that happens between, before or after books — never inside one. */
export interface UniverseEvent {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  /**
   * Position in story chronology relative to the books: an event with
   * `afterStoryOrder: 1` happened between the first and second books in
   * story order; `0` is before every book (history).
   */
  readonly afterStoryOrder: number;
  /** The story-world year, when known. Never fabricated. */
  readonly year?: number;
}

export interface ChronologyRow {
  readonly kind: "book" | "event";
  readonly label: string;
  readonly bookId?: string;
  readonly eventId?: string;
  readonly readingOrder?: number;
  readonly storyPosition: number;
  readonly year?: number;
}

// ── Series threads and arcs (§12, §13) ─────────────────────────────────────

export type SeriesThreadPhase = "introduced" | "advanced" | "escalates" | "dormant" | "resolved";

export interface SeriesThread {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly perBook: ReadonlyArray<{
    readonly bookId: string;
    readonly phase: SeriesThreadPhase;
    readonly note?: string;
    /** The book-local thread this manifests as, when bound. */
    readonly localThreadId?: string;
  }>;
}

/** High-level, qualitative — book-level arcs are not replaced (§13). */
export interface SeriesArc {
  readonly id: string;
  readonly canonCharacterId: string;
  readonly perBook: ReadonlyArray<{
    readonly bookId: string;
    readonly phase: string;
    readonly note?: string;
  }>;
}

// ── Book digests: the cross-book memory layer (§9, §10) ────────────────────

/**
 * What a finished (or in-progress) book contributes to later books: end-state
 * knowledge, relationships and character status in canon terms, important
 * events, and a short summary. Never the novel itself — this is the
 * structured memory that keeps prompts small (§10, §17).
 */
export interface BookDigest {
  readonly bookId: string;
  readonly generatedAt: string;
  readonly summary?: string;
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
  }>;
  readonly characterStatus: ReadonlyArray<{
    readonly canonCharacterId: string;
    readonly status: string;
  }>;
  readonly destroyedOrLost: ReadonlyArray<{
    readonly canonEntityId: string;
    readonly note: string;
  }>;
  readonly importantEvents: ReadonlyArray<{
    readonly summary: string;
    readonly chapterTitle?: string;
  }>;
}

/**
 * The spoiler boundary (§11): everything cross-book is asked *as of* a book,
 * and only earlier books' digests may answer. There is no unbounded query.
 */
export interface UniverseBoundary {
  /** Reading order position being worked on; prior state = books before it. */
  readonly upToReadingOrder: number;
}

// ── Conflicts and universe tests (§19, §22) ────────────────────────────────

export type ConflictResolution = "correct_book" | "update_canon" | "explain_exception" | "ignore";

export interface CanonConflict {
  readonly id: string;
  readonly canonEntityId: string;
  readonly bookId: string;
  readonly summary: string;
  readonly canonSays: string;
  readonly bookSays: string;
  readonly resolution?: ConflictResolution;
  readonly note?: string;
}

export type UniverseAssertion =
  | {
      readonly kind: "character_alive_through";
      readonly canonCharacterId: string;
      readonly throughBookId: string;
    }
  | {
      readonly kind: "fact_not_known_before";
      readonly canonFactId: string;
      readonly beforeBookId: string;
    }
  | {
      readonly kind: "entity_survives_until";
      readonly canonEntityId: string;
      readonly untilEventId: string;
    };

export interface UniverseTest {
  readonly id: string;
  readonly description: string;
  readonly assertion: UniverseAssertion;
}

export interface UniverseTestResult {
  readonly testId: string;
  readonly outcome: "pass" | "fail" | "inconclusive";
  readonly detail: string;
}

/** A cross-book diagnostic from the deterministic checks (§18). */
export interface UniverseDiagnostic {
  readonly id: string;
  readonly severity: "error" | "warning" | "info";
  readonly message: string;
  readonly bookId?: string;
  readonly canonEntityId?: string;
}

// ── Series build readiness (§23) ───────────────────────────────────────────

/**
 * The slot a future multi-book planning workflow would fill. Deliberately
 * only a shape: autonomous trilogy generation is out of scope here, but the
 * universe knows where such a plan would live.
 */
export interface SeriesPlanSlot {
  readonly seriesId: string;
  readonly bookId: string;
  readonly premise?: string;
  readonly goals?: readonly string[];
}
