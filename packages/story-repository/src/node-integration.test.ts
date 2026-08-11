import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeProjectStore, NodeSqlDatabase } from "@jellytind/persistence/node";
import { ProjectIndex } from "@jellytind/persistence";
import { StoryRepository } from "./story-repository";
import { PATHS } from "./paths";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jellytind-proj-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("StoryRepository on a real filesystem", () => {
  it("creates a real project tree, SQLite index, and reopens it", async () => {
    const store = new NodeProjectStore(root);
    const index = new ProjectIndex(new NodeSqlDatabase(join(root, PATHS.derivedDb)));

    const repo = await StoryRepository.createProject({
      store,
      title: "Disk Novel",
      rootPath: root,
      index,
    });
    const chapter = await repo.addChapter({ title: "Opening" });

    // Real files on disk.
    expect(JSON.parse(await readFile(join(root, PATHS.manifest), "utf8")).title).toBe("Disk Novel");
    expect(await readFile(join(root, chapter.filePath), "utf8")).toContain("# Opening");
    // Real SQLite database file was created.
    expect((await stat(join(root, PATHS.derivedDb))).isFile()).toBe(true);
    index.close();

    // Reopen from disk with a fresh store + index binding.
    const store2 = new NodeProjectStore(root);
    const index2 = new ProjectIndex(new NodeSqlDatabase(join(root, PATHS.derivedDb)));
    const reopened = await StoryRepository.openProject({
      store: store2,
      rootPath: root,
      index: index2,
    });
    expect(reopened.getManifest().id).toBe(repo.getManifest().id);
    expect((await reopened.listChapters()).map((c) => c.title)).toEqual(["Opening"]);
    // New IDs continue without collision.
    const next = await reopened.addChapter({ title: "Second" });
    expect(next.id).toBe("CHAPTER_0002");
    index2.close();
  });

  it("writes files atomically (no .tmp residue after save)", async () => {
    const store = new NodeProjectStore(root);
    const repo = await StoryRepository.createProject({ store, title: "Atomic", rootPath: root });
    await repo.writeProjectFile("notes/scratch.md", "draft");
    await repo.writeProjectFile("notes/scratch.md", "final");
    expect(await repo.readProjectFile("notes/scratch.md")).toBe("final");
    const files = await store.list("notes");
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);
  });
});
