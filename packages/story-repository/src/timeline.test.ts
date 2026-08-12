import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { StoryRepository } from "./story-repository";
import { RepositoryError } from "./errors";

/**
 * A nonlinear novel. The manuscript runs SC1 → SC2 → SC3 → SC4; the story world
 * runs SC3 (a flashback two years earlier) → SC1 → SC2 → SC4. This is the shape
 * the whole subsystem exists for: chapter order is not chronological truth.
 */
async function nonlinearNovel() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "Blackthorn" });

  const elias = await repo.addCharacter({ name: "Elias", role: "protagonist" });
  const mara = await repo.addCharacter({ name: "Mara", role: "foil" });
  const london = await repo.addLocation({ name: "London" });
  const edinburgh = await repo.addLocation({ name: "Edinburgh" });
  const manor = await repo.addLocation({ name: "Blackthorn Manor" });
  const chapter = await repo.addChapter({ title: "Openings" });

  const s1 = await repo.addScene({
    title: "The summons",
    chapterId: chapter.id,
    pov: elias.id,
    locationId: london.id,
    storyTime: { kind: "exact", instant: "2019-03-04T09:00:00Z" },
  });
  const s2 = await repo.addScene({
    title: "The journey",
    chapterId: chapter.id,
    pov: elias.id,
    storyTime: { kind: "exact", instant: "2019-03-04T18:00:00Z" },
  });
  const s3 = await repo.addScene({
    title: "Two years earlier",
    chapterId: chapter.id,
    pov: elias.id,
    locationId: manor.id,
    characterIds: [elias.id, mara.id],
    storyTime: { kind: "exact", instant: "2017-06-01T12:00:00Z" },
  });
  const s4 = await repo.addScene({
    title: "The vault",
    chapterId: chapter.id,
    pov: mara.id,
    locationId: edinburgh.id,
    storyTime: { kind: "exact", instant: "2019-03-05T09:00:00Z" },
  });

  await repo.addStateTransitions([
    { sceneId: s3.id, kind: "character_location", subjectId: elias.id, value: manor.id },
    { sceneId: s1.id, kind: "character_location", subjectId: elias.id, value: london.id },
    { sceneId: s4.id, kind: "character_location", subjectId: elias.id, value: edinburgh.id },
  ]);

  return { repo, elias, mara, london, edinburgh, manor, chapter, s1, s2, s3, s4 };
}

