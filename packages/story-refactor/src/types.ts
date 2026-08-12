import { AppError } from "@jellytind/shared";
import type { BlastRadius } from "@jellytind/story-causality";
import type { Diagnostic, StoryBuild, TestRunSummary } from "@jellytind/story-compiler";
import type { FileChange } from "@jellytind/story-repository";

/**
 * Story Refactor: the fiction equivalent of a code refactor.
 *
 * "Make Marcus Elias's childhood friend instead of his brother" is a change to
 * the *architecture* of a story, not to a paragraph. It touches a character
 * record, a relationship, whatever facts and threads rested on the sibling
 * bond, the scenes that say the word, and the knowledge those scenes moved.
 * A writer doing it by hand finds the last consequence six months later.
 *
 * So the operation is deliberately slow and visible:
 *
 * ```
 * analyse → plan → checkpoint → stage → validate → present → commit or discard
 * ```
 *
 * Every step before `commit` is reversible by doing nothing, and validation
 * runs against a **shadow copy**, so "commit only after approval" is literally
 * true rather than "commit, then revert if it went badly"
 * (docs/STORY_REFACTOR.md).
 */

export const REFACTOR_KINDS = [
  "rename_entity",
  "change_relationship",
  "change_character_attribute",
  "move_story_event",
] as const;
export type RefactorKind = (typeof REFACTOR_KINDS)[number];

export const REFACTOR_KIND_LABEL: Readonly<Record<RefactorKind, string>> = {
  rename_entity: "Rename",
  change_relationship: "Change relationship",
  change_character_attribute: "Change attribute",
  move_story_event: "Move event",
};

// ── Requests ─────────────────────────────────────────────────────────────────

interface RequestBase {
  /** What the writer actually asked for, in their words. Kept for the audit. */
  readonly instruction?: string;
}

/** Rename an entity. The stable ID never changes. */
export interface RenameEntityRequest extends RequestBase {
  readonly kind: "rename_entity";
  readonly entityId: string;
  readonly newName: string;
  /** Keep the old name as an alias. Default true: it is still their old name. */
  readonly keepOldNameAsAlias?: boolean;
}

/** Change what two characters are to each other. */
export interface ChangeRelationshipRequest extends RequestBase {
  readonly kind: "change_relationship";
  readonly relationshipId: string;
  readonly newType: string;
  readonly newStatus?: string;
  readonly newDescription?: string;
  /**
   * Words the old relation put in the prose — "brother", "his brother",
   * "sibling". Given by the caller because only the writer knows which words
   * their book actually uses.
   */
  readonly oldTerms?: readonly string[];
  readonly newTerm?: string;
}

/** Change something about a character that the prose also says out loud. */
export interface ChangeAttributeRequest extends RequestBase {
  readonly kind: "change_character_attribute";
  readonly characterId: string;
  /** Which field moves. */
  readonly field: "role" | "description" | "goals";
  readonly newValue: string | readonly string[];
  readonly oldTerms?: readonly string[];
  readonly newTerm?: string;
}

/** Move a scene to a different chapter — the story's order, not its prose. */
export interface MoveEventRequest extends RequestBase {
  readonly kind: "move_story_event";
  readonly sceneId: string;
  readonly toChapterId: string;
}

export type RefactorRequest =
  RenameEntityRequest | ChangeRelationshipRequest | ChangeAttributeRequest | MoveEventRequest;

// ── Analysis ─────────────────────────────────────────────────────────────────

/** One structured thing the change reaches, and why it is reached. */
export interface AffectedEntityRef {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  /** How the analysis found it. */
  readonly why: string;
  /** Whether it is named directly or arrives through the dependency graph. */
  readonly direct: boolean;
}

/** A place in the manuscript that mentions what is changing. */
export interface ManuscriptReference {
  readonly path: string;
  readonly chapterId?: string;
  readonly term: string;
  readonly occurrences: number;
  readonly excerpt: string;
}

