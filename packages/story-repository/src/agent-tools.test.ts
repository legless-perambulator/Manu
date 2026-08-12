import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import {
  createBuildTools,
  createTestTools,
  createProjectTools,
  createTask,
  READ_ONLY_GRANT,
  READ_ONLY_TOOL_NAMES,
  ToolExecutor,
  ToolRegistry,
  type ProjectAccess,
} from "@jellytind/agent-runtime";
import type { Character, Relationship, Scene } from "@jellytind/domain";
import { StoryRepository } from "./story-repository";

/**
 * Integration: the Phase-7 tools running against a real Story Repository.
 *
 * The runtime's unit tests use a fixture; this proves the `ProjectAccess` port
 * is genuinely satisfied by the repository, that retrieval returns real project
 * data, and that tasks and activity survive in `.writer/agents/` without
 * polluting the manuscript's revision history.
 */
async function novel() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "The Vault" });

  const mara = await repo.addCharacter({ name: "Mara", role: "protagonist" });
  const elias = await repo.addCharacter({ name: "Elias", role: "foil" });
  const manor = await repo.addLocation({ name: "Blackthorn Manor" });
  const thread = await repo.addPlotThread({ name: "The missing photograph" });
  const chapter = await repo.addChapter({ title: "Openings", status: "drafted" });

  const together = await repo.addScene({
    title: "The Rift",
    chapterId: chapter.id,
    pov: mara.id,
    locationId: manor.id,
    characterIds: [mara.id, elias.id],
    plotThreadIds: [thread.id],
    purpose: ["Mara refuses Elias's help"],
    status: "drafted",
  });
  const alone = await repo.addScene({
    title: "After",
    chapterId: chapter.id,
    pov: mara.id,
    characterIds: [mara.id],
    status: "drafted",
  });
  await repo.addRelationship({
    characterAId: mara.id,
    characterBId: elias.id,
    type: "rival",
    description: "Wary allies who no longer trust each other.",
  });
  // Chapter files are Markdown with YAML front-matter; the prose is the body,
  // so append rather than overwrite or the entity record is lost.
  const scaffolded = (await repo.readProjectFile(chapter.filePath)) ?? "";
  await repo.writeProjectFile(
    chapter.filePath,
    `${scaffolded}\nMara turned away from Elias.\nThe photograph was gone.\n`,
  );

  return { store, repo, mara, elias, manor, thread, chapter, together, alone };
}

function runtimeFor(repo: StoryRepository) {
  // The repository satisfies the port structurally — no adapter needed.
  const access: ProjectAccess = repo;
  const registry = new ToolRegistry().register(
    ...createProjectTools(access),
    ...createBuildTools(access),
    ...createTestTools(access),
  );
  const executor = new ToolExecutor({ registry, grant: READ_ONLY_GRANT, store: repo.agents });
  return { registry, executor };
}

describe("project tools over a real repository", () => {
  it("answers structural questions without reading the manuscript", async () => {
    const { repo, mara } = await novel();
    const { executor } = runtimeFor(repo);

    const overview = await executor.execute("TASK_0001", "get_project", {});
    expect(overview.ok).toBe(true);
    expect(overview.output).toMatchObject({
      title: "The Vault",
      counts: { scenes: 2, characters: 2, chapters: 1 },
    });

    const scenes = await executor.execute("TASK_0001", "get_scenes_by_character", { id: mara.id });
    const found = (scenes.output as { scenes: Scene[] }).scenes;
    expect(found.map((s) => s.title).sort()).toEqual(["After", "The Rift"]);
  });

  it("returns a character with their recorded relationships", async () => {
    const { repo, mara, elias } = await novel();
    const { executor } = runtimeFor(repo);

    const outcome = await executor.execute("TASK_0001", "get_character", { id: mara.id });
    const result = outcome.output as { character: Character; relationships: Relationship[] };
    expect(result.character.name).toBe("Mara");
    expect(result.relationships[0]?.type).toBe("rival");
    expect(result.relationships[0]?.characterBId).toBe(elias.id);
  });

  it("reads chapter prose by path and by range", async () => {
    const { repo, chapter } = await novel();
    const { executor } = runtimeFor(repo);

    const whole = await executor.execute("TASK_0001", "read_file", { path: chapter.filePath });
    const text = (whole.output as { content: string }).content;
    expect(text).toContain("Mara turned away");

    const proseLine = text.split("\n").indexOf("Mara turned away from Elias.") + 1;
    const range = await executor.execute("TASK_0001", "read_range", {
      path: chapter.filePath,
      startLine: proseLine,
      endLine: proseLine + 1,
    });
    expect((range.output as { content: string }).content).toBe(
      "Mara turned away from Elias.\nThe photograph was gone.",
    );
  });

  it("searches the project and returns located excerpts", async () => {
    const { repo } = await novel();
    const { executor } = runtimeFor(repo);
    const outcome = await executor.execute("TASK_0001", "search_project", { query: "photograph" });
    expect(outcome.ok).toBe(true);
    expect((outcome.output as { hits: unknown[] }).hits.length).toBeGreaterThan(0);
  });

  it("refuses paths that escape the project or reach internal state", async () => {
    const { repo } = await novel();
    const { executor } = runtimeFor(repo);

    for (const path of ["../../etc/passwd", "/etc/passwd", ".writer/project.json"]) {
      const outcome = await executor.execute("TASK_0001", "read_file", { path });
      expect(outcome.ok).toBe(false);
      expect(outcome.event.status).toBe("failed");
    }
  });

  it("reports a missing entity as a recoverable tool failure", async () => {
    const { repo } = await novel();
    const { executor } = runtimeFor(repo);
    const outcome = await executor.execute("TASK_0001", "get_scene", { id: "SCENE_9999" });
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toMatch(/No scene exists/);
  });
});

