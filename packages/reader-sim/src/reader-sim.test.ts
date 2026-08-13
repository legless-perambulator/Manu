import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { StoryRepository } from "@jellytind/story-repository";
import { EMPTY_READER_STATE, currentState } from "@jellytind/domain";
import type { ReaderReading } from "@jellytind/domain";
import { BUILT_IN_PROFILES, GENRE_EXPERT, parseProfile, profileById } from "./profiles";
import {
  attitudeSeries,
  compareReaders,
  feelingSeries,
  firstSuspected,
  subjectsIn,
} from "./series";
import { ReaderSimulator, buildPacket, checkStale, exposureAt, fingerprint } from "./simulator";
import { ReaderError, type ReaderAnalyst, type ReaderPacket } from "./types";

/**
 * A twenty-chapter book, each chapter carrying a token unique to it.
 *
 * The tokens are the leakage test: if `CHAPTERWORD11` ever appears in what a
 * reader is given for chapter ten, the guarantee this whole feature rests on
 * has failed, and it fails visibly.
 */
async function novel(chapterCount = 20) {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "The Cellar Door" });

  const mara = await repo.addCharacter({ name: "Mara" });
  const elias = await repo.addCharacter({ name: "Elias" });
  const thread = await repo.addPlotThread({ name: "The brass key" });
  const fact = await repo.addFact({
    statement: "Elias sealed the vault",
    // The author knows. The reader must not be told.
    objectiveTruth: true,
  });

  const chapters = [];
  for (let index = 1; index <= chapterCount; index += 1) {
    const chapter = await repo.addChapter({ title: `Chapter ${String(index)}` });
    await repo.addScene({
      title: `Scene ${String(index)}`,
      chapterId: chapter.id,
      pov: mara.id,
      characterIds: index % 2 === 0 ? [mara.id, elias.id] : [mara.id],
      plotThreadIds: [thread.id],
      factIds: index >= 18 ? [fact.id] : [],
      purpose: [`advance to ${String(index)}`],
    });
    await repo.writeProjectFile(
      chapter.filePath,
      `---\nid: ${chapter.id}\ntitle: ${chapter.title}\n---\n\n` +
        `CHAPTERWORD${String(index)}. The cellar door was ${index % 2 === 0 ? "open" : "shut"}, ` +
        `and Mara counted the stairs again while she thought about it.\n`,
    );
    chapters.push(chapter);
  }
  return { repo, store, chapters, mara, elias, thread, fact };
}

/**
 * A scripted reader.
 *
 * The engine is what is under test, so the reader is deterministic: it grows
 * more suspicious of Elias as it reads, which is exactly the shape a chart has
 * to be able to draw.
 */
function scriptedReader(
  onRead?: (packet: ReaderPacket) => void,
  fail?: (position: number) => Error | null,
): ReaderAnalyst {
  return {
    modelId: "scripted-reader",
    read(packet) {
      onRead?.(packet);
      const boom = fail?.(packet.exposure.position);
      if (boom !== null && boom !== undefined) return Promise.reject(boom);

      const position = packet.exposure.position;
      const level =
        position >= 12 ? "high" : position >= 6 ? "moderate" : position >= 3 ? "low" : "none";
      const reading: Omit<ReaderReading, "exposure" | "fingerprint" | "createdAt"> = {
        chapterId: packet.exposure.chapterId,
        position,
        understanding: `Something is wrong in the cellar (after chapter ${String(position)}).`,
        bored: position === 7 ? ["the middle of this one"] : [],
        interested: ["the stairs"],
        confusedBy: position === 4 ? ["who was on the stair"] : [],
        emotionalMoments: [],
        state: {
          // The carried state is proof the reader is not being restarted.
          known: [...packet.state.known, `read chapter ${String(position)}`],
          remembered: [`CHAPTERWORD${String(position)}`],
          suspicions: [{ subject: "CHAR_0002", level, because: "he is never in the room" }],
          trust: [{ subject: "CHAR_0001", level: position >= 10 ? "moderate" : "high" }],
          attachment: [{ subject: "CHAR_0001", level: "moderate" }],
          predictions: [`chapter ${String(position + 1)} goes badly`],
          questions: ["who sealed it?"],
          confusion: position === 4 ? "moderate" : "low",
          interest: position === 7 ? "low" : "high",
          emotionalResponse: "uneasy",
        },
      };
      return Promise.resolve(reading);
    },
  };
}

