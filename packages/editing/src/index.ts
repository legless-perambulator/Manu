/**
 * @jellytind/editing — controlled AI manuscript editing.
 *
 * Targeted, reviewable, reversible edits: the Context Compiler supplies the
 * story context, the Model Router makes the call, a schema validates the reply,
 * the staging transaction holds it, and a human decides
 * (docs/AI_EDITING.md).
 */
export { ManuscriptEditor } from "./manuscript-editor";
export type { ManuscriptEditorOptions } from "./manuscript-editor";

export { PROPOSAL_SCHEMA, RESPONSE_FORMAT, validateProposalText } from "./proposal-schema";
export { directiveInstruction, EDITOR_SYSTEM_PROMPT } from "./prompts";

export { EditError, REWRITE_DIRECTIVES } from "./types";
export type {
  AcceptOptions,
  AcceptResult,
  ContinueSceneRequest,
  EditErrorCode,
  EditOperation,
  EditProposal,
  EditRequest,
  ModelProposal,
  ProposalContextInfo,
  RewriteDirective,
  RewriteSceneRequest,
  RewriteSelectionRequest,
  TextRange,
} from "./types";