describe("agent task and activity persistence", () => {
  it("persists tasks and activity under .writer/agents", async () => {
    const { store, repo } = await novel();

    const id = await repo.agents.nextTaskId();
    expect(id).toBe("TASK_0001");
    await repo.agents.saveTask(
      createTask({
        id,
        goal: "Trace Mara and Elias.",
        now: "2026-01-01T00:00:00.000Z",
        allowedTools: READ_ONLY_TOOL_NAMES,
      }),
    );

    const { executor } = runtimeFor(repo);
    await executor.execute(id, "get_project", {});

    expect(await store.exists(".writer/agents/tasks.json")).toBe(true);
    expect((await repo.agents.listTasks())[0]?.goal).toBe("Trace Mara and Elias.");
    expect(await repo.agents.listActivity(id)).toHaveLength(1);
    expect(await repo.agents.listActivity("TASK_9999")).toHaveLength(0);
  });

  it("survives reopening the project", async () => {
    const { store, repo } = await novel();
    const id = await repo.agents.nextTaskId();
    await repo.agents.saveTask(
      createTask({
        id,
        goal: "Persisted goal.",
        now: "2026-01-01T00:00:00.000Z",
        allowedTools: READ_ONLY_TOOL_NAMES,
      }),
    );

    const reopened = await StoryRepository.openProject({ store });
    const tasks = await reopened.agents.listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.goal).toBe("Persisted goal.");
    // Ids keep advancing rather than colliding with the stored task.
    expect(await reopened.agents.nextTaskId()).toBe("TASK_0002");
  });

  it("does not record agent reads in the manuscript's revision history", async () => {
    const { repo } = await novel();
    const before = (await repo.listChangeSets()).length;

    const id = await repo.agents.nextTaskId();
    const { executor } = runtimeFor(repo);
    await executor.execute(id, "get_project", {});
    await executor.execute(id, "list_project_files", {});

    expect((await repo.listChangeSets()).length).toBe(before);
  });
});

/**
 * The build tools close the loop: an agent asked whether a project is
 * consistent answers from deterministic diagnostics rather than from its own
 * reading of the prose.
 */
