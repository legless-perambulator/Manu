import { describe, expect, it } from "vitest";
import { buildProjectTree } from "./tree";

describe("buildProjectTree", () => {
  it("always includes the canonical content areas, even when empty", () => {
    const tree = buildProjectTree([]);
    const names = tree.children.map((c) => c.name);
    for (const area of [
      "manuscript",
      "characters",
      "world",
      "plot",
      "style",
      "research",
      "notes",
    ]) {
      expect(names).toContain(area);
    }
  });

  it("nests files under directories and hides .writer by default", () => {
    const tree = buildProjectTree([
      "manuscript/act_1/chapter_001.md",
      "story/premise.md",
      ".writer/project.json",
    ]);
    const manuscript = tree.children.find((c) => c.name === "manuscript");
    expect(manuscript?.children[0]?.name).toBe("act_1");
    expect(manuscript?.children[0]?.children[0]?.path).toBe("manuscript/act_1/chapter_001.md");
    expect(tree.children.some((c) => c.name === ".writer")).toBe(false);
  });

  it("orders directories before files, each alphabetically", () => {
    const tree = buildProjectTree(["notes/z.md", "notes/a.md"]);
    const notes = tree.children.find((c) => c.name === "notes");
    expect(notes?.children.map((c) => c.name)).toEqual(["a.md", "z.md"]);
  });
});
