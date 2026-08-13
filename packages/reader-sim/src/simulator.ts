import { EMPTY_READER_STATE, SIMULATION_CAVEAT, orderScenes } from "@jellytind/domain";
import type {
  Chapter,
  ReaderExposure,
  ReaderProfile,
  ReaderReading,
  ReaderSimulation,
  ReaderState,
} from "@jellytind/domain";
import {
  ContextCompiler,
  renderContextPackage,
  type ContextBudget,
} from "@jellytind/context-compiler";
import type { StoryRepository } from "@jellytind/story-repository";
import {
  ReaderError,
  type ReaderAnalyst,
  type ReaderPacket,
  type ReaderSimulationStoreLike,
} from "./types";

export interface ReaderProgress {
  readonly simulation: ReaderSimulation;
  readonly chapterId: string;
  readonly position: number;
  readonly total: number;
  /** `✓ Chapter 3 — The Cellar · interest high, confusion low`. */
  readonly line: string;
}

export interface RunOptions {
  readonly onProgress?: (event: ReaderProgress) => void;
  readonly signal?: AbortSignal;
  /** Read only this far. Defaults to every chapter in the book. */
  readonly untilChapterId?: string;
  readonly budget?: ContextBudget;
}

export interface ReaderSimulatorOptions {
  readonly repo: StoryRepository;
  readonly sims: ReaderSimulationStoreLike;
  readonly analyst: ReaderAnalyst | null;
  readonly now?: () => string;
  readonly budget?: ContextBudget;
}

/**
 * A stable fingerprint of a chapter's prose.
 *
 * FNV-1a rather than a cryptographic hash: this answers "is this the same text
 * I read?", not "could someone forge this". It has to be deterministic across
 * runs and cheap enough to compute for every chapter on every staleness check.
 */
