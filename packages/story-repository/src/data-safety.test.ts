import { afterAll, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { NodeProjectStore } from "@jellytind/persistence/node";
import { ExternalChangeError, GuardedProjectStore, fingerprint } from "@jellytind/persistence";
import { InMemoryProjectStore } from "@jellytind/persistence";
import { StoryRepository } from "./story-repository";
import { ProjectBackups, RETAIN } from "./backups";
import { migrateProject } from "./migrations";
import { availableFolderName, projectFolderName } from "./project-folder";

/**
 * The data-safety regressions from the Phase 30.5A audit.
 *
 * Every test here reproduces a scenario the audit found and would fail against
 * the implementation it found it in. They run against a **real filesystem**
 * rather than the in-memory store, because the audit's other finding was that
 * filesystem safety cannot be proven by a store that has no filesystem
 * (docs/AUDIT_30_5A.md, docs/REMEDIATION_30_5.md).
 */

const ROOTS: string[] = [];

async function tmpDir(prefix = "manu-safety-"): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  ROOTS.push(dir);
  return dir;
}

afterAll(async () => {
  for (const root of ROOTS) await fs.rm(root, { recursive: true, force: true });
});

async function project(title = "Safety") {
  const root = await tmpDir();
  const repo = await StoryRepository.createProject({
    store: new NodeProjectStore(root),
    title,
    rootPath: root,
  });
  return { root, repo };
}

// ── MANU-001 — the P0 ───────────────────────────────────────────────────────

describe("MANU-001: an external edit is never silently overwritten", () => {
  it("refuses the write that used to destroy prose, and keeps both versions", async () => {
    const { root, repo } = await project();
    const chapter = await repo.addChapter({ title: "One" });
    await repo.writeProjectFile(chapter.filePath, "---\nid: c\n---\n\nVersion from Manu.\n");

    // The writer opens the file in another editor and writes 2,000 words.
    const theirs = "---\nid: c\n---\n\nVersion typed in vim, two thousand words.\n";
    await fs.writeFile(path.join(root, chapter.filePath), theirs);

    // Manu tries to save what it was holding. This used to succeed silently.
    await expect(
      repo.writeProjectFile(chapter.filePath, "---\nid: c\n---\n\nVersion from Manu.\n"),
    ).rejects.toThrowError(/modified by another application/);

    // Nothing was lost.
    expect(await fs.readFile(path.join(root, chapter.filePath), "utf8")).toBe(theirs);
  });

  it("detects deletion as well as modification", async () => {
    const { root, repo } = await project();
    const chapter = await repo.addChapter({ title: "One" });
    await repo.writeProjectFile(chapter.filePath, "prose");
    await fs.rm(path.join(root, chapter.filePath));

    await expect(repo.writeProjectFile(chapter.filePath, "prose")).rejects.toThrowError(
      /was deleted by another application/,
    );
  });

  it("lets the writer take the external version", async () => {
    const { root, repo } = await project();
    const chapter = await repo.addChapter({ title: "One" });
    await repo.writeProjectFile(chapter.filePath, "mine");
    await fs.writeFile(path.join(root, chapter.filePath), "theirs");

    expect(await repo.fileIsCurrent(chapter.filePath)).toBe(false);
    expect(await repo.acceptExternalChange(chapter.filePath)).toBe("theirs");
    expect(await repo.fileIsCurrent(chapter.filePath)).toBe(true);

    // And writing works again afterwards.
    await repo.writeProjectFile(chapter.filePath, "mine, deliberately");
    expect(await fs.readFile(path.join(root, chapter.filePath), "utf8")).toBe("mine, deliberately");
  });

  it("lets the writer overwrite deliberately, and keeps the external text in history", async () => {
    const { root, repo } = await project();
    const chapter = await repo.addChapter({ title: "One" });
    await repo.writeProjectFile(chapter.filePath, "mine");
    await fs.writeFile(path.join(root, chapter.filePath), "theirs, which will be replaced");

    await repo.overwriteProjectFile(chapter.filePath, "mine wins");
    expect(await fs.readFile(path.join(root, chapter.filePath), "utf8")).toBe("mine wins");

    // The overwritten text is recoverable: it is the "before" of a change set.
    const changes = await repo.listChangeSets();
    const recorded = JSON.stringify(
      await Promise.all(changes.slice(0, 3).map((c) => repo.getChangeSet(c.id))),
    );
    expect(recorded).toContain("theirs, which will be replaced");
  });

  it("does not manufacture conflicts from Manu's own bookkeeping", async () => {
    // `.writer/` churn must not surface as a conflict a writer cannot act on.
    const { repo } = await project();
    for (let i = 0; i < 5; i += 1) await repo.addCharacter({ name: `C${String(i)}`, goals: [] });
    await repo.buildStory();
    expect((await repo.listCharacters()).length).toBe(5);
  });

  it("guards only what the writer owns", async () => {
    const inner = new InMemoryProjectStore();
    const guard = new GuardedProjectStore(inner);
    await guard.writeFile("manuscript/a.md", "one");
    await guard.writeFile(".writer/state/id-sequences.json", "{}");
    await inner.writeFile("manuscript/a.md", "changed underneath");
    await inner.writeFile(".writer/state/id-sequences.json", '{"changed":1}');

    await expect(guard.writeFile("manuscript/a.md", "two")).rejects.toBeInstanceOf(
      ExternalChangeError,
    );
    await expect(guard.writeFile(".writer/state/id-sequences.json", "{}")).resolves.toBeUndefined();
  });

  it("fingerprints differ for different content and match for identical", () => {
    expect(fingerprint("a")).not.toBe(fingerprint("b"));
    expect(fingerprint("hello")).toBe(fingerprint("hello"));
    expect(fingerprint(null)).toBe("absent");
  });
});