describe("story chronology", () => {
  it("orders scenes by story time, not by manuscript position", async () => {
    const { repo, s1, s2, s3, s4 } = await nonlinearNovel();
    const chronology = await repo.getStoryChronology();

    expect(chronology.presentationOrder().map((n) => n.id)).toEqual([s1.id, s2.id, s3.id, s4.id]);
    expect(chronology.chronologicalSceneOrder()).toEqual([s3.id, s1.id, s2.id, s4.id]);
    expect(chronology.isFlashback(s3.id)).toBe(true);
  });

  it("places an off-page event that predates the manuscript", async () => {
    const { repo, elias, manor, s3 } = await nonlinearNovel();
    const fire = await repo.addEvent({
      name: "The fire",
      storyTime: { kind: "exact", instant: "1997-08-14T22:00:00Z" },
      locationId: manor.id,
      characterIds: [elias.id],
    });

    const chronology = await repo.getStoryChronology();
    expect(chronology.chronologicalOrder()[0]?.id).toBe(fire.id);
    expect(chronology.node(fire.id).presentationIndex).toBeUndefined();
    expect(chronology.chronologicalIndexOf(fire.id)).toBeLessThan(
      chronology.chronologicalIndexOf(s3.id),
    );
  });

  it("interprets a legacy free-form story time rather than discarding it", async () => {
    const store = new InMemoryProjectStore();
    const repo = await StoryRepository.createProject({ store, title: "Legacy" });
    const event = await repo.addEvent({ name: "The fire", storyTime: "Day 3, evening" });
    expect(event.storyTime).toEqual({ kind: "ordinal", label: "Day 3, evening" });

    const dated = await repo.addEvent({ name: "The verdict", storyTime: "1997-08-14" });
    expect(dated.storyTime).toEqual({ kind: "date", date: "1997-08-14" });
  });

  it("orders undated scenes by authored relations alone", async () => {
    const store = new InMemoryProjectStore();
    const repo = await StoryRepository.createProject({ store, title: "Undated" });
    const chapter = await repo.addChapter({ title: "One" });
    const a = await repo.addScene({ title: "A", chapterId: chapter.id });
    const b = await repo.addScene({ title: "B", chapterId: chapter.id });
    const c = await repo.addScene({ title: "C", chapterId: chapter.id });

    await repo.addTemporalLinks([{ fromId: c.id, toId: a.id, relation: "before" }]);

    const chronology = await repo.getStoryChronology();
    expect(chronology.chronologicalSceneOrder()).toEqual([c.id, a.id, b.id]);
  });

  it("refuses a relation that names something not on the timeline", async () => {
    const { repo, s1, elias } = await nonlinearNovel();
    await expect(
      repo.addTemporalLinks([{ fromId: s1.id, toId: elias.id, relation: "before" }]),
    ).rejects.toThrow(RepositoryError);
    await expect(
      repo.addTemporalLinks([{ fromId: s1.id, toId: "SCENE_9999", relation: "before" }]),
    ).rejects.toThrow(RepositoryError);
    await expect(
      repo.addTemporalLinks([{ fromId: s1.id, toId: s1.id, relation: "before" }]),
    ).rejects.toThrow(RepositoryError);
  });

  it("keeps a proposed relation out of canon until it is confirmed", async () => {
    const { repo, s1, s2 } = await nonlinearNovel();
    const [proposed] = await repo.addTemporalLinks(
      [{ fromId: s2.id, toId: s1.id, relation: "before" }],
      { source: "agent", confirmationStatus: "proposed", modelId: "mock-model" },
    );

    const canon = await repo.getStoryChronology();
    expect(canon.chronologicalIndexOf(s1.id)).toBeLessThan(canon.chronologicalIndexOf(s2.id));

    const preview = await repo.getStoryChronology({ include: "with_proposed" });
    expect(preview.chronologicalIndexOf(s2.id)).toBeLessThan(preview.chronologicalIndexOf(s1.id));

    await repo.setTemporalLinkStatus((proposed as { id: string }).id, "rejected");
    const after = await repo.getStoryChronology({ include: "with_proposed" });
    expect(after.chronologicalIndexOf(s1.id)).toBeLessThan(after.chronologicalIndexOf(s2.id));
  });
});

describe("character timelines", () => {
  it("walks a character's story in the order they lived it", async () => {
    const { repo, elias, s1, s2, s3 } = await nonlinearNovel();
    const timeline = await repo.getCharacterTimeline(elias.id);
    expect(timeline.map((entry) => entry.nodeId)).toEqual([s3.id, s1.id, s2.id]);
    expect(timeline[0]?.isFlashback).toBe(true);
  });

  it("answers where a character was at a story-world instant", async () => {
    const { repo, elias, manor, london, edinburgh } = await nonlinearNovel();

    await expect(
      repo.getCharacterLocationAtTime(elias.id, {
        kind: "instant",
        instant: "2018-01-01T00:00:00Z",
      }),
    ).resolves.toBe(manor.id);
    await expect(
      repo.getCharacterLocationAtTime(elias.id, {
        kind: "instant",
        instant: "2019-03-04T12:00:00Z",
      }),
    ).resolves.toBe(london.id);
    await expect(
      repo.getCharacterLocationAtTime(elias.id, {
        kind: "instant",
        instant: "2020-01-01T00:00:00Z",
      }),
    ).resolves.toBe(edinburgh.id);
  });

  it("returns a character's events in chronological order", async () => {
    const { repo, elias, manor } = await nonlinearNovel();
    const later = await repo.addEvent({
      name: "The inheritance",
      storyTime: { kind: "exact", instant: "2019-01-01T00:00:00Z" },
      characterIds: [elias.id],
    });
    const earlier = await repo.addEvent({
      name: "The fire",
      storyTime: { kind: "exact", instant: "1997-08-14T22:00:00Z" },
      locationId: manor.id,
      characterIds: [elias.id],
    });

    const events = await repo.getEventsForCharacter(elias.id);
    expect(events.map((e) => e.id)).toEqual([earlier.id, later.id]);
  });
});

