import { describe, expect, it } from "vitest";
import type { Location } from "@jellytind/domain";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { StoryRepository } from "./story-repository";
import { RepositoryError } from "./errors";

/**
 * A project with a nested house and a tracked object, built so that each test
 * can break it in exactly one way.
 *
 * ```
 * Blackthorn Manor
 *   └── West Wing
 *        └── Library
 *             └── Hidden Vault
 * Elias's Flat
 * ```
 */
async function manor() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "Blackthorn" });

  const elias = await repo.addCharacter({ name: "Elias", role: "protagonist" });
  const mara = await repo.addCharacter({ name: "Mara", role: "foil" });

  const house = await repo.addLocation({ name: "Blackthorn Manor" });
  const wing = await repo.addLocation({ name: "West Wing", parentLocationId: house.id });
  const library = await repo.addLocation({ name: "Library", parentLocationId: wing.id });
  const vault = await repo.addLocation({ name: "Hidden Vault", parentLocationId: library.id });
  const flat = await repo.addLocation({ name: "Elias's Flat" });

  const key = await repo.addObject({ name: "Brass Key" });
  const revolver = await repo.addObject({ name: "Revolver" });
  const chapter = await repo.addChapter({ title: "Openings" });

  return { repo, elias, mara, house, wing, library, vault, flat, key, revolver, chapter };
}

describe("nested locations", () => {
  it("reads a containment path outermost first", async () => {
    const { repo, house, wing, library, vault } = await manor();
    await expect(repo.getLocationPath(vault.id)).resolves.toEqual([
      house.id,
      wing.id,
      library.id,
      vault.id,
    ]);
  });

  it("lists everything inside a place", async () => {
    const { repo, house, wing, library, vault } = await manor();
    await expect(repo.getContainedLocations(house.id)).resolves.toEqual(
      [wing.id, library.id, vault.id].sort(),
    );
  });

  it("finds scenes anywhere inside a location", async () => {
    const { repo, house, vault, flat, chapter } = await manor();
    const inside = await repo.addScene({
      title: "The vault",
      chapterId: chapter.id,
      locationId: vault.id,
    });
    await repo.addScene({ title: "The flat", chapterId: chapter.id, locationId: flat.id });

    const found = await repo.getScenesWithinLocation(house.id);
    expect(found.map((s) => s.id)).toEqual([inside.id]);
    // The plain query is exact and still available; this one understands nesting.
    await expect(repo.getScenesByLocation(house.id)).resolves.toEqual([]);
  });

  it("catches a location tree that loops", async () => {
    const { repo, house, wing } = await manor();
    await repo.updateEntity<Location>(house.id, { parentLocationId: wing.id });

    const found = await repo.checkContinuity();
    expect(found.map((v) => v.kind)).toContain("invalid_nested_location");
    expect(found.every((v) => v.severity === "error")).toBe(true);
  });
});

