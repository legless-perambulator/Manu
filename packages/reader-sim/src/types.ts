import { AppError } from "@jellytind/shared";
import type {
  ReaderExposure,
  ReaderProfile,
  ReaderReading,
  ReaderSimulation,
  ReaderSimulationSummary,
  ReaderState,
} from "@jellytind/domain";

export type ReaderErrorCode =
  | "unknown_profile"
  | "invalid_profile"
  | "no_chapters"
  | "unknown_chapter"
  | "simulation_not_found"
  | "not_rerunnable"
  | "invalid_reading"
  | "no_reader";

export class ReaderError extends AppError {
  constructor(
    code: ReaderErrorCode,
    message: string,
    options?: { cause?: unknown; details?: Record<string, unknown> },
  ) {
    super(code, message, options);
  }
}

/**
 * Everything one reader is given for one chapter — and nothing else.
 *
 * This is the object the leakage guarantee is about. It is assembled by the
 * simulator, from the sequential recipe and the reader's own carried state, and
 * it is what a test can hold up and check for words from later chapters
 * (docs/SIMULATIONS.md).
 */
export interface ReaderPacket {
  readonly profile: ReaderProfile;
  /** The reader as chapter N−1 left them. */
  readonly state: ReaderState;
  /** The pages, compiled by the `reader_sequential` recipe. */
  readonly pages: string;
  /** What the project says this reader has been exposed to. Deterministic. */
  readonly exposure: ReaderExposure;
  /** A fingerprint of this chapter's prose, for staleness. */
  readonly fingerprint: string;
}

/**
 * The interpreting half, as a port.
 *
 * The simulator holds no provider knowledge: it builds the packet and asks for
 * a reading of it. An implementation above (`@jellytind/editing`) does the
 * model call. With no reader, a simulation refuses to start rather than
 * producing an empty interpretation — a reader who has read nothing has no
 * opinion, and inventing one would be the failure this feature exists to avoid.
 */
export interface ReaderAnalyst {
  readonly modelId: string;
  read(
    packet: ReaderPacket,
  ): Promise<Omit<ReaderReading, "exposure" | "fingerprint" | "createdAt">>;
}

/** Persistence, satisfied structurally by `repo.readerSims`. */
export interface ReaderSimulationStoreLike {
  nextId(): Promise<string>;
  get(id: string): Promise<ReaderSimulation | null>;
  save(simulation: ReaderSimulation): Promise<ReaderSimulation>;
  list(limit?: number): Promise<ReaderSimulationSummary[]>;
}
