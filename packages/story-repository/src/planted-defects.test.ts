import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { StoryRepository } from "./story-repository";

/**
 * The audit's compiler probe, made permanent.
 *
 * Phase 30.5A planted five defects in a project and reported that the Story
 * Compiler caught four. It did not say which one it missed, and its harness was
 * deleted — so this rebuilds the probe, one defect per category an auditor
 * would reach for, and asserts all five.
 *
 * The missed one was **knowledge continuity** (MANU-034). The rule existed and
 * was correct, but `referenced_without_knowledge` only ever tested a scene's
 * POV character, and `pov` is optional: a scene with a cast and no POV — the
 * ordinary case — could name a fact nobody had learned and the build stayed
 * green. See `packages/story-state/src/violations.ts`.
 *
 * Each case runs through the whole path: a real project on a real store, the
 * repository's own context assembly, the compiler, and back as persisted
 * diagnostics a writer could click on.
 */

async function novel() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "Probe" });

  const ch1 = await repo.addChapter({ title: "One" });
  const ch2 = await repo.addChapter({ title: "Two" });
  const elias = await repo.addCharacter({ name: "Elias" });
  const mara = await repo.addCharacter({ name: "Mara" });
  const manor = await repo.addLocation({ name: "Manor" });
  const flat = await repo.addLocation({ name: "Flat" });
  const revolver = await repo.addObject({ name: "Revolver" });
  const thread = await repo.addPlotThread({ name: "The photograph" });
  const fact = await repo.addFact({ statement: "A vault lies beneath the manor." });

  const s1 = await repo.addScene({
    title: "S1",
    chapterId: ch1.id,
    locationId: flat.id,
    characterIds: [elias.id, mara.id],
    objectIds: [revolver.id],
  });
  const s2 = await repo.addScene({
    title: "S2",
    chapterId: ch1.id,
    locationId: manor.id,
    characterIds: [elias.id, mara.id],
    objectIds: [revolver.id],
  });
  const s3 = await repo.addScene({
    title: "S3",
    chapterId: ch2.id,
    locationId: manor.id,
    characterIds: [elias.id, mara.id],
  });
  const s4 = await repo.addScene({
    title: "S4",
    chapterId: ch2.id,
    locationId: manor.id,
    characterIds: [elias.id, mara.id],
  });

  return { repo, elias, mara, manor, flat, revolver, thread, fact, s1, s2, s3, s4 };
}

describe("the five planted defects", () => {
  it("catches a dead character who appears again", async () => {
    const n = await novel();
    await n.repo.addStateTransitions([
      { sceneId: n.s1.id, kind: "character_status", subjectId: n.elias.id, value: "deceased" },
    ]);

    const build = await n.repo.buildStory();
    const found = build.diagnostics.filter((d) => d.ruleId === "character_continuity");
    expect(found.length).toBeGreaterThan(0);
    expect(found[0]?.entities).toContain(n.elias.id);
    expect(found[0]?.sceneId).toBeDefined();
    expect(found[0]?.evidence).not.toBe("");
  });

  /**
   * The one the audit missed.
   *
   * A scene names a fact, has a cast, and has no POV. Nobody in the project has
   * ever been recorded learning it.
   */
  it("catches a fact on the page that nobody in the scene holds", async () => {
    const n = await novel();
    await n.repo.updateEntity(n.s1.id as string, { factIds: [n.fact.id] } as never);

    const build = await n.repo.buildStory();
    const found = build.diagnostics.find((d) => d.ruleId === "knowledge_continuity");
    expect(found).toBeDefined();
    expect(found?.entities).toContain(n.fact.id);
    expect(found?.sceneId).toBe(n.s1.id);
    // The message names who was checked, so the writer can see the reasoning
    // rather than being told "possible continuity issue".
    expect(found?.message).toContain(n.elias.id as string);
    expect(found?.message).toContain(n.mara.id as string);
  });

  it("catches a destroyed object used again", async () => {
    const n = await novel();
    await n.repo.addStateTransitions([
      { sceneId: n.s1.id, kind: "object_status", subjectId: n.revolver.id, value: "destroyed" },
    ]);

    const build = await n.repo.buildStory();
    const found = build.diagnostics.find((d) => d.ruleId === "object_continuity");
    expect(found?.severity).toBe("error");
    expect(found?.entities).toContain(n.revolver.id);
  });

  it("catches a promise planted and never kept", async () => {
    const n = await novel();
    const setup = await n.repo.addSetup({
      description: "The photograph on the mantel",
      setupSceneIds: [n.s1.id],
      targetThreadId: n.thread.id,
    });

    const build = await n.repo.buildStory();
    const found = build.diagnostics.find((d) => d.ruleId === "setup_payoff");
    expect(found?.entities).toContain(setup.id);
  });

  it("catches a character in two places at once", async () => {
    const n = await novel();
    await n.repo.addStateTransitions([
      { sceneId: n.s3.id, kind: "character_location", subjectId: n.elias.id, value: n.flat.id },
    ]);

    const build = await n.repo.buildStory();
    const found = build.diagnostics.find(
      (d) => d.ruleId === "character_continuity" && d.message.includes("was last recorded at"),
    );
    expect(found).toBeDefined();
    expect(found?.entities).toContain(n.elias.id);
  });

  it("passes the same project with nothing planted", async () => {
    // The other half of the probe: five findings are only meaningful if the
    // unbroken project is silent.
    const { repo } = await novel();
    const build = await repo.buildStory();
    expect(build.status).toBe("passed");
    expect(build.diagnostics.filter((d) => d.severity !== "info")).toEqual([]);
  });
});

describe("knowledge continuity without a POV", () => {
  it("says nothing when somebody in the scene does learn the fact", async () => {
    const n = await novel();
    await n.repo.updateEntity(n.s1.id as string, { factIds: [n.fact.id] } as never);
    await n.repo.addStateTransitions([
      {
        sceneId: n.s1.id,
        kind: "knowledge_changed",
        subjectId: n.mara.id,
        value: n.fact.id as string,
        knowledgeState: "known",
      },
    ]);

    const build = await n.repo.buildStory();
    expect(build.diagnostics.filter((d) => d.ruleId === "knowledge_continuity")).toEqual([]);
  });

  it("still tests the POV character alone when a scene has one", async () => {
    // With a POV, a fact on the page is a fact that person is expected to hold;
    // another character knowing it does not settle the question.
    const n = await novel();
    await n.repo.updateEntity(
      n.s1.id as string,
      {
        factIds: [n.fact.id],
        pov: n.elias.id,
      } as never,
    );
    await n.repo.addStateTransitions([
      {
        sceneId: n.s1.id,
        kind: "knowledge_changed",
        subjectId: n.mara.id,
        value: n.fact.id as string,
        knowledgeState: "known",
      },
    ]);

    const build = await n.repo.buildStory();
    const found = build.diagnostics.find((d) => d.ruleId === "knowledge_continuity");
    expect(found?.message).toContain("POV character");
    expect(found?.entities).toContain(n.elias.id);
  });

  it("says nothing about a scene with no characters at all", async () => {
    // Expository or off-page narration: nobody can hold anything, and saying so
    // every time would be noise rather than a finding.
    const n = await novel();
    const bare = await n.repo.addScene({ title: "Prologue", chapterId: n.s1.chapterId });
    await n.repo.updateEntity(bare.id as string, { factIds: [n.fact.id] } as never);

    const build = await n.repo.buildStory();
    expect(
      build.diagnostics.filter((d) => d.ruleId === "knowledge_continuity" && d.sceneId === bare.id),
    ).toEqual([]);
  });
});