describe("object state through a project", () => {
  it("tracks owner, holder, place and condition separately", async () => {
    const { repo, elias, mara, key, library, chapter } = await manor();
    const s1 = await repo.addScene({ title: "One", chapterId: chapter.id });
    const s2 = await repo.addScene({ title: "Two", chapterId: chapter.id });

    await repo.addStateTransitions([
      { sceneId: s1.id, kind: "object_owner", subjectId: key.id, value: elias.id },
      { sceneId: s1.id, kind: "object_location", subjectId: key.id, value: library.id },
      { sceneId: s2.id, kind: "object_holder", subjectId: key.id, value: mara.id },
      { sceneId: s2.id, kind: "object_condition", subjectId: key.id, value: "bent" },
    ]);

    const after = await repo.getObjectState(key.id, { sceneId: s2.id, position: "after" });
    expect(after).toMatchObject({
      ownerId: elias.id,
      holderId: mara.id,
      condition: "bent",
      status: "exists",
      placement: "held",
    });
    // Still Elias's key. Mara is merely holding it.
    const before = await repo.getObjectState(key.id, { sceneId: s2.id, position: "before" });
    expect(before.holderId).toBeUndefined();
    expect(before.locationId).toBe(library.id);
  });

  it("reads an object's history as a trail a writer recognises", async () => {
    const { repo, mara, elias, key, library, chapter } = await manor();
    const s1 = await repo.addScene({ title: "Father's drawer", chapterId: chapter.id });
    const s2 = await repo.addScene({ title: "Mara takes the key", chapterId: chapter.id });
    const s3 = await repo.addScene({ title: "Given to Elias", chapterId: chapter.id });

    await repo.addStateTransitions([
      { sceneId: s1.id, kind: "object_location", subjectId: key.id, value: library.id },
    ]);
    await repo.recordObjectTransfer({
      objectId: key.id,
      sceneId: s2.id,
      toCharacterId: mara.id,
      reason: "Mara takes the key",
    });
    await repo.recordObjectTransfer({
      objectId: key.id,
      sceneId: s3.id,
      fromCharacterId: mara.id,
      toCharacterId: elias.id,
      reason: "handed over",
    });

    const history = await repo.getObjectHistory(key.id);
    expect(history.map((c) => [c.sceneId, c.kind, c.to])).toEqual([
      [s1.id, "location", library.id],
      [s2.id, "holder", mara.id],
      [s3.id, "holder", elias.id],
    ]);

    const transfers = await repo.getObjectTransfers(key.id);
    expect(transfers.at(-1)).toMatchObject({
      fromCharacterId: mara.id,
      toCharacterId: elias.id,
      reason: "handed over",
    });
  });

  it("follows a carried object to wherever its holder goes", async () => {
    const { repo, elias, revolver, flat, house, chapter } = await manor();
    const s1 = await repo.addScene({ title: "The flat", chapterId: chapter.id });
    const s2 = await repo.addScene({ title: "The drive", chapterId: chapter.id });

    await repo.addStateTransitions([
      { sceneId: s1.id, kind: "object_location", subjectId: revolver.id, value: flat.id },
      { sceneId: s1.id, kind: "object_holder", subjectId: revolver.id, value: elias.id },
      { sceneId: s1.id, kind: "character_location", subjectId: elias.id, value: flat.id },
      { sceneId: s2.id, kind: "character_location", subjectId: elias.id, value: house.id },
    ]);

    await expect(
      repo.getObjectLocation(revolver.id, { sceneId: s2.id, position: "after" }),
    ).resolves.toBe(house.id);
  });

  it("refuses a transfer whose stated origin the timeline contradicts", async () => {
    const { repo, mara, elias, key, chapter } = await manor();
    const s1 = await repo.addScene({ title: "One", chapterId: chapter.id });
    const s2 = await repo.addScene({ title: "Two", chapterId: chapter.id });

    await repo.addStateTransitions([
      { sceneId: s1.id, kind: "object_holder", subjectId: key.id, value: mara.id },
    ]);

    await expect(
      repo.recordObjectTransfer({
        objectId: key.id,
        sceneId: s2.id,
        fromCharacterId: elias.id,
        toCharacterId: mara.id,
      }),
    ).rejects.toThrow(/disagrees with the recorded state/);
  });

  it("refuses a transfer that goes nowhere", async () => {
    const { repo, key, chapter } = await manor();
    const s1 = await repo.addScene({ title: "One", chapterId: chapter.id });
    await expect(repo.recordObjectTransfer({ objectId: key.id, sceneId: s1.id })).rejects.toThrow(
      RepositoryError,
    );
  });

  it("records movement so a departure is not read as still being there", async () => {
    const { repo, elias, house, chapter } = await manor();
    const s1 = await repo.addScene({ title: "One", chapterId: chapter.id });
    const s2 = await repo.addScene({ title: "Two", chapterId: chapter.id });

    await repo.addStateTransitions([
      { sceneId: s1.id, kind: "character_location", subjectId: elias.id, value: house.id },
      {
        sceneId: s2.id,
        kind: "character_location",
        subjectId: elias.id,
        value: house.id,
        movement: "departure",
      },
    ]);

    const state = await repo.getCharacterState(elias.id, { sceneId: s2.id, position: "after" });
    expect(state.presence).toBe("departed");
    expect(state.locationId).toBeUndefined();
    expect(state.lastKnownLocationId).toBe(house.id);
  });
});

/**
 * Each story below is written to fail in one specific way. The acceptance
 * criterion for the phase is that these are found deterministically, with no
 * model and no re-reading of the manuscript.
 */