// ── MANU-002 / MANU-003 — project creation ──────────────────────────────────

describe("MANU-002: a project folder name stays human", () => {
  it("keeps spaces, capitals, accents and ordinary punctuation", () => {
    expect(projectFolderName("The Black Thorn")).toBe("The Black Thorn");
    expect(projectFolderName("Tёmный шип — drafts (2026)")).toBe("Tёmный шип — drafts (2026)");
    expect(projectFolderName("Book #2: The Sequel")).toBe("Book #2 The Sequel");
  });

  it("removes only what a filesystem cannot take", () => {
    expect(projectFolderName('a/b\\c:d*e?f"g<h>i|j')).toBe("a b c d e f g h i j");
    expect(projectFolderName("...hidden")).toBe("hidden");
    expect(projectFolderName("trailing.  ")).toBe("trailing");
    expect(projectFolderName("   ")).toBe("Untitled project");
    expect(projectFolderName("CON")).toBe("CON project");
  });

  it("finds a free name rather than colliding", async () => {
    const taken = new Set(["The Black Thorn", "The Black Thorn 2"]);
    const name = await availableFolderName("The Black Thorn", (n) => Promise.resolve(taken.has(n)));
    expect(name).toBe("The Black Thorn 3");
  });
});

describe("MANU-003: project creation is transactional", () => {
  it("leaves the destination untouched when creation fails part-way", async () => {
    // The desktop app builds into a temp directory and promotes by rename; this
    // is the repository half — a failed build must not produce a project that
    // opens, and the caller removes the temp directory.
    const parent = await tmpDir("manu-Novels-");
    await fs.writeFile(path.join(parent, "tax-return-2025.pdf"), "important");
    const temp = path.join(parent, ".manu-new-test");
    await fs.mkdir(temp);

    const store = new NodeProjectStore(temp);
    let writes = 0;
    const original = store.writeFile.bind(store);
    (store as unknown as { writeFile: typeof store.writeFile }).writeFile = async (p, c) => {
      writes += 1;
      if (writes === 4) throw new Error("SIMULATED disk failure");
      return original(p, c);
    };

    await expect(
      StoryRepository.createProject({ store, title: "Half A Project", rootPath: temp }),
    ).rejects.toThrowError(/SIMULATED disk failure/);

    // The half-built project does not validate, so it can never be promoted.
    const check = await StoryRepository.validateProject(new NodeProjectStore(temp));
    expect(check.ok).toBe(false);

    // And after the caller discards the temp directory, the writer's folder is
    // exactly as it was.
    await fs.rm(temp, { recursive: true, force: true });
    expect(await fs.readdir(parent)).toEqual(["tax-return-2025.pdf"]);
  });

  it("a completed project validates, which is what makes promotion safe", async () => {
    const root = await tmpDir();
    await StoryRepository.createProject({
      store: new NodeProjectStore(root),
      title: "Whole",
      rootPath: root,
    });
    expect((await StoryRepository.validateProject(new NodeProjectStore(root))).ok).toBe(true);
  });
});

// ── MANU-009 — schema versions ──────────────────────────────────────────────