const simulatorFor = (repo: StoryRepository, analyst: ReaderAnalyst | null = scriptedReader()) =>
  new ReaderSimulator({ repo, sims: repo.readerSims, analyst });

// ── The guarantee ───────────────────────────────────────────────────────────

describe("no future leakage", () => {
  it("gives a reader at chapter ten not one word from chapter eleven onward", async () => {
    const { repo, chapters } = await novel();
    const tenth = chapters[9];
    if (tenth === undefined) throw new Error("fixture");

    const packet = await buildPacket(repo, GENRE_EXPERT, EMPTY_READER_STATE, tenth.id);

    for (let later = 11; later <= 20; later += 1) {
      expect(packet.pages).not.toContain(`CHAPTERWORD${String(later)}`);
    }
    // And it does contain what they have read.
    expect(packet.pages).toContain("CHAPTERWORD10");
    expect(packet.pages).toContain("CHAPTERWORD1.");
  });

  it("never mentions a later chapter even by title or summary", async () => {
    const { repo, chapters } = await novel();
    const tenth = chapters[9];
    if (tenth === undefined) throw new Error("fixture");
    const packet = await buildPacket(repo, GENRE_EXPERT, EMPTY_READER_STATE, tenth.id);

    for (const later of chapters.slice(10)) {
      expect(packet.pages).not.toContain(later.id as string);
      expect(packet.pages).not.toContain(later.title);
    }
  });

  it("hands the reader no records at all — not the story bible", async () => {
    const { repo, chapters } = await novel();
    const first = chapters[0];
    if (first === undefined) throw new Error("fixture");
    const packet = await buildPacket(repo, GENRE_EXPERT, EMPTY_READER_STATE, first.id);

    // The fact that would give the mystery away is recorded in the project and
    // must not reach a reader who has not read it on the page.
    expect(packet.pages).not.toContain("Elias sealed the vault");
    expect(packet.pages).not.toContain("The brass key");
    expect(packet.pages).not.toMatch(/CHAR_000\d/);
  });

  it("bounds the deterministic exposure to the same place", async () => {
    const { repo, chapters, mara, elias } = await novel();
    const first = await exposureAt(repo, (chapters[0] as { id: string }).id);
    const second = await exposureAt(repo, (chapters[1] as { id: string }).id);
    const late = await exposureAt(repo, (chapters[19] as { id: string }).id);

    expect(first.position).toBe(1);
    expect(first.sceneIds).toHaveLength(1);
    // Elias first appears in chapter two, so a reader of chapter one has not met him.
    expect(first.charactersMet).toEqual([mara.id]);
    expect(second.charactersMet).toContain(elias.id);
    // The fact is only on the page from chapter eighteen.
    expect(first.factsOnPage).toEqual([]);
    expect(late.factsOnPage).toHaveLength(1);
    expect(late.sceneIds).toHaveLength(20);
  });
});

// ── The acceptance scenario ─────────────────────────────────────────────────

