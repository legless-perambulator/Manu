export type {
  BookDigest,
  CanonBinding,
  CanonConflict,
  CanonEntity,
  CanonKind,
  CanonScope,
  ChronologyRow,
  ConflictResolution,
  Series,
  SeriesArc,
  SeriesPlanSlot,
  SeriesThread,
  SeriesThreadPhase,
  UniverseAssertion,
  UniverseBook,
  UniverseBoundary,
  UniverseDiagnostic,
  UniverseEvent,
  UniverseManifest,
  UniverseTest,
  UniverseTestResult,
} from "./types";
export { CANON_KINDS } from "./types";
export { UNIVERSE_PATHS, Universe, universeStoreOver, type UniverseStorePort } from "./store";
export { buildBookDigest } from "./digest";
export {
  boundaryForBook,
  priorDigests,
  priorKnowledgeForBook,
  priorState,
  renderPriorContext,
  type PriorState,
} from "./context";
export { derivedAge, universeChronology } from "./chronology";
export { detectCanonConflicts, resolveConflict, runUniverseTests, universeChecks } from "./checks";
export {
  applyMatch,
  promoteToCanon,
  reconcileEntities,
  type ReconcileCandidate,
  type ReconcileProposal,
} from "./reconcile";
