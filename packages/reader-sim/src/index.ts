/**
 * @jellytind/reader-sim — simulated readers.
 *
 * A reader who has read this far and no further. The engine holds one
 * guarantee above everything else: what a reader is given for chapter ten
 * contains nothing from chapter eleven, and that guarantee lives here — in the
 * packet builder and the sequential recipe — rather than in a prompt asking a
 * model not to peek (docs/SIMULATIONS.md).
 */

export {
  BUILT_IN_PROFILES,
  CASUAL_READER,
  CRITICAL_DEVELOPMENTAL,
  CUSTOM_PROFILES_DIR,
  EMOTION_FOCUSED,
  GENRE_EXPERT,
  loadCustomProfiles,
  parseProfile,
  profileById,
  saveCustomProfile,
} from "./profiles";
export type { LoadedProfiles } from "./profiles";

export {
  ReaderSimulator,
  buildPacket,
  checkStale,
  describeReading,
  exposureAt,
  fingerprint,
  SIMULATION_CAVEAT,
} from "./simulator";
export type { ReaderProgress, ReaderSimulatorOptions, RunOptions, Staleness } from "./simulator";

export {
  DIMENSIONS,
  attitudeSeries,
  compareReaders,
  feelingSeries,
  firstSuspected,
  plotValue,
  subjectsIn,
  suspicionOf,
} from "./series";
export type { AttitudeDimension } from "./series";

export { ReaderError } from "./types";
export type {
  ReaderAnalyst,
  ReaderErrorCode,
  ReaderPacket,
  ReaderSimulationStoreLike,
} from "./types";
