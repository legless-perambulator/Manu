/**
 * @jellytind/story-debugger — investigate before editing.
 *
 * The Story Compiler answers "is anything wrong?". The debugger answers "why is
 * this not working?", which is a different question with a different shape: it
 * starts from a writer's own words, decides what to look at, retrieves what the
 * project records, traces it through the systems that own it, and presents the
 * evidence (docs/STORY_DEBUGGER.md).
 *
 * Everything in this package is **deterministic**. Interpretation of the
 * evidence is a controlled model operation and lives in `@jellytind/editing`,
 * so a project with no model configured still gets a real report. That split is
 * the point: a diagnosis is an addition to the evidence, never a substitute
 * for it.
 *
 * Nothing here writes.
 */

export { traceProblem, coerceRequest } from "./trace";
export type { DebugRequestInput } from "./trace";
export { snapshot, countWords, excerpt, precedingScenes } from "./project";
export type { ProjectSnapshot } from "./project";

export { EvidenceCollector, tracedEntities } from "./evidence";

export { parseDebugCommand, TOPIC_ALIASES } from "./command";
export type { EntitySummary, ParsedCommand } from "./command";

export { renderDebugReport } from "./present";

export { traceReveal } from "./reveal";
export { traceMotivation } from "./motivation";
export { tracePacing } from "./pacing";
export { traceContinuity } from "./continuity";

export type { DebugReader } from "./reader";

export {
  DEBUG_MODES,
  DEBUG_MODE_LABEL,
  EVIDENCE_SYSTEMS,
  CONFIDENCE_LEVELS,
  INTERVENTION_KINDS,
  INTERVENTION_EFFORTS,
  DebugError,
} from "./types";
export type {
  Confidence,
  ContinuityDebugRequest,
  DebugErrorCode,
  DebugMode,
  DebugReport,
  DebugReportSummary,
  DebugRequest,
  DebugScope,
  DebugTrace,
  Diagnosis,
  EvidenceItem,
  EvidenceSystem,
  Intervention,
  InterventionEffort,
  InterventionKind,
  Measurement,
  MotivationDebugRequest,
  PacingDebugRequest,
  ProseExcerpt,
  RevealDebugRequest,
} from "./types";
