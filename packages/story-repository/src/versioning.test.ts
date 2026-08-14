import { describe, expect, it } from "vitest";
import { InMemoryProjectStore, type ProjectStore } from "@jellytind/persistence";
import type { Character } from "@jellytind/domain";
import { StoryRepository } from "./story-repository";
import { computeLineDiff } from "./diff";

async function freshRepo() {
  const store = new InMemoryProjectStore();
  const repo = await StoryRepository.createProject({ store, title: "History Novel" });
  return { store, repo };
}

describe("change sets", () => {
  it("records a change set per mutation with file before/after", async () => {
    const { repo } = await freshRepo();
    await repo.writeProjectFile("manuscript/ch1.md", "first draft");

    const history = await repo.listChangeSets();
    const edit = history.find((c) => c.operation === "edit_file");
    expect(edit).toBeDefined();
    expect(edit?.actor).toBe("human");

    const full = await repo.getChangeSet(edit!.id);
    const fileChange = full?.filesChanged.find((f) => f.path === "manuscript/ch1.md");
    expect(fileChange?.before).toBeNull(); // created
    expect(fileChange?.after).toBe("first draft");
  });

  it("records structured entity changes and a file diff", async () => {
    const { repo } = await freshRepo();
    const c = await repo.addCharacter({ name: "Elias" });
    const created = (await repo.listChangeSets()).find((h) => h.operation === "add_character");
    const full = await repo.getChangeSet(created!.id);
    expect(full?.entitiesChanged).toContainEqual({
      id: c.id,
      kind: "character",
      change: "created",
    });

    await repo.updateEntity<Character>(c.id, { name: "Elias Vale" });
    const updated = (await repo.listChangeSets()).find((h) => h.operation === "update_entity");
    const updatedFull = await repo.getChangeSet(updated!.id);
    const charFile = updatedFull?.filesChanged.find((f) => f.path === c.filePath);
    // A structured diff over the entity file: name line changed.
    const diff = computeLineDiff(charFile?.before ?? "", charFile?.after ?? "");
    expect(diff.some((l) => l.op === "add" && l.text.includes("Elias Vale"))).toBe(true);
  });
});

describe("checkpoints", () => {
  it("creates a Draft 0 checkpoint at project creation", async () => {
    const { repo } = await freshRepo();
    const checkpoints = await repo.listCheckpoints();
    expect(checkpoints.map((c) => c.label)).toContain("Draft 0");
  });

  it("creates explicit named checkpoints", async () => {
    const { repo } = await freshRepo();
    await repo.addCharacter({ name: "Mara" });
    const cp = await repo.createCheckpoint("Before Act II Rewrite");
    expect(cp.label).toBe("Before Act II Rewrite");
    expect(cp.fileCount).toBeGreaterThan(0);
  });
});

describe("revert", () => {
  it("reverts a single change set and records the revert", async () => {
    const { repo } = await freshRepo();
    await repo.writeProjectFile("notes/a.md", "v1");
    const editId = (await repo.listChangeSets()).find((c) => c.operation === "edit_file")!.id;
    await repo.writeProjectFile("notes/a.md", "v2");
    expect(await repo.readProjectFile("notes/a.md")).toBe("v2");

    // Revert the *second* edit (latest edit_file).
    const latestEdit = (await repo.listChangeSets()).find((c) => c.operation === "edit_file")!.id;
    await repo.revertChangeSet(latestEdit);
    expect(await repo.readProjectFile("notes/a.md")).toBe("v1");

    // The revert is itself recorded; the original is marked reverted.
    const history = await repo.listChangeSets();
    expect(history[0]?.operation).toBe("revert");
    expect(history.find((c) => c.id === latestEdit)?.status).toBe("reverted");
    expect(editId).toBeDefined();
  });

  it("reverts the project to a checkpoint without destroying later history", async () => {
    const { repo } = await freshRepo();
    const cp = await repo.createCheckpoint("Before changes");
    await repo.addCharacter({ name: "Elias" });
    await repo.writeProjectFile("notes/b.md", "scratch");
    const historyBefore = (await repo.listChangeSets()).length;

    await repo.revertToCheckpoint(cp.id);

    expect(await repo.listCharacters()).toHaveLength(0);
    expect(await repo.readProjectFile("notes/b.md")).toBeNull();
    // History grew (revert recorded), nothing deleted.
    expect((await repo.listChangeSets()).length).toBeGreaterThan(historyBefore);
    expect((await repo.listChangeSets())[0]?.operation).toBe("revert_to_checkpoint");
  });

  it("keeps IDs correct after reverting a creation (no reuse/collision)", async () => {
    const { repo } = await freshRepo();
    const first = await repo.addCharacter({ name: "One" });
    expect(first.id).toBe("CHAR_0001");
    const addId = (await repo.listChangeSets()).find((c) => c.operation === "add_character")!.id;
    await repo.revertChangeSet(addId);
    expect(await repo.listCharacters()).toHaveLength(0);
    // The id counter was restored, so the next character reuses CHAR_0001.
    const again = await repo.addCharacter({ name: "Two" });
    expect(again.id).toBe("CHAR_0001");
  });

  it("supports successive reverts", async () => {
    const { repo } = await freshRepo();
    await repo.writeProjectFile("notes/c.md", "a");
    await repo.writeProjectFile("notes/c.md", "b");
    const edits = (await repo.listChangeSets()).filter((c) => c.operation === "edit_file");
    await repo.revertChangeSet(edits[0]!.id); // revert "b"
    expect(await repo.readProjectFile("notes/c.md")).toBe("a");
    const edits2 = (await repo.listChangeSets()).filter((c) => c.operation === "edit_file");
    await repo.revertChangeSet(edits2[edits2.length - 1]!.id); // revert "a"
    expect(await repo.readProjectFile("notes/c.md")).toBeNull();
  });
});

