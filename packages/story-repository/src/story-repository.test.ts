import { describe, expect, it } from "vitest";
import { InMemoryProjectStore, PathEscapeError, ProjectIndex } from "@jellytind/persistence";
import { MANIFEST_PATH, SCHEMA_VERSION } from "@jellytind/domain";
import { StoryRepository } from "./story-repository";
import { RepositoryError } from "./errors";
import { EXPLORER_ROOTS } from "./paths";
import { validateManifest } from "./manifest";

async function freshProject(title = "My Novel") {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title });
  return { store, repo };
}

describe("createProject", () => {
  it("generates the manifest and canonical structure", async () => {
    const { store, repo } = await freshProject();

    expect(await store.exists(MANIFEST_PATH)).toBe(true);
    for (const dir of [...EXPLORER_ROOTS, ".writer", ".writer/index", ".writer/state"]) {
      expect(await store.exists(dir)).toBe(true);
    }
    // Sensible starter files exist...
    expect(await store.readFile("story/premise.md")).toContain("# Premise");
    expect(await store.readFile("plot/plot_threads.json")).toContain("items");
    // ...but folders are not littered with placeholders.
    expect(await store.exists("manuscript/.gitkeep")).toBe(false);

    const manifest = repo.getManifest();
    expect(manifest.schemaVersion).toBe(SCHEMA_VERSION);
    expect(manifest.id.startsWith("PROJ_")).toBe(true);
    expect(manifest.title).toBe("My Novel");
    expect(manifest.createdAt).toBe(manifest.updatedAt);
  });

  it("refuses to create over an existing project", async () => {
    const { store } = await freshProject();
    await expect(StoryRepository.createProject({ store, title: "Again" })).rejects.toBeInstanceOf(
      RepositoryError,
    );
  });

  it("rejects an empty title", async () => {
    const store = new InMemoryProjectStore();
    await expect(StoryRepository.createProject({ store, title: "   " })).rejects.toBeInstanceOf(
      RepositoryError,
    );
  });

  it("writes a manifest that validates", async () => {
    const { store } = await freshProject();
    const raw = await store.readFile(MANIFEST_PATH);
    const parsed = validateManifest(raw as string);
    expect(parsed.ok).toBe(true);
  });
});

describe("validateProject", () => {
  it("rejects a directory with no manifest", async () => {
    const store = new InMemoryProjectStore();
    const result = await StoryRepository.validateProject(store);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("not_a_project");
  });

  it("rejects a malformed manifest", async () => {
    const store = new InMemoryProjectStore();
    await store.writeFile(MANIFEST_PATH, "{ not json");
    const result = await StoryRepository.validateProject(store);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("invalid_manifest");
  });

  it("rejects a manifest from a newer schema version", async () => {
    const store = new InMemoryProjectStore();
    await store.writeFile(
      MANIFEST_PATH,
      JSON.stringify({
        schemaVersion: 999,
        id: "PROJ_x",
        title: "Future",
        createdAt: "t",
        updatedAt: "t",
        appFormatVersion: "9.9.9",
      }),
    );
    const result = await StoryRepository.validateProject(store);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("unsupported_schema");
  });
});

describe("openProject", () => {
  it("reopens a project and preserves identity", async () => {
    const { store, repo } = await freshProject("Reopen Me");
    const originalId = repo.getManifest().id;

    const reopened = await StoryRepository.openProject({ store });
    expect(reopened.getManifest().id).toBe(originalId);
    expect(reopened.getManifest().title).toBe("Reopen Me");
  });

  it("throws for a non-project directory", async () => {
    const store = new InMemoryProjectStore();
    await expect(StoryRepository.openProject({ store })).rejects.toBeInstanceOf(RepositoryError);
  });
});

