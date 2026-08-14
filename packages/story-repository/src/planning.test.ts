import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { comparePlanVersions, emptyPlannedScene, planImpact } from "@jellytind/domain";
import type { ChapterPlan, PlannedScene } from "@jellytind/domain";
import { StoryRepository } from "./story-repository";

/** A project with enough referents for a plan to point at. */
async function world() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "The Vault" });
  const mara = await repo.addCharacter({ name: "Mara" });
  const elias = await repo.addCharacter({ name: "Elias" });
  const manor = await repo.addLocation({ name: "Blackthorn Manor" });
  const cellar = await repo.addLocation({ name: "The Cellar" });
  const thread = await repo.addPlotThread({ name: "The missing photograph" });
  const keyFact = await repo.addFact({ statement: "There is a brass key" });
  const opensFact = await repo.addFact({ statement: "The key opens the vault" });
  const object = await repo.addObject({ name: "Brass key" });
  return { store, repo, mara, elias, manor, cellar, thread, keyFact, opensFact, object };
}

/** The smallest plan worth saving — the "quick plan" of §11. */
function quickPlan(
  chapterId: string,
  scenes: PlannedScene[],
): Omit<ChapterPlan, "version" | "revisions" | "createdAt" | "updatedAt"> {
  return {
    id: `PLANFOR_${chapterId}`,
    chapterId,
    status: "draft",
    scenes,
    activePlotThreadIds: [],
    requiredSetupIds: [],
    requiredPayoffIds: [],
    characterArcMovement: [],
    forbiddenFacts: [],
    constraints: [],
    notes: [],
    source: "author",
  };
}

describe("the plan store: versions in place (§16)", () => {
  it("starts at version 1 and bumps on every save, snapshotting what it replaced", async () => {
    const { repo } = await world();
    const chapter = await repo.addChapter({ title: "Six" });
    const id = chapter.id as string;

    const v1 = await repo.saveChapterPlan(quickPlan(id, [emptyPlannedScene("s1", "Arrival")]));
    expect(v1.version).toBe(1);
    expect(v1.revisions).toHaveLength(0);

    const v2 = await repo.saveChapterPlan({
      ...quickPlan(id, [
        emptyPlannedScene("s1", "Arrival"),
        emptyPlannedScene("s2", "The cellar door"),
      ]),
      objective: "Find the key",
    });
    expect(v2.version).toBe(2);
    expect(v2.revisions).toHaveLength(1);
    expect(v2.revisions[0]?.version).toBe(1);
    expect(v2.revisions[0]?.scenes).toHaveLength(1);
  });

  it("compares two held versions structurally", async () => {
    const { repo } = await world();
    const chapter = await repo.addChapter({ title: "Six" });
    const id = chapter.id as string;
    await repo.saveChapterPlan(quickPlan(id, [emptyPlannedScene("s1", "Arrival")]));
    await repo.saveChapterPlan(
      quickPlan(id, [
        { ...emptyPlannedScene("s1", "Arrival at dusk"), beats: ["Mara knocks"] },
        emptyPlannedScene("s2", "The cellar door"),
      ]),
    );

    const from = await repo.plans.revision(id, 1);
    const to = await repo.plans.revision(id, 2);
    const diff = comparePlanVersions(from, to);
    expect(diff.addedScenes.map((s) => s.key)).toEqual(["s2"]);
    expect(diff.removedScenes).toHaveLength(0);
    expect(diff.changedScenes[0]?.changes.join(" ")).toContain("title");
    expect(diff.changedScenes[0]?.changes.join(" ")).toContain("beats");
  });

  it("refuses a version it no longer holds, naming what it does hold", async () => {
    const { repo } = await world();
    const chapter = await repo.addChapter({ title: "Six" });
    const id = chapter.id as string;
    for (let i = 0; i < 13; i += 1) {
      await repo.saveChapterPlan(quickPlan(id, [emptyPlannedScene("s1", `Take ${String(i)}`)]));
    }
    const plan = await repo.plans.get(id);
    expect(plan?.version).toBe(13);
    expect(plan?.revisions).toHaveLength(10);
    await expect(repo.plans.revision(id, 1)).rejects.toThrow(/no longer held/);
  });

  it("saves are journaled: a plan edit appears in ordinary history", async () => {
    const { repo } = await world();
    const chapter = await repo.addChapter({ title: "Six" });
    await repo.saveChapterPlan(quickPlan(chapter.id as string, []));
    const changes = await repo.listChangeSets();
    expect(changes.some((change) => change.summary.startsWith("Plan CHAPTER_"))).toBe(true);
  });
});