export function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${hash.toString(16).padStart(8, "0")}:${String(text.length)}`;
}

/**
 * What the project says a reader has been shown by the end of a chapter.
 *
 * Entirely deterministic, and computed from presentation order — not story
 * chronology. A flashback in chapter twelve is something the reader meets in
 * chapter twelve, whatever year it happens in.
 */
export async function exposureAt(
  repo: StoryRepository,
  chapterId: string,
): Promise<ReaderExposure> {
  const [chapters, scenes] = await Promise.all([repo.listChapters(), repo.listScenes()]);
  const ordered = [...chapters].sort((a, b) => a.order - b.order);
  const at = ordered.findIndex((chapter) => (chapter.id as string) === chapterId);
  if (at === -1) {
    throw new ReaderError("unknown_chapter", `No chapter with id ${chapterId}.`, {
      details: { chapterId },
    });
  }

  const readChapters = ordered.slice(0, at + 1);
  const readIds = new Set(readChapters.map((chapter) => chapter.id as string));
  const seen = orderScenes(scenes, chapters).filter(
    (scene) => scene.chapterId !== undefined && readIds.has(scene.chapterId as string),
  );

  let words = 0;
  for (const chapter of readChapters) {
    const raw = await repo.readProjectFile(chapter.filePath);
    words += (proseOf(raw ?? "").match(/\S+/g) ?? []).length;
  }

  const target = ordered[at] as Chapter;
  return {
    chapterId,
    chapterTitle: target.title,
    position: at + 1,
    sceneIds: seen.map((scene) => scene.id as string),
    charactersMet: [...new Set(seen.flatMap((scene) => scene.characterIds.map(String)))],
    factsOnPage: [...new Set(seen.flatMap((scene) => scene.factIds.map(String)))],
    threadsSeen: [...new Set(seen.flatMap((scene) => scene.plotThreadIds.map(String)))],
    words,
  };
}

function proseOf(raw: string): string {
  return raw
    .replace(/^---\n[\s\S]*?\n---\n?/, "")
    .replace(/^[ \t]*<!--[ \t]*scene:[^>]*-->[ \t]*$/gm, "")
    .trim();
}

/**
 * Build everything one reader gets for one chapter.
 *
 * Exported because this is the object the no-leakage guarantee is *about*: a
 * test can build a packet for chapter ten and assert that nothing from chapter
 * eleven appears anywhere in it.
 */
export async function buildPacket(
  repo: StoryRepository,
  profile: ReaderProfile,
  state: ReaderState,
  chapterId: string,
  budget?: ContextBudget,
): Promise<ReaderPacket> {
  const compiler = new ContextCompiler(repo);
  const compiled = await compiler.compile({
    recipe: "reader_sequential",
    targetId: chapterId,
    instruction: `You are reading this book one chapter at a time. You have reached ${chapterId}. You have not read past it.`,
    ...(budget === undefined ? {} : { budget }),
  });

  const chapter = (await repo.listChapters()).find((entry) => (entry.id as string) === chapterId);
  /* istanbul ignore next — exposureAt would have thrown first. */
  if (chapter === undefined) {
    throw new ReaderError("unknown_chapter", `No chapter with id ${chapterId}.`);
  }
  const raw = (await repo.readProjectFile(chapter.filePath)) ?? "";

  return {
    profile,
    state,
    pages: renderContextPackage(compiled, { includeProvenance: false }),
    exposure: await exposureAt(repo, chapterId),
    fingerprint: fingerprint(proseOf(raw)),
  };
}

/**
 * Readers who experience the manuscript in order.
 *
 * Three properties define this engine, and each is tested:
 *
 * - **No future leakage.** A reading is made from a packet, and a packet is
 *   built by the `reader_sequential` recipe, which carries prose up to the
 *   target chapter and nothing else — no records, no state, no later pages.
 * - **The reader persists.** Chapter eleven is read by the person chapter ten
 *   produced. The state carries forward; the run is not restarted per chapter.
 * - **Staleness is detectable.** Every reading records a fingerprint of the
 *   prose it was made from, so an edit to chapter four marks chapter four
 *   onward stale — and only from there.
 */
export class ReaderSimulator {
  private readonly repo: StoryRepository;
  private readonly sims: ReaderSimulationStoreLike;
  private readonly analyst: ReaderAnalyst | null;
  private readonly now: () => string;
  private readonly budget: ContextBudget | undefined;

  constructor(options: ReaderSimulatorOptions) {
    this.repo = options.repo;
    this.sims = options.sims;
    this.analyst = options.analyst;
    this.now = options.now ?? (() => new Date().toISOString());
    this.budget = options.budget;
  }

  /** Read the book from the beginning as this reader. */
  async run(profile: ReaderProfile, options: RunOptions = {}): Promise<ReaderSimulation> {
    if (this.analyst === null) {
      throw new ReaderError(
        "no_reader",
        "A reader simulation needs a model: interpretation is the whole of what it produces. Configure one and try again.",
      );
    }

    const chapterIds = await this.chapterRange(options.untilChapterId);
    const simulation: ReaderSimulation = {
      id: await this.sims.nextId(),
      profileId: profile.id,
      profileName: profile.name,
      status: "running",
      readings: [],
      chapterIds,
      startedAt: this.now(),
      modelId: this.analyst.modelId,
      rerunCount: 0,
    };
    await this.sims.save(simulation);
    return this.readOn(simulation, profile, 0, options);
  }

  /**
   * Re-read from one chapter onward, keeping everything before it.
   *
   * The point of the whole staleness apparatus: editing chapter four should
   * cost four chapters of re-reading, not twenty. The reader who resumes is the
   * one chapter three left behind.
   */
  async rerunFrom(
    simulationId: string,
    profile: ReaderProfile,
    chapterId: string,
    options: RunOptions = {},
  ): Promise<ReaderSimulation> {
    if (this.analyst === null) {
      throw new ReaderError("no_reader", "A reader simulation needs a model.");
    }
    const stored = await this.sims.get(simulationId);
    if (stored === null) {
      throw new ReaderError(
        "simulation_not_found",
        `No reader simulation with id ${simulationId}.`,
      );
    }
    const from = stored.chapterIds.indexOf(chapterId);
    if (from === -1) {
      throw new ReaderError(
        "not_rerunnable",
        `${chapterId} is not one of the chapters this reader read.`,
        { details: { chapterId } },
      );
    }

    const simulation: ReaderSimulation = {
      ...stored,
      status: "running",
      // Everything before the affected chapter stands. The reader keeps it.
      readings: stored.readings.slice(0, from),
      rerunCount: stored.rerunCount + 1,
      modelId: this.analyst.modelId,
    };
    delete (simulation as { failureReason?: string }).failureReason;
    await this.sims.save(simulation);
    return this.readOn(simulation, profile, from, options);
  }

  private async readOn(
    initial: ReaderSimulation,
    profile: ReaderProfile,
    from: number,
    options: RunOptions,
  ): Promise<ReaderSimulation> {
    let simulation = initial;
    const total = simulation.chapterIds.length;

    for (let index = from; index < total; index += 1) {
      const chapterId = simulation.chapterIds[index];
      /* istanbul ignore next — index is bounded by total. */
      if (chapterId === undefined) continue;

      if (options.signal?.aborted === true) {
        return this.finish(simulation, "cancelled", "Cancelled before this chapter was read.");
      }

      try {
        // The reader as the previous chapter left them — never a fresh one.
        const carried = simulation.readings.at(-1)?.state ?? EMPTY_READER_STATE;
        const packet = await buildPacket(
          this.repo,
          profile,
          carried,
          chapterId,
          options.budget ?? this.budget,
        );
        /* istanbul ignore next — run() and rerunFrom() both refuse a null analyst. */
        if (this.analyst === null) throw new ReaderError("no_reader", "No reader configured.");
        const read = await this.analyst.read(packet);

        const reading: ReaderReading = {
          ...read,
          chapterId,
          position: packet.exposure.position,
          exposure: packet.exposure,
          fingerprint: packet.fingerprint,
          modelId: this.analyst.modelId,
          createdAt: this.now(),
        };
        simulation = await this.sims.save({
          ...simulation,
          readings: [...simulation.readings, reading],
        });
        options.onProgress?.({
          simulation,
          chapterId,
          position: reading.position,
          total,
          line: describeReading(reading),
        });
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        // Chapters already read are kept: a failure at chapter twelve must not
        // cost the writer eleven chapters of reading.
        return this.finish(simulation, "failed", reason);
      }
    }

    return this.finish(simulation, "completed");
  }

  private async chapterRange(untilChapterId?: string): Promise<string[]> {
    const chapters = [...(await this.repo.listChapters())].sort((a, b) => a.order - b.order);
    if (chapters.length === 0) {
      throw new ReaderError("no_chapters", "This project has no chapters to read.");
    }
    const ids = chapters.map((chapter) => chapter.id as string);
    if (untilChapterId === undefined) return ids;
    const at = ids.indexOf(untilChapterId);
    if (at === -1) {
      throw new ReaderError("unknown_chapter", `No chapter with id ${untilChapterId}.`);
    }
    return ids.slice(0, at + 1);
  }

  private finish(
    simulation: ReaderSimulation,
    status: ReaderSimulation["status"],
    failureReason?: string,
  ): Promise<ReaderSimulation> {
    return this.sims.save({
      ...simulation,
      status,
      finishedAt: this.now(),
      ...(failureReason === undefined ? {} : { failureReason }),
    });
  }
}

/** The progress line one chapter shows. */
export function describeReading(reading: ReaderReading): string {
  return `✓ ${reading.exposure.chapterTitle} — interest ${reading.state.interest}, confusion ${reading.state.confusion}${
    reading.state.suspicions.length > 0
      ? `, suspects ${String(reading.state.suspicions.length)}`
      : ""
  }`;
}

export interface Staleness {
  /** The first chapter whose prose no longer matches what was read. */
  readonly staleFrom: { chapterId: string; position: number } | null;
  readonly reason: string;
  /** Readings that are still good, and can be kept. */
  readonly goodThrough: number;
}

/**
 * Which readings a change to the manuscript has invalidated.
 *
 * Only from the first changed chapter onward. A reader who read chapters one to
 * three before the writer rewrote chapter four still read chapters one to three
 * — nothing that happened afterwards can reach back and change what they knew
 * at the time.
 */
export async function checkStale(
  repo: StoryRepository,
  simulation: ReaderSimulation,
): Promise<Staleness> {
  const chapters = await repo.listChapters();
  for (const [index, reading] of simulation.readings.entries()) {
    const chapter = chapters.find((entry) => (entry.id as string) === reading.chapterId);
    if (chapter === undefined) {
      return {
        staleFrom: { chapterId: reading.chapterId, position: reading.position },
        reason: `${reading.chapterId} is no longer in the project.`,
        goodThrough: index,
      };
    }
    const current = fingerprint(proseOf((await repo.readProjectFile(chapter.filePath)) ?? ""));
    if (current !== reading.fingerprint) {
      return {
        staleFrom: { chapterId: reading.chapterId, position: reading.position },
        reason: `${chapter.title} has changed since this reader read it. Everything from there on is a reading of prose that no longer exists.`,
        goodThrough: index,
      };
    }
  }
  return {
    staleFrom: null,
    reason: "Every chapter this reader read is unchanged.",
    goodThrough: simulation.readings.length,
  };
}

export { SIMULATION_CAVEAT };
