import type {
  CharacterId,
  ClueId,
  DeductionId,
  EventId,
  FactId,
  MysteryId,
  ObjectId,
  SceneId,
} from "./ids";

/**
 * The information architecture of a mystery.
 *
 * A mystery is not a plot thread with a corpse in it. It is a structure of
 * **who knows what, when** — laid on top of the story's own knowledge model —
 * and the question it exists to answer is whether a careful reader could get
 * there before the reveal. That question is about records, not prose: once the
 * clue system is populated, the whole architecture is reconstructible without
 * reading a word (docs/MYSTERY_ENGINE.md).
 */

/**
 * The five kinds of information a mystery moves.
 *
 * Kept apart because they behave differently. A clue is *available*; evidence
 * *establishes*; a red herring is available and meant to mislead; a deduction
 * is what a reader must *do* with them; a reveal is where the story stops
 * asking.
 */
export const EVIDENCE_KINDS = ["clue", "evidence", "red_herring", "deduction", "reveal"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** Where a clue physically comes from — what a reader is actually shown. */
export const CLUE_SOURCES = [
  "object",
  "testimony",
  "observation",
  "document",
  "absence",
  "behaviour",
] as const;
export type ClueSource = (typeof CLUE_SOURCES)[number];

/** Whether the clue has done its work yet. */
export const CLUE_STATUSES = ["planted", "in_play", "paid_off", "abandoned"] as const;
export type ClueStatus = (typeof CLUE_STATUSES)[number];

/**
 * How plainly a clue is put in front of the reader when it appears.
 *
 * The author's intent, not a measurement: `stated` means the text says it,
 * `shown` means it is on the page to be noticed, `buried` means it is there and
 * meant to be missed. Fairness turns on this — a solution resting entirely on
 * buried clues is technically fair and practically not.
 */
export const CLUE_VISIBILITY = ["stated", "shown", "buried"] as const;
export type ClueVisibility = (typeof CLUE_VISIBILITY)[number];

export interface ClueDiscovery {
  readonly characterId: CharacterId;
  readonly sceneId: SceneId;
  /** What they took it to mean, if the author wants it recorded. */
  readonly interpretation?: string;
}

export interface Clue {
  readonly id: ClueId;
  readonly mysteryId: MysteryId;
  readonly description: string;
  readonly kind: EvidenceKind;
  readonly source: ClueSource;
  /** Where the reader first meets it. Absent while it is only planned. */
  readonly firstAppearance?: SceneId;
  /** Every scene where the reader is shown it, in the order they are shown. */
  readonly readerExposure: readonly SceneId[];
  readonly visibility: ClueVisibility;
  /** Which characters find it, and where. */
  readonly characterDiscoveries: readonly ClueDiscovery[];
  /**
   * What it actually means. **Author-only** — this is the single field that
   * must never reach a reader-facing context, and the reason the reader recipe
   * carries no records at all (docs/SIMULATIONS.md).
   */
  readonly trueMeaning?: string;
  /** What a first-time reader is meant to take it for. */
  readonly apparentMeaning?: string;
  readonly relatedFactIds: readonly FactId[];
  readonly relatedSuspectIds: readonly CharacterId[];
  readonly relatedObjectIds: readonly ObjectId[];
  /** Where it is finally cashed — the scene that makes the point of it. */
  readonly payoffSceneId?: SceneId;
  readonly status: ClueStatus;
  /** For a red herring: how the story explains it away, and where. */
  readonly resolution?: string;
  readonly resolvedSceneId?: SceneId;
  readonly notes?: string;
}

/**
 * A character standing under suspicion within one mystery.
 *
 * Motive, means and opportunity are recorded because they are what a reader
 * weighs — **not** so a program can add them up. Nothing here decides guilt:
 * the author says who did it, and a suspect with all three and no guilt is the
 * most useful thing in a mystery.
 */
export interface Suspect {
  readonly mysteryId: MysteryId;
  readonly characterId: CharacterId;
  readonly motive?: string;
  readonly means?: string;
  readonly opportunity?: string;
  /** Where they claim to have been, and when. Checked against the timeline. */
  readonly alibi?: {
    readonly claim: string;
    readonly locationId?: string;
    /** The event or scene the alibi covers. */
    readonly coversEventId?: EventId;
    readonly coversSceneId?: SceneId;
    readonly corroboratedBy?: CharacterId;
  };
  readonly evidenceFor: readonly ClueId[];
  readonly evidenceAgainst: readonly ClueId[];
  /** The author's intended reader suspicion arc, in their own words. */
  readonly intendedReaderSuspicion?: string;
  /** What the investigator in the story makes of them. */
  readonly investigatorSuspicion?: string;
  readonly notes?: string;
}

/**
 * One step of reasoning the reader is expected to make.
 *
 * Premises are clues, facts, or earlier deductions — which makes the whole
 * thing a graph, and makes "is this solvable by chapter twelve?" a question
 * about when every premise became available rather than a matter of opinion.
 */
export interface Deduction {
  readonly id: DeductionId;
  readonly mysteryId: MysteryId;
  /** What the reader concludes. */
  readonly statement: string;
  /** Clue, fact or deduction IDs. */
  readonly premises: readonly string[];
  /** How much work it is. The author's estimate, not a measurement. */
  readonly difficulty: DeductionDifficulty;
  /** The proposition it establishes, when it maps onto a recorded fact. */
  readonly yieldsFactId?: FactId;
  /** True when this is the last step — the solution itself. */
  readonly isSolution?: boolean;
  readonly notes?: string;
}

export const DEDUCTION_DIFFICULTIES = ["direct", "moderate", "demanding"] as const;
export type DeductionDifficulty = (typeof DEDUCTION_DIFFICULTIES)[number];

export const MYSTERY_STATUSES = ["planned", "active", "resolved", "abandoned"] as const;
export type MysteryStatus = (typeof MYSTERY_STATUSES)[number];

export interface Mystery {
  readonly id: MysteryId;
  readonly name: string;
  /** What the reader is asking. "Who sealed the vault, and why?" */
  readonly question: string;
  /** The answer. **Author-only**, like a clue's true meaning. */
  readonly solution?: string;
  readonly culpritIds: readonly CharacterId[];
  /** Where the story means to answer it. */
  readonly revealSceneId?: SceneId;
  /**
   * The earliest scene the author *intends* a reader to be able to solve it.
   * Fairness and obviousness are both measured against this.
   */
  readonly intendedSolvableFromSceneId?: SceneId;
  readonly status: MysteryStatus;
  readonly notes?: string;
}

// ── Fairness ────────────────────────────────────────────────────────────────

/**
 * Why a mystery is or is not fair, one problem at a time.
 *
 * `unavailable_premise` and `hidden_essential` are the two that matter: a
 * solution resting on something the reader was never shown is not a hard
 * mystery, it is a different kind of book.
 */
export const FAIRNESS_PROBLEMS = [
  /** A premise of the solution is never shown to the reader before the reveal. */
  "hidden_essential",
  /** A premise appears only after the point the author says it is solvable. */
  "late_premise",
  /** A deduction rests on a premise that does not exist in the project. */
  "missing_premise",
  /** Two records disagree about the same thing. */
  "contradiction",
  /** A red herring is never explained. */
  "unresolved_herring",
  /** Every premise is present, but all of them are buried. */
  "technically_fair",
  /** A clue is planted and never cashed. */
  "unpaid_clue",
] as const;
export type FairnessProblem = (typeof FAIRNESS_PROBLEMS)[number];

export interface FairnessFinding {
  readonly problem: FairnessProblem;
  readonly statement: string;
  readonly detail?: string;
  readonly clueIds?: readonly string[];
  readonly sceneIds?: readonly string[];
  readonly derivation: "deterministic" | "model";
}

export interface FairnessReport {
  readonly mysteryId: string;
  readonly mysteryName: string;
  /** The chain from clues to the solution, in the order it must be made. */
  readonly chain: readonly string[];
  readonly findings: readonly FairnessFinding[];
  /** Everything the reader has been shown by the reveal, in scene order. */
  readonly readerHasByReveal: readonly string[];
  readonly verdict: FairnessVerdict;
  readonly basis: string;
  readonly notChecked: readonly string[];
}

/**
 * Deliberately not a score.
 *
 * `fair` means every premise reached the reader before the reveal. `unfair`
 * means one did not. `strained` means they all did, but only just, or only in
 * buried form — which is the interesting case and the one a percentage would
 * hide.
 */
export const FAIRNESS_VERDICTS = ["fair", "strained", "unfair", "insufficient_data"] as const;
export type FairnessVerdict = (typeof FAIRNESS_VERDICTS)[number];

export function describeFairness(verdict: FairnessVerdict): string {
  switch (verdict) {
    case "fair":
      return "Fair — everything needed reaches the reader before the reveal";
    case "strained":
      return "Strained — technically available, but only just";
    case "unfair":
      return "Unfair — the solution rests on something the reader never had";
    case "insufficient_data":
      return "Not enough recorded to say";
  }
}

/** Where the solution first becomes reachable, and what makes it so. */
export interface Solvability {
  readonly mysteryId: string;
  /** The scene by which every premise has been shown. Null when never. */
  readonly earliestSceneId: string | null;
  readonly earliestPosition: number | null;
  /** The premise that arrives last — the one holding solvability back. */
  readonly gatingPremise?: {
    readonly id: string;
    readonly sceneId: string;
    readonly label: string;
  };
  readonly intendedSceneId?: string;
  /** Negative when solvable earlier than intended, positive when later. */
  readonly scenesFromIntended?: number;
  readonly caveat: string;
}

/** Simulated readers arriving at the culprit before the author meant them to. */
export interface ObviousnessFinding {
  readonly mysteryId: string;
  readonly culpritId: string;
  readonly readerProfileId: string;
  readonly readerProfileName: string;
  /** Where that reader's suspicion first reached the threshold. */
  readonly suspectedAtPosition: number;
  readonly suspectedAtChapterId: string;
  readonly intendedPosition?: number;
  readonly scenesEarly?: number;
  readonly caveat: string;
}

export const MYSTERY_CAVEAT =
  "Model analysis over the clue system the author recorded — not a measurement of whether real readers solve it.";

/** An alibi that the recorded timeline does not support. */
export interface AlibiFinding {
  readonly mysteryId: string;
  readonly characterId: string;
  readonly statement: string;
  readonly detail?: string;
  readonly sceneIds?: readonly string[];
  readonly kind: "contradicted" | "uncorroborated" | "unchecked";
}