describe("plan impact (§7) is read off the plan deterministically", () => {
  it("reports advances, introduces and resolves from the plan's own references", async () => {
    const { repo, thread, mara, keyFact } = await world();
    const chapter = await repo.addChapter({ title: "Six" });
    const setup = await repo.addSetup({
      description: "The coded note",
      setupSceneIds: [],
    });
    const plan: ChapterPlan = {
      ...quickPlan(chapter.id as string, [
        {
          ...emptyPlannedScene("s1", "Arrival"),
          plotThreadIds: [thread.id as string],
          setupIds: [setup.id as string],
          knowledgeChanges: [
            { characterId: mara.id as string, factId: keyFact.id as string, to: "known" },
          ],
        },
      ]),
      requiredPayoffIds: [setup.id as string],
      version: 1,
      revisions: [],
      createdAt: "t",
      updatedAt: "t",
    };
    const impact = planImpact(plan);
    expect(impact.advances).toEqual([thread.id as string]);
    expect(impact.introduces).toEqual([setup.id as string]);
    expect(impact.resolves).toEqual([setup.id as string]);
    expect(impact.knowledgeTouched).toEqual([mara.id as string]);
  });
});

describe("deterministic plan validation (§6)", () => {
  it("catches unknown references before anything is drafted", async () => {
    const { repo } = await world();
    const chapter = await repo.addChapter({ title: "Six" });
    const findings = await repo.validateChapterPlan({
      ...quickPlan(chapter.id as string, [
        {
          ...emptyPlannedScene("s1", "Ghost scene"),
          pov: "CHAR_9999",
          characterIds: ["CHAR_9999"],
        },
      ]),
      version: 1,
      revisions: [],
      createdAt: "t",
      updatedAt: "t",
    });
    expect(findings.filter((f) => f.code === "unknown_reference").length).toBeGreaterThan(0);
    expect(findings.every((f) => f.sceneKey === "s1" || f.code === "empty_plan")).toBe(true);
  });

  it("refuses a plan that grants knowledge its own constraints forbid", async () => {
    const { repo, mara, opensFact } = await world();
    const chapter = await repo.addChapter({ title: "Six" });
    const findings = await repo.validateChapterPlan({
      ...quickPlan(chapter.id as string, [
        {
          ...emptyPlannedScene("s1", "Too much too soon"),
          characterIds: [mara.id as string],
          knowledgeChanges: [
            { characterId: mara.id as string, factId: opensFact.id as string, to: "known" },
          ],
        },
      ]),
      forbiddenFacts: [
        {
          factId: opensFact.id as string,
          characterId: mara.id as string,
          reason: "she must not yet understand what it opens",
        },
      ],
      version: 1,
      revisions: [],
      createdAt: "t",
      updatedAt: "t",
    });
    const hit = findings.find((f) => f.code === "forbidden_fact_granted");
    expect(hit?.severity).toBe("error");
    expect(hit?.message).toContain("must not yet understand");
  });

  it("catches a planned revelation whose source does not hold the information", async () => {
    const { repo, mara, elias, manor, keyFact } = await world();
    // A prior chapter with a scene, so the plan's chapter has an entry boundary.
    const one = await repo.addChapter({ title: "One", order: 0 });
    await repo.addScene({ title: "Before", chapterId: one.id, characterIds: [elias.id] });
    const six = await repo.addChapter({ title: "Six", order: 5 });

    const findings = await repo.validateChapterPlan({
      ...quickPlan(six.id as string, [
        {
          ...emptyPlannedScene("s1", "The telling"),
          locationId: manor.id as string,
          characterIds: [mara.id as string, elias.id as string],
          knowledgeChanges: [
            {
              characterId: mara.id as string,
              factId: keyFact.id as string,
              to: "known",
              sourceEntityId: elias.id as string,
            },
          ],
        },
      ]),
      version: 1,
      revisions: [],
      createdAt: "t",
      updatedAt: "t",
    });
    // Elias has never learned the fact, so he cannot be the one revealing it.
    expect(findings.some((f) => f.code === "revelation_unavailable")).toBe(true);
  });

  it("catches a payoff nothing has planted, and accepts one planted earlier in the plan", async () => {
    const { repo } = await world();
    const chapter = await repo.addChapter({ title: "Six" });
    const setup = await repo.addSetup({ description: "The coded note", setupSceneIds: [] });

    const orphan = await repo.validateChapterPlan({
      ...quickPlan(chapter.id as string, [
        { ...emptyPlannedScene("s1", "Payoff"), payoffSetupIds: [setup.id as string] },
      ]),
      version: 1,
      revisions: [],
      createdAt: "t",
      updatedAt: "t",
    });
    expect(orphan.some((f) => f.code === "payoff_without_setup")).toBe(true);

    const paired = await repo.validateChapterPlan({
      ...quickPlan(chapter.id as string, [
        { ...emptyPlannedScene("s1", "Plant"), setupIds: [setup.id as string] },
        { ...emptyPlannedScene("s2", "Payoff"), payoffSetupIds: [setup.id as string] },
      ]),
      version: 1,
      revisions: [],
      createdAt: "t",
      updatedAt: "t",
    });
    expect(paired.some((f) => f.code === "payoff_without_setup")).toBe(false);
  });

  it("notes an object recorded elsewhere at the chapter's entry", async () => {
    const { repo, mara, manor, cellar, object } = await world();
    const one = await repo.addChapter({ title: "One", order: 0 });
    const before = await repo.addScene({
      title: "Before",
      chapterId: one.id,
      characterIds: [mara.id],
    });
    await repo.addStateTransitions([
      {
        sceneId: before.id as string,
        kind: "object_location",
        subjectId: object.id as string,
        value: manor.id as string,
      },
    ]);
    const six = await repo.addChapter({ title: "Six", order: 5 });

    const findings = await repo.validateChapterPlan({
      ...quickPlan(six.id as string, [
        {
          ...emptyPlannedScene("s1", "In the cellar"),
          locationId: cellar.id as string,
          characterIds: [mara.id as string],
          objectIds: [object.id as string],
        },
      ]),
      version: 1,
      revisions: [],
      createdAt: "t",
      updatedAt: "t",
    });
    const hit = findings.find((f) => f.code === "object_elsewhere");
    expect(hit?.severity).toBe("warning");
    expect(hit?.message).toContain(manor.id as string);
  });
});

