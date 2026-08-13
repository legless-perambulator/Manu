import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "@jellytind/persistence";
import type { BranchId } from "@jellytind/domain";
import { StoryRepository } from "./story-repository";
import { BranchStore } from "./branch-store";
import {
  compareBranches,
  createBranch,
  deleteBranch,
  mergeBranch,
  openBranch,
  switchBranch,
} from "./branches";

/**
 * A small project with an ending, so "change the ending on a branch" is a real
 * operation rather than a synthetic file write.
 */
async function seedProject(store: InMemoryProjectStore) {
  const repo = await StoryRepository.createProject({ store, title: "The Blackthorn Inheritance" });
  const elias = await repo.addCharacter({ name: "Elias Vance", role: "protagonist" });
  const marcus = await repo.addCharacter({ name: "Marcus Vance", role: "antagonist" });
  const chapter = await repo.addChapter({ title: "The Reading", order: 1 });
  const finale = await repo.addChapter({ title: "The Fire", order: 2 });
  await repo.addScene({
    chapterId: finale.id,
    title: "Marcus dies in the fire",
    characterIds: [elias.id, marcus.id],
  });
  const scaffold = (await repo.readProjectFile(finale.filePath)) ?? "";
  await repo.writeProjectFile(
    finale.filePath,
    `${scaffold.trimEnd()}\n\nThe roof came down and Marcus did not come out.\n`,
  );
  return { repo, elias, marcus, chapter, finale };
}

