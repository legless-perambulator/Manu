import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { StoryRepository } from "./story-repository";

/**
 * A small novel that can be broken on demand.
 *
 * The point of these tests is the whole path: a real project on a real store,
 * through the repository's own context assembly, into the compiler, and back as
 * persisted diagnostics a writer could click on.
 */
async function novel() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "Blackthorn" });

  const chapter = await repo.addChapter({ title: "Openings" });
  const elias = await repo.addCharacter({ name: "Elias" });
  const mara = await repo.addCharacter({ name: "Mara" });
  const manor = await repo.addLocation({ name: "Blackthorn Manor" });
  const flat = await repo.addLocation({ name: "Elias's Flat" });
  const revolver = await repo.addObject({ name: "Revolver" });
  const thread = await repo.addPlotThread({ name: "The missing photograph" });

  const first = await repo.addScene({
    title: "The flat",
    chapterId: chapter.id,
    locationId: flat.id,
    characterIds: [elias.id],
    objectIds: [revolver.id],
  });
  const second = await repo.addScene({
    title: "The confrontation",
    chapterId: chapter.id,
    locationId: manor.id,
    characterIds: [elias.id],
    objectIds: [revolver.id],
  });

  return { repo, chapter, elias, mara, manor, flat, revolver, thread, first, second };
}

describe("building a story", () => {
  it("passes a project with nothing wrong, and says which rules ran", async () => {
    const { repo } = await novel();
    const build = await repo.buildStory();

    expect(build.status).toBe("passed");
    expect(build.counts.error).toBe(0);
    expect(build.rules.length).toBeGreaterThan(0);
    expect(build.rules.every((r) => r.status === "passed")).toBe(true);
  });

  /** The revolver left in a flat and fired at the manor — the canonical failure. */
  it("reports a real continuity problem from structured state alone", async () => {
    const { repo, first, revolver, flat } = await novel();
    await repo.addStateTransitions([
      { sceneId: first.id, kind: "object_location", subjectId: revolver.id, value: flat.id },
    ]);

    const build = await repo.buildStory();
    expect(build.status).toBe("failed");

    const diagnostic = build.diagnostics.find((d) => d.ruleId === "object_continuity");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.entities).toContain(revolver.id);
    // Navigable: a writer can click through to the scene and its chapter.
    expect(diagnostic?.sceneId).toBeDefined();
    expect(diagnostic?.chapterId).toBeDefined();
    expect(diagnostic?.evidence).not.toBe("");
  });

  /**
   * The repository refuses to *write* a dangling reference, so one can only
   * arrive from outside — a hand-edited file, a bad merge, a sync conflict.
   * That is exactly why the build looks for them.
   */
  it("finds a reference that arrived from outside the application", async () => {
    const { repo, first } = await novel();
    await breakScene(repo, first.id);

    const build = await repo.buildStory();
    const diagnostic = build.diagnostics.find((d) => d.ruleId === "referential_integrity");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.message).toContain("CHAR_9999");
  });

  it("honours build configuration", async () => {
    const { repo, first } = await novel();
    await breakScene(repo, first.id);

    const off = await repo.buildStory({ config: { disabledRules: ["referential_integrity"] } });
    expect(off.diagnostics.filter((d) => d.ruleId === "referential_integrity")).toEqual([]);
    expect(off.rules.find((r) => r.ruleId === "referential_integrity")?.status).toBe("skipped");

    const softened = await repo.buildStory({
      config: { severityOverrides: { referential_integrity: "info" } },
    });
    expect(softened.diagnostics[0]?.severity).toBe("info");
    expect(softened.status).toBe("passed");
  });

  it("reports dormancy only when the build asks for it", async () => {
    const { repo, first, thread } = await novel();
    await repo.addStateTransitions([
      { sceneId: first.id, kind: "thread_appearance", subjectId: thread.id, value: "advances" },
    ]);

    const quiet = await repo.buildStory();
    expect(quiet.diagnostics.filter((d) => d.ruleId === "thread_lifecycle")).toEqual([]);

    const asked = await repo.buildStory({ config: { options: { dormantAfterScenes: 1 } } });
    const diagnostic = asked.diagnostics.find((d) => d.ruleId === "thread_lifecycle");
    expect(diagnostic?.entities).toEqual([thread.id]);
  });
});

/** Corrupt the scenes file the way an external edit would. */
async function breakScene(repo: StoryRepository, sceneId: string): Promise<void> {
  await rewriteScene(repo, sceneId, (scene) => ({
    ...scene,
    characterIds: [...(scene.characterIds as string[]), "CHAR_9999"],
  }));
}

async function repairScene(repo: StoryRepository, sceneId: string): Promise<void> {
  await rewriteScene(repo, sceneId, (scene) => ({
    ...scene,
    characterIds: (scene.characterIds as string[]).filter((id) => id !== "CHAR_9999"),
  }));
}

async function rewriteScene(
  repo: StoryRepository,
  sceneId: string,
  edit: (scene: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const path = "scenes/scenes.json";
  const raw = (await repo.readProjectFile(path)) ?? '{"items":[]}';
  const parsed = JSON.parse(raw) as { items: Array<Record<string, unknown>> };
  const items = parsed.items.map((scene) => (scene.id === sceneId ? edit(scene) : scene));
  await repo.writeProjectFile(path, `${JSON.stringify({ items }, null, 2)}\n`);
}

describe("build history", () => {
  it("numbers builds and keeps their summaries", async () => {
    const { repo } = await novel();
    const first = await repo.buildStory();
    const second = await repo.buildStory();

    expect(first.number).toBe(1);
    expect(second.number).toBe(2);
    expect(second.id).toBe("BUILD_0002");

    const history = await repo.listBuilds();
    expect(history.map((b) => b.id)).toEqual(["BUILD_0002", "BUILD_0001"]);
    // A summary carries the counts without dragging every diagnostic with it.
    expect(history[0]).not.toHaveProperty("diagnostics");
  });

  it("reads a past build back in full", async () => {
    const { repo, first } = await novel();
    await breakScene(repo, first.id);
    const build = await repo.buildStory();

    const stored = await repo.getBuild(build.id);
    expect(stored?.diagnostics).toEqual(build.diagnostics);
    expect((await repo.getLatestBuild())?.id).toBe(build.id);
  });

  it("compares a build with the one before it", async () => {
    const { repo, first } = await novel();
    await repo.buildStory();

    await breakScene(repo, first.id);
    const broken = await repo.buildStory();

    const introduced = await repo.compareToPreviousBuild(broken.id);
    expect(introduced.added.map((d) => d.ruleId)).toEqual(["referential_integrity"]);
    expect(introduced.resolved).toEqual([]);

    await repairScene(repo, first.id);
    const fixed = await repo.buildStory();

    const repaired = await repo.compareToPreviousBuild(fixed.id);
    expect(repaired.resolved.map((d) => d.ruleId)).toEqual(["referential_integrity"]);
    expect(repaired.added).toEqual([]);
    expect(repaired.previousBuildId).toBe(broken.id);
  });

  it("does not record a build the caller asked not to keep", async () => {
    const { repo } = await novel();
    await repo.buildStory({ persist: false });
    await expect(repo.listBuilds()).resolves.toEqual([]);
  });

  /** A build is derived analysis, so running one is not a change to the story. */
  it("leaves no change set behind", async () => {
    const { repo } = await novel();
    const before = await repo.listChangeSets();
    await repo.buildStory();
    await expect(repo.listChangeSets()).resolves.toHaveLength(before.length);
  });
});
