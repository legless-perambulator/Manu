import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import type { Character } from "@jellytind/domain";
import { StoryRepository } from "./story-repository";
import { RepositoryError } from "./errors";

async function freshRepo() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "Graph Novel" });
  return { store, repo };
}

describe("entity creation", () => {
  it("creates every Phase-3 entity kind with a correctly-prefixed ID", async () => {
    const { repo } = await freshRepo();
    const character = await repo.addCharacter({ name: "Elias", role: "protagonist" });
    const location = await repo.addLocation({ name: "Blackthorn Manor" });
    const object = await repo.addObject({ name: "Brass Key" });
    const thread = await repo.addPlotThread({ name: "Missing photograph" });
    const fact = await repo.addFact({ statement: "The vault exists beneath the manor." });
    const rule = await repo.addWorldRule({ name: "No resurrection", severity: "hard" });
    const event = await repo.addEvent({ name: "The disappearance", storyTime: "1997" });

    expect(character.id).toMatch(/^CHAR_\d+$/);
    expect(location.id).toMatch(/^LOC_\d+$/);
    expect(object.id).toMatch(/^OBJECT_\d+$/);
    expect(thread.id).toMatch(/^THREAD_\d+$/);
    expect(fact.id).toMatch(/^FACT_\d+$/);
    expect(rule.id).toMatch(/^RULE_\d+$/);
    expect(event.id).toMatch(/^EVENT_\d+$/);

    expect((await repo.listFacts())[0]?.statement).toContain("vault");
    expect((await repo.listWorldRules())[0]?.severity).toBe("hard");
  });

  it("stores characters as human-readable Markdown with front-matter", async () => {
    const { store, repo } = await freshRepo();
    const c = await repo.addCharacter({
      name: "Mara",
      role: "spy",
      description: "A quiet watcher.",
    });
    const raw = (await store.readFile(c.filePath)) ?? "";
    expect(raw).toContain("---");
    expect(raw).toContain("name: Mara");
    expect(raw).toContain("role: spy");
    expect(raw).toContain("# Mara");
  });
});

describe("renaming without ID change", () => {
  it("keeps the ID stable when the display name changes", async () => {
    const { repo } = await freshRepo();
    const c = await repo.addCharacter({ name: "Marcus Vale" });
    const renamed = await repo.updateEntity<Character>(c.id, { name: "Marcus Kane" });
    expect(renamed.id).toBe(c.id);
    expect(renamed.name).toBe("Marcus Kane");
    // filePath (derived from ID) is unchanged.
    expect(renamed.filePath).toBe(c.filePath);
  });
});

describe("aliases", () => {
  it("round-trips aliases through persistence", async () => {
    const { store, repo } = await freshRepo();
    const c = await repo.addCharacter({ name: "Elias", aliases: ["E", "The Heir"] });
    const reopened = await StoryRepository.openProject({ store });
    const loaded = await reopened.getEntity<{ aliases: string[] }>(c.id);
    expect(loaded?.aliases).toEqual(["E", "The Heir"]);
  });
});

describe("links between entities", () => {
  it("links a scene to characters, location, threads and objects by ID", async () => {
    const { repo } = await freshRepo();
    const elias = await repo.addCharacter({ name: "Elias" });
    const mara = await repo.addCharacter({ name: "Mara" });
    const library = await repo.addLocation({ name: "Library" });
    const thread = await repo.addPlotThread({ name: "The key" });
    const key = await repo.addObject({ name: "Brass Key" });

    const scene = await repo.addScene({
      title: "In the library",
      pov: elias.id,
      locationId: library.id,
      characterIds: [elias.id, mara.id],
      plotThreadIds: [thread.id],
      objectIds: [key.id],
      purpose: ["reveal the key"],
    });

    expect(scene.pov).toBe(elias.id);
    expect(scene.characterIds).toContain(mara.id);
    expect(scene.objectIds).toEqual([key.id]);

    // Relationships link two characters.
    const rel = await repo.addRelationship({
      characterAId: elias.id,
      characterBId: mara.id,
      type: "allies",
    });
    expect(rel.characterAId).toBe(elias.id);
  });
});

