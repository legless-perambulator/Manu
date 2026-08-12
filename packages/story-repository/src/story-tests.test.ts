import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { StoryRepository } from "./story-repository";

/**
 * Story tests through the whole path: persisted in `.writer/`, validated
 * against real entities, evaluated against reconstructed state, and
 * revertible like any other authored thing.
 *
 * The story here is the one from the spec — Elias must not know who the killer
 * is before chapter 37 — shrunk to two chapters so the assertion is checkable
 * by hand.
 */
async function novel() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "Blackthorn" });

  const early = await repo.addChapter({ title: "Before" });
  const late = await repo.addChapter({ title: "The revelation" });
  const elias = await repo.addCharacter({ name: "Elias" });
  const manor = await repo.addLocation({ name: "Blackthorn Manor" });
  const killer = await repo.addFact({ statement: "Mara killed Thomas Vance." });

  const first = await repo.addScene({
    title: "The letter",
    chapterId: early.id,
    locationId: manor.id,
    characterIds: [elias.id],
  });
  const second = await repo.addScene({
    title: "The confession",
    chapterId: late.id,
    locationId: manor.id,
    characterIds: [elias.id],
  });

  return { store, repo, early, late, elias, manor, killer, first, second };
}

describe("recording a story test", () => {
  it("stores an assertion and reads it back as a sentence", async () => {
    const { repo, elias, killer, late } = await novel();

    const test = await repo.addStoryTest({
      name: "Elias must not know the killer's identity",
      assertion: {
        kind: "character_does_not_know_fact",
        characterId: elias.id,
        factId: killer.id,
      },
      scope: { kind: "before", anchorId: late.id },
    });

    expect(test.id).toBe("TEST_0001");
    expect(test.type).toBe("deterministic");
    expect(test.enabled).toBe(true);
    expect(test.severity).toBe("error");

    const stored = await repo.getStoryTest(test.id);
    expect(stored?.name).toBe(test.name);
    expect(await repo.listStoryTests()).toHaveLength(1);
  });

  /** A test about a character the project does not have asserts nothing. */
  it("refuses an assertion about an entity that does not exist", async () => {
    const { repo, killer } = await novel();

    await expect(
      repo.addStoryTest({
        name: "Nobody knows",
        assertion: {
          kind: "character_does_not_know_fact",
          characterId: "CHAR_9999" as never,
          factId: killer.id,
        },
      }),
    ).rejects.toThrow(/CHAR_9999/);
  });

  it("refuses a scope anchored to a chapter that does not exist", async () => {
    const { repo, elias } = await novel();

    await expect(
      repo.addStoryTest({
        name: "Elias survives",
        assertion: { kind: "character_alive", characterId: elias.id },
        scope: { kind: "before", anchorId: "CHAPTER_9999" as never },
      }),
    ).rejects.toThrow(/CHAPTER_9999/);
  });

  /** Semantic tests are recorded the same way and typed differently. */
  it("records a semantic assertion without pretending it can decide it", async () => {
    const { repo, elias } = await novel();

    const test = await repo.addStoryTest({
      name: "Elias should stay emotionally guarded",
      assertion: {
        kind: "character_disposition",
        characterId: elias.id,
        expected: "emotionally guarded",
      },
    });
    expect(test.type).toBe("semantic");

    const run = await repo.runStoryTests();
    expect(run.semantic.total).toBe(1);
    expect(run.semantic.notEvaluated).toBe(1);
    expect(run.deterministic.total).toBe(0);
    expect(run.results[0]?.status).toBe("not_evaluated");
  });
});