describe("approval materialises scenes (§5, §15)", () => {
  it("creates scene records for planned scenes and pins the approved version", async () => {
    const { repo, mara, cellar } = await world();
    const chapter = await repo.addChapter({ title: "Six" });
    const id = chapter.id as string;
    await repo.saveChapterPlan(
      quickPlan(id, [
        {
          ...emptyPlannedScene("s1", "The discovery"),
          pov: mara.id as string,
          locationId: cellar.id as string,
          characterIds: [mara.id as string],
          beats: ["Mara finds the key", "She pockets it"],
        },
        { ...emptyPlannedScene("s2", "Aftermath"), objective: "Mara hides what she found" },
      ]),
    );

    const approved = await repo.approveChapterPlan(id);
    expect(approved.status).toBe("approved");
    expect(approved.approvedVersion).toBe(approved.version);
    expect(approved.scenes.every((scene) => scene.sceneId !== undefined)).toBe(true);

    const scenes = (await repo.listScenes()).filter((scene) => scene.chapterId === chapter.id);
    expect(scenes.map((scene) => scene.title)).toEqual(["The discovery", "Aftermath"]);
    // Beats became the scene's purpose; the quick plan's objective stood in.
    expect(scenes[0]?.purpose).toEqual(["Mara finds the key", "She pockets it"]);
    expect(scenes[1]?.purpose).toEqual(["Mara hides what she found"]);
    expect(scenes[0]?.pov).toBe(mara.id);
  });

  it("updates an existing scene rather than duplicating it", async () => {
    const { repo, mara } = await world();
    const chapter = await repo.addChapter({ title: "Six" });
    const scene = await repo.addScene({ title: "Old title", chapterId: chapter.id });
    await repo.saveChapterPlan(
      quickPlan(chapter.id as string, [
        {
          ...emptyPlannedScene("s1", "New title"),
          sceneId: scene.id as string,
          characterIds: [mara.id as string],
          beats: ["A beat"],
        },
      ]),
    );
    await repo.approveChapterPlan(chapter.id as string);
    const scenes = (await repo.listScenes()).filter((s) => s.chapterId === chapter.id);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]?.title).toBe("New title");
  });
});