describe("safe file operations", () => {
  it("reads and writes project files through the repository", async () => {
    const { repo } = await freshProject();
    await repo.writeProjectFile("manuscript/act_1/chapter_001.md", "# One\n");
    expect(await repo.readProjectFile("manuscript/act_1/chapter_001.md")).toBe("# One\n");
    expect(await repo.fileExists("manuscript/act_1/chapter_001.md")).toBe(true);
  });

  it("prevents path traversal on every file operation", async () => {
    const { repo, store } = await freshProject();
    await expect(repo.writeProjectFile("../evil.md", "x")).rejects.toBeInstanceOf(PathEscapeError);
    await expect(repo.readProjectFile("../../etc/passwd")).rejects.toBeInstanceOf(PathEscapeError);
    await expect(repo.fileExists("/abs")).rejects.toBeInstanceOf(PathEscapeError);
    expect(await store.exists("evil.md")).toBe(false);
  });

  it("saveProjectMetadata updates the title and bumps updatedAt", async () => {
    let t = 0;
    const store = new InMemoryProjectStore();
    const repo = await StoryRepository.createProject({
      store,
      title: "Old",
      now: () => `2026-01-01T00:00:0${t++}Z`,
    });
    const updated = await repo.saveProjectMetadata({ title: "New Title" });
    expect(updated.title).toBe("New Title");
    expect(updated.updatedAt).not.toBe(updated.createdAt);
    // Persisted.
    const parsed = validateManifest((await store.readFile(MANIFEST_PATH)) as string);
    expect(parsed.ok && parsed.value.title).toBe("New Title");
  });
});

describe("entities and stable IDs", () => {
  it("creates entities with correctly-prefixed IDs and content files", async () => {
    const { repo } = await freshProject();
    const chapter = await repo.addChapter({ title: "The Letter" });
    const character = await repo.addCharacter({ name: "Elias", aliases: ["E"] });
    const location = await repo.addLocation({ name: "Manor" });
    const thread = await repo.addPlotThread({ name: "Missing photograph" });

    expect(chapter.id).toMatch(/^CHAPTER_\d+$/);
    expect(character.id).toMatch(/^CHAR_\d+$/);
    expect(location.id).toMatch(/^LOC_\d+$/);
    expect(thread.id).toMatch(/^THREAD_\d+$/);

    expect(await repo.readProjectFile(chapter.filePath)).toContain("# The Letter");
    expect(await repo.readProjectFile(character.filePath)).toContain("# Elias");
    expect((await repo.listPlotThreads())[0]?.name).toBe("Missing photograph");
  });

  it("keeps IDs stable across reopen (monotonic, no collisions)", async () => {
    const { store, repo } = await freshProject();
    const first = await repo.addCharacter({ name: "A" });
    expect(first.id).toBe("CHAR_0001");

    const reopened = await StoryRepository.openProject({ store });
    const second = await reopened.addCharacter({ name: "B" });
    expect(second.id).toBe("CHAR_0002");
  });

  it("lists entities created earlier after reopening", async () => {
    const { store, repo } = await freshProject();
    await repo.addChapter({ title: "One" });
    await repo.addChapter({ title: "Two" });

    const reopened = await StoryRepository.openProject({ store });
    const chapters = await reopened.listChapters();
    expect(chapters.map((c) => c.title)).toEqual(["One", "Two"]);
    expect(chapters[0]?.order).toBe(0);
    expect(chapters[1]?.order).toBe(1);
  });
});

describe("SQLite index integration", () => {
  it("mirrors created entities into the derived index", async () => {
    const store = new InMemoryProjectStore();
    // In-memory SQLite for the derived index.
    const { NodeSqlDatabase } = await import("@jellytind/persistence/node");
    const index = new ProjectIndex(new NodeSqlDatabase());
    const repo = await StoryRepository.createProject({ store, title: "Indexed", index });

    await repo.addCharacter({ name: "Mara" });
    await repo.addChapter({ title: "Ch1" });

    expect(index.getMetadata("projectId")).toBe(repo.getManifest().id);
    expect(index.listEntities("character").map((e) => e.name)).toEqual(["Mara"]);
    expect(index.listEntities("chapter")).toHaveLength(1);
    index.close();
  });
});