describe("reading a book of twenty chapters", () => {
  it("produces an evolving, persistent interpretation", async () => {
    const { repo } = await novel();
    const seen: number[] = [];
    const lines: string[] = [];
    const simulation = await simulatorFor(repo).run(GENRE_EXPERT, {
      onProgress: (event) => {
        seen.push(event.position);
        lines.push(event.line);
      },
    });

    expect(simulation.status).toBe("completed");
    expect(simulation.readings).toHaveLength(20);
    expect(seen).toEqual(Array.from({ length: 20 }, (_, index) => index + 1));

    // Persistent: the reader accumulates rather than restarting each chapter.
    expect(currentState(simulation).known).toHaveLength(20);
    expect(simulation.readings[0]?.state.known).toEqual(["read chapter 1"]);

    // Evolving: suspicion moves as the book goes on.
    expect(simulation.readings[1]?.state.suspicions[0]?.level).toBe("none");
    expect(simulation.readings[7]?.state.suspicions[0]?.level).toBe("moderate");
    expect(currentState(simulation).suspicions[0]?.level).toBe("high");

    expect(lines[0]).toMatch(/^✓ Chapter 1 — interest high/);
  });

  it("carries the previous chapter's state into the next reading", async () => {
    const { repo } = await novel(4);
    const carried: number[] = [];
    const analyst = scriptedReader((packet) => carried.push(packet.state.known.length));
    await simulatorFor(repo, analyst).run(GENRE_EXPERT);

    // Chapter one starts from nothing; each later chapter is handed what the
    // one before it produced.
    expect(carried).toEqual([0, 1, 2, 3]);
  });

  it("stops at the chapter asked for", async () => {
    const { repo, chapters } = await novel();
    const simulation = await simulatorFor(repo).run(GENRE_EXPERT, {
      untilChapterId: (chapters[4] as { id: string }).id,
    });
    expect(simulation.readings).toHaveLength(5);
    expect(simulation.chapterIds).toHaveLength(5);
  });

  it("refuses to start with no model rather than inventing a reader", async () => {
    const { repo } = await novel(2);
    await expect(simulatorFor(repo, null).run(GENRE_EXPERT)).rejects.toThrowError(/needs a model/);
  });

  it("keeps the chapters already read when one fails", async () => {
    const { repo } = await novel(10);
    const analyst = scriptedReader(undefined, (position) =>
      position === 6 ? new Error("the provider hung up") : null,
    );
    const simulation = await simulatorFor(repo, analyst).run(GENRE_EXPERT);

    expect(simulation.status).toBe("failed");
    expect(simulation.failureReason).toMatch(/hung up/);
    expect(simulation.readings).toHaveLength(5);
  });
});

// ── Staleness and re-running ────────────────────────────────────────────────

describe("when the manuscript changes underneath a reader", () => {
  it("says nothing is stale while the prose is unchanged", async () => {
    const { repo } = await novel(6);
    const simulation = await simulatorFor(repo).run(GENRE_EXPERT);
    const stale = await checkStale(repo, simulation);

    expect(stale.staleFrom).toBeNull();
    expect(stale.goodThrough).toBe(6);
  });

  it("marks the changed chapter onward, and only from there", async () => {
    const { repo, chapters } = await novel(8);
    const simulation = await simulatorFor(repo).run(GENRE_EXPERT);

    const fourth = chapters[3];
    if (fourth === undefined) throw new Error("fixture");
    await repo.writeProjectFile(
      fourth.filePath,
      `---\nid: ${fourth.id}\ntitle: ${fourth.title}\n---\n\nCHAPTERWORD4. Rewritten entirely.\n`,
    );

    const stale = await checkStale(repo, simulation);
    expect(stale.staleFrom?.position).toBe(4);
    expect(stale.goodThrough).toBe(3);
    expect(stale.reason).toMatch(/has changed since this reader read it/);
  });

  it("re-runs from the affected chapter, keeping the reading before it", async () => {
    const { repo, chapters } = await novel(8);
    const simulation = await simulatorFor(repo).run(GENRE_EXPERT);
    const fourth = chapters[3];
    if (fourth === undefined) throw new Error("fixture");

    await repo.writeProjectFile(
      fourth.filePath,
      `---\nid: ${fourth.id}\ntitle: ${fourth.title}\n---\n\nCHAPTERWORD4. Rewritten entirely.\n`,
    );

    const reread: number[] = [];
    const analyst = scriptedReader((packet) => reread.push(packet.exposure.position));
    const again = await simulatorFor(repo, analyst).rerunFrom(
      simulation.id,
      GENRE_EXPERT,
      fourth.id,
    );

    // Chapters one to three were not read again.
    expect(reread).toEqual([4, 5, 6, 7, 8]);
    expect(again.status).toBe("completed");
    expect(again.readings).toHaveLength(8);
    expect(again.rerunCount).toBe(1);
    // The kept readings are the originals, untouched.
    expect(again.readings[0]?.createdAt).toBe(simulation.readings[0]?.createdAt);
    expect(await checkStale(repo, again)).toMatchObject({ staleFrom: null });
  });

  it("resumes the reader who finished chapter three, not a fresh one", async () => {
    const { repo, chapters } = await novel(6);
    const simulation = await simulatorFor(repo).run(GENRE_EXPERT);
    const fourth = chapters[3];
    if (fourth === undefined) throw new Error("fixture");

    const carried: number[] = [];
    const analyst = scriptedReader((packet) => carried.push(packet.state.known.length));
    await simulatorFor(repo, analyst).rerunFrom(simulation.id, GENRE_EXPERT, fourth.id);

    // Three chapters' worth of accumulated belief went into the re-read.
    expect(carried[0]).toBe(3);
  });

  it("survives a restart, because the run is on disk", async () => {
    const { repo, store, chapters } = await novel(5);
    const simulation = await simulatorFor(repo).run(GENRE_EXPERT);

    const reopened = await StoryRepository.openProject({ store });
    const stored = await reopened.readerSims.get(simulation.id);
    expect(stored?.readings).toHaveLength(5);

    const again = await simulatorFor(reopened).rerunFrom(
      simulation.id,
      GENRE_EXPERT,
      (chapters[2] as { id: string }).id,
    );
    expect(again.readings).toHaveLength(5);
  });

  it("refuses to re-run from a chapter this reader never read", async () => {
    const { repo } = await novel(4);
    const simulation = await simulatorFor(repo).run(GENRE_EXPERT, {
      untilChapterId: "CHAPTER_0002",
    });
    await expect(
      simulatorFor(repo).rerunFrom(simulation.id, GENRE_EXPERT, "CHAPTER_0004"),
    ).rejects.toThrowError(/not one of the chapters this reader read/);
  });

  it("fingerprints prose rather than the file, so frontmatter is not content", () => {
    expect(fingerprint("the same words")).toBe(fingerprint("the same words"));
    expect(fingerprint("the same words")).not.toBe(fingerprint("the same word"));
  });
});

