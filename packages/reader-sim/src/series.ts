import { LEVEL_INDEX, SIMULATION_CAVEAT } from "@jellytind/domain";
import type {
  ReaderAttitude,
  ReaderLevel,
  ReaderSeries,
  ReaderSimulation,
} from "@jellytind/domain";

/**
 * Turning a run of readings into something that can be drawn.
 *
 * Every series carries the caveat with it rather than leaving it to whoever
 * draws the chart. A line going up and to the right is the most persuasive
 * object in this product, and the thing it is persuading you of is a model's
 * reading of your book — not a measurement of readers (docs/SIMULATIONS.md).
 */

export const DIMENSIONS = ["suspicion", "trust", "attachment"] as const;
export type AttitudeDimension = (typeof DIMENSIONS)[number];

const LIST: Readonly<
  Record<
    AttitudeDimension,
    (reading: {
      suspicions: readonly ReaderAttitude[];
      trust: readonly ReaderAttitude[];
      attachment: readonly ReaderAttitude[];
    }) => readonly ReaderAttitude[]
  >
> = {
  suspicion: (state) => state.suspicions,
  trust: (state) => state.trust,
  attachment: (state) => state.attachment,
};

const LABEL: Readonly<Record<AttitudeDimension, string>> = {
  suspicion: "Suspicion of",
  trust: "Trust in",
  attachment: "Attachment to",
};

/**
 * One subject's line across the book.
 *
 * A chapter where the reader said nothing about this subject is **not** a zero:
 * it carries the level forward, because a reader who stops mentioning someone
 * has not stopped suspecting them. The first chapters before the subject
 * appears at all are `none`, which is true — they had not met them.
 */
export function attitudeSeries(
  simulation: ReaderSimulation,
  dimension: AttitudeDimension,
  subject: string,
  label = subject,
): ReaderSeries {
  let carried: ReaderLevel = "none";
  let because: string | undefined;

  return {
    label: `${LABEL[dimension]} ${label}`,
    caveat: SIMULATION_CAVEAT,
    points: simulation.readings.map((reading) => {
      const found = LIST[dimension](reading.state).find((entry) => entry.subject === subject);
      if (found !== undefined) {
        carried = found.level;
        because = found.because;
      }
      return {
        position: reading.position,
        chapterId: reading.chapterId,
        level: carried,
        ...(because === undefined ? {} : { because }),
      };
    }),
  };
}

/** Interest or confusion across the book — stated for every chapter. */
export function feelingSeries(
  simulation: ReaderSimulation,
  which: "interest" | "confusion",
): ReaderSeries {
  return {
    label: which === "interest" ? "Interest" : "Confusion",
    caveat: SIMULATION_CAVEAT,
    points: simulation.readings.map((reading) => ({
      position: reading.position,
      chapterId: reading.chapterId,
      level: reading.state[which],
    })),
  };
}

/** Every subject this reader ever held an attitude about, for offering charts. */
export function subjectsIn(simulation: ReaderSimulation, dimension: AttitudeDimension): string[] {
  const seen = new Set<string>();
  for (const reading of simulation.readings) {
    for (const entry of LIST[dimension](reading.state)) seen.add(entry.subject);
  }
  return [...seen].sort();
}

/** The plotting value for a level. The axis is labelled with words, not numbers. */
export function plotValue(level: ReaderLevel): number {
  return LEVEL_INDEX[level];
}

/**
 * The seam the Mystery Engine will consume.
 *
 * A mystery is working when the reader suspects the right person at the right
 * time and not before. That question is exactly "what is this reader's
 * suspicion of X at chapter N?", which is this series — so when the Mystery
 * Engine arrives it reads reader simulations rather than growing its own.
 */
export function suspicionOf(simulation: ReaderSimulation, characterId: string): ReaderSeries {
  return attitudeSeries(simulation, "suspicion", characterId);
}

/** Where a reader's suspicion of someone first becomes more than passing. */
export function firstSuspected(
  simulation: ReaderSimulation,
  characterId: string,
  atLeast: ReaderLevel = "moderate",
): { chapterId: string; position: number } | null {
  const threshold = LEVEL_INDEX[atLeast];
  const hit = suspicionOf(simulation, characterId).points.find(
    (point) => LEVEL_INDEX[point.level] >= threshold,
  );
  return hit === undefined ? null : { chapterId: hit.chapterId, position: hit.position };
}

/**
 * Where two readers of the same book diverge.
 *
 * The reason multiple profiles exist: a genre expert suspecting someone in
 * chapter four while a casual reader is still fond of them is not a
 * contradiction, it is the finding.
 */
export function compareReaders(
  a: ReaderSimulation,
  b: ReaderSimulation,
  dimension: AttitudeDimension,
  subject: string,
): Array<{ position: number; chapterId: string; a: ReaderLevel; b: ReaderLevel }> {
  const left = attitudeSeries(a, dimension, subject).points;
  const right = attitudeSeries(b, dimension, subject).points;
  const out: Array<{ position: number; chapterId: string; a: ReaderLevel; b: ReaderLevel }> = [];
  for (const point of left) {
    const other = right.find((entry) => entry.chapterId === point.chapterId);
    if (other === undefined) continue;
    if (point.level === other.level) continue;
    out.push({
      position: point.position,
      chapterId: point.chapterId,
      a: point.level,
      b: other.level,
    });
  }
  return out;
}