describe("broken stories", () => {
  it("finds the revolver left in the flat and fired at the manor", async () => {
    const { repo, elias, revolver, flat, house, chapter } = await manor();
    await repo.addScene({
      title: "The flat",
      chapterId: chapter.id,
      locationId: flat.id,
      characterIds: [elias.id],
      objectIds: [revolver.id],
    });
    const later = await repo.addScene({
      title: "The confrontation",
      chapterId: chapter.id,
      locationId: house.id,
      characterIds: [elias.id],
      objectIds: [revolver.id],
    });
    const scenes = await repo.listScenes();
    await repo.addStateTransitions([
      {
        sceneId: scenes[0]?.id as never,
        kind: "object_location",
        subjectId: revolver.id,
        value: flat.id,
      },
    ]);

    const found = await repo.checkContinuity();
    const violation = found.find((v) => v.kind === "impossible_object_appearance");
    expect(violation?.severity).toBe("error");
    expect(violation?.sceneId).toBe(later.id);
    expect(violation?.objectId).toBe(revolver.id);
  });

  it("accepts the same story once a transfer explains the move", async () => {
    const { repo, elias, revolver, flat, house, chapter } = await manor();
    const first = await repo.addScene({
      title: "The flat",
      chapterId: chapter.id,
      locationId: flat.id,
      characterIds: [elias.id],
      objectIds: [revolver.id],
    });
    await repo.addScene({
      title: "The confrontation",
      chapterId: chapter.id,
      locationId: house.id,
      characterIds: [elias.id],
      objectIds: [revolver.id],
    });

    await repo.addStateTransitions([
      { sceneId: first.id, kind: "object_location", subjectId: revolver.id, value: flat.id },
      { sceneId: first.id, kind: "character_location", subjectId: elias.id, value: flat.id },
    ]);
    await repo.recordObjectTransfer({
      objectId: revolver.id,
      sceneId: first.id,
      toCharacterId: elias.id,
      reason: "Elias pockets it on the way out",
    });

    expect((await repo.checkContinuity()).map((v) => v.kind)).not.toContain(
      "impossible_object_appearance",
    );
  });

  it("does not object to a scene deeper inside the place the object was left", async () => {
    const { repo, key, house, vault, chapter } = await manor();
    const first = await repo.addScene({
      title: "The hall",
      chapterId: chapter.id,
      locationId: house.id,
      objectIds: [key.id],
    });
    await repo.addScene({
      title: "The vault",
      chapterId: chapter.id,
      locationId: vault.id,
      objectIds: [key.id],
    });
    await repo.addStateTransitions([
      { sceneId: first.id, kind: "object_location", subjectId: key.id, value: house.id },
    ]);

    await expect(repo.checkContinuity()).resolves.toEqual([]);
  });

  it("finds a destroyed object used again", async () => {
    const { repo, key, house, chapter } = await manor();
    const burn = await repo.addScene({
      title: "The fire",
      chapterId: chapter.id,
      locationId: house.id,
      objectIds: [key.id],
    });
    const later = await repo.addScene({
      title: "The door",
      chapterId: chapter.id,
      locationId: house.id,
      objectIds: [key.id],
    });
    await repo.addStateTransitions([
      { sceneId: burn.id, kind: "object_status", subjectId: key.id, value: "destroyed" },
    ]);

    const violation = (await repo.checkContinuity()).find(
      (v) => v.kind === "destroyed_object_reused",
    );
    expect(violation?.severity).toBe("error");
    expect(violation?.sceneId).toBe(later.id);
  });

  it("finds one scene giving an object two owners", async () => {
    const { repo, elias, mara, key, chapter } = await manor();
    const scene = await repo.addScene({ title: "The argument", chapterId: chapter.id });
    await repo.addStateTransitions([
      { sceneId: scene.id, kind: "object_owner", subjectId: key.id, value: elias.id },
      { sceneId: scene.id, kind: "object_owner", subjectId: key.id, value: mara.id },
    ]);

    expect((await repo.checkContinuity()).map((v) => v.kind)).toContain(
      "conflicting_object_ownership",
    );
  });

  it("warns about an object that moved with nobody carrying it", async () => {
    const { repo, key, flat, vault, chapter } = await manor();
    const first = await repo.addScene({ title: "One", chapterId: chapter.id });
    const second = await repo.addScene({ title: "Two", chapterId: chapter.id });
    await repo.addStateTransitions([
      { sceneId: first.id, kind: "object_location", subjectId: key.id, value: flat.id },
      { sceneId: second.id, kind: "object_location", subjectId: key.id, value: vault.id },
    ]);

    const violation = (await repo.checkContinuity()).find(
      (v) => v.kind === "unexplained_object_relocation",
    );
    expect(violation?.severity).toBe("warning");
    expect(violation?.objectId).toBe(key.id);
  });

  it("finds a character in two places in one scene", async () => {
    const { repo, elias, flat, house, chapter } = await manor();
    const scene = await repo.addScene({ title: "Impossible", chapterId: chapter.id });
    await repo.addStateTransitions([
      { sceneId: scene.id, kind: "character_location", subjectId: elias.id, value: flat.id },
      { sceneId: scene.id, kind: "character_location", subjectId: elias.id, value: house.id },
    ]);

    const violation = (await repo.checkContinuity()).find(
      (v) => v.kind === "conflicting_character_location",
    );
    expect(violation?.severity).toBe("error");
    expect(violation?.characterId).toBe(elias.id);
  });

  it("finds nothing wrong with a project that records nothing", async () => {
    const { repo, chapter } = await manor();
    await repo.addScene({ title: "Untracked", chapterId: chapter.id });
    await expect(repo.checkContinuity()).resolves.toEqual([]);
  });
});