describe("running story tests over a real project", () => {
  it("passes while the story keeps the promise", async () => {
    const { repo, elias, killer, late } = await novel();
    await repo.addStoryTest({
      name: "Elias must not know the killer's identity",
      assertion: {
        kind: "character_does_not_know_fact",
        characterId: elias.id,
        factId: killer.id,
      },
      scope: { kind: "before", anchorId: late.id },
    });

    const run = await repo.runStoryTests();
    expect(run.deterministic).toEqual({ total: 1, passed: 1, failed: 0 });
  });

  it("fails, and says where, once a revision breaks it", async () => {
    const { repo, elias, killer, late, first } = await novel();
    await repo.addStoryTest({
      name: "Elias must not know the killer's identity",
      assertion: {
        kind: "character_does_not_know_fact",
        characterId: elias.id,
        factId: killer.id,
      },
      scope: { kind: "before", anchorId: late.id },
    });

    // The afternoon's revision that breaks eighteen months of intention.
    await repo.addStateTransitions([
      {
        sceneId: first.id,
        kind: "knowledge_changed",
        subjectId: elias.id,
        value: killer.id,
        knowledgeState: "known",
      },
    ]);

    const run = await repo.runStoryTests();
    expect(run.deterministic.failed).toBe(1);

    const failure = run.results[0]?.failures[0];
    expect(failure?.sceneId).toBe(first.id);
    expect(failure?.entities).toContain(elias.id);
    expect(failure?.actual).not.toBe("");
    expect(failure?.evidence).not.toBe("");
  });

  /** A disabled test is kept and reported as skipped — never silently dropped. */
  it("skips a disabled test rather than passing it", async () => {
    const { repo, elias } = await novel();
    const test = await repo.addStoryTest({
      name: "Elias survives",
      assertion: { kind: "character_alive", characterId: elias.id },
    });

    await repo.setStoryTestEnabled(test.id, false);
    const run = await repo.runStoryTests();

    expect(run.skipped).toBe(1);
    expect(run.deterministic.total).toBe(0);
    expect(run.results[0]?.status).toBe("skipped");

    await repo.setStoryTestEnabled(test.id, true);
    expect((await repo.runStoryTests()).deterministic.total).toBe(1);
  });
});

describe("story tests inside a build", () => {
  it("reports the suite separately from the rules, and as a diagnostic when it fails", async () => {
    const { repo, elias, killer, late, first } = await novel();
    await repo.addStoryTest({
      name: "Elias must not know the killer's identity",
      assertion: {
        kind: "character_does_not_know_fact",
        characterId: elias.id,
        factId: killer.id,
      },
      scope: { kind: "before", anchorId: late.id },
    });

    const clean = await repo.buildStory();
    expect(clean.tests.deterministic).toEqual({ total: 1, passed: 1, failed: 0 });
    expect(clean.diagnostics.filter((d) => d.ruleId === "story_tests")).toEqual([]);

    await repo.addStateTransitions([
      {
        sceneId: first.id,
        kind: "knowledge_changed",
        subjectId: elias.id,
        value: killer.id,
        knowledgeState: "known",
      },
    ]);

    const broken = await repo.buildStory();
    expect(broken.tests.deterministic.failed).toBe(1);

    const diagnostic = broken.diagnostics.find((d) => d.ruleId === "story_tests");
    expect(diagnostic?.severity).toBe("error");
    expect(diagnostic?.sceneId).toBe(first.id);
    expect(diagnostic?.entities).toContain(elias.id);
    expect(broken.status).toBe("failed");
  });

  /** The test's own severity decides how loudly its failure lands. */
  it("honours the severity the writer chose for the test", async () => {
    const { repo, elias, killer, late, first } = await novel();
    await repo.addStoryTest({
      name: "Elias should probably not know yet",
      assertion: {
        kind: "character_does_not_know_fact",
        characterId: elias.id,
        factId: killer.id,
      },
      scope: { kind: "before", anchorId: late.id },
      severity: "warning",
    });
    await repo.addStateTransitions([
      {
        sceneId: first.id,
        kind: "knowledge_changed",
        subjectId: elias.id,
        value: killer.id,
        knowledgeState: "known",
      },
    ]);

    const build = await repo.buildStory();
    expect(build.diagnostics.find((d) => d.ruleId === "story_tests")?.severity).toBe("warning");
    expect(build.status).toBe("passed_with_warnings");
  });

  /** An unevaluated judgement must never be reported as a passing check. */
  it("never turns a semantic test into a diagnostic", async () => {
    const { repo, elias } = await novel();
    await repo.addStoryTest({
      name: "The romance should feel slow-burn",
      assertion: { kind: "free_form", statement: "The romance should feel slow-burn." },
    });
    await repo.addStoryTest({
      name: "Elias should stay guarded",
      assertion: {
        kind: "character_disposition",
        characterId: elias.id,
        expected: "emotionally guarded",
      },
    });

    const build = await repo.buildStory();
    expect(build.tests.semantic.total).toBe(2);
    expect(build.diagnostics.filter((d) => d.ruleId === "story_tests")).toEqual([]);
    expect(build.status).toBe("passed");
  });
});