describe("timeline checks", () => {
  it("passes a consistent chronology", async () => {
    const { repo } = await nonlinearNovel();
    await expect(repo.checkTimeline()).resolves.toEqual([]);
  });

  it("catches a relation the story times refute", async () => {
    const { repo, s1, s4 } = await nonlinearNovel();
    await repo.addTemporalLinks([{ fromId: s4.id, toId: s1.id, relation: "before" }]);
    const found = await repo.checkTimeline();
    expect(found.map((v) => v.kind)).toContain("relation_contradicts_time");
  });

  /**
   * The London-to-Edinburgh case. Nothing is reported until the writer says how
   * long the journey takes — the system must not assume real-world distances.
   */
  it("reports impossible travel only against a declared travel time", async () => {
    const store = new InMemoryProjectStore();
    const repo = await StoryRepository.createProject({ store, title: "Travel" });
    const elias = await repo.addCharacter({ name: "Elias" });
    const london = await repo.addLocation({ name: "London" });
    const edinburgh = await repo.addLocation({ name: "Edinburgh" });
    const chapter = await repo.addChapter({ title: "One" });

    await repo.addScene({
      title: "Departure",
      chapterId: chapter.id,
      locationId: london.id,
      characterIds: [elias.id],
      storyTime: { kind: "exact", instant: "2019-03-04T14:00:00Z" },
    });
    await repo.addScene({
      title: "Arrival",
      chapterId: chapter.id,
      locationId: edinburgh.id,
      characterIds: [elias.id],
      storyTime: { kind: "exact", instant: "2019-03-04T14:05:00Z" },
    });

    expect((await repo.checkTimeline()).map((v) => v.kind)).not.toContain("impossible_travel");

    await repo.addTravelRules([
      { fromLocationId: london.id, toLocationId: edinburgh.id, minimum: { hours: 4 } },
    ]);
    const found = await repo.checkTimeline();
    expect(found.find((v) => v.kind === "impossible_travel")?.characterId).toBe(elias.id);
  });

  it("will not declare a travel time between something that is not a location", async () => {
    const { repo, london, elias } = await nonlinearNovel();
    await expect(
      repo.addTravelRules([
        { fromLocationId: london.id, toLocationId: elias.id, minimum: { hours: 1 } },
      ]),
    ).rejects.toThrow(RepositoryError);
  });
});

describe("deletion safety", () => {
  it("refuses to delete a scene a temporal relation depends on", async () => {
    const { repo, s1, s2 } = await nonlinearNovel();
    await repo.addTemporalLinks([{ fromId: s1.id, toId: s2.id, relation: "before" }]);

    await expect(repo.deleteEntity(s1.id)).rejects.toThrow(/temporal relation/);
  });

  it("removes the relations when the scene is deleted with unlink", async () => {
    const { repo, s1, s2 } = await nonlinearNovel();
    await repo.addTemporalLinks([{ fromId: s1.id, toId: s2.id, relation: "before" }]);

    await repo.deleteEntity(s1.id, { mode: "unlink" });
    await expect(repo.listTemporalLinks()).resolves.toEqual([]);
  });

  it("records chronology changes as revertible change sets", async () => {
    const { repo, s1, s2 } = await nonlinearNovel();
    await repo.addTemporalLinks([{ fromId: s1.id, toId: s2.id, relation: "before" }]);
    const changes = await repo.listChangeSets();
    expect(changes[0]?.operation).toBe("add_temporal_links");
  });
});
