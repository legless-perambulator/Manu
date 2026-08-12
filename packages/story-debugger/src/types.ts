import { AppError } from "@jellytind/shared";

/**
 * The Story Debugger's vocabulary.
 *
 * The debugger investigates *why* something is not working instead of
 * immediately rewriting it (docs/STORY_DEBUGGER.md). The whole design turns on
 * one separation, which the types enforce rather than describe:
 *
 * - **evidence** is deterministic — what the project records, retrieved;
 * - **diagnosis** is a model's interpretation of that evidence, labelled as such;
 * - **interventions** are suggestions, and nothing applies them.
 *
 * A report can exist with evidence and no diagnosis. It cannot exist with a
 * diagnosis and no evidence.
 */

export const DEBUG_MODES = ["reveal", "character_motivation", "pacing", "continuity"] as const;
export type DebugMode = (typeof DEBUG_MODES)[number];

export const DEBUG_MODE_LABEL: Readonly<Record<DebugMode, string>> = {
  reveal: "Reveal",
  character_motivation: "Character motivation",
  pacing: "Pacing",
  continuity: "Continuity",
};

/**
 * Which recorded system a piece of evidence came from.
 *
 * Named on every item because "the manuscript says" and "the knowledge graph
 * says" are different kinds of claim, and a writer deciding whether to trust a
 * finding needs to know which they are looking at.
 */
export const EVIDENCE_SYSTEMS = [
  "structure",
  "search",
  "story_state",
  "knowledge",
  "relationships",
  "timeline",
  "plot_threads",
  "setups",
  "compiler",
  "story_tests",
  "prose",
] as const;
export type EvidenceSystem = (typeof EVIDENCE_SYSTEMS)[number];

/** One recorded thing, retrieved. Always deterministic; never an opinion. */
export interface EvidenceItem {
  /** Stable within a report (`E1`, `E2`, …) so a diagnosis can cite it. */
  readonly id: string;
  readonly system: EvidenceSystem;
  /** What it says, in one line. */
  readonly statement: string;
  /** The recorded data behind the statement. */
  readonly detail?: string;
  readonly sceneId?: string;
  readonly chapterId?: string;
  /** Everything named here is navigable in the UI. */
  readonly entities: readonly string[];
}

/**
 * A number the trace measured. Never a grade.
 *
 * "The first signal sits nine scenes before the reveal" is a measurement. "The
 * reveal is telegraphed" is a judgement, and belongs to the model — with its
 * label on (docs/NARRATIVE_THREADS.md, on dormancy).
 */
export interface Measurement {
  readonly label: string;
  readonly value: number;
  readonly unit: string;
  /** How it was arrived at, so the number can be checked. */
  readonly basis: string;
  readonly entities: readonly string[];
}

/** What the trace looked at — and, as importantly, what it did not. */
export interface DebugScope {
  readonly summary: string;
  readonly sceneIds: readonly string[];
  readonly chapterIds: readonly string[];
  readonly entityIds: readonly string[];
  /** The systems actually consulted. */
  readonly systems: readonly EvidenceSystem[];
  /**
   * Things a reader of this report might assume were checked and were not,
   * each with the reason. A silent omission would make the report untrustworthy
   * in exactly the cases it matters.
   */
  readonly notInspected: readonly string[];
}

export const CONFIDENCE_LEVELS = ["low", "moderate", "high"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/**
 * The model's reading of the evidence. Always labelled MODEL JUDGEMENT.
 *
 * `basis` holds evidence IDs. `unsupported` holds citations that resolved to
 * nothing — kept visible rather than quietly dropped, because a diagnosis
 * resting on evidence that does not exist is the failure mode worth catching.
 */
export interface Diagnosis {
  readonly statement: string;
  readonly reasoning: string;
  readonly confidence: Confidence;
  /** What would change this answer. Required: certainty is not a diagnosis. */
  readonly uncertainty: readonly string[];
  readonly basis: readonly string[];
  readonly unsupported: readonly string[];
}

export const INTERVENTION_KINDS = ["add", "revise", "move", "remove", "record"] as const;
export type InterventionKind = (typeof INTERVENTION_KINDS)[number];

export const INTERVENTION_EFFORTS = ["small", "moderate", "large"] as const;
export type InterventionEffort = (typeof INTERVENTION_EFFORTS)[number];

/** A proposal. Nothing in the debugger applies one. */
export interface Intervention {
  readonly kind: InterventionKind;
  readonly summary: string;
  readonly rationale: string;
  readonly effort: InterventionEffort;
  readonly sceneIds: readonly string[];
  readonly entities: readonly string[];
}

/** The deterministic half: everything the project can answer without a model. */
export interface DebugTrace {
  readonly mode: DebugMode;
  readonly problem: string;
  readonly scope: DebugScope;
  readonly evidence: readonly EvidenceItem[];
  readonly measurements: readonly Measurement[];
  /** Prose excerpts, kept apart from evidence so their bulk is visible. */
  readonly excerpts: readonly ProseExcerpt[];
}

export interface ProseExcerpt {
  readonly sceneId?: string;
  readonly chapterId?: string;
  readonly label: string;
  readonly text: string;
}

export interface DebugReport extends DebugTrace {
  readonly id: string;
  readonly createdAt: string;
  readonly durationMs: number;
  /** Absent when no model ran. The report stands without it. */
  readonly diagnosis?: Diagnosis;
  readonly interventions: readonly Intervention[];
  readonly modelId?: string;
  /** Every entity the report touches, for navigation. */
  readonly entities: readonly string[];
}

/** Summary row for the report list. */
export interface DebugReportSummary {
  readonly id: string;
  readonly mode: DebugMode;
  readonly problem: string;
  readonly createdAt: string;
  readonly evidenceCount: number;
  readonly diagnosed: boolean;
}

// ── Requests ─────────────────────────────────────────────────────────────────

/**
 * A reveal that is not landing.
 *
 * The reveal scene may be given directly, or found from the thread or fact
 * being revealed — a writer usually knows *what* is not landing before they
 * know which scene to blame.
 */
export interface RevealDebugRequest {
  readonly mode: "reveal";
  readonly problem: string;
  readonly revealSceneId?: string;
  /** Whose reveal it is — the betrayer, the killer, the one with the secret. */
  readonly characterId?: string;
  readonly threadId?: string;
  readonly factId?: string;
  /** How many preceding scenes to inspect. Default 12. */
  readonly lookBack?: number;
}

/** A decision that feels forced. */
export interface MotivationDebugRequest {
  readonly mode: "character_motivation";
  readonly problem: string;
  readonly characterId: string;
  readonly sceneId: string;
  /** How many of their prior scenes to inspect. Default 5. */
  readonly lookBack?: number;
}

/** Pacing across a chapter, a range, or the whole book. */
export interface PacingDebugRequest {
  readonly mode: "pacing";
  readonly problem: string;
  readonly chapterId?: string;
  readonly fromChapterId?: string;
  readonly toChapterId?: string;
}

/** Start from a compiler diagnostic and trace its cause. */
export interface ContinuityDebugRequest {
  readonly mode: "continuity";
  readonly problem?: string;
  readonly diagnosticId: string;
  /** Which build the diagnostic came from. Defaults to the latest. */
  readonly buildId?: string;
}

export type DebugRequest =
  RevealDebugRequest | MotivationDebugRequest | PacingDebugRequest | ContinuityDebugRequest;

export type DebugErrorCode =
  "unknown_mode" | "target_not_found" | "nothing_to_trace" | "bad_command";

export class DebugError extends AppError {
  constructor(
    override readonly code: DebugErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(code, message, details === undefined ? undefined : { details });
  }
}
