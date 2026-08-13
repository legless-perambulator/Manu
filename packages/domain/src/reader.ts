/**
 * The vocabulary of a simulated reader.
 *
 * A reader is not a critic with the manuscript open in front of them. A reader
 * is someone who has read *this far* and no further, and whose beliefs are
 * built only out of what they have read. Everything here exists to make that
 * boundary explicit and checkable (docs/SIMULATIONS.md).
 */

export interface ReaderProfile {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** What this reader notices, tolerates and looks for, in the writer's terms. */
  readonly traits: readonly string[];
  /** Written by the writer rather than shipped with Manu. */
  readonly custom?: boolean;
}

/**
 * How strongly a reader holds something.
 *
 * A closed scale rather than a percentage: a simulated reader who is "68%
 * suspicious" of someone is a number pretending to be an instrument. Bands can
 * be charted honestly and compared across chapters, which is what the writer
 * actually needs (AGENTS.md — "measurement is not judgement").
 */
export const READER_LEVELS = ["none", "low", "moderate", "high"] as const;
export type ReaderLevel = (typeof READER_LEVELS)[number];

/** For plotting only. The chart axis is labelled with the words, not the number. */
export const LEVEL_INDEX: Readonly<Record<ReaderLevel, number>> = {
  none: 0,
  low: 1,
  moderate: 2,
  high: 3,
};

export function levelOf(value: unknown): ReaderLevel {
  return typeof value === "string" && (READER_LEVELS as readonly string[]).includes(value)
    ? (value as ReaderLevel)
    : // An unreadable level is not a strong one.
      "none";
}

/** A reader's feeling about one person, thing or idea in the book. */
export interface ReaderAttitude {
  /** Who or what: an entity ID where the reader could name one, else free text. */
  readonly subject: string;
  readonly level: ReaderLevel;
  /** Why, in the reader's own words — what in the text put it there. */
  readonly because?: string;
}

/**
 * What the reader is carrying when they turn the page.
 *
 * This is the whole point of persistence: chapter eleven is read by the person
 * chapter ten produced, not by a fresh model handed a synopsis.
 */
export interface ReaderState {
  /** Things the reader now takes to be true about the story. */
  readonly known: readonly string[];
  /** Details that stuck, whether or not they mattered. */
  readonly remembered: readonly string[];
  readonly suspicions: readonly ReaderAttitude[];
  readonly trust: readonly ReaderAttitude[];
  readonly attachment: readonly ReaderAttitude[];
  readonly predictions: readonly string[];
  readonly questions: readonly string[];
  readonly confusion: ReaderLevel;
  readonly interest: ReaderLevel;
  /** How they feel at this point, in one line. */
  readonly emotionalResponse: string;
}

export const EMPTY_READER_STATE: ReaderState = {
  known: [],
  remembered: [],
  suspicions: [],
  trust: [],
  attachment: [],
  predictions: [],
  questions: [],
  confusion: "none",
  interest: "none",
  emotionalResponse: "",
};

/**
 * What the reader was actually shown, computed with no model at all.
 *
 * The deterministic half of the simulation, and the thing the leakage
 * guarantee is anchored to: these are the chapters, scenes and people the
 * reader has met by this point. Anything a reading claims beyond this is the
 * model's inference, and is labelled as such.
 */
export interface ReaderExposure {
  readonly chapterId: string;
  readonly chapterTitle: string;
  /** 1-based position in the manuscript. */
  readonly position: number;
  readonly sceneIds: readonly string[];
  /** Characters who have appeared on the page at or before this chapter. */
  readonly charactersMet: readonly string[];
  /** Propositions the manuscript has put on the page by now. */
  readonly factsOnPage: readonly string[];
  /** Plot threads the reader has seen touched. */
  readonly threadsSeen: readonly string[];
  readonly words: number;
}

/** The ten questions, asked of every chapter. */
export const READER_QUESTIONS = [
  "What do you think is happening?",
  "Who do you trust?",
  "Who do you suspect?",
  "What do you predict?",
  "What questions remain?",
  "What confused you?",
  "What bored you?",
  "What interested you?",
  "What emotional moments landed?",
  "What details do you remember?",
] as const;

/** One chapter, read. */
export interface ReaderReading {
  readonly chapterId: string;
  readonly position: number;
  /** What is happening, as this reader understands it. */
  readonly understanding: string;
  readonly bored: readonly string[];
  readonly interested: readonly string[];
  readonly confusedBy: readonly string[];
  readonly emotionalMoments: readonly string[];
  /** The reader as they are *after* this chapter — carried into the next. */
  readonly state: ReaderState;
  /** The exposure this reading was bounded to. */
  readonly exposure: ReaderExposure;
  /**
   * A fingerprint of the prose this reading was made from. When the chapter
   * changes, the fingerprint stops matching and the reading is stale.
   */
  readonly fingerprint: string;
  readonly modelId?: string;
  readonly createdAt: string;
}

export const SIMULATION_STATUSES = ["running", "completed", "failed", "cancelled"] as const;
export type SimulationStatus = (typeof SIMULATION_STATUSES)[number];

export interface ReaderSimulation {
  readonly id: string;
  readonly profileId: string;
  readonly profileName: string;
  readonly status: SimulationStatus;
  /** Chapters read, in order. */
  readonly readings: readonly ReaderReading[];
  /** Chapters the run was asked to cover. */
  readonly chapterIds: readonly string[];
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly failureReason?: string;
  readonly modelId?: string;
  /** How many times this simulation has been re-run from a chapter. */
  readonly rerunCount: number;
}

export interface ReaderSimulationSummary {
  readonly id: string;
  readonly profileId: string;
  readonly profileName: string;
  readonly status: SimulationStatus;
  readonly chaptersRead: number;
  readonly chaptersTotal: number;
  readonly startedAt: string;
}

export function summariseSimulation(simulation: ReaderSimulation): ReaderSimulationSummary {
  return {
    id: simulation.id,
    profileId: simulation.profileId,
    profileName: simulation.profileName,
    status: simulation.status,
    chaptersRead: simulation.readings.length,
    chaptersTotal: simulation.chapterIds.length,
    startedAt: simulation.startedAt,
  };
}

/** The reader as they stand at the end of what has been read. */
export function currentState(simulation: ReaderSimulation): ReaderState {
  return simulation.readings.at(-1)?.state ?? EMPTY_READER_STATE;
}

/** The level a reader holds for one subject in one attitude list. */
export function levelFor(
  attitudes: readonly ReaderAttitude[],
  subject: string,
): ReaderLevel | null {
  return attitudes.find((entry) => entry.subject === subject)?.level ?? null;
}

/**
 * A dimension plotted across the book.
 *
 * Every series carries the caveat with it, because a chart is the easiest place
 * in the product to mistake a simulation for a measurement.
 */
export interface ReaderSeries {
  readonly label: string;
  readonly caveat: string;
  readonly points: ReadonlyArray<{
    readonly position: number;
    readonly chapterId: string;
    readonly level: ReaderLevel;
    readonly because?: string;
  }>;
}

export const SIMULATION_CAVEAT =
  "Simulated reader response — a model's reading of the manuscript, not a measurement of readers.";
