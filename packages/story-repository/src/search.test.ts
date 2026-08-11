import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { StoryRepository } from "./story-repository";

async function freshRepo() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "Search Novel" });
  return { store, repo };
}

describe("full-text search", () => {
  it("finds a phrase in manuscript prose with its location", async () => {
    const { repo } = await freshRepo();
    await repo.writeProjectFile("manuscript/opening.md", "Elias found the brass key on the table.");
    const hits = await repo.searchText({ text: '"brass key"' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.meta.kind).toBe("prose");
    expect(hits[0]?.meta.path).toBe("manuscript/opening.md");
    expect(hits[0]?.excerpt).toContain("brass key");
  });

  it("searches structured entity content (character description)", async () => {
    const { repo } = await freshRepo();
    await repo.addCharacter({ name: "Mara", description: "a quiet spy who watches" });
    const hits = await repo.searchText({ text: "spy" });
    expect(hits.some((h) => h.meta.kind === "character")).toBe(true);
    expect(hits[0]?.meta.entityId).toBe("CHAR_0001");
  });

  it("requires all terms and supports result-kind filters", async () => {
    const { repo } = await freshRepo();
    await repo.addCharacter({ name: "Mara" });
    await repo.writeProjectFile("manuscript/ch1.md", "Mara crossed the hall.");
    // Unfiltered: both the character entity and the prose mention Mara.
    const all = await repo.searchText({ text: "mara" });
    expect(all.length).toBeGreaterThanOrEqual(2);
    // Filtered to characters only.
    const chars = await repo.searchText({ text: "mara", filters: { kinds: ["character"] } });
    expect(chars.every((h) => h.meta.kind === "character")).toBe(true);
  });

  it("handles special characters in prose and query", async () => {
    const { repo } = await freshRepo();
    await repo.writeProjectFile("notes/a.md", "The café's brass-key — O'Brien's — was gone.");
    expect(await repo.searchText({ text: "café" })).toHaveLength(1);
    expect((await repo.searchText({ text: "brass key" }))[0]?.meta.path).toBe("notes/a.md");
  });
});

describe("structured search", () => {
  async function seed() {
    const { repo } = await freshRepo();
    const elias = await repo.addCharacter({ name: "Elias" });
    const mara = await repo.addCharacter({ name: "Mara" });
    const manor = await repo.addLocation({ name: "Blackthorn Manor" });
    const key = await repo.addObject({ name: "Brass Key" });
    const thread = await repo.addPlotThread({ name: "Missing photograph" });
    const ch1 = await repo.addChapter({ title: "One" });
    const ch2 = await repo.addChapter({ title: "Two" });
    const s1 = await repo.addScene({
      title: "Arrival",
      chapterId: ch1.id,
      pov: elias.id,
      locationId: manor.id,
      characterIds: [elias.id, mara.id],
      plotThreadIds: [thread.id],
      objectIds: [key.id],
    });
    const s2 = await repo.addScene({
      title: "Elsewhere",
      chapterId: ch2.id,
      characterIds: [elias.id],
    });
    return { repo, elias, mara, manor, key, thread, ch1, ch2, s1, s2 };
  }

  it("getScenesByCharacter / POV", async () => {
    const { repo, elias, mara, s1, s2 } = await seed();
    expect((await repo.getScenesByCharacter(elias.id)).map((s) => s.id).sort()).toEqual(
      [s1.id, s2.id].sort(),
    );
    expect((await repo.getScenesByCharacter(mara.id)).map((s) => s.id)).toEqual([s1.id]);
    expect((await repo.getScenesByPOV(elias.id)).map((s) => s.id)).toEqual([s1.id]);
  });

  it("getScenesByLocation / Object / PlotThread", async () => {
    const { repo, manor, key, thread, s1 } = await seed();
    expect((await repo.getScenesByLocation(manor.id)).map((s) => s.id)).toEqual([s1.id]);
    expect((await repo.getObjectAppearances(key.id)).map((s) => s.id)).toEqual([s1.id]);
    expect((await repo.getScenesByPlotThread(thread.id)).map((s) => s.id)).toEqual([s1.id]);
  });

  it("getScenesBetweenChapters", async () => {
    const { repo, ch1, ch2, s1, s2 } = await seed();
    expect((await repo.getScenesBetweenChapters(ch1.id, ch2.id)).map((s) => s.id).sort()).toEqual(
      [s1.id, s2.id].sort(),
    );
    expect((await repo.getScenesBetweenChapters(ch1.id, ch1.id)).map((s) => s.id)).toEqual([s1.id]);
  });

  it("getCharacterAppearances includes scenes and events", async () => {
    const { repo, elias, s1, s2 } = await seed();
    await repo.addEvent({ name: "The vanishing", characterIds: [elias.id] });
    const app = await repo.getCharacterAppearances(elias.id);
    expect(app.scenes.map((s) => s.id).sort()).toEqual([s1.id, s2.id].sort());
    expect(app.events).toHaveLength(1);
  });
});

describe("incremental index updates", () => {
  it("reflects entities created after the index is built", async () => {
    const { repo } = await freshRepo();
    await repo.searchText({ text: "anything" }); // build the index
    await repo.addCharacter({ name: "Zephyrine", description: "an unusual name" });
    expect(await repo.searchText({ text: "zephyrine" })).toHaveLength(1);
  });

  it("reflects file edits after the index is built", async () => {
    const { repo } = await freshRepo();
    await repo.searchText({ text: "anything" });
    await repo.writeProjectFile("notes/x.md", "quicksilver moment");
    expect(await repo.searchText({ text: "quicksilver" })).toHaveLength(1);
  });

  it("removes deleted entities from the index", async () => {
    const { repo } = await freshRepo();
    const obj = await repo.addObject({ name: "Astrolabe", description: "brass instrument" });
    expect(await repo.searchText({ text: "astrolabe" })).toHaveLength(1);
    await repo.deleteEntity(obj.id);
    expect(await repo.searchText({ text: "astrolabe" })).toHaveLength(0);
  });
});

describe("persistence and scale", () => {
  it("rebuilds the index after reopening", async () => {
    const { store, repo } = await freshRepo();
    await repo.writeProjectFile("manuscript/ch1.md", "the pomegranate seed fell");
    await repo.addCharacter({ name: "Ysolde" });

    const reopened = await StoryRepository.openProject({ store });
    expect((await reopened.searchText({ text: "pomegranate" }))[0]?.meta.kind).toBe("prose");
    expect(await reopened.searchText({ text: "ysolde" })).toHaveLength(1);
  });

  it("searches a large amount of sample prose", async () => {
    const { repo } = await freshRepo();
    const filler = "grey mist hung over the moor and the wind did not stop ".repeat(200);
    for (let i = 0; i < 60; i++) {
      const text = i === 42 ? `${filler} the brass key turned in the lock` : filler;
      await repo.writeProjectFile(`manuscript/ch_${i}.md`, text);
    }
    const hits = await repo.searchText({ text: '"brass key"' });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.meta.path).toBe("manuscript/ch_42.md");
  });
});