describe("story tests and the entities they name", () => {
  it("refuses to delete an entity a test asserts about", async () => {
    const { repo, elias } = await novel();
    await repo.addStoryTest({
      name: "Elias survives",
      assertion: { kind: "character_alive", characterId: elias.id },
    });

    await expect(repo.deleteEntity(elias.id)).rejects.toThrow(/referenc/i);
  });

  it("removes the tests along with the entity when the writer unlinks", async () => {
    const { repo, elias } = await novel();
    await repo.addStoryTest({
      name: "Elias survives",
      assertion: { kind: "character_alive", characterId: elias.id },
    });

    await repo.deleteEntity(elias.id, { mode: "unlink" });
    expect(await repo.listStoryTests()).toEqual([]);
  });

  /** A scope anchor counts as a reference too — the range is part of the claim. */
  it("protects a chapter a test's scope is anchored to", async () => {
    const { repo, elias, late } = await novel();
    await repo.addStoryTest({
      name: "Elias survives to the revelation",
      assertion: { kind: "character_alive", characterId: elias.id },
      scope: { kind: "before", anchorId: late.id },
    });

    await expect(repo.deleteEntity(late.id)).rejects.toThrow(/referenc/i);
  });
});

describe("story tests as authored content", () => {
  /** A test is the writer's intention. Losing one should be as undoable as prose. */
  it("journals adding and deleting a test", async () => {
    const { repo, elias } = await novel();
    const test = await repo.addStoryTest({
      name: "Elias survives",
      assertion: { kind: "character_alive", characterId: elias.id },
    });

    const added = (await repo.listChangeSets()).find((c) => c.operation === "add_story_test");
    expect(added?.summary).toContain("Elias survives");

    await repo.deleteStoryTest(test.id);
    expect(await repo.listStoryTests()).toEqual([]);

    const removal = (await repo.listChangeSets()).find((c) => c.operation === "delete_story_test");
    expect(removal).toBeDefined();

    await repo.revertChangeSet((removal as { id: string }).id);
    expect((await repo.listStoryTests()).map((t) => t.id)).toEqual([test.id]);
  });

  it("survives a reopen of the project", async () => {
    const { store, repo, elias } = await novel();
    await repo.addStoryTest({
      name: "Elias survives",
      assertion: { kind: "character_alive", characterId: elias.id },
    });

    const reopened = await StoryRepository.openProject({ store });
    const tests = await reopened.listStoryTests();
    expect(tests.map((t) => t.name)).toEqual(["Elias survives"]);
    expect((await reopened.runStoryTests()).deterministic.total).toBe(1);
  });

  it("says plainly that a test does not exist rather than failing quietly", async () => {
    const { repo } = await novel();
    await expect(repo.deleteStoryTest("TEST_9999")).rejects.toThrow(/TEST_9999/);
    await expect(repo.setStoryTestEnabled("TEST_9999", false)).rejects.toThrow(/TEST_9999/);
    expect(await repo.getStoryTest("TEST_9999")).toBeNull();
  });
});