describe("failed write", () => {
  it("rolls back partial file changes when a write fails mid-operation", async () => {
    const store = new FailingStore("world/objects/OBJECT_0001.md");
    const repo = await StoryRepository.createProject({ store, title: "Robust" });
    const historyBefore = (await repo.listChangeSets()).length;

    // addObject writes the entity file (which the store will reject) plus catalog etc.
    await expect(repo.addObject({ name: "Cursed" })).rejects.toThrow();

    // No committed change set for the failed operation, and no leftover object file.
    expect((await repo.listChangeSets()).length).toBe(historyBefore);
    expect(await repo.readProjectFile("world/objects/OBJECT_0001.md")).toBeNull();
    expect(await repo.listObjects()).toHaveLength(0);
  });
});

describe("persistence and integrity", () => {
  it("keeps history across reopen", async () => {
    const { store, repo } = await freshRepo();
    await repo.addCharacter({ name: "Elias" });
    const before = await repo.listChangeSets();

    const reopened = await StoryRepository.openProject({ store });
    const after = await reopened.listChangeSets();
    expect(after.map((c) => c.id)).toEqual(before.map((c) => c.id));
    // History still fully inspectable.
    expect(await reopened.getChangeSet(before[0]!.id)).not.toBeNull();
  });
});

describe("staging transaction", () => {
  it("stages, previews and commits as one change set", async () => {
    const { repo } = await freshRepo();
    const tx = repo.beginTransaction("Draft two scenes");
    tx.writeFile("manuscript/x.md", "staged one").writeFile("manuscript/y.md", "staged two");

    // Nothing applied until commit.
    expect(await repo.readProjectFile("manuscript/x.md")).toBeNull();
    const preview = await tx.preview();
    expect(preview).toHaveLength(2);

    const change = await tx.commit();
    expect(change.filesChanged.length).toBeGreaterThanOrEqual(2);
    expect(await repo.readProjectFile("manuscript/x.md")).toBe("staged one");
  });

  it("discards staged changes without touching the project", async () => {
    const { repo } = await freshRepo();
    const tx = repo.beginTransaction();
    tx.writeFile("notes/z.md", "never written");
    tx.discard();
    expect(await repo.readProjectFile("notes/z.md")).toBeNull();
  });

  /**
   * The failure the audit worried about: prose written, structure not.
   *
   * A transaction that changes the manuscript *and* the records must not be
   * able to half-apply. If the second write fails, the first must be undone —
   * otherwise the project is left in a state no build could make sense of, and
   * the writer has no way to know.
   */
  it("leaves nothing applied when a write fails part-way through", async () => {
    const store = new FailingStore();
    const repo = await StoryRepository.createProject({ store, title: "Half-written" });
    store.failOn("story/facts.json");

    const tx = repo.beginTransaction("Prose and the fact it rests on");
    tx.writeFile("manuscript/ch1.md", "She found the vault.");
    tx.writeFile("story/facts.json", "[]");

    await expect(tx.commit()).rejects.toThrow(/disk full/);

    // The manuscript write is rolled back with the rest.
    expect(await repo.readProjectFile("manuscript/ch1.md")).toBeNull();
    // And no change set claims it happened.
    const history = await repo.listChangeSets();
    expect(history.some((c) => c.summary === "Prose and the fact it rests on")).toBe(false);
  });

  it("rolls a failed mutation back without losing what was already there", async () => {
    const store = new FailingStore();
    const repo = await StoryRepository.createProject({ store, title: "Kept" });
    await repo.writeProjectFile("notes/first.md", "already here");
    store.failOn("notes/second.md");

    const tx = repo.beginTransaction();
    tx.writeFile("notes/first.md", "overwritten");
    tx.writeFile("notes/second.md", "will fail");
    await expect(tx.commit()).rejects.toThrow();

    // The pre-existing file is restored, not left holding the staged version.
    expect(await repo.readProjectFile("notes/first.md")).toBe("already here");
  });
});

/**
 * A store that throws on writes to one path — to exercise failed-write
 * rollback. The failure is armed *after* the project is scaffolded, so the
 * failing path can be one the scaffold itself writes.
 */
class FailingStore implements ProjectStore {
  private readonly inner = new InMemoryProjectStore();
  private failPath: string | null;
  constructor(failPath: string | null = null) {
    this.failPath = failPath;
  }
  /** Arm the failure after construction, for a path the scaffold also writes. */
  failOn(path: string): void {
    this.failPath = path;
  }
  readFile(p: string) {
    return this.inner.readFile(p);
  }
  writeFile(p: string, c: string) {
    if (p === this.failPath) return Promise.reject(new Error("disk full"));
    return this.inner.writeFile(p, c);
  }
  exists(p: string) {
    return this.inner.exists(p);
  }
  list(prefix?: string) {
    return this.inner.list(prefix);
  }
  delete(p: string) {
    return this.inner.delete(p);
  }
  createDirectory(p: string) {
    return this.inner.createDirectory(p);
  }
}