// ── Several readers ─────────────────────────────────────────────────────────

describe("more than one reader", () => {
  it("reads the same manuscript as different people, and keeps them apart", async () => {
    const { repo } = await novel(6);
    const expert = await simulatorFor(repo).run(profileById("genre_expert"));
    const casual = await simulatorFor(repo).run(profileById("casual_reader"));

    expect(expert.id).not.toBe(casual.id);
    expect(casual.profileName).toBe("Casual Reader");
    expect((await repo.readerSims.list()).map((entry) => entry.profileId)).toEqual([
      "casual_reader",
      "genre_expert",
    ]);
  });

  it("ships four readers, each with traits that differ", () => {
    expect(BUILT_IN_PROFILES).toHaveLength(4);
    expect(new Set(BUILT_IN_PROFILES.map((profile) => profile.id)).size).toBe(4);
    for (const profile of BUILT_IN_PROFILES) {
      expect(profile.traits.length).toBeGreaterThan(2);
    }
  });

  it("accepts a reader the writer wrote, and refuses one with no traits", () => {
    const mine = parseProfile(
      JSON.stringify({ id: "my_sister", name: "My sister", traits: ["skims description"] }),
      "mine.json",
    );
    expect(mine.custom).toBe(true);
    expect(() =>
      parseProfile(JSON.stringify({ id: "x", name: "X", traits: [] }), "x.json"),
    ).toThrowError(/traits are what makes this reader different/);
    expect(() =>
      parseProfile(JSON.stringify({ id: "genre_expert", name: "X", traits: ["a"] }), "x.json"),
    ).toThrowError(/is the id of a reader Manu ships with/);
  });
});

// ── Charts ──────────────────────────────────────────────────────────────────

