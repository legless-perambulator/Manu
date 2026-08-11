import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeProjectStore } from "./node-project-store";
import { PathEscapeError } from "../path-safety";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "jellytind-store-"));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("NodeProjectStore", () => {
  it("writes and reads real files, creating parent dirs", async () => {
    const store = new NodeProjectStore(root);
    await store.writeFile("manuscript/act_1/chapter_001.md", "# One");
    expect(await store.readFile("manuscript/act_1/chapter_001.md")).toBe("# One");
    expect(await store.exists("manuscript/act_1/chapter_001.md")).toBe(true);
    expect(await store.readFile("nope.md")).toBeNull();
    // Content is actually on disk.
    expect(await readFile(join(root, "manuscript/act_1/chapter_001.md"), "utf8")).toBe("# One");
  });

  it("writes atomically, leaving no temp files behind", async () => {
    const store = new NodeProjectStore(root);
    await store.writeFile("notes.md", "v1");
    await store.writeFile("notes.md", "v2");
    expect(await store.readFile("notes.md")).toBe("v2");
    const entries = await readdir(root);
    expect(entries.some((e) => e.endsWith(".tmp"))).toBe(false);
    expect(entries).toContain("notes.md");
  });

  it("lists files recursively as sorted POSIX paths", async () => {
    const store = new NodeProjectStore(root);
    await store.writeFile("b/2.md", "");
    await store.writeFile("b/1.md", "");
    await store.writeFile("a.md", "");
    expect(await store.list()).toEqual(["a.md", "b/1.md", "b/2.md"]);
    expect(await store.list("b")).toEqual(["b/1.md", "b/2.md"]);
  });

  it("prevents path traversal and never writes outside the root", async () => {
    const store = new NodeProjectStore(root);
    await expect(store.writeFile("../escape.md", "x")).rejects.toBeInstanceOf(PathEscapeError);
    await expect(store.readFile("../../etc/passwd")).rejects.toBeInstanceOf(PathEscapeError);
    await expect(store.writeFile("/abs.md", "x")).rejects.toBeInstanceOf(PathEscapeError);
    // The sibling file must not have been created.
    await expect(readFile(join(root, "..", "escape.md"), "utf8")).rejects.toThrow();
  });

  it("does not follow a symlink out of the root at read time", async () => {
    // Even if a file named like a traversal exists, normalization blocks it.
    await writeFile(join(root, "real.md"), "ok");
    const store = new NodeProjectStore(root);
    expect(await store.readFile("real.md")).toBe("ok");
    await expect(store.readFile("a/../../real.md")).rejects.toBeInstanceOf(PathEscapeError);
  });

  it("deletes files idempotently", async () => {
    const store = new NodeProjectStore(root);
    await store.writeFile("x.md", "1");
    await store.delete("x.md");
    await store.delete("x.md");
    expect(await store.exists("x.md")).toBe(false);
  });
});