describe("MANU-009: every schema version is accounted for", () => {
  async function openWith(version: number): Promise<string> {
    const root = await tmpDir();
    await StoryRepository.createProject({
      store: new NodeProjectStore(root),
      title: "Schema",
      rootPath: root,
    });
    const manifestPath = path.join(root, ".writer", "project.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>;
    manifest["schemaVersion"] = version;
    await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    try {
      await StoryRepository.openProject({ store: new NodeProjectStore(root) });
      return "OPENED";
    } catch (e) {
      return (e as Error).message;
    }
  }

  it("refuses an older schema it has no migration for, instead of reinterpreting it", async () => {
    // This is the regression: version 0 used to open silently and be read under
    // version-1 assumptions.
    expect(await openWith(0)).toMatch(/cannot upgrade/);
    expect(await openWith(-3)).toMatch(/cannot upgrade/);
  });

  it("refuses a newer schema and says to update Manu", async () => {
    // Refused at the manifest gate, before migration is even considered.
    expect(await openWith(99)).toMatch(/newer than this app supports|newer version of Manu/);
  });

  it("opens the current schema without migrating anything", async () => {
    expect(await openWith(1)).toBe("OPENED");
    const outcome = await migrateProject(new InMemoryProjectStore(), {
      schemaVersion: 1,
      id: "PROJ_x" as never,
      title: "t",
      createdAt: "",
      updatedAt: "",
      appFormatVersion: "0.1.0",
    });
    expect(outcome.applied).toEqual([]);
  });

  it("never mutates a folder it refuses to open", async () => {
    const plain = await tmpDir();
    await fs.writeFile(path.join(plain, "notes.txt"), "just a folder");
    await expect(
      StoryRepository.openProject({ store: new NodeProjectStore(plain) }),
    ).rejects.toThrowError(/No project manifest/);
    expect(await fs.readdir(plain)).toEqual(["notes.txt"]);
  });
});

// ── MANU-020 — backups ──────────────────────────────────────────────────────

describe("MANU-020: bounded local backups", () => {
  it("snapshots what the writer owns and nothing Manu generates", async () => {
    const { root, repo } = await project();
    const chapter = await repo.addChapter({ title: "One" });
    await repo.writeProjectFile(chapter.filePath, "precious prose");
    await repo.buildStory();

    const entry = await repo.backups.capture({ reason: "test" });
    expect(entry).not.toBeNull();

    const files = await repo.backups.read(entry?.id ?? "");
    expect(files.get(chapter.filePath)).toBe("precious prose");
    // Derived analysis and the backups themselves are not copied.
    expect([...files.keys()].some((p) => p.startsWith(".writer/"))).toBe(false);
    expect(root).toBeDefined();
  });

  it("is bounded, and prunes the oldest", async () => {
    const { repo } = await project();
    const chapter = await repo.addChapter({ title: "One" });
    await repo.writeProjectFile(chapter.filePath, "v1");

    for (let i = 0; i < RETAIN + 4; i += 1) {
      await repo.backups.capture({
        reason: `snap ${String(i)}`,
        now: `2026-01-01T00:${String(i).padStart(2, "0")}:00.000Z`,
      });
    }
    const list = await repo.backups.list();
    expect(list).toHaveLength(RETAIN);
    expect(list[0]?.reason).toBe(`snap ${String(RETAIN + 3)}`);
  });

  it("skips a snapshot taken too recently", async () => {
    const { repo } = await project();
    const first = await repo.backups.capture({ reason: "open", now: "2026-01-01T00:00:00.000Z" });
    const second = await repo.backups.capture({
      reason: "open",
      now: "2026-01-01T00:05:00.000Z",
      minIntervalMs: 60 * 60 * 1000,
    });
    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("restores prose, and backs up the current state first", async () => {
    const { root, repo } = await project();
    const chapter = await repo.addChapter({ title: "One" });
    await repo.writeProjectFile(chapter.filePath, "the good draft");
    const snapshot = await repo.backups.capture({ reason: "before the accident" });

    await repo.writeProjectFile(chapter.filePath, "the accident");
    expect(await fs.readFile(path.join(root, chapter.filePath), "utf8")).toBe("the accident");

    const restored = await repo.backups.restore(snapshot?.id ?? "");
    expect(restored).toBeGreaterThan(0);
    expect(await fs.readFile(path.join(root, chapter.filePath), "utf8")).toBe("the good draft");
    // Restoring is itself reversible.
    expect((await repo.backups.list()).some((e) => e.reason.startsWith("before restoring"))).toBe(
      true,
    );
  });

  it("never writes to a canonical file while capturing", async () => {
    const { root, repo } = await project();
    const chapter = await repo.addChapter({ title: "One" });
    await repo.writeProjectFile(chapter.filePath, "untouched");
    const before = await fs.stat(path.join(root, chapter.filePath));
    await repo.backups.capture({ reason: "test" });
    const after = await fs.stat(path.join(root, chapter.filePath));
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(await fs.readFile(path.join(root, chapter.filePath), "utf8")).toBe("untouched");
  });

  it("works over the in-memory store too, so the logic is not filesystem-specific", async () => {
    const store = new InMemoryProjectStore();
    const repo = await StoryRepository.createProject({ store, title: "Mem" });
    const chapter = await repo.addChapter({ title: "One" });
    await repo.writeProjectFile(chapter.filePath, "x");
    const backups = new ProjectBackups(store);
    const entry = await backups.capture({ reason: "test" });
    expect(entry?.files).toBeGreaterThan(0);
  });
});

// ── Restart, still the thing the whole product rests on ─────────────────────

describe("prose survives the round trip", () => {
  it("writes, closes, reopens and finds the same words", async () => {
    const { root, repo } = await project();
    const chapter = await repo.addChapter({ title: "One" });
    const text = "---\nid: c\n---\n\nThe hall was colder than she remembered.\n";
    await repo.writeProjectFile(chapter.filePath, text);

    const reopened = await StoryRepository.openProject({ store: new NodeProjectStore(root) });
    expect(await reopened.readProjectFile(chapter.filePath)).toBe(text);

    // And the reopened repository can write again — the guard starts fresh and
    // adopts what it reads.
    await reopened.writeProjectFile(chapter.filePath, `${text}\nA second paragraph.\n`);
    expect(await reopened.readProjectFile(chapter.filePath)).toContain("second paragraph");
  });
});