describe("story branching", () => {
  it("gives every project a main branch, and migrates existing projects", async () => {
    const store = new InMemoryProjectStore();
    await seedProject(store);

    // Nothing wrote a registry during creation: it appears on first branch use.
    const branches = new BranchStore(store);
    const all = await branches.list();
    expect(all).toHaveLength(1);
    expect(all[0]?.name).toBe("main");
    expect(all[0]?.parentBranchId).toBeUndefined();
    expect((await branches.active()).id).toBe(all[0]?.id);
  });

  it("isolates a branch: the original manuscript is unchanged", async () => {
    const store = new InMemoryProjectStore();
    const { finale } = await seedProject(store);

    const darker = await createBranch(store, {
      name: "darker-ending",
      description: "Marcus survives and inherits.",
    });
    expect(darker.parentBranchId).toBeDefined();
    expect(darker.createdFromRevisionId).toBeDefined();

    // Rewrite the final chapter on the branch only.
    const branchRepo = await openBranch(store, darker.id);
    await branchRepo.writeProjectFile(
      finale.filePath,
      "# The Fire\n\nMarcus walked out of the smoke, and the house was his.\n",
    );

    const mainRepo = await openBranch(store);
    const onMain = await mainRepo.readProjectFile(finale.filePath);
    const onBranch = await branchRepo.readProjectFile(finale.filePath);

    expect(onMain).toContain("did not come out");
    expect(onBranch).toContain("walked out of the smoke");
    expect(onMain).not.toBe(onBranch);
  });

  it("isolates structured records, not just prose", async () => {
    const store = new InMemoryProjectStore();
    await seedProject(store);
    const branch = await createBranch(store, { name: "marcus-survives" });

    const branchRepo = await openBranch(store, branch.id);
    await branchRepo.addCharacter({ name: "The Notary", role: "minor" });
    await branchRepo.addPlotThread({ name: "The second codicil" });

    const mainRepo = await openBranch(store);
    expect((await mainRepo.listCharacters()).map((c) => c.name)).not.toContain("The Notary");
    expect((await branchRepo.listCharacters()).map((c) => c.name)).toContain("The Notary");
    expect(await mainRepo.listPlotThreads()).toHaveLength(0);
    expect(await branchRepo.listPlotThreads()).toHaveLength(1);
  });

  it("a branch never sees another branch's files", async () => {
    const store = new InMemoryProjectStore();
    await seedProject(store);
    const a = await createBranch(store, { name: "ending-a" });
    const b = await createBranch(store, { name: "ending-b" });

    const repoA = await openBranch(store, a.id);
    await repoA.writeProjectFile("manuscript/only-in-a.md", "A");

    const repoB = await openBranch(store, b.id);
    expect(await repoB.readProjectFile("manuscript/only-in-a.md")).toBeNull();
    expect(await repoB.listProjectFiles()).not.toContain("manuscript/only-in-a.md");

    // And no branch can see the branch machinery itself.
    for (const path of await repoA.listProjectFiles()) {
      expect(path.startsWith(".writer/branches/")).toBe(false);
    }
  });

  it("deleting a file on a branch leaves it intact on main", async () => {
    const store = new InMemoryProjectStore();
    const { chapter } = await seedProject(store);
    const branch = await createBranch(store, { name: "cut-the-reading" });

    const branchRepo = await openBranch(store, branch.id);
    const tx = branchRepo.beginTransaction("Cut the chapter", { actor: "human" });
    tx.deleteFile(chapter.filePath);
    await tx.commit();

    expect(await branchRepo.readProjectFile(chapter.filePath)).toBeNull();
    expect(await branchRepo.listProjectFiles()).not.toContain(chapter.filePath);

    const mainRepo = await openBranch(store);
    expect(await mainRepo.readProjectFile(chapter.filePath)).not.toBeNull();
  });

  it("compares versions: prose and records", async () => {
    const store = new InMemoryProjectStore();
    const { finale } = await seedProject(store);
    const main = await new BranchStore(store).main();
    const darker = await createBranch(store, { name: "darker-ending" });

    const branchRepo = await openBranch(store, darker.id);
    await branchRepo.writeProjectFile(finale.filePath, "# The Fire\n\nMarcus survived.\n");
    await branchRepo.addCharacter({ name: "The Notary" });

    const comparison = await compareBranches(store, main.id, darker.id);
    expect(comparison.manuscript.map((f) => f.path)).toContain(finale.filePath);
    expect(comparison.records.some((r) => r.kind === "character" && r.change === "added")).toBe(
      true,
    );
    // Silence has to be readable as "no difference", not "not looked at".
    expect(comparison.inspected).toContain("plot threads");
  });

  it("runs Story Build against the active branch, and keeps its diagnostics there", async () => {
    const store = new InMemoryProjectStore();
    await seedProject(store);
    const branch = await createBranch(store, { name: "extra-act" });

    // Give the branch material main does not have.
    const branchRepo = await openBranch(store, branch.id);
    const extra = await branchRepo.addChapter({ title: "The Inquest", order: 3 });
    await branchRepo.addScene({ chapterId: extra.id, title: "The coroner reads the will" });

    const branchBuild = await branchRepo.buildStory({ persist: true });
    const mainRepo = await openBranch(store);
    const mainBuild = await mainRepo.buildStory({ persist: true });

    // Each build saw its own branch's story.
    expect(await branchRepo.listChapters()).toHaveLength(3);
    expect(await mainRepo.listChapters()).toHaveLength(2);
    expect(branchBuild.status).toBeDefined();
    expect(mainBuild.status).toBeDefined();

    // The record of each build stays on the branch that produced it: two
    // builds happened, and neither branch's history has more than its own.
    // Build numbering is per-branch, so both are BUILD_0001 in their own
    // namespace — the point is that neither can see the other.
    expect(await branchRepo.listBuilds()).toHaveLength(1);
    expect(await mainRepo.listBuilds()).toHaveLength(1);
  });

  it("survives a restart: branch state is on disk, not in memory", async () => {
    const store = new InMemoryProjectStore();
    const { finale } = await seedProject(store);
    const darker = await createBranch(store, { name: "darker-ending" });
    await (
      await openBranch(store, darker.id)
    ).writeProjectFile(finale.filePath, "# The Fire\n\nMarcus survived.\n");
    await switchBranch(store, darker.id);

    // A "restart" is a brand-new store over the same files, and brand-new
    // repository objects — nothing carried over in memory.
    const reopened = new InMemoryProjectStore(await snapshot(store));
    const branches = new BranchStore(reopened);
    expect((await branches.active()).name).toBe("darker-ending");
    expect(await (await openBranch(reopened)).readProjectFile(finale.filePath)).toContain(
      "Marcus survived",
    );
    expect((await branches.main()).name).toBe("main");
  });

  it("merges a change the target never touched", async () => {
    const store = new InMemoryProjectStore();
    await seedProject(store);
    const main = await new BranchStore(store).main();
    const side = await createBranch(store, { name: "polish-chapter-one" });

    const sideRepo = await openBranch(store, side.id);
    await sideRepo.writeProjectFile("notes/voice.md", "Elias speaks in short sentences.\n");

    const result = await mergeBranch(store, side.id, main.id);
    expect(result.conflicts).toHaveLength(0);
    expect(result.applied).toContain("notes/voice.md");
    expect(result.changeSetId).toBeDefined();

    const mainRepo = await openBranch(store);
    expect(await mainRepo.readProjectFile("notes/voice.md")).toContain("short sentences");
  });

  it("refuses to guess when both versions changed the same prose", async () => {
    const store = new InMemoryProjectStore();
    const { finale } = await seedProject(store);
    const main = await new BranchStore(store).main();
    const side = await createBranch(store, { name: "other-ending" });

    await (
      await openBranch(store, side.id)
    ).writeProjectFile(finale.filePath, "# The Fire\n\nMarcus survived.\n");
    await (
      await openBranch(store)
    ).writeProjectFile(finale.filePath, "# The Fire\n\nMarcus was never there.\n");

    const result = await mergeBranch(store, side.id, main.id);
    expect(result.conflicts.map((c) => c.path)).toContain(finale.filePath);
    expect(result.applied).toHaveLength(0);
    // Nothing moved: main still says what main said.
    expect(await (await openBranch(store)).readProjectFile(finale.filePath)).toContain(
      "never there",
    );
  });

  it("protects main and the active version from deletion", async () => {
    const store = new InMemoryProjectStore();
    await seedProject(store);
    const main = await new BranchStore(store).main();
    const side = await createBranch(store, { name: "throwaway" });

    await expect(deleteBranch(store, main.id)).rejects.toThrow(/main version cannot be deleted/i);

    await switchBranch(store, side.id);
    await expect(deleteBranch(store, side.id)).rejects.toThrow(/switch to another version/i);

    await switchBranch(store, main.id);
    const removed = await deleteBranch(store, side.id);
    expect(removed.name).toBe("throwaway");
    expect((await new BranchStore(store).list()).map((b) => b.name)).toEqual(["main"]);
  });

  it("deletes a branch's files, not the project's", async () => {
    const store = new InMemoryProjectStore();
    const { finale } = await seedProject(store);
    const side = await createBranch(store, { name: "scrapped" });
    await (await openBranch(store, side.id)).writeProjectFile(finale.filePath, "scrapped text");

    await deleteBranch(store, side.id);
    const mainRepo = await openBranch(store);
    expect(await mainRepo.readProjectFile(finale.filePath)).toContain("did not come out");
    expect(await store.list(`.writer/branches/${side.id}`)).toHaveLength(0);
  });

  it("rejects a duplicate version name and an unnameable one", async () => {
    const store = new InMemoryProjectStore();
    await seedProject(store);
    await createBranch(store, { name: "Darker Ending" });
    await expect(createBranch(store, { name: "darker-ending" })).rejects.toThrow(/already exists/i);
    await expect(createBranch(store, { name: "   " })).rejects.toThrow(/needs a name/i);
  });

  it("does not perform the creative transformation on creation", async () => {
    const store = new InMemoryProjectStore();
    const { finale } = await seedProject(store);
    const before = await (await openBranch(store)).readProjectFile(finale.filePath);

    const branch = await createBranch(store, {
      name: "marcus-survives",
      description: "Marcus survives Chapter 28.",
    });

    // The description says what the writer intends. The prose is untouched
    // until they do it.
    const after = await (await openBranch(store, branch.id)).readProjectFile(finale.filePath);
    expect(after).toBe(before);
  });
});

/** Copy every file out of a store, the way reopening a project on disk would. */
async function snapshot(store: InMemoryProjectStore): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const path of await store.list()) {
    const content = await store.readFile(path);
    if (content !== null) out[path] = content;
  }
  return out;
}

export type { BranchId };