export const RISK_LEVELS = ["high", "medium", "low"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/**
 * Something that may not survive the change.
 *
 * `source` is the whole point: a risk the structured systems found is a fact
 * about the project, and a risk a model raised is a reading. A writer weighing
 * whether to go ahead has to know which they are looking at
 * (docs/STORY_COMPILER.md — "semantic analysis is labelled").
 */
export interface RefactorRisk {
  readonly level: RiskLevel;
  readonly summary: string;
  readonly detail: string;
  readonly entities: readonly string[];
  readonly source: "structured" | "model";
}

export interface RefactorAnalysis {
  readonly kind: RefactorKind;
  /** The change in one line, for the report header. */
  readonly summary: string;
  readonly instruction: string;
  /** The entities the request names. Everything else is reached from these. */
  readonly targets: readonly string[];
  readonly affected: readonly AffectedEntityRef[];
  /** Counts by entity kind, for the analysis header. */
  readonly counts: Readonly<Record<string, number>>;
  readonly manuscriptReferences: readonly ManuscriptReference[];
  /** Knowledge transitions that touch the targets. */
  readonly knowledgeTransitionIds: readonly string[];
  readonly blastRadius: BlastRadius | null;
  readonly highRisk: readonly string[];
  readonly risks: readonly RefactorRisk[];
  /** Story tests naming a target — they will be run again after the change. */
  readonly storyTestIds: readonly string[];
}

// ── Plan ─────────────────────────────────────────────────────────────────────

/** One occurrence of a term in a chapter file. */
export interface TextOccurrence {
  readonly start: number;
  readonly end: number;
  readonly before: string;
  readonly after: string;
}

export type PlanStep =
  /** A structured field change. The ID is never in the patch. */
  | {
      readonly kind: "update_entity";
      readonly entityId: string;
      readonly patch: Readonly<Record<string, unknown>>;
      readonly reason: string;
    }
  /** A deterministic term substitution in a chapter's prose. */
  | {
      readonly kind: "replace_text";
      readonly path: string;
      readonly chapterId?: string;
      readonly find: string;
      readonly replace: string;
      readonly occurrences: readonly TextOccurrence[];
      readonly reason: string;
    }
  /** A passage a substitution cannot fix. Needs a model, or a person. */
  | {
      readonly kind: "rewrite_passage";
      readonly path: string;
      readonly chapterId?: string;
      readonly sceneId?: string;
      readonly instruction: string;
      readonly excerpt: string;
      readonly reason: string;
    }
  /** Move a scene into a different chapter. */
  | {
      readonly kind: "move_scene";
      readonly sceneId: string;
      readonly toChapterId: string;
      readonly reason: string;
    }
  /**
   * Something the refactor will **not** do for you.
   *
   * Listed rather than silently skipped: "Elias's mother refers to Marcus as
   * her son" is not a word swap, and a refactor that quietly left it would be
   * worse than one that says so.
   */
  | {
      readonly kind: "manual";
      readonly description: string;
      readonly entities: readonly string[];
      readonly reason: string;
    };

export interface RefactorPlan {
  readonly steps: readonly PlanStep[];
  /** Set when a model helped write the plan. Its contribution is labelled. */
  readonly modelId?: string;
  /** The model's reading of what else the change implies. Never a fact. */
  readonly modelNotes: readonly string[];
}

// ── Run ──────────────────────────────────────────────────────────────────────

export const REFACTOR_STATUSES = [
  "analysed",
  "staged",
  "failed_validation",
  "committed",
  "discarded",
] as const;
export type RefactorStatus = (typeof REFACTOR_STATUSES)[number];

/** Build and test results at one moment. */
export interface ValidationSnapshot {
  readonly errors: number;
  readonly warnings: number;
  readonly diagnostics: readonly Diagnostic[];
  readonly testsPassed: number;
  readonly testsTotal: number;
  readonly failedTestIds: readonly string[];
}

/**
 * The audit record of one refactor.
 *
 * Everything the operation touched, in one place: the request as asked, the
 * analysis it produced, the plan, which models had a hand in it, the staged
 * edits, diagnostics before and after, the approval, and the revision that
 * resulted. A structural change to a novel that cannot be accounted for later
 * is a change a writer cannot trust (docs/VERSIONING.md).
 */
export interface RefactorRun {
  readonly id: string;
  readonly status: RefactorStatus;
  readonly kind: RefactorKind;
  readonly instruction: string;
  readonly request: RefactorRequest;
  readonly analysis: RefactorAnalysis;
  readonly plan: RefactorPlan;
  readonly createdAt: string;
  readonly modelIds: readonly string[];
  /** The safety net taken before anything was staged. */
  readonly checkpointId?: string;
  readonly stagedFiles: readonly FileChange[];
  readonly before?: ValidationSnapshot;
  readonly after?: ValidationSnapshot;
  /** Diagnostics present after but not before — what the refactor introduced. */
  readonly introduced: readonly Diagnostic[];
  readonly approvedAt?: string;
  readonly changeSetId?: string;
  readonly notes?: string;
}

export interface RefactorRunSummary {
  readonly id: string;
  readonly kind: RefactorKind;
  readonly status: RefactorStatus;
  readonly instruction: string;
  readonly createdAt: string;
  readonly introducedErrors: number;
}

export type RefactorErrorCode =
  "unknown_kind" | "target_not_found" | "nothing_to_do" | "not_staged" | "validation_failed";

export class RefactorError extends AppError {
  constructor(
    override readonly code: RefactorErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(code, message, details === undefined ? undefined : { details });
  }
}

/** Build and test results reduced to what a report needs. */
export function snapshot(build: StoryBuild, tests: TestRunSummary): ValidationSnapshot {
  return {
    errors: build.counts.error,
    warnings: build.counts.warning,
    diagnostics: build.diagnostics,
    testsPassed: tests.deterministic.passed,
    testsTotal: tests.deterministic.total,
    failedTestIds: tests.results.filter((r) => r.status === "failed").map((r) => r.testId),
  };
}
