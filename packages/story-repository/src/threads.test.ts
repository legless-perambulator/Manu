import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { StoryRepository } from "./story-repository";

/**
 * The worked example from the specification, as a real project: a thread
 * introduced in chapter one, advanced twice, quiet for a stretch, resolved at
 * the end — plus a promise planted early and kept late.
 */
async function novel() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "Blackthorn" });

  const one = await repo.addChapter({ title: "Openings" });
  const two = await repo.addChapter({ title: "The Middle" });
  const three = await repo.addChapter({ title: "The Cellar" });

  const photo = await repo.addPlotThread({ name: "The missing photograph" });
  const vault = await repo.addPlotThread({ name: "The sealed vault" });

  const scenes = [];
  for (const [index, chapter] of [one, one, one, two, two, two, three, three].entries()) {
    scenes.push(
      await repo.addScene({ title: `Scene ${String(index + 1)}`, chapterId: chapter.id }),
    );
  }

  // Roughly a thousand words per chapter, so word distance is measurable.
  for (const chapter of [one, two, three]) {
    await repo.writeProjectFile(
      chapter.filePath,
      `---\nid: ${chapter.id}\ntitle: ${chapter.title}\n---\n\n${"word ".repeat(1000).trim()}\n`,
    );
  }

  return { repo, one, two, three, photo, vault, scenes };
}

const at = (sceneId: string) => ({ sceneId, position: "after" }) as const;

describe("thread lifecycle through a project", () => {
  it("reconstructs a thread's status at any point in the book", async () => {
    const { repo, photo, scenes } = await novel();
    await repo.addStateTransitions([
      {
        sceneId: scenes[0]!.id,
        kind: "thread_appearance",
        subjectId: photo.id,
        value: "introduces",
      },
      { sceneId: scenes[2]!.id, kind: "thread_appearance", subjectId: photo.id, value: "advances" },
      { sceneId: scenes[3]!.id, kind: "thread_status", subjectId: photo.id, value: "dormant" },
      { sceneId: scenes[7]!.id, kind: "thread_appearance", subjectId: photo.id, value: "resolves" },
    ]);

    await expect(repo.getThreadState(photo.id, at(scenes[0]!.id))).resolves.toMatchObject({
      status: "introduced",
    });
    await expect(repo.getThreadState(photo.id, at(scenes[5]!.id))).resolves.toMatchObject({
      status: "dormant",
    });
    const end = await repo.getThreadState(photo.id, at(scenes[7]!.id));
    expect(end.status).toBe("resolved");
    expect(end.introducedSceneId).toBe(scenes[0]!.id);
    expect(end.resolvedSceneId).toBe(scenes[7]!.id);
  });

  it("reads a thread's history as a trail through the chapters", async () => {
    const { repo, photo, scenes } = await novel();
    await repo.addStateTransitions([
      {
        sceneId: scenes[0]!.id,
        kind: "thread_appearance",
        subjectId: photo.id,
        value: "introduces",
        note: "the gap on the wall",
      },
      {
        sceneId: scenes[2]!.id,
        kind: "thread_appearance",
        subjectId: photo.id,
        value: "escalates",
      },
    ]);

    const history = await repo.getThreadHistory(photo.id);
    expect(history.map((s) => [s.interaction, s.status])).toEqual([
      ["introduces", "introduced"],
      ["escalates", "escalating"],
    ]);
    expect(history[0]?.reason).toBe("the gap on the wall");
  });

  it("separates active, dormant and unresolved threads", async () => {
    const { repo, photo, vault, scenes } = await novel();
    await repo.addStateTransitions([
      { sceneId: scenes[0]!.id, kind: "thread_appearance", subjectId: photo.id, value: "advances" },
      { sceneId: scenes[1]!.id, kind: "thread_status", subjectId: vault.id, value: "dormant" },
    ]);

    const active = await repo.getActiveThreadsAtScene(scenes[2]!.id);
    expect(active.map((s) => s.threadId)).toEqual([photo.id]);

    const dormant = await repo.getDormantThreadsAtScene(scenes[2]!.id);
    expect(dormant.map((s) => s.threadId)).toEqual([vault.id]);

    // Both are still owed to the reader.
    const unresolved = await repo.getUnresolvedThreads();
    expect(unresolved.map((s) => s.threadId).sort()).toEqual([photo.id, vault.id].sort());
  });

  it("finds threads introduced within an act", async () => {
    const { repo, one, two, photo, vault, scenes } = await novel();
    await repo.addStateTransitions([
      {
        sceneId: scenes[0]!.id,
        kind: "thread_appearance",
        subjectId: photo.id,
        value: "introduces",
      },
      {
        sceneId: scenes[4]!.id,
        kind: "thread_appearance",
        subjectId: vault.id,
        value: "introduces",
      },
    ]);

    const first = await repo.getThreadsIntroducedInAct([one.id]);
    expect(first.map((s) => s.threadId)).toEqual([photo.id]);
    const second = await repo.getThreadsIntroducedInAct([two.id]);
    expect(second.map((s) => s.threadId)).toEqual([vault.id]);
  });

  it("measures dormancy in scenes, chapters and words", async () => {
    const { repo, photo, scenes } = await novel();
    await repo.addStateTransitions([
      { sceneId: scenes[1]!.id, kind: "thread_appearance", subjectId: photo.id, value: "advances" },
    ]);

    const dormancy = await repo.getThreadDormancy(photo.id, at(scenes[6]!.id));
    expect(dormancy.lastAppearanceSceneId).toBe(scenes[1]!.id);
    expect(dormancy.scenesSinceAppearance).toBe(5);
    expect(dormancy.chaptersSinceAppearance).toBe(2);
    // A chapter's words are attributed to its first scene, so a span that
    // crosses two chapter openings counts both — exactly, and without inventing
    // per-scene numbers.
    expect(dormancy.wordsSinceAppearance).toBe(2000);
  });
});

