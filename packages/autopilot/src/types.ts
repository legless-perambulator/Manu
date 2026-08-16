import { AppError } from "@jellytind/shared";
import type { MappingConfidence } from "@jellytind/story-mapper";

/**
 * Manuscript Intelligence Autopilot (Phase 44).
 *
 * «The writer writes the story. Manu maintains the map.»
 *
 * The autopilot watches prose change, scopes work to exactly what changed,
 * runs cheap deterministic extraction first and semantic reading second, and
 * turns everything it infers into *proposals with evidence* in a review
 * inbox. Nothing it does blocks writing, nothing it does edits prose, and
 * nothing uncertain becomes canon silently (docs/AUTOPILOT.md).
 */

export type AutopilotErrorCode = "invalid_state" | "unknown_proposal" | "not_applicable";

export class AutopilotError extends AppError {
  constructor(
    code: AutopilotErrorCode,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(code, message, options);
  }
}

/** How eagerly semantic inferences apply themselves (§17). */
export type AutopilotPolicy = "conservative" | "balanced" | "automatic";

export interface AutopilotSettings {
  readonly policy: AutopilotPolicy;
  /** §28: background intelligence can be paused entirely. */
  readonly paused: boolean;
  /** §27: an explicit background-analysis budget. Absent = no cap set. */
  readonly monthlyBudgetUsd?: number;
}

export const DEFAULT_SETTINGS: AutopilotSettings = { policy: "balanced", paused: false };

/** What kind of inference a proposal carries. */
export type ProposalKind =
  | "new_entity"
  | "alias"
  | "scene_metadata"
  | "state_transition"
  | "knowledge"
  | "relationship"
  | "object_transfer"
  | "thread"
  | "timeline"
  | "fact";

/**
 * The inbox groups (§16). `needs_review` and `conflict` wait for the writer;
 * `auto_applied` happened under the policy and is reversible; `accepted`,
 * `rejected` and `ignored` are decided.
 */
export type IntelStatus =
  "needs_review" | "auto_applied" | "accepted" | "rejected" | "ignored" | "conflict";

/** How much damage a wrong apply could do. High risk never auto-applies. */
export type ProposalRisk = "low" | "medium" | "high";

export interface IntelEvidence {
  readonly sceneId: string;
  readonly sceneTitle: string;
  /** The prose that supports the claim (§18). */
  readonly quote?: string;
}

export interface IntelProposal {
  readonly id: string;
  readonly kind: ProposalKind;
  readonly status: IntelStatus;
  readonly confidence: MappingConfidence;
  readonly risk: ProposalRisk;
  readonly origin: "deterministic" | "model";
  /** What changed — one sentence (§18). */
  readonly summary: string;
  /** Why Manu thinks this — the reading that produced it. */
  readonly because: string;
  readonly evidence: readonly IntelEvidence[];
  /** Kind-specific structured content, used when the proposal applies. */
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
  readonly decidedAt?: string;
  /** Record ids the apply produced — what a revert would undo. */
  readonly appliedRecords?: readonly string[];
  /** Present on conflicts: what the manuscript contradicts (§21). */
  readonly conflictsWith?: string;
  /** Present when an exception was recorded instead of a change (§21). */
  readonly exception?: string;
}

/** §21 resolutions. "Change manuscript" is the writer's act, never Manu's. */
export type ConflictResolution = "update_canon" | "explain_exception" | "ignore";

/** One unit of prose the autopilot watches: a scene, or a chapter without markers. */
export interface ProseUnit {
  readonly sceneId: string;
  readonly chapterId: string;
  readonly title: string;
  readonly text: string;
  /**
   * Metadata the author set explicitly. Authoritative: the autopilot never
   * proposes over these fields, let alone writes them (§20).
   */
  readonly authoritative?: readonly string[];
}

export interface KnownEntity {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly aliases: readonly string[];
}

/** A background job (§3). Deterministic work always outranks semantic work. */
export interface AutopilotJob {
  readonly id: string;
  readonly kind: "deterministic_scan" | "semantic_scan";
  readonly sceneId: string;
  readonly createdAt: string;
}

/** What the writer taught the autopilot by correcting it (§19). */
export interface LearnedRules {
  /** "The Captain" is always Marcus. Applied before any proposal is made. */
  readonly aliases: ReadonlyArray<{ readonly alias: string; readonly entityId: string }>;
  /** Names the writer said are not entities. Never proposed again. */
  readonly notEntities: readonly string[];
}

export interface AnalystRequest {
  readonly sceneId: string;
  readonly sceneTitle: string;
  readonly text: string;
  readonly briefing: string;
}

export type AnalysisKind =
  "scene" | "state" | "knowledge" | "relationships" | "objects" | "threads" | "timeline" | "facts";

export interface IntelFinding {
  readonly summary: string;
  readonly confidence: MappingConfidence;
  readonly quote?: string;
  readonly payload?: Readonly<Record<string, unknown>>;
  /** True when the reading contradicts established canon it was shown. */
  readonly conflictsWith?: string;
}

/**
 * The semantic half, as a port. The desktop implements it over the Model
 * Router (economical models, privacy policy, budgets); tests fake it. With
 * no analyst, deterministic work still runs and semantic jobs wait, saying
 * why.
 */
export interface IntelAnalyst {
  read(kind: AnalysisKind, request: AnalystRequest): Promise<readonly IntelFinding[]>;
  /** What one call costs, when known. Feeds the budget (§27). */
  readonly costPerCallUsd?: number;
}

/** Applies an accepted proposal to the project; returns undo record ids. */
export interface IntelApplier {
  apply(proposal: IntelProposal): Promise<readonly string[]>;
  revert?(recordIds: readonly string[]): Promise<void>;
}

export interface FileStorePort {
  readProjectFile(path: string): Promise<string | null>;
  writeProjectFile(path: string, contents: string): Promise<void>;
  listProjectFiles(prefix?: string): Promise<readonly string[]>;
}

export interface AutopilotPorts {
  readonly files: FileStorePort;
  /** The prose units and entities as they are now. Read every drain. */
  units(): Promise<readonly ProseUnit[]>;
  entities(): Promise<readonly KnownEntity[]>;
  /** Deterministic canon check for §21; null = no contradiction found. */
  conflictCheck?(proposal: IntelProposal): Promise<string | null>;
  readonly analyst: IntelAnalyst | null;
  readonly applier: IntelApplier;
  now?(): string;
}

export interface AutopilotStatus {
  /** One quiet line (§30). */
  readonly label: string;
  readonly needsReview: number;
  readonly conflicts: number;
  readonly pendingJobs: number;
  readonly paused: boolean;
  /** Why semantic work is waiting, when it is. */
  readonly waiting?: string;
}

export interface SyncEstimate {
  readonly scenes: number;
  readonly semanticCalls: number;
  /** Known only when the analyst prices its calls. Never invented. */
  readonly estimatedUsd?: number;
}