describe("invalid references", () => {
  it("rejects a scene linking to a non-existent character", async () => {
    const { repo } = await freshRepo();
    await expect(
      repo.addScene({ title: "Bad", characterIds: ["CHAR_9999" as never] }),
    ).rejects.toBeInstanceOf(RepositoryError);
  });

  it("rejects a relationship referencing a missing character", async () => {
    const { repo } = await freshRepo();
    const elias = await repo.addCharacter({ name: "Elias" });
    await expect(
      repo.addRelationship({
        characterAId: elias.id,
        characterBId: "CHAR_9999" as never,
        type: "rival",
      }),
    ).rejects.toBeInstanceOf(RepositoryError);
  });

  it("never creates dangling references (integrity stays clean)", async () => {
    const { repo } = await freshRepo();
    const c = await repo.addCharacter({ name: "Elias" });
    const loc = await repo.addLocation({ name: "Manor" });
    await repo.addScene({ title: "S1", pov: c.id, locationId: loc.id, characterIds: [c.id] });
    const report = await repo.checkIntegrity();
    expect(report.ok).toBe(true);
    expect(report.dangling).toEqual([]);
  });
});

describe("dependency checks and deletion safety", () => {
  it("finds referrers of an entity", async () => {
    const { repo } = await freshRepo();
    const elias = await repo.addCharacter({ name: "Elias" });
    const scene = await repo.addScene({ title: "S1", characterIds: [elias.id] });
    const refs = await repo.findReferences(elias.id);
    expect(refs.map((r) => r.fromId)).toContain(scene.id);
    expect(refs[0]?.field).toBe("characterIds");
  });

  it("prevents deletion of a referenced entity by default", async () => {
    const { repo } = await freshRepo();
    const elias = await repo.addCharacter({ name: "Elias" });
    await repo.addScene({ title: "S1", pov: elias.id, characterIds: [elias.id] });
    await expect(repo.deleteEntity(elias.id)).rejects.toBeInstanceOf(RepositoryError);
    // The character still exists.
    expect(await repo.getEntity(elias.id)).not.toBeNull();
  });

  it("unlinks references on delete when asked, leaving no dangling refs", async () => {
    const { repo } = await freshRepo();
    const elias = await repo.addCharacter({ name: "Elias" });
    const mara = await repo.addCharacter({ name: "Mara" });
    const scene = await repo.addScene({
      title: "S1",
      pov: elias.id,
      characterIds: [elias.id, mara.id],
    });
    const rel = await repo.addRelationship({
      characterAId: elias.id,
      characterBId: mara.id,
      type: "allies",
    });

    const result = await repo.deleteEntity(elias.id, { mode: "unlink" });
    expect(result.deletedId).toBe(elias.id);

    const updatedScene = await repo.getEntity<{ pov?: string; characterIds: string[] }>(scene.id);
    expect(updatedScene?.pov).toBeUndefined(); // optional ref cleared
    expect(updatedScene?.characterIds).toEqual([mara.id]); // array ref filtered

    // The relationship lost a required participant, so it was removed.
    expect(await repo.getEntity(rel.id)).toBeNull();

    const report = await repo.checkIntegrity();
    expect(report.ok).toBe(true);
  });

  it("errors when deleting an unknown entity", async () => {
    const { repo } = await freshRepo();
    await expect(repo.deleteEntity("CHAR_9999")).rejects.toBeInstanceOf(RepositoryError);
  });
});

describe("persistence and reopening", () => {
  it("persists the full graph across reopen with stable IDs", async () => {
    const { store, repo } = await freshRepo();
    const elias = await repo.addCharacter({ name: "Elias" });
    await repo.addLocation({ name: "Manor" });
    await repo.addScene({ title: "S1", pov: elias.id, characterIds: [elias.id] });

    const reopened = await StoryRepository.openProject({ store });
    expect((await reopened.listCharacters()).map((c) => c.name)).toEqual(["Elias"]);
    expect((await reopened.listScenes())[0]?.pov).toBe(elias.id);

    // New IDs continue without collision.
    const next = await reopened.addCharacter({ name: "Mara" });
    expect(next.id).toBe("CHAR_0002");

    // Cross-kind summary listing works.
    const summaries = await reopened.listEntitySummaries();
    expect(summaries.some((s) => s.kind === "scene")).toBe(true);
  });
});