describe("plotting a reader over the book", () => {
  it("draws suspicion across chapters, with the caveat attached", async () => {
    const { repo } = await novel(14);
    const simulation = await simulatorFor(repo).run(GENRE_EXPERT);
    const series = attitudeSeries(simulation, "suspicion", "CHAR_0002", "Elias");

    expect(series.label).toBe("Suspicion of Elias");
    expect(series.caveat).toMatch(/not a measurement of readers/);
    expect(series.points).toHaveLength(14);
    expect(series.points[0]?.level).toBe("none");
    expect(series.points[7]?.level).toBe("moderate");
    expect(series.points.at(-1)?.level).toBe("high");
  });

  it("carries a level forward through chapters the reader did not mention it", async () => {
    const { repo } = await novel(4);
    const analyst: ReaderAnalyst = {
      modelId: "quiet",
      read(packet) {
        const position = packet.exposure.position;
        return Promise.resolve({
          chapterId: packet.exposure.chapterId,
          position,
          understanding: "…",
          bored: [],
          interested: [],
          confusedBy: [],
          emotionalMoments: [],
          state: {
            ...EMPTY_READER_STATE,
            // Mentioned once, in chapter two, and never again.
            suspicions: position === 2 ? [{ subject: "CHAR_0002", level: "high" }] : [],
          },
        });
      },
    };
    const simulation = await simulatorFor(repo, analyst).run(GENRE_EXPERT);
    const points = attitudeSeries(simulation, "suspicion", "CHAR_0002").points;

    expect(points.map((point) => point.level)).toEqual(["none", "high", "high", "high"]);
  });

  it("plots interest and confusion for every chapter", async () => {
    const { repo } = await novel(8);
    const simulation = await simulatorFor(repo).run(GENRE_EXPERT);

    expect(feelingSeries(simulation, "interest").points[6]?.level).toBe("low");
    expect(feelingSeries(simulation, "confusion").points[3]?.level).toBe("moderate");
    expect(feelingSeries(simulation, "confusion").label).toBe("Confusion");
  });

  it("offers the subjects a reader actually held an opinion about", async () => {
    const { repo } = await novel(3);
    const simulation = await simulatorFor(repo).run(GENRE_EXPERT);
    expect(subjectsIn(simulation, "suspicion")).toEqual(["CHAR_0002"]);
    expect(subjectsIn(simulation, "trust")).toEqual(["CHAR_0001"]);
  });

  it("answers the question the Mystery Engine will ask", async () => {
    const { repo } = await novel(14);
    const simulation = await simulatorFor(repo).run(GENRE_EXPERT);
    expect(firstSuspected(simulation, "CHAR_0002")).toMatchObject({ position: 6 });
    expect(firstSuspected(simulation, "CHAR_0002", "high")).toMatchObject({ position: 12 });
    expect(firstSuspected(simulation, "CHAR_0001")).toBeNull();
  });

  it("finds where two readers diverge", async () => {
    const { repo } = await novel(6);
    const expert = await simulatorFor(repo).run(GENRE_EXPERT);
    const slower: ReaderAnalyst = {
      modelId: "slower",
      read(packet) {
        return Promise.resolve({
          chapterId: packet.exposure.chapterId,
          position: packet.exposure.position,
          understanding: "…",
          bored: [],
          interested: [],
          confusedBy: [],
          emotionalMoments: [],
          state: { ...EMPTY_READER_STATE, suspicions: [{ subject: "CHAR_0002", level: "none" }] },
        });
      },
    };
    const casual = await simulatorFor(repo, slower).run(profileById("casual_reader"));

    const divergence = compareReaders(expert, casual, "suspicion", "CHAR_0002");
    // They agree until the expert starts suspecting in chapter three.
    expect(divergence.map((entry) => entry.position)).toEqual([3, 4, 5, 6]);
    expect(divergence[0]).toMatchObject({ a: "low", b: "none" });
  });
});

// ── Errors ──────────────────────────────────────────────────────────────────

describe("errors", () => {
  it("carries a machine-readable code", () => {
    expect(new ReaderError("no_chapters", "nope").code).toBe("no_chapters");
  });

  it("refuses to read a project with no chapters", async () => {
    const store = new InMemoryProjectStore();
    const repo = await StoryRepository.createProject({ store, title: "Empty" });
    await expect(simulatorFor(repo).run(GENRE_EXPERT)).rejects.toThrowError(/no chapters to read/);
  });
});
