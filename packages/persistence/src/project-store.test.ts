import { describe, expect, it } from "vitest";
import { InMemoryProjectStore } from "./project-store";
import { InMemoryStateStore } from "./state-store";

describe("InMemoryProjectStore", () => {
  it("reads back written files and reports existence", async () => {
    const store = new InMemoryProjectStore();
    expect(await store.exists("manuscript/chapter_001.md")).toBe(false);
    await store.writeFile("manuscript/chapter_001.md", "# One");
    expect(await store.exists("manuscript/chapter_001.md")).toBe(true);
    expect(await store.readFile("manuscript/chapter_001.md")).toBe("# One");
    expect(await store.readFile("missing.md")).toBeNull();
  });

  it("normalizes leading-slash and backslash paths", async () => {
    const store = new InMemoryProjectStore();
    await store.writeFile("/scenes/SCENE_0001.yaml", "id: SCENE_0001");
    expect(await store.readFile("scenes/SCENE_0001.yaml")).toBe("id: SCENE_0001");
    await store.writeFile("world\\locations\\LOC_0001.md", "x");
    expect(await store.exists("world/locations/LOC_0001.md")).toBe(true);
  });

  it("lists sorted paths filtered by prefix", async () => {
    const store = new InMemoryProjectStore({
      "manuscript/b.md": "",
      "manuscript/a.md": "",
      "scenes/s.yaml": "",
    });
    expect(await store.list("manuscript/")).toEqual(["manuscript/a.md", "manuscript/b.md"]);
    expect(await store.list()).toEqual(["manuscript/a.md", "manuscript/b.md", "scenes/s.yaml"]);
  });

  it("deletes files idempotently", async () => {
    const store = new InMemoryProjectStore({ "a.md": "x" });
    await store.delete("a.md");
    await store.delete("a.md");
    expect(await store.exists("a.md")).toBe(false);
  });
});

describe("InMemoryStateStore", () => {
  it("stores structural clones so callers cannot mutate by reference", async () => {
    const store = new InMemoryStateStore();
    const value = { trust: 0.5 };
    await store.set("state/CHAR_0001", value);
    value.trust = 0.1;
    expect(await store.get<{ trust: number }>("state/CHAR_0001")).toEqual({ trust: 0.5 });
  });

  it("lists keys by prefix and deletes", async () => {
    const store = new InMemoryStateStore();
    await store.set("a/1", 1);
    await store.set("a/2", 2);
    await store.set("b/1", 3);
    expect(await store.keys("a/")).toEqual(["a/1", "a/2"]);
    await store.delete("a/1");
    expect(await store.keys("a/")).toEqual(["a/2"]);
    expect(await store.get("missing")).toBeNull();
  });
});
