import type { DiffHunk } from "@jellytind/story-repository";
import { AppError } from "@jellytind/shared";

/**
 * Controlled AI manuscript editing.
 *
 * The model never writes to a file. It proposes replacement prose; the harness
 * compiles the context, validates the response, stages the change, shows the
 * diff, and only a human decision commits it (AGENTS.md — "AI Mutation Rules";
 * docs/AI_EDITING.md).
 */
export type EditOperation = "rewrite_selection" | "rewrite_scene" | "continue_scene";

/** The shaping directives offered for a selection rewrite. */
export const REWRITE_DIRECTIVES = [
  "rewrite",
  "shorten",
  "expand",
  "strengthen_dialogue",
  "increase_tension",
  "remove_exposition",
] as const;

export type RewriteDirective = (typeof REWRITE_DIRECTIVES)[number];

export type EditErrorCode =
  | "permission_denied"
  | "unknown_target"
  | "unresolvable_range"
  | "stale_selection"
  | "empty_response"
  | "no_change"
  | "runaway_response"
  | "unknown_proposal"
  | "provider_failed";

export class EditError extends AppError {
  readonly editCode: EditErrorCode;

  constructor(
    editCode: EditErrorCode,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(`edit_${editCode}`, message, options);
    this.editCode = editCode;
  }
}

/** A character range within a file. */
export interface TextRange {
  readonly start: number;
  readonly end: number;
}

export interface RewriteSelectionRequest {
  readonly operation: "rewrite_selection";
  /** Chapter file holding the prose. */
  readonly path: string;
  readonly range: TextRange;
  /**
   * The text the user believes they selected. Checked against the file before
   * anything is proposed, so an edit can never be applied to prose that moved.
   */
  readonly selectedText: string;
  readonly directive: RewriteDirective;
  /** Scene the selection belongs to, when known — it decides the recipe. */
  readonly sceneId?: string;
  /** Extra guidance from the user. */
  readonly instruction?: string;
}

export interface RewriteSceneRequest {
  readonly operation: "rewrite_scene";
  readonly sceneId: string;
  readonly instruction?: string;
}

export interface ContinueSceneRequest {
  readonly operation: "continue_scene";
  readonly sceneId: string;
  readonly instruction?: string;
  /** Rough length target for the continuation, in words. */
  readonly targetWords?: number;
}

export type EditRequest = RewriteSelectionRequest | RewriteSceneRequest | ContinueSceneRequest;

/** What the model returned, after schema validation. */
export interface ModelProposal {
  readonly text: string;
  readonly rationale: string;
  readonly warnings: readonly string[];
}

export interface ProposalContextInfo {
  readonly recipe: string;
  readonly estimatedTokens: number;
  readonly itemCount: number;
  /** Elements the budget summarised, referenced or excluded. */
  readonly degradedCount: number;
}

/**
 * A staged, reviewable edit. Nothing in the project has changed yet: the
 * proposal holds the whole-file before/after so the reviewer sees exactly what
 * would land.
 */
export interface EditProposal {
  readonly id: string;
  readonly taskId: string;
  readonly operation: EditOperation;
  readonly targetId: string;
  readonly path: string;
  readonly instruction: string;
  readonly directive?: RewriteDirective;
  /** The range that would be replaced (empty range = insertion). */
  readonly range: TextRange;
  readonly before: string;
  readonly after: string;
  readonly hunks: readonly DiffHunk[];
  readonly rationale: string;
  readonly warnings: readonly string[];
  readonly context: ProposalContextInfo;
  readonly modelId: string;
  readonly createdAt: string;
}

export interface AcceptOptions {
  /**
   * Hunk IDs to apply. Omit to accept the whole proposal. An empty array is a
   * rejection and is refused, so "accept nothing" cannot be mistaken for
   * "accept everything".
   */
  readonly hunkIds?: readonly string[];
}

export interface AcceptResult {
  readonly changeSetId: string;
  readonly approval: "accepted" | "partially_accepted";
  readonly acceptedHunks: number;
  readonly offeredHunks: number;
}