describe("story build tools", () => {
  it("runs a build and reads its diagnostics back", async () => {
    const { repo } = await novel();
    const { executor } = runtimeFor(repo);

    const run = await executor.execute("TASK_0001", "run_story_build", {});
    expect(run.ok).toBe(true);
    const build = (run.output as { build: { id: string; status: string } }).build;
    expect(build.id).toBe("BUILD_0001");

    const read = await executor.execute("TASK_0001", "get_build_diagnostics", {});
    expect(read.ok).toBe(true);
    expect((read.output as { buildId: string }).buildId).toBe(build.id);
  });

  it("filters diagnostics by severity", async () => {
    const { repo } = await novel();
    const { executor } = runtimeFor(repo);
    await executor.execute("TASK_0001", "run_story_build", {});

    const outcome = await executor.execute("TASK_0001", "get_build_diagnostics", {
      severity: "error",
    });
    const diagnostics = (outcome.output as { diagnostics: unknown[] }).diagnostics;
    expect(Array.isArray(diagnostics)).toBe(true);
  });

  it("says so plainly when no build has been run", async () => {
    const { repo } = await novel();
    const { executor } = runtimeFor(repo);

    const outcome = await executor.execute("TASK_0001", "get_build_diagnostics", {});
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain("no builds yet");
  });

  /** Running a build must never look like an edit. */
  it("offers no tool that applies a fix", async () => {
    const { repo } = await novel();
    const { registry } = runtimeFor(repo);
    const names = registry.list().map((tool) => tool.name);
    expect(names).toContain("run_story_build");
    expect(names.some((name) => /fix|repair|apply/.test(name))).toBe(false);
    // And nothing the agent can call carries a write permission.
    expect(
      registry
        .list()
        .every((tool) => tool.permission === "read_canon" || tool.permission === "read_manuscript"),
    ).toBe(true);
  });
});

/**
 * Story tests are a better source than the agent's own reading: they are what
 * the writer *said* their story must be. The agent may read them and run them.
 * It may not write one, and there is no tool that repairs a failing one — an
 * assertion about what a story must be belongs to the person who made it.
 */
describe("story test tools", () => {
  it("lists the writer's tests and runs them", async () => {
    const { repo, mara } = await novel();
    await repo.addStoryTest({
      name: "Mara survives the first act",
      assertion: { kind: "character_alive", characterId: mara.id },
    });
    const { executor } = runtimeFor(repo);

    const listed = await executor.execute("TASK_0001", "list_story_tests", {});
    expect(listed.ok).toBe(true);
    expect((listed.output as { tests: unknown[] }).tests).toHaveLength(1);

    const run = await executor.execute("TASK_0001", "run_story_tests", {});
    expect(run.ok).toBe(true);
    expect((run.output as { deterministic: { passed: number } }).deterministic.passed).toBe(1);
  });

  /**
   * A test asserts something *must* be true, so an unrecorded state fails it.
   * That is not the same as a continuity check inferring a contradiction from
   * silence: here the writer asked for a guarantee the project cannot give.
   */
  it("returns only the failures, with where and why", async () => {
    const { repo, mara, manor, together } = await novel();
    await repo.addStoryTest({
      name: "Mara must be at the manor for the confrontation",
      assertion: { kind: "character_at_location", characterId: mara.id, locationId: manor.id },
      scope: { kind: "at", anchorId: together.id },
    });
    const { executor } = runtimeFor(repo);

    const outcome = await executor.execute("TASK_0001", "get_failed_story_tests", {});
    expect(outcome.ok).toBe(true);
    const { failed, total } = outcome.output as {
      failed: Array<{ failures: Array<{ sceneId: string; actual: string }> }>;
      total: number;
    };
    expect(total).toBe(1);
    expect(failed).toHaveLength(1);
    expect(failed[0]?.failures[0]?.sceneId).toBe(together.id);
    expect(failed[0]?.failures[0]?.actual).not.toBe("");
  });

  /** A semantic test must never come back as passing. */
  it("reports semantic tests as not evaluated", async () => {
    const { repo, mara } = await novel();
    await repo.addStoryTest({
      name: "The romance should feel slow-burn",
      assertion: {
        kind: "reader_suspicion",
        characterId: mara.id,
        comparison: "below",
        level: "strong",
      },
      scope: { kind: "always" },
    });
    const { executor } = runtimeFor(repo);

    const run = await executor.execute("TASK_0001", "run_story_tests", {});
    const output = run.output as {
      deterministic: { total: number };
      semantic: { total: number; notEvaluated: number };
      results: Array<{ status: string }>;
    };
    expect(output.deterministic.total).toBe(0);
    expect(output.semantic).toEqual({ total: 1, notEvaluated: 1 });
    expect(output.results[0]?.status).toBe("not_evaluated");
  });

  it("offers no tool that writes or repairs a test", async () => {
    const { repo } = await novel();
    const { registry } = runtimeFor(repo);
    const names = registry.list().map((tool) => tool.name);

    expect(names).toEqual(expect.arrayContaining(["list_story_tests", "run_story_tests"]));
    expect(names.some((name) => /add_story_test|write_story_test|fix_story_test/.test(name))).toBe(
      false,
    );
  });
});