describe("setups and payoffs through a project", () => {
  it("registers a promise and finds it from either end", async () => {
    const { repo, vault, scenes } = await novel();
    const setup = await repo.addSetup({
      description: "Brass key visible in father's drawer.",
      setupSceneIds: [scenes[1]!.id],
      payoffSceneIds: [scenes[6]!.id],
      payoffDescription: "Key opens cellar archive.",
      subtlety: "subtle",
      trueMeaning: "It is the only key to the vault.",
      targetThreadId: vault.id,
    });

    const planted = await repo.getSetupsForScene(scenes[1]!.id);
    expect(planted.planted.map((s) => s.id)).toEqual([setup.id]);
    const kept = await repo.getSetupsForScene(scenes[6]!.id);
    expect(kept.paidOff.map((s) => s.id)).toEqual([setup.id]);
  });

  it("lists only promises outstanding entering a scene", async () => {
    const { repo, scenes } = await novel();
    const early = await repo.addSetup({
      description: "A photograph is missing.",
      setupSceneIds: [scenes[0]!.id],
    });
    await repo.addSetup({
      description: "A promise made later.",
      setupSceneIds: [scenes[5]!.id],
    });
    await repo.addSetup({
      description: "A promise already kept.",
      setupSceneIds: [scenes[0]!.id],
      payoffSceneIds: [scenes[1]!.id],
    });

    const open = await repo.getOpenSetupsBeforeScene(scenes[3]!.id);
    expect(open.map((s) => s.id)).toEqual([early.id]);
  });

  it("finds a promise with nothing on the other end", async () => {
    const { repo, scenes } = await novel();
    const setup = await repo.addSetup({
      description: "Brass key visible in father's drawer.",
      setupSceneIds: [scenes[1]!.id],
    });

    const found = await repo.checkNarrative();
    const finding = found.find((f) => f.kind === "setup_without_payoff");
    expect(finding?.severity).toBe("warning");
    expect(finding?.setupId).toBe(setup.id);
  });

  it("finds a payoff the reader reaches before its planting", async () => {
    const { repo, scenes } = await novel();
    await repo.addSetup({
      description: "The key.",
      setupSceneIds: [scenes[6]!.id],
      payoffSceneIds: [scenes[1]!.id],
    });

    const found = await repo.checkNarrative();
    expect(found.find((f) => f.kind === "payoff_before_setup")?.severity).toBe("error");
  });

  it("refuses a setup pointing at a scene that does not exist", async () => {
    const { repo } = await novel();
    await expect(
      repo.addSetup({ description: "Nowhere.", setupSceneIds: ["SCENE_9999" as never] }),
    ).rejects.toThrow();
  });

  it("will not delete a scene a setup depends on", async () => {
    const { repo, scenes } = await novel();
    await repo.addSetup({ description: "The key.", setupSceneIds: [scenes[1]!.id] });
    await expect(repo.deleteEntity(scenes[1]!.id)).rejects.toThrow(/referenced/);
  });

  it("reports an abandoned thread and what still points at it", async () => {
    const { repo, vault, scenes } = await novel();
    await repo.addSetup({
      description: "The key.",
      setupSceneIds: [scenes[1]!.id],
      payoffSceneIds: [scenes[6]!.id],
      targetThreadId: vault.id,
    });
    await repo.addStateTransitions([
      { sceneId: scenes[4]!.id, kind: "thread_status", subjectId: vault.id, value: "abandoned" },
    ]);

    const finding = (await repo.checkNarrative()).find((f) => f.kind === "abandoned_thread");
    expect(finding?.threadId).toBe(vault.id);
    expect(finding?.message).toContain("1 setup(s) still point at it");
  });

  /** Dormancy is only ever reported against a threshold the caller names. */
  it("reports dormancy only when asked", async () => {
    const { repo, photo, scenes } = await novel();
    await repo.addStateTransitions([
      { sceneId: scenes[0]!.id, kind: "thread_appearance", subjectId: photo.id, value: "advances" },
    ]);

    expect((await repo.checkNarrative()).map((f) => f.kind)).not.toContain("dormant_thread");

    const found = await repo.checkNarrative({ dormantAfterScenes: 3 });
    const finding = found.find((f) => f.kind === "dormant_thread");
    expect(finding?.threadId).toBe(photo.id);
    expect(finding?.dormancy?.scenesSinceAppearance).toBe(7);
  });

  it("finds nothing wrong with a project that records nothing", async () => {
    const { repo } = await novel();
    await expect(repo.checkNarrative()).resolves.toEqual([]);
  });
});
